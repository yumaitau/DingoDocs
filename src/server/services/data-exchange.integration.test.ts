import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("scanner exchange, backup, and tenant-safe PostgreSQL search", () => {
  const ids = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    admin: randomUUID(),
    clientUser: randomUUID(),
    outsider: randomUUID(),
    clientA: randomUUID(),
    clientB: randomUUID(),
    engagementA: randomUUID(),
    engagementB: randomUUID(),
    contact: randomUUID(),
    visibleFinding: randomUUID(),
    draftFinding: randomUUID(),
    otherFinding: randomUUID(),
  };
  const admin = {
    organisationId: ids.orgA,
    userId: ids.admin,
    role: "organisation_owner",
  };
  const client = {
    organisationId: ids.orgA,
    userId: ids.clientUser,
    role: "client_user",
  };
  let modules: Awaited<ReturnType<typeof load>>;
  let root: string;
  let importRunId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    root = await mkdtemp(join(tmpdir(), "dingodocs-import-"));
    process.env.LOCAL_STORAGE_ROOT = root;
    modules = await load();
    await modules.db.insert(modules.users).values([
      {
        id: ids.admin,
        name: "Admin",
        email: `${ids.admin}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.clientUser,
        name: "Client",
        email: `${ids.clientUser}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.outsider,
        name: "Outsider",
        email: `${ids.outsider}@test.invalid`,
        emailVerified: true,
      },
    ]);
    await modules.db.insert(modules.organisations).values([
      { id: ids.orgA, slug: `exchange-${ids.orgA}`, name: "Exchange A" },
      { id: ids.orgB, slug: `exchange-${ids.orgB}`, name: "Exchange B" },
    ]);
    await modules.db.insert(modules.organisationMembers).values([
      {
        organisationId: ids.orgA,
        userId: ids.admin,
        role: "organisation_owner",
      },
      { organisationId: ids.orgA, userId: ids.clientUser, role: "client_user" },
      {
        organisationId: ids.orgB,
        userId: ids.outsider,
        role: "organisation_owner",
      },
    ]);
    await modules.db.insert(modules.clients).values([
      { id: ids.clientA, organisationId: ids.orgA, name: "Search Client" },
      { id: ids.clientB, organisationId: ids.orgB, name: "Other Client" },
    ]);
    await modules.db.insert(modules.engagements).values([
      {
        id: ids.engagementA,
        organisationId: ids.orgA,
        clientId: ids.clientA,
        name: "Shared Needle Assessment",
        reference: `SEA-${ids.engagementA.slice(0, 8)}`,
        type: "Web",
      },
      {
        id: ids.engagementB,
        organisationId: ids.orgB,
        clientId: ids.clientB,
        name: "Other Needle Assessment",
        reference: `SEB-${ids.engagementB.slice(0, 8)}`,
        type: "Cloud",
      },
    ]);
    await modules.db.insert(modules.clientContacts).values({
      id: ids.contact,
      organisationId: ids.orgA,
      clientId: ids.clientA,
      userId: ids.clientUser,
      name: "Client",
      email: `${ids.clientUser}@test.invalid`,
    });
    await modules.db.insert(modules.engagementContacts).values({
      organisationId: ids.orgA,
      engagementId: ids.engagementA,
      contactId: ids.contact,
    });
    await modules.db.insert(modules.findings).values([
      {
        id: ids.visibleFinding,
        organisationId: ids.orgA,
        engagementId: ids.engagementA,
        identifier: "SHARED-1",
        title: "Shared Needle Finding",
        status: "published",
        severity: "high",
        executiveSummary: "safe needle",
        clientVisible: true,
        publishedAt: new Date(),
      },
      {
        id: ids.draftFinding,
        organisationId: ids.orgA,
        engagementId: ids.engagementA,
        identifier: "DRAFT-1",
        title: "Secret Needle Draft",
        status: "draft",
        severity: "critical",
        clientVisible: false,
      },
      {
        id: ids.otherFinding,
        organisationId: ids.orgB,
        engagementId: ids.engagementB,
        identifier: "OTHER-1",
        title: "Other Needle Finding",
        status: "published",
        severity: "high",
        clientVisible: true,
        publishedAt: new Date(),
      },
    ]);
    await modules.db.insert(modules.notes).values({
      organisationId: ids.orgA,
      engagementId: ids.engagementA,
      title: "Internal Needle Note",
      content: { text: "never client visible" },
      authorId: ids.admin,
    });
  });
  afterAll(async () => {
    if (!modules) return;
    await modules.db
      .delete(modules.auditEvents)
      .where(
        modules.inArray(modules.auditEvents.organisationId, [
          ids.orgA,
          ids.orgB,
        ]),
      );
    await modules.db
      .delete(modules.organisations)
      .where(modules.inArray(modules.organisations.id, [ids.orgA, ids.orgB]));
    await modules.db
      .delete(modules.users)
      .where(
        modules.inArray(modules.users.id, [
          ids.admin,
          ids.clientUser,
          ids.outsider,
        ]),
      );
    await modules.sqlClient.end();
    await rm(root, { recursive: true, force: true });
    delete process.env.LOCAL_STORAGE_ROOT;
  });

  it("preserves, validates, previews, selectively applies, maps assets, and detects duplicates", async () => {
    const bytes = new TextEncoder().encode(
      `id,title,severity,host,description\nscan-1' OR 1=1 --,Imported issue,high,app.test,Scanner detail\nscan-2,Skipped issue,low,skip.test,Skip me`,
    );
    const preview = await modules.previewScannerImport(admin, {
      engagementId: ids.engagementA,
      adapter: "csv",
      filename: "scan.csv",
      mediaType: "text/csv",
      bytes,
    });
    importRunId = preview.run.id;
    expect(preview.run.summary).toMatchObject({
      total: 2,
      new: 2,
      duplicate: 0,
    });
    expect(preview.sourceEvidence).toMatchObject({
      classification: "internal",
      immutable: true,
    });
    const applied = await modules.applyScannerImport(admin, {
      importRunId,
      selectedItemIds: [preview.items[0]!.id],
    });
    expect(applied).toHaveLength(1);
    const [finding] = await modules.db
      .select()
      .from(modules.findings)
      .where(modules.eq(modules.findings.id, applied[0]!.findingId));
    expect(finding).toMatchObject({
      title: "Imported issue",
      severity: "high",
      sourceProvenance: { adapter: "csv", importRunId },
    });
    expect(finding?.sourceProvenance).toMatchObject({
      externalId: "scan-1' OR 1=1 --",
    });
    const duplicate = await modules.previewScannerImport(admin, {
      engagementId: ids.engagementA,
      adapter: "csv",
      filename: "scan-again.csv",
      mediaType: "text/csv",
      bytes,
    });
    expect(
      duplicate.items.find((item) => item.title === "Imported issue"),
    ).toMatchObject({
      action: "duplicate",
      selected: false,
    });
    await expect(
      modules.applyScannerImport(
        { organisationId: ids.orgB, userId: ids.outsider },
        { importRunId, selectedItemIds: [] },
      ),
    ).rejects.toBeInstanceOf(modules.ExchangeScopeError);
  });

  it("ingests scanner output as draft findings with a testing-journal note", async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        "template-id": "exposed-panel",
        info: {
          name: "Exposed admin panel",
          severity: "medium",
          description: "Admin console is reachable.",
        },
        host: "https://portal.test",
        port: "443",
      }),
    );
    const ingested = await modules.ingestScannerImport(admin, {
      engagementId: ids.engagementA,
      adapter: "nuclei",
      filename: "nuclei.json",
      bytes,
    });
    expect(ingested.publication).toBe("draft");
    expect(ingested.applied).toHaveLength(1);
    expect(ingested.note.kind).toBe("testing_journal");
    expect(ingested.note.visibility).toBe("team");
    expect(ingested.summary.note).toContain("remain draft");
    const [finding] = await modules.db
      .select()
      .from(modules.findings)
      .where(modules.eq(modules.findings.id, ingested.applied[0]!.findingId));
    expect(finding).toMatchObject({
      title: "Exposed admin panel",
      status: "draft",
      severity: "medium",
    });
  });

  it("exports required organisation domains and a migration-safe superset without storage locators", async () => {
    const data = await modules.exportOrganisation(admin, "data");
    expect(data.payload).toMatchObject({
      format: "dingodocs-organisation",
      mode: "data",
    });
    for (const key of [
      "engagements",
      "findings",
      "evidence",
      "assets",
      "scopeVersions",
      "scopeItems",
      "reports",
      "tasks",
      "auditEvents",
      "timeEntries",
    ])
      expect(data.payload).toHaveProperty(key);
    expect(data.json).not.toContain("storageKey");
    expect(data.checksum).toMatch(/^[0-9a-f]{64}$/);
    const migration = await modules.exportOrganisation(admin, "migration");
    expect(migration.payload).toHaveProperty("members");
    expect(migration.payload).toHaveProperty("findingTemplates");
    expect(migration.payload).toHaveProperty("notes");
  });

  it("uses PostgreSQL full-text search while enforcing publication and tenant restrictions", async () => {
    const internal = await modules.globalSearch(admin, "Needle");
    expect(internal.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "Shared Needle Assessment",
        "SHARED-1 · Shared Needle Finding",
        "DRAFT-1 · Secret Needle Draft",
        "Internal Needle Note",
      ]),
    );
    expect(internal.map((item) => item.title)).not.toContain(
      "Other Needle Finding",
    );
    const portal = await modules.globalSearch(client, "Needle");
    expect(portal.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        "Shared Needle Assessment",
        "SHARED-1 · Shared Needle Finding",
      ]),
    );
    expect(portal.map((item) => item.title)).not.toEqual(
      expect.arrayContaining([
        "DRAFT-1 · Secret Needle Draft",
        "Internal Needle Note",
        "Other Needle Finding",
      ]),
    );
    await expect(
      modules.globalSearch(client, `' OR 1=1; DROP TABLE findings; --`),
    ).resolves.toEqual([]);
  });
});

async function load() {
  const [{ db, sqlClient }, schema, exchange, search, drizzle] =
    await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("./data-exchange"),
      import("./global-search"),
      import("drizzle-orm"),
    ]);
  return { db, sqlClient, ...schema, ...exchange, ...search, ...drizzle };
}
