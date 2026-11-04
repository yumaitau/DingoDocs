import { describe, expect, it } from "vitest";
import {
  apiKeyDateBounds,
  apiKeyExpiryFromDate,
  assertApiKeyExpiry,
} from "./key-lifetime";

const now = new Date("2026-11-04T10:00:00.000Z");
const day = 86_400_000;

describe("API key lifetime", () => {
  it("defaults to 90 days when no date is chosen", () => {
    expect(apiKeyExpiryFromDate(undefined, now).getTime()).toBe(
      now.getTime() + 90 * day,
    );
  });

  it("expires at the end of the chosen UTC day", () => {
    expect(apiKeyExpiryFromDate("2026-12-01", now).toISOString()).toBe(
      "2026-12-01T23:59:59.999Z",
    );
  });

  it("accepts the last selectable date by capping at 365 days", () => {
    const { max } = apiKeyDateBounds(now);
    expect(max).toBe("2027-11-04");
    expect(apiKeyExpiryFromDate(max, now).getTime()).toBe(
      now.getTime() + 365 * day,
    );
  });

  it("rejects dates beyond 365 days or in the past", () => {
    expect(() => apiKeyExpiryFromDate("2027-11-05", now)).toThrow(
      "within 365 days",
    );
    expect(() => apiKeyExpiryFromDate("2026-11-03", now)).toThrow(
      "in the future",
    );
    expect(() =>
      assertApiKeyExpiry(new Date(now.getTime() + 366 * day), now),
    ).toThrow("within 365 days");
  });
});
