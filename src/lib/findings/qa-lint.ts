export type QaFindingInput = {
  id: string;
  identifier: string;
  remediation?: string | null;
  technicalDetail?: string | null;
  executiveSummary?: string | null;
  reproductionSteps?: string | null;
  proofOfConcept?: string | null;
  businessImpact?: string | null;
  technicalImpact?: string | null;
  verificationGuidance?: string | null;
  references?: string[] | null;
};

export type QaLintIssue = {
  findingId?: string;
  identifier?: string;
  code:
    | "missing_remediation"
    | "empty_technical_detail"
    | "placeholder_token"
    | "unreferenced_evidence"
    | "grammar";
  message: string;
};

const PLACEHOLDER = /\b(TODO|TBD|XXXX)\b/i;

function narrativeBlob(finding: QaFindingInput) {
  return [
    finding.remediation,
    finding.technicalDetail,
    finding.executiveSummary,
    finding.reproductionSteps,
    finding.proofOfConcept,
    finding.businessImpact,
    finding.technicalImpact,
    finding.verificationGuidance,
    ...(finding.references ?? []),
  ]
    .filter(Boolean)
    .join("\n");
}

export function lintFindings(input: {
  findings: QaFindingInput[];
  evidenceIds: string[];
}): QaLintIssue[] {
  const issues: QaLintIssue[] = [];
  const mentioned = new Set<string>();

  for (const finding of input.findings) {
    if (!finding.remediation?.trim()) {
      issues.push({
        findingId: finding.id,
        identifier: finding.identifier,
        code: "missing_remediation",
        message: `${finding.identifier} is missing remediation`,
      });
    }
    if (!finding.technicalDetail?.trim()) {
      issues.push({
        findingId: finding.id,
        identifier: finding.identifier,
        code: "empty_technical_detail",
        message: `${finding.identifier} has empty technical detail`,
      });
    }
    const blob = narrativeBlob(finding);
    if (PLACEHOLDER.test(blob)) {
      issues.push({
        findingId: finding.id,
        identifier: finding.identifier,
        code: "placeholder_token",
        message: `${finding.identifier} still contains TODO/TBD/XXXX placeholders`,
      });
    }
    for (const evidenceId of input.evidenceIds) {
      if (blob.includes(evidenceId)) mentioned.add(evidenceId);
    }
  }

  for (const evidenceId of input.evidenceIds) {
    if (mentioned.has(evidenceId)) continue;
    issues.push({
      code: "unreferenced_evidence",
      message: `Evidence ${evidenceId} is not mentioned in any finding narrative`,
    });
  }

  return issues;
}
