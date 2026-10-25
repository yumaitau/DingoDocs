import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sentLinks = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/email/send", () => ({
  sendAuthenticationEmail: async (input: { to: string; url: string }) => {
    sentLinks.set(input.to, input.url);
  },
}));

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("email-only sign-in for TOTP-enrolled accounts", () => {
  const ids = {
    enrolled: randomUUID(),
    plain: randomUUID(),
    unverifiedEnrolled: randomUUID(),
    unverifiedPlain: randomUUID(),
  };
  const email = (id: string) => `${id}@test.invalid`;
  let modules: Awaited<ReturnType<typeof load>>;
  let base: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    base = new URL(modules.auth.options.baseURL as string).origin;
    await modules.db.insert(modules.users).values(
      [
        { id: ids.enrolled, twoFactorEnabled: true, emailVerified: true },
        { id: ids.plain, twoFactorEnabled: false, emailVerified: true },
        { id: ids.unverifiedEnrolled, twoFactorEnabled: true },
        { id: ids.unverifiedPlain, twoFactorEnabled: false },
      ].map((user) => ({
        emailVerified: false,
        ...user,
        name: "Second Factor Test",
        email: email(user.id),
      })),
    );
  });

  afterAll(async () => {
    if (!modules) return;
    const userIds = Object.values(ids);
    await modules.sqlClient.begin(async (tx) => {
      await tx`alter table audit_events disable trigger audit_events_append_only`;
      await tx`delete from audit_events where actor_id in ${tx(userIds)}`;
      await tx`alter table audit_events enable trigger audit_events_append_only`;
    });
    await modules.db
      .delete(modules.users)
      .where(modules.inArray(modules.users.id, userIds));
    await modules.sqlClient.end();
  });

  async function sessionCount(userId: string) {
    const rows = await modules.db
      .select({ id: modules.sessions.id })
      .from(modules.sessions)
      .where(modules.eq(modules.sessions.userId, userId));
    return rows.length;
  }

  async function magicLinkVerify(userId: string) {
    const requested = await modules.auth.handler(
      new Request(`${base}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({
          email: email(userId),
          callbackURL: "/engagements",
          errorCallbackURL: "/engagements",
        }),
      }),
    );
    expect(requested.status).toBe(200);
    const link = sentLinks.get(email(userId));
    expect(link).toBeTruthy();
    return modules.auth.handler(new Request(link!));
  }

  async function verifyEmail(userId: string) {
    const token = await modules.createEmailVerificationToken(
      modules.auth.options.secret as string,
      email(userId),
    );
    return modules.auth.handler(
      new Request(
        `${base}/api/auth/verify-email?token=${token}&callbackURL=%2Fengagements`,
      ),
    );
  }

  function setsSessionCookie(response: Response) {
    return response.headers
      .getSetCookie()
      .some((cookie) => /session_token=[^;]+/.test(cookie));
  }

  it("magic-link verify issues no session to a TOTP-enrolled user", async () => {
    const response = await magicLinkVerify(ids.enrolled);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!, base);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("error")).toBe("two_factor_required");
    expect(setsSessionCookie(response)).toBe(false);
    expect(await sessionCount(ids.enrolled)).toBe(0);
  });

  it("magic-link verify still signs in a user without TOTP", async () => {
    const response = await magicLinkVerify(ids.plain);
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location")!, base).pathname).toBe(
      "/engagements",
    );
    expect(setsSessionCookie(response)).toBe(true);
    expect(await sessionCount(ids.plain)).toBe(1);
  });

  it("verify-email verifies a TOTP-enrolled user but creates no session", async () => {
    const response = await verifyEmail(ids.unverifiedEnrolled);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!, base);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("error")).toBe("two_factor_required");
    expect(setsSessionCookie(response)).toBe(false);
    expect(await sessionCount(ids.unverifiedEnrolled)).toBe(0);
    const [user] = await modules.db
      .select({ emailVerified: modules.users.emailVerified })
      .from(modules.users)
      .where(modules.eq(modules.users.id, ids.unverifiedEnrolled));
    expect(user?.emailVerified).toBe(true);
  });

  it("verify-email still auto signs in a user without TOTP", async () => {
    const response = await verifyEmail(ids.unverifiedPlain);
    expect(response.status).toBe(302);
    expect(setsSessionCookie(response)).toBe(true);
    expect(await sessionCount(ids.unverifiedPlain)).toBe(1);
  });
});

async function load() {
  const schema = await import("@/db/schema");
  const database = await import("@/db");
  const drizzle = await import("drizzle-orm");
  const { auth } = await import("./auth");
  const { createEmailVerificationToken } = await import("better-auth/api");
  return {
    ...schema,
    ...database,
    ...drizzle,
    auth,
    createEmailVerificationToken,
  };
}
