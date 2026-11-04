import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { reports } from "@/db/schema";
import {
  apiReadContext,
  apiWriteContext,
  runInOrganisation,
} from "@/lib/api/authentication";
import { apiError, apiNotFound } from "@/lib/api/responses";
import { jsonWithLimit } from "@/lib/security/request-body";
import { engagementVisibility } from "@/lib/permissions/access";
import {
  getReportExport,
  getReportWorkspace,
  reportFormats,
  ReportScopeError,
  queueReportGeneration,
} from "@/server/services/reports";

const bodySchema = z.object({
  format: z.enum(
    reportFormats as [
      (typeof reportFormats)[number],
      ...Array<(typeof reportFormats)[number]>,
    ],
  ),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    // Export queues generation and releases report content, so it needs a
    // write scope (as report transitions do) and data:export, which
    // service-account keys never hold.
    const principal = await apiReadContext(request, "findings:write");
    const [existing] = await runInOrganisation(principal, () =>
      db
        .select({ engagementId: reports.engagementId })
        .from(reports)
        .where(
          and(
            eq(reports.id, id),
            eq(reports.organisationId, principal.organisationId),
            engagementVisibility(principal, reports.engagementId),
          ),
        )
        .limit(1),
    );
    if (!existing) return apiNotFound(requestId, "Report was not found");

    const writer = await apiWriteContext(
      request,
      "findings:write",
      "data:export",
      { engagementId: existing.engagementId },
    );
    if (!writer.userId)
      throw new Error("API key does not have an attributable owner");

    const input = bodySchema.parse(await jsonWithLimit(request));
    const actor = {
      organisationId: writer.organisationId,
      userId: writer.userId,
    };
    // Rendering is a background job; this only queues it or records the
    // download, so the whole step is database work.
    const outcome = await runInOrganisation(writer, async () => {
      const workspace = await getReportWorkspace(writer.organisationId, id);
      const existingKey = workspace.current.exportKeys?.[input.format];
      if (!existingKey) {
        await queueReportGeneration(actor, id, [input.format]);
        return { queued: true as const, workspace };
      }
      const result = await getReportExport(actor, {
        reportVersionId: workspace.current.id,
        format: input.format,
      });
      return { queued: false as const, result };
    });
    if (outcome.queued) {
      const { workspace } = outcome;
      return NextResponse.json({
        data: {
          reportId: id,
          versionId: workspace.current.id,
          version: workspace.current.version,
          format: input.format,
          renderStatus: "queued",
          mediaType: null,
          downloadPath: `/api/v1/reports/${id}/exports/${input.format}`,
        },
        requestId,
      });
    }

    const { result } = outcome;
    return NextResponse.json({
      data: {
        reportId: id,
        versionId: result.version.id,
        version: result.version.version,
        format: input.format,
        renderStatus: result.version.renderStatus,
        mediaType: result.mediaType,
        downloadPath: `/api/v1/reports/${id}/exports/${input.format}`,
      },
      requestId,
    });
  } catch (error) {
    if (error instanceof ReportScopeError)
      return apiNotFound(requestId, error.message);
    return apiError(error, requestId);
  }
}
