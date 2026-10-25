import { describe, expect, it } from "vitest";
import {
  PATHNAME_HEADER,
  PATHNAME_SIGNATURE_HEADER,
  signPathname,
  verifiedPathname,
  verifiedPathnameFromHeaders,
} from "./pathname-signature";
import { DEVELOPMENT_AUTH_SECRET, resolveAuthSecret } from "./secret";

const secret = "test-secret-at-least-32-characters-long";

describe("pathname signature", () => {
  it("ignores a spoofed pathname without a signature", () => {
    const headers = new Headers({ [PATHNAME_HEADER]: "/account/security" });
    expect(verifiedPathnameFromHeaders(headers, secret)).toBeNull();
    expect(verifiedPathname("/account/security", null, secret)).toBeNull();
  });

  it("returns the pathname when the proxy signature verifies", () => {
    const signature = signPathname("/account/security", secret);
    const headers = new Headers({
      [PATHNAME_HEADER]: "/account/security",
      [PATHNAME_SIGNATURE_HEADER]: signature!,
    });
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifiedPathnameFromHeaders(headers, secret)).toBe(
      "/account/security",
    );
  });

  it("rejects tampered pathnames, signatures and other secrets", () => {
    const signature = signPathname("/engagements", secret)!;
    expect(verifiedPathname("/account/security", signature, secret)).toBeNull();
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    expect(verifiedPathname("/engagements", flipped, secret)).toBeNull();
    expect(
      verifiedPathname("/engagements", `${signature}x`, secret),
    ).toBeNull();
    expect(
      verifiedPathname("/engagements", signature, "a-different-secret"),
    ).toBeNull();
  });

  it("refuses to sign or verify without a secret", () => {
    expect(signPathname("/engagements", null)).toBeNull();
    const signature = signPathname("/engagements", secret)!;
    expect(verifiedPathname("/engagements", signature, null)).toBeNull();
  });

  it("resolves the same secret as auth.ts, with a non-production fallback", () => {
    expect(resolveAuthSecret({ BETTER_AUTH_SECRET: secret })).toBe(secret);
    expect(resolveAuthSecret({ NODE_ENV: "development" })).toBe(
      DEVELOPMENT_AUTH_SECRET,
    );
    expect(resolveAuthSecret({ NODE_ENV: "production" })).toBeNull();
  });
});
