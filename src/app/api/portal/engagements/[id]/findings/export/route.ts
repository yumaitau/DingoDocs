import { z } from "zod";
import { apiError } from "@/lib/api/responses";
import { requireOrganisationContext } from "@/lib/permissions/require";
import {
  findingsToCsv,
  findingsToXlsx,
  type PortalSheetRow,
} from "@/lib/reports/portal-sheet";
import {
  getPortalEngagement,
  PortalNotFoundError,
} from "@/server/services/client-portal";

export const runtime = "nodejs";

const formatSchema = z.enum(["csv", "xlsx"]);

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: engagementId } = await context.params;
    z.string().uuid().parse(engagementId);
    const format = formatSchema.parse(
      new URL(request.url).searchParams.get("format"),
    );
    const actor = await requireOrganisationContext();
    if (actor.role !== "client_user" && actor.role !== "client_administrator")
      throw new PortalNotFoundError();
    const portal = await getPortalEngagement(actor, engagementId);
    const latestRemediation = new Map<string, string>();
    for (const update of [...portal.remediationUpdates].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )) {
      latestRemediation.set(update.findingId, update.status);
    }
    const rows: PortalSheetRow[] = portal.findings.map((finding) => ({
      identifier: finding.identifier,
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
      clientOwner: finding.clientOwner ?? "",
      dueAt: finding.dueAt ? finding.dueAt.toISOString() : "",
      retestStatus: finding.retestStatus ?? "",
      remediationStatus: latestRemediation.get(finding.id) ?? "open",
    }));
    if (format === "csv") {
      return new Response(findingsToCsv(rows), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="portal-findings-${engagementId}.csv"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return new Response(Buffer.from(findingsToXlsx(rows)), {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="portal-findings-${engagementId}.xlsx"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof PortalNotFoundError)
      return Response.json(
        { error: "Engagement was not found" },
        { status: 404 },
      );
    return apiError(error, request.headers.get("x-request-id"));
  }
}
