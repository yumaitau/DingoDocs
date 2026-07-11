import { z } from "zod";
import { apiError } from "@/lib/api/responses";
import {
  requireInternalOrganisationContext,
  requirePermission,
} from "@/lib/permissions/require";
import { storage } from "@/lib/storage";
import {
  getReportExport,
  getReportWorkspace,
  ReportScopeError,
  reportFormats,
} from "@/server/services/reports";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; format: string }> },
) {
  try {
    const { id, format: value } = await context.params;
    z.string().uuid().parse(id);
    const format = z
      .enum(
        reportFormats as [
          (typeof reportFormats)[number],
          ...Array<(typeof reportFormats)[number]>,
        ],
      )
      .parse(value);
    const organisation = await requireInternalOrganisationContext();
    const workspace = await getReportWorkspace(organisation.organisationId, id);
    const permission = await requirePermission("data:export", {
      engagementId: workspace.report.engagementId,
    });
    const result = await getReportExport(
      { organisationId: permission.organisationId, userId: permission.userId },
      { reportVersionId: workspace.current.id, format },
    );
    const provider = storage();
    const signed = provider.createDownloadUrl
      ? await provider.createDownloadUrl(result.key, 120)
      : null;
    if (signed) return Response.redirect(signed, 303);
    const extension = format === "markdown" ? "md" : format;
    return new Response(await provider.get(result.key), {
      headers: {
        "content-type": result.mediaType,
        "content-disposition": `attachment; filename="${safeName(workspace.report.title)}-v${workspace.current.version}.${extension}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ReportScopeError)
      return Response.json(
        { error: "Report export was not found" },
        { status: 404 },
      );
    return apiError(error, request.headers.get("x-request-id"));
  }
}

function safeName(value: string) {
  return (
    value
      .normalize("NFKC")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(0, 100) || "report"
  );
}
