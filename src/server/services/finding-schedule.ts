import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, slaPolicies } from "@/db/schema";
import { positiveDays, retainUntilFromDays } from "@/lib/clients/policy";
import { dueAtFromSla } from "@/lib/findings/sla";

type Queryable = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function findingScheduleDefaults(
  query: Queryable,
  input: {
    organisationId: string;
    clientId: string;
    severity: string;
    dueAt?: Date;
  },
) {
  const [policies, clientRows] = await Promise.all([
    query
      .select({
        severity: slaPolicies.severity,
        days: slaPolicies.days,
        clientId: slaPolicies.clientId,
      })
      .from(slaPolicies)
      .where(eq(slaPolicies.organisationId, input.organisationId)),
    query
      .select({ retentionPolicy: clients.retentionPolicy })
      .from(clients)
      .where(
        and(
          eq(clients.id, input.clientId),
          eq(clients.organisationId, input.organisationId),
        ),
      )
      .limit(1),
  ]);
  const retention = (clientRows[0]?.retentionPolicy ?? {}) as Record<
    string,
    unknown
  >;
  return {
    dueAt:
      input.dueAt ??
      dueAtFromSla({
        severity: input.severity,
        clientId: input.clientId,
        policies,
      }),
    retainUntil: retainUntilFromDays(positiveDays(retention.findingDays)),
  };
}
