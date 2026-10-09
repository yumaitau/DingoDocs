"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { db } from "@/db";
import { auditEvents, clients } from "@/db/schema";
import { positiveDays } from "@/lib/clients/policy";
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

const dayField = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? positiveDays(value) : undefined));

export async function saveClientDefaults(formData: FormData) {
  const context = await requirePermission("client:manage");
  const input = z
    .object({
      clientId: z.string().uuid(),
      pageSize: z.enum(["", "A4", "LETTER"]),
      redactionTerms: z.string().trim().max(4_000),
      evidenceDays: dayField,
      findingDays: dayField,
      reportDays: dayField,
      engagementDays: dayField,
    })
    .parse({
      clientId: formData.get("clientId"),
      pageSize: formData.get("pageSize") || "",
      redactionTerms: formData.get("redactionTerms") || "",
      evidenceDays: formData.get("evidenceDays") || "",
      findingDays: formData.get("findingDays") || "",
      reportDays: formData.get("reportDays") || "",
      engagementDays: formData.get("engagementDays") || "",
    });
  const [client] = await db
    .select({
      reportPreferences: clients.reportPreferences,
      retentionPolicy: clients.retentionPolicy,
    })
    .from(clients)
    .where(
      and(
        eq(clients.id, input.clientId),
        eq(clients.organisationId, context.organisationId),
        isNull(clients.deletedAt),
      ),
    )
    .limit(1);
  if (!client) throw new Error("Client not found");
  const reportPreferences = {
    ...(client.reportPreferences ?? {}),
  } as Record<string, unknown>;
  if (input.pageSize) reportPreferences.pageSize = input.pageSize;
  else delete reportPreferences.pageSize;
  if (input.redactionTerms) reportPreferences.redactionTerms = input.redactionTerms;
  else delete reportPreferences.redactionTerms;
  const retentionPolicy = {
    ...(client.retentionPolicy ?? {}),
  } as Record<string, unknown>;
  for (const key of [
    "evidenceDays",
    "findingDays",
    "reportDays",
    "engagementDays",
  ] as const) {
    if (input[key] === undefined) delete retentionPolicy[key];
    else retentionPolicy[key] = input[key];
  }
  await db
    .update(clients)
    .set({ reportPreferences, retentionPolicy, updatedAt: new Date() })
    .where(eq(clients.id, input.clientId));
  revalidatePath(`/clients/${input.clientId}`);
}
