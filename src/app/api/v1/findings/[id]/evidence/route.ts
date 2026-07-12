import { z } from "zod";
import { linkFindingEvidenceInput } from "@/lib/api/finding-input";
import { apiWriteContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import { linkFindingEvidence } from "@/server/services/findings";

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
      "findings:write",
      "finding:create",
    );
    if (!principal.userId)
      throw new Error("API key does not have an attributable owner");
    const input = linkFindingEvidenceInput.parse(await request.json());
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
