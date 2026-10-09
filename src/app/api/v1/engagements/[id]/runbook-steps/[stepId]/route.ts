import { NextResponse } from "next/server";
import { z } from "zod";
import { apiWriteContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
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
    if (!principal.userId)
      throw new Error("API key does not have an attributable owner");
    await assertActorEngagementAccess(principal, id);
    const input = bodySchema.parse(await request.json().catch(() => ({})));
    const step = await updateEngagementRunbookStep(
      { organisationId: principal.organisationId, userId: principal.userId },
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
    return NextResponse.json({ data: step, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}
