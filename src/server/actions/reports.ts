"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ReportTemplateDefinition } from "@/db/schema";
import {
  requireOrganisationContext,
  requirePermission,
} from "@/lib/permissions/require";
import {
  createReport,
  createReportRevision,
  createReportTemplate,
  getReportWorkspace,
  queueReportGeneration,
  reportFormats,
  reportStatuses,
  reviseReportTemplate,
  transitionReport,
} from "@/server/services/reports";

const id = z.string().uuid();
function values(formData: FormData) {
  return Object.fromEntries(formData);
}
function actor(context: Awaited<ReturnType<typeof requirePermission>>) {
  return { organisationId: context.organisationId, userId: context.userId };
}

export async function createReportTemplateAction(formData: FormData) {
  const context = await requirePermission("template:manage");
  const input = z
    .object({
      name: z.string().trim().min(2).max(200),
      clientId: z.union([id, z.literal("")]).optional(),
      definition: z.string().min(2).max(200_000),
      customCss: z.string().max(50_000).optional(),
    })
    .parse(values(formData));
  await createReportTemplate(actor(context), {
    name: input.name,
    clientId: input.clientId || undefined,
    definition: JSON.parse(input.definition) as ReportTemplateDefinition,
    customCss: input.customCss,
  });
  revalidatePath("/templates");
}

export async function reviseReportTemplateAction(
  templateId: string,
  formData: FormData,
) {
  id.parse(templateId);
  const context = await requirePermission("template:manage");
  const input = z
    .object({
      definition: z.string().min(2).max(200_000),
      customCss: z.string().max(50_000).optional(),
    })
    .parse(values(formData));
  await reviseReportTemplate(actor(context), templateId, {
    definition: JSON.parse(input.definition) as ReportTemplateDefinition,
    customCss: input.customCss,
  });
  revalidatePath("/templates");
}

export async function createReportAction(formData: FormData) {
  const input = z
    .object({
      engagementId: id,
      templateId: id,
      title: z.string().trim().min(2).max(240),
    })
    .parse(values(formData));
  const context = await requirePermission("finding:create", {
    engagementId: input.engagementId,
  });
  await createReport(actor(context), input);
  revalidatePath("/reports");
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
    .parse(values(formData));
  const organisation = await requireOrganisationContext();
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
  await transitionReport(actor(context), { reportId, ...input });
  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/reports");
}

export async function queueReportGenerationAction(
  reportId: string,
  formData: FormData,
) {
  id.parse(reportId);
  const organisation = await requireOrganisationContext();
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
    actor(context),
    reportId,
    formats.length ? formats : [...reportFormats],
  );
  revalidatePath(`/reports/${reportId}`);
}

export async function createReportRevisionAction(reportId: string) {
  id.parse(reportId);
  const organisation = await requireOrganisationContext();
  const workspace = await getReportWorkspace(
    organisation.organisationId,
    reportId,
  );
  const context = await requirePermission("report:publish", {
    engagementId: workspace.report.engagementId,
  });
  await createReportRevision(actor(context), reportId);
  revalidatePath(`/reports/${reportId}`);
  revalidatePath("/reports");
}
