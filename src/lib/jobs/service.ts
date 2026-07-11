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
};

export async function processNextJobs(limit: number) {
  const claimed = await db.execute<JobRow>(sql`
    update background_jobs
    set status = 'running', locked_at = now(), attempts = attempts + 1
    where id in (
      select id from background_jobs
      where status in ('queued', 'retrying') and available_at <= now()
      order by created_at
      for update skip locked
      limit ${limit}
    )
    returning id, type, payload, attempts, max_attempts
  `);

  for (const job of claimed) {
    const startedAt = performance.now();
    try {
      await withSpan(
        "job.process",
        { "job.type": job.type, "job.attempt": job.attempts },
        () => runJob(job),
      );
      await db.execute(
        sql`update background_jobs set status = 'completed', completed_at = now() where id = ${job.id}`,
      );
      structuredLog("info", "job.completed", {
        jobId: job.id,
        jobType: job.type,
        attempt: job.attempts,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 2000)
          : "Unknown job failure";
      const terminal = job.attempts >= job.max_attempts;
      await db.execute(sql`
        update background_jobs set
          status = ${terminal ? "dead_letter" : "retrying"},
          failed_at = ${terminal ? sql`now()` : null},
          available_at = now() + (${Math.min(3600, 2 ** job.attempts * 15)} * interval '1 second'),
          last_error = ${message}, locked_at = null
        where id = ${job.id}
      `);
      structuredLog(terminal ? "error" : "warn", "job.failed", {
        jobId: job.id,
        jobType: job.type,
        attempt: job.attempts,
        terminal,
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
        ["pdf", "docx", "html", "markdown", "json"].includes(String(format)),
      )
    )
      throw new Error("Report generation job payload is invalid");
    const { generateReportJob } = await import("@/server/services/reports");
    await generateReportJob(
      reportVersionId,
      formats as Array<"pdf" | "docx" | "html" | "markdown" | "json">,
    );
    return;
  }
  if (job.type === "retention.process") {
    const organisationId = job.payload.organisationId;
    const asOf = job.payload.asOf;
    if (typeof organisationId !== "string" || typeof asOf !== "string")
      throw new Error("Retention job payload is invalid");
    const { purgeExpiredEvidence } =
      await import("@/server/services/retention");
    await purgeExpiredEvidence(organisationId, {
      asOf: new Date(asOf),
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
