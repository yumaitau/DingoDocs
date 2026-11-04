import { z } from "zod";
import { apiError } from "@/lib/api/responses";
import {
  requireOrganisationContext,
  rolesForOperation,
  runInOrganisation,
} from "@/lib/permissions/require";
import { storage } from "@/lib/storage";
import { attachmentDisposition } from "@/lib/storage/s3";
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
  // Authorisation and the audit row run scoped; signing a URL or streaming
  // from storage happens after the tenant transaction commits.
  const row = await runInOrganisation(organisation, async () => {
    const locator = await getEvidenceLocator(organisation.organisationId, id);
    const roles = await rolesForOperation({
      userId: organisation.userId,
      organisationId: organisation.organisationId,
      engagementId: locator.engagementId,
    });
    if (!roles.length) throw new EvidenceScopeError();
    const actor = await scopedEvidenceActor({
      organisationId: organisation.organisationId,
      userId: organisation.userId,
      roles,
    });
    const row = await getEvidenceForAccess(actor, id);
    await auditEvidenceDownload(actor, row);
    return row;
  });
  const provider = storage();
  const signed = provider.createDownloadUrl
    ? await provider.createDownloadUrl(row.storageKey, 120, {
        filename: row.originalFilename,
        contentType: row.mediaType,
      })
    : null;
  if (signed) return Response.redirect(signed, 303);
  return new Response(await provider.get(row.storageKey), {
    headers: {
      "content-type": row.mediaType,
      "content-length": String(row.sizeBytes),
      "content-disposition": attachmentDisposition(row.originalFilename),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
