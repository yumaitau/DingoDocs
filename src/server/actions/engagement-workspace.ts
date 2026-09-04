"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/permissions/require";
import { parseDateTimeInTimeZone } from "@/lib/time-zone";
import {
  acknowledgeRules,
  addScopeItem,
  approveRules,
  approveScopeVersion,
  assignEngagementMember,
  createAsset,
  createRulesVersion,
  createScopeDraft,
  createTimelineEntry,
  createWorkspaceNote,
  createWorkspaceTask,
  logWorkspaceTime,
  transitionEngagement,
  updateScopeItem,
} from "@/server/services/engagement-workspace";

const id = z.string().uuid();
const text = z.string().trim().min(1).max(10_000);
const optionalText = z.string().trim().max(10_000).optional();

function list(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function refresh(engagementId: string) {
  revalidatePath(`/engagements/${engagementId}`);
}

export async function createScopeDraftAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("scope:manage", { engagementId });
  const input = z
    .object({ changeSummary: z.string().trim().min(3).max(500) })
    .parse(Object.fromEntries(formData));
  await createScopeDraft(context, { engagementId, ...input });
  refresh(engagementId);
}

export async function addScopeItemAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("scope:manage", { engagementId });
  const input = z
    .object({
      scopeVersionId: id,
      name: z.string().trim().min(2).max(160),
      type: z.string().trim().min(2).max(80),
      value: z.string().trim().min(1).max(2_000),
      environment: z.string().trim().max(80).optional(),
      scopeStatus: z.enum(["in_scope", "excluded"]),
      exclusionReason: optionalText,
      testingRestrictions: optionalText,
      approvedMethods: z.string().optional(),
    })
    .parse(Object.fromEntries(formData));
  await addScopeItem(context, {
    engagementId,
    ...input,
    approvedMethods: list(input.approvedMethods ?? ""),
  });
  refresh(engagementId);
}

export async function approveScopeVersionAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("scope:manage", { engagementId });
  const { scopeVersionId } = z
    .object({ scopeVersionId: id })
    .parse(Object.fromEntries(formData));
  await approveScopeVersion(context, { engagementId, scopeVersionId });
  refresh(engagementId);
}

export async function updateScopeItemAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("scope:manage", { engagementId });
  const input = z
    .object({
      scopeVersionId: id,
      itemId: id,
      name: z.string().trim().min(2).max(160),
      value: z.string().trim().min(1).max(2_000),
      scopeStatus: z.enum(["in_scope", "excluded"]),
      exclusionReason: optionalText,
      testingRestrictions: optionalText,
    })
    .parse(Object.fromEntries(formData));
  await updateScopeItem(context, { engagementId, ...input });
  refresh(engagementId);
}

export async function createAssetAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("scope:manage", { engagementId });
  const input = z
    .object({
      name: z.string().trim().min(2).max(160),
      type: z.string().trim().min(2).max(80),
      identifier: z.string().trim().min(1).max(2_000),
      environment: z.string().trim().max(80).optional(),
      owner: z.string().trim().max(160).optional(),
      criticality: z.string().trim().max(40).optional(),
    })
    .parse(Object.fromEntries(formData));
  await createAsset(context, {
    engagementId,
    ...input,
    scopeItemIds: formData.getAll("scopeItemIds").map(String),
  });
  refresh(engagementId);
}

export async function createRulesVersionAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("scope:manage", { engagementId });
  const input = z
    .object({
      permittedTestTimes: optionalText,
      sourceIpAddresses: z.string().optional(),
      approvedTooling: z.string().optional(),
      prohibitedTechniques: z.string().optional(),
      stopTestingProcedure: text,
      escalationProcedure: text,
      evidenceHandling: text,
      dataDestruction: text,
    })
    .parse(Object.fromEntries(formData));
  await createRulesVersion(context, {
    engagementId,
    ...input,
    sourceIpAddresses: list(input.sourceIpAddresses ?? ""),
    approvedTooling: list(input.approvedTooling ?? ""),
    prohibitedTechniques: list(input.prohibitedTechniques ?? ""),
  });
  refresh(engagementId);
}

