import { and, asc, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { apiReadContext, apiWriteContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import { engagementVisibility } from "@/lib/permissions/access";
import { createWorkspaceTask } from "@/server/services/engagement-workspace";

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
      engagementVisibility(context, tasks.engagementId),
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

const createSchema = z.object({
  engagementId: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(10_000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  assigneeId: z.string().uuid().optional(),
  dueAt: z.string().datetime().optional(),
  assetIds: z.array(z.string().uuid()).max(100).optional(),
});

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    const input = createSchema.parse(await request.json());
    const principal = await apiWriteContext(
      request,
      "tasks:write",
      "scope:manage",
      { engagementId: input.engagementId },
    );
    if (!principal.userId)
      throw new Error("API key does not have an attributable owner");
    const dueAt = input.dueAt ? new Date(input.dueAt) : undefined;
    if (dueAt && Number.isNaN(dueAt.getTime()))
      throw new Error("dueAt is not a valid timestamp");
    const task = await createWorkspaceTask(
      { organisationId: principal.organisationId, userId: principal.userId },
      {
        engagementId: input.engagementId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        assigneeId: input.assigneeId,
        dueAt,
        assetIds: input.assetIds,
      },
    );
    return NextResponse.json({ data: task, requestId }, { status: 201 });
  } catch (error) {
    return apiError(error, requestId);
  }
}
