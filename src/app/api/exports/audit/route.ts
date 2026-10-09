import {
  auditCsvResponse,
  auditEventsToCsv,
  loadAuditEvents,
  readAuditListFilters,
} from "@/app/(app)/audit/page";
import { apiError } from "@/lib/api/responses";
import { requirePermission } from "@/lib/permissions/require";

export async function GET(request: Request) {
  try {
    const context = await requirePermission("audit:view");
    const params = new URL(request.url).searchParams;
    const filters = readAuditListFilters({
      q: params.get("q") ?? undefined,
      action: params.get("action") ?? undefined,
      targetType: params.get("targetType") ?? undefined,
      format: params.get("format") ?? undefined,
    });
    if (filters.format !== "csv")
      return new Response("format=csv is required", {
        status: 400,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    const rows = await loadAuditEvents(context.organisationId, filters);
    return auditCsvResponse(auditEventsToCsv(rows, context.timeZone));
  } catch (error) {
    return apiError(error, request.headers.get("x-request-id"));
  }
}
