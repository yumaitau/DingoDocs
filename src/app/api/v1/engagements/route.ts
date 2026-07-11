import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { engagements } from "@/db/schema";
import { clients } from "@/db/schema";
import { apiReadContext, apiWriteContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";

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
    const context = await apiReadContext(request, "engagements:read");
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

const createSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().trim().min(2).max(200),
  reference: z.string().trim().min(2).max(80),
  type: z.string().trim().min(2).max(120),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  objectives: z.string().trim().max(10_000).optional(),
});

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    const context = await apiWriteContext(
      request,
      "engagements:write",
      "engagement:create",
    );
    const input = createSchema.parse(await request.json());
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.id, input.clientId),
          eq(clients.organisationId, context.organisationId),
          isNull(clients.deletedAt),
        ),
      )
      .limit(1);
    if (!client)
      return NextResponse.json(
        {
          error: { code: "not_found", message: "Client was not found" },
          requestId,
        },
        { status: 404 },
      );
    const [created] = await db
      .insert(engagements)
      .values({
        organisationId: context.organisationId,
        ...input,
      })
      .returning();
    return NextResponse.json({ data: created, requestId }, { status: 201 });
  } catch (error) {
    return apiError(error, requestId);
  }
}
