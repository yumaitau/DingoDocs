import { z } from "zod";
import { apiError } from "@/lib/api/responses";
import {
  requireOrganisationContext,
  rolesForOperation,
} from "@/lib/permissions/require";
import { storage } from "@/lib/storage";
import {
  auditEvidenceDownload,
  EvidenceScopeError,
  getEvidenceForAccess,
  getEvidenceLocator,
  scopedEvidenceActor,
} from "@/server/services/evidence";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return await handleDownload(context);
  } catch (error) {
    if (error instanceof EvidenceScopeError)
      return Response.json(
        { error: "Evidence was not found" },
        { status: 404 },
      );
    return apiError(error, request.headers.get("x-request-id"));
  }
}

async function handleDownload(context: { params: Promise<{ id: string }> }) {
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
  const provider = storage();
  await auditEvidenceDownload(actor, row);
  const signed = provider.createDownloadUrl
    ? await provider.createDownloadUrl(row.storageKey, 120)
    : null;
  if (signed) return Response.redirect(signed, 303);
  return new Response(await provider.get(row.storageKey), {
    headers: {
      "content-type": row.mediaType,
      "content-length": String(row.sizeBytes),
      "content-disposition": `attachment; filename="${row.originalFilename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
