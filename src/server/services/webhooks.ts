import "server-only";

import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  backgroundJobs,
  webhookDeliveries,
  webhooks,
} from "@/db/schema";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "@/lib/integrations/crypto";
import { redactSensitive } from "@/lib/observability/logger";

export type IntegrationActor = { organisationId: string; userId: string };

function assertWebhookUrl(value: string) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Webhook URL must use HTTP or HTTPS");
  if (process.env.NODE_ENV === "production") {
    if (url.protocol !== "https:")
      throw new Error("Webhook URL must use HTTPS");
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "::1" ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    )
      throw new Error("Webhook URL cannot target a private network");
  }
  return url.toString();
}

export function signWebhookPayload(
  secret: string,
  timestamp: number,
  body: string,
) {
  return `v1=${createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")}`;
}

export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: number;
  body: string;
  signature: string;
  now?: number;
  toleranceSeconds?: number;
}) {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - input.timestamp) > (input.toleranceSeconds ?? 5 * 60))
    return false;
  const expected = signWebhookPayload(
    input.secret,
    input.timestamp,
    input.body,
  );
  const actualBytes = Buffer.from(input.signature);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export async function createWebhook(
  actor: IntegrationActor,
  input: { name: string; url: string; events: string[] },
) {
  const secret = `whsec_${randomBytes(32).toString("base64url")}`;
  const [webhook] = await db
    .insert(webhooks)
    .values({
      organisationId: actor.organisationId,
      name: input.name.trim(),
      url: assertWebhookUrl(input.url),
      events: [...new Set(input.events)],
      secretEncrypted: encryptIntegrationSecret(secret),
      createdBy: actor.userId,
    })
    .returning({ id: webhooks.id });
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "webhook.created",
    targetType: "webhook",
    targetId: webhook.id,
    metadata: { events: input.events },
  });
  return { ...webhook, secret };
}

export async function rotateWebhookSecret(
  actor: IntegrationActor,
  webhookId: string,
) {
  const [current] = await db
    .select({ secret: webhooks.secretEncrypted })
    .from(webhooks)
    .where(
      and(
        eq(webhooks.id, webhookId),
        eq(webhooks.organisationId, actor.organisationId),
      ),
    )
    .limit(1);
  if (!current) throw new Error("Webhook was not found");
  const secret = `whsec_${randomBytes(32).toString("base64url")}`;
  await db
    .update(webhooks)
    .set({
      previousSecretEncrypted: current.secret,
      previousSecretExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      secretEncrypted: encryptIntegrationSecret(secret),
      secretVersion: sql`${webhooks.secretVersion} + 1`,
      rotatedAt: new Date(),
    })
    .where(eq(webhooks.id, webhookId));
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "webhook.secret_rotated",
    targetType: "webhook",
    targetId: webhookId,
  });
  return { id: webhookId, secret };
}

export async function enqueueWebhookEvent(
  organisationId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  const subscriptions = await db
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(
      and(
        eq(webhooks.organisationId, organisationId),
        eq(webhooks.enabled, true),
        or(
          sql`${eventType} = any(${webhooks.events})`,
          sql`'*' = any(${webhooks.events})`,
        ),
      ),
    );
  const eventId = randomUUID();
  const safePayload = redactSensitive(payload) as Record<string, unknown>;
  for (const subscription of subscriptions) {
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({
        organisationId,
        webhookId: subscription.id,
        eventId,
        eventType,
        payload: safePayload,
      })
      .returning({ id: webhookDeliveries.id });
    await db.insert(backgroundJobs).values({
      organisationId,
      type: "webhook.deliver",
      payload: { deliveryId: delivery.id },
      idempotencyKey: `webhook:${delivery.id}`,
      maxAttempts: 5,
    });
  }
  return { eventId, deliveries: subscriptions.length };
}

export async function deliverWebhookJob(deliveryId: string) {
  const [record] = await db
    .select({
      id: webhookDeliveries.id,
      organisationId: webhookDeliveries.organisationId,
      eventId: webhookDeliveries.eventId,
      eventType: webhookDeliveries.eventType,
      payload: webhookDeliveries.payload,
      attempts: webhookDeliveries.attempts,
      url: webhooks.url,
      enabled: webhooks.enabled,
      secretEncrypted: webhooks.secretEncrypted,
      previousSecretEncrypted: webhooks.previousSecretEncrypted,
      previousSecretExpiresAt: webhooks.previousSecretExpiresAt,
    })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);
  if (!record || !record.enabled) throw new Error("Webhook is unavailable");
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    id: record.eventId,
    type: record.eventType,
    createdAt: new Date(timestamp * 1000).toISOString(),
    data: record.payload,
  });
  const signatureHeaders: Record<string, string> = {
    "x-dingodocs-signature": signWebhookPayload(
      decryptIntegrationSecret(record.secretEncrypted),
      timestamp,
      body,
    ),
  };
  if (
    record.previousSecretEncrypted &&
    record.previousSecretExpiresAt &&
    record.previousSecretExpiresAt > new Date()
  )
    signatureHeaders["x-dingodocs-signature-previous"] = signWebhookPayload(
      decryptIntegrationSecret(record.previousSecretEncrypted),
      timestamp,
      body,
    );
  const response = await fetch(record.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "DingoDocs-Webhooks/1.0",
      "x-dingodocs-event-id": record.eventId,
      "x-dingodocs-timestamp": String(timestamp),
      ...signatureHeaders,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  const attempts = record.attempts + 1;
  await db
    .update(webhookDeliveries)
    .set({
      attempts,
      attemptedAt: new Date(),
      signatureTimestamp: new Date(timestamp * 1000),
      responseStatus: String(response.status),
      status: response.ok ? "delivered" : attempts >= 5 ? "failed" : "retrying",
      completedAt: response.ok ? new Date() : undefined,
      nextAttemptAt: response.ok
        ? undefined
        : new Date(Date.now() + Math.min(3600, 2 ** attempts * 15) * 1000),
      lastError: response.ok ? null : `HTTP ${response.status}`,
    })
    .where(eq(webhookDeliveries.id, deliveryId));
  if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`);
}

export async function listWebhookFailures(organisationId: string) {
  return db
    .select({
      id: webhookDeliveries.id,
      webhookId: webhookDeliveries.webhookId,
      eventType: webhookDeliveries.eventType,
      status: webhookDeliveries.status,
      attempts: webhookDeliveries.attempts,
      responseStatus: webhookDeliveries.responseStatus,
      lastError: webhookDeliveries.lastError,
      createdAt: webhookDeliveries.createdAt,
    })
    .from(webhookDeliveries)
    .where(
      and(
        eq(webhookDeliveries.organisationId, organisationId),
        or(
          eq(webhookDeliveries.status, "failed"),
          eq(webhookDeliveries.status, "retrying"),
        ),
        isNull(webhookDeliveries.completedAt),
      ),
    );
}
