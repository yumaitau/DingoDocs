import { randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildSamlResponse,
  createTestIdp,
  type TestIdp,
} from "@/test/saml-idp";
import { deleteAuditEventsForOrganisations } from "@/server/testing/delete-audit-events";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

/**
 * End to end through auth.handler with real node-saml validation: the test
 * IdP signs assertions with a self-signed certificate generated here, and the
 * SP-initiated request ID comes from the real login redirect.
 */
run("per-organisation SAML SSO", () => {
  const ids = {
    org: randomUUID(),
    jitOrg: randomUUID(),
    idpInitOrg: randomUUID(),
    mfaOrg: randomUUID(),
    otherOrg: randomUUID(),
    member: randomUUID(),
    outsider: randomUUID(),
    totp: randomUUID(),
    existing: randomUUID(),
    linked: randomUUID(),
  };
  const domain = `saml-${ids.org}.test.invalid`;
  const jitDomain = `jit-${ids.jitOrg}.test.invalid`;
  const unverifiedDomain = `nope-${ids.jitOrg}.test.invalid`;
  const slugs = {
    org: `saml-${ids.org}`,
    jitOrg: `saml-jit-${ids.jitOrg}`,
    idpInitOrg: `saml-idp-${ids.idpInitOrg}`,
    mfaOrg: `saml-mfa-${ids.mfaOrg}`,
  };
  const emails = {
    member: `member@${domain}`,
    outsider: `outsider@${domain}`,
    totp: `totp@${domain}`,
    existing: `existing@${jitDomain}`,
    linked: `linked@${domain}`,
    jitNew: `newbie@${jitDomain}`,
    unverified: `someone@${unverifiedDomain}`,
  };
  let idp: TestIdp;
  let modules: Awaited<ReturnType<typeof load>>;
  let base: string;

  const verified = (d: string) => ({
    domain: d,
    token: "fixture",
    verifiedAt: new Date().toISOString(),
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    idp = createTestIdp();
    modules = await load();
    base = new URL(modules.auth.options.baseURL as string).origin;
    const sso = (extra: Record<string, unknown> = {}) => ({
      protocol: "saml" as const,
      issuer: idp.entityId,
      clientId: "saml",
      entryPoint: idp.entryPoint,
      certificate: idp.certificate,
      ...extra,
    });
    await modules.db.insert(modules.organisations).values([
      {
        id: ids.org,
        slug: slugs.org,
        name: "SAML Org",
        securityPolicy: { scimDomains: [verified(domain)], sso: sso() },
      },
      {
        id: ids.jitOrg,
        slug: slugs.jitOrg,
        name: "SAML JIT Org",
        securityPolicy: {
          scimDomains: [
            verified(jitDomain),
            { domain: unverifiedDomain, token: "pending" },
          ],
          sso: sso({
            jitProvisioning: true,
            groupsAttribute: "groups",
            emailAttribute: "mail",
            groupRoles: {
              Engineers: "consultant",
              // Stored out of band; must still never be granted.
              Owners: "organisation_owner",
            },
          }),
        },
      },
      {
        id: ids.idpInitOrg,
        slug: slugs.idpInitOrg,
        name: "SAML IdP-initiated Org",
        securityPolicy: {
          scimDomains: [verified(domain)],
          sso: sso({ allowIdpInitiated: true }),
        },
      },
      {
        id: ids.mfaOrg,
        slug: slugs.mfaOrg,
        name: "SAML MFA Org",
        securityPolicy: {
          scimDomains: [verified(domain)],
          sso: sso({ idpEnforcesMfa: true }),
        },
      },
      { id: ids.otherOrg, slug: `saml-other-${ids.otherOrg}`, name: "Other" },
    ]);
    // The IdP-initiated and MFA orgs list the same verified fixture domain
    // (written directly, bypassing the one-verifier-per-domain rule).
    await modules.db.insert(modules.users).values([
      {
        id: ids.member,
        email: emails.member,
        name: "Member",
        emailVerified: true,
      },
      {
        id: ids.outsider,
        email: emails.outsider,
        name: "Outsider",
        emailVerified: true,
      },
      {
        id: ids.totp,
        email: emails.totp,
        name: "TOTP",
        emailVerified: true,
        twoFactorEnabled: true,
      },
      {
        id: ids.existing,
        email: emails.existing,
        name: "Existing",
        emailVerified: true,
      },
      {
        id: ids.linked,
        email: emails.linked,
        name: "Linked",
        emailVerified: true,
      },
    ]);
    await modules.db.insert(modules.organisationMembers).values([
      { organisationId: ids.org, userId: ids.member, role: "consultant" },
      { organisationId: ids.org, userId: ids.totp, role: "consultant" },
      { organisationId: ids.org, userId: ids.linked, role: "consultant" },
      {
        organisationId: ids.otherOrg,
        userId: ids.outsider,
        role: "consultant",
      },
      { organisationId: ids.mfaOrg, userId: ids.totp, role: "consultant" },
      {
        organisationId: ids.idpInitOrg,
        userId: ids.member,
        role: "consultant",
      },
    ]);
  });

  afterAll(async () => {
    if (!modules) return;
    const orgIds = [
      ids.org,
      ids.jitOrg,
      ids.idpInitOrg,
      ids.mfaOrg,
      ids.otherOrg,
    ];
    const jitUsers = await modules.db
      .select({ id: modules.users.id })
      .from(modules.users)
      .where(
        modules.inArray(modules.users.email, [
          emails.jitNew,
          emails.unverified,
        ]),
      );
    const userIds = [
      ids.member,
      ids.outsider,
      ids.totp,
      ids.existing,
      ids.linked,
      ...jitUsers.map((row) => row.id),
    ];
    await deleteAuditEventsForOrganisations(modules.sqlClient, orgIds);
    await modules.sqlClient.begin(async (tx) => {
      await tx`alter table audit_events disable trigger audit_events_append_only`;
      await tx`delete from audit_events where actor_id in ${tx(userIds)}`;
      await tx`alter table audit_events enable trigger audit_events_append_only`;
    });
    for (const orgId of orgIds)
      await modules.sqlClient`delete from verification_tokens where identifier like ${`saml-%:${orgId}:%`}`;
    await modules.db
      .delete(modules.users)
      .where(modules.inArray(modules.users.id, userIds));
    await modules.db
      .delete(modules.organisations)
      .where(modules.inArray(modules.organisations.id, orgIds));
    await modules.sqlClient.end();
  });

  function spUrls(slug: string) {
    const auth = `${base}/api/auth/sso/saml/${slug}`;
    return {
      entityId: `${auth}/metadata`,
      acsUrl: `${auth}/acs`,
      login: `${auth}/login`,
    };
  }

  /** Runs the real SP-initiated login and returns the request ID and cookie. */
  async function startLogin(slug: string, callbackURL = "/engagements") {
    const response = await modules.auth.handler(
      new Request(
        `${spUrls(slug).login}?callbackURL=${encodeURIComponent(callbackURL)}`,
      ),
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(idp.entryPoint);
    const request = inflateRawSync(
      Buffer.from(location.searchParams.get("SAMLRequest")!, "base64"),
    ).toString("utf8");
    const requestId = /\sID="([^"]+)"/.exec(request)![1];
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith("dingodocs_saml_request="))!
      .split(";")[0];
    return {
      requestId,
      cookie,
      relayState: location.searchParams.get("RelayState")!,
      request,
    };
  }

  async function postAcs(
    slug: string,
    samlResponse: string,
    options: { cookie?: string; relayState?: string } = {},
  ) {
    const body = new URLSearchParams({ SAMLResponse: samlResponse });
    if (options.relayState) body.set("RelayState", options.relayState);
    return modules.auth.handler(
      new Request(spUrls(slug).acsUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          ...(options.cookie ? { cookie: options.cookie } : {}),
          // A real IdP POST is a cross-site top-level navigation.
          "sec-fetch-site": "cross-site",
          "sec-fetch-mode": "navigate",
          origin: "https://idp.test.invalid",
        },
        body,
      }),
    );
  }

  function sessionCookie(response: Response) {
    return response.headers
      .getSetCookie()
      .find((cookie) => /session_token=[^;]+/.test(cookie));
  }

  async function sessionCount(userId: string) {
    const rows = await modules.db
      .select({ id: modules.sessions.id })
      .from(modules.sessions)
      .where(modules.eq(modules.sessions.userId, userId));
    return rows.length;
  }

  async function rejectionReasons(organisationId: string) {
    const rows = await modules.db
      .select({ metadata: modules.auditEvents.metadata })
      .from(modules.auditEvents)
      .where(
        modules.and(
          modules.eq(modules.auditEvents.organisationId, organisationId),
          modules.eq(modules.auditEvents.action, "sso.saml.rejected"),
        ),
      );
    return rows.map((row) => String(row.metadata.reason));
  }

  function expectSsoFailure(response: Response, error = "sso_failed") {
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("error")).toBe(error);
    expect(sessionCookie(response)).toBeUndefined();
  }

  it("serves SP metadata with the per-organisation entity ID and ACS", async () => {
    const response = await modules.auth.handler(
      new Request(spUrls(slugs.org).entityId),
    );
    expect(response.status).toBe(200);
    const xml = await response.text();
    expect(xml).toContain(`entityID="${spUrls(slugs.org).entityId}"`);
    expect(xml).toContain(`Location="${spUrls(slugs.org).acsUrl}"`);
    expect(xml).toContain('WantAssertionsSigned="true"');
  });

  it("valid SP-initiated login creates a session for the member", async () => {
    const before = await sessionCount(ids.member);
    const login = await startLogin(slugs.org, "/engagements?tab=open");
    expect(login.request).toContain(
      `AssertionConsumerServiceURL="${spUrls(slugs.org).acsUrl}"`,
    );
    const response = await postAcs(
      slugs.org,
      buildSamlResponse(idp, {
        audience: spUrls(slugs.org).entityId,
        acsUrl: spUrls(slugs.org).acsUrl,
        nameID: "member-subject",
        inResponseTo: login.requestId,
        attributes: { email: emails.member.toUpperCase() },
      }),
      { cookie: login.cookie, relayState: login.relayState },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `${base}/engagements?tab=open`,
    );
    expect(sessionCookie(response)).toBeTruthy();
    expect(
      response.headers
        .getSetCookie()
        .some((cookie) =>
          cookie.startsWith(`dingodocs_active_organisation=${ids.org}`),
        ),
    ).toBe(true);
    expect(await sessionCount(ids.member)).toBe(before + 1);
    const [account] = await modules.db
      .select()
      .from(modules.accounts)
      .where(
        modules.and(
          modules.eq(modules.accounts.providerId, `saml:${ids.org}`),
          modules.eq(modules.accounts.accountId, "member-subject"),
        ),
      );
    expect(account?.userId).toBe(ids.member);
    const [signedIn] = await modules.db
      .select({ actorId: modules.auditEvents.actorId })
      .from(modules.auditEvents)
      .where(
        modules.and(
          modules.eq(modules.auditEvents.organisationId, ids.org),
          modules.eq(modules.auditEvents.action, "sso.saml.signed_in"),
        ),
      );
    expect(signedIn?.actorId).toBe(ids.member);
  });

  it("rejects a response for the wrong audience", async () => {
    const login = await startLogin(slugs.org);
    const response = await postAcs(
      slugs.org,
      buildSamlResponse(idp, {
        audience: spUrls(slugs.jitOrg).entityId,
        acsUrl: spUrls(slugs.org).acsUrl,
        nameID: "member-subject",
        inResponseTo: login.requestId,
        attributes: { email: emails.member },
      }),
      { cookie: login.cookie },
    );
    expectSsoFailure(response);
    expect((await rejectionReasons(ids.org)).join()).toMatch(
      /audience mismatch/,
    );
  });

  it("rejects an assertion signed by an untrusted key", async () => {
    const login = await startLogin(slugs.org);
    const response = await postAcs(
      slugs.org,
      buildSamlResponse(idp, {
        audience: spUrls(slugs.org).entityId,
        acsUrl: spUrls(slugs.org).acsUrl,
        nameID: "member-subject",
        inResponseTo: login.requestId,
        attributes: { email: emails.member },
        signingKey: createTestIdp().privateKey,
      }),
      { cookie: login.cookie },
    );
    expectSsoFailure(response);
  });

  it("rejects a replayed SP-initiated response", async () => {
    const login = await startLogin(slugs.org);
    const samlResponse = buildSamlResponse(idp, {
      audience: spUrls(slugs.org).entityId,
      acsUrl: spUrls(slugs.org).acsUrl,
      nameID: "member-subject",
      inResponseTo: login.requestId,
      attributes: { email: emails.member },
    });
    const first = await postAcs(slugs.org, samlResponse, {
      cookie: login.cookie,
    });
    expect(sessionCookie(first)).toBeTruthy();
    const before = await sessionCount(ids.member);
    const replay = await postAcs(slugs.org, samlResponse, {
      cookie: login.cookie,
    });
    expectSsoFailure(replay);
    expect(await sessionCount(ids.member)).toBe(before);
  });

  it("rejects a replayed assertion even when IdP-initiated sign-in is allowed", async () => {
    const samlResponse = buildSamlResponse(idp, {
      audience: spUrls(slugs.idpInitOrg).entityId,
      acsUrl: spUrls(slugs.idpInitOrg).acsUrl,
      nameID: "member-idp-init",
      attributes: { email: emails.member },
    });
    const first = await postAcs(slugs.idpInitOrg, samlResponse);
    expect(sessionCookie(first)).toBeTruthy();
    expect(first.headers.get("location")).toBe(`${base}/dashboard`);
    const replay = await postAcs(slugs.idpInitOrg, samlResponse);
    expectSsoFailure(replay);
    expect(await rejectionReasons(ids.idpInitOrg)).toContain(
      "replayed_assertion",
    );
  });

  it("rejects an unsolicited response (no InResponseTo) by default", async () => {
    const response = await postAcs(
      slugs.org,
      buildSamlResponse(idp, {
        audience: spUrls(slugs.org).entityId,
        acsUrl: spUrls(slugs.org).acsUrl,
        nameID: "member-subject",
        attributes: { email: emails.member },
      }),
    );
    expectSsoFailure(response);
    expect((await rejectionReasons(ids.org)).join()).toMatch(
      /InResponseTo is missing/,
    );
  });

  it("rejects a response delivered to a browser that did not start the login", async () => {
    const login = await startLogin(slugs.org);
    const response = await postAcs(
      slugs.org,
      buildSamlResponse(idp, {
        audience: spUrls(slugs.org).entityId,
        acsUrl: spUrls(slugs.org).acsUrl,
        nameID: "member-subject",
        inResponseTo: login.requestId,
        attributes: { email: emails.member },
      }),
    );
    expectSsoFailure(response);
    expect(await rejectionReasons(ids.org)).toContain(
      "request_not_bound_to_browser",
    );
  });

  it("rejects a user who belongs only to another organisation", async () => {
    const before = await sessionCount(ids.outsider);
    const login = await startLogin(slugs.org);
    const response = await postAcs(
      slugs.org,
      buildSamlResponse(idp, {
        audience: spUrls(slugs.org).entityId,
        acsUrl: spUrls(slugs.org).acsUrl,
        nameID: "outsider-subject",
        inResponseTo: login.requestId,
        attributes: { email: emails.outsider },
      }),
      { cookie: login.cookie },
    );
    expectSsoFailure(response);
    expect(await sessionCount(ids.outsider)).toBe(before);
    expect(await rejectionReasons(ids.org)).toContain("not_a_member");
  });

  it("rejects a NameID already linked to a different user", async () => {
    // member-subject was linked to the member by the first sign-in test.
    const login = await startLogin(slugs.org);
    const response = await postAcs(
      slugs.org,
      buildSamlResponse(idp, {
        audience: spUrls(slugs.org).entityId,
        acsUrl: spUrls(slugs.org).acsUrl,
        nameID: "member-subject",
        inResponseTo: login.requestId,
        attributes: { email: emails.linked },
      }),
      { cookie: login.cookie },
    );
    expectSsoFailure(response);
    expect(await sessionCount(ids.linked)).toBe(0);
    expect(await rejectionReasons(ids.org)).toContain("subject_conflict");
  });

  it("JIT creates a member with the mapped role, never owner", async () => {
    const login = await startLogin(slugs.jitOrg);
    const response = await postAcs(
      slugs.jitOrg,
      buildSamlResponse(idp, {
        audience: spUrls(slugs.jitOrg).entityId,
        acsUrl: spUrls(slugs.jitOrg).acsUrl,
        nameID: "newbie-subject",
        inResponseTo: login.requestId,
        attributes: {
          mail: emails.jitNew,
          groups: ["Owners", "Engineers", "Unmapped"],
          displayName: "New Person",
        },
      }),
      { cookie: login.cookie },
    );
    expect(response.status).toBe(302);
    expect(sessionCookie(response)).toBeTruthy();
    const [user] = await modules.db
      .select()
      .from(modules.users)
      .where(modules.eq(modules.users.email, emails.jitNew));
    expect(user).toMatchObject({ emailVerified: true, name: "New Person" });
    const [membership] = await modules.db
      .select({ role: modules.organisationMembers.role })
      .from(modules.organisationMembers)
      .where(
        modules.and(
          modules.eq(modules.organisationMembers.organisationId, ids.jitOrg),
          modules.eq(modules.organisationMembers.userId, user.id),
        ),
      );
    expect(membership?.role).toBe("consultant");
  });

  it("JIT adds a membership for an existing verified user with read_only by default", async () => {
    const login = await startLogin(slugs.jitOrg);
    const response = await postAcs(
      slugs.jitOrg,
      buildSamlResponse(idp, {
        audience: spUrls(slugs.jitOrg).entityId,
        acsUrl: spUrls(slugs.jitOrg).acsUrl,
        nameID: "existing-subject",
        inResponseTo: login.requestId,
        attributes: { mail: emails.existing },
      }),
      { cookie: login.cookie },
    );
    expect(sessionCookie(response)).toBeTruthy();
    const [membership] = await modules.db
      .select({ role: modules.organisationMembers.role })
      .from(modules.organisationMembers)
      .where(
        modules.and(
          modules.eq(modules.organisationMembers.organisationId, ids.jitOrg),
          modules.eq(modules.organisationMembers.userId, ids.existing),
        ),
      );
    expect(membership?.role).toBe("read_only");
  });

  it("JIT is denied for an email on an unverified domain", async () => {
    const login = await startLogin(slugs.jitOrg);
    const response = await postAcs(
      slugs.jitOrg,
      buildSamlResponse(idp, {
        audience: spUrls(slugs.jitOrg).entityId,
        acsUrl: spUrls(slugs.jitOrg).acsUrl,
        nameID: "unverified-subject",
        inResponseTo: login.requestId,
        attributes: { mail: emails.unverified },
      }),
      { cookie: login.cookie },
    );
    expectSsoFailure(response);
    const created = await modules.db
      .select({ id: modules.users.id })
      .from(modules.users)
      .where(modules.eq(modules.users.email, emails.unverified));
    expect(created).toHaveLength(0);
    expect(await rejectionReasons(ids.jitOrg)).toContain("domain_not_verified");
  });

  it("blocks a TOTP-enrolled user unless the organisation trusts IdP MFA", async () => {
    const login = await startLogin(slugs.org);
    const blocked = await postAcs(
      slugs.org,
      buildSamlResponse(idp, {
        audience: spUrls(slugs.org).entityId,
        acsUrl: spUrls(slugs.org).acsUrl,
        nameID: "totp-subject",
        inResponseTo: login.requestId,
        attributes: { email: emails.totp },
      }),
      { cookie: login.cookie },
    );
    expectSsoFailure(blocked, "two_factor_required");
    expect(
      new URL(blocked.headers.get("location")!).searchParams.get("method"),
    ).toBe("sso");
    expect(await sessionCount(ids.totp)).toBe(0);

    const trusted = await startLogin(slugs.mfaOrg);
    const allowed = await postAcs(
      slugs.mfaOrg,
      buildSamlResponse(idp, {
        audience: spUrls(slugs.mfaOrg).entityId,
        acsUrl: spUrls(slugs.mfaOrg).acsUrl,
        nameID: "totp-subject-mfa",
        inResponseTo: trusted.requestId,
        attributes: { email: emails.totp },
      }),
      { cookie: trusted.cookie },
    );
    expect(sessionCookie(allowed)).toBeTruthy();
    expect(await sessionCount(ids.totp)).toBe(1);
  });

  it("does not sign in a member whose sessions are revoked into the future", async () => {
    await modules.db
      .update(modules.organisationMembers)
      .set({ sessionsRevokedAt: new Date(Date.now() + 60_000) })
      .where(
        modules.and(
          modules.eq(modules.organisationMembers.organisationId, ids.org),
          modules.eq(modules.organisationMembers.userId, ids.linked),
        ),
      );
    const login = await startLogin(slugs.org);
    const response = await postAcs(
      slugs.org,
      buildSamlResponse(idp, {
        audience: spUrls(slugs.org).entityId,
        acsUrl: spUrls(slugs.org).acsUrl,
        nameID: "linked-subject",
        inResponseTo: login.requestId,
        attributes: { email: emails.linked },
      }),
      { cookie: login.cookie },
    );
    expectSsoFailure(response);
    expect(await rejectionReasons(ids.org)).toContain("membership_revoked");
  });

  it("discovery returns the same shape for known and unknown domains", async () => {
    const discover = (email: string) =>
      modules.auth.handler(
        new Request(`${base}/api/auth/sso/discover`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: base },
          body: JSON.stringify({ email, callbackURL: "/findings" }),
        }),
      );
    const known = await discover(emails.member);
    const unknown = await discover("someone@unknown.test.invalid");
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    const knownUrl = ((await known.json()) as { url: string }).url;
    const unknownUrl = ((await unknown.json()) as { url: string }).url;
    expect(knownUrl.length).toBe(unknownUrl.length);
    expect(knownUrl).not.toContain(slugs.org);

    const toIdp = await modules.auth.handler(new Request(knownUrl));
    expect(toIdp.status).toBe(302);
    expect(toIdp.headers.get("location")).toContain(idp.entryPoint);
    const toSignIn = await modules.auth.handler(new Request(unknownUrl));
    expect(
      new URL(toSignIn.headers.get("location")!).searchParams.get("error"),
    ).toBe("sso_failed");
  });

  it("unknown organisation slugs fail the same way as unconfigured ones", async () => {
    const unknown = await modules.auth.handler(
      new Request(`${base}/api/auth/sso/saml/no-such-org-${ids.org}/login`),
    );
    const unconfigured = await modules.auth.handler(
      new Request(`${base}/api/auth/sso/saml/saml-other-${ids.otherOrg}/login`),
    );
    for (const response of [unknown, unconfigured]) {
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        `${base}/sign-in?error=sso_failed`,
      );
    }
  });
});

async function load() {
  const schema = await import("@/db/schema");
  const database = await import("@/db");
  const drizzle = await import("drizzle-orm");
  const { auth } = await import("./auth");
  return { ...schema, ...database, ...drizzle, auth };
}
