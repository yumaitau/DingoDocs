import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  auditEvents,
  organisationMembers,
  organisations,
  users,
  type SecurityPolicy,
} from "@/db/schema";
import type { SamlSsoPolicy } from "@/lib/auth/saml-config";
import { roleRank, type Role } from "@/lib/permissions/matrix";
import {
  emailDomain,
  isVerifiedScimDomain,
} from "@/server/services/domain-verification";
import { isIdpAssignableRole } from "@/server/services/scim";

export type SamlIdentity = {
  nameID: string;
  email?: string;
  name?: string;
  groups: string[];
};

export type SamlRejectReason =
  | "missing_identity"
  | "domain_not_verified"
  | "subject_conflict"
  | "user_disabled"
  | "membership_inactive"
  | "membership_revoked"
  | "not_a_member"
  | "unverified_account"
  | "provisioning_failed"
  | "two_factor_required";

export type SamlResolution =
  | {
      ok: true;
      userId: string;
      provisioned: "none" | "user" | "membership";
    }
  | { ok: false; reason: SamlRejectReason; userId?: string };

/** Better Auth hook-running writes, supplied by the plugin. */
export type SamlAccountAdapter = {
  createUser(data: {
    email: string;
    name: string;
    emailVerified: true;
  }): Promise<{ id: string } | null>;
  linkAccount(data: {
    userId: string;
    providerId: string;
    accountId: string;
  }): Promise<unknown>;
};

export type SamlRequestMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

export function samlProviderId(organisationId: string) {
  return `saml:${organisationId}`;
}

export type SamlOrganisation = {
  id: string;
  slug: string;
  securityPolicy: SecurityPolicy;
};

export async function findSamlOrganisationBySlug(
  slug: string,
): Promise<SamlOrganisation | null> {
  const [row] = await db
    .select({
      id: organisations.id,
      slug: organisations.slug,
      securityPolicy: organisations.securityPolicy,
    })
    .from(organisations)
    .where(and(eq(organisations.slug, slug), isNull(organisations.deletedAt)))
    .limit(1);
  return row
    ? { ...row, securityPolicy: (row.securityPolicy ?? {}) as SecurityPolicy }
    : null;
}

/** The organisation that verified this exact email domain and uses SAML. */
export async function findSamlOrganisationByDomain(domain: string) {
  const [row] = await db
    .select({ slug: organisations.slug })
    .from(organisations)
    .where(
      and(
        isNull(organisations.deletedAt),
        sql`${organisations.securityPolicy} -> 'sso' ->> 'protocol' = 'saml'`,
        sql`jsonb_path_exists(${organisations.securityPolicy}, '$.scimDomains[*] ? (@.domain == $d && exists(@.verifiedAt))', jsonb_build_object('d', ${domain}::text))`,
      ),
    )
    .limit(1);
  return row?.slug ?? null;
}

/**
 * Most privileged IdP-assignable role among the user's mapped groups, else
 * read_only. Owner and platform administrator can never be granted.
 */
export function roleForGroups(
  groupRoles: Record<string, string> | undefined,
  groups: readonly string[],
): Role {
  let best: Role = "read_only";
  for (const group of groups) {
    const role = groupRoles?.[group];
    if (role && isIdpAssignableRole(role) && roleRank[role] < roleRank[best])
      best = role;
  }
  return best;
}

export async function auditSaml(
  organisationId: string,
  action: string,
  input: {
    userId?: string | null;
    meta?: SamlRequestMeta;
    metadata?: Record<string, unknown>;
  },
) {
  await db.insert(auditEvents).values({
    organisationId,
    actorId: input.userId ?? null,
    action,
    targetType: input.userId ? "user" : "authentication",
    targetId: input.userId ?? undefined,
    ipAddress: input.meta?.ipAddress ?? undefined,
    userAgent: input.meta?.userAgent ?? undefined,
    requestId: input.meta?.requestId ?? undefined,
    metadata: { source: "saml", ...input.metadata },
  });
}

function isBanned(user: { banned: boolean; banExpires: Date | null }) {
  return (
    user.banned &&
    (!user.banExpires || new Date(user.banExpires).getTime() > Date.now())
  );
}

async function linkedAccountOwner(providerId: string, accountId: string) {
  const [row] = await db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(
      and(
        eq(accounts.providerId, providerId),
        eq(accounts.accountId, accountId),
      ),
    )
    .limit(1);
  return row?.userId ?? null;
}

