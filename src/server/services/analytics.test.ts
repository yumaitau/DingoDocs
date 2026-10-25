import { describe, expect, it } from "vitest";
import { startOfUtcMonthsAgo } from "./analytics";

describe("startOfUtcMonthsAgo", () => {
  it("does not skip short months when today is the 31st", () => {
    const now = new Date("2026-07-31T15:30:00.000Z");
    expect(startOfUtcMonthsAgo(now, 5).toISOString()).toBe(
      "2026-02-01T00:00:00.000Z",
    );
  });

  it("crosses year boundaries", () => {
    const now = new Date("2026-03-31T00:00:00.000Z");
    expect(startOfUtcMonthsAgo(now, 5).toISOString()).toBe(
      "2025-10-01T00:00:00.000Z",
    );
  });
});
