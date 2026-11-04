import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { samlSso } from "./saml-plugin";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

describe("SAML plugin origin-check exemption", () => {
  it("adds only the SAML prefix to the origin-check skip list", async () => {
    const plugin = samlSso();
    expect(await plugin.init({ skipOriginCheck: false } as never)).toEqual({
      context: { skipOriginCheck: ["/sso/saml"] },
    });
    expect(await plugin.init({ skipOriginCheck: ["/other"] } as never)).toEqual(
      { context: { skipOriginCheck: ["/other", "/sso/saml"] } },
    );
    expect(await plugin.init({ skipOriginCheck: true } as never)).toBe(
      undefined,
    );
  });
});

// Vitest sets NODE_ENV=test, where Better Auth skips origin checks entirely,
// so the main SAML suite cannot show the exemption. This instance turns the
// checks back on, as in production.
run("SAML ACS with production origin checks", () => {
  const base = "http://127.0.0.1:3999";
  const auth = betterAuth({
    secret: "test-secret-test-secret-test-secret-123",
    baseURL: base,
    trustedOrigins: [base],
    database: memoryAdapter({}),
    advanced: { disableOriginCheck: false },
    plugins: [samlSso()],
  });
  const crossSite = {
    cookie: "better-auth.session_token=stale",
    origin: "https://idp.test.invalid",
    "sec-fetch-site": "cross-site",
    "sec-fetch-mode": "navigate",
  };

  it("lets a cross-site IdP POST with cookies reach the ACS", async () => {
    process.env.DATABASE_URL = testUrl;
    const response = await auth.handler(
      new Request(`${base}/api/auth/sso/saml/no-such-org/acs`, {
        method: "POST",
        headers: {
          ...crossSite,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ SAMLResponse: "x" }),
      }),
    );
    // The handler ran (unknown org -> generic failure), not a 403 origin error.
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `${base}/sign-in?error=sso_failed`,
    );
  });

  it("still origin-checks the other SSO endpoints", async () => {
    const response = await auth.handler(
      new Request(`${base}/api/auth/sso/discover`, {
        method: "POST",
        headers: { ...crossSite, "content-type": "application/json" },
        body: JSON.stringify({ email: "a@example.com" }),
      }),
    );
    expect(response.status).toBe(403);
  });
});
