import { z } from "zod";
import { apiError } from "@/lib/api/responses";
import { requirePermission } from "@/lib/permissions/require";
import {
  EvidenceDuplicateError,
  scopedEvidenceActor,
  uploadEvidence,
} from "@/server/services/evidence";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    return await handleUpload(request, context);
  } catch (error) {
    return apiError(error, request.headers.get("x-request-id"));
  }
}

async function handleUpload(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: engagementId } = await context.params;
  z.string().uuid().parse(engagementId);
  const permission = await requirePermission("evidence:upload", {
    engagementId,
  });
  const actor = await scopedEvidenceActor({
    organisationId: permission.organisationId,
    userId: permission.userId,
    roles: permission.roles,
  });
  const formData = await request.formData();
  const classification = z
    .enum(["internal", "restricted", "client_visible"])
    .parse(formData.get("classification") ?? "restricted");
  const retentionValue = z
    .string()
    .optional()
    .parse(formData.get("retentionUntil") || undefined);
  const retentionUntil = retentionValue
    ? new Date(`${retentionValue}T23:59:59.999Z`)
    : undefined;
  if (retentionUntil && Number.isNaN(retentionUntil.getTime()))
    return Response.json(
      { error: "Retention date is invalid" },
      { status: 400 },
    );
  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File);
  if (!files.length)
    return Response.json(
      { error: "At least one file is required" },
      { status: 400 },
    );
  if (files.length > 25)
    return Response.json(
      { error: "A maximum of 25 files is allowed" },
      { status: 400 },
    );

  const results: Array<
    | {
        ok: true;
        id: string;
        filename: string;
        sha256: string;
        version: number;
      }
    | { ok: false; filename: string; error: string; duplicateId?: string }
  > = [];
  for (const file of files) {
    try {
      const row = await uploadEvidence(actor, {
        engagementId,
        filename: file.name,
        mediaType: file.type || "application/octet-stream",
        bytes: new Uint8Array(await file.arrayBuffer()),
        classification,
        restrictionReason:
          String(formData.get("restrictionReason") ?? "") || undefined,
        restrictedUserIds: formData.getAll("restrictedUserIds").map(String),
        retentionUntil,
        assetIds: formData.getAll("assetIds").map(String),
      });
      results.push({
        ok: true,
        id: row.id,
        filename: row.originalFilename,
        sha256: row.sha256,
        version: row.version,
      });
    } catch (error) {
      results.push({
        ok: false,
        filename: file.name,
        error: error instanceof Error ? error.message : "Upload failed",
        duplicateId:
          error instanceof EvidenceDuplicateError
            ? error.evidenceId
            : undefined,
      });
    }
  }
  const failed = results.some((result) => !result.ok);
  const succeeded = results.some((result) => result.ok);
  return Response.json(
    { results },
    { status: failed && succeeded ? 207 : failed ? 400 : 201 },
  );
}
