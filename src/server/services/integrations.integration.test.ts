import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("integration automation with PostgreSQL", () => {
  const ids = {
    organisation: randomUUID(),
    otherOrganisation: randomUUID(),
    actor: randomUUID(),
  };
  let modules: Awaited<ReturnType<typeof load>>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    process.env.INTEGRATION_ENCRYPTION_KEY = "integration-test-key";
    modules = await load();
    await modules.db.insert(modules.users).values({
      id: ids.actor,
      name: "Integration Admin",
      email: `${ids.actor}@test.invalid`,
      emailVerified: true,
    });
    await modules.db.insert(modules.organisations).values([
      {
        id: ids.organisation,
        slug: `integrations-${ids.organisation}`,
        name: "Integration Tenant",
      },
      {
        id: ids.otherOrganisation,
        slug: `integrations-${ids.otherOrganisation}`,
        name: "Other Integration Tenant",
      },
    ]);
    await modules.db.insert(modules.organisationMembers).values({
      organisationId: ids.organisation,
      userId: ids.actor,
      role: "organisation_owner",
      joinedAt: new Date(),
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    delete process.env.AI_ENABLED;
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    if (!modules) return;
    await modules.db
      .delete(modules.auditEvents)
      .where(
        modules.inArray(modules.auditEvents.organisationId, [
          ids.organisation,
          ids.otherOrganisation,
        ]),
      );
    await modules.db
      .delete(modules.organisations)
      .where(
        modules.inArray(modules.organisations.id, [
          ids.organisation,
          ids.otherOrganisation,
        ]),
      );
    await modules.db
      .delete(modules.users)
      .where(modules.eq(modules.users.id, ids.actor));
    await modules.sqlClient.end();
  });

  it("shows API credentials once, hashes them, scopes them, and revalidates membership", async () => {
    const actor = {
      organisationId: ids.organisation,
      userId: ids.actor,
    };
    const personal = await modules.createApiCredential(actor, {
      name: "Automation PAT",
      kind: "personal",
      scopes: ["engagements:read"],
    });
    expect(personal.plaintext).toMatch(/^dd_pat_/);
    const [stored] = await modules.db
      .select()
      .from(modules.apiKeys)
      .where(modules.eq(modules.apiKeys.id, personal.id));
    expect(stored.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(personal.plaintext);

    await expect(
      modules.authenticateApiRequest(
        requestWithToken(personal.plaintext),
        "engagements:read",
      ),
    ).resolves.toMatchObject({
      organisationId: ids.organisation,
      userId: ids.actor,
    });
    await expect(
      modules.authenticateApiRequest(
        requestWithToken(personal.plaintext),
        "reports:read",
      ),
    ).rejects.toMatchObject({ status: 403, code: "insufficient_scope" });

    const service = await modules.createApiCredential(actor, {
      name: "CI service credential",
      kind: "service",
      serviceAccountName: "CI publisher",
      scopes: ["reports:read"],
    });
    expect(service.plaintext).toMatch(/^dd_svc_/);
    await expect(
      modules.authenticateApiRequest(
        requestWithToken(service.plaintext),
        "reports:read",
      ),
    ).resolves.toMatchObject({ organisationId: ids.organisation });

    await modules.revokeApiCredential(actor, personal.id);
    await expect(
      modules.authenticateApiRequest(
        requestWithToken(personal.plaintext),
        "engagements:read",
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("rechecks personal write permissions after demotion while preserving service scopes", async () => {
    const actor = { organisationId: ids.organisation, userId: ids.actor };
    const personal = await modules.createApiCredential(actor, {
      name: "Demotion test",
      kind: "personal",
      scopes: ["findings:write"],
    });
    const service = await modules.createApiCredential(actor, {
      name: "Independent service",
      kind: "service",
      serviceAccountName: "Test service",
      scopes: ["findings:write"],
    });
    await modules.db
      .update(modules.organisationMembers)
      .set({ role: "read_only" })
      .where(modules.eq(modules.organisationMembers.userId, ids.actor));
    try {
      await expect(
        modules.apiWriteContext(
          requestWithToken(personal.plaintext),
          "findings:write",
          "finding:create",
        ),
      ).rejects.toThrow("Permission denied");
      await expect(
        modules.apiWriteContext(
          requestWithToken(service.plaintext),
          "findings:write",
          "finding:create",
        ),
      ).resolves.toMatchObject({ serviceAccountId: expect.any(String) });
    } finally {
      await modules.db
        .update(modules.organisationMembers)
        .set({ role: "organisation_owner" })
        .where(modules.eq(modules.organisationMembers.userId, ids.actor));
    }
  });

  it("signs timestamped webhooks, redacts payloads, logs delivery, and rotates secrets", async () => {
    const actor = {
      organisationId: ids.organisation,
      userId: ids.actor,
    };
    const webhook = await modules.createWebhook(actor, {
      name: "Delivery hook",
      url: "https://hooks.example.test/dingodocs",
      events: ["finding.published"],
    });
    const [stored] = await modules.db
      .select()
      .from(modules.webhooks)
      .where(modules.eq(modules.webhooks.id, webhook.id));
    expect(stored.secretEncrypted).not.toContain(webhook.secret);
    expect(modules.decryptIntegrationSecret(stored.secretEncrypted)).toBe(
      webhook.secret,
    );

    let deliveredBody = "";
    let signature = "";
    let previousSignature = "";
    let timestamp = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        deliveredBody = String(init?.body);
        const headers = new Headers(init?.headers);
        signature = headers.get("x-dingodocs-signature") ?? "";
        previousSignature = headers.get("x-dingodocs-signature-previous") ?? "";
        timestamp = Number(headers.get("x-dingodocs-timestamp"));
        return new Response(null, { status: 204 });
      }),
    );
    const queued = await modules.enqueueWebhookEvent(
      ids.organisation,
      "finding.published",
      { findingId: randomUUID(), password: "must-not-leak" },
    );
    expect(queued.deliveries).toBe(1);
    const [delivery] = await modules.db
      .select()
      .from(modules.webhookDeliveries)
      .where(modules.eq(modules.webhookDeliveries.eventId, queued.eventId));
    await modules.deliverWebhookJob(delivery.id);
    expect(deliveredBody).toContain('"password":"[REDACTED]"');
    expect(deliveredBody).not.toContain("must-not-leak");
    expect(
      modules.verifyWebhookSignature({
        secret: webhook.secret,
        timestamp,
        body: deliveredBody,
        signature,
        now: timestamp,
      }),
    ).toBe(true);
    expect(
      modules.verifyWebhookSignature({
        secret: webhook.secret,
        timestamp,
        body: `${deliveredBody}tampered`,
        signature,
        now: timestamp,
      }),
    ).toBe(false);
    expect(
      modules.verifyWebhookSignature({
        secret: webhook.secret,
        timestamp,
        body: deliveredBody,
        signature,
        now: timestamp + 301,
      }),
    ).toBe(false);

    const rotated = await modules.rotateWebhookSecret(actor, webhook.id);
    expect(rotated.secret).not.toBe(webhook.secret);
    const [updated] = await modules.db
      .select()
      .from(modules.webhooks)
      .where(modules.eq(modules.webhooks.id, webhook.id));
    expect(updated.secretVersion).toBe(2);
    expect(updated.previousSecretExpiresAt!.getTime()).toBeGreaterThan(
      Date.now(),
    );
    const queuedAfterRotation = await modules.enqueueWebhookEvent(
      ids.organisation,
      "finding.published",
      { findingId: randomUUID() },
    );
    const [deliveryAfterRotation] = await modules.db
      .select()
      .from(modules.webhookDeliveries)
      .where(
        modules.eq(
          modules.webhookDeliveries.eventId,
          queuedAfterRotation.eventId,
        ),
      );
    await modules.deliverWebhookJob(deliveryAfterRotation.id);
    expect(previousSignature).toMatch(/^v1=/);
    expect(
      modules.verifyWebhookSignature({
        secret: webhook.secret,
        timestamp,
        body: deliveredBody,
        signature: previousSignature,
        now: timestamp,
      }),
    ).toBe(true);
  });

  it("keeps notification content minimal and queues provider delivery", async () => {
    const channel = await modules.createNotificationChannel(
      { organisationId: ids.organisation, userId: ids.actor },
      {
        name: "Generic delivery",
        provider: "webhook",
        configuration: { url: "https://notify.example.test/hook" },
      },
    );
    const unsafeNotification = {
      eventType: "finding.published",
      title: "A report is ready",
      actionUrl: "/reports/example",
      body: "sensitive finding detail",
    } as unknown as Parameters<typeof modules.queueNotification>[2];
    await expect(
      modules.queueNotification(
        ids.organisation,
        channel.id,
        unsafeNotification,
      ),
    ).rejects.toThrow();

    let body = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        body = String(init?.body);
        return new Response(null, { status: 202 });
      }),
    );
    const delivery = await modules.queueNotification(
      ids.organisation,
      channel.id,
      {
        eventType: "report.published",
        title: "A report is ready",
        actionUrl: "/reports/example",
      },
    );
    await modules.deliverNotificationJob(delivery.id);
    expect(body).toContain("A report is ready");
    expect(body).not.toContain("finding detail");
    const [storedChannel] = await modules.db
      .select()
      .from(modules.notificationChannels)
      .where(modules.eq(modules.notificationChannels.id, channel.id));
    expect(storedChannel.configurationEncrypted).not.toContain(
      "notify.example.test",
    );
  });

  it("requires deployment, organisation, and per-request AI opt-in and records untrusted drafts", async () => {
    const actor = {
      organisationId: ids.organisation,
      userId: ids.actor,
    };
    await modules.configureAiProvider(actor, {
      provider: "openai",
      model: "test-model",
      apiKey: "test-api-key",
      enabled: true,
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer test-api-key",
      );
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.store).toBe(false);
      return Response.json({
        output_text: "Review this untrusted suggestion.",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      purpose: "remediation wording",
      prompt: "Rewrite this remediation guidance for clarity.",
      confirmation: modules.aiConfirmation,
    };
    process.env.AI_ENABLED = "false";
    await expect(modules.requestAiDraft(actor, input)).rejects.toThrow(
      "deployment level",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    process.env.AI_ENABLED = "true";
    await expect(
      modules.requestAiDraft(actor, { ...input, confirmation: "yes" }),
    ).rejects.toThrow("confirmation");
    const result = await modules.requestAiDraft(actor, input);
    expect(result).toEqual({
      id: expect.any(String),
      draft: "Review this untrusted suggestion.",
      trusted: false,
    });
    const [run] = await modules.db
      .select()
      .from(modules.aiAssistRuns)
      .where(modules.eq(modules.aiAssistRuns.id, result.id));
    expect(run.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.inputHash).not.toContain(input.prompt);
    expect(run.status).toBe("untrusted_draft");
  });
});

function requestWithToken(token: string) {
  return new Request("http://localhost/api/v1/engagements", {
    headers: { authorization: `Bearer ${token}` },
  });
}

async function load() {
  const schema = await import("@/db/schema");
  const database = await import("@/db");
  const drizzle = await import("drizzle-orm");
  const authentication = await import("@/lib/api/authentication");
  const crypto = await import("@/lib/integrations/crypto");
  const webhooks = await import("./webhooks");
  const notifications = await import("./notifications");
  const ai = await import("./ai");
  return {
    ...schema,
    ...database,
    ...drizzle,
    ...authentication,
    ...crypto,
    ...webhooks,
    ...notifications,
    ...ai,
  };
}
