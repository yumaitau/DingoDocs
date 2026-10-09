import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { apiError } from "@/lib/api/responses";
import { requireOrganisationContext } from "@/lib/permissions/require";

const markSchema = z
  .object({
    id: z.string().uuid().optional(),
    all: z.literal(true).optional(),
  })
  .strict()
  .refine((value) => value.all === true || Boolean(value.id), {
    message: "Provide a notification id or all",
  });

async function listNotifications(userId: string, organisationId: string) {
  const scope = and(
    eq(notifications.organisationId, organisationId),
    eq(notifications.userId, userId),
  );
  const [rows, unread] = await Promise.all([
    db
      .select({
        id: notifications.id,
        title: notifications.title,
        eventType: notifications.eventType,
        actionUrl: notifications.actionUrl,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(scope)
      .orderBy(desc(notifications.createdAt))
      .limit(20),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(scope, isNull(notifications.readAt))),
  ]);
  return { notifications: rows, unreadCount: unread[0]?.total ?? 0 };
}

export async function GET(request: Request) {
  try {
    const context = await requireOrganisationContext();
    return Response.json(
      await listNotifications(context.userId, context.organisationId),
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error, request.headers.get("x-request-id"));
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireOrganisationContext();
    const body = markSchema.parse(await request.json());
    const now = new Date();
    const scope = and(
      eq(notifications.organisationId, context.organisationId),
      eq(notifications.userId, context.userId),
      isNull(notifications.readAt),
    );
    await db
      .update(notifications)
      .set({ readAt: now })
      .where(
        body.all ? scope : and(scope, eq(notifications.id, body.id ?? "")),
      );
    return Response.json(
      await listNotifications(context.userId, context.organisationId),
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error, request.headers.get("x-request-id"));
  }
}
