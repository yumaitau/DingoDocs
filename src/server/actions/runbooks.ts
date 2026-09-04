"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/permissions/require";
import {
  applyRunbookTemplate,
  createRunbookTemplate,
  publishRunbookTemplate,
  updateEngagementRunbookStep,
} from "@/server/services/runbooks";

const id = z.string().uuid();
const optionalId = z.preprocess(
  (value) => (value === "" || value == null ? null : value),
  z.string().uuid().nullable(),
);

function list(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function createRunbookTemplateAction(formData: FormData) {
  const context = await requirePermission("template:manage");
  const input = z
    .object({
      name: z.string().trim().min(3).max(160),
      description: z.string().trim().max(2_000).optional(),
      assessmentTypes: z.string().optional(),
      tags: z.string().optional(),
    })
    .parse(Object.fromEntries(formData));
  const titles = formData
    .getAll("stepTitle")
    .map((value) => String(value).trim());
  const objectives = formData
    .getAll("stepObjective")
    .map((value) => String(value).trim());
  const procedures = formData
    .getAll("stepProcedure")
    .map((value) => String(value).trim());
  const expectedEvidence = formData
    .getAll("stepExpectedEvidence")
    .map((value) => String(value).trim());
  const steps = titles
    .map((title, index) => ({
      title,
      objective: objectives[index],
      procedure: procedures[index] ?? "",
      expectedEvidence: expectedEvidence[index],
    }))
    .filter((step) => step.title || step.procedure);
  z.array(
    z.object({
      title: z.string().min(2).max(160),
      objective: z.string().max(1_000).optional(),
      procedure: z.string().min(3).max(10_000),
      expectedEvidence: z.string().max(1_000).optional(),
    }),
  )
    .min(1)
    .max(50)
    .parse(steps);
  await createRunbookTemplate(context, {
    ...input,
    assessmentTypes: list(input.assessmentTypes ?? ""),
    tags: list(input.tags ?? ""),
    steps,
  });
  revalidatePath("/runbooks");
}

export async function publishRunbookTemplateAction(formData: FormData) {
  const context = await requirePermission("template:manage");
  const { templateId } = z
    .object({ templateId: id })
    .parse(Object.fromEntries(formData));
  await publishRunbookTemplate(context, templateId);
  revalidatePath("/runbooks");
}

export async function applyRunbookTemplateAction(
  engagementId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  const context = await requirePermission("engagement:edit", { engagementId });
  const { templateId } = z
    .object({ templateId: id })
    .parse(Object.fromEntries(formData));
  await applyRunbookTemplate(context, { engagementId, templateId });
  revalidatePath(`/engagements/${engagementId}`);
}

export async function updateEngagementRunbookStepAction(
  engagementId: string,
  stepId: string,
  formData: FormData,
) {
  id.parse(engagementId);
  id.parse(stepId);
  const context = await requirePermission("scope:manage", { engagementId });
  const input = z
    .object({
      status: z.enum([
        "not_started",
        "in_progress",
        "completed",
        "blocked",
        "not_applicable",
      ]),
      notes: z.string().trim().max(10_000).optional(),
      findingId: optionalId,
      evidenceId: optionalId,
      taskId: optionalId,
    })
    .parse(Object.fromEntries(formData));
  await updateEngagementRunbookStep(context, {
    engagementId,
    stepId,
    ...input,
  });
  revalidatePath(`/engagements/${engagementId}`);
}