export async function approveRulesAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("engagement:edit", { engagementId });
  const { rulesId } = z
    .object({ rulesId: id })
    .parse(Object.fromEntries(formData));
  await approveRules(context, { engagementId, rulesId });
  refresh(engagementId);
}

export async function acknowledgeRulesAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("scope:manage", { engagementId });
  const { rulesId } = z
    .object({ rulesId: id })
    .parse(Object.fromEntries(formData));
  await acknowledgeRules(context, { engagementId, rulesId });
  refresh(engagementId);
}

export async function assignEngagementMemberAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("engagement:manage_members", {
    engagementId,
  });
  const input = z
    .object({
      userId: id,
      role: z.enum([
        "engagement_manager",
        "lead_consultant",
        "consultant",
        "reviewer",
        "read_only",
      ]),
    })
    .parse(Object.fromEntries(formData));
  await assignEngagementMember(context, { engagementId, ...input });
  refresh(engagementId);
}

export async function createWorkspaceNoteAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("scope:manage", { engagementId });
  const input = z
    .object({
      title: z.string().trim().min(2).max(200),
      body: text,
      kind: z.enum(["note", "testing_journal"]),
      visibility: z.enum(["private", "team", "client"]),
    })
    .parse(Object.fromEntries(formData));
  await createWorkspaceNote(context, {
    engagementId,
    ...input,
    assetIds: formData.getAll("assetIds").map(String),
  });
  refresh(engagementId);
}

export async function createTimelineEntryAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("scope:manage", { engagementId });
  const input = z
    .object({
      occurredAt: z.string().datetime({ local: true }),
      phase: z.string().trim().min(2).max(80),
      description: text,
      commands: optionalText,
      clientVisible: z.string().optional(),
    })
    .parse(Object.fromEntries(formData));
  await createTimelineEntry(context, {
    engagementId,
    ...input,
    occurredAt: parseDateTimeInTimeZone(input.occurredAt, context.timeZone),
    clientVisible: input.clientVisible === "on",
  });
  refresh(engagementId);
}

export async function createWorkspaceTaskAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("scope:manage", { engagementId });
  const input = z
    .object({
      title: z.string().trim().min(2).max(200),
      description: optionalText,
      priority: z.enum(["low", "normal", "high", "urgent"]),
      assigneeId: z.union([id, z.literal("")]).optional(),
      dueAt: z.string().optional(),
    })
    .parse(Object.fromEntries(formData));
  await createWorkspaceTask(context, {
    engagementId,
    ...input,
    assigneeId: input.assigneeId || undefined,
    dueAt: input.dueAt
      ? parseDateTimeInTimeZone(input.dueAt, context.timeZone)
      : undefined,
    assetIds: formData.getAll("assetIds").map(String),
  });
  refresh(engagementId);
}

export async function logWorkspaceTimeAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("scope:manage", { engagementId });
  const input = z
    .object({
      category: z.string().trim().min(2).max(80),
      hours: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/),
      description: optionalText,
      startedAt: z.string().datetime({ local: true }),
      billable: z.string().optional(),
    })
    .parse(Object.fromEntries(formData));
  await logWorkspaceTime(context, {
    engagementId,
    ...input,
    startedAt: parseDateTimeInTimeZone(input.startedAt, context.timeZone),
    billable: input.billable === "on",
  });
  refresh(engagementId);
}

export async function transitionEngagementAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("engagement:edit", { engagementId });
  const input = z
    .object({
      toStatus: z.enum([
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
      ]),
      reason: z.string().trim().max(500).optional(),
    })
    .parse(Object.fromEntries(formData));
  await transitionEngagement(context, { engagementId, ...input });
  refresh(engagementId);
}
