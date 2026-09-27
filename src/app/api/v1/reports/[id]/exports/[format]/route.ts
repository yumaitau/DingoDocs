import { z } from "zod";
import { osaiFileStem } from "@/lib/reports/layout";
import type { ReportDocumentModel } from "@/server/services/report-renderers";
import { apiError } from "@/lib/api/responses";
import {
  assertEngagementAccess,
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
    await assertEngagementAccess({
      userId: organisation.userId,
      organisationId: organisation.organisationId,
      engagementId: workspace.report.engagementId,
    });
    const permission = await requirePermission("data:export", {
      engagementId: workspace.report.engagementId,
    });
    const result = await getReportExport(
      { organisationId: permission.organisationId, userId: permission.userId },
      { reportVersionId: workspace.current.id, format },
    );
    const exam = (workspace.current.content as ReportDocumentModel).exam;
    let examName: string | undefined;
    if (exam && format === "pdf") {
      try {
        examName = `${osaiFileStem(exam.osid)}.pdf`;
      } catch {
        return Response.json(
          {
            error:
              "Enter a valid OSID in the report draft before downloading the exam PDF",
          },
          { status: 422 },
        );
      }
    }
    const provider = storage();
    const signed =
      !examName && provider.createDownloadUrl
        ? await provider.createDownloadUrl(result.key, 120)
        : null;
    if (signed) return Response.redirect(signed, 303);
    const extension = format === "markdown" ? "md" : format;
    return new Response(await provider.get(result.key), {
      headers: {
        "content-type": result.mediaType,
        "content-disposition": `attachment; filename="${examName ?? `${safeName(workspace.report.title)}-v${workspace.current.version}.${extension}`}"`,
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
