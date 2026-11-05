import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({
  cookie: "",
  activeOrganisation: undefined as string | undefined,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: request.cookie }),
  cookies: async () => ({
    get: (name: string) =>
      name === "dingodocs_active_organisation" && request.activeOrganisation
        ? { name, value: request.activeOrganisation }
        : undefined,
  }),
}));

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("tenant-scoped session revocation and absolute expiry", () => {
  const ids = {
    owner: randomUUID(),
    member: randomUUID(),
    orgA: randomUUID(),
    orgB: randomUUID(),
  };
  let modules: Awaited<ReturnType<typeof load>>;
  let secret: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    secret = modules.auth.options.secret as string;
    await modules.db.insert(modules.users).values(
      [ids.owner, ids.member].map((id) => ({
        id,
        name: "Revocation Test",
        email: `${id}@test.invalid`,
        emailVerified: true,
      })),
    );
    await modules.db.insert(modules.organisations).values([
      { id: ids.orgA, slug: `revoke-a-${ids.orgA}`, name: "A revoke test" },
      { id: ids.orgB, slug: `revoke-b-${ids.orgB}`, name: "B revoke test" },
    ]);
    await modules.db.insert(modules.organisationMembers).values([
      {
        organisationId: ids.orgA,
        userId: ids.owner,
        role: "organisation_owner",
      },
      { organisationId: ids.orgA, userId: ids.member, role: "consultant" },
      { organisationId: ids.orgB, userId: ids.member, role: "consultant" },
    ]);
  });

  afterAll(async () => {
    if (!modules) return;
    await modules.deleteAuditEventsForOrganisations(modules.sqlClient, [
      ids.orgA,
      ids.orgB,
    ]);
    await modules.sqlClient.begin(async (tx) => {
      await tx`alter table audit_events disable trigger audit_events_append_only`;
      await tx`delete from audit_events where actor_id in ${tx([ids.owner, ids.member])}`;
      await tx`alter table audit_events enable trigger audit_events_append_only`;
    });
    await modules.db
      .delete(modules.organisations)
      .where(modules.inArray(modules.organisations.id, [ids.orgA, ids.orgB]));
    await modules.db
      .delete(modules.users)
      .where(modules.inArray(modules.users.id, [ids.owner, ids.member]));
    await modules.sqlClient.end();
  });

  async function signIn(userId: string, createdAt = new Date()) {
    const token = randomUUID().replaceAll("-", "");
    const [session] = await modules.db
      .insert(modules.sessions)
      .values({
        userId,
        token,
        createdAt,
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning({ id: modules.sessions.id });
    const signature = createHmac("sha256", secret)
      .update(token)
      .digest("base64");
    request.cookie = `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
    return session!.id;
  }

  function contextFor(organisationId: string | undefined) {
    request.activeOrganisation = organisationId;
    return modules.requireOrganisationContext();
  }

  function authRequest(path: string, init: RequestInit = {}) {
    const base = new URL(modules.auth.options.baseURL as string).origin;
    return modules.auth.handler(
      new Request(`${base}/api/auth${path}`, {
        ...init,
        headers: {
          cookie: request.cookie,
          origin: base,
          "content-type": "application/json",
          ...init.headers,
        },
      }),
    );
  }

  async function sessionIds(userId: string) {
    const rows = await modules.db
      .select({ id: modules.sessions.id })
      .from(modules.sessions)
      .where(modules.eq(modules.sessions.userId, userId));
    return rows.map((row) => row.id).sort();
  }

  it("stops a revoked session minting a replacement to regain tenant access", async () => {
    const password = `Revocation-${randomUUID()}`;
    const [account] = await modules.db
      .insert(modules.accounts)
      .values({
        userId: ids.member,
        accountId: ids.member,
        providerId: "credential",
        password: await modules.hashPassword(password),
      })
      .returning({ id: modules.accounts.id });
    try {
      await modules.db
        .update(modules.organisationMembers)
        .set({ sessionsRevokedAt: null })
        .where(modules.eq(modules.organisationMembers.userId, ids.member));
      await modules.db
        .delete(modules.sessions)
        .where(modules.eq(modules.sessions.userId, ids.member));
      await signIn(ids.member, new Date(Date.now() - 60_000));
      const revokedCookie = request.cookie;

      // Control: an unrevoked session may start passkey registration.
      const allowed = await authRequest("/passkey/generate-register-options");
      expect(allowed.status).toBe(200);

      await modules.revokeOrganisationUserSessions(
        { organisationId: ids.orgA, userId: ids.owner },
        ids.member,
      );
      const before = await sessionIds(ids.member);

      // Attack: rotate the revoked session (newer createdAt) or register a
      // passkey for a later fresh sign-in, all without password + TOTP.
      request.cookie = revokedCookie;
      const passkey = await authRequest("/passkey/generate-register-options");
      expect(passkey.status).toBe(401);
      expect(await passkey.json()).toMatchObject({ code: "SESSION_REVOKED" });
      const rotated = await authRequest("/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: password,
          newPassword: `${password}-next`,
          revokeOtherSessions: true,
        }),
      });
      expect(rotated.status).toBe(401);
      expect(rotated.headers.getSetCookie().join(";")).not.toMatch(
        /session_token=[^;]/,
      );
      const enable = await authRequest("/two-factor/enable", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      expect(enable.status).toBe(401);
      expect(await sessionIds(ids.member)).toEqual(before);

      // Tenant access stays refused; other tenants still work.
      request.cookie = revokedCookie;
      await expect(contextFor(ids.orgA)).rejects.toBeInstanceOf(
        modules.OrganisationSessionRevokedError,
      );
      await expect(contextFor(ids.orgB)).resolves.toMatchObject({
        organisationId: ids.orgB,
      });

      // The revoked session may still sign out.
      const signOut = await authRequest("/sign-out", {
        method: "POST",
        body: "{}",
      });
      expect(signOut.status).toBe(200);
    } finally {
      await modules.db
        .delete(modules.accounts)
        .where(modules.eq(modules.accounts.id, account!.id));
      await modules.db
        .delete(modules.sessions)
        .where(modules.eq(modules.sessions.userId, ids.member));
      await modules.db
        .update(modules.organisationMembers)
        .set({ sessionsRevokedAt: null })
        .where(modules.eq(modules.organisationMembers.userId, ids.member));
    }
  });

  it("revokes the member's sessions for one organisation only", async () => {
    await signIn(ids.member, new Date(Date.now() - 60_000));
    await expect(contextFor(ids.orgA)).resolves.toMatchObject({
      organisationId: ids.orgA,
    });

    await expect(
      modules.revokeOrganisationUserSessions(
        { organisationId: ids.orgA, userId: ids.owner },
        ids.member,
      ),
    ).resolves.toBe(1);

    // The session row survives, so other tenants keep working.
    expect(await modules.getSession()).not.toBeNull();
    await expect(contextFor(ids.orgA)).rejects.toBeInstanceOf(
      modules.OrganisationSessionRevokedError,
    );
    await expect(contextFor(ids.orgA)).rejects.toBeInstanceOf(
      modules.AuthenticationRequiredError,
    );
    await expect(contextFor(ids.orgB)).resolves.toMatchObject({
      organisationId: ids.orgB,
    });
    // With no hint the revoked organisation is skipped, not chosen.
    await expect(contextFor(undefined)).resolves.toMatchObject({
      organisationId: ids.orgB,
    });

    const [membership] = await modules.db
      .select({ revokedAt: modules.organisationMembers.sessionsRevokedAt })
      .from(modules.organisationMembers)
      .where(
        modules.and(
          modules.eq(modules.organisationMembers.organisationId, ids.orgA),
          modules.eq(modules.organisationMembers.userId, ids.member),
        ),
      );
    expect(membership?.revokedAt).toBeInstanceOf(Date);

    // Signing in again restores access to the revoking organisation.
    await signIn(ids.member, new Date(membership!.revokedAt!.getTime() + 1));
    await expect(contextFor(ids.orgA)).resolves.toMatchObject({
      organisationId: ids.orgA,
    });
  });

  it("rejects a session past its absolute expiry and deletes the row", async () => {
    const sessionId = await signIn(ids.member);
    expect(await modules.getSession()).not.toBeNull();
    await modules.db
      .update(modules.sessions)
      .set({ absoluteExpiresAt: new Date(Date.now() - 1_000) })
      .where(modules.eq(modules.sessions.id, sessionId));
    expect(await modules.getSession()).toBeNull();
    const remaining = await modules.db
      .select({ id: modules.sessions.id })
      .from(modules.sessions)
      .where(modules.eq(modules.sessions.id, sessionId));
    expect(remaining).toHaveLength(0);
  });

  it("writes authentication audit rows per organisation membership", async () => {
    const sessionId = await signIn(ids.member);
    await modules.insertAuthenticationAudit(
      {
        actorId: ids.member,
        action: "authentication.session.created",
        targetType: "session",
        targetId: sessionId,
      },
      ids.member,
    );
    await modules.insertAuthenticationAudit(
      { action: "authentication.failed", targetType: "authentication" },
      undefined,
    );
    const rows = await modules.db
      .select({ organisationId: modules.auditEvents.organisationId })
      .from(modules.auditEvents)
      .where(
        modules.and(
          modules.eq(modules.auditEvents.targetId, sessionId),
          modules.eq(
            modules.auditEvents.action,
            "authentication.session.created",
          ),
        ),
      );
    expect(rows.map((row) => row.organisationId).sort()).toEqual(
      [ids.orgA, ids.orgB].sort(),
    );
  });
});

async function load() {
  const schema = await import("@/db/schema");
  const database = await import("@/db");
  const drizzle = await import("drizzle-orm");
  const { auth } = await import("./auth");
  const { hashPassword } = await import("better-auth/crypto");
  const session = await import("./session");
  const activeOrganisation = await import("./active-organisation");
  const authenticationAudit = await import("./authentication-audit");
  const require = await import("@/lib/permissions/require");
  const accountSecurity = await import("@/server/services/account-security");
  const testing = await import("@/server/testing/delete-audit-events");
  return {
    ...schema,
    ...database,
    ...drizzle,
    auth,
    hashPassword,
    ...session,
    ...activeOrganisation,
    ...authenticationAudit,
    ...require,
    ...accountSecurity,
    ...testing,
  };
}
