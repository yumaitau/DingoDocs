import { z } from "zod";
import { apiError } from "@/lib/api/responses";
import {
  requireOrganisationContext,
  rolesForOperation,
} from "@/lib/permissions/require";
import { storage } from "@/lib/storage";
import {
  EvidenceScopeError,
  getEvidenceForAccess,
  getEvidenceLocator,
  scopedEvidenceActor,
} from "@/server/services/evidence";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return await handlePreview(context);
  } catch (error) {
    if (error instanceof EvidenceScopeError)
      return Response.json(
        { error: "Evidence was not found" },
        { status: 404 },
      );
    return apiError(error, request.headers.get("x-request-id"));
  }
}

async function handlePreview(context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  z.string().uuid().parse(id);
  const organisation = await requireOrganisationContext();
  const locator = await getEvidenceLocator(organisation.organisationId, id);
  const roles = await rolesForOperation({
    userId: organisation.userId,
    organisationId: organisation.organisationId,
    engagementId: locator.engagementId,
  });
  const actor = await scopedEvidenceActor({
    organisationId: organisation.organisationId,
    userId: organisation.userId,
    roles,
  });
  const row = await getEvidenceForAccess(actor, id);
  return new Response(await storage().get(row.storageKey), {
    headers: {
      "content-type": row.mediaType,
      "content-length": String(row.sizeBytes),
      "content-disposition": `inline; filename="${row.originalFilename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
