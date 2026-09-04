"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/permissions/require";
import {
  addFindingComment,
  assertFindingEngagement,
  createFindingFromTemplate,
  createFindingTemplate,
  createRiskMatrix,
  linkFindingEvidence,
  reviseFindingTemplate,
  transitionFinding,
  transitionTemplateReview,
  updateFindingFromLatestTemplate,
  updateFindingNarrative,
} from "@/server/services/findings";

const id = z.string().uuid();
const optionalText = z.string().trim().max(20_000).optional();
const requiredText = z.string().trim().min(1).max(20_000);
const severity = z.enum(["informational", "low", "medium", "high", "critical"]);
const findingStatus = z.enum([
  "draft",
  "in_progress",
  "ready_for_review",
  "changes_requested",
  "peer_reviewed",
  "qa_approved",
  "published",
  "remediation_in_progress",
  "ready_for_retest",
  "retested",
  "resolved",
  "risk_accepted",
  "closed",
]);

function list(value: FormDataEntryValue | null | undefined) {
  return String(value ?? "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mappings(value: FormDataEntryValue | null | undefined) {
  return String(value ?? "")
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [framework, reference, title] = entry
        .split("|")
        .map((part) => part.trim());
      if (!framework || !reference)
        throw new Error(
          "Mappings must use Framework | Reference | Optional title",
        );
      return { framework, reference, title: title || undefined };
    });
}

function refreshEngagement(engagementId: string) {
  revalidatePath(`/engagements/${engagementId}`);
}

const templateInput = z.object({
  stableKey: z.string().trim().max(120).optional(),
  title: z.string().trim().min(2).max(240),
  summary: requiredText,
  executiveDescription: optionalText,
  technicalDescription: requiredText,
  businessImpact: optionalText,
  technicalImpact: optionalText,
  likelihood: z.string().trim().max(120).optional(),
  severity,
  riskRationale: optionalText,
  remediation: requiredText,
  verificationSteps: optionalText,
});

export async function createFindingTemplateAction(formData: FormData) {
  const context = await requirePermission("template:manage");
  const input = templateInput.parse(Object.fromEntries(formData));
  await createFindingTemplate(context, {
    ...input,
    references: list(formData.get("references")),
    tags: list(formData.get("tags")),
    assessmentTypes: list(formData.get("assessmentTypes")),
    mappings: mappings(formData.get("mappings")),
  });
  revalidatePath("/findings-library");
}

export async function reviseFindingTemplateAction(
  templateId: string,
  formData: FormData,
) {
  id.parse(templateId);
  const context = await requirePermission("template:manage");
  const input = templateInput
    .omit({ stableKey: true })
    .parse(Object.fromEntries(formData));
  await reviseFindingTemplate(context, templateId, {
    ...input,
    references: list(formData.get("references")),
    tags: list(formData.get("tags")),
    assessmentTypes: list(formData.get("assessmentTypes")),
    mappings: mappings(formData.get("mappings")),
  });
  revalidatePath("/findings-library");
}

export async function transitionTemplateReviewAction(
  templateId: string,
  formData: FormData,
) {
  id.parse(templateId);
  const context = await requirePermission("template:manage");
  const input = z
    .object({
      toStatus: z.enum(["in_review", "changes_requested", "approved"]),
      reason: z.string().trim().max(2_000).optional(),
    })
    .parse(Object.fromEntries(formData));
  await transitionTemplateReview(context, { templateId, ...input });
  revalidatePath("/findings-library");
}

export async function createEngagementFindingAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("finding:create", { engagementId });
  const input = z
    .object({ templateId: id, identifier: z.string().trim().min(1).max(80) })
    .parse(Object.fromEntries(formData));
  await createFindingFromTemplate(context, {
    engagementId,
    ...input,
    assetIds: formData.getAll("assetIds").map(String),
  });
  refreshEngagement(engagementId);
}

