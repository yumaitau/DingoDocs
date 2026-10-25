import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => ({ user: { id: session.userId } }),
}));
vi.mock("@/lib/auth/mfa-policy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/mfa-policy")>()),
  loadMfaEnforcement: async () => ({ blocked: false }),
}));

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("planning actions enforce engagement access with PostgreSQL", () => {
  const ids = {
    org: randomUUID(),
    member: randomUUID(),
    nonMember: randomUUID(),
    clientUser: randomUUID(),
    client: randomUUID(),
    engagement: randomUUID(),
    task: randomUUID(),
  };
  const userIds = [ids.member, ids.nonMember, ids.clientUser];
  let modules: Awaited<ReturnType<typeof load>>;

  function statusForm(status: string) {
    const form = new FormData();
    form.set("taskId", ids.task);
    form.set("status", status);
    return form;
  }

  async function taskStatus() {
    const [row] = await modules.db
      .select({ status: modules.tasks.status })
      .from(modules.tasks)
      .where(modules.eq(modules.tasks.id, ids.task));
    return row?.status;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    await modules.db.insert(modules.users).values(
      userIds.map((id) => ({
        id,
        name: `User ${id.slice(0, 8)}`,
        email: `${id}@test.invalid`,
        emailVerified: true,
      })),
    );
    await modules.db
      .insert(modules.organisations)
      .values({ id: ids.org, slug: `plan-${ids.org}`, name: "Planning" });
    await modules.db.insert(modules.organisationMembers).values([
      { organisationId: ids.org, userId: ids.member, role: "consultant" },
      {
        organisationId: ids.org,
        userId: ids.nonMember,
        role: "engagement_manager",
      },
      { organisationId: ids.org, userId: ids.clientUser, role: "client_user" },
    ]);
    await modules.db
      .insert(modules.clients)
      .values({ id: ids.client, organisationId: ids.org, name: "Client" });
    await modules.db.insert(modules.engagements).values({
      id: ids.engagement,
      organisationId: ids.org,
      clientId: ids.client,
      name: "Recurring assessment",
      reference: `PLN-${ids.engagement.slice(0, 8)}`,
      type: "Web application",
      startDate: "2026-01-01",
      endDate: "2026-01-10",
      recurrence: "monthly",
    });
    await modules.db.insert(modules.engagementMembers).values({
      organisationId: ids.org,
      engagementId: ids.engagement,
      userId: ids.member,
      role: "consultant",
    });
    await modules.db.insert(modules.tasks).values({
      id: ids.task,
      organisationId: ids.org,
      engagementId: ids.engagement,
      title: "Scoping call",
    });
  });

  afterAll(async () => {
    if (!modules) return;
    await modules.db
      .delete(modules.organisations)
      .where(modules.eq(modules.organisations.id, ids.org));
    await modules.db
      .delete(modules.users)
      .where(modules.inArray(modules.users.id, userIds));
    await modules.sqlClient.end();
  });

  it("denies task status changes to non-members and client users", async () => {
    session.userId = ids.nonMember;
    await expect(
      modules.updateTaskStatusAction(statusForm("done")),
    ).rejects.toThrow(/Permission denied/);
    session.userId = ids.clientUser;
    await expect(
      modules.updateTaskStatusAction(statusForm("done")),
    ).rejects.toThrow(/client portal/);
    expect(await taskStatus()).toBe("todo");

    session.userId = ids.member;
    await modules.updateTaskStatusAction(statusForm("in_progress"));
    expect(await taskStatus()).toBe("in_progress");
  });

  it("lets the assignee move their own task", async () => {
    await modules.db
      .update(modules.tasks)
      .set({ assigneeId: ids.nonMember })
      .where(modules.eq(modules.tasks.id, ids.task));
    session.userId = ids.nonMember;
    await modules.updateTaskStatusAction(statusForm("blocked"));
    expect(await taskStatus()).toBe("blocked");
  });

  it("hides the source engagement from non-members creating the next occurrence", async () => {
    session.userId = ids.nonMember;
    const form = new FormData();
    form.set("engagementId", ids.engagement);
    await expect(modules.createNextOccurrenceAction(form)).rejects.toThrow(
      "Engagement not found",
    );
  });
});

async function load() {
  const [{ db, sqlClient }, schema, actions, drizzle] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("./planning"),
    import("drizzle-orm"),
  ]);
  return { db, sqlClient, ...schema, ...actions, ...drizzle };
}
