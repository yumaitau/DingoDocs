import { z } from "zod";
import type { ReportSectionDefinition } from "@/db/schema";

export const sectionTypes = [
  "cover",
  "executive_summary",
  "reusable_content",
  "prose",
  "code",
  "image",
  "findings",
  "scope",
  "assets",
  "chart",
  "risk_matrix",
  "evidence",
  "appendix",
  "page_break",
  "table_of_contents",
  "confidentiality",
  "document_control",
  "methodology",
  "severity_ratings",
  "recommendations",
  "glossary",
  "contacts",
] as const;
export const MAX_LAYOUT_LENGTH = 40_000_000;
export const MAX_IMAGE_LENGTH = 8_000_000;

export function safeReportImage(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_IMAGE_LENGTH)
    return undefined;
  return /^data:image\/(?:png|jpeg);base64,(?:iVBORw0KGgo|\/9j\/)[A-Za-z0-9+/]+=*$/.test(
    value,
  )
    ? value
    : undefined;
}

export const examSchema = z.object({
  type: z.literal("osai"),
  osid: z.string().trim().max(30),
  candidateName: z.string().trim().max(200),
  candidateEmail: z.union([z.literal(""), z.email()]).default(""),
});

const sectionSchema = z
  .object({
    id: z.string().min(1).max(100),
    type: z.enum(sectionTypes),
    title: z.string().max(300).optional(),
    content: z.string().max(200_000).optional(),
    reusableKey: z.string().max(100).optional(),
    condition: z
      .object({
        field: z.enum([
          "hasFindings",
          "hasEvidence",
          "hasScope",
          "status",
          "hasCritical",
          "hasHigh",
        ]),
        operator: z.enum(["equals", "not_equals", "truthy"]),
        value: z.union([z.string(), z.boolean()]).optional(),
      })
      .optional(),
    options: z
      .record(
        z.string(),
        z.union([z.string(), z.number().finite(), z.boolean()]),
      )
      .optional(),
  })
  .superRefine((section, ctx) => {
    const uri = section.options?.imageDataUri;
    if (uri && !safeReportImage(uri))
      ctx.addIssue({
        code: "custom",
        message: "Screenshots must be PNG or JPEG images under 8 MB",
        path: ["options", "imageDataUri"],
      });
  });

export function parseReportSections(value: unknown): ReportSectionDefinition[] {
  const sections = z.array(sectionSchema).min(1).max(400).parse(value);
  if (new Set(sections.map((s) => s.id)).size !== sections.length)
    throw new Error("Report block identifiers must be unique");
  return sections;
}

export function osaiFileStem(osid: string) {
  const normalized = osid.trim().toUpperCase();
  if (!/^OS-\d{3,12}$/.test(normalized))
    throw new Error("Enter your OSID as OS- followed by your candidate number");
  return `OSAI-${normalized}-Exam-Report`;
}

export function osaiReadiness(
  sections: ReportSectionDefinition[],
  osid: string,
) {
  const issues: string[] = [];
  try {
    osaiFileStem(osid);
  } catch {
    issues.push("Enter a valid OSID before downloading the exam PDF.");
  }
  const placeholders = sections.filter((s) =>
    /\[Write |\[Paste |\[Enter |HOSTNAME|X\.X\.X\.X/.test(
      `${s.title ?? ""}\n${s.content ?? ""}`,
    ),
  );
  if (placeholders.length)
    issues.push(
      `${placeholders.length} blocks still contain starter instructions. Complete or remove unused blocks.`,
    );
  const missingImages = sections.filter(
    (s) => s.type === "image" && !safeReportImage(s.options?.imageDataUri),
  );
  if (missingImages.length)
    issues.push(
      `${missingImages.length} screenshot blocks need evidence images.`,
    );
  if (!sections.some((s) => s.type === "code" && s.content?.trim()))
    issues.push(
      "Add commands, queries, prompts, scripts and console output as selectable text.",
    );
  return issues;
}
