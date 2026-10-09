import type { RiskMatrixDefinition } from "@/db/schema";
import type {
  ReportDocumentModel,
  ReportFindingModel,
} from "@/server/services/report-renderers";

export type DocumentBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { kind: "paragraph"; label?: string; text: string }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "chart"; counts: Record<string, number> }
  | { kind: "finding"; finding: ReportFindingModel }
  | {
      kind: "risk_matrix";
      matrix: RiskMatrixDefinition;
    };

const FINDING_FIELDS: Array<{
  label: string;
  key: keyof ReportFindingModel;
  format?: "list" | "mappings" | "boolean";
}> = [
  { label: "Technical detail", key: "technicalDetail" },
  { label: "Reproduction steps", key: "reproductionSteps" },
  { label: "Proof of concept", key: "proofOfConcept" },
  { label: "Business impact", key: "businessImpact" },
  { label: "Technical impact", key: "technicalImpact" },
  { label: "Remediation", key: "remediation" },
  { label: "References", key: "references", format: "list" },
  { label: "Mappings", key: "mappings", format: "mappings" },
  { label: "Affected assets", key: "affectedAssets", format: "list" },
  { label: "CWE", key: "cwe" },
  { label: "OWASP", key: "owasp" },
  { label: "Attack techniques", key: "attackTechniques", format: "list" },
  { label: "CVE", key: "cve" },
  { label: "EPSS score", key: "epssScore" },
  { label: "KEV", key: "kev", format: "boolean" },
  { label: "Compliance tags", key: "complianceTags", format: "list" },
];

export function findingFieldBlocks(
  finding: ReportFindingModel,
): Array<{ label: string; text: string }> {
  const fields: Array<{ label: string; text: string }> = [];
  for (const field of FINDING_FIELDS) {
    const raw = finding[field.key];
    let text = "";
    if (field.format === "list" && Array.isArray(raw))
      text = raw.map(String).filter(Boolean).join("\n");
    else if (field.format === "mappings" && Array.isArray(raw))
      text = raw
        .map((item) => {
          if (!item || typeof item !== "object") return String(item);
          const mapping = item as {
            framework?: string;
            reference?: string;
            title?: string;
          };
          return [mapping.framework, mapping.reference, mapping.title]
            .filter(Boolean)
            .join(" — ");
        })
        .filter(Boolean)
        .join("\n");
    else if (field.format === "boolean")
      text = raw === true ? "Yes" : raw === false ? "No" : "";
    else if (typeof raw === "string") text = raw;
    else if (raw != null && !Array.isArray(raw)) text = String(raw);
    fields.push({ label: field.label, text });
  }
  return fields;
}

export function buildReportBlocks(model: ReportDocumentModel): DocumentBlock[] {
  const blocks: DocumentBlock[] = [
    { kind: "chart", counts: model.severityCounts },
  ];
  if (model.riskMatrix)
    blocks.push({ kind: "risk_matrix", matrix: model.riskMatrix });
  for (const finding of model.findings)
    blocks.push({ kind: "finding", finding });
  return blocks;
}

export function blocksForSection(
  model: ReportDocumentModel,
  type: "findings" | "chart" | "risk_matrix",
): DocumentBlock[] {
  if (type === "chart") return [{ kind: "chart", counts: model.severityCounts }];
  if (type === "risk_matrix") {
    const blocks: DocumentBlock[] = [
      { kind: "chart", counts: model.severityCounts },
    ];
    if (model.riskMatrix)
      blocks.push({ kind: "risk_matrix", matrix: model.riskMatrix });
    return blocks;
  }
  return model.findings.map((finding) => ({ kind: "finding" as const, finding }));
}

export function severityChartRows(counts: Record<string, number>) {
  return Object.entries(counts).map(([severity, value]) => [
    severity,
    String(value),
  ]);
}

export function riskMatrixTable(matrix: RiskMatrixDefinition) {
  const impacts = [...matrix.impact].sort((a, b) => a.order - b.order);
  const likelihoods = [...matrix.likelihood].sort((a, b) => a.order - b.order);
  const headers = ["Likelihood \\ Impact", ...impacts.map((item) => item.label)];
  const rows = likelihoods.map((likelihood) => [
    likelihood.label,
    ...impacts.map((impact) => {
      const rating = matrix.ratings.find(
        (item) =>
          item.likelihood === likelihood.key && item.impact === impact.key,
      );
      return rating ? `${rating.label} (${rating.severity})` : "";
    }),
  ]);
  return { headers, rows };
}
