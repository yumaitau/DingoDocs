import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { findingTemplates } from "@/db/schema";
import { apiReadContext, apiWriteContext } from "@/lib/api/authentication";
import { apiError, apiNotFound } from "@/lib/api/responses";
import { reviseFindingTemplate } from "@/server/services/findings";

const reviseSchema = z
  .object({
    title: z.string().trim().min(2).max(240).optional(),
    summary: z.string().trim().min(1).max(20_000).optional(),
    executiveDescription: z.string().trim().max(20_000).optional(),
    technicalDescription: z.string().trim().min(1).max(20_000).optional(),
    businessImpact: z.string().trim().max(20_000).optional(),
    technicalImpact: z.string().trim().max(20_000).optional(),
    likelihood: z.string().trim().max(120).optional(),
    severity: z
      .enum(["informational", "low", "medium", "high", "critical"])
      .optional(),
    riskRationale: z.string().trim().max(20_000).optional(),
    remediation: z.string().trim().min(1).max(20_000).optional(),
    verificationSteps: z.string().trim().max(20_000).optional(),
    references: z
      .array(z.string().trim().min(1).max(2_000))
      .max(100)
      .optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
    assessmentTypes: z
      .array(z.string().trim().min(1).max(80))
      .max(50)
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to revise",
  });

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const principal = await apiReadContext(request, "findings:read");
    const [template] = await db
      .select()
      .from(findingTemplates)
      .where(
        and(
          eq(findingTemplates.id, id),
          eq(findingTemplates.organisationId, principal.organisationId),
        ),
      )
      .limit(1);
    if (!template) return apiNotFound(requestId, "Template was not found");
    return NextResponse.json({ data: template, requestId });
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
      "findings:write",
      "template:manage",
    );
    if (!principal.userId)
      throw new Error("API key does not have an attributable owner");
    const changes = reviseSchema.parse(await request.json());
    const template = await reviseFindingTemplate(
      { organisationId: principal.organisationId, userId: principal.userId },
      id,
      changes,
    );
    return NextResponse.json({ data: template, requestId }, { status: 201 });
  } catch (error) {
    return apiError(error, requestId);
  }
}
