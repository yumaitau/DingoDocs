import { afterEach, describe, expect, it, vi } from "vitest";
import { integrationEncryptionKeyMaterial } from "./crypto";

afterEach(() => {
  vi.restoreAllMocks();
});

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("integration encryption key selection", () => {
  it("throws in production when INTEGRATION_ENCRYPTION_KEY is missing", () => {
    expect(() =>
      integrationEncryptionKeyMaterial(
        env({ NODE_ENV: "production", BETTER_AUTH_SECRET: "auth-secret" }),
      ),
    ).toThrow(/INTEGRATION_ENCRYPTION_KEY/);
  });

  it("ignores BETTER_AUTH_SECRET in production", () => {
    expect(
      integrationEncryptionKeyMaterial(
        env({
          NODE_ENV: "production",
          INTEGRATION_ENCRYPTION_KEY: "integration-key",
          BETTER_AUTH_SECRET: "auth-secret",
        }),
      ),
    ).toBe("integration-key");
  });

  it("prefers INTEGRATION_ENCRYPTION_KEY outside production", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      integrationEncryptionKeyMaterial(
        env({
          NODE_ENV: "development",
          INTEGRATION_ENCRYPTION_KEY: "integration-key",
          BETTER_AUTH_SECRET: "auth-secret",
        }),
      ),
    ).toBe("integration-key");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("uses development fallbacks and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      integrationEncryptionKeyMaterial(
        env({ NODE_ENV: "development", BETTER_AUTH_SECRET: "auth-secret" }),
      ),
    ).toBe("auth-secret");
    expect(
      integrationEncryptionKeyMaterial(env({ NODE_ENV: "development" })),
    ).toBe("development-integration-key");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "INTEGRATION_ENCRYPTION_KEY",
    );
  });
});
