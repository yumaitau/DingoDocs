import { sql } from "drizzle-orm";
import { db } from "@/db";
import { structuredLog } from "@/lib/observability/logger";
import { withSpan } from "@/lib/observability/telemetry";

type JobRow = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  /** Claimed locked_at (full precision text); fences completion writes. */
  lock_token: string;
};

/**
 * A `running` job whose lock is older than this is assumed to belong to a
 * crashed worker and may be reclaimed. Keep it well above the longest job.
 */
export const JOB_LEASE_SECONDS = Math.max(
  60,
  Number(process.env.JOB_LEASE_SECONDS) || 30 * 60,
);

export async function claimJobs(limit: number) {
  // Stale running jobs that already used their final attempt are dead.
  await db.execute(sql`
    update background_jobs set
      status = 'dead_letter', failed_at = now(), locked_at = null,
      last_error = 'Job lease expired after final attempt'
    where status = 'running' and attempts >= max_attempts
      and locked_at < now() - (${JOB_LEASE_SECONDS} * interval '1 second')
  `);
  return db.execute<JobRow>(sql`
    update background_jobs
    set status = 'running', locked_at = now(), attempts = attempts + 1
    where id in (
      select id from background_jobs
      where (status in ('queued', 'retrying') and available_at <= now())
        or (status = 'running' and attempts < max_attempts
          and locked_at < now() - (${JOB_LEASE_SECONDS} * interval '1 second'))
      order by created_at
      for update skip locked
      limit ${limit}
    )
    returning id, type, payload, attempts, max_attempts, locked_at::text as lock_token
  `);
}

/** Fenced completion: a no-op if the job was reclaimed by a newer claim. */
export async function completeJob(job: Pick<JobRow, "id" | "lock_token">) {
  const rows = await db.execute(sql`
    update background_jobs set status = 'completed', completed_at = now(), locked_at = null
    where id = ${job.id} and status = 'running'
      and locked_at = ${job.lock_token}::timestamptz
    returning id
  `);
  return rows.length > 0;
}

/** Fenced failure/retry: a no-op if the job was reclaimed by a newer claim. */
export async function failJob(
  job: Pick<JobRow, "id" | "lock_token" | "attempts" | "max_attempts">,
  message: string,
) {
  const terminal = job.attempts >= job.max_attempts;
  const rows = await db.execute(sql`
    update background_jobs set
      status = ${terminal ? "dead_letter" : "retrying"},
      failed_at = ${terminal ? sql`now()` : null},
      available_at = now() + (${Math.min(3600, 2 ** job.attempts * 15)} * interval '1 second'),
      last_error = ${message}, locked_at = null
    where id = ${job.id} and status = 'running'
      and locked_at = ${job.lock_token}::timestamptz
    returning id
  `);
  return { terminal, applied: rows.length > 0 };
}

export async function processNextJobs(limit: number) {
  const claimed = await claimJobs(limit);

  for (const job of claimed) {
    const startedAt = performance.now();
    try {
      await withSpan(
        "job.process",
        { "job.type": job.type, "job.attempt": job.attempts },
        () => runJob(job),
      );
      const fenced = !(await completeJob(job));
      structuredLog(fenced ? "warn" : "info", "job.completed", {
        jobId: job.id,
        jobType: job.type,
        attempt: job.attempts,
        fenced,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 2000)
          : "Unknown job failure";
      const { terminal, applied } = await failJob(job, message);
      structuredLog(terminal ? "error" : "warn", "job.failed", {
        jobId: job.id,
        jobType: job.type,
        attempt: job.attempts,
        terminal,
        fenced: !applied,
        errorType: error instanceof Error ? error.name : "UnknownError",
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
  }
}

async function runJob(job: JobRow) {
  if (job.type === "health.noop") return;
  if (job.type === "evidence.scan") {
    const evidenceId = job.payload.evidenceId;
    if (typeof evidenceId !== "string")
      throw new Error("Evidence scan job is missing evidenceId");
    const { scanEvidenceJob } = await import("@/server/services/evidence");
    await scanEvidenceJob(evidenceId);
    return;
  }
  if (job.type === "report.generate") {
    const reportVersionId = job.payload.reportVersionId;
    const formats = job.payload.formats;
    if (
      typeof reportVersionId !== "string" ||
      !Array.isArray(formats) ||
      !formats.every((format) =>
        ["pdf", "docx", "html", "markdown", "json", "xlsx", "pptx"].includes(
          String(format),
        ),
      )
    )
      throw new Error("Report generation job payload is invalid");
    const { generateReportJob } = await import("@/server/services/reports");
    await generateReportJob(
      reportVersionId,
      formats as Array<
        "pdf" | "docx" | "html" | "markdown" | "json" | "xlsx" | "pptx"
      >,
    );
    return;
  }
  if (job.type === "retention.process") {
    const organisationId = job.payload.organisationId;
    const asOf = job.payload.asOf;
    if (typeof organisationId !== "string" || typeof asOf !== "string")
      throw new Error("Retention job payload is invalid");
    const { applyRetention, purgeExpiredEvidence } =
      await import("@/server/services/retention");
    const when = new Date(asOf);
    await applyRetention(organisationId, when);
    await purgeExpiredEvidence(organisationId, {
      asOf: when,
      scheduled: true,
    });
    return;
  }
  if (job.type === "webhook.deliver") {
    const deliveryId = job.payload.deliveryId;
    if (typeof deliveryId !== "string")
      throw new Error("Webhook job payload is invalid");
    const { deliverWebhookJob } = await import("@/server/services/webhooks");
    await deliverWebhookJob(deliveryId);
    return;
  }
  if (job.type === "notification.deliver") {
    const deliveryId = job.payload.deliveryId;
    if (typeof deliveryId !== "string")
      throw new Error("Notification job payload is invalid");
    const { deliverNotificationJob } =
      await import("@/server/services/notifications");
    await deliverNotificationJob(deliveryId);
    return;
  }
  throw new Error(`No handler registered for job type ${job.type}`);
}
