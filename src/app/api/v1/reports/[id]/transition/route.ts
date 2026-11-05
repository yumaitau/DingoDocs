import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { reports } from "@/db/schema";
import { apiReadContext, apiWriteContext } from "@/lib/api/authentication";
import { apiError, apiNotFound } from "@/lib/api/responses";
import { jsonWithLimit } from "@/lib/security/request-body";
import { engagementVisibility } from "@/lib/permissions/access";
import { reportTransitionPermission } from "@/lib/reports/transition-permission";
import { reportStatuses, transitionReport } from "@/server/services/reports";

const bodySchema = z.object({
  status: z.enum(
    reportStatuses as [
      (typeof reportStatuses)[number],
      ...Array<(typeof reportStatuses)[number]>,
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
    const principal = await apiReadContext(request, "findings:write");
    const [existing] = await db
      .select({ engagementId: reports.engagementId })
      .from(reports)
      .where(
        and(
          eq(reports.id, id),
          eq(reports.organisationId, principal.organisationId),
          engagementVisibility(principal, reports.engagementId),
        ),
      )
      .limit(1);
    if (!existing) return apiNotFound(requestId, "Report was not found");

    const input = bodySchema.parse(await jsonWithLimit(request));
    // Publication lifecycle and approval gates are human-only: service-account
    // keys are denied report:publish and finding:approve.
    const permission = reportTransitionPermission(input.status);
    const writer = await apiWriteContext(
      request,
      "findings:write",
      permission,
      { engagementId: existing.engagementId },
    );
    if (!writer.userId)
      throw new Error("API key does not have an attributable owner");

    const updated = await transitionReport(
      { organisationId: writer.organisationId, userId: writer.userId },
      { reportId: id, toStatus: input.status },
    );
    return NextResponse.json({ data: updated, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}
