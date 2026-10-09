"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_LAYOUT_LENGTH } from "@/lib/reports/layout";
import type { ReportTemplateDefinition } from "@/db/schema";
import {
  requireInternalOrganisationContext,
  requirePermission,
} from "@/lib/permissions/require";
import {
  saveReportDraft,
  createReport,
  createReportRevision,
  createReportTemplate,
  getReportWorkspace,
  queueReportGeneration,
  refreshReportFindings,
  reportFormats,
  reportStatuses,
  reviseReportTemplate,
  transitionReport,
  type ReportKind,
} from "@/server/services/reports";

const id = z.string().uuid();

export async function createReportTemplateAction(formData: FormData) {
  const context = await requirePermission("template:manage");
  const input = z
    .object({
      name: z.string().trim().min(2).max(200),
      clientId: z.union([id, z.literal("")]).optional(),
      definition: z.string().min(2).max(MAX_LAYOUT_LENGTH),
      customCss: z.string().max(50_000).optional(),
    })
    .parse(Object.fromEntries(formData));
  const template = await createReportTemplate(context, {
    name: input.name,
    clientId: input.clientId || undefined,
    definition: JSON.parse(input.definition) as ReportTemplateDefinition,
    customCss: input.customCss,
  });
  revalidatePath("/templates");
  return { href: `/templates/${template!.id}` };
}

export async function reviseReportTemplateAction(
  templateId: string,
  formData: FormData,
) {
  id.parse(templateId);
  const context = await requirePermission("template:manage");
  const input = z
    .object({
      definition: z.string().min(2).max(MAX_LAYOUT_LENGTH),
      customCss: z.string().max(50_000).optional(),
    })
    .parse(Object.fromEntries(formData));
  const revision = await reviseReportTemplate(context, templateId, {
    definition: JSON.parse(input.definition) as ReportTemplateDefinition,
    customCss: input.customCss,
  });
  revalidatePath("/templates");
  return { href: `/templates/${revision!.id}` };
}

export async function createReportAction(formData: FormData) {
  const input = z
    .object({
      engagementId: id,
      templateId: id,
      title: z.string().trim().min(2).max(240),
      kind: z
        .enum([
          "assessment",
          "attestation",
          "remediation_letter",
          "retest",
          "zero_finding",
        ])
        .optional(),
    })
    .parse(Object.fromEntries(formData));
  const context = await requirePermission("finding:create", {
    engagementId: input.engagementId,
  });
  await createReport(context, {
    ...input,
    kind: input.kind as ReportKind | undefined,
  });
  revalidatePath("/reports");
}

export async function refreshReportFindingsAction(reportId: string) {
  id.parse(reportId);
  const organisation = await requireInternalOrganisationContext();
  const workspace = await getReportWorkspace(
    organisation.organisationId,
    reportId,
  );
  const context = await requirePermission("finding:create", {
    engagementId: workspace.report.engagementId,
  });
  await refreshReportFindings(context, reportId);
  revalidatePath(`/reports/${reportId}`);
  revalidatePath(`/reports/${reportId}/edit`);
}

export async function transitionReportAction(
  reportId: string,
  formData: FormData,
) {
  id.parse(reportId);
  const input = z
    .object({
      toStatus: z.enum(
        reportStatuses as [
          (typeof reportStatuses)[number],
          ...Array<(typeof reportStatuses)[number]>,
        ],
      ),
      comment: z.string().trim().max(4_000).optional(),
    })
    .parse(Object.fromEntries(formData));
  const organisation = await requireInternalOrganisationContext();
  const workspace = await getReportWorkspace(
    organisation.organisationId,
    reportId,
  );
  const permission = ["published", "archived"].includes(input.toStatus)
    ? "report:publish"
    : [
          "changes_requested",
          "qa_approved",
          "client_review",
          "approved",
        ].includes(input.toStatus)
      ? "finding:approve"
      : "finding:create";
  const context = await requirePermission(permission, {
    engagementId: workspace.report.engagementId,
  });
  await transitionReport(context, { reportId, ...input });
  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/reports");
}

export async function queueReportGenerationAction(
  reportId: string,
  formData: FormData,
) {
  id.parse(reportId);
  const organisation = await requireInternalOrganisationContext();
  const workspace = await getReportWorkspace(
    organisation.organisationId,
    reportId,
  );
  const context = await requirePermission("data:export", {
    engagementId: workspace.report.engagementId,
  });
  const formats = formData
    .getAll("formats")
    .map(String)
    .filter((format): format is (typeof reportFormats)[number] =>
      reportFormats.includes(format as (typeof reportFormats)[number]),
    );
  await queueReportGeneration(
    context,
    reportId,
    formats.length ? formats : [...reportFormats],
  );
  revalidatePath(`/reports/${reportId}`);
}

export async function createReportRevisionAction(reportId: string) {
  id.parse(reportId);
  const organisation = await requireInternalOrganisationContext();
  const workspace = await getReportWorkspace(
    organisation.organisationId,
    reportId,
  );
  const context = await requirePermission("report:publish", {
    engagementId: workspace.report.engagementId,
  });
  await createReportRevision(context, reportId);
  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/reports");
}

export async function saveReportDraftAction(
  reportId: string,
  formData: FormData,
) {
  id.parse(reportId);
  const organisation = await requireInternalOrganisationContext();
  const workspace = await getReportWorkspace(
    organisation.organisationId,
    reportId,
  );
  const context = await requirePermission("finding:create", {
    engagementId: workspace.report.engagementId,
  });
  const input = z
    .object({
      versionId: id,
      expectedRevision: z.string().max(100),
      definition: z.string().max(MAX_LAYOUT_LENGTH),
      customCss: z.string().max(50_000).optional(),
    })
    .parse(Object.fromEntries(formData));
  await saveReportDraft(context, reportId, {
    ...input,
    definition: JSON.parse(input.definition),
  });
  revalidatePath(`/reports/${reportId}`);
  revalidatePath(`/reports/${reportId}/edit`);
}
