"use server";

import { redirect } from "next/navigation";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, clients } from "@/db/schema";
import { requirePermission } from "@/lib/permissions/require";

const schema = z.object({
  name: z.string().trim().min(2).max(160),
  legalName: z.string().trim().max(200).optional(),
  industry: z.string().trim().max(100).optional(),
});

export async function createClient(formData: FormData) {
  const context = await requirePermission("client:manage");
  const input = schema.parse(Object.fromEntries(formData));
  const id = uuidv7();
  await db.transaction(async (tx) => {
    await tx.insert(clients).values({
      id,
      organisationId: context.organisationId,
      name: input.name,
      legalName: input.legalName || null,
      industry: input.industry || null,
    });
    await tx.insert(auditEvents).values({
      organisationId: context.organisationId,
      actorId: context.userId,
      action: "client.created",
      targetType: "client",
      targetId: id,
      metadata: { name: input.name },
    });
  });
  redirect(`/clients/${id}`);
}
