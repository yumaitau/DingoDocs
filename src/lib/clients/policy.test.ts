import { describe, expect, it } from "vitest";
import { applyClientReportPreferences, positiveDays } from "./policy";
import type { ReportTemplateDefinition } from "@/db/schema";

const definition: ReportTemplateDefinition = {
  sections: [],
  branding: { primaryColour: "#000", accentColour: "#111" },
  typography: { bodyFont: "Helvetica", headingFont: "Helvetica", bodySize: 11 },
  header: {},
  footer: {},
  classification: "Confidential",
};
const template = { definition };

describe("client report preferences", () => {
  it("applies page size and redaction only when the template left them empty", () => {
    const next = applyClientReportPreferences(template, {
      pageSize: "A4",
      redactionTerms: "secret-host",
    });
    expect(next.definition.typography.pageSize).toBe("A4");
    expect(next.definition.variables?.redactionTerms).toBe("secret-host");
    expect(template.definition.typography.pageSize).toBeUndefined();
  });

  it("keeps an explicit template page size", () => {
    const pinned = applyClientReportPreferences(
      {
        definition: {
          ...template.definition,
          typography: { ...template.definition.typography, pageSize: "LETTER" },
        },
      },
      { pageSize: "A4" },
    );
    expect(pinned.definition.typography.pageSize).toBe("LETTER");
  });
});

describe("positiveDays", () => {
  it("rejects zero, blank, and non-numeric values", () => {
    expect(positiveDays(0)).toBeUndefined();
    expect(positiveDays("")).toBeUndefined();
    expect(positiveDays("14")).toBe(14);
  });
});
