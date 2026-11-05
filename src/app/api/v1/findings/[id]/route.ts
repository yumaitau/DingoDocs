import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { findings } from "@/db/schema";
import { patchFindingInput } from "@/lib/api/finding-input";
import { apiReadContext, apiWriteContext } from "@/lib/api/authentication";
import { apiError, apiNotFound } from "@/lib/api/responses";
import { jsonWithLimit } from "@/lib/security/request-body";
import { engagementVisibility } from "@/lib/permissions/access";
import { patchFindingNarrative } from "@/server/services/findings";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const principal = await apiReadContext(request, "findings:read");
    const [finding] = await db
      .select()
      .from(findings)
      .where(
        and(
          eq(findings.id, id),
          eq(findings.organisationId, principal.organisationId),
          isNull(findings.deletedAt),
          engagementVisibility(principal, findings.engagementId),
        ),
      )
      .limit(1);
    if (!finding) return apiNotFound(requestId, "Finding was not found");
    return Response.json({ data: finding, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const principal = await apiReadContext(request, "findings:write");
    const existing = await db
      .select({ engagementId: findings.engagementId })
      .from(findings)
      .where(
        and(
          eq(findings.id, id),
          eq(findings.organisationId, principal.organisationId),
          isNull(findings.deletedAt),
          engagementVisibility(principal, findings.engagementId),
        ),
      )
      .limit(1);
    if (!existing[0]) return apiNotFound(requestId, "Finding was not found");
    const writer = await apiWriteContext(
      request,
      "findings:write",
      "finding:create",
      { engagementId: existing[0].engagementId },
    );
    if (!writer.userId)
      throw new Error("API key does not have an attributable owner");
    const input = patchFindingInput.parse(await jsonWithLimit(request));
    const updated = await patchFindingNarrative(
      { organisationId: writer.organisationId, userId: writer.userId },
      {
        findingId: id,
        ...input,
        dueAt: input.dueAt
          ? new Date(`${input.dueAt}T23:59:59.999Z`)
          : undefined,
      },
    );
    return Response.json({ data: updated, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}
