import { describe, expect, it } from "vitest";
import { professionalPentestTemplate } from "./professional-template";

describe("professional pentest template", () => {
  it("covers the sections a client-ready penetration test report needs", () => {
    const template = professionalPentestTemplate({
      branding: { organisationName: "Harbour Advisory", whiteLabel: true },
    });
    const types = template.sections.map((section) => section.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "cover",
        "document_control",
        "confidentiality",
        "table_of_contents",
        "executive_summary",
        "severity_ratings",
        "scope",
        "methodology",
        "findings",
        "recommendations",
        "glossary",
        "contacts",
      ]),
    );
    expect(template.branding.whiteLabel).toBe(true);
    expect(template.branding.organisationName).toBe("Harbour Advisory");
    expect(template.reusableContent?.methodology).toMatch(
      /Rules of Engagement/,
    );
    const ids = template.sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
