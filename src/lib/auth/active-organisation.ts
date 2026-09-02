import { and, asc, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { organisationMembers, organisations, users } from "@/db/schema";

export const activeOrganisationCookie = "dingodocs_active_organisation";

export async function resolveActiveOrganisation(userId: string) {
  const cookieStore = await cookies();
  const hintedId = cookieStore.get(activeOrganisationCookie)?.value;

  const baseCondition = [
    eq(organisationMembers.userId, userId),
    isNull(organisationMembers.deletedAt),
    isNull(organisations.deletedAt),
  ];
  const rows = await db
    .select({
      organisationId: organisations.id,
      slug: organisations.slug,
      name: organisations.name,
      role: organisationMembers.role,
      timeZone: users.timeZone,
    })
    .from(organisationMembers)
    .innerJoin(
      organisations,
      eq(organisations.id, organisationMembers.organisationId),
    )
    .innerJoin(users, eq(users.id, organisationMembers.userId))
    .where(
      hintedId
        ? and(...baseCondition, eq(organisations.id, hintedId))
        : and(...baseCondition),
    )
    .orderBy(asc(organisations.name))
    .limit(1);

  if (rows[0]) return rows[0];
  if (!hintedId) return null;

  const fallback = await db
    .select({
      organisationId: organisations.id,
      slug: organisations.slug,
      name: organisations.name,
      role: organisationMembers.role,
      timeZone: users.timeZone,
    })
    .from(organisationMembers)
    .innerJoin(
      organisations,
      eq(organisations.id, organisationMembers.organisationId),
    )
    .innerJoin(users, eq(users.id, organisationMembers.userId))
    .where(and(...baseCondition))
    .orderBy(asc(organisations.name))
    .limit(1);

  return fallback[0] ?? null;
}
