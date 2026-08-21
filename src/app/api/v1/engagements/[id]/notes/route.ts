import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { notes } from "@/db/schema";
import { apiReadContext, apiWriteContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import { createWorkspaceNote } from "@/server/services/engagement-workspace";

const createSchema = z.object({
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(20_000),
  kind: z.enum(["note", "testing_journal"]).default("testing_journal"),
  visibility: z.enum(["private", "team", "client"]).default("team"),
  assetIds: z.array(z.string().uuid()).max(100).optional(),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const principal = await apiReadContext(request, "engagements:read");
    const rows = await db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.organisationId, principal.organisationId),
          eq(notes.engagementId, id),
          isNull(notes.deletedAt),
        ),
      )
      .orderBy(desc(notes.createdAt))
      .limit(100);
    return NextResponse.json({ data: rows, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const principal = await apiWriteContext(request, "notes:write", "finding:create", {
      engagementId: id,
    });
    if (!principal.userId) throw new Error("API key does not have an attributable owner");
    const input = createSchema.parse(await request.json());
    const note = await createWorkspaceNote(
      { organisationId: principal.organisationId, userId: principal.userId },
      { engagementId: id, ...input },
    );
    return NextResponse.json({ data: note, requestId }, { status: 201 });
  } catch (error) {
    return apiError(error, requestId);
  }
}
