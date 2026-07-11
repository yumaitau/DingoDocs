import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("secure evidence lifecycle with PostgreSQL and local storage", () => {
  const ids = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    actor: randomUUID(),
    namedViewer: randomUUID(),
    outsider: randomUUID(),
    clientA: randomUUID(),
    clientB: randomUUID(),
    engagementA: randomUUID(),
    engagementB: randomUUID(),
    assetA: randomUUID(),
    contactA: randomUUID(),
  };
  const actor = {
    organisationId: ids.orgA,
    userId: ids.actor,
    canViewRestricted: true,
  };
  let modules: Awaited<ReturnType<typeof load>>;
  let storageRoot: string;
  let provider: InstanceType<
    Awaited<ReturnType<typeof load>>["LocalStorageProvider"]
  >;
  let sourceId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    storageRoot = await mkdtemp(join(tmpdir(), "dingodocs-evidence-"));
    provider = new modules.LocalStorageProvider(storageRoot);
    await modules.db.insert(modules.users).values([
      {
        id: ids.actor,
        name: "Evidence Author",
        email: `${ids.actor}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.namedViewer,
        name: "Named Viewer",
        email: `${ids.namedViewer}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.outsider,
        name: "Other Tenant",
        email: `${ids.outsider}@test.invalid`,
        emailVerified: true,
      },
    ]);
    await modules.db.insert(modules.organisations).values([
      { id: ids.orgA, slug: `evidence-${ids.orgA}`, name: "Evidence Tenant" },
      {
        id: ids.orgB,
        slug: `evidence-${ids.orgB}`,
        name: "Other Evidence Tenant",
      },
    ]);
    await modules.db.insert(modules.clients).values([
      { id: ids.clientA, organisationId: ids.orgA, name: "Evidence Client A" },
      { id: ids.clientB, organisationId: ids.orgA, name: "Evidence Client B" },
    ]);
    await modules.db.insert(modules.engagements).values([
      {
        id: ids.engagementA,
        organisationId: ids.orgA,
        clientId: ids.clientA,
        name: "Evidence A",
        reference: `EVA-${ids.engagementA.slice(0, 8)}`,
        type: "Web",
      },
      {
        id: ids.engagementB,
        organisationId: ids.orgA,
        clientId: ids.clientB,
        name: "Evidence B",
        reference: `EVB-${ids.engagementB.slice(0, 8)}`,
        type: "Cloud",
      },
    ]);
    await modules.db.insert(modules.assets).values({
      id: ids.assetA,
      organisationId: ids.orgA,
      engagementId: ids.engagementA,
      name: "Portal",
      type: "application",
      identifier: "portal.evidence.test",
    });
    await modules.db.insert(modules.clientContacts).values({
      id: ids.contactA,
      organisationId: ids.orgA,
      clientId: ids.clientA,
      userId: ids.namedViewer,
      name: "Named Viewer",
      email: `${ids.namedViewer}@test.invalid`,
      contactType: "security",
    });
    await modules.db.insert(modules.engagementContacts).values({
      organisationId: ids.orgA,
      engagementId: ids.engagementA,
      contactId: ids.contactA,
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env.MALWARE_SCAN_URL;
    if (modules) {
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
            ids.actor,
            ids.namedViewer,
            ids.outsider,
          ]),
        );
      await modules.sqlClient.end();
    }
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  it("validates, hashes, classifies, restricts, retains, links, and detects duplicates", async () => {
    const bytes = pngBytes();
    const retentionUntil = new Date("2030-01-02T00:00:00.000Z");
    const source = await modules.uploadEvidence(
      actor,
      {
        engagementId: ids.engagementA,
        filename: "portal.capture.final.png",
        mediaType: "image/png",
        bytes,
        classification: "restricted",
        restrictionReason: "Contains authentication tokens",
        restrictedUserIds: [ids.namedViewer],
        retentionUntil,
        assetIds: [ids.assetA],
      },
      provider,
    );
    sourceId = source.id;
    expect(source).toMatchObject({
      mediaType: "image/png",
      classification: "restricted",
      version: 1,
      retentionUntil,
      restrictions: {
        reason: "Contains authentication tokens",
        userIds: [ids.namedViewer],
      },
    });
    expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await provider.exists(source.storageKey)).toBe(true);
    await modules.auditEvidenceDownload(actor, source);
    expect(
      await modules.db
        .select()
        .from(modules.auditEvents)
        .where(
          modules.and(
            modules.eq(modules.auditEvents.action, "evidence.downloaded"),
            modules.eq(modules.auditEvents.targetId, source.id),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await modules.db
        .select()
        .from(modules.assetEvidence)
        .where(modules.eq(modules.assetEvidence.evidenceId, source.id)),
    ).toHaveLength(1);
    await expect(
      modules.uploadEvidence(
        actor,
        {
          engagementId: ids.engagementA,
          filename: "copy.png",
          mediaType: "image/png",
          bytes,
          classification: "internal",
        },
        provider,
      ),
    ).rejects.toBeInstanceOf(modules.EvidenceDuplicateError);
    await expect(
      modules.uploadEvidence(
        actor,
        {
          engagementId: ids.engagementB,
          filename: "wrong-signature.png",
          mediaType: "image/png",
          bytes: new TextEncoder().encode("not png"),
          classification: "internal",
        },
        provider,
      ),
    ).rejects.toThrow("does not match");
  });

  it("enforces tenant, engagement, and named-user restrictions", async () => {
    await expect(
      modules.scopedEvidenceActor({
        organisationId: ids.orgA,
        userId: ids.namedViewer,
        roles: ["client_user"],
      }),
    ).resolves.toMatchObject({
      clientIds: [ids.clientA],
      engagementIds: [ids.engagementA],
      canViewRestricted: false,
    });
    await expect(
      modules.getEvidenceForAccess(
        { organisationId: ids.orgA, userId: ids.actor },
        sourceId,
      ),
    ).rejects.toBeInstanceOf(modules.EvidenceScopeError);
    await expect(
      modules.getEvidenceForAccess(
        {
          organisationId: ids.orgA,
          userId: randomUUID(),
          canViewRestricted: true,
        },
        sourceId,
      ),
    ).rejects.toBeInstanceOf(modules.EvidenceScopeError);
    await expect(
      modules.getEvidenceForAccess(
        {
          organisationId: ids.orgB,
          userId: ids.outsider,
          canViewRestricted: true,
        },
        sourceId,
      ),
    ).rejects.toBeInstanceOf(modules.EvidenceScopeError);
    await expect(
      modules.getEvidenceForAccess(
        {
          organisationId: ids.orgA,
          userId: ids.namedViewer,
          canViewRestricted: true,
        },
        sourceId,
      ),
    ).resolves.toMatchObject({ id: sourceId });
    await expect(
      modules.getEvidenceForAccess(
        {
          organisationId: ids.orgA,
          userId: ids.namedViewer,
          canViewRestricted: true,
          clientIds: [ids.clientB],
        },
        sourceId,
      ),
    ).rejects.toThrow("another client");
    await expect(
      modules.getEvidenceForAccess(
        {
          organisationId: ids.orgA,
          userId: ids.namedViewer,
          canViewRestricted: true,
          clientIds: [ids.clientA],
          engagementIds: [ids.engagementB],
        },
        sourceId,
      ),
    ).rejects.toThrow("another engagement");
    await expect(
      modules.getEvidenceForAccess(
        {
          organisationId: ids.orgA,
          userId: ids.namedViewer,
          canViewRestricted: true,
          clientIds: [ids.clientA],
          engagementIds: [ids.engagementA],
        },
        sourceId,
      ),
    ).rejects.toThrow("not client visible");
    await expect(
      modules.uploadEvidence(
        { organisationId: ids.orgB, userId: ids.outsider },
        {
          engagementId: ids.engagementA,
          filename: "cross-client.png",
          mediaType: "image/png",
          bytes: pngBytes(),
          classification: "internal",
        },
        provider,
      ),
    ).rejects.toBeInstanceOf(modules.EvidenceScopeError);
    await expect(
      modules.createEvidenceAnnotation(
        actor,
        {
          evidenceId: sourceId,
          engagementId: ids.engagementB,
          operations: [{ type: "crop", left: 0, top: 0, width: 1, height: 1 }],
        },
        provider,
      ),
    ).rejects.toThrow("another engagement");
  });

  it("preserves the source while creating annotated evidence versions", async () => {
    const before = await modules.getEvidenceForAccess(actor, sourceId);
    const derived = await modules.createEvidenceAnnotation(
      actor,
      {
        evidenceId: sourceId,
        operations: [
          {
            type: "highlight",
            left: 0,
            top: 0,
            width: 1,
            height: 1,
            colour: "#ffff00",
          },
        ],
      },
      provider,
    );
    const after = await modules.getEvidenceForAccess(actor, sourceId);
    expect(after.sha256).toBe(before.sha256);
    expect(derived).toMatchObject({
      parentId: sourceId,
      version: 2,
      mediaType: "image/png",
    });
    expect(await provider.exists(before.storageKey)).toBe(true);
    expect(await provider.exists(derived.storageKey)).toBe(true);
    const annotations = await modules.db
      .select()
      .from(modules.evidenceAnnotations)
      .where(
        modules.eq(modules.evidenceAnnotations.outputEvidenceId, derived.id),
      );
    expect(annotations[0]).toMatchObject({ sourceEvidenceId: sourceId });
  });

  it("quarantines infected evidence through the scan hook", async () => {
    process.env.MALWARE_SCAN_URL = "https://scanner.test/scan";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            clean: false,
            engine: "fixture-av",
            signature: "EICAR-Test",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    await modules.scanEvidenceJob(sourceId, provider);
    const [row] = await modules.db
      .select()
      .from(modules.evidence)
      .where(modules.eq(modules.evidence.id, sourceId));
    expect(row).toMatchObject({ malwareScanStatus: "infected" });
    expect(row?.quarantinedAt).toBeInstanceOf(Date);
    await expect(modules.getEvidenceForAccess(actor, sourceId)).rejects.toThrow(
      "quarantined",
    );
    const quarantineAudit = await modules.db
      .select()
      .from(modules.auditEvents)
      .where(
        modules.and(
          modules.eq(modules.auditEvents.action, "evidence.quarantined"),
          modules.eq(modules.auditEvents.targetId, sourceId),
        ),
      );
    expect(quarantineAudit).toHaveLength(1);
  });
});

function pngBytes() {
  return new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  );
}

async function load() {
  const [{ db, sqlClient }, schema, service, storage, drizzle] =
    await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("./evidence"),
      import("@/lib/storage/local"),
      import("drizzle-orm"),
    ]);
  return { db, sqlClient, ...schema, ...service, ...storage, ...drizzle };
}
