import { z } from "zod";
import { apiError } from "@/lib/api/responses";
import {
  requireOrganisationContext,
  requirePermission,
} from "@/lib/permissions/require";
import {
  renderReportHtml,
  type ReportDocumentModel,
} from "@/server/services/report-renderers";
import {
  getReportWorkspace,
  ReportScopeError,
} from "@/server/services/reports";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const organisation = await requireOrganisationContext();
    const workspace = await getReportWorkspace(organisation.organisationId, id);
    await requirePermission("data:export", {
      engagementId: workspace.report.engagementId,
    });
    return new Response(
      renderReportHtml(workspace.current.content as ReportDocumentModel),
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
    if (error instanceof ReportScopeError)
      return Response.json({ error: "Report was not found" }, { status: 404 });
    return apiError(error, request.headers.get("x-request-id"));
  }
}
