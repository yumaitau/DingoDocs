import { describe, expect, it } from "vitest";
import { parseScannerImport } from "./adapters";

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
  };
  for (const [adapter, fixture] of Object.entries(fixtures)) {
    it(`normalizes ${adapter}`, () => {
      const [item] = parseScannerImport(
        adapter as keyof typeof fixtures,
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
});
