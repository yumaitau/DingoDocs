import { and, asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { apiReadContext, apiWriteContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import { createAsset } from "@/server/services/engagement-workspace";

const createSchema = z.object({
  name: z.string().trim().min(1).max(240),
  type: z.string().trim().min(1).max(80),
  identifier: z.string().trim().min(1).max(500),
  environment: z.string().trim().min(1).max(80).optional(),
  owner: z.string().trim().min(1).max(240).optional(),
  criticality: z.string().trim().min(1).max(80).optional(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const principal = await apiReadContext(request, "engagements:read");
    const rows = await db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.organisationId, principal.organisationId),
          eq(assets.engagementId, id),
          isNull(assets.deletedAt),
        ),
      )
      .orderBy(asc(assets.name))
      .limit(500);
    return NextResponse.json({ data: rows, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const principal = await apiWriteContext(
      request,
      "engagements:write",
      "engagement:edit",
      {
        engagementId: id,
      },
    );
    if (!principal.userId)
      throw new Error("API key does not have an attributable owner");
    const input = createSchema.parse(await request.json());
    const asset = await createAsset(
      { organisationId: principal.organisationId, userId: principal.userId },
      { engagementId: id, ...input },
    );
    return NextResponse.json({ data: asset, requestId }, { status: 201 });
  } catch (error) {
    return apiError(error, requestId);
  }
}
