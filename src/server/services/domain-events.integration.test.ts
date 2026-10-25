import { randomUUID } from "node:crypto";
import { deleteAuditEventsForOrganisations } from "@/server/testing/delete-audit-events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("domain event notification audience with PostgreSQL", () => {
  const ids = {
    org: randomUUID(),
    owner: randomUUID(),
    actor: randomUUID(),
    member: randomUUID(),
    nonMember: randomUUID(),
    clientUserA: randomUUID(),
    clientUserB: randomUUID(),
    clientA: randomUUID(),
    clientB: randomUUID(),
    engagementA: randomUUID(),
    engagementB: randomUUID(),
    contactA: randomUUID(),
    contactB: randomUUID(),
    finding: randomUUID(),
  };
  const userIds = [
    ids.owner,
    ids.actor,
    ids.member,
    ids.nonMember,
    ids.clientUserA,
    ids.clientUserB,
  ];
  let modules: Awaited<ReturnType<typeof load>>;

  async function recipients(title: string) {
    const rows = await modules.db
      .select({ userId: modules.notifications.userId })
      .from(modules.notifications)
      .where(
        modules.and(
          modules.eq(modules.notifications.organisationId, ids.org),
          modules.eq(modules.notifications.title, title),
        ),
      );
    return new Set(rows.map((row) => row.userId));
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
      .values({ id: ids.org, slug: `events-${ids.org}`, name: "Events" });
    await modules.db.insert(modules.organisationMembers).values([
      {
        organisationId: ids.org,
        userId: ids.owner,
        role: "organisation_owner",
      },
      {
        organisationId: ids.org,
        userId: ids.actor,
        role: "engagement_manager",
      },
      { organisationId: ids.org, userId: ids.member, role: "consultant" },
      { organisationId: ids.org, userId: ids.nonMember, role: "consultant" },
      { organisationId: ids.org, userId: ids.clientUserA, role: "client_user" },
      {
        organisationId: ids.org,
        userId: ids.clientUserB,
        role: "client_administrator",
      },
    ]);
    await modules.db.insert(modules.clients).values([
      { id: ids.clientA, organisationId: ids.org, name: "Client A" },
      { id: ids.clientB, organisationId: ids.org, name: "Client B" },
    ]);
    await modules.db.insert(modules.engagements).values([
      {
        id: ids.engagementA,
        organisationId: ids.org,
        clientId: ids.clientA,
        name: "Client A assessment",
        reference: `EVA-${ids.engagementA.slice(0, 8)}`,
        type: "Web application",
      },
      {
        id: ids.engagementB,
        organisationId: ids.org,
        clientId: ids.clientB,
        name: "Client B assessment",
        reference: `EVB-${ids.engagementB.slice(0, 8)}`,
        type: "Cloud",
      },
    ]);
    await modules.db.insert(modules.engagementMembers).values([
      {
        organisationId: ids.org,
        engagementId: ids.engagementA,
        userId: ids.actor,
        role: "engagement_manager",
      },
      {
        organisationId: ids.org,
        engagementId: ids.engagementA,
        userId: ids.member,
        role: "consultant",
      },
      {
        organisationId: ids.org,
        engagementId: ids.engagementB,
        userId: ids.nonMember,
        role: "consultant",
      },
    ]);
    await modules.db.insert(modules.clientContacts).values([
      {
        id: ids.contactA,
        organisationId: ids.org,
        clientId: ids.clientA,
        userId: ids.clientUserA,
        name: "Client A user",
        email: `${ids.clientUserA}@test.invalid`,
      },
      {
        id: ids.contactB,
        organisationId: ids.org,
        clientId: ids.clientB,
        userId: ids.clientUserB,
        name: "Client B admin",
        email: `${ids.clientUserB}@test.invalid`,
      },
    ]);
    await modules.db.insert(modules.engagementContacts).values([
      {
        organisationId: ids.org,
        engagementId: ids.engagementA,
        contactId: ids.contactA,
      },
      {
        organisationId: ids.org,
        engagementId: ids.engagementB,
        contactId: ids.contactB,
      },
    ]);
    await modules.db.insert(modules.findings).values({
      id: ids.finding,
      organisationId: ids.org,
      engagementId: ids.engagementA,
      identifier: "F-001",
      title: "Event finding",
      status: "draft",
      severity: "high",
      authorId: ids.actor,
    });
  });

  afterAll(async () => {
    if (!modules) return;
    await deleteAuditEventsForOrganisations(modules.sqlClient, [ids.org]);
    await modules.db
      .delete(modules.organisations)
      .where(modules.eq(modules.organisations.id, ids.org));
    await modules.db
      .delete(modules.users)
      .where(modules.inArray(modules.users.id, userIds));
    await modules.sqlClient.end();
  });

  it("sends client-visible engagement events only to that engagement's grant holders and staff", async () => {
    const title = `Report published: A ${randomUUID()}`;
    await modules.emitDomainEvent({
      organisationId: ids.org,
      actorUserId: ids.actor,
      eventType: "report.published",
      title,
      engagementId: ids.engagementA,
    });
    const got = await recipients(title);
    expect(got).toEqual(new Set([ids.owner, ids.member, ids.clientUserA]));
    expect(got.has(ids.clientUserB)).toBe(false);
    expect(got.has(ids.nonMember)).toBe(false);
    expect(got.has(ids.actor)).toBe(false);
  });

  it("keeps internal engagement events from non-member staff and clients", async () => {
    const title = `Finding F-001 transitioned ${randomUUID()}`;
    await modules.emitDomainEvent({
      organisationId: ids.org,
      actorUserId: ids.actor,
      eventType: "finding.transitioned",
      title,
      engagementId: ids.engagementA,
    });
    expect(await recipients(title)).toEqual(new Set([ids.owner, ids.member]));
  });

  it("never notifies clients about events without an engagement", async () => {
    const title = `Client-safe orphan ${randomUUID()}`;
    await modules.emitDomainEvent(
      modules.withClientAudience({
        organisationId: ids.org,
        eventType: "retest.completed",
        title,
      }),
    );
    const got = await recipients(title);
    expect(got.has(ids.clientUserA)).toBe(false);
    expect(got.has(ids.clientUserB)).toBe(false);
    expect(got.has(ids.nonMember)).toBe(true);
  });

  it("only fans comment replies out to clients on client-visible threads", async () => {
    const actor = { organisationId: ids.org, userId: ids.actor };
    const teamRoot = await modules.createComment(actor, {
      targetType: "finding",
      targetId: ids.finding,
      body: "Team-only thread",
      visibility: "team",
      title: `Team root ${randomUUID()}`,
    });
    const teamTitle = `Team reply ${randomUUID()}`;
    await modules.replyComment(actor, {
      parentId: teamRoot.id,
      body: "Reply",
      title: teamTitle,
    });
    expect(await recipients(teamTitle)).toEqual(
      new Set([ids.owner, ids.member]),
    );

    const clientRoot = await modules.createComment(actor, {
      targetType: "finding",
      targetId: ids.finding,
      body: "Client thread",
      visibility: "client",
      title: `Client root ${randomUUID()}`,
    });
    const clientTitle = `Client reply ${randomUUID()}`;
    await modules.replyComment(actor, {
      parentId: clientRoot.id,
      body: "Reply",
      title: clientTitle,
    });
    const got = await recipients(clientTitle);
    expect(got.has(ids.clientUserA)).toBe(true);
    expect(got.has(ids.clientUserB)).toBe(false);
    expect(got.has(ids.nonMember)).toBe(false);
  });
});

async function load() {
  const [{ db, sqlClient }, schema, events, comments, drizzle] =
    await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("./domain-events"),
      import("./comments"),
      import("drizzle-orm"),
    ]);
  return { db, sqlClient, ...schema, ...events, ...comments, ...drizzle };
}
