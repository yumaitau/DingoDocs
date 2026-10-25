import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { webhooks } from "@/db/schema";
import {
  apiWriteContext,
  authenticateApiRequest,
} from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import { requirePermission } from "@/lib/permissions/require";
import { createWebhook } from "@/server/services/webhooks";

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    // API keys are gated by scope; session callers need integration:configure.
    const context =
      (await authenticateApiRequest(request, "webhooks:manage")) ??
      (await requirePermission("integration:configure"));
    const data = await db
      .select({
        id: webhooks.id,
        name: webhooks.name,
        url: webhooks.url,
        events: webhooks.events,
        enabled: webhooks.enabled,
        secretVersion: webhooks.secretVersion,
        createdAt: webhooks.createdAt,
        rotatedAt: webhooks.rotatedAt,
      })
      .from(webhooks)
      .where(eq(webhooks.organisationId, context.organisationId))
      .orderBy(desc(webhooks.createdAt));
    return NextResponse.json({ data, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  url: z.string().url(),
  events: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
});

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    const input = createSchema.parse(await request.json());
    const principal = await apiWriteContext(
      request,
      "webhooks:manage",
      "integration:configure",
    );
    if (!principal.userId)
      throw new Error("API key does not have an attributable owner");
    const webhook = await createWebhook(
      { organisationId: principal.organisationId, userId: principal.userId },
      input,
    );
    return NextResponse.json({ data: webhook, requestId }, { status: 201 });
  } catch (error) {
    return apiError(error, requestId);
  }
}
