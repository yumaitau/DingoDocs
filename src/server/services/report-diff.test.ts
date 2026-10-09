import { describe, expect, it } from "vitest";
import { diffReportVersions } from "./report-diff";
import type { ReportDocumentModel } from "./report-renderers";

function base(): ReportDocumentModel {
  return {
    reportId: "r1",
    reportVersionId: "v1",
    version: 1,
    title: "Report",
    organisationName: "Org",
    clientName: "Client",
    engagementName: "Eng",
    engagementReference: "ENG-1",
    classification: "Confidential",
    generatedAt: "2026-01-01T00:00:00.000Z",
    theme: {
      primaryColour: "#174b6b",
      accentColour: "#d59b2d",
      bodyFont: "Arial",
      headingFont: "Arial",
      bodySize: 11,
      showPageNumbers: true,
    },
    sections: [
      {
        definition: {
          id: "summary",
          type: "executive_summary",
          title: "Summary",
        },
        content: "One finding.",
      },
      { definition: { id: "findings", type: "findings", title: "Findings" } },
    ],
    findings: [
      {
        identifier: "WEB-001",
        title: "Broken auth",
        severity: "high",
        status: "published",
        remediation: "Fix it",
      },
    ],
    scope: [],
    assets: [],
    evidence: [],
    severityCounts: { high: 1 },
    signatures: [],
  };
}

describe("diffReportVersions", () => {
  it("reports added, removed, changed findings and section titles", () => {
    const left = base();
    const right = base();
    right.findings = [
      {
        identifier: "WEB-001",
        title: "Broken auth",
        severity: "critical",
        status: "published",
        remediation: "Fix it now",
      },
      {
        identifier: "WEB-002",
        title: "XSS",
        severity: "medium",
        status: "published",
      },
    ];
    right.sections[0]!.content = "Two findings.";
    left.findings.push({
      identifier: "NET-001",
      title: "Open port",
      severity: "low",
      status: "published",
    });
    const diff = diffReportVersions(left, right);
    expect(diff.added).toEqual(["WEB-002"]);
    expect(diff.removed).toEqual(["NET-001"]);
    expect(diff.changed).toEqual(["WEB-001"]);
    expect(diff.changedSections).toContain("Summary");
  });
});
