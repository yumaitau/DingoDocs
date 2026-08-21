import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { engagements } from "@/db/schema";
import { apiReadContext } from "@/lib/api/authentication";
import { apiError, apiNotFound } from "@/lib/api/responses";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const principal = await apiReadContext(request, "engagements:read");
    const [engagement] = await db
      .select()
      .from(engagements)
      .where(
        and(
          eq(engagements.id, id),
          eq(engagements.organisationId, principal.organisationId),
          isNull(engagements.deletedAt),
        ),
      )
      .limit(1);
    if (!engagement) return apiNotFound(requestId, "Engagement was not found");
    return NextResponse.json({ data: engagement, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}
