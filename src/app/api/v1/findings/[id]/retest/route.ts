import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { findings } from "@/db/schema";
import { apiReadContext, apiWriteContext } from "@/lib/api/authentication";
import { apiError, apiNotFound } from "@/lib/api/responses";
import { engagementVisibility } from "@/lib/permissions/access";
import { requestRetestForApi } from "@/server/services/retest-api";

const bodySchema = z.object({
  notes: z.string().trim().max(10_000).optional(),
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

    const writer = await apiWriteContext(
      request,
      "findings:write",
      "finding:create",
      { engagementId: existing.engagementId },
    );
    if (!writer.userId)
      throw new Error("API key does not have an attributable owner");

    const input = bodySchema.parse(await request.json().catch(() => ({})));
    const attempt = await requestRetestForApi(
      { organisationId: writer.organisationId, userId: writer.userId },
      id,
      input.notes,
    );
    return NextResponse.json({ data: attempt, requestId }, { status: 201 });
  } catch (error) {
    return apiError(error, requestId);
  }
}
