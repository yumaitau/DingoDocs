import { z } from "zod";
import { apiError } from "@/lib/api/responses";
import { requireOrganisationContext } from "@/lib/permissions/require";
import {
  renderReport,
  reportMediaTypes,
  type ReportDocumentModel,
} from "@/server/services/report-renderers";
import { presentClientReport } from "@/server/services/report-client-view";
import {
  getPortalReportVersion,
  PortalNotFoundError,
} from "@/server/services/client-portal";

export const runtime = "nodejs";

const formatSchema = z.enum(["pdf", "docx"]);

export async function GET(
  request: Request,
  context: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await context.params;
    z.string().uuid().parse(versionId);
    const format = formatSchema.parse(
      new URL(request.url).searchParams.get("format"),
    );
    const actor = await requireOrganisationContext();
    if (actor.role !== "client_user" && actor.role !== "client_administrator")
      throw new PortalNotFoundError();
    const report = await getPortalReportVersion(actor, versionId);
    const model = await presentClientReport(
      actor.organisationId,
      report.content as ReportDocumentModel,
    );
    const bytes = await renderReport(model, format);
    const filename = `${safeName(report.title)}-v${report.version}.${format}`;
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": reportMediaTypes[format],
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof PortalNotFoundError)
      return Response.json({ error: "Report was not found" }, { status: 404 });
    return apiError(error, request.headers.get("x-request-id"));
  }
}

function safeName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "report";
}
