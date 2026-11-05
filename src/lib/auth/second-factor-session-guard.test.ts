import { describe, expect, it, vi } from "vitest";
import {
  createSecondFactorSessionGuard,
  SECOND_FACTOR_REQUIRED_ERROR,
  SECOND_FACTOR_REQUIRED_MESSAGE,
} from "./second-factor-session-guard";

function context(path: string) {
  return {
    path,
    context: { baseURL: "http://127.0.0.1:3000/api/auth" },
    redirect: (url: string) => Object.assign(new Error("FOUND"), { url }),
  };
}

describe("second-factor session guard", () => {
  it.each([
    "/magic-link/verify",
    "/verify-email",
    "/callback/:id",
    "/callback/:id/oauth-proxy",
    "/oauth-proxy-callback",
    "/one-tap/callback",
    "/sign-up/email",
    "/some-future-endpoint",
  ])(
    "blocks %s for a TOTP-enrolled user with a sign-in redirect",
    async (path) => {
      const guard = createSecondFactorSessionGuard(async () => true);
      await expect(
        guard({ userId: "u1" }, context(path)),
      ).rejects.toMatchObject({
        url: `http://127.0.0.1:3000/sign-in?error=${SECOND_FACTOR_REQUIRED_ERROR}`,
      });
    },
  );

  it("allows email-only sign-in for users without a second factor", async () => {
    const guard = createSecondFactorSessionGuard(async () => false);
    await expect(
      guard({ userId: "u1" }, context("/magic-link/verify")),
    ).resolves.toBeUndefined();
  });

  it("allows OAuth callbacks for users without a second factor", async () => {
    const guard = createSecondFactorSessionGuard(async () => false);
    await expect(
      guard({ userId: "u1" }, context("/callback/:id")),
    ).resolves.toBeUndefined();
  });

  it("blocks an endpoint context with no path for a TOTP-enrolled user", async () => {
    const guard = createSecondFactorSessionGuard(async () => true);
    await expect(guard({ userId: "u1" }, { context: {} })).rejects.toThrow(
      SECOND_FACTOR_REQUIRED_MESSAGE,
    );
  });

  it.each([
    "/sign-in/email",
    "/two-factor/verify-totp",
    "/two-factor/verify-backup-code",
    "/two-factor/verify-otp",
    "/passkey/verify-authentication",
  ])("does not look up or block %s", async (path) => {
    const lookup = vi.fn(async () => true);
    const guard = createSecondFactorSessionGuard(lookup);
    await expect(
      guard({ userId: "u1" }, context(path)),
    ).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not block sessions created outside an endpoint", async () => {
    const guard = createSecondFactorSessionGuard(async () => true);
    await expect(guard({ userId: "u1" }, null)).resolves.toBeUndefined();
  });
});
