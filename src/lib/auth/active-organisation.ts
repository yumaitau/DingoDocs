import { and, asc, eq, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { organisationMembers, organisations, users } from "@/db/schema";
import { sessionRevokedForMembership } from "./membership-sessions";
import { AuthenticationRequiredError } from "./errors";

export const activeOrganisationCookie = "dingodocs_active_organisation";

/**
 * The organisation revoked this session (administrator force logout or SCIM
 * deactivation). Subclasses AuthenticationRequiredError so API callers get a
 * 401; pages should send the user back to sign-in.
 */
export class OrganisationSessionRevokedError extends AuthenticationRequiredError {
  constructor() {
    super();
    this.message = "Sign in again to continue";
    this.name = "OrganisationSessionRevokedError";
  }
}

/**
 * Single choke point for tenant access from a browser session. A membership
 * whose sessionsRevokedAt is at or after the session's creation is treated as
 * revoked: the hinted (cookie) organisation fails closed, and an unhinted
 * lookup skips it. Other organisations keep working.
 */
export async function resolveActiveOrganisation(
  userId: string,
  sessionCreatedAt: Date | string | null | undefined,
) {
  const cookieStore = await cookies();
  const hintedId = cookieStore.get(activeOrganisationCookie)?.value;

  const memberships = await db
    .select({
      organisationId: organisations.id,
      slug: organisations.slug,
      name: organisations.name,
      role: organisationMembers.role,
      timeZone: users.timeZone,
      sessionsRevokedAt: organisationMembers.sessionsRevokedAt,
    })
    .from(organisationMembers)
    .innerJoin(
      organisations,
      eq(organisations.id, organisationMembers.organisationId),
    )
    .innerJoin(users, eq(users.id, organisationMembers.userId))
    .where(
      and(
        eq(organisationMembers.userId, userId),
        isNull(organisationMembers.deletedAt),
        isNull(organisations.deletedAt),
      ),
    )
    .orderBy(asc(organisations.name), asc(organisations.id));

  const revoked = (membership: (typeof memberships)[number]) =>
    sessionRevokedForMembership(sessionCreatedAt, membership.sessionsRevokedAt);
  const toContext = (membership: (typeof memberships)[number]) => ({
    organisationId: membership.organisationId,
    slug: membership.slug,
    name: membership.name,
    role: membership.role,
    timeZone: membership.timeZone,
  });

  const hinted = hintedId
    ? memberships.find((membership) => membership.organisationId === hintedId)
    : undefined;
  if (hinted) {
    if (revoked(hinted)) throw new OrganisationSessionRevokedError();
    return toContext(hinted);
  }
  const usable = memberships.find((membership) => !revoked(membership));
  if (usable) return toContext(usable);
  if (memberships.length) throw new OrganisationSessionRevokedError();
  return null;
}

/** Page variant: a revoked session goes back to sign-in instead of erroring. */
export async function resolvePageOrganisation(
  userId: string,
  sessionCreatedAt: Date | string | null | undefined,
) {
  try {
    return await resolveActiveOrganisation(userId, sessionCreatedAt);
  } catch (error) {
    if (error instanceof OrganisationSessionRevokedError)
      redirect("/sign-in?error=session_revoked");
    throw error;
  }
}