export async function updateFindingNarrativeAction(
  engagementId: string,
  findingId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  id.parse(findingId);
  const context = await requirePermission("finding:create", { engagementId });
  await assertFindingEngagement(
    context.organisationId,
    engagementId,
    findingId,
  );
  const input = z
    .object({
      title: z.string().trim().min(2).max(240),
      severity,
      likelihood: optionalText,
      impact: optionalText,
      cvssVector: z.string().trim().max(180).optional(),
      cvssScore: z
        .union([z.string().regex(/^\d{1,2}(\.\d)?$/), z.literal("")])
        .optional(),
      executiveSummary: optionalText,
      technicalDetail: optionalText,
      reproductionSteps: optionalText,
      proofOfConcept: optionalText,
      businessImpact: optionalText,
      technicalImpact: optionalText,
      remediation: optionalText,
      verificationGuidance: optionalText,
      clientOwner: z.string().trim().max(240).optional(),
      dueAt: z.string().optional(),
      changeSummary: z.string().trim().min(3).max(500),
    })
    .parse(Object.fromEntries(formData));
  await updateFindingNarrative(context, {
    findingId,
    ...input,
    cvssScore: input.cvssScore || undefined,
    dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
    references: list(formData.get("references")),
    mappings: mappings(formData.get("mappings")),
  });
  refreshEngagement(engagementId);
}

export async function transitionFindingAction(
  engagementId: string,
  findingId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  id.parse(findingId);
  const input = z
    .object({
      toStatus: findingStatus,
      comment: z.string().trim().max(4_000).optional(),
      override: z.string().optional(),
      overrideReason: z.string().trim().max(2_000).optional(),
    })
    .parse(Object.fromEntries(formData));
  const approvalStatuses = new Set([
    "changes_requested",
    "peer_reviewed",
    "qa_approved",
    "published",
  ]);
  const permission =
    input.override === "on" || approvalStatuses.has(input.toStatus)
      ? "finding:approve"
      : "finding:create";
  const context = await requirePermission(permission, { engagementId });
  await assertFindingEngagement(
    context.organisationId,
    engagementId,
    findingId,
  );
  await transitionFinding(context, {
    findingId,
    toStatus: input.toStatus,
    comment: input.comment,
    canOverride: input.override === "on" && permission === "finding:approve",
    overrideReason: input.overrideReason,
  });
  refreshEngagement(engagementId);
}

export async function addFindingCommentAction(
  engagementId: string,
  findingId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  id.parse(findingId);
  const context = await requirePermission("finding:create", { engagementId });
  await assertFindingEngagement(
    context.organisationId,
    engagementId,
    findingId,
  );
  const input = z
    .object({
      body: requiredText,
      visibility: z.enum(["private", "team", "client"]),
    })
    .parse(Object.fromEntries(formData));
  await addFindingComment(context, { findingId, ...input });
  refreshEngagement(engagementId);
}

export async function linkFindingEvidenceAction(
  engagementId: string,
  findingId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  id.parse(findingId);
  const context = await requirePermission("finding:create", { engagementId });
  await assertFindingEngagement(
    context.organisationId,
    engagementId,
    findingId,
  );
  await linkFindingEvidence(context, {
    findingId,
    evidenceIds: formData.getAll("evidenceIds").map(String),
  });
  refreshEngagement(engagementId);
}

export async function updateFindingFromTemplateAction(
  engagementId: string,
  findingId: string,
) {
  id.parse(engagementId);
  id.parse(findingId);
  const context = await requirePermission("finding:create", { engagementId });
  await assertFindingEngagement(
    context.organisationId,
    engagementId,
    findingId,
  );
  await updateFindingFromLatestTemplate(context, findingId);
  refreshEngagement(engagementId);
}

export async function createRiskMatrixAction(formData: FormData) {
  const context = await requirePermission("template:manage");
  const input = z
    .object({
      name: z.string().trim().min(2).max(160),
      clientId: z.union([id, z.literal("")]).optional(),
      definition: z.string().min(2).max(100_000),
      isDefault: z.string().optional(),
    })
    .parse(Object.fromEntries(formData));
  await createRiskMatrix(context, {
    name: input.name,
    clientId: input.clientId || undefined,
    definition: JSON.parse(input.definition) as Parameters<
      typeof createRiskMatrix
    >[1]["definition"],
    isDefault: input.isDefault === "on",
  });
  revalidatePath("/findings-library");
}
