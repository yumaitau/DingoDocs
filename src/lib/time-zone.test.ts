import { describe, expect, it } from "vitest";
import {
  formatDateTime,
  isSupportedTimeZone,
  parseDateTimeInTimeZone,
} from "./time-zone";

describe("time-zone handling", () => {
  it("formats one UTC instant differently for each user time zone", () => {
    const instant = new Date("2026-09-02T00:15:00.000Z");

    expect(formatDateTime(instant, "Australia/Sydney")).toContain("10:15 am");
    expect(formatDateTime(instant, "America/New_York")).toContain("8:15 pm");
  });

  it("converts a user's wall time to the correct UTC instant", () => {
    expect(
      parseDateTimeInTimeZone(
        "2026-09-02T08:30",
        "Australia/Sydney",
      ).toISOString(),
    ).toBe("2026-09-01T22:30:00.000Z");
  });

  it("rejects a wall time skipped by daylight saving", () => {
    expect(() =>
      parseDateTimeInTimeZone("2026-10-04T02:30", "Australia/Sydney"),
    ).toThrow("does not exist");
  });

  it("accepts IANA time zones and rejects offsets", () => {
    expect(isSupportedTimeZone("Australia/Perth")).toBe(true);
    expect(isSupportedTimeZone("+10:00")).toBe(false);
  });
});
