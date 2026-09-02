"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { evidenceFindings } from "@/db/schema";
import { type Role } from "@/lib/permissions/matrix";
import {
  requireOrganisationContext,
  requirePermission,
} from "@/lib/permissions/require";
import { parseDateTimeInTimeZone } from "@/lib/time-zone";
import {
  addPortalComment,
  addRetestNote,
  approvePortalReport,
  attachRetestEvidence,
  completeRetest,
  getPortalEngagement,
  grantPortalAccess,
  requestRetest,
  revokePortalAccess,
  scheduleRetest,
  setFindingPortalVisibility,
  setReportPortalVisibility,
  submitRemediationUpdate,
} from "@/server/services/client-portal";
import {
  scopedEvidenceActor,
  uploadEvidence,
} from "@/server/services/evidence";

const id = z.string().uuid();
const text = z.string().trim().min(1).max(5_000);

async function requireClientActor() {
  const context = await requireOrganisationContext();
  if (!["client_user", "client_administrator"].includes(context.role)) {
    throw new Error("Client portal access is required");
  }
  return context;
}

export async function addPortalCommentAction(
  engagementId: string,
  targetType: "finding" | "report",
  targetId: string,
  formData: FormData,
) {
  const actor = await requireClientActor();
  await addPortalComment(actor, {
    targetType,
    targetId: id.parse(targetId),
    body: text.parse(formData.get("body")),
  });
  revalidatePath(`/portal/engagements/${id.parse(engagementId)}`);
}

export async function submitRemediationAction(
  engagementId: string,
  findingId: string,
  formData: FormData,
) {
  const actor = await requireClientActor();
  await submitRemediationUpdate(actor, {
    findingId: id.parse(findingId),
    status: z
      .enum([
        "open",
        "in_progress",
        "remediated",
        "partially_remediated",
        "not_remediated",
        "risk_accepted",
      ])
      .parse(formData.get("status")),
    owner: z
      .string()
      .trim()
      .max(200)
      .optional()
      .parse(formData.get("owner") || undefined),
    note: z
      .string()
      .trim()
      .max(5_000)
      .optional()
      .parse(formData.get("note") || undefined),
  });
  revalidatePath(`/portal/engagements/${id.parse(engagementId)}`);
}

export async function requestRetestAction(
  engagementId: string,
  findingId: string,
  formData: FormData,
) {
  const actor = await requireClientActor();
  await requestRetest(
    actor,
    id.parse(findingId),
    z
      .string()
      .trim()
      .max(5_000)
      .optional()
      .parse(formData.get("note") || undefined),
  );
  revalidatePath(`/portal/engagements/${id.parse(engagementId)}`);
}

export async function approvePortalReportAction(
  engagementId: string,
  reportId: string,
) {
  const actor = await requireClientActor();
  await approvePortalReport(actor, id.parse(reportId));
  revalidatePath(`/portal/engagements/${id.parse(engagementId)}`);
}

export async function uploadRemediationEvidenceAction(
  engagementId: string,
  findingId: string,
  formData: FormData,
) {
  const context = await requireClientActor();
  const parsedEngagementId = id.parse(engagementId);
  const parsedFindingId = id.parse(findingId);
  const portal = await getPortalEngagement(context, parsedEngagementId);
  if (!portal.findings.some((finding) => finding.id === parsedFindingId)) {
    throw new Error("The requested portal resource was not found");
  }
  const file = z.instanceof(File).parse(formData.get("file"));
  const actor = await scopedEvidenceActor({
    organisationId: context.organisationId,
    userId: context.userId,
    roles: [context.role as Role],
  });
  const uploaded = await uploadEvidence(actor, {
    engagementId: parsedEngagementId,
    filename: file.name,
    mediaType: file.type || "application/octet-stream",
    bytes: new Uint8Array(await file.arrayBuffer()),
    classification: "client_visible",
  });
  await db.insert(evidenceFindings).values({
    organisationId: context.organisationId,
    evidenceId: uploaded.id,
    findingId: parsedFindingId,
  });
  revalidatePath(`/portal/engagements/${parsedEngagementId}`);
}

