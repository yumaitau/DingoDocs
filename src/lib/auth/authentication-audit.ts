import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  organisationMembers,
  organisations,
  users,
} from "@/db/schema";

type AuditEventInsert = typeof auditEvents.$inferInsert;

/** Active organisation memberships, so tenant audit pages see auth events. */
export async function activeOrganisationIdsForUser(userId: string) {
  const rows = await db
    .select({ organisationId: organisationMembers.organisationId })
    .from(organisationMembers)
    .innerJoin(
      organisations,
      eq(organisations.id, organisationMembers.organisationId),
    )
    .where(
      and(
        eq(organisationMembers.userId, userId),
        isNull(organisationMembers.deletedAt),
        isNull(organisations.deletedAt),
      ),
    );
  return rows.map((row) => row.organisationId);
}

export async function userIdForEmail(email: string) {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return row?.id;
}

/**
 * Writes one audit row per active organisation membership of `userId`, or a
 * single organisation-less row when the user is unknown or has none.
 */
export async function insertAuthenticationAudit(
  event: Omit<AuditEventInsert, "organisationId">,
  userId: string | null | undefined,
) {
  const organisationIds = userId
    ? await activeOrganisationIdsForUser(userId)
    : [];
  const rows: AuditEventInsert[] = organisationIds.length
    ? organisationIds.map((organisationId) => ({ ...event, organisationId }))
    : [event];
  await db.insert(auditEvents).values(rows);
}
