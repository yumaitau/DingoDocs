"use server";

import { redirect } from "next/navigation";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { db } from "@/db";
import {
  auditEvents,
  clients,
  engagementMembers,
  engagements,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requirePermission } from "@/lib/permissions/require";

const createSchema = z
  .object({
    name: z.string().trim().min(3).max(160),
    clientId: z.string().uuid(),
    type: z.string().trim().min(3).max(100),
    startDate: z.string().date(),
    endDate: z.string().date(),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "End date must be on or after start date",
    path: ["endDate"],
  });

export async function createEngagement(formData: FormData) {
  const context = await requirePermission("engagement:create");
  const input = createSchema.parse(Object.fromEntries(formData));
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        eq(clients.id, input.clientId),
        eq(clients.organisationId, context.organisationId),
      ),
    )
    .limit(1);
  if (!client)
    throw new Error("Client is not available in the active organisation");

  const id = uuidv7();
  const reference = `ENG-${new Date().getFullYear()}-${id.slice(0, 6).toUpperCase()}`;
  await db.transaction(async (tx) => {
    await tx.insert(engagements).values({
      id,
      organisationId: context.organisationId,
      clientId: input.clientId,
      name: input.name,
      reference,
      type: input.type,
      status: "scoping",
      startDate: input.startDate,
      endDate: input.endDate,
    });
    await tx.insert(engagementMembers).values({
      organisationId: context.organisationId,
      engagementId: id,
      userId: context.userId,
      role: "engagement_manager",
    });
    await tx.insert(auditEvents).values({
      organisationId: context.organisationId,
      actorId: context.userId,
      action: "engagement.created",
      targetType: "engagement",
      targetId: id,
      metadata: { reference, type: input.type },
    });
  });
  redirect(`/engagements/${id}`);
}
