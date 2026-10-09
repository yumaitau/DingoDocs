import { describe, expect, it } from "vitest";
import type { ReportDocumentModel } from "./report-renderers";
import { filterClientReportModel } from "./report-client-view";

const allowedSha =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const droppedSha =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const internalSha =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

function model(): ReportDocumentModel {
  return {
    reportId: "00000000-0000-4000-8000-000000000001",
    reportVersionId: "00000000-0000-4000-8000-000000000002",
    version: 1,
    title: "Portal assessment",
    organisationName: "Assessing org",
    clientName: "Client",
    engagementName: "Engagement",
    engagementReference: "ENG-1",
    classification: "Confidential",
    generatedAt: "2026-10-09T00:00:00.000Z",
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
          id: "findings",
          type: "findings",
          title: "Detailed findings",
          condition: { field: "hasFindings", operator: "truthy" },
        },
      },
    ],
    findings: [
      {
        identifier: "DRAFT-001",
        title: "Unpublished issue",
        severity: "critical",
        status: "draft",
        remediation: "Do not show this draft remediation.",
      },
      {
        identifier: "PUB-001",
        title: "Published issue",
        severity: "high",
        status: "published",
        remediation: "Patch the published issue.",
      },
      {
        identifier: "LOW-001",
        title: "Published note",
        severity: "low",
        status: "published",
        remediation: null,
      },
    ],
    scope: [],
    assets: [],
    evidence: [
      {
        filename: "restricted.png",
        mediaType: "image/png",
        classification: "restricted",
        sha256: allowedSha,
      },
      {
        filename: "internal.txt",
        mediaType: "text/plain",
        classification: "internal",
        sha256: internalSha,
      },
      {
        filename: "removed.png",
        mediaType: "image/png",
        classification: "client_visible",
        sha256: droppedSha,
      },
      {
        filename: "proof.png",
        mediaType: "image/png",
        classification: "client_visible",
        sha256: allowedSha,
      },
    ],
    severityCounts: {
      critical: 9,
      high: 9,
      medium: 9,
      low: 9,
      informational: 9,
    },
    recommendations: [
      {
        identifier: "DRAFT-001",
        title: "Unpublished issue",
        severity: "critical",
        remediation: "Do not show this draft remediation.",
      },
    ],
    signatures: [],
  };
}

function filtered() {
  const source = model();
  return {
    source,
    result: filterClientReportModel(
      source,
      new Set(["PUB-001", "LOW-001"]),
      new Set([allowedSha, internalSha]),
    ),
  };
}

describe("filterClientReportModel", () => {
  it("drops draft identifiers that are not in the allow-set", () => {
    const { source, result } = filtered();
    expect(result.findings.map((finding) => finding.identifier)).toEqual([
      "PUB-001",
      "LOW-001",
    ]);
    expect(
      result.findings.some((finding) => finding.identifier === "DRAFT-001"),
    ).toBe(false);
    expect(source.findings).toHaveLength(3);
    expect(result.sections).toBe(source.sections);
  });

  it("keeps a published identifier that is in the allow-set", () => {
    const { result } = filtered();
    expect(
      result.findings.find((finding) => finding.identifier === "PUB-001"),
    ).toMatchObject({
      title: "Published issue",
      severity: "high",
      status: "published",
    });
  });

  it("drops restricted and internal evidence", () => {
    const { result } = filtered();
    expect(result.evidence.map((item) => item.filename)).toEqual(["proof.png"]);
    expect(
      result.evidence.every((item) => item.classification === "client_visible"),
    ).toBe(true);
  });

  it("keeps client_visible evidence whose sha256 is allowed", () => {
    const { result } = filtered();
    expect(result.evidence).toEqual([
      {
        filename: "proof.png",
        mediaType: "image/png",
        classification: "client_visible",
        sha256: allowedSha,
      },
    ]);
  });

  it("recomputes severityCounts and recommendations from kept findings only", () => {
    const { result } = filtered();
    expect(result.severityCounts).toEqual({
      critical: 0,
      high: 1,
      medium: 0,
      low: 1,
      informational: 0,
    });
    expect(result.recommendations).toEqual([
      {
        identifier: "PUB-001",
        title: "Published issue",
        severity: "high",
        remediation: "Patch the published issue.",
      },
    ]);
  });
});
