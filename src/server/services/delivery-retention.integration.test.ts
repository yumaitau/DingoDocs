import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteAuditEventsForOrganisations } from "@/server/testing/delete-audit-events";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("webhook network failures and retention purge ordering", () => {
  const ids = {
    organisation: randomUUID(),
    actor: randomUUID(),
    client: randomUUID(),
    engagement: randomUUID(),
    evidence: randomUUID(),
  };
  const actor = { organisationId: ids.organisation, userId: ids.actor };
  let modules: Awaited<ReturnType<typeof load>>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    process.env.INTEGRATION_ENCRYPTION_KEY = "integration-test-key";
    modules = await load();
    await modules.db.insert(modules.users).values({
      id: ids.actor,
      name: "Delivery Admin",
      email: `${ids.actor}@test.invalid`,
      emailVerified: true,
    });
    await modules.db.insert(modules.organisations).values({
      id: ids.organisation,
      slug: `delivery-${ids.organisation}`,
      name: "Delivery Tenant",
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
      name: "Retention Ordering",
      reference: `ORD-${ids.engagement.slice(0, 8)}`,
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
      sha256: "b".repeat(64),
      retentionUntil: new Date(Date.now() - 60_000),
      uploadedBy: ids.actor,
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    if (!modules) return;
    await deleteAuditEventsForOrganisations(modules.sqlClient, [
      ids.organisation,
    ]);
    await modules.db
      .delete(modules.organisations)
      .where(modules.eq(modules.organisations.id, ids.organisation));
    await modules.db
      .delete(modules.users)
      .where(modules.eq(modules.users.id, ids.actor));
    await modules.sqlClient.end();
  });

  it("records a webhook attempt when fetch throws", async () => {
    await modules.createWebhook(actor, {
      name: "Unreachable hook",
      url: "https://8.8.8.8/dingodocs",
      events: ["finding.published"],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const queued = await modules.enqueueWebhookEvent(
      ids.organisation,
      "finding.published",
      { findingId: randomUUID() },
    );
    const [delivery] = await modules.db
      .select()
      .from(modules.webhookDeliveries)
      .where(modules.eq(modules.webhookDeliveries.eventId, queued.eventId));
    await expect(modules.deliverWebhookJob(delivery!.id)).rejects.toThrow(
      "fetch failed",
    );
    const [after] = await modules.db
      .select()
      .from(modules.webhookDeliveries)
      .where(modules.eq(modules.webhookDeliveries.id, delivery!.id));
    expect(after).toMatchObject({
      attempts: 1,
      status: "retrying",
      responseStatus: null,
    });
    expect(after?.lastError).toContain("fetch failed");
    expect(after?.nextAttemptAt).toBeInstanceOf(Date);
  });

  it("deletes the storage object only after the destroy transaction commits", async () => {
    const statusAtDelete: string[] = [];
    const provider = {
      name: "test",
      put: async () => {
        throw new Error("not used");
      },
      get: async () => new ReadableStream<Uint8Array>(),
      delete: async () => {
        // Read on a separate connection: only committed state is visible.
        const [row] = await modules.sqlClient<{ status: string }[]>`
          select retention_status as status from evidence where id = ${ids.evidence}
        `;
        statusAtDelete.push(row!.status);
        throw new Error("storage unavailable");
      },
      exists: async () => true,
      healthCheck: async () => undefined,
    };
    await expect(
      modules.purgeExpiredEvidence(ids.organisation, {
        provider,
        scheduled: true,
      }),
    ).resolves.toEqual({ eligible: 1, destroyed: 1 });
    expect(statusAtDelete).toEqual(["destroyed"]);
  });
});

async function load() {
  const [{ db, sqlClient }, schema, webhooks, retention, drizzle] =
    await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("./webhooks"),
      import("./retention"),
      import("drizzle-orm"),
    ]);
  return { db, sqlClient, ...schema, ...webhooks, ...retention, ...drizzle };
}
