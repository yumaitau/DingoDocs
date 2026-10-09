import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { clients, engagements } from "@/db/schema";
import {
  clientVisibility,
  engagementVisibility,
  type AccessActor,
} from "@/lib/permissions/access";
import { refreshEngagementHealth } from "@/server/services/engagement-health";

export type TenantScope = Readonly<{ organisationId: string }>;
export type EngagementAccessScope = TenantScope &
  Pick<AccessActor, "userId" | "role" | "serviceAccountId">;

export function tenantWhere(
  scope: TenantScope,
  organisationColumn: AnyPgColumn,
  ...conditions: Array<SQL | undefined>
) {
  return and(eq(organisationColumn, scope.organisationId), ...conditions);
}

export async function listClients(scope: TenantScope & Partial<AccessActor>) {
  return db
    .select()
    .from(clients)
    .where(
      tenantWhere(
        scope,
        clients.organisationId,
        isNull(clients.deletedAt),
        clientVisibility(scope, clients.id),
      ),
    )
    .orderBy(clients.name);
}

export async function getClient(
  scope: TenantScope & Partial<AccessActor>,
  id: string,
) {
  const rows = await db
    .select()
    .from(clients)
    .where(
      tenantWhere(
        scope,
        clients.organisationId,
        eq(clients.id, id),
        isNull(clients.deletedAt),
        clientVisibility(scope, clients.id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listEngagements(scope: EngagementAccessScope) {
  return db
    .select()
    .from(engagements)
    .where(
      tenantWhere(
        scope,
        engagements.organisationId,
        isNull(engagements.deletedAt),
        engagementVisibility(scope, engagements.id),
      ),
    )
    .orderBy(engagements.startDate);
}

export async function getEngagement(scope: EngagementAccessScope, id: string) {
  const rows = await db
    .select()
    .from(engagements)
    .where(
      tenantWhere(
        scope,
        engagements.organisationId,
        eq(engagements.id, id),
        isNull(engagements.deletedAt),
        engagementVisibility(scope, engagements.id),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const scored = await refreshEngagementHealth(scope.organisationId, row.id);
  if (!scored) return row;
  return {
    ...row,
    health: scored.health,
    progress: scored.progress,
    updatedAt: scored.updatedAt,
  };
}
