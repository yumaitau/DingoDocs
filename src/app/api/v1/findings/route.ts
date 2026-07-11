import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { findings } from "@/db/schema";
import { apiReadContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  engagementId: z.string().uuid().optional(),
  status: z
    .enum([
      "draft",
      "in_progress",
      "ready_for_review",
      "changes_requested",
      "peer_reviewed",
      "qa_approved",
      "published",
      "remediation_in_progress",
      "ready_for_retest",
      "retested",
      "resolved",
      "risk_accepted",
      "closed",
    ])
    .optional(),
  severity: z
    .enum(["informational", "low", "medium", "high", "critical"])
    .optional(),
  sort: z.enum(["createdAt", "severity", "title"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    const context = await apiReadContext(request, "findings:read");
    const query = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const where = and(
      eq(findings.organisationId, context.organisationId),
      isNull(findings.deletedAt),
      query.engagementId
        ? eq(findings.engagementId, query.engagementId)
        : undefined,
      query.status ? eq(findings.status, query.status) : undefined,
      query.severity ? eq(findings.severity, query.severity) : undefined,
    );
    const column =
      query.sort === "title"
        ? findings.title
        : query.sort === "severity"
          ? findings.severity
          : findings.createdAt;
    const [data, count] = await Promise.all([
      db
        .select()
        .from(findings)
        .where(where)
        .orderBy(query.order === "asc" ? asc(column) : desc(column))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(findings)
        .where(where),
    ]);
    return NextResponse.json({
      data,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: count[0]?.total ?? 0,
      },
      requestId,
    });
  } catch (error) {
    return apiError(error, requestId);
  }
}
