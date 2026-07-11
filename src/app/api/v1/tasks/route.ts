import { and, asc, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { apiReadContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  engagementId: z.string().uuid().optional(),
  status: z
    .enum(["backlog", "todo", "in_progress", "blocked", "done", "cancelled"])
    .optional(),
  sort: z.enum(["createdAt", "dueAt", "priority"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    const context = await apiReadContext(request, "tasks:read");
    const query = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const where = and(
      eq(tasks.organisationId, context.organisationId),
      query.engagementId
        ? eq(tasks.engagementId, query.engagementId)
        : undefined,
      query.status ? eq(tasks.status, query.status) : undefined,
    );
    const column =
      query.sort === "dueAt"
        ? tasks.dueAt
        : query.sort === "priority"
          ? tasks.priority
          : tasks.createdAt;
    const [data, count] = await Promise.all([
      db
        .select()
        .from(tasks)
        .where(where)
        .orderBy(query.order === "asc" ? asc(column) : desc(column))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(tasks)
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
