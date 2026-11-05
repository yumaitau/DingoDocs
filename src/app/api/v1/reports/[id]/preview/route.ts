import { z } from "zod";
import { apiError } from "@/lib/api/responses";
import {
  assertEngagementAccess,
  requireInternalOrganisationContext,
  requirePermission,
  runInOrganisation,
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
    const organisation = await requireInternalOrganisationContext();
    const workspace = await runInOrganisation(organisation, async () => {
      const workspace = await getReportWorkspace(
        organisation.organisationId,
        id,
      );
      await assertEngagementAccess({
        userId: organisation.userId,
        organisationId: organisation.organisationId,
        engagementId: workspace.report.engagementId,
      });
      return workspace;
    });
    // Re-resolves the session and membership (auth tables, no RLS), so it
    // runs outside the tenant transaction.
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
