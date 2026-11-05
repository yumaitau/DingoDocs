import { describe, expect, it } from "vitest";
import { ValidateInResponseTo, type Profile } from "@node-saml/node-saml";
import { createTestIdp } from "@/test/saml-idp";
import { samlServiceProviderUrls } from "./saml-paths";
import {
  checkSignedAssertion,
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
});

describe("signed assertion checks", () => {
  const acsUrl = "https://app.example/api/auth/sso/saml/acme-1/acs";
  const now = Date.parse("2030-01-01T00:00:00Z");
  const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const bearer = (attributes: string) =>
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData ${attributes}/></saml:SubjectConfirmation>`;
  const assertion = (input: {
    issued?: number;
    confirmations?: string;
    conditions?: string;
  }) =>
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a1" Version="2.0" IssueInstant="${at(input.issued ?? 0)}">` +
    `<saml:Issuer>https://idp.example/metadata</saml:Issuer>` +
    `<saml:Subject><saml:NameID>subject-1</saml:NameID>${
      input.confirmations ??
      bearer(`NotOnOrAfter="${at(5 * 60_000)}" Recipient="${acsUrl}"`)
    }</saml:Subject>` +
    (input.conditions ?? "") +
    `</saml:Assertion>`;
  const check = (xml: string, inResponseTo?: string) =>
    checkSignedAssertion({ assertionXml: xml, acsUrl, inResponseTo, now });

  it("accepts a fresh bearer assertion and sets the replay deadline", async () => {
    const result = await check(
      assertion({
        conditions: `<saml:Conditions NotOnOrAfter="${at(10 * 60_000)}"/>`,
      }),
    );
    expect(result).toEqual({
      ok: true,
      id: "_a1",
      // max(conditions 10m, bearer 5m, issue + 5m) + 60s skew
      replayUntil: new Date(now + 11 * 60_000),
    });
  });

  it("rejects the reviewer's case: no condition times, bearer expired an hour ago", async () => {
    const result = await check(
      assertion({
        issued: -2 * 60 * 60_000,
        conditions:
          "<saml:Conditions><saml:AudienceRestriction><saml:Audience>x</saml:Audience></saml:AudienceRestriction></saml:Conditions>",
        confirmations: bearer(
          `NotOnOrAfter="${at(-60 * 60_000)}" Recipient="${acsUrl}"`,
        ),
      }),
    );
    expect(result).toEqual({ ok: false, reason: "assertion_too_old" });
  });

  it.each([
    [
      "an expired bearer",
      {
        confirmations: bearer(
          `NotOnOrAfter="${at(-61_000)}" Recipient="${acsUrl}"`,
        ),
      },
      "bearer_expired",
    ],
    [
      "a bearer with no expiry",
      { confirmations: bearer(`Recipient="${acsUrl}"`) },
      "bearer_without_expiry",
    ],
    [
      "a non-bearer confirmation only",
      {
        confirmations: `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:holder-of-key"><saml:SubjectConfirmationData NotOnOrAfter="${at(60_000)}" Recipient="${acsUrl}"/></saml:SubjectConfirmation>`,
      },
      "missing_bearer_confirmation",
    ],
    [
      "a wrong Recipient",
      {
        confirmations: bearer(
          `NotOnOrAfter="${at(60_000)}" Recipient="https://evil.example/acs"`,
        ),
      },
      "recipient_mismatch",
    ],
    [
      "expired conditions",
      { conditions: `<saml:Conditions NotOnOrAfter="${at(-61_000)}"/>` },
      "conditions_expired",
    ],
    [
      "not-yet-valid conditions",
      { conditions: `<saml:Conditions NotBefore="${at(2 * 60_000)}"/>` },
      "conditions_not_yet_valid",
    ],
    ["an old IssueInstant", { issued: -6 * 60_000 - 1 }, "assertion_too_old"],
    [
      "a future IssueInstant",
      { issued: 2 * 60_000 },
      "issue_instant_in_future",
    ],
  ])("rejects %s", async (_label, input, reason) => {
    expect(await check(assertion(input))).toEqual({ ok: false, reason });
  });

  it("allows 60 seconds of clock skew", async () => {
    const result = await check(
      assertion({
        confirmations: bearer(
          `NotOnOrAfter="${at(-30_000)}" Recipient="${acsUrl}"`,
        ),
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("requires the signed confirmation to answer the response's InResponseTo", async () => {
    const answering = bearer(
      `NotOnOrAfter="${at(60_000)}" Recipient="${acsUrl}" InResponseTo="_req1"`,
    );
    expect(
      (await check(assertion({ confirmations: answering }), "_req1")).ok,
    ).toBe(true);
    expect(
      await check(assertion({ confirmations: answering }), "_req2"),
    ).toEqual({
      ok: false,
      reason: "in_response_to_mismatch",
    });
    expect(await check(assertion({}), "_req1")).toEqual({
      ok: false,
      reason: "in_response_to_mismatch",
    });
    expect(await check(assertion({ confirmations: answering }))).toEqual({
      ok: false,
      reason: "in_response_to_unexpected",
    });
  });

  it("rejects missing, malformed or non-SAML assertion XML", async () => {
    expect(
      await check(
        assertion({}).replaceAll(
          "urn:oasis:names:tc:SAML:2.0:assertion",
          "urn:x",
        ),
      ),
    ).toEqual({ ok: false, reason: "missing_assertion" });
    expect(await check("<not-xml")).toEqual({
      ok: false,
      reason: "unparseable_assertion",
    });
    expect(
      await checkSignedAssertion({ assertionXml: undefined, acsUrl, now }),
    ).toEqual({ ok: false, reason: "missing_assertion" });
  });
});
