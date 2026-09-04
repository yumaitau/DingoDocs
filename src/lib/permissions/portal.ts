import "server-only";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  clientContacts,
  clients,
  engagementContacts,
  engagements,
} from "@/db/schema";

export type PortalActor = { organisationId: string; userId: string };

export class PortalNotFoundError extends Error {
  constructor() {
    super("The requested portal resource was not found");
    this.name = "PortalNotFoundError";
  }
}

export function portalEngagementQuery(
  actor: PortalActor,
  ...conditions: SQL[]
) {
  return db
    .select({
      id: engagements.id,
      organisationId: engagements.organisationId,
      clientId: engagements.clientId,
      name: engagements.name,
      reference: engagements.reference,
      type: engagements.type,
      status: engagements.status,
      startDate: engagements.startDate,
      endDate: engagements.endDate,
      objectives: engagements.objectives,
      securityClassification: engagements.securityClassification,
      clientName: clients.name,
      contactId: clientContacts.id,
      accessLevel: engagementContacts.accessLevel,
    })
    .from(clientContacts)
    .innerJoin(
      engagementContacts,
      and(
        eq(engagementContacts.contactId, clientContacts.id),
        eq(engagementContacts.organisationId, clientContacts.organisationId),
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
        ...conditions,
        eq(clientContacts.userId, actor.userId),
        eq(clientContacts.organisationId, actor.organisationId),
        isNull(clientContacts.deletedAt),
        isNull(clients.deletedAt),
        isNull(engagements.deletedAt),
        isNull(engagements.archivedAt),
      ),
    );
}

export function canWritePortal(accessLevel: string) {
  return accessLevel === "standard" || accessLevel === "administrator";
}

export async function requirePortalEngagement(
  actor: PortalActor,
  engagementId: string,
  write = false,
) {
  const [grant] = await portalEngagementQuery(
    actor,
    eq(engagements.id, engagementId),
  ).limit(1);
  if (!grant || (write && !canWritePortal(grant.accessLevel)))
    throw new PortalNotFoundError();
  return grant;
}
