import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { timelineEvents } from "@/db/schema";
import {
  ApiAuthenticationError,
  apiReadContext,
  apiWriteContext,
  runInOrganisation,
} from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import { jsonWithLimit } from "@/lib/security/request-body";
import { assertActorEngagementAccess } from "@/lib/permissions/require";
import { createTimelineEntry } from "@/server/services/engagement-workspace";

const createSchema = z.object({
  phase: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(20_000),
  occurredAt: z.string().datetime().optional(),
  commands: z.string().trim().min(1).max(20_000).optional(),
  clientVisible: z.boolean().optional(),
  attackMappings: z.string().trim().max(2_000).optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const principal = await apiReadContext(request, "engagements:read");
    const rows = await runInOrganisation(principal, async () => {
      await assertActorEngagementAccess(principal, id);
      return db
        .select()
        .from(timelineEvents)
        .where(
          and(
            eq(timelineEvents.organisationId, principal.organisationId),
            eq(timelineEvents.engagementId, id),
          ),
        )
        .orderBy(desc(timelineEvents.occurredAt))
        .limit(100);
    });
    return NextResponse.json({ data: rows, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}

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
      "notes:write",
      "finding:create",
      {
        engagementId: id,
      },
    );
    if (!principal.userId)
      throw new Error("API key does not have an attributable owner");
    const input = createSchema.parse(await jsonWithLimit(request));
    const serviceAccountId =
      "serviceAccountId" in principal ? principal.serviceAccountId : undefined;
    // Releasing an entry to the client is a human decision.
    if (input.clientVisible && serviceAccountId)
      throw new ApiAuthenticationError(
        "Service account API keys cannot make timeline entries client visible; a human reviewer must release them",
        403,
        "service_account_forbidden",
      );
    const userId = principal.userId;
    const entry = await runInOrganisation(principal, () =>
      createTimelineEntry(
        {
          organisationId: principal.organisationId,
          userId,
          serviceAccountId,
        },
        {
          engagementId: id,
          phase: input.phase,
          description: input.description,
          commands: input.commands,
          clientVisible: input.clientVisible ?? false,
          attackMappings: input.attackMappings,
          occurredAt: input.occurredAt
            ? new Date(input.occurredAt)
            : new Date(),
        },
      ),
    );
    return NextResponse.json({ data: entry, requestId }, { status: 201 });
  } catch (error) {
    return apiError(error, requestId);
  }
}
