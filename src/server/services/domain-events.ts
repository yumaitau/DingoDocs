import "server-only";

import { and, asc, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import { db } from "@/db";
import {
  notificationChannels,
  notifications,
  organisationMembers,
} from "@/db/schema";
import { structuredLog } from "@/lib/observability/logger";
import { isSafeInternalPath } from "@/lib/security/internal-path";
import { queueNotification } from "./notifications";
import { enqueueWebhookEvent } from "./webhooks";

const eventTypePattern = /^[a-z0-9_.-]{2,80}$/;
const recipientCap = 50;
const excludedRoles = ["client_user", "client_administrator"] as const;
const clientRoles = ["client_user", "client_administrator"] as const;

/** Event types that also notify client portal members (in addition to internal). */
export const CLIENT_VISIBLE_EVENT_TYPES = [
  "report.published",
  "retest.completed",
  "comment.replied",
] as const;

export type DomainEventAudience = "internal" | "client" | "all";

type DomainEventInput = {
  organisationId: string;
  actorUserId?: string;
  eventType: string;
  title: string;
  actionUrl?: string;
  payload?: Record<string, unknown>;
  /** Default internal. "client" = client roles only; "all" = internal + client. */
  audience?: DomainEventAudience;
  /** When true, also notify client_user / client_administrator (cap 50, exclude actor). */
  clientSafe?: boolean;
};

type DeliveryMessage = {
  eventType: string;
  title: string;
  actionUrl?: string;
};

export function isClientVisibleEventType(eventType: string) {
  return (CLIENT_VISIBLE_EVENT_TYPES as readonly string[]).includes(eventType);
}

/** Mark an event for internal + client inbox delivery. */
export function withClientAudience<T extends DomainEventInput>(
  input: T,
): T & { audience: "all"; clientSafe: true } {
  return { ...input, audience: "all", clientSafe: true };
}

export async function emitDomainEvent(input: DomainEventInput): Promise<void> {
  try {
    const eventType = input.eventType.trim();
    const title = input.title.trim().slice(0, 160);
    if (!eventTypePattern.test(eventType) || title.length < 2) {
      structuredLog("error", "domain_event.invalid", {
        organisationId: input.organisationId,
        eventType,
      });
      return;
    }
    const actionUrl =
      input.actionUrl && isSafeInternalPath(input.actionUrl)
        ? input.actionUrl
        : undefined;
    if (input.actionUrl && !actionUrl) {
      structuredLog("warn", "domain_event.action_url_dropped", {
        organisationId: input.organisationId,
        eventType,
      });
    }
    const message = { eventType, title, actionUrl };
    const audience = resolveAudience(input, eventType);
    await guard(input.organisationId, eventType, "domain_event.inbox_failed", () =>
      insertInbox(input.organisationId, input.actorUserId, message, audience),
    );
    await guard(
      input.organisationId,
      eventType,
      "domain_event.webhook_failed",
      async () => {
        await enqueueWebhookEvent(
          input.organisationId,
          eventType,
          input.payload ?? { title },
        );
      },
    );
    await guard(
      input.organisationId,
      eventType,
      "domain_event.channels_failed",
      () => queueChannels(input.organisationId, message),
    );
  } catch (error) {
    structuredLog("error", "domain_event.failed", {
      organisationId: input.organisationId,
      eventType: input.eventType,
      error: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

function resolveAudience(
  input: DomainEventInput,
  eventType: string,
): { internal: boolean; client: boolean } {
  const audience = input.audience ?? "internal";
  const autoClient =
    input.clientSafe === true || isClientVisibleEventType(eventType);
  if (audience === "client") return { internal: false, client: true };
  if (audience === "all") return { internal: true, client: true };
  return { internal: true, client: autoClient };
}

function guard(
  organisationId: string,
  eventType: string,
  event: string,
  work: () => Promise<unknown>,
) {
  return work().catch((error: unknown) => {
    structuredLog("error", event, {
      organisationId,
      eventType,
      error: error instanceof Error ? error.name : "UnknownError",
    });
  });
}

async function insertInbox(
  organisationId: string,
  actorUserId: string | undefined,
  message: DeliveryMessage,
  audience: { internal: boolean; client: boolean },
) {
  if (!audience.internal && !audience.client) return;
  const roleFilter =
    audience.internal && audience.client
      ? undefined
      : audience.client
        ? inArray(organisationMembers.role, [...clientRoles])
        : notInArray(organisationMembers.role, [...excludedRoles]);
  const members = await db
    .select({ userId: organisationMembers.userId })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.organisationId, organisationId),
        isNull(organisationMembers.deletedAt),
        roleFilter,
        actorUserId ? ne(organisationMembers.userId, actorUserId) : undefined,
      ),
    )
    .orderBy(asc(organisationMembers.createdAt))
    .limit(recipientCap);
  if (!members.length) return;
  await db.insert(notifications).values(
    members.map((member) => ({
      organisationId,
      userId: member.userId,
      eventType: message.eventType,
      title: message.title,
      actionUrl: message.actionUrl,
    })),
  );
}

async function queueChannels(organisationId: string, message: DeliveryMessage) {
  const channels = await db
    .select({
      id: notificationChannels.id,
      provider: notificationChannels.provider,
    })
    .from(notificationChannels)
    .where(
      and(
        eq(notificationChannels.organisationId, organisationId),
        eq(notificationChannels.enabled, true),
      ),
    )
    .orderBy(asc(notificationChannels.createdAt))
    .limit(recipientCap);
  for (const channel of channels) {
    if (channel.provider === "in_app") continue;
    if (!canQueueWithoutExtraConfig(channel.provider)) continue;
    try {
      await queueNotification(organisationId, channel.id, {
        eventType: message.eventType,
        title: message.title,
        ...(message.actionUrl ? { actionUrl: message.actionUrl } : {}),
      });
    } catch (error) {
      structuredLog("error", "domain_event.channel_skipped", {
        organisationId,
        eventType: message.eventType,
        channelId: channel.id,
        error: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}

function canQueueWithoutExtraConfig(provider: string) {
  return (
    provider === "smtp" ||
    provider === "teams" ||
    provider === "slack" ||
    provider === "discord" ||
    provider === "webhook"
  );
}
