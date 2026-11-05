import { describe, expect, it } from "vitest";
import {
  PATHNAME_HEADER,
  PATHNAME_SIGNATURE_HEADER,
  REQUEST_METHOD_HEADER,
  signRequest,
  verifiedRequest,
  verifiedRequestFromHeaders,
} from "./pathname-signature";
import { DEVELOPMENT_AUTH_SECRET, resolveAuthSecret } from "./secret";

const secret = "test-secret-at-least-32-characters-long";

describe("request signature", () => {
  const get = { method: "GET", pathname: "/account/security" };

  function signedHeaders(request = get, signed = request) {
    return new Headers({
      [REQUEST_METHOD_HEADER]: request.method,
      [PATHNAME_HEADER]: request.pathname,
      [PATHNAME_SIGNATURE_HEADER]: signRequest(signed, secret)!,
    });
  }

  it("ignores a spoofed pathname without a signature", () => {
    const headers = new Headers({
      [REQUEST_METHOD_HEADER]: "GET",
      [PATHNAME_HEADER]: "/account/security",
    });
    expect(verifiedRequestFromHeaders(headers, secret)).toBeNull();
    expect(
      verifiedRequest("GET", "/account/security", null, secret),
    ).toBeNull();
  });

  it("returns the method and pathname when the proxy signature verifies", () => {
    const signature = signRequest(get, secret);
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifiedRequestFromHeaders(signedHeaders(), secret)).toEqual(get);
  });

  it("binds the method, so a signed GET cannot vouch for a POST", () => {
    const post = { method: "POST", pathname: "/account/security" };
    expect(
      verifiedRequestFromHeaders(signedHeaders(post, get), secret),
    ).toBeNull();
    expect(verifiedRequestFromHeaders(signedHeaders(post), secret)).toEqual(
      post,
    );
    const headers = signedHeaders();
    headers.delete(REQUEST_METHOD_HEADER);
    expect(verifiedRequestFromHeaders(headers, secret)).toBeNull();
  });

  it("rejects methods that could shift the signed boundary", () => {
    const signature = signRequest(
      { method: "GET\n/x", pathname: "/account/security" },
      secret,
    )!;
    expect(
      verifiedRequest("GET\n/x", "/account/security", signature, secret),
    ).toBeNull();
    expect(
      verifiedRequest(
        "get",
        "/account/security",
        signRequest({ method: "get", pathname: "/account/security" }, secret),
        secret,
      ),
    ).toBeNull();
  });

  it("rejects tampered pathnames, signatures and other secrets", () => {
    const signature = signRequest(
      { method: "GET", pathname: "/engagements" },
      secret,
    )!;
    expect(
      verifiedRequest("GET", "/account/security", signature, secret),
    ).toBeNull();
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    expect(verifiedRequest("GET", "/engagements", flipped, secret)).toBeNull();
    expect(
      verifiedRequest("GET", "/engagements", `${signature}x`, secret),
    ).toBeNull();
    expect(
      verifiedRequest("GET", "/engagements", signature, "a-different-secret"),
    ).toBeNull();
  });

  it("refuses to sign or verify without a secret", () => {
    const request = { method: "GET", pathname: "/engagements" };
    expect(signRequest(request, null)).toBeNull();
    const signature = signRequest(request, secret)!;
    expect(verifiedRequest("GET", "/engagements", signature, null)).toBeNull();
  });

  it("resolves the same secret as auth.ts, with a non-production fallback", () => {
    expect(resolveAuthSecret({ BETTER_AUTH_SECRET: secret })).toBe(secret);
    expect(resolveAuthSecret({ NODE_ENV: "development" })).toBe(
      DEVELOPMENT_AUTH_SECRET,
    );
    expect(resolveAuthSecret({ NODE_ENV: "production" })).toBeNull();
  });
});
