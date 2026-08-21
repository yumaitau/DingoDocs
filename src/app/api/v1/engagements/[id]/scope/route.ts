import { and, asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { scopeItems, scopeVersions } from "@/db/schema";
import { apiReadContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const principal = await apiReadContext(request, "engagements:read");
    const [version] = await db
      .select()
      .from(scopeVersions)
      .where(
        and(
          eq(scopeVersions.organisationId, principal.organisationId),
          eq(scopeVersions.engagementId, id),
        ),
      )
      .orderBy(desc(scopeVersions.version))
      .limit(1);
    const items = version
      ? await db
          .select()
          .from(scopeItems)
          .where(
            and(
              eq(scopeItems.organisationId, principal.organisationId),
              eq(scopeItems.scopeVersionId, version.id),
            ),
          )
          .orderBy(asc(scopeItems.name))
      : [];
    return NextResponse.json({
      data: { version: version ?? null, items },
      requestId,
    });
  } catch (error) {
    return apiError(error, requestId);
  }
}
