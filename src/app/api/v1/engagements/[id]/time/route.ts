import { NextResponse } from "next/server";
import { z } from "zod";
import { apiWriteContext, runInOrganisation } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import { jsonWithLimit } from "@/lib/security/request-body";
import { assertActorEngagementAccess } from "@/lib/permissions/require";
import { logWorkspaceTime } from "@/server/services/engagement-workspace";

const bodySchema = z.object({
  category: z.string().trim().min(2).max(80),
  hours: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/),
  description: z.string().trim().max(10_000).optional(),
  startedAt: z.string().datetime(),
  billable: z.boolean().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const principal = await apiWriteContext(
      request,
      "engagements:write",
      "scope:manage",
      { engagementId: id },
    );
    const userId = principal.userId;
    if (!userId) throw new Error("API key does not have an attributable owner");
    const input = bodySchema.parse(await jsonWithLimit(request));
    const startedAt = new Date(input.startedAt);
    if (Number.isNaN(startedAt.getTime()))
      throw new Error("startedAt is not a valid timestamp");
    const entry = await runInOrganisation(principal, async () => {
      await assertActorEngagementAccess(principal, id);
      return logWorkspaceTime(
        { organisationId: principal.organisationId, userId },
        {
          engagementId: id,
          category: input.category,
          hours: input.hours,
          description: input.description,
          startedAt,
          billable: input.billable,
        },
      );
    });
    return NextResponse.json({ data: entry, requestId }, { status: 201 });
  } catch (error) {
    return apiError(error, requestId);
  }
}
