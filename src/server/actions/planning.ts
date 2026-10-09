"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { db } from "@/db";
import {
  clients,
  engagementMembers,
  engagements,
  opportunities,
  programs,
  savedViews,
  severityEnum,
  slaPolicies,
  taskStatusEnum,
  tasks,
} from "@/db/schema";
import {
  requireOrganisationContext,
  requirePermission,
} from "@/lib/permissions/require";

const id = z.string().uuid();
const recurrenceValues = ["weekly", "monthly", "quarterly", ""] as const;
const opportunityStages = [
  "lead",
  "scoped",
  "proposal",
  "won",
  "lost",
] as const;
const savedViewResources = ["tasks", "analytics"] as const;

function addPeriod(
  isoDate: string,
  recurrence: "weekly" | "monthly" | "quarterly",
) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (recurrence === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else if (recurrence === "monthly") date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCMonth(date.getUTCMonth() + 3);
  return date.toISOString().slice(0, 10);
}

export async function updateTaskStatusAction(formData: FormData) {
  const context = await requireOrganisationContext();
  const input = z
    .object({
      taskId: id,
      status: z.enum(taskStatusEnum.enumValues),
    })
    .parse({
      taskId: formData.get("taskId"),
      status: formData.get("status"),
    });
  await db
    .update(tasks)
    .set({ status: input.status, updatedAt: new Date() })
    .where(
      and(
        eq(tasks.id, input.taskId),
        eq(tasks.organisationId, context.organisationId),
      ),
    );
  revalidatePath("/tasks");
}

export async function setEngagementRecurrenceAction(formData: FormData) {
  const context = await requirePermission("engagement:edit");
  const input = z
    .object({
      engagementId: id,
      recurrence: z.enum(recurrenceValues),
    })
    .parse(Object.fromEntries(formData));
  await db
    .update(engagements)
    .set({
      recurrence: input.recurrence || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(engagements.id, input.engagementId),
        eq(engagements.organisationId, context.organisationId),
        isNull(engagements.deletedAt),
      ),
    );
  revalidatePath("/schedule");
}

export async function createNextOccurrenceAction(formData: FormData) {
  const context = await requirePermission("engagement:create");
  const input = z
    .object({
      engagementId: id,
    })
    .parse(Object.fromEntries(formData));
  const [source] = await db
    .select()
    .from(engagements)
    .where(
      and(
        eq(engagements.id, input.engagementId),
        eq(engagements.organisationId, context.organisationId),
        isNull(engagements.deletedAt),
      ),
    )
    .limit(1);
  if (!source) throw new Error("Engagement not found");
  const recurrence = source.recurrence;
  if (
    recurrence !== "weekly" &&
    recurrence !== "monthly" &&
    recurrence !== "quarterly"
  ) {
    throw new Error("Engagement has no recurrence");
  }
  if (!source.startDate || !source.endDate)
    throw new Error("Engagement needs start and end dates");

  const startDate = addPeriod(source.startDate, recurrence);
  const endDate = addPeriod(source.endDate, recurrence);
  const newId = uuidv7();
  const reference = `ENG-${new Date().getFullYear()}-${newId.slice(0, 6).toUpperCase()}`;
  await db.transaction(async (tx) => {
    await tx.insert(engagements).values({
      id: newId,
      organisationId: context.organisationId,
      clientId: source.clientId,
      name: source.name,
      reference,
      type: source.type,
      status: "proposed",
      startDate,
      endDate,
      reportingDeadline: source.reportingDeadline
        ? addPeriod(source.reportingDeadline, recurrence)
        : null,
      objectives: source.objectives,
      assumptions: source.assumptions,
      constraints: source.constraints,
      dependencies: source.dependencies,
      securityClassification: source.securityClassification,
      tags: source.tags,
      programId: source.programId,
      recurrence: source.recurrence,
    });
    await tx.insert(engagementMembers).values({
      organisationId: context.organisationId,
      engagementId: newId,
      userId: context.userId,
      role: "engagement_manager",
    });
  });
  revalidatePath("/schedule");
  revalidatePath("/engagements");
}

export async function createProgramAction(formData: FormData) {
  const context = await requirePermission("engagement:create");
  const input = z
    .object({
      name: z.string().trim().min(2).max(160),
      clientId: id,
      year: z.string().optional(),
    })
    .parse(Object.fromEntries(formData));
  const year =
    input.year && input.year.length
      ? z.coerce.number().int().min(2000).max(2100).parse(input.year)
      : null;
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
  if (!client) throw new Error("Client not found");
  await db.insert(programs).values({
    organisationId: context.organisationId,
    clientId: input.clientId,
    name: input.name,
    year,
  });
  revalidatePath("/programs");
}

