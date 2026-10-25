import { describe, expect, it, vi } from "vitest";
import {
  createSecondFactorSessionGuard,
  SECOND_FACTOR_REQUIRED_ERROR,
} from "./second-factor-session-guard";

function context(path: string) {
  return {
    path,
    context: { baseURL: "http://127.0.0.1:3000/api/auth" },
    redirect: (url: string) => Object.assign(new Error("FOUND"), { url }),
  };
}

describe("second-factor session guard", () => {
  it.each(["/magic-link/verify", "/verify-email"])(
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

  it.each(["/sign-in/email", "/two-factor/verify-totp", "/callback/:id"])(
    "does not look up or block %s",
    async (path) => {
      const lookup = vi.fn(async () => true);
      const guard = createSecondFactorSessionGuard(lookup);
      await expect(
        guard({ userId: "u1" }, context(path)),
      ).resolves.toBeUndefined();
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it("does not block sessions created outside an endpoint", async () => {
    const guard = createSecondFactorSessionGuard(async () => true);
    await expect(guard({ userId: "u1" }, null)).resolves.toBeUndefined();
  });
});
