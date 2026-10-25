import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteAuditEventsForOrganisations } from "@/server/testing/delete-audit-events";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("scanner re-import and organisation export safety", () => {
  const ids = {
    org: randomUUID(),
    admin: randomUUID(),
    client: randomUUID(),
    deletedClient: randomUUID(),
    engagement: randomUUID(),
    orphanEngagement: randomUUID(),
    liveFinding: randomUUID(),
    deletedFinding: randomUUID(),
    orphanFinding: randomUUID(),
  };
  const admin = { organisationId: ids.org, userId: ids.admin };
  let modules: Awaited<ReturnType<typeof load>>;
  let root: string;

  const csv = (row: string) =>
    new TextEncoder().encode(`id,title,severity,host,description\n${row}`);
  const preview = (bytes: Uint8Array) =>
    modules.previewScannerImport(admin, {
      engagementId: ids.engagement,
      adapter: "csv",
      filename: "scan.csv",
      mediaType: "text/csv",
      bytes,
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    root = await mkdtemp(join(tmpdir(), "dingodocs-exchange-safety-"));
    process.env.LOCAL_STORAGE_ROOT = root;
    modules = await load();
    await modules.db.insert(modules.users).values({
      id: ids.admin,
      name: "Admin",
      email: `${ids.admin}@test.invalid`,
      emailVerified: true,
    });
    await modules.db.insert(modules.organisations).values({
      id: ids.org,
      slug: `exchange-safety-${ids.org}`,
      name: "Exchange Safety",
      securityPolicy: {
        mfaMode: "optional",
        sso: {
          protocol: "oidc",
          issuer: "https://idp.test",
          clientId: "public-client-id",
          clientSecretEncrypted: "enc-secret-must-not-export",
        },
      },
    });
    await modules.db.insert(modules.organisationMembers).values({
      organisationId: ids.org,
      userId: ids.admin,
      role: "organisation_owner",
      joinedAt: new Date(),
    });
    await modules.db.insert(modules.clients).values([
      { id: ids.client, organisationId: ids.org, name: "Live Client" },
      {
        id: ids.deletedClient,
        organisationId: ids.org,
        name: "Deleted Client",
        deletedAt: new Date(),
      },
    ]);
    await modules.db.insert(modules.engagements).values([
      {
        id: ids.engagement,
        organisationId: ids.org,
        clientId: ids.client,
        name: "Live Engagement",
        reference: `LIVE-${ids.engagement.slice(0, 8)}`,
        type: "Web",
      },
      {
        id: ids.orphanEngagement,
        organisationId: ids.org,
        clientId: ids.deletedClient,
        name: "Engagement Under Deleted Client",
        reference: `ORPH-${ids.orphanEngagement.slice(0, 8)}`,
        type: "Web",
      },
    ]);
    await modules.db.insert(modules.findings).values([
      {
        id: ids.liveFinding,
        organisationId: ids.org,
        engagementId: ids.engagement,
        identifier: "LIVE-1",
        title: "Live finding",
        status: "draft",
        severity: "high",
      },
      {
        id: ids.deletedFinding,
        organisationId: ids.org,
        engagementId: ids.engagement,
        identifier: "DEL-1",
        title: "Deleted finding",
        status: "draft",
        severity: "high",
        deletedAt: new Date(),
      },
      {
        id: ids.orphanFinding,
        organisationId: ids.org,
        engagementId: ids.orphanEngagement,
        identifier: "ORPH-1",
        title: "Finding under deleted client",
        status: "draft",
        severity: "low",
      },
    ]);
    await modules.db.insert(modules.notes).values([
      {
        organisationId: ids.org,
        engagementId: ids.engagement,
        title: "Team note",
        content: { text: "team" },
        visibility: "team",
        authorId: ids.admin,
      },
      {
        organisationId: ids.org,
        engagementId: ids.engagement,
        title: "Private note",
        content: { text: "private" },
        visibility: "private",
        authorId: ids.admin,
      },
    ]);
    await modules.db.insert(modules.comments).values([
      {
        organisationId: ids.org,
        targetType: "finding",
        targetId: ids.liveFinding,
        body: "team comment",
        visibility: "team",
        authorId: ids.admin,
      },
      {
        organisationId: ids.org,
        targetType: "finding",
        targetId: ids.liveFinding,
        body: "private comment",
        visibility: "private",
        authorId: ids.admin,
      },
      {
        organisationId: ids.org,
        targetType: "finding",
        targetId: ids.deletedFinding,
        body: "comment on deleted finding",
        visibility: "team",
        authorId: ids.admin,
      },
    ]);
  });

  afterAll(async () => {
    if (!modules) return;
    await deleteAuditEventsForOrganisations(modules.sqlClient, [ids.org]);
    await modules.db
      .delete(modules.organisations)
      .where(modules.eq(modules.organisations.id, ids.org));
    await modules.db
      .delete(modules.users)
      .where(modules.eq(modules.users.id, ids.admin));
    await modules.sqlClient.end();
    await rm(root, { recursive: true, force: true });
    delete process.env.LOCAL_STORAGE_ROOT;
  });

  it("treats a soft-deleted imported finding as a duplicate on re-import", async () => {
    const bytes = csv("sd-1,Soft deleted issue,high,sd.test,Detail");
    const first = await preview(bytes);
    const [created] = await modules.applyScannerImport(admin, {
      importRunId: first.run.id,
      selectedItemIds: first.items.map((item) => item.id),
    });
    await modules.db
      .update(modules.findings)
      .set({ deletedAt: new Date() })
      .where(modules.eq(modules.findings.id, created!.findingId));

    const again = await preview(bytes);
    expect(again.items[0]).toMatchObject({
      action: "duplicate",
      selected: false,
    });
    await expect(
      modules.applyScannerImport(admin, {
        importRunId: again.run.id,
        selectedItemIds: [],
      }),
    ).resolves.toEqual([]);
  });

  it("skips an identifier taken between two previews instead of aborting", async () => {
    const bytes = csv("race-1,Raced issue,medium,race.test,Detail");
    const a = await preview(bytes);
    const b = await preview(bytes);
    expect(b.items[0]?.action).toBe("create");
    await modules.applyScannerImport(admin, {
      importRunId: a.run.id,
      selectedItemIds: [a.items[0]!.id],
    });
    await expect(
      modules.applyScannerImport(admin, {
        importRunId: b.run.id,
        selectedItemIds: [b.items[0]!.id],
      }),
    ).resolves.toEqual([]);
    const [item] = await modules.db
      .select()
      .from(modules.importItems)
      .where(modules.eq(modules.importItems.id, b.items[0]!.id));
    expect(item).toMatchObject({ action: "duplicate", selected: false });
    const [runRow] = await modules.db
      .select()
      .from(modules.importRuns)
      .where(modules.eq(modules.importRuns.id, b.run.id));
    expect(runRow?.status).toBe("applied");
  });

  it("serialises concurrent applies of the same import run", async () => {
    const bytes = csv("conc-1,Concurrent issue,low,conc.test,Detail");
    const p = await preview(bytes);
    const apply = () =>
      modules.applyScannerImport(admin, {
        importRunId: p.run.id,
        selectedItemIds: [p.items[0]!.id],
      });
    const results = await Promise.allSettled([apply(), apply()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(modules.ExchangeScopeError);
    const rows = await modules.db
      .select({ id: modules.findings.id })
      .from(modules.findings)
      .where(
        modules.and(
          modules.eq(modules.findings.engagementId, ids.engagement),
          modules.eq(
            modules.findings.sourceFingerprint,
            p.items[0]!.fingerprint,
          ),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("exports without secrets, private notes/comments, or soft-deleted rows", async () => {
    const { payload, json } = await modules.exportOrganisation(
      admin,
      "migration",
    );
    expect(json).not.toContain("enc-secret-must-not-export");
    expect(payload.organisation.securityPolicy?.sso).toMatchObject({
      clientId: "public-client-id",
      issuer: "https://idp.test",
    });
    const idsIn = (rows: Array<{ id: string }> | undefined) =>
      (rows ?? []).map((row) => row.id);
    expect(idsIn(payload.clients)).toEqual([ids.client]);
    expect(idsIn(payload.engagements)).toEqual([ids.engagement]);
    expect(idsIn(payload.findings)).toContain(ids.liveFinding);
    expect(idsIn(payload.findings)).not.toEqual(
      expect.arrayContaining([ids.deletedFinding]),
    );
    expect(idsIn(payload.findings)).not.toContain(ids.orphanFinding);
    expect(
      (payload.findings ?? []).every((finding) => finding.deletedAt === null),
    ).toBe(true);
    expect((payload.notes ?? []).map((note) => note.title)).toEqual([
      "Team note",
    ]);
    expect((payload.comments ?? []).map((comment) => comment.body)).toEqual([
      "team comment",
    ]);
  });
});

async function load() {
  const [{ db, sqlClient }, schema, exchange, drizzle] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("./data-exchange"),
    import("drizzle-orm"),
  ]);
  return { db, sqlClient, ...schema, ...exchange, ...drizzle };
}
