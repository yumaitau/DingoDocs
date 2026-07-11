import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { engagements } from "@/db/schema";
import { apiError } from "@/lib/api/responses";
import { requireOrganisationContext } from "@/lib/permissions/require";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z
    .enum([
      "proposed",
      "scoping",
      "scheduled",
      "ready",
      "testing",
      "reporting",
      "peer_review",
      "quality_assurance",
      "client_review",
      "retesting",
      "complete",
      "archived",
      "cancelled",
    ])
    .optional(),
  sort: z.enum(["name", "createdAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    const context = await requireOrganisationContext();
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams));
    const where = and(
      eq(engagements.organisationId, context.organisationId),
      isNull(engagements.deletedAt),
      query.status ? eq(engagements.status, query.status) : undefined,
    );
    const orderColumn =
      query.sort === "name" ? engagements.name : engagements.createdAt;
    const [items, totals] = await Promise.all([
      db
        .select()
        .from(engagements)
        .where(where)
        .orderBy(query.order === "asc" ? asc(orderColumn) : desc(orderColumn))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(engagements)
        .where(where),
    ]);
    return NextResponse.json({
      data: items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: totals[0]?.total ?? 0,
      },
      requestId,
    });
  } catch (error) {
    return apiError(error, requestId);
  }
}