export async function scheduleRetestAction(formData: FormData) {
  const context = await requirePermission("finding:approve");
  const scheduledFor = z.string().parse(formData.get("scheduledFor"));
  await scheduleRetest(context, {
    attemptId: id.parse(formData.get("attemptId")),
    assignedTo: id.parse(formData.get("assignedTo")),
    scheduledFor: parseDateTimeInTimeZone(scheduledFor, context.timeZone),
  });
  revalidatePath(`/engagements/${id.parse(formData.get("engagementId"))}`);
}

export async function addRetestNoteAction(formData: FormData) {
  const context = await requirePermission("finding:approve");
  await addRetestNote(context, {
    attemptId: id.parse(formData.get("attemptId")),
    body: text.parse(formData.get("body")),
    visibility: z
      .enum(["internal", "client"])
      .parse(formData.get("visibility")),
  });
  revalidatePath(`/engagements/${id.parse(formData.get("engagementId"))}`);
}

export async function attachRetestEvidenceAction(formData: FormData) {
  const context = await requirePermission("finding:approve");
  await attachRetestEvidence(context, {
    attemptId: id.parse(formData.get("attemptId")),
    evidenceId: id.parse(formData.get("evidenceId")),
  });
  revalidatePath(`/engagements/${id.parse(formData.get("engagementId"))}`);
}

export async function completeRetestAction(formData: FormData) {
  const context = await requirePermission("finding:approve");
  await completeRetest(context, {
    attemptId: id.parse(formData.get("attemptId")),
    outcome: z
      .enum([
        "fixed",
        "partially_remediated",
        "not_remediated",
        "risk_accepted",
        "unable_to_verify",
      ])
      .parse(formData.get("outcome")),
    notes: z
      .string()
      .trim()
      .max(5_000)
      .optional()
      .parse(formData.get("notes") || undefined),
    comparison: {
      summary: text.parse(formData.get("comparison")),
    },
  });
  revalidatePath(`/engagements/${id.parse(formData.get("engagementId"))}`);
}

export async function grantPortalAccessAction(
  engagementId: string,
  formData: FormData,
) {
  const context = await requirePermission("client:manage", { engagementId });
  await grantPortalAccess(context, {
    engagementId: id.parse(engagementId),
    contactId: id.parse(formData.get("contactId")),
    accessLevel: z
      .enum(["standard", "administrator", "read_only"])
      .parse(formData.get("accessLevel")),
  });
  revalidatePath(`/engagements/${engagementId}`);
}

export async function revokePortalAccessAction(
  engagementId: string,
  grantId: string,
) {
  const context = await requirePermission("client:manage", { engagementId });
  await revokePortalAccess(context, {
    engagementId: id.parse(engagementId),
    grantId: id.parse(grantId),
  });
  revalidatePath(`/engagements/${id.parse(engagementId)}`);
}

export async function setFindingPortalVisibilityAction(
  engagementId: string,
  findingId: string,
  formData: FormData,
) {
  const context = await requirePermission("finding:approve", { engagementId });
  await setFindingPortalVisibility(context, {
    engagementId: id.parse(engagementId),
    findingId: id.parse(findingId),
    visible: formData.get("visible") === "true",
  });
  revalidatePath(`/engagements/${engagementId}`);
}

export async function setReportPortalVisibilityAction(
  engagementId: string,
  reportVersionId: string,
  formData: FormData,
) {
  const context = await requirePermission("finding:approve", { engagementId });
  await setReportPortalVisibility(context, {
    engagementId: id.parse(engagementId),
    reportVersionId: id.parse(reportVersionId),
    visible: formData.get("visible") === "true",
  });
  revalidatePath(`/engagements/${engagementId}`);
}
