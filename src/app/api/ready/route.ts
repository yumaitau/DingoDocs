import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { storage } from "@/lib/storage";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    await storage().healthCheck();
    return NextResponse.json({
      status: "ready",
      database: "ok",
      storage: "ok",
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "not_ready",
        error: error instanceof Error ? error.message : "unknown",
      },
      { status: 503 },
    );
  }
}
