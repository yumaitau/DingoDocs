import type { ReportTemplateDefinition } from "@/db/schema";

export const DEFAULT_PENTEST_GLOSSARY: Array<{
  term: string;
  definition: string;
}> = [
  {
    term: "CVSS",
    definition:
      "Common Vulnerability Scoring System. A quantitative score describing the technical severity of a finding.",
  },
  {
    term: "CVE",
    definition:
      "Common Vulnerabilities and Exposures. A public identifier for a known vulnerability.",
  },
  {
    term: "CWE",
    definition:
      "Common Weakness Enumeration. A community-developed list of software and hardware weakness types.",
  },
  {
    term: "PoC",
    definition:
      "Proof of concept. Evidence demonstrating that a finding is exploitable under the approved rules of engagement.",
  },
  {
    term: "RoE",
    definition:
      "Rules of Engagement. The authorised testing window, methods, restrictions, and contacts for this assessment.",
  },
  {
    term: "OWASP",
    definition:
      "Open Worldwide Application Security Project. A widely used source of application security testing guidance.",
  },
  {
    term: "PTES",
    definition:
      "Penetration Testing Execution Standard. A structured approach covering pre-engagement, intelligence gathering, threat modelling, exploitation, and reporting.",
  },
];

export const DEFAULT_SEVERITY_RATINGS: Array<{
  severity: string;
  cvss: string;
  meaning: string;
}> = [
  {
    severity: "Critical",
    cvss: "9.0 – 10.0",
    meaning:
      "Immediate, exploitable compromise of confidentiality, integrity, or availability with organisation-wide impact. Remediate as an incident.",
  },
  {
    severity: "High",
    cvss: "7.0 – 8.9",
    meaning:
      "A serious weakness that is practical to exploit and can cause material business or regulatory harm. Prioritise in the current change window.",
  },
  {
    severity: "Medium",
    cvss: "4.0 – 6.9",
    meaning:
      "A meaningful control gap that an attacker can combine with other issues. Schedule remediation in the next planned cycle.",
  },
  {
    severity: "Low",
    cvss: "0.1 – 3.9",
    meaning:
      "Limited impact in isolation. Address as part of hygiene and defence-in-depth improvements.",
  },
  {
    severity: "Informational",
    cvss: "0.0",
    meaning:
      "An observation that does not currently present a practical exploit path. Recorded to support hardening and future assessments.",
  },
];

export const DEFAULT_CONFIDENTIALITY_NOTICE = `This report is confidential and intended solely for the named client. It may contain information that could assist an attacker if disclosed. Recipients must store, transmit, and destroy the document according to the classification marked on every page.

Do not forward this report, screenshots, or extracts outside the authorised distribution list without written approval from the assessing organisation. Findings remain valid only for the tested systems, the approved scope, and the testing window recorded in this document.

Nothing in this report constitutes a warranty that the environment is free of vulnerabilities. Testing is time-boxed, risk-based, and constrained by the Rules of Engagement.`;

export const DEFAULT_METHODOLOGY = `Testing followed a risk-based methodology aligned with the Penetration Testing Execution Standard and, where applicable, OWASP application testing guidance. Work was constrained by the approved Rules of Engagement.

1. Pre-engagement and scoping — confirm in-scope assets, exclusions, testing windows, authorised methods, and emergency contacts.
2. Reconnaissance and discovery — identify exposed services, application surfaces, identities, and trust boundaries using approved tooling.
3. Vulnerability analysis — combine automated scanners with manual verification. Scanner output is treated as untrusted until a consultant confirms impact.
4. Exploitation and proof — demonstrate practical risk only where authorised. Proof of concept is limited to the minimum evidence required.
5. Post-exploitation and impact — assess blast radius, data exposure, and privilege pathways without unnecessary persistence.
6. Reporting and verification guidance — document each confirmed finding with business impact, reproduction, and remediation that a client engineer can action.

Automated scanners and MCP-connected tools may contribute notes, evidence, and draft findings throughout the engagement. Those drafts are not client-visible until they complete the assessing organisation's review and publication workflow.`;

