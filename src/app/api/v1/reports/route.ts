import { and, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { reports } from "@/db/schema";
import { apiReadContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  engagementId: z.string().uuid().optional(),
  status: z
    .enum([
      "draft",
      "internal_review",
      "changes_requested",
      "qa_approved",
      "client_review",
      "approved",
      "published",
      "superseded",
      "archived",
    ])
    .optional(),
});

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    const context = await apiReadContext(request, "reports:read");
    const query = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const where = and(
      eq(reports.organisationId, context.organisationId),
      query.engagementId
        ? eq(reports.engagementId, query.engagementId)
        : undefined,
      query.status ? eq(reports.status, query.status) : undefined,
    );
    const [data, count] = await Promise.all([
      db
        .select()
        .from(reports)
        .where(where)
        .orderBy(desc(reports.updatedAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(reports)
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
