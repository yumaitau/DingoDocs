import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  renderReport,
  renderReportHtml,
  renderReportMarkdown,
  type ReportDocumentModel,
} from "./report-renderers";

describe("report renderers", () => {
  it("matches the representative starter-template golden Markdown", async () => {
    const expected = await readFile(
      new URL("./fixtures/starter-report.golden.txt", import.meta.url),
      "utf8",
    );
    expect(renderReportMarkdown(model()).trimEnd()).toBe(expected.trimEnd());
  });

  it("uses one model for safe HTML, JSON, PDF, and DOCX output", async () => {
    const report = model();
    const html = renderReportHtml(report);
    expect(html).toContain("Customer Portal Assessment");
    expect(html).toContain("Finding severity overview");
    expect(html).not.toContain("<script>");
    const json = await renderReport(report, "json");
    expect(JSON.parse(new TextDecoder().decode(json))).toMatchObject({
      reportId: "00000000-0000-4000-8000-000000000001",
      version: 1,
    });
    const pdf = await renderReport(report, "pdf");
    expect(Buffer.from(pdf.subarray(0, 4)).toString()).toBe("%PDF");
    const docx = await renderReport(report, "docx");
    expect(Buffer.from(docx.subarray(0, 2)).toString()).toBe("PK");
    expect(pdf.byteLength).toBeGreaterThan(2_000);
    expect(docx.byteLength).toBeGreaterThan(2_000);
    const xlsx = await renderReport(report, "xlsx");
    expect(Buffer.from(xlsx.subarray(0, 2)).toString()).toBe("PK");
    expect(new TextDecoder().decode(xlsx)).toContain("Findings");
    const pptx = await renderReport(report, "pptx");
    expect(Buffer.from(pptx.subarray(0, 2)).toString()).toBe("PK");
    expect(new TextDecoder().decode(pptx)).toContain("high findings");
  });

  it("keeps commands literal and embeds screenshots in exam exports", async () => {
    const report = model();
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
    report.exam = {
      type: "osai",
      osid: "OS-123456",
      candidateName: "Exam Demo",
      candidateEmail: "demo@example.test",
    };
    const code = 'printf "{{literal}} <script> & value\\n"\n  whoami\n```';
    report.sections = [
      report.sections[0],
      {
        definition: { id: "code", type: "code", title: "Commands" },
        content: code,
      },
      {
        definition: {
          id: "image",
          type: "image",
          title: "Proof",
          options: { imageDataUri: png },
        },
        content: "Test screenshot",
      },
    ];
    const html = renderReportHtml(report);
    expect(html).toContain("OS-123456");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain(png);
    expect(html).not.toContain("<script>");
    expect(renderReportMarkdown(report)).toContain(code);
    expect(renderReportMarkdown(report)).toContain("````");
    report.signatures = [];
    report.sections = report.sections.filter(
      (section) => section.definition.type !== "cover",
    );
    const pdf = await renderReport(report, "pdf");
    expect(
      Buffer.from(pdf)
        .toString("latin1")
        .match(/\/Type \/Page\b/g),
    ).toHaveLength(1);
    expect(Buffer.from(pdf).toString("latin1")).toContain("/Subtype /Image");
    const docx = await renderReport(report, "docx");
    expect(Buffer.from(docx).toString("latin1")).toContain("word/media/");
  });

  it("renders a white-label pentest report without product branding", async () => {
    const report = model();
    report.whiteLabel = true;
    report.tagline = "Confidential security assessment";
    report.organisationName = "Harbour Advisory";
    report.documentControl = [
      { field: "Client", value: "Northstar Systems" },
      { field: "Version", value: "1" },
    ];
    report.severityRatings = [
      { severity: "High", cvss: "7.0 – 8.9", meaning: "Serious weakness." },
    ];
    report.glossary = [{ term: "CVSS", definition: "Severity score." }];
    report.contacts = [
      {
        role: "Prepared by",
        name: "Lead consultant",
        email: "lead@harbour.test",
      },
    ];
    report.recommendations = [
      {
        identifier: "WEB-001",
        title: "Missing object authorisation",
        severity: "high",
        remediation: "Scope every lookup to the active account.",
      },
    ];
    report.sections = [
      ...report.sections.slice(0, 2),
      {
        definition: {
          id: "confidentiality",
          type: "confidentiality",
          title: "Confidentiality and distribution",
        },
        content: "This report is confidential.",
      },
      {
        definition: {
          id: "toc",
          type: "table_of_contents",
          title: "Table of contents",
        },
      },
      {
        definition: {
          id: "ratings",
          type: "severity_ratings",
          title: "Severity classification",
        },
      },
      {
        definition: {
          id: "recommendations",
          type: "recommendations",
          title: "Prioritised recommendations",
        },
      },
      {
        definition: { id: "glossary", type: "glossary", title: "Glossary" },
      },
      {
        definition: { id: "contacts", type: "contacts", title: "Contacts" },
      },
      ...report.sections.slice(2),
    ];
    const html = renderReportHtml(report);
    const markdown = renderReportMarkdown(report);
    expect(html).toContain("Confidential security assessment");
    expect(html).toContain("Harbour Advisory");
    expect(html).toContain("Table of contents");
    expect(html).toContain("Prioritised recommendations");
    expect(html).not.toMatch(/DingoDocs/i);
    expect(markdown).toContain("Severity classification");
    expect(markdown).not.toMatch(/DingoDocs/i);
    const pdf = await renderReport(report, "pdf");
    expect(Buffer.from(pdf.subarray(0, 4)).toString()).toBe("%PDF");
  });
});

