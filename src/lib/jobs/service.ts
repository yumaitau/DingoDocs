import { sql } from "drizzle-orm";
import { db } from "@/db";

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
    try {
      await runJob(job);
      await db.execute(
        sql`update background_jobs set status = 'completed', completed_at = now() where id = ${job.id}`,
      );
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
  throw new Error(`No handler registered for job type ${job.type}`);
}
