"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiConfirmation } from "@/lib/integrations/constants";
import { requirePermission } from "@/lib/permissions/require";
import {
  findingAssistActions,
  requestFindingAssist,
} from "@/server/services/ai";
import {
  assertFindingEngagement,
  patchFindingNarrative,
} from "@/server/services/findings";

const id = z.string().uuid();

export type FindingAssistState = {
  draft?: string;
  field?: string | null;
  error?: string;
  message?: string;
};

export async function requestFindingAssistAction(
  _prev: FindingAssistState,
  formData: FormData,
): Promise<FindingAssistState> {
  try {
    const engagementId = id.parse(formData.get("engagementId"));
    const findingId = id.parse(formData.get("findingId"));
    const action = z.enum(findingAssistActions).parse(formData.get("action"));
    const confirmation = z
      .literal(aiConfirmation)
      .parse(formData.get("confirmation"));
    const context = await requirePermission("finding:create", { engagementId });
    await assertFindingEngagement(
      context.organisationId,
      engagementId,
      findingId,
    );
    const result = await requestFindingAssist(context, {
      findingId,
      action,
      confirmation,
    });
    return {
      draft: result.draft,
      field: result.field,
      message: "Untrusted draft generated. Review before accepting.",
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "AI assist failed",
    };
  }
}

export async function acceptFindingAssistAction(formData: FormData) {
  const engagementId = id.parse(formData.get("engagementId"));
  const findingId = id.parse(formData.get("findingId"));
  const field = z
    .enum([
      "remediation",
      "executiveSummary",
      "reproductionSteps",
      "technicalDetail",
    ])
    .parse(formData.get("field"));
  const draft = z
    .string()
    .trim()
    .min(1)
    .max(50_000)
    .parse(formData.get("draft"));
  const context = await requirePermission("finding:create", { engagementId });
  await assertFindingEngagement(
    context.organisationId,
    engagementId,
    findingId,
  );
  await patchFindingNarrative(context, {
    findingId,
    changeSummary: `Accepted AI draft for ${field}`,
    [field]: draft,
  });
  revalidatePath(`/engagements/${engagementId}`);
}