export function professionalPentestTemplate(
  overrides: Omit<Partial<ReportTemplateDefinition>, "branding"> & {
    branding?: Partial<ReportTemplateDefinition["branding"]>;
  } = {},
): ReportTemplateDefinition {
  const branding = {
    primaryColour: "#174b6b",
    accentColour: "#d59b2d",
    whiteLabel: true,
    tagline: "Confidential security assessment",
    ...overrides.branding,
  };
  return {
    sections: [
      { id: "cover", type: "cover" },
      {
        id: "document-control",
        type: "document_control",
        title: "Document control",
      },
      {
        id: "confidentiality",
        type: "confidentiality",
        title: "Confidentiality and distribution",
        content: DEFAULT_CONFIDENTIALITY_NOTICE,
      },
      {
        id: "toc",
        type: "table_of_contents",
        title: "Table of contents",
        options: { pageBreakBefore: true },
      },
      {
        id: "executive-summary",
        type: "executive_summary",
        title: "Executive summary",
        content:
          "This report presents the outcomes of {{engagement.name}} ({{engagement.reference}}) performed for {{client.name}} between {{engagement.startDate}} and {{engagement.endDate}}.",
      },
      {
        id: "severity-ratings",
        type: "severity_ratings",
        title: "Severity classification",
      },
      {
        id: "severity-chart",
        type: "chart",
        title: "Finding severity overview",
        condition: { field: "hasFindings", operator: "truthy" },
      },
      {
        id: "scope",
        type: "scope",
        title: "Project scope",
      },
      {
        id: "exclusions",
        type: "prose",
        title: "Exclusions and constraints",
        content:
          "{{engagement.constraints}}\n\nTesting was limited to the approved scope, methods, and window. Out-of-scope systems were not assessed.",
      },
      {
        id: "methodology",
        type: "methodology",
        title: "Assessment methodology",
        reusableKey: "methodology",
      },
      {
        id: "findings",
        type: "findings",
        title: "Technical findings",
        options: { pageBreakBefore: true },
      },
      {
        id: "recommendations",
        type: "recommendations",
        title: "Prioritised recommendations",
      },
      { id: "assets", type: "assets", title: "Assessed assets" },
      {
        id: "evidence",
        type: "evidence",
        title: "Evidence register",
        condition: { field: "hasEvidence", operator: "truthy" },
      },
      {
        id: "glossary",
        type: "glossary",
        title: "Appendix A — Glossary",
        options: { pageBreakBefore: true },
      },
      {
        id: "contacts",
        type: "contacts",
        title: "Appendix B — Contacts",
      },
      {
        id: "appendix",
        type: "appendix",
        title: "Appendix C — Report controls",
        content:
          "This document is controlled according to the classification shown in its header and footer. Published versions are immutable. Subsequent corrections are issued as a new numbered revision.",
      },
    ],
    reusableContent: {
      methodology: DEFAULT_METHODOLOGY,
      ...overrides.reusableContent,
    },
    variables: { ...overrides.variables },
    branding,
    typography: {
      bodyFont: "Arial",
      headingFont: "Arial",
      bodySize: 11,
      ...overrides.typography,
    },
    header: {
      left: "{{organisation.name}}",
      right: "{{report.classification}}",
      showRule: true,
      ...overrides.header,
    },
    footer: {
      left: "{{engagement.reference}}",
      showPageNumbers: true,
      ...overrides.footer,
    },
    watermark: overrides.watermark ?? "CONFIDENTIAL",
    classification: overrides.classification ?? "Confidential",
    approvals: overrides.approvals ?? [
      { role: "peer_reviewer", required: true },
      { role: "quality_assurance", required: true },
    ],
    signatures: overrides.signatures ?? [
      { label: "Prepared by", role: "Lead consultant" },
      { label: "Approved by", role: "Quality assurance" },
      { label: "Accepted by", role: "Client representative" },
    ],
  };
}
