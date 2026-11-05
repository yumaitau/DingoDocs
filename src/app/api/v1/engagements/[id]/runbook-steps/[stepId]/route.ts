import { NextResponse } from "next/server";
import { z } from "zod";
import { apiWriteContext, runInOrganisation } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import { optionalJsonWithLimit } from "@/lib/security/request-body";
import { assertActorEngagementAccess } from "@/lib/permissions/require";
import { updateEngagementRunbookStep } from "@/server/services/runbooks";

const bodySchema = z.object({
  status: z
    .enum([
      "not_started",
      "in_progress",
      "completed",
      "blocked",
      "not_applicable",
    ])
    .default("completed"),
  notes: z.string().trim().max(10_000).optional(),
  findingId: z.string().uuid().nullable().optional(),
  evidenceId: z.string().uuid().nullable().optional(),
  taskId: z.string().uuid().nullable().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; stepId: string }> },
) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id, stepId } = await context.params;
    z.string().uuid().parse(id);
    z.string().uuid().parse(stepId);
    const principal = await apiWriteContext(
      request,
      "engagements:write",
      "scope:manage",
      { engagementId: id },
    );
    const userId = principal.userId;
    if (!userId) throw new Error("API key does not have an attributable owner");
    const input = bodySchema.parse(await optionalJsonWithLimit(request));
    const step = await runInOrganisation(principal, async () => {
      await assertActorEngagementAccess(principal, id);
      return updateEngagementRunbookStep(
        { organisationId: principal.organisationId, userId },
        {
          engagementId: id,
          stepId,
          status: input.status,
          notes: input.notes,
          findingId: input.findingId,
          evidenceId: input.evidenceId,
          taskId: input.taskId,
        },
      );
    });
    return NextResponse.json({ data: step, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}
