import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { findings } from "@/db/schema";
import { apiReadContext, apiWriteContext } from "@/lib/api/authentication";
import { apiError, apiNotFound } from "@/lib/api/responses";
import { engagementVisibility } from "@/lib/permissions/access";
import type { Permission } from "@/lib/permissions/matrix";
import { transitionFinding } from "@/server/services/findings";

const findingStatus = z.enum([
  "draft",
  "in_progress",
  "ready_for_review",
  "changes_requested",
  "peer_reviewed",
  "qa_approved",
  "published",
  "remediation_in_progress",
  "ready_for_retest",
  "retested",
  "resolved",
  "risk_accepted",
  "closed",
]);

const bodySchema = z.object({
  status: findingStatus,
  reason: z.string().trim().max(4_000).optional(),
});

const approvalStatuses = new Set([
  "changes_requested",
  "peer_reviewed",
  "qa_approved",
  "published",
]);

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
      .select({ engagementId: findings.engagementId })
      .from(findings)
      .where(
        and(
          eq(findings.id, id),
          eq(findings.organisationId, principal.organisationId),
          isNull(findings.deletedAt),
          engagementVisibility(principal, findings.engagementId),
        ),
      )
      .limit(1);
    if (!existing) return apiNotFound(requestId, "Finding was not found");

    const input = bodySchema.parse(await request.json());
    const permission: Permission = approvalStatuses.has(input.status)
      ? "finding:approve"
      : "finding:create";
    const writer = await apiWriteContext(
      request,
      "findings:write",
      permission,
      { engagementId: existing.engagementId },
    );
    if (!writer.userId)
      throw new Error("API key does not have an attributable owner");

    const updated = await transitionFinding(
      { organisationId: writer.organisationId, userId: writer.userId },
      {
        findingId: id,
        toStatus: input.status,
        comment: input.reason,
      },
    );
    return NextResponse.json({ data: updated, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}
