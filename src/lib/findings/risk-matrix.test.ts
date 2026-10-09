import { describe, expect, it } from "vitest";
import type { RiskMatrixDefinition } from "@/db/schema/findings";
import { severityFromMatrix } from "./risk-matrix";

const definition: RiskMatrixDefinition = {
  likelihood: [
    { key: "unlikely", label: "Unlikely", order: 1 },
    { key: "likely", label: "Likely", order: 2 },
  ],
  impact: [
    { key: "minor", label: "Minor", order: 1 },
    { key: "major", label: "Major", order: 2 },
  ],
  ratings: [
    {
      likelihood: "unlikely",
      impact: "minor",
      severity: "low",
      label: "Low",
      colour: "#2563eb",
    },
    {
      likelihood: "likely",
      impact: "major",
      severity: "high",
      label: "High",
      colour: "#dc2626",
    },
  ],
};

describe("severityFromMatrix", () => {
  it("returns the matching cell severity", () => {
    expect(severityFromMatrix(definition, "likely", "major")).toBe("high");
    expect(severityFromMatrix(definition, "unlikely", "minor")).toBe("low");
  });

  it("returns null when axes or cell are missing", () => {
    expect(severityFromMatrix(definition, "", "major")).toBeNull();
    expect(severityFromMatrix(definition, "likely", "catastrophic")).toBeNull();
  });
});
