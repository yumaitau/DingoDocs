import { and, asc, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { apiReadContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["name", "createdAt"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    const context = await apiReadContext(request, "clients:read");
    const query = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const where = and(
      eq(clients.organisationId, context.organisationId),
      isNull(clients.deletedAt),
      query.q ? ilike(clients.name, `%${query.q}%`) : undefined,
    );
    const column = query.sort === "name" ? clients.name : clients.createdAt;
    const [data, count] = await Promise.all([
      db
        .select()
        .from(clients)
        .where(where)
        .orderBy(query.order === "asc" ? asc(column) : desc(column))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(clients)
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
