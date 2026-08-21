import { describe, expect, it } from "vitest";
import { summariseScannerIngest } from "./ingest-summary";

describe("scanner ingest summary", () => {
  it("records draft-only language and duplicate counts", () => {
    const summary = summariseScannerIngest({
      adapter: "nuclei",
      filename: "nuclei.jsonl",
      appliedCount: 1,
      items: [
        {
          title: "Apache Path Traversal",
          severity: "critical",
          action: "create",
          assetIdentifier: "app.test",
        },
        {
          title: "TLS issue",
          severity: "high",
          action: "duplicate",
          assetIdentifier: "app.test",
        },
      ],
    });
    expect(summary.created).toBe(1);
    expect(summary.duplicates).toBe(1);
    expect(summary.note).toContain("remain draft");
    expect(summary.note).not.toContain("DingoDocs");
    expect(summary.timeline).toContain("applied 1 draft finding");
  });
});
