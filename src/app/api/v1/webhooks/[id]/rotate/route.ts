import { NextResponse } from "next/server";
import { z } from "zod";
import { apiWriteContext, runInOrganisation } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import { rotateWebhookSecret } from "@/server/services/webhooks";

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
      "webhooks:manage",
      "integration:configure",
    );
    const userId = principal.userId;
    if (!userId) throw new Error("API key does not have an attributable owner");
    const webhook = await runInOrganisation(principal, () =>
      rotateWebhookSecret(
        { organisationId: principal.organisationId, userId },
        id,
      ),
    );
    return NextResponse.json({ data: webhook, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}
