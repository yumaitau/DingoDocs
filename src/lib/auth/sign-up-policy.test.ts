import { describe, expect, it, vi } from "vitest";
import {
  createSignUpGuard,
  SIGN_UP_DISABLED_CODE,
  signUpMode,
} from "./sign-up-policy";

const user = { email: " Invitee@Example.com " };

describe("signUpMode", () => {
  it("defaults to open", () => {
    expect(signUpMode({})).toBe("open");
  });

  it.each(["open", "invite", "closed", " Closed "])("accepts %s", (value) => {
    expect(signUpMode({ SIGN_UP_MODE: value })).toBe(
      value.trim().toLowerCase(),
    );
  });

  it("rejects unknown values instead of failing open", () => {
    expect(() => signUpMode({ SIGN_UP_MODE: "disabled" })).toThrow(
      /SIGN_UP_MODE/,
    );
  });
});

describe("sign-up guard", () => {
  it("allows every path when open", async () => {
    const lookup = vi.fn();
    const guard = createSignUpGuard("open", lookup);
    await expect(
      guard(user, { path: "/sign-up/email" }),
    ).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    "/sign-up/email",
    "/magic-link/verify",
    "/callback/:id",
    "/oauth2/callback/:providerId",
    "/some-future-endpoint",
  ])("refuses %s when closed", async (path) => {
    const guard = createSignUpGuard("closed", async () => true);
    await expect(guard(user, { path })).rejects.toMatchObject({
      body: { code: SIGN_UP_DISABLED_CODE },
    });
  });

  it.each(["/sso/saml/:orgSlug/acs", "/admin/create-user"])(
    "keeps %s available when closed",
    async (path) => {
      const guard = createSignUpGuard("closed", async () => false);
      await expect(guard(user, { path })).resolves.toBeUndefined();
    },
  );

  it("allows server-side creation without an endpoint context", async () => {
    const guard = createSignUpGuard("closed", async () => false);
    await expect(guard(user, null)).resolves.toBeUndefined();
  });

  it("allows an invited email in invite mode", async () => {
    const lookup = vi.fn(async () => true);
    const guard = createSignUpGuard("invite", lookup);
    await expect(
      guard(user, { path: "/sign-up/email" }),
    ).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledWith("invitee@example.com");
  });

  it("refuses an email without a pending invitation in invite mode", async () => {
    const guard = createSignUpGuard("invite", async () => false);
    await expect(guard(user, { path: "/sign-up/email" })).rejects.toMatchObject(
      { body: { code: SIGN_UP_DISABLED_CODE } },
    );
  });
});
