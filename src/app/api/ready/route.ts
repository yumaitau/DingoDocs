import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { storage } from "@/lib/storage";
import { structuredLog } from "@/lib/observability/logger";
import { retentionJobMetrics } from "@/server/services/retention";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    await storage().healthCheck();
    const jobs = await retentionJobMetrics();
    return NextResponse.json({
      status: "ready",
      database: "ok",
      storage: "ok",
      jobs: {
        queued: jobs.queued ?? 0,
        running: jobs.running ?? 0,
        retrying: jobs.retrying ?? 0,
        deadLetter: jobs.dead_letter ?? 0,
      },
    });
  } catch (error) {
    structuredLog("error", "readiness.failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      {
        status: "not_ready",
      },
      { status: 503 },
    );
  }
}
