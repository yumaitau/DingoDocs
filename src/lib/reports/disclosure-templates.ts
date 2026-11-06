import type {
  ReportSectionDefinition,
  ReportTemplateDefinition,
} from "@/db/schema";

const CVE_RECORD_FORMAT_URL = "https://www.cve.org/AllResources/CveFormat";
const CVSS_CALCULATOR_URL = "https://www.first.org/cvss/calculator/4.0";

function disclosureTemplate(
  sections: ReportSectionDefinition[],
  label: string,
): ReportTemplateDefinition {
  return {
    sections,
    branding: {
      primaryColour: "#4a1d14",
      accentColour: "#be6c35",
      whiteLabel: true,
      tagline: label,
    },
    typography: { bodyFont: "Arial", headingFont: "Arial", bodySize: 11 },
    header: { left: label },
    footer: { left: "TLP:AMBER until publication", showPageNumbers: true },
    classification: "TLP:AMBER — embargoed until the publication date",
  };
}

/**
 * Security advisory for a vulnerability being assigned or published as a CVE.
 * Section order follows the fields a CNA needs for a CVE record, then the
 * narrative a vendor and the public need.
 */
export function cveAdvisoryTemplate(): ReportTemplateDefinition {
  return disclosureTemplate(
    [
      { id: "cover", type: "cover", title: "Security advisory" },
      {
        id: "summary",
        type: "executive_summary",
        title: "Summary",
        content:
          "[One paragraph: the product, the vulnerability class, who can exploit it (unauthenticated, low-privilege user, local), and the impact. Name the CVE ID once assigned, for example CVE-YYYY-NNNNN.]",
      },
      {
        id: "identifiers",
        type: "prose",
        title: "Identifiers and severity",
        content: `[CVE ID: CVE-YYYY-NNNNN (or "requested from <CNA>")\nCWE: CWE-NNN <name>\nCVSS v4.0: <score> <severity>, vector CVSS:4.0/AV:_/AC:_/AT:_/PR:_/UI:_/VC:_/VI:_/VA:_/SC:_/SI:_/SA:_\nCVSS v3.1 (if the vendor or NVD still uses it): <score>, vector CVSS:3.1/...\nScore with the FIRST calculator: ${CVSS_CALCULATOR_URL}]`,
      },
      {
        id: "affected",
        type: "prose",
        title: "Affected products and versions",
        content:
          "[Vendor, product, component or package name (with ecosystem, such as npm or PyPI), affected version range (from, up to and excluding the fixed version), and platforms. State the versions you actually tested separately from versions you infer are affected.]",
      },
      {
        id: "description",
        type: "prose",
        title: "Vulnerability details",
        content:
          "[Root cause: the vulnerable code path, the missing or flawed check, and why input reaches it. Prerequisites and configuration required. Reference files, functions or endpoints by name.]",
      },
      {
        id: "impact",
        type: "prose",
        title: "Impact",
        content:
          "[What an attacker gains: confidentiality, integrity and availability effects, privilege boundaries crossed, and realistic attack scenarios. Note whether exploitation in the wild is known.]",
      },
      {
        id: "reproduction",
        type: "prose",
        title: "Steps to reproduce",
        content:
          "[Numbered steps from a clean install of an affected version: setup, configuration, each request or action, and the observable result that proves the issue.]",
      },
      {
        id: "poc",
        type: "code",
        title: "Proof of concept",
        content:
          "[Minimal request, script or payload that demonstrates the issue without causing harm beyond the test environment. Keep weaponised exploit code out of public advisories until the embargo ends.]",
      },
      {
        id: "poc-screenshot",
        type: "image",
        title: "Proof of concept output",
        content: "[Caption: what the screenshot shows and the version tested.]",
      },
      {
        id: "remediation",
        type: "prose",
        title: "Remediation and workarounds",
        content:
          "[Fixed version and upgrade path, vendor patch or commit link, and any interim workaround or mitigation with its limitations.]",
      },
      {
        id: "timeline",
        type: "prose",
        title: "Disclosure timeline",
        content:
          "[YYYY-MM-DD: Vulnerability discovered\nYYYY-MM-DD: Reported to vendor via <channel>\nYYYY-MM-DD: Vendor acknowledged\nYYYY-MM-DD: CVE requested from / assigned by <CNA>\nYYYY-MM-DD: Fix released in <version>\nYYYY-MM-DD: Public disclosure]",
      },
      {
        id: "credits",
        type: "prose",
        title: "Credits",
        content:
          "[Researcher names, handles and affiliations as they agreed to be credited.]",
      },
      {
        id: "references",
        type: "appendix",
        title: "References",
        content: `[Vendor advisory, patch commit, issue tracker, CVE record and NVD entry once published. CVE record format: ${CVE_RECORD_FORMAT_URL}]`,
      },
    ],
    "Security advisory",
  );
}

/** Technical write-up of a proof-of-concept exploit. */
export function pocExploitTemplate(): ReportTemplateDefinition {
  return disclosureTemplate(
    [
      {
        id: "cover",
        type: "cover",
        title: "Proof-of-concept exploit write-up",
      },
      { id: "contents", type: "table_of_contents", title: "Contents" },
      {
        id: "overview",
        type: "executive_summary",
        title: "Overview",
        content:
          "[The target, the vulnerability or CVE being exploited, what the exploit achieves (for example unauthenticated remote code execution as the service user), and its reliability.]",
      },
      {
        id: "target",
        type: "prose",
        title: "Target and test environment",
        content:
          "[Product and exact version or commit, operating system and architecture, configuration, network position and the lab setup used. Confirm the environment was owned or authorised for testing.]",
      },
      {
        id: "root-cause",
        type: "prose",
        title: "Vulnerability analysis",
        content:
          "[Root cause with the relevant source, decompiled code or protocol detail, and how attacker-controlled input reaches it. Reference CVE, CWE and any prior research.]",
      },
      {
        id: "vulnerable-code",
        type: "code",
        title: "Vulnerable code path",
        content:
          "[Annotated excerpt of the vulnerable function or request handler.]",
      },
      {
        id: "exploitation",
        type: "prose",
        title: "Exploitation strategy",
        content:
          "[Each stage of the exploit chain: primitives obtained, mitigations bypassed (ASLR, DEP, CSP, authentication, sandboxing), and why each step works. Note any race windows or heap grooming.]",
      },
      {
        id: "exploit-code",
        type: "code",
        title: "Exploit code",
        content:
          "[Full exploit with usage instructions, dependencies and configurable parameters. Note the source of any reused code and every modification.]",
      },
      {
        id: "execution",
        type: "code",
        title: "Execution and output",
        content:
          "[Exact command line and console output from a successful run.]",
      },
      {
        id: "execution-screenshot",
        type: "image",
        title: "Successful exploitation",
        content:
          "[Caption: the access or effect demonstrated, host and user context.]",
      },
      {
        id: "reliability",
        type: "prose",
        title: "Reliability and limitations",
        content:
          "[Success rate across runs, versions and configurations tested, known failure modes, side effects on the target and clean-up steps.]",
      },
      {
        id: "detection",
        type: "prose",
        title: "Detection and mitigation",
        content:
          "[Log entries, network signatures or host artefacts defenders can look for, and the fix or configuration change that stops the exploit.]",
      },
      {
        id: "references",
        type: "appendix",
        title: "References",
        content:
          "[CVE record, vendor advisory, patch, and prior research or public exploits consulted.]",
      },
    ],
    "PoC exploit write-up",
  );
}
