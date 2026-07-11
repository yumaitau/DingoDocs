import { describe, expect, it } from "vitest";
import { authProviderConfiguration } from "./providers";

describe("server-side authentication providers", () => {
  it("enables only providers with complete server configuration", () => {
    const configured = authProviderConfiguration({
      GOOGLE_CLIENT_ID: "google-id",
      GOOGLE_CLIENT_SECRET: "google-secret",
      GITHUB_CLIENT_ID: "incomplete",
      ENTRA_CLIENT_ID: "entra-id",
      ENTRA_CLIENT_SECRET: "entra-secret",
      ENTRA_TENANT_ID: "tenant-id",
      OIDC_CLIENT_ID: "oidc-id",
      OIDC_CLIENT_SECRET: "oidc-secret",
      OIDC_DISCOVERY_URL: "https://id.example/.well-known/openid-configuration",
      OIDC_ISSUER: "https://id.example",
      OIDC_PROVIDER_ID: "corporate-sso",
      OIDC_PROVIDER_LABEL: "Corporate SSO",
    });
    expect(Object.keys(configured.socialProviders)).toEqual(["google"]);
    expect(
      configured.oauthProviders.map((provider) => provider.providerId),
    ).toEqual(["microsoft-entra-id", "corporate-sso"]);
    expect(configured.publicProviders).toEqual([
      { id: "google", label: "Google", protocol: "social" },
      {
        id: "microsoft-entra-id",
        label: "Microsoft Entra ID",
        protocol: "oauth2",
      },
      { id: "corporate-sso", label: "Corporate SSO", protocol: "oauth2" },
    ]);
    expect(JSON.stringify(configured.publicProviders)).not.toContain("secret");
  });

  it("rejects unsafe custom provider identifiers", () => {
    expect(() =>
      authProviderConfiguration({
        OIDC_CLIENT_ID: "id",
        OIDC_CLIENT_SECRET: "secret",
        OIDC_DISCOVERY_URL:
          "https://id.example/.well-known/openid-configuration",
        OIDC_ISSUER: "https://id.example",
        OIDC_PROVIDER_ID: "../../callback",
      }),
    ).toThrow("URL-safe");
  });
});
