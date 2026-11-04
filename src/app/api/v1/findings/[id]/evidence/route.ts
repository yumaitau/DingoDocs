import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { findings } from "@/db/schema";
import { linkFindingEvidenceInput } from "@/lib/api/finding-input";
import { apiReadContext, apiWriteContext } from "@/lib/api/authentication";
import { apiError, apiNotFound } from "@/lib/api/responses";
import { jsonWithLimit } from "@/lib/security/request-body";
import { engagementVisibility } from "@/lib/permissions/access";
import { linkFindingEvidence } from "@/server/services/findings";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const reader = await apiReadContext(request, "findings:write");
    const input = linkFindingEvidenceInput.parse(await jsonWithLimit(request));
    const [locator] = await db
      .select({ engagementId: findings.engagementId })
      .from(findings)
      .where(
        and(
          eq(findings.id, id),
          eq(findings.organisationId, reader.organisationId),
          isNull(findings.deletedAt),
          engagementVisibility(reader, findings.engagementId),
        ),
      )
      .limit(1);
    if (!locator) return apiNotFound(requestId, "Finding was not found");
    const principal = await apiWriteContext(
      request,
      "findings:write",
      "finding:create",
      { engagementId: locator.engagementId },
    );
    if (!principal.userId)
      throw new Error("API key does not have an attributable owner");
    const linked = await linkFindingEvidence(
      { organisationId: principal.organisationId, userId: principal.userId },
      { findingId: id, evidenceIds: input.evidenceIds },
    );
    return Response.json({
      data: linked.map((row) => ({ id: row.id })),
      requestId,
    });
  } catch (error) {
    return apiError(error, requestId);
  }
}