async function loadMembership(organisationId: string, userId: string) {
  const [row] = await db
    .select({
      id: organisationMembers.id,
      deletedAt: organisationMembers.deletedAt,
      sessionsRevokedAt: organisationMembers.sessionsRevokedAt,
    })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.organisationId, organisationId),
        eq(organisationMembers.userId, userId),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Maps a validated SAML identity to a user of THIS organisation, provisioning
 * just in time when the policy allows. Every rejection is reported with a
 * reason for the audit log only; the browser sees one generic error.
 *
 * SAML sign-in always requires the email domain to be DNS-verified by this
 * organisation, including for existing members. Sessions are global across
 * organisations, so without domain proof an organisation's IdP could assert
 * the address of a guest member and obtain that person's session elsewhere.
 */
export async function resolveSamlSignIn(input: {
  organisation: SamlOrganisation;
  sso: SamlSsoPolicy;
  identity: SamlIdentity;
  adapter: SamlAccountAdapter;
  meta?: SamlRequestMeta;
  now?: Date;
}): Promise<SamlResolution> {
  const { organisation, sso, identity } = input;
  const now = input.now ?? new Date();
  const email = identity.email;
  if (!identity.nameID || !email)
    return { ok: false, reason: "missing_identity" };
  if (!isVerifiedScimDomain(organisation.securityPolicy, emailDomain(email)))
    return { ok: false, reason: "domain_not_verified" };

  const providerId = samlProviderId(organisation.id);
  const linkedUserId = await linkedAccountOwner(providerId, identity.nameID);
  const [existing] = await db
    .select({
      id: users.id,
      emailVerified: users.emailVerified,
      twoFactorEnabled: users.twoFactorEnabled,
      disabledAt: users.disabledAt,
      banned: users.banned,
      banExpires: users.banExpires,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (linkedUserId && linkedUserId !== existing?.id)
    return { ok: false, reason: "subject_conflict", userId: existing?.id };

  let userId = existing?.id;
  let provisioned: "none" | "user" | "membership" = "none";
  if (existing) {
    if (existing.disabledAt || isBanned(existing))
      return { ok: false, reason: "user_disabled", userId };
    const membership = await loadMembership(organisation.id, existing.id);
    if (membership?.deletedAt)
      return { ok: false, reason: "membership_inactive", userId };
    if (
      membership?.sessionsRevokedAt &&
      new Date(membership.sessionsRevokedAt).getTime() >= now.getTime()
    )
      return { ok: false, reason: "membership_revoked", userId };
    if (existing.twoFactorEnabled && !sso.idpEnforcesMfa)
      return { ok: false, reason: "two_factor_required", userId };
    if (!membership) {
      if (!sso.jitProvisioning)
        return { ok: false, reason: "not_a_member", userId };
      // A self-registered, unverified account may be squatting on the address.
      if (!existing.emailVerified)
        return { ok: false, reason: "unverified_account", userId };
      provisioned = "membership";
    }
  } else {
    if (!sso.jitProvisioning) return { ok: false, reason: "not_a_member" };
    // The organisation proved control of the domain, so its IdP is
    // authoritative for the address (the same trust SCIM relies on).
    const created = await input.adapter.createUser({
      email,
      name: identity.name?.slice(0, 200) || email.split("@")[0] || email,
      emailVerified: true,
    });
    if (!created) return { ok: false, reason: "provisioning_failed" };
    userId = created.id;
    provisioned = "user";
    await auditSaml(organisation.id, "sso.saml.user_provisioned", {
      userId,
      meta: input.meta,
    });
  }
  if (!userId) return { ok: false, reason: "provisioning_failed" };

  if (provisioned !== "none") {
    const role = roleForGroups(sso.groupRoles, identity.groups);
    const inserted = await db
      .insert(organisationMembers)
      .values({
        organisationId: organisation.id,
        userId,
        role,
        joinedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: organisationMembers.id });
    if (inserted.length) {
      await auditSaml(organisation.id, "sso.saml.membership_created", {
        userId,
        meta: input.meta,
        metadata: { role, existingUser: provisioned === "membership" },
      });
    } else {
      // A concurrent sign-in or SCIM push created it; it must be usable.
      const membership = await loadMembership(organisation.id, userId);
      if (!membership || membership.deletedAt)
        return { ok: false, reason: "membership_inactive", userId };
    }
  }

  if (!linkedUserId) {
    try {
      await input.adapter.linkAccount({
        userId,
        providerId,
        accountId: identity.nameID,
      });
      await auditSaml(organisation.id, "sso.saml.account_linked", {
        userId,
        meta: input.meta,
      });
    } catch (error) {
      // Lost a race on (providerId, accountId); accept only our own link.
      if ((await linkedAccountOwner(providerId, identity.nameID)) !== userId) {
        if (error instanceof Error && /unique|duplicate/i.test(error.message))
          return { ok: false, reason: "subject_conflict", userId };
        throw error;
      }
    }
  }
  return { ok: true, userId, provisioned };
}
