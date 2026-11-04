import { describe, expect, it } from "vitest";
import { ValidateInResponseTo, type Profile } from "@node-saml/node-saml";
import { createTestIdp } from "@/test/saml-idp";
import { samlServiceProviderUrls } from "./saml-paths";
import {
  assertionReplayKey,
  createSamlClient,
  idpCertificates,
  samlIdentity,
  samlPolicy,
  signRelayState,
  verifyRelayState,
  type SamlSsoPolicy,
} from "./saml-config";

const sso: SamlSsoPolicy = {
  protocol: "saml",
  issuer: "https://idp.example/metadata",
  clientId: "saml",
  entryPoint: "https://idp.example/sso",
  certificate: "MIIB",
};
const secret = "test-secret-test-secret-test-secret-123";

describe("SAML configuration", () => {
  it("requires protocol, entry point, certificate and issuer", () => {
    expect(samlPolicy({ sso })).toBe(sso);
    expect(samlPolicy({ sso: { ...sso, protocol: "oidc" } })).toBeNull();
    expect(samlPolicy({ sso: { ...sso, certificate: " " } })).toBeNull();
    expect(samlPolicy({})).toBeNull();
  });

  it("builds per-organisation SP URLs with the metadata URL as entity ID", () => {
    expect(
      samlServiceProviderUrls("https://app.example/api/auth/", "acme-1"),
    ).toEqual({
      entityId: "https://app.example/api/auth/sso/saml/acme-1/metadata",
      metadataUrl: "https://app.example/api/auth/sso/saml/acme-1/metadata",
      acsUrl: "https://app.example/api/auth/sso/saml/acme-1/acs",
      loginUrl: "https://app.example/api/auth/sso/saml/acme-1/login",
    });
  });

  it("validates strictly: audience, signed assertions, InResponseTo, 60s skew", () => {
    const client = createSamlClient({
      authBaseURL: "https://app.example/api/auth",
      slug: "acme-1",
      sso: { ...sso, certificate: createTestIdp().certificate },
      cacheProvider: {
        saveAsync: async () => null,
        getAsync: async () => null,
        removeAsync: async () => null,
      },
    });
    expect(client.options).toMatchObject({
      audience: "https://app.example/api/auth/sso/saml/acme-1/metadata",
      issuer: "https://app.example/api/auth/sso/saml/acme-1/metadata",
      callbackUrl: "https://app.example/api/auth/sso/saml/acme-1/acs",
      wantAssertionsSigned: true,
      validateInResponseTo: ValidateInResponseTo.always,
      acceptedClockSkewMs: 60_000,
    });
  });

  it("relaxes InResponseTo only when the org allows IdP-initiated sign-in", () => {
    const client = createSamlClient({
      authBaseURL: "https://app.example/api/auth",
      slug: "acme-1",
      sso: {
        ...sso,
        allowIdpInitiated: true,
        certificate: createTestIdp().certificate,
      },
      cacheProvider: {
        saveAsync: async () => null,
        getAsync: async () => null,
        removeAsync: async () => null,
      },
    });
    expect(client.options.validateInResponseTo).toBe(
      ValidateInResponseTo.ifPresent,
    );
  });

  it("accepts PEM blocks for rotation and bare base64 bodies", () => {
    const one = createTestIdp().certificate;
    const two = createTestIdp().certificate;
    expect(idpCertificates(`${one}\n${two}`)).toHaveLength(2);
    const bare = one.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
    expect(idpCertificates(bare)[0]).toMatch(/^-----BEGIN CERTIFICATE-----\n/);
  });
});

describe("SAML RelayState", () => {
  const organisationId = "11111111-1111-4111-8111-111111111111";

  it("round-trips a safe internal path for the same organisation", () => {
    const relayState = signRelayState({
      secret,
      organisationId,
      callbackURL: "/findings?x=1",
    });
    expect(verifyRelayState({ secret, organisationId, relayState })).toBe(
      "/findings?x=1",
    );
  });

  it("never yields an external URL", () => {
    const relayState = signRelayState({
      secret,
      organisationId,
      callbackURL: "//evil.example",
    });
    expect(verifyRelayState({ secret, organisationId, relayState })).toBe(
      "/dashboard",
    );
  });

  it("falls back for another organisation, tampering, expiry or junk", () => {
    const relayState = signRelayState({
      secret,
      organisationId,
      callbackURL: "/findings",
    });
    const other = "22222222-2222-4222-8222-222222222222";
    expect(
      verifyRelayState({ secret, organisationId: other, relayState }),
    ).toBe("/dashboard");
    const [, expires, signature] = relayState.split(".");
    const forged = `${Buffer.from("/admin").toString("base64url")}.${expires}.${signature}`;
    expect(
      verifyRelayState({ secret, organisationId, relayState: forged }),
    ).toBe("/dashboard");
    expect(
      verifyRelayState({
        secret,
        organisationId,
        relayState,
        now: Date.now() + 60 * 60_000,
      }),
    ).toBe("/dashboard");
    expect(
      verifyRelayState({ secret, organisationId, relayState: organisationId }),
    ).toBe("/dashboard");
  });
});

describe("SAML identity mapping", () => {
  const profile = (input: Partial<Profile>) =>
    ({
      issuer: sso.issuer,
      nameIDFormat: "x",
      nameID: "subject-1",
      ...input,
    }) as Profile;

  it("uses the configured attribute, lowercased", () => {
    expect(
      samlIdentity(profile({ attributes: { mail: "Person@Example.COM" } }), {
        ...sso,
        emailAttribute: "mail",
      }).email,
    ).toBe("person@example.com");
  });

  it("defaults to email, then an email-shaped NameID", () => {
    expect(samlIdentity(profile({ email: "a@example.com" }), sso).email).toBe(
      "a@example.com",
    );
    expect(samlIdentity(profile({ nameID: "B@Example.com" }), sso).email).toBe(
      "b@example.com",
    );
    expect(
      samlIdentity(profile({ nameID: "opaque-id" }), sso).email,
    ).toBeUndefined();
  });

  it("reads groups only from the configured attribute", () => {
    const withGroups = profile({
      attributes: { groups: ["Eng", "Ops"], role: "Admin" },
    });
    expect(samlIdentity(withGroups, sso).groups).toEqual([]);
    expect(
      samlIdentity(withGroups, { ...sso, groupsAttribute: "groups" }).groups,
    ).toEqual(["Eng", "Ops"]);
  });

  it("derives the replay key from the assertion ID and latest NotOnOrAfter", () => {
    const key = assertionReplayKey(
      profile({
        getAssertion: () => ({
          Assertion: {
            $: { ID: "_a1" },
            Conditions: [{ $: { NotOnOrAfter: "2030-01-01T00:00:00Z" } }],
            Subject: [
              {
                SubjectConfirmation: [
                  {
                    SubjectConfirmationData: [
                      { $: { NotOnOrAfter: "2030-01-01T00:05:00Z" } },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      }),
    );
    expect(key?.id).toBe("_a1");
    expect(key?.expiresAt.toISOString()).toBe("2030-01-01T00:06:00.000Z");
    expect(
      assertionReplayKey(profile({ getAssertion: () => ({ Assertion: {} }) })),
    ).toBe(undefined);
  });
});
