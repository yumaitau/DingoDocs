import { requirePermission } from "@/lib/permissions/require";
import { exportOrganisation } from "@/server/services/data-exchange";
import { apiError } from "@/lib/api/responses";

export async function POST(request: Request) {
  try {
    const context = await requirePermission("organisation:export");
    const mode =
      new URL(request.url).searchParams.get("mode") === "migration"
        ? "migration"
        : "data";
    const result = await exportOrganisation(context, mode);
    return new Response(result.json, {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="dingodocs-${mode}-${context.organisationId}.json"`,
        "x-content-sha256": result.checksum,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error, request.headers.get("x-request-id"));
  }
}
