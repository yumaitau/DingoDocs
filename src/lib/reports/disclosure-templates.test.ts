import { describe, expect, it } from "vitest";
import { parseReportSections } from "./layout";
import {
  cveAdvisoryTemplate,
  pocExploitTemplate,
} from "./disclosure-templates";

describe.each([
  ["CVE advisory", cveAdvisoryTemplate],
  ["PoC exploit write-up", pocExploitTemplate],
])("%s starter", (_name, template) => {
  it("passes the server's section validation", () => {
    const definition = template();
    // Same validation the server applies when the template is saved.
    expect(() => parseReportSections(definition.sections)).not.toThrow();
  });

  it("does not pull engagement findings into a standalone write-up", () => {
    const types = template().sections.map((section) => section.type);
    expect(types).not.toContain("findings");
    expect(types).not.toContain("recommendations");
    expect(types).toEqual(expect.arrayContaining(["cover", "code", "image"]));
  });
});

it("advisory covers the fields a CNA needs for a CVE record", () => {
  const titles = cveAdvisoryTemplate().sections.map((section) => section.title);
  expect(titles).toEqual(
    expect.arrayContaining([
      "Identifiers and severity",
      "Affected products and versions",
      "Disclosure timeline",
      "Credits",
      "References",
    ]),
  );
});
