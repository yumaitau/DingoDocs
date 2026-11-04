import { describe, expect, it, vi } from "vitest";
import {
  isAllowedForRevokedSession,
  revokedSessionCheck,
  SESSION_REVOKED_CODE,
} from "./revoked-session-guard";

type Guard = ReturnType<typeof revokedSessionCheck>;

function run(guard: Guard, path: string, token: string | null = "token") {
  return guard({
    path,
    getSignedCookie: async () => token,
    context: {
      secret: "secret",
      authCookies: { sessionToken: { name: "better-auth.session_token" } },
    },
  });
}

describe("revoked session guard", () => {
  it.each([
    "/passkey/generate-register-options",
    "/passkey/verify-registration",
    "/change-password",
    "/two-factor/enable",
    "/two-factor/verify-totp",
    "/two-factor/verify-otp",
    "/admin/impersonate-user",
    "/link-social",
    "/update-user",
    "/a-future-endpoint",
  ])("refuses %s for a revoked session", async (path) => {
    expect(isAllowedForRevokedSession(path)).toBe(false);
    const guard = revokedSessionCheck(async () => true);
    await expect(run(guard, path)).rejects.toMatchObject({
      body: { code: SESSION_REVOKED_CODE },
    });
  });

  it.each([
    "/get-session",
    "/sign-out",
    "/sign-in/email",
    "/sign-in/social",
    "/callback/:id",
    "/magic-link/verify",
    "/passkey/verify-authentication",
    "/reset-password/:token",
  ])("lets a revoked session reach %s without a lookup", async (path) => {
    const lookup = vi.fn(async () => true);
    await expect(
      run(revokedSessionCheck(lookup), path),
    ).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("allows sessions that are not revoked and requests without a cookie", async () => {
    await expect(
      run(
        revokedSessionCheck(async () => false),
        "/change-password",
      ),
    ).resolves.toBeUndefined();
    const lookup = vi.fn(async () => true);
    await expect(
      run(revokedSessionCheck(lookup), "/change-password", null),
    ).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });
});
