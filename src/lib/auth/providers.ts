import "server-only";

import type { GenericOAuthConfig } from "better-auth/plugins";
import { microsoftEntraId } from "better-auth/plugins";

export type PublicAuthProvider = {
  id: string;
  label: string;
  protocol: "social" | "oauth2";
};

type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

function complete(values: Array<string | undefined>): values is string[] {
  return values.every((value) => Boolean(value));
}

export function authProviderConfiguration(
  env: ProviderEnvironment = process.env,
) {
  const socialProviders: Record<
    string,
    { clientId: string; clientSecret: string }
  > = {};
  const oauthProviders: GenericOAuthConfig[] = [];
  const publicProviders: PublicAuthProvider[] = [];

  if (complete([env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET])) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
    };
    publicProviders.push({ id: "google", label: "Google", protocol: "social" });
  }
  if (complete([env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET])) {
    socialProviders.github = {
      clientId: env.GITHUB_CLIENT_ID!,
      clientSecret: env.GITHUB_CLIENT_SECRET!,
    };
    publicProviders.push({ id: "github", label: "GitHub", protocol: "social" });
  }
  if (
    complete([
      env.ENTRA_CLIENT_ID,
      env.ENTRA_CLIENT_SECRET,
      env.ENTRA_TENANT_ID,
    ])
  ) {
    oauthProviders.push(
      microsoftEntraId({
        clientId: env.ENTRA_CLIENT_ID!,
        clientSecret: env.ENTRA_CLIENT_SECRET!,
        tenantId: env.ENTRA_TENANT_ID!,
        pkce: true,
      }),
    );
    publicProviders.push({
      id: "microsoft-entra-id",
      label: "Microsoft Entra ID",
      protocol: "oauth2",
    });
  }
  if (
    complete([
      env.OIDC_CLIENT_ID,
      env.OIDC_CLIENT_SECRET,
      env.OIDC_DISCOVERY_URL,
      env.OIDC_ISSUER,
    ])
  ) {
    const providerId = env.OIDC_PROVIDER_ID?.trim() || "oidc";
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(providerId))
      throw new Error(
        "OIDC_PROVIDER_ID must be a lowercase URL-safe identifier",
      );
    oauthProviders.push({
      providerId,
      clientId: env.OIDC_CLIENT_ID!,
      clientSecret: env.OIDC_CLIENT_SECRET!,
      discoveryUrl: env.OIDC_DISCOVERY_URL!,
      issuer: env.OIDC_ISSUER!,
      requireIssuerValidation: true,
      pkce: true,
      scopes: (env.OIDC_SCOPES ?? "openid profile email")
        .split(/[ ,]+/)
        .filter(Boolean),
    });
    publicProviders.push({
      id: providerId,
      label: env.OIDC_PROVIDER_LABEL?.trim() || "Single sign-on",
      protocol: "oauth2",
    });
  }

  return { socialProviders, oauthProviders, publicProviders };
}

export function publicAuthProviders(env: ProviderEnvironment = process.env) {
  return authProviderConfiguration(env).publicProviders;
}
