import type { ReportDocumentModel } from "./report-renderers";

export type ReportVersionDiff = {
  added: string[];
  removed: string[];
  changed: string[];
  changedSections: string[];
};

function findingSignature(finding: ReportDocumentModel["findings"][number]) {
  return JSON.stringify({
    title: finding.title,
    severity: finding.severity,
    status: finding.status,
    executiveSummary: finding.executiveSummary ?? "",
    technicalDetail: finding.technicalDetail ?? "",
    reproductionSteps: finding.reproductionSteps ?? "",
    proofOfConcept: finding.proofOfConcept ?? "",
    businessImpact: finding.businessImpact ?? "",
    technicalImpact: finding.technicalImpact ?? "",
    remediation: finding.remediation ?? "",
    cvssScore: finding.cvssScore ?? "",
    cvssVector: finding.cvssVector ?? "",
    references: finding.references ?? [],
    mappings: finding.mappings ?? [],
    affectedAssets: finding.affectedAssets ?? [],
    cwe: finding.cwe ?? "",
    owasp: finding.owasp ?? "",
    attackTechniques: finding.attackTechniques ?? [],
    cve: finding.cve ?? "",
    epssScore: finding.epssScore ?? "",
    kev: finding.kev ?? false,
    complianceTags: finding.complianceTags ?? [],
  });
}

export function diffReportVersions(
  left: ReportDocumentModel,
  right: ReportDocumentModel,
): ReportVersionDiff {
  const leftMap = new Map(
    left.findings.map((finding) => [finding.identifier, finding]),
  );
  const rightMap = new Map(
    right.findings.map((finding) => [finding.identifier, finding]),
  );
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const identifier of rightMap.keys()) {
    if (!leftMap.has(identifier)) added.push(identifier);
  }
  for (const identifier of leftMap.keys()) {
    if (!rightMap.has(identifier)) removed.push(identifier);
  }
  for (const [identifier, leftFinding] of leftMap) {
    const rightFinding = rightMap.get(identifier);
    if (!rightFinding) continue;
    if (findingSignature(leftFinding) !== findingSignature(rightFinding))
      changed.push(identifier);
  }
  const leftSections = new Map(
    left.sections.map((section) => [
      section.definition.id,
      {
        title: section.definition.title ?? section.definition.type,
        content: section.content ?? "",
        type: section.definition.type,
      },
    ]),
  );
  const changedSections: string[] = [];
  for (const section of right.sections) {
    const previous = leftSections.get(section.definition.id);
    const title = section.definition.title ?? section.definition.type;
    if (!previous) {
      changedSections.push(title);
      continue;
    }
    if (
      previous.content !== (section.content ?? "") ||
      previous.title !== title ||
      previous.type !== section.definition.type
    )
      changedSections.push(title);
  }
  for (const [id, previous] of leftSections) {
    if (!right.sections.some((section) => section.definition.id === id))
      changedSections.push(previous.title);
  }
  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
    changedSections: [...new Set(changedSections)],
  };
}
