import { describe, expect, it } from "vitest";
import { parseRedactionTerms, redactReportText } from "./redact";

describe("redactReportText", () => {
  it("replaces case-insensitive whole phrases", () => {
    expect(
      redactReportText("Host ACME-DC01 leaked secrets", ["ACME-DC01"]),
    ).toBe("Host [REDACTED] leaked secrets");
    expect(redactReportText("acme-dc01 and ACME-DC01", ["acme-dc01"])).toBe(
      "[REDACTED] and [REDACTED]",
    );
  });

  it("does not redact partial word matches", () => {
    expect(redactReportText("classified classification", ["class"])).toBe(
      "classified classification",
    );
  });

  it("parses comma-separated terms", () => {
    expect(parseRedactionTerms(" alpha, beta , ,gamma ")).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });
});
