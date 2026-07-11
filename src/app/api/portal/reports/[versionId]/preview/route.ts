import { z } from "zod";
import { apiError } from "@/lib/api/responses";
import { requireOrganisationContext } from "@/lib/permissions/require";
import {
  renderReportHtml,
  type ReportDocumentModel,
} from "@/server/services/report-renderers";
import {
  getPortalReportVersion,
  PortalNotFoundError,
} from "@/server/services/client-portal";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await context.params;
    z.string().uuid().parse(versionId);
    const actor = await requireOrganisationContext();
    if (actor.role !== "client_user" && actor.role !== "client_administrator")
      throw new PortalNotFoundError();
    const report = await getPortalReportVersion(actor, versionId);
    return new Response(
      renderReportHtml(report.content as ReportDocumentModel),
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "private, no-store",
          "content-security-policy":
            "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    if (error instanceof PortalNotFoundError)
      return Response.json({ error: "Report was not found" }, { status: 404 });
    return apiError(error, request.headers.get("x-request-id"));
  }
}
