import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";

export type ClientRetentionPolicy = {
  evidenceDays?: number;
  findingDays?: number;
  reportDays?: number;
  engagementDays?: number;
  [key: string]: unknown;
};

export async function readClientReportDefaults(clientId: string) {
  const [row] = await db
    .select({
      reportPreferences: clients.reportPreferences,
      retentionPolicy: clients.retentionPolicy,
    })
    .from(clients)
    .where(and(eq(clients.id, clientId), isNull(clients.deletedAt)))
    .limit(1);
  if (!row) throw new Error("Client was not found");
  return {
    reportPreferences: (row.reportPreferences ?? {}) as Record<string, unknown>,
    retentionPolicy: (row.retentionPolicy ?? {}) as ClientRetentionPolicy,
  };
}

export function retentionUntilFromPolicy(
  policy: ClientRetentionPolicy | Record<string, unknown> | null | undefined,
  from = new Date(),
) {
  const days = policy?.evidenceDays;
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0)
    return undefined;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
