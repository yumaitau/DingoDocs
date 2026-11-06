import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;
const BASE = "http://127.0.0.1:3000";

// The sql client is a globalThis singleton, so reloaded modules share it and
// it is ended once, in afterAll.
async function load(mode: string) {
  vi.resetModules();
  process.env.DATABASE_URL = testUrl;
  process.env.SIGN_UP_MODE = mode;
  process.env.REQUIRE_EMAIL_VERIFICATION = "false";
  const schema = await import("@/db/schema");
  const database = await import("@/db");
  const drizzle = await import("drizzle-orm");
  const { auth } = await import("./auth");
  return { ...schema, ...database, ...drizzle, auth };
}

type Modules = Awaited<ReturnType<typeof load>>;

let clientCounter = 0;

function signUp(modules: Modules, email: string) {
  return modules.auth.handler(
    new Request(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE,
        // A distinct client per request keeps the sign-up rate limit out of it.
        "x-forwarded-for": `198.51.100.${++clientCounter}`,
      },
      body: JSON.stringify({
        email,
        name: "Sign-up Policy",
        password: `Policy-${randomUUID()}`,
      }),
    }),
  );
}

async function body(response: Response) {
  return (await response.json()) as { code?: string; user?: { id: string } };
}

run("SIGN_UP_MODE through Better Auth", () => {
  const tag = randomUUID();
  const email = (name: string) => `${name}-${tag}@test.invalid`;
  const organisationId = randomUUID();
  let modules: Modules | undefined;

  beforeAll(async () => {
    modules = await load("open");
    await modules.db.insert(modules.organisations).values({
      id: organisationId,
      name: "Sign-up policy test",
      slug: `sign-up-${tag}`,
    });
    await modules.db.insert(modules.organisationInvitations).values([
      {
        organisationId,
        email: email("invited"),
        role: "read_only",
        tokenHash: `pending-${tag}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      },
      {
        organisationId,
        email: email("expired"),
        role: "read_only",
        tokenHash: `expired-${tag}`,
        expiresAt: new Date(Date.now() - 60 * 1_000),
      },
    ]);
  });

  afterAll(async () => {
    if (!modules) return;
    const created = await modules.db
      .select({ id: modules.users.id })
      .from(modules.users)
      .where(modules.like(modules.users.email, `%-${tag}@test.invalid`));
    const ids = created.map((user) => user.id);
    if (ids.length) {
      await modules.sqlClient.begin(async (tx) => {
        await tx`alter table audit_events disable trigger audit_events_append_only`;
        await tx`delete from audit_events where actor_id in ${tx(ids)}`;
        await tx`alter table audit_events enable trigger audit_events_append_only`;
      });
      await modules.db
        .delete(modules.users)
        .where(modules.inArray(modules.users.id, ids));
    }
    await modules.db
      .delete(modules.organisations)
      .where(modules.eq(modules.organisations.id, organisationId));
    await modules.sqlClient.end();
  });

  it("open mode creates any account", async () => {
    const response = await signUp(modules!, email("open"));
    expect(response.status).toBe(200);
  });

  it("invite mode admits only a pending invitation", async () => {
    modules = await load("invite");
    const invited = await signUp(modules, email("Invited").toUpperCase());
    expect(invited.status).toBe(200);
    for (const address of [email("stranger"), email("expired")]) {
      const refused = await signUp(modules, address);
      expect(refused.status).toBe(403);
      expect((await body(refused)).code).toBe("SIGN_UP_DISABLED");
    }
  });

  it("closed mode refuses email sign-up", async () => {
    modules = await load("closed");
    const refused = await signUp(modules, email("closed"));
    expect(refused.status).toBe(403);
    expect((await body(refused)).code).toBe("SIGN_UP_DISABLED");

    const [row] = await modules.db
      .select({ id: modules.users.id })
      .from(modules.users)
      .where(modules.eq(modules.users.email, email("closed")));
    expect(row).toBeUndefined();
  });
});
