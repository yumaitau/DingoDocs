import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("account security and retention with PostgreSQL", () => {
  const ids = {
    organisation: randomUUID(),
    actor: randomUUID(),
    invited: randomUUID(),
    client: randomUUID(),
    engagement: randomUUID(),
    evidence: randomUUID(),
    session: randomUUID(),
  };
  let modules: Awaited<ReturnType<typeof load>>;
  const deleted: string[] = [];
  const provider = {
    name: "test",
    put: async () => {
      throw new Error("not used");
    },
    get: async () => new ReadableStream<Uint8Array>(),
    delete: async (key: string) => {
      deleted.push(key);
    },
    exists: async () => true,
    healthCheck: async () => undefined,
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    await modules.db.insert(modules.users).values([
      {
        id: ids.actor,
        name: "Security Admin",
        email: `${ids.actor}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.invited,
        name: "Invited User",
        email: `${ids.invited}@test.invalid`,
        emailVerified: true,
      },
    ]);
    await modules.db.insert(modules.organisations).values({
      id: ids.organisation,
      slug: `security-${ids.organisation}`,
      name: "Security Test",
    });
    await modules.db.insert(modules.organisationMembers).values({
      organisationId: ids.organisation,
      userId: ids.actor,
      role: "organisation_owner",
      joinedAt: new Date(),
    });
    await modules.db.insert(modules.clients).values({
      id: ids.client,
      organisationId: ids.organisation,
      name: "Retention Client",
    });
    await modules.db.insert(modules.engagements).values({
      id: ids.engagement,
      organisationId: ids.organisation,
      clientId: ids.client,
      name: "Retention Test",
      reference: `RET-${ids.engagement.slice(0, 8)}`,
      type: "Web",
    });
    await modules.db.insert(modules.evidence).values({
      id: ids.evidence,
      organisationId: ids.organisation,
      clientId: ids.client,
      engagementId: ids.engagement,
      originalFilename: "expired.txt",
      storageProvider: "test",
      storageKey: `retention/${ids.evidence}`,
      mediaType: "text/plain",
      sizeBytes: 7,
      sha256: "a".repeat(64),
      retentionUntil: new Date(Date.now() - 60_000),
      uploadedBy: ids.actor,
    });
    await modules.db.insert(modules.sessions).values({
      id: ids.session,
      userId: ids.invited,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  });

  afterAll(async () => {
    if (!modules) return;
    await modules.db
      .delete(modules.auditEvents)
      .where(modules.eq(modules.auditEvents.organisationId, ids.organisation));
    await modules.db
      .delete(modules.organisations)
      .where(modules.eq(modules.organisations.id, ids.organisation));
    await modules.db
      .delete(modules.users)
      .where(modules.inArray(modules.users.id, [ids.actor, ids.invited]));
    await modules.sqlClient.end();
  });

  it("excludes active legal holds and requires an exact purge confirmation", async () => {
    expect(await modules.previewRetention(ids.organisation)).toHaveLength(1);
    const hold = await modules.placeLegalHold(
      { organisationId: ids.organisation, userId: ids.actor },
      { evidenceId: ids.evidence, reason: "Regulatory preservation" },
    );
    expect(await modules.previewRetention(ids.organisation)).toHaveLength(0);
    await modules.releaseLegalHold(
      { organisationId: ids.organisation, userId: ids.actor },
      hold.id,
    );
    await expect(
      modules.purgeExpiredEvidence(ids.organisation, {
        actorId: ids.actor,
        confirmation: "yes",
        provider,
      }),
    ).rejects.toThrow("PURGE 1");
    await expect(
      modules.purgeExpiredEvidence(ids.organisation, {
        actorId: ids.actor,
        confirmation: "PURGE 1",
        provider,
      }),
    ).resolves.toEqual({ eligible: 1, destroyed: 1 });
    expect(deleted).toEqual([`retention/${ids.evidence}`]);
    expect(
      await modules.db
        .select()
        .from(modules.auditEvents)
        .where(
          modules.and(
            modules.eq(
              modules.auditEvents.action,
              "retention.evidence.destroyed",
            ),
            modules.eq(modules.auditEvents.targetId, ids.evidence),
          ),
        ),
    ).toHaveLength(1);
  });

  it("accepts single-use invitations and allows administrator forced logout", async () => {
    process.env.SMTP_HOST = "";
    const invitation = await modules.createSecureInvitation(
      { organisationId: ids.organisation, userId: ids.actor },
      { email: `${ids.invited}@test.invalid`, role: "consultant" },
    );
    const [stored] = await modules.db
      .select()
      .from(modules.organisationInvitations)
      .where(modules.eq(modules.organisationInvitations.id, invitation.id));
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).not.toContain(ids.invited);
    await expect(
      modules.revokeOrganisationUserSessions(
        { organisationId: ids.organisation, userId: ids.actor },
        ids.invited,
      ),
    ).rejects.toThrow("active organisation member");
    const acceptanceToken = randomUUID() + randomUUID();
    await modules.db.insert(modules.organisationInvitations).values({
      organisationId: ids.organisation,
      email: `${ids.invited}@test.invalid`,
      role: "consultant",
      tokenHash: createHash("sha256").update(acceptanceToken).digest("hex"),
      invitedBy: ids.actor,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      modules.acceptSecureInvitation(
        { id: ids.invited, email: `${ids.invited}@test.invalid` },
        acceptanceToken,
      ),
    ).resolves.toBe(ids.organisation);
    await expect(
      modules.acceptSecureInvitation(
        { id: ids.invited, email: `${ids.invited}@test.invalid` },
        acceptanceToken,
      ),
    ).rejects.toThrow("invalid");
    await expect(
      modules.revokeOrganisationUserSessions(
        { organisationId: ids.organisation, userId: ids.actor },
        ids.invited,
      ),
    ).resolves.toBe(1);
  });
});

async function load() {
  const schema = await import("@/db/schema");
  const database = await import("@/db");
  const drizzle = await import("drizzle-orm");
  const retention = await import("./retention");
  const security = await import("./account-security");
  return { ...schema, ...database, ...drizzle, ...retention, ...security };
}
