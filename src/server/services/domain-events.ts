import "server-only";

import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import {
  clientContacts,
  clients,
  engagementContacts,
  engagementMembers,
  engagements,
  notificationChannels,
  notifications,
  organisationMembers,
} from "@/db/schema";
import { organisationWideRoles } from "@/lib/permissions/matrix";
import { structuredLog } from "@/lib/observability/logger";
import { isSafeInternalPath } from "@/lib/security/internal-path";
import { queueNotification } from "./notifications";
import { enqueueWebhookEvent } from "./webhooks";

const eventTypePattern = /^[a-z0-9_.-]{2,80}$/;
const recipientCap = 50;
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
  /**
   * Engagement the event belongs to. Scopes the inbox audience: internal
   * recipients are engagement members plus organisation-wide roles; client
   * recipients must hold a portal grant for it. Without it no client is notified.
   */
  engagementId?: string | null;
  payload?: Record<string, unknown>;
  /** Default internal. "client" = client roles only; "all" = internal + client. */
  audience?: DomainEventAudience;
  /**
   * When true, also notify portal grant holders (cap 50, exclude actor).
   * Explicit false suppresses the client audience for client-visible event types.
   */
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
    await guard(
      input.organisationId,
      eventType,
      "domain_event.inbox_failed",
      () =>
        insertInbox(
          input.organisationId,
          input.actorUserId,
          input.engagementId ?? undefined,
          message,
          audience,
        ),
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
  // Clients only ever hear about engagements they hold a portal grant for.
  const engagementScoped = Boolean(input.engagementId);
  const autoClient = input.clientSafe ?? isClientVisibleEventType(eventType);
  if (audience === "client")
    return { internal: false, client: engagementScoped };
  if (audience === "all") return { internal: true, client: engagementScoped };
  return { internal: true, client: autoClient && engagementScoped };
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
  engagementId: string | undefined,
  message: DeliveryMessage,
  audience: { internal: boolean; client: boolean },
) {
  const audienceFilter = or(
    audience.internal
      ? internalAudience(organisationId, engagementId)
      : undefined,
    audience.client && engagementId
      ? clientAudience(organisationId, engagementId)
      : undefined,
  );
  if (!audienceFilter) return;
  const members = await db
    .select({ userId: organisationMembers.userId })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.organisationId, organisationId),
        isNull(organisationMembers.deletedAt),
        audienceFilter,
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

/**
 * Internal staff who can see the engagement: organisation-wide roles plus
 * engagement members (mirrors engagementVisibility). Without an engagement,
 * all internal staff.
 */
function internalAudience(
  organisationId: string,
  engagementId: string | undefined,
): SQL | undefined {
  const internal = notInArray(organisationMembers.role, [...clientRoles]);
  if (!engagementId) return internal;
  return and(
    internal,
    or(
      inArray(organisationMembers.role, [...organisationWideRoles]),
      exists(
        db
          .select({ id: engagementMembers.id })
          .from(engagementMembers)
          .where(
            and(
              eq(engagementMembers.organisationId, organisationId),
              eq(engagementMembers.engagementId, engagementId),
              eq(engagementMembers.userId, organisationMembers.userId),
              isNull(engagementMembers.deletedAt),
            ),
          ),
      ),
    ),
  );
}

/** Client users holding a portal grant for the engagement (mirrors portalEngagementQuery). */
function clientAudience(organisationId: string, engagementId: string) {
  return and(
    inArray(organisationMembers.role, [...clientRoles]),
    exists(
      db
        .select({ id: engagementContacts.id })
        .from(clientContacts)
        .innerJoin(
          engagementContacts,
          and(
            eq(engagementContacts.contactId, clientContacts.id),
            eq(
              engagementContacts.organisationId,
              clientContacts.organisationId,
            ),
          ),
        )
        .innerJoin(
          engagements,
          and(
            eq(engagements.id, engagementContacts.engagementId),
            eq(engagements.organisationId, engagementContacts.organisationId),
            eq(engagements.clientId, clientContacts.clientId),
          ),
        )
        .innerJoin(
          clients,
          and(
            eq(clients.id, clientContacts.clientId),
            eq(clients.organisationId, clientContacts.organisationId),
          ),
        )
        .where(
          and(
            eq(clientContacts.organisationId, organisationId),
            eq(clientContacts.userId, organisationMembers.userId),
            eq(engagementContacts.engagementId, engagementId),
            isNull(clientContacts.deletedAt),
            isNull(clients.deletedAt),
            isNull(engagements.deletedAt),
            isNull(engagements.archivedAt),
          ),
        ),
    ),
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
