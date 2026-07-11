import "server-only";

import { and, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { z } from "zod";
import { db } from "@/db";
import {
  auditEvents,
  backgroundJobs,
  notificationChannels,
  notificationDeliveries,
  notifications,
} from "@/db/schema";
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
} from "@/lib/integrations/crypto";
import { notificationProviders } from "@/lib/integrations/constants";

export { notificationProviders } from "@/lib/integrations/constants";

const deliverySchema = z
  .object({
    eventType: z.string().regex(/^[a-z0-9_.-]{2,80}$/),
    recipient: z.string().trim().max(320).optional(),
    title: z.string().trim().min(2).max(160),
    actionUrl: z
      .string()
      .max(500)
      .refine((value) => value.startsWith("/"), "Action URL must be relative")
      .optional(),
  })
  .strict();

type ChannelConfiguration = {
  url?: string;
  to?: string;
  userId?: string;
};

export async function createNotificationChannel(
  actor: { organisationId: string; userId: string },
  input: {
    name: string;
    provider: (typeof notificationProviders)[number];
    configuration: ChannelConfiguration;
  },
) {
  validateConfiguration(input.provider, input.configuration);
  const [channel] = await db
    .insert(notificationChannels)
    .values({
      organisationId: actor.organisationId,
      name: input.name.trim(),
      provider: input.provider,
      configurationEncrypted: encryptIntegrationSecret(
        JSON.stringify(input.configuration),
      ),
      createdBy: actor.userId,
    })
    .returning({ id: notificationChannels.id });
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "notification_channel.created",
    targetType: "notification_channel",
    targetId: channel.id,
    metadata: { provider: input.provider },
  });
  return channel;
}

function validateConfiguration(
  provider: (typeof notificationProviders)[number],
  configuration: ChannelConfiguration,
) {
  if (provider === "in_app") z.string().uuid().parse(configuration.userId);
  else if (provider === "smtp") z.string().email().parse(configuration.to);
  else {
    const url = new URL(z.string().url().parse(configuration.url));
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:")
      throw new Error("Notification webhook must use HTTPS");
  }
}

export async function queueNotification(
  organisationId: string,
  channelId: string,
  input: z.input<typeof deliverySchema>,
) {
  const message = deliverySchema.parse(input);
  const [channel] = await db
    .select({ id: notificationChannels.id })
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.id, channelId),
        eq(notificationChannels.organisationId, organisationId),
        eq(notificationChannels.enabled, true),
      ),
    )
    .limit(1);
  if (!channel) throw new Error("Notification channel is unavailable");
  const [delivery] = await db
    .insert(notificationDeliveries)
    .values({
      organisationId,
      channelId,
      ...message,
    })
    .returning({ id: notificationDeliveries.id });
  await db.insert(backgroundJobs).values({
    organisationId,
    type: "notification.deliver",
    payload: { deliveryId: delivery.id },
    idempotencyKey: `notification:${delivery.id}`,
    maxAttempts: 5,
  });
  return delivery;
}

export async function deliverNotificationJob(deliveryId: string) {
  const [delivery] = await db
    .select({
      id: notificationDeliveries.id,
      organisationId: notificationDeliveries.organisationId,
      eventType: notificationDeliveries.eventType,
      recipient: notificationDeliveries.recipient,
      title: notificationDeliveries.title,
      actionUrl: notificationDeliveries.actionUrl,
      attempts: notificationDeliveries.attempts,
      provider: notificationChannels.provider,
      configurationEncrypted: notificationChannels.configurationEncrypted,
      enabled: notificationChannels.enabled,
    })
    .from(notificationDeliveries)
    .innerJoin(
      notificationChannels,
      eq(notificationChannels.id, notificationDeliveries.channelId),
    )
    .where(eq(notificationDeliveries.id, deliveryId))
    .limit(1);
  if (!delivery || !delivery.enabled)
    throw new Error("Notification delivery is unavailable");
  const configuration = JSON.parse(
    decryptIntegrationSecret(delivery.configurationEncrypted),
  ) as ChannelConfiguration;
  try {
    await providerSend(delivery.provider, configuration, {
      eventType: delivery.eventType,
      title: delivery.title,
      actionUrl: delivery.actionUrl ?? undefined,
      recipient: delivery.recipient ?? undefined,
      organisationId: delivery.organisationId,
    });
    await db
      .update(notificationDeliveries)
      .set({
        status: "delivered",
        attempts: delivery.attempts + 1,
        deliveredAt: new Date(),
        lastError: null,
      })
      .where(eq(notificationDeliveries.id, deliveryId));
  } catch (error) {
    await db
      .update(notificationDeliveries)
      .set({
        status: delivery.attempts + 1 >= 5 ? "failed" : "retrying",
        attempts: delivery.attempts + 1,
        lastError: error instanceof Error ? error.name : "UnknownError",
      })
      .where(eq(notificationDeliveries.id, deliveryId));
    throw error;
  }
}

async function providerSend(
  provider: string,
  configuration: ChannelConfiguration,
  message: {
    eventType: string;
    title: string;
    actionUrl?: string;
    recipient?: string;
    organisationId: string;
  },
) {
  if (provider === "in_app") {
    await db.insert(notifications).values({
      organisationId: message.organisationId,
      userId: configuration.userId,
      eventType: message.eventType,
      title: message.title,
      actionUrl: message.actionUrl,
    });
    return;
  }
  if (provider === "smtp") {
    if (!process.env.SMTP_HOST) throw new Error("SMTP is not configured");
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASSWORD
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
          : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? "DingoDocs <noreply@localhost>",
      to: message.recipient ?? configuration.to,
      subject: message.title,
      text: `${message.title}${message.actionUrl ? `\n\nOpen DingoDocs: ${message.actionUrl}` : ""}\n\nSensitive finding and evidence content is intentionally omitted.`,
    });
    return;
  }
  const text = `${message.title}${message.actionUrl ? `\n${message.actionUrl}` : ""}`;
  const body =
    provider === "discord"
      ? { content: text }
      : provider === "teams"
        ? { type: "message", text }
        : provider === "slack"
          ? { text }
          : {
              type: message.eventType,
              title: message.title,
              actionUrl: message.actionUrl,
            };
  const response = await fetch(configuration.url!, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`Notification provider returned HTTP ${response.status}`);
}
