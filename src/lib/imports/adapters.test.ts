import { describe, expect, it } from "vitest";
import { parseScannerImport, type ImportAdapterName } from "./adapters";

describe("scanner import adapters", () => {
  const fixtures = {
    nmap: `<nmaprun><host><address addr="10.0.0.1"/><ports><port protocol="tcp" portid="443"><state state="open"/><service name="https"/></port></ports></host></nmaprun>`,
    nessus: `<NessusClientData_v2><Report><ReportHost name="host.test"><ReportItem port="443" protocol="tcp" severity="3" pluginID="100" pluginName="TLS issue"><description>Weak configuration</description><solution>Harden TLS</solution></ReportItem></ReportHost></Report></NessusClientData_v2>`,
    openvas: `<report><results><result><name>OpenVAS issue</name><description>Detail</description><solution>Fix it</solution><threat>High</threat><host>host.test</host><nvt oid="1.2.3"/></result></results></report>`,
    zap: JSON.stringify({
      site: [
        {
          alerts: [
            {
              pluginid: "1",
              alert: "ZAP issue",
              desc: "Detail",
              solution: "Fix",
              risk: "Medium",
              uri: "https://zap.test/path",
            },
          ],
        },
      ],
    }),
    burp: `<issues><issue><serialNumber>1</serialNumber><name>Burp issue</name><issueDetail>Detail</issueDetail><remediationDetail>Fix</remediationDetail><severity>High</severity><host>burp.test</host></issue></issues>`,
    csv: `id,title,severity,host,description\n1,CSV issue,low,csv.test,Detail`,
    json: JSON.stringify({
      findings: [
        {
          id: "1",
          title: "JSON issue",
          severity: "critical",
          host: "json.test",
        },
      ],
    }),
    nuclei: `${JSON.stringify({
      "template-id": "CVE-2021-41773",
      info: {
        name: "Apache Path Traversal",
        severity: "critical",
        description: "A path traversal in Apache httpd.",
        remediation: "Upgrade Apache httpd.",
        reference: ["https://nvd.nist.gov/vuln/detail/CVE-2021-41773"],
      },
      host: "https://nuclei.test",
      port: "443",
      type: "http",
    })}\n${JSON.stringify({
      "template-id": "exposed-panel",
      info: { name: "Exposed admin panel", severity: "medium" },
      host: "10.0.0.8",
      port: "8080",
    })}`,
    sarif: JSON.stringify({
      version: "2.1.0",
      runs: [
        {
          results: [
            {
              ruleId: "js/sql-injection",
              level: "error",
              message: { text: "SQL injection sink" },
              locations: [
                {
                  physicalLocation: {
                    artifactLocation: { uri: "src/db.ts" },
                  },
                },
              ],
            },
          ],
        },
      ],
    }),
    trivy: JSON.stringify({
      Results: [
        {
          Target: "app/package-lock.json",
          Vulnerabilities: [
            {
              VulnerabilityID: "CVE-2023-1234",
              Title: "Prototype pollution",
              Description: "Lodash prototype pollution",
              Severity: "HIGH",
              PrimaryURL: "https://avd.aquasec.com/nvd/cve-2023-1234",
              FixedVersion: "4.17.21",
              PkgName: "lodash",
            },
          ],
          Misconfigurations: [
            {
              ID: "AVD-DS-0001",
              Title: "Root user",
              Description: "Dockerfile runs as root",
              Severity: "MEDIUM",
              Resolution: "Use a non-root USER",
            },
          ],
        },
      ],
    }),
    grype: JSON.stringify({
      matches: [
        {
          vulnerability: {
            id: "CVE-2024-0001",
            severity: "Critical",
            description: "RCE in dependency",
            urls: ["https://nvd.nist.gov/vuln/detail/CVE-2024-0001"],
          },
          artifact: { name: "openssl", version: "1.0.2" },
        },
      ],
    }),
    nikto: `<niktoscan><scandetails targetip="10.0.0.5" targethostname="nikto.test"><item id="999990"><description>Retrieved X-Powered-By header: PHP</description><uri>/</uri></item></scandetails></niktoscan>`,
    wpscan: JSON.stringify({
      target_url: "https://wp.test/",
      interesting_findings: [
        {
          type: "headers",
          to_s: "Headers",
          url: "https://wp.test/",
          interesting_entries: ["X-Powered-By: PHP"],
        },
      ],
      vulnerabilities: {
        "CVE-2019-9787": {
          title: "WordPress XSS",
          fixed_in: "5.1.1",
          references: { cve: ["2019-9787"] },
        },
      },
    }),
    testssl: JSON.stringify([
      {
        id: "heartbleed",
        severity: "HIGH",
        finding: "VULNERABLE",
        ip: "10.0.0.9",
        port: "443",
      },
    ]),
    prowler: JSON.stringify([
      {
        CheckTitle: "S3 Bucket Public Access",
        CheckID: "s3_bucket_public_access",
        FindingUniqueId: "prowler-1",
        Severity: "high",
        Status: "FAIL",
        Description: "Bucket allows public ACL",
        ResourceId: "arn:aws:s3:::public-bucket",
        Remediation: {
          Recommendation: { Text: "Block public access" },
        },
      },
    ]),
    scoutsuite: JSON.stringify({
      services: {
        ec2: {
          findings: {
            "ec2-security-group-opens-all-ports": {
              description: "Security group opens all ports to the internet",
              level: "danger",
            },
          },
        },
      },
    }),
    bloodhound: JSON.stringify({
      data: [{ name: "DOMAIN ADMINS@LAB.LOCAL", type: "Group" }],
    }),
    plextrac: JSON.stringify({
      findings: [
        {
          id: "pt-1",
          title: "PlexTrac finding",
          severity: "high",
          description: "Detail",
          remediation: "Fix",
        },
      ],
    }),
    dradis: JSON.stringify({
      findings: [
        {
          id: "dr-1",
          title: "Dradis finding",
          severity: "medium",
          description: "Detail",
          remediation: "Fix",
        },
      ],
    }),
    ghostwriter: JSON.stringify({
      findings: [
        {
          id: "gw-1",
          title: "Ghostwriter finding",
          severity: "low",
          description: "Detail",
          remediation: "Fix",
        },
      ],
    }),
    sysreptor: JSON.stringify({
      findings: [
        {
          id: "sr-1",
          title: "SysReptor finding",
          severity: "critical",
          description: "Detail",
          remediation: "Fix",
        },
      ],
    }),
  } as const;
  const titles: Record<string, string> = {
    nmap: "Open https service",
    nessus: "TLS issue",
    openvas: "OpenVAS issue",
    zap: "ZAP issue",
    burp: "Burp issue",
    csv: "CSV issue",
    json: "JSON issue",
    nuclei: "Apache Path Traversal",
    sarif: "js/sql-injection",
    trivy: "Prototype pollution",
    grype: "CVE-2024-0001",
    nikto: "Retrieved X-Powered-By",
    wpscan: "Headers",
    testssl: "heartbleed",
    prowler: "S3 Bucket Public Access",
    scoutsuite: "Security group opens all ports",
    bloodhound: "DOMAIN ADMINS@LAB.LOCAL",
    plextrac: "PlexTrac finding",
    dradis: "Dradis finding",
    ghostwriter: "Ghostwriter finding",
    sysreptor: "SysReptor finding",
  };
  for (const [adapter, fixture] of Object.entries(fixtures)) {
    it(`normalizes ${adapter}`, () => {
      const [item] = parseScannerImport(
        adapter as ImportAdapterName,
        new TextEncoder().encode(fixture),
      );
      expect(item?.title).toContain(titles[adapter]);
      expect(item?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    });
  }
  it("rejects active XML entities", () => {
    expect(() =>
      parseScannerImport(
        "nmap",
        new TextEncoder().encode(
          `<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><nmaprun>&x;</nmaprun>`,
        ),
      ),
    ).toThrow("not permitted");
  });
  it("maps the leading severity token and ignores parenthetical confidence", () => {
    const cases = [
      ["Medium (High)", "medium"],
      ["Low (Medium)", "low"],
      ["High", "high"],
      ["Very High", "critical"],
      ["very high", "critical"],
      ["critical", "critical"],
      ["4", "critical"],
      ["3", "high"],
      ["2", "medium"],
      ["1", "low"],
      ["0", "informational"],
      ["informational", "informational"],
      ["info", "informational"],
      ["none", "informational"],
      ["", "informational"],
      ["unknown", "informational"],
    ] as const;
    const items = parseScannerImport(
      "json",
      new TextEncoder().encode(
        JSON.stringify({
          findings: cases.map(([severity], index) => ({
            title: `Severity ${index}`,
            severity,
          })),
        }),
      ),
    );
    expect(items.map((item) => item.severity)).toEqual(
      cases.map(([, severity]) => severity),
    );
  });
  it("reads ZAP JSON riskdesc and riskcode without dropping legacy risk", () => {
    const items = parseScannerImport(
      "zap",
      new TextEncoder().encode(
        JSON.stringify({
          site: [
            {
              alerts: [
                {
                  pluginid: "1",
                  alert: "Parenthetical risk",
                  desc: "Detail",
                  solution: "Fix",
                  riskdesc: "Medium (High)",
                  riskcode: "3",
                  uri: "https://zap.test/a",
                },
                {
                  pluginid: "2",
                  alert: "Code only",
                  desc: "Detail",
                  solution: "Fix",
                  riskcode: "1",
                  uri: "https://zap.test/b",
                },
                {
                  pluginid: "3",
                  alert: "Legacy risk",
                  desc: "Detail",
                  solution: "Fix",
                  risk: "Medium",
                  uri: "https://zap.test/c",
                },
              ],
            },
          ],
        }),
      ),
    );
    expect(items.map((item) => [item.title, item.severity])).toEqual([
      ["Parenthetical risk", "medium"],
      ["Code only", "low"],
      ["Legacy risk", "medium"],
    ]);
    const [legacy] = parseScannerImport(
      "zap",
      new TextEncoder().encode(fixtures.zap),
    );
    expect(legacy?.severity).toBe("medium");
  });
  it("unwraps CDATA before stripping XML tags", () => {
    const [item] = parseScannerImport(
      "burp",
      new TextEncoder().encode(
        `<issues><issue><serialNumber>9</serialNumber><name>CDATA issue</name><issueDetail><![CDATA[detail with <b>tag</b>]]></issueDetail><remediationDetail>Fix</remediationDetail><severity>High</severity><host>burp.test</host></issue></issues>`,
      ),
    );
    expect(item?.description).toBe("detail with <b>tag</b>");
  });
  it("normalizes nuclei JSONL hosts and keeps informational-safe severity mapping", () => {
    const items = parseScannerImport(
      "nuclei",
      new TextEncoder().encode(fixtures.nuclei as string),
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "Apache Path Traversal",
      severity: "critical",
      assetIdentifier: "nuclei.test",
      port: 443,
    });
    expect(items[1]?.severity).toBe("medium");
  });
  it("maps SARIF levels error/warning/note/none", () => {
    const items = parseScannerImport(
      "sarif",
      new TextEncoder().encode(
        JSON.stringify({
          runs: [
            {
              results: [
                {
                  ruleId: "a",
                  level: "error",
                  message: { text: "e" },
                },
                {
                  ruleId: "b",
                  level: "warning",
                  message: { text: "w" },
                },
                {
                  ruleId: "c",
                  level: "note",
                  message: { text: "n" },
                },
                {
                  ruleId: "d",
                  level: "none",
                  message: { text: "o" },
                },
              ],
            },
          ],
        }),
      ),
    );
    expect(items.map((item) => item.severity)).toEqual([
      "high",
      "medium",
      "low",
      "informational",
    ]);
  });
  it("parses trivy misconfigurations alongside vulnerabilities", () => {
    const items = parseScannerImport(
      "trivy",
      new TextEncoder().encode(fixtures.trivy),
    );
    expect(items).toHaveLength(2);
    expect(items[0]?.severity).toBe("high");
    expect(items[1]?.title).toBe("Root user");
    expect(items[1]?.severity).toBe("medium");
  });
  it("treats bloodhound nodes as informational assets", () => {
    const [item] = parseScannerImport(
      "bloodhound",
      new TextEncoder().encode(fixtures.bloodhound),
    );
    expect(item).toMatchObject({
      title: "DOMAIN ADMINS@LAB.LOCAL",
      severity: "informational",
      description: "BloodHound Group asset",
    });
  });
});
