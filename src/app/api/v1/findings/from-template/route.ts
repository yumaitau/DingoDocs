import { NextResponse } from "next/server";
import { z } from "zod";
import { apiReadContext, apiWriteContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import { jsonWithLimit } from "@/lib/security/request-body";
import { assertActorEngagementAccess } from "@/lib/permissions/require";
import { createFindingFromTemplate } from "@/server/services/findings";

const bodySchema = z.object({
  engagementId: z.string().uuid(),
  templateId: z.string().uuid(),
  identifier: z.string().trim().min(1).max(80),
  assetIds: z.array(z.string().uuid()).max(100).optional(),
});

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    // Authenticate before reading the body; the permission check needs the
    // engagement named in it.
    await apiReadContext(request, "findings:write");
    const input = bodySchema.parse(await jsonWithLimit(request));
    const context = await apiWriteContext(
      request,
      "findings:write",
      "finding:create",
      { engagementId: input.engagementId },
    );
    if (!context.userId)
      throw new Error("API key does not have an attributable owner");
    await assertActorEngagementAccess(context, input.engagementId);
    const created = await createFindingFromTemplate(
      { organisationId: context.organisationId, userId: context.userId },
      input,
    );
    return NextResponse.json({ data: created, requestId }, { status: 201 });
  } catch (error) {
    return apiError(error, requestId);
  }
}
