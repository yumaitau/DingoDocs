import { describe, expect, it } from "vitest";
import { redactSensitive } from "./logger";

describe("sensitive-data redaction", () => {
  it("redacts nested secrets and payloads without mutating safe context", () => {
    expect(
      redactSensitive({
        requestId: "req-123",
        authorization: "Bearer token",
        nested: {
          password: "hunter2",
          payload: { evidence: "confidential" },
          durationMs: 12,
        },
      }),
    ).toEqual({
      requestId: "req-123",
      authorization: "[REDACTED]",
      nested: {
        password: "[REDACTED]",
        payload: "[REDACTED]",
        durationMs: 12,
      },
    });
  });
});
