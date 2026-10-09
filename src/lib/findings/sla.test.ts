import { describe, expect, it } from "vitest";
import { dueAtFromSla } from "./sla";

const from = new Date("2026-01-01T00:00:00.000Z");

describe("dueAtFromSla", () => {
  it("prefers the client policy over the organisation default", () => {
    const due = dueAtFromSla({
      severity: "high",
      clientId: "client-1",
      from,
      policies: [
        { severity: "high", days: 30, clientId: null },
        { severity: "high", days: 7, clientId: "client-1" },
      ],
    });
    expect(due?.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });

  it("falls back to the organisation policy", () => {
    const due = dueAtFromSla({
      severity: "critical",
      clientId: "client-1",
      from,
      policies: [{ severity: "critical", days: 3, clientId: null }],
    });
    expect(due?.toISOString()).toBe("2026-01-04T00:00:00.000Z");
  });

  it("returns undefined when no policy matches", () => {
    expect(
      dueAtFromSla({
        severity: "low",
        clientId: "client-1",
        policies: [{ severity: "high", days: 7, clientId: null }],
      }),
    ).toBeUndefined();
  });
});
