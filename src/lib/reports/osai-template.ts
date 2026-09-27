import type {
  ReportSectionDefinition,
  ReportTemplateDefinition,
} from "@/db/schema";

export const OSAI_GUIDE_URL =
  "https://help.offsec.com/hc/en-us/articles/46593096734612-OSAI-Exam-Guide";

export function osaiReportTemplate(): ReportTemplateDefinition {
  const sections: ReportSectionDefinition[] = [
    { id: "cover", type: "cover", title: "OffSec AI Red Teamer Exam Report" },
    { id: "contents", type: "table_of_contents", title: "Contents" },
    {
      id: "introduction",
      type: "prose",
      title: "Introduction and assessment objective",
      content:
        "[Write the assessment scope, testing dates, objectives and reporting approach. Describe only work actually performed.]",
    },
    {
      id: "summary",
      type: "executive_summary",
      title: "Executive summary",
      content:
        "[Write an overview of the vulnerabilities, attacks, results and limitations. Summarise the two attack chains, standalone host and shared Domain Controller.]",
    },
    {
      id: "attack-path",
      type: "prose",
      title: "High-level attack path",
      content:
        "[Write the sequence of entry points, pivots, lateral movement and privilege changes. Distinguish each chain and explain where they converge.]",
    },
  ];
  const targets = [
    ...[1, 2].flatMap((chain) =>
      [1, 2, 3].map((host) => ({
        id: `chain-${chain}-host-${host}`,
        title: `Chain ${chain} · Host ${host}`,
      })),
    ),
    { id: "domain-controller", title: "Shared Domain Controller" },
    { id: "standalone", title: "Standalone AI host" },
  ];
  for (const target of targets)
    sections.push(
      {
        id: target.id,
        type: "prose",
        title: `${target.title} — HOSTNAME (IP: X.X.X.X)`,
        options: { pageBreakBefore: true },
        content:
          "[Write target identity, starting access, enumeration, vulnerability, exploitation steps, privilege escalation if applicable, and outcome. State which chain or foothold provided access. For uncompleted targets, state the limitation rather than inventing success.]",
      },
      {
        id: `${target.id}-commands`,
        type: "code",
        title: "Commands, queries, prompts and output",
        content:
          "[Paste the exact commands, AI prompts, payloads, scripts and relevant console output in execution order. Include prerequisites and intermediate results so a reader can repeat each step.]",
      },
      {
        id: `${target.id}-sources`,
        type: "prose",
        title: "Exploit sources and modifications",
        content:
          "[Write source URLs or include the code used, and describe every modification. Record AI tooling and model interactions. Mark not applicable where appropriate.]",
      },
      {
        id: `${target.id}-proof`,
        type: "code",
        title: "Proof and access context",
        content:
          "[Paste the proof retrieval command, exact output and relevant user/host context. Record the shared Domain Controller proof once and cross-reference it from both chains.]",
      },
      {
        id: `${target.id}-screenshot`,
        type: "image",
        title: "Exploitation and proof screenshot",
        content:
          "[Write a caption identifying the host and demonstrated stage. Add more screenshot blocks for each relevant step.]",
      },
    );
  sections.push({
    id: "appendix",
    type: "appendix",
    title: "Appendix — scripts and AI interaction history",
    content:
      "[Write references to supplementary material included in this PDF. Add code blocks for long scripts, prompts and model/session history; include every query as text.]",
  });
  return {
    sections,
    exam: { type: "osai", osid: "", candidateName: "", candidateEmail: "" },
    branding: {
      primaryColour: "#17384d",
      accentColour: "#be6c35",
      whiteLabel: true,
      organisationName: "OffSec AI Red Teamer",
      tagline: "Exam report",
    },
    typography: { bodyFont: "Arial", headingFont: "Arial", bodySize: 11 },
    header: { left: "OSAI exam report" },
    footer: { left: "Confidential", showPageNumbers: true },
    classification: "Confidential — examination submission",
  };
}
