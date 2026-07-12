import { z } from "zod";

const text = z.string().trim().min(1).max(20_000);
const optionalText = z.string().trim().min(1).max(20_000).optional();
const severity = z.enum(["informational", "low", "medium", "high", "critical"]);
const mappings = z
  .array(
    z.object({
      framework: z.string().trim().min(1).max(160),
      reference: z.string().trim().min(1).max(240),
      title: z.string().trim().min(1).max(240).optional(),
    }),
  )
  .max(100)
  .optional();

export const createFindingInput = z.object({
  engagementId: z.string().uuid(),
  identifier: z.string().trim().min(1).max(80),
  title: z.string().trim().min(2).max(240),
  severity,
  likelihood: z.string().trim().min(1).max(120).optional(),
  impact: z.string().trim().min(1).max(120).optional(),
  cvssVector: z.string().trim().min(1).max(180).optional(),
  cvssScore: z
    .string()
    .regex(/^\d{1,2}(\.\d)?$/)
    .optional(),
  executiveSummary: optionalText,
  technicalDetail: optionalText,
  reproductionSteps: optionalText,
  proofOfConcept: optionalText,
  businessImpact: optionalText,
  technicalImpact: optionalText,
  remediation: optionalText,
  verificationGuidance: optionalText,
  references: z.array(z.string().trim().url().max(2_000)).max(100).optional(),
  mappings,
  clientOwner: z.string().trim().min(1).max(240).optional(),
  dueAt: z.string().date().optional(),
  assetIds: z.array(z.string().uuid()).max(100).optional(),
});

export const patchFindingInput = createFindingInput
  .omit({ engagementId: true, identifier: true, assetIds: true })
  .partial()
  .extend({ changeSummary: text.max(500) });

export const linkFindingEvidenceInput = z.object({
  evidenceIds: z.array(z.string().uuid()).min(1).max(100),
});
