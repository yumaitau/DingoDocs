import { NextResponse } from "next/server";
import { z } from "zod";
import { apiReadContext, apiWriteContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import {
  createFindingTemplate,
  searchFindingTemplates,
} from "@/server/services/findings";

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  approvedOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});

const mappingSchema = z.object({
  framework: z.string().trim().min(1).max(160),
  reference: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(240).optional(),
});

const createSchema = z.object({
  stableKey: z.string().trim().max(120).optional(),
  title: z.string().trim().min(2).max(240),
  summary: z.string().trim().min(1).max(20_000),
  executiveDescription: z.string().trim().max(20_000).optional(),
  technicalDescription: z.string().trim().min(1).max(20_000),
  businessImpact: z.string().trim().max(20_000).optional(),
  technicalImpact: z.string().trim().max(20_000).optional(),
  likelihood: z.string().trim().max(120).optional(),
  severity: z.enum(["informational", "low", "medium", "high", "critical"]),
  riskRationale: z.string().trim().max(20_000).optional(),
  remediation: z.string().trim().min(1).max(20_000),
  verificationSteps: z.string().trim().max(20_000).optional(),
  references: z.array(z.string().trim().min(1).max(2_000)).max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  assessmentTypes: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  mappings: z.array(mappingSchema).max(100).optional(),
});

export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    const principal = await apiReadContext(request, "findings:read");
    const query = querySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const data = await searchFindingTemplates(
      principal.organisationId,
      query.q ?? "",
      query.approvedOnly ?? false,
    );
    return NextResponse.json({ data, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id");
  try {
    const principal = await apiWriteContext(
      request,
      "findings:write",
      "template:manage",
    );
    if (!principal.userId)
      throw new Error("API key does not have an attributable owner");
    const input = createSchema.parse(await request.json());
    const template = await createFindingTemplate(
      { organisationId: principal.organisationId, userId: principal.userId },
      input,
    );
    return NextResponse.json({ data: template, requestId }, { status: 201 });
  } catch (error) {
    return apiError(error, requestId);
  }
}