function model(): ReportDocumentModel {
  return {
    reportId: "00000000-0000-4000-8000-000000000001",
    reportVersionId: "00000000-0000-4000-8000-000000000002",
    version: 1,
    title: "Customer Portal Assessment",
    organisationName: "Dingo Security",
    clientName: "Northstar Systems",
    engagementName: "Customer portal",
    engagementReference: "ENG-001",
    classification: "Confidential",
    generatedAt: "2026-07-11T00:00:00.000Z",
    theme: {
      primaryColour: "#174b6b",
      accentColour: "#d59b2d",
      bodyFont: "Arial",
      headingFont: "Arial",
      bodySize: 11,
      customCss: "</style><script>alert(1)</script>",
      headerLeft: "Dingo Security",
      headerRight: "Confidential",
      footerLeft: "ENG-001",
      showPageNumbers: true,
      watermark: "CONFIDENTIAL",
    },
    sections: [
      { definition: { id: "cover", type: "cover" } },
      {
        definition: {
          id: "summary",
          type: "executive_summary",
          title: "Executive summary",
        },
        content: "One high-severity finding requires remediation.",
      },
      {
        definition: {
          id: "chart",
          type: "chart",
          title: "Finding severity overview",
        },
      },
      {
        definition: {
          id: "scope",
          type: "scope",
          title: "Assessment scope",
        },
      },
      {
        definition: {
          id: "assets",
          type: "assets",
          title: "Assessed assets",
        },
      },
      {
        definition: {
          id: "findings",
          type: "findings",
          title: "Detailed findings",
        },
      },
      {
        definition: {
          id: "evidence",
          type: "evidence",
          title: "Evidence register",
        },
      },
    ],
    findings: [
      {
        identifier: "WEB-001",
        title: "Missing object authorisation",
        severity: "high",
        status: "ready_for_review",
        executiveSummary: "Users can access another account's invoice.",
        technicalDetail: "The invoice lookup is not tenant scoped.",
        businessImpact: "Invoice data can be disclosed.",
        remediation: "Scope every lookup to the active account.",
        cvssScore: "8.7",
        cvssVector: "CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H",
      },
    ],
    scope: [
      {
        name: "Customer portal",
        value: "portal.northstar.test",
        status: "in_scope",
      },
    ],
    assets: [
      {
        name: "Portal",
        type: "application",
        identifier: "portal.northstar.test",
        criticality: "high",
      },
    ],
    evidence: [
      {
        filename: "proof.png",
        mediaType: "image/png",
        classification: "restricted",
        sha256:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ],
    severityCounts: {
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
      informational: 0,
    },
    signatures: [
      { label: "Prepared by", role: "Lead consultant" },
      { label: "Approved by", role: "Quality assurance" },
    ],
  };
}