export async function assignEngagementProgramAction(formData: FormData) {
  const context = await requirePermission("engagement:edit");
  const input = z
    .object({
      engagementId: id,
      programId: z.union([id, z.literal("")]),
    })
    .parse(Object.fromEntries(formData));
  if (input.programId) {
    const [program] = await db
      .select({ id: programs.id })
      .from(programs)
      .where(
        and(
          eq(programs.id, input.programId),
          eq(programs.organisationId, context.organisationId),
          isNull(programs.deletedAt),
        ),
      )
      .limit(1);
    if (!program) throw new Error("Program not found");
  }
  await db
    .update(engagements)
    .set({
      programId: input.programId || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(engagements.id, input.engagementId),
        eq(engagements.organisationId, context.organisationId),
        isNull(engagements.deletedAt),
      ),
    );
  revalidatePath("/programs");
  revalidatePath("/schedule");
}

export async function createOpportunityAction(formData: FormData) {
  const context = await requirePermission("engagement:create");
  const input = z
    .object({
      name: z.string().trim().min(2).max(160),
      clientId: z.union([id, z.literal("")]).optional(),
      stage: z.enum(opportunityStages),
      value: z.string().trim().max(80).optional(),
      sowTemplate: z.string().trim().max(20_000).optional(),
    })
    .parse(Object.fromEntries(formData));
  if (input.clientId) {
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
    if (!client) throw new Error("Client not found");
  }
  await db.insert(opportunities).values({
    organisationId: context.organisationId,
    clientId: input.clientId || null,
    name: input.name,
    stage: input.stage,
    value: input.value || null,
    sowTemplate: input.sowTemplate || null,
  });
  revalidatePath("/opportunities");
}

export async function saveViewAction(formData: FormData) {
  const context = await requireOrganisationContext();
  const input = z
    .object({
      name: z.string().trim().min(1).max(120),
      resource: z.enum(savedViewResources),
      filtersJson: z.string().min(2).max(8_000),
    })
    .parse(Object.fromEntries(formData));
  const parsed = JSON.parse(input.filtersJson) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Filters must be a JSON object");
  await db.insert(savedViews).values({
    organisationId: context.organisationId,
    userId: context.userId,
    name: input.name,
    resource: input.resource,
    filters: parsed,
  });
  revalidatePath(input.resource === "tasks" ? "/tasks" : "/analytics");
}

export async function upsertSlaPolicyAction(formData: FormData) {
  const context = await requirePermission("client:manage");
  const input = z
    .object({
      severity: z.enum(severityEnum.enumValues),
      days: z.coerce.number().int().min(1).max(3650),
      clientId: z.string().uuid().or(z.literal("")).optional(),
    })
    .parse({
      severity: formData.get("severity"),
      days: formData.get("days"),
      clientId: formData.get("clientId") || "",
    });
  const clientId = input.clientId || null;
  if (clientId) {
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.organisationId, context.organisationId),
          isNull(clients.deletedAt),
        ),
      )
      .limit(1);
    if (!client) throw new Error("Client not found");
  }
  const [existing] = await db
    .select({ id: slaPolicies.id })
    .from(slaPolicies)
    .where(
      and(
        eq(slaPolicies.organisationId, context.organisationId),
        eq(slaPolicies.severity, input.severity),
        clientId
          ? eq(slaPolicies.clientId, clientId)
          : isNull(slaPolicies.clientId),
      ),
    )
    .limit(1);
  if (existing) {
    await db
      .update(slaPolicies)
      .set({ days: input.days })
      .where(eq(slaPolicies.id, existing.id));
  } else {
    await db.insert(slaPolicies).values({
      organisationId: context.organisationId,
      clientId,
      severity: input.severity,
      days: input.days,
    });
  }
  revalidatePath("/analytics");
}

export async function listSlaPolicies() {
  const context = await requireOrganisationContext();
  return db
    .select({
      id: slaPolicies.id,
      severity: slaPolicies.severity,
      days: slaPolicies.days,
      clientId: slaPolicies.clientId,
      clientName: clients.name,
    })
    .from(slaPolicies)
    .leftJoin(clients, eq(clients.id, slaPolicies.clientId))
    .where(eq(slaPolicies.organisationId, context.organisationId))
    .orderBy(asc(slaPolicies.severity), asc(clients.name));
}

export async function listViews(resource: "tasks" | "analytics") {
  const context = await requireOrganisationContext();
  return db
    .select({
      id: savedViews.id,
      name: savedViews.name,
      filters: savedViews.filters,
      createdAt: savedViews.createdAt,
    })
    .from(savedViews)
    .where(
      and(
        eq(savedViews.organisationId, context.organisationId),
        eq(savedViews.userId, context.userId),
        eq(savedViews.resource, resource),
      ),
    )
    .orderBy(asc(savedViews.name));
}
