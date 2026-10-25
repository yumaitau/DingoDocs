import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  auditEvents,
  organisationMembers,
  organisations,
  scimTokens,
  sessions,
  users,
  type SecurityPolicy,
} from "@/db/schema";
import { canGrantRole, roles, type Role } from "@/lib/permissions/matrix";
import {
  emailDomain,
  isVerifiedScimDomain,
} from "@/server/services/domain-verification";

export type ScimOrgContext = {
  organisationId: string;
  securityPolicy: SecurityPolicy;
};

const scimUserSchema = "urn:ietf:params:scim:schemas:core:2.0:User";
const scimGroupSchema = "urn:ietf:params:scim:schemas:core:2.0:Group";
const listSchema = "urn:ietf:params:scim:api:messages:2.0:ListResponse";

export function hashScimToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createScimToken(actor: {
  organisationId: string;
  userId: string;
}) {
  const plaintext = `scim_${randomBytes(32).toString("base64url")}`;
  const tokenHash = hashScimToken(plaintext);
  await db
    .update(scimTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(scimTokens.organisationId, actor.organisationId),
        isNull(scimTokens.revokedAt),
      ),
    );
  const [row] = await db
    .insert(scimTokens)
    .values({
      organisationId: actor.organisationId,
      tokenHash,
    })
    .returning({ id: scimTokens.id, createdAt: scimTokens.createdAt });
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "scim.token.created",
    targetType: "scim_token",
    targetId: row.id,
  });
  return { id: row.id, token: plaintext, createdAt: row.createdAt };
}

export async function authenticateScimRequest(
  request: Request,
): Promise<ScimOrgContext> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match?.[1]) throw new ScimAuthError("Bearer token required");
  const tokenHash = hashScimToken(match[1]);
  const [row] = await db
    .select({
      organisationId: scimTokens.organisationId,
      tokenHash: scimTokens.tokenHash,
      securityPolicy: organisations.securityPolicy,
    })
    .from(scimTokens)
    .innerJoin(organisations, eq(organisations.id, scimTokens.organisationId))
    .where(
      and(
        eq(scimTokens.tokenHash, tokenHash),
        isNull(scimTokens.revokedAt),
        isNull(organisations.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new ScimAuthError("Invalid SCIM token");
  const expected = Buffer.from(row.tokenHash);
  const actual = Buffer.from(tokenHash);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new ScimAuthError("Invalid SCIM token");
  return {
    organisationId: row.organisationId,
    securityPolicy: (row.securityPolicy ?? {}) as SecurityPolicy,
  };
}

export class ScimAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScimAuthError";
  }
}

export class ScimRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly scimType?: string,
  ) {
    super(message);
    this.name = "ScimRequestError";
  }
}

export function scimError(status: number, detail: string, scimType?: string) {
  return Response.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: String(status),
      ...(scimType ? { scimType } : {}),
      detail,
    },
    {
      status,
      headers: { "content-type": "application/scim+json" },
    },
  );
}

export function toScimUser(user: {
  id: string;
  email: string;
  name: string;
  active: boolean;
}) {
  return {
    schemas: [scimUserSchema],
    id: user.id,
    userName: user.email,
    name: { formatted: user.name },
    active: user.active,
    emails: [{ value: user.email, primary: true }],
    meta: {
      resourceType: "User",
    },
  };
}

// SCIM never touches global user state; `active` is the org membership state.
const scimUserColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  active: sql<boolean>`${organisationMembers.deletedAt} is null and ${users.disabledAt} is null`,
};

function parseScimUserFilter(filter: string) {
  const match =
    /^\s*(userName|emails\.value|emails)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(
      filter,
    );
  if (!match)
    throw new ScimRequestError(
      400,
      'Only userName eq "value" filters are supported',
      "invalidFilter",
    );
  return match[2].replace(/\\(.)/g, "$1").toLowerCase();
}

export async function listScimUsers(
  organisationId: string,
  query: { filter?: string | null; startIndex?: number; count?: number } = {},
) {
  const email = query.filter ? parseScimUserFilter(query.filter) : undefined;
  const where = and(
    eq(organisationMembers.organisationId, organisationId),
    email ? eq(sql`lower(${users.email})`, email) : undefined,
  );
  const startIndex = Math.max(1, Math.floor(query.startIndex ?? 1) || 1);
  const count =
    query.count === undefined || Number.isNaN(query.count)
      ? undefined
      : Math.max(0, Math.floor(query.count));
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(organisationMembers)
    .innerJoin(users, eq(users.id, organisationMembers.userId))
    .where(where);
  const page = db
    .select(scimUserColumns)
    .from(organisationMembers)
    .innerJoin(users, eq(users.id, organisationMembers.userId))
    .where(where)
    .orderBy(asc(users.email), asc(users.id))
    .offset(startIndex - 1);
  const rows = count === undefined ? await page : await page.limit(count);
  const resources = rows.map(toScimUser);
  return {
    schemas: [listSchema],
    totalResults: total,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

export async function getScimUser(organisationId: string, userId: string) {
  const [row] = await db
    .select(scimUserColumns)
    .from(organisationMembers)
    .innerJoin(users, eq(users.id, organisationMembers.userId))
    .where(
      and(
        eq(organisationMembers.organisationId, organisationId),
        eq(users.id, userId),
      ),
    )
    .limit(1);
  return row ? toScimUser(row) : null;
}

async function auditScim(
  organisationId: string,
  action: string,
  userId: string,
  metadata: Record<string, unknown> = {},
) {
  await db.insert(auditEvents).values({
    organisationId,
    action,
    targetType: "user",
    targetId: userId,
    metadata: { source: "scim", ...metadata },
  });
}

async function setScimMembershipActive(
  organisationId: string,
  userId: string,
  active: boolean,
) {
  const [membership] = await db
    .select({
      id: organisationMembers.id,
      role: organisationMembers.role,
      deletedAt: organisationMembers.deletedAt,
    })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.organisationId, organisationId),
        eq(organisationMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!membership) return;
  if (active) {
    if (membership.deletedAt) {
      await db
        .update(organisationMembers)
        .set({ deletedAt: null })
        .where(eq(organisationMembers.id, membership.id));
      await auditScim(organisationId, "scim.user.reactivated", userId);
    }
    await clearLegacyScimDisable(organisationId, userId);
  } else if (!active && !membership.deletedAt) {
    if (membership.role === "organisation_owner") {
      const owners = await db
        .select({ id: organisationMembers.id })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, organisationId),
            eq(organisationMembers.role, "organisation_owner"),
            isNull(organisationMembers.deletedAt),
          ),
        );
      if (owners.length <= 1)
        throw new ScimRequestError(
          409,
          "Cannot deactivate the last organisation owner",
        );
    }
    await db
      .update(organisationMembers)
      .set({ deletedAt: new Date() })
      .where(eq(organisationMembers.id, membership.id));
    await db
      .delete(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.activeOrganisationId, organisationId),
        ),
      );
    await auditScim(organisationId, "scim.user.deactivated", userId);
  }
}

// Earlier releases deactivated SCIM users through the global users.disabledAt
// flag, which only SCIM ever set. Clear it when this organisation is the
// user's only active membership, so the IdP can re-enable them here.
async function clearLegacyScimDisable(organisationId: string, userId: string) {
  const [otherMembership] = await db
    .select({ id: organisationMembers.id })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.userId, userId),
        ne(organisationMembers.organisationId, organisationId),
        isNull(organisationMembers.deletedAt),
      ),
    )
    .limit(1);
  if (otherMembership) return;
  const cleared = await db
    .update(users)
    .set({ disabledAt: null, updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNotNull(users.disabledAt)))
    .returning({ id: users.id });
  if (cleared.length)
    await auditScim(organisationId, "scim.user.legacy_disable_cleared", userId);
}

async function loadSecurityPolicy(organisationId: string) {
  const [org] = await db
    .select({ securityPolicy: organisations.securityPolicy })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  return (org?.securityPolicy ?? {}) as SecurityPolicy;
}

export async function createScimUser(
  organisationId: string,
  input: { userName: string; name?: string; active?: boolean },
) {
  const email = input.userName.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("userName must be an email");
  // Every create (including re-POSTs of existing members) needs DNS proof that
  // this organisation controls the email domain; a SCIM token alone does not
  // entitle a tenant to claim global identities.
  const policy = await loadSecurityPolicy(organisationId);
  if (!isVerifiedScimDomain(policy, emailDomain(email)))
    throw new ScimRequestError(
      403,
      "userName domain is not verified for this organisation",
      "invalidValue",
    );
  const displayName = input.name?.trim() || email.split("@")[0] || email;
  const [existing] = await db
    .select({ id: users.id, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!existing) {
    const userId = await db.transaction(async (tx) => {
      // emailVerified is IdP-asserted: the organisation proved control of this
      // domain via DNS, so its IdP is authoritative for addresses on it.
      const [created] = await tx
        .insert(users)
        .values({ email, name: displayName, emailVerified: true })
        .returning({ id: users.id });
      await tx.insert(organisationMembers).values({
        organisationId,
        userId: created.id,
        role: "read_only",
        joinedAt: new Date(),
        deletedAt: input.active === false ? new Date() : null,
      });
      return created.id;
    });
    await auditScim(organisationId, "scim.user.created", userId, {
      active: input.active !== false,
    });
    const resource = await getScimUser(organisationId, userId);
    if (!resource) throw new Error("Unable to load created SCIM user");
    return resource;
  }

  const [membership] = await db
    .select({ id: organisationMembers.id })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.organisationId, organisationId),
        eq(organisationMembers.userId, existing.id),
      ),
    )
    .limit(1);
  if (membership) {
    await setScimMembershipActive(
      organisationId,
      existing.id,
      input.active !== false,
    );
  } else {
    // A self-registered, unverified account may belong to someone squatting
    // on the address; never adopt it (group pushes could then elevate it).
    if (!existing.emailVerified)
      throw new ScimRequestError(
        409,
        "An unverified account already uses this email; it must be verified or removed before provisioning",
        "uniqueness",
      );
    // Domain proof makes this organisation authoritative for the address, so
    // memberships elsewhere don't block it. Global user fields stay untouched.
    await db
      .insert(organisationMembers)
      .values({
        organisationId,
        userId: existing.id,
        role: "read_only",
        joinedAt: new Date(),
        deletedAt: input.active === false ? new Date() : null,
      })
      .onConflictDoNothing();
    await auditScim(organisationId, "scim.user.created", existing.id, {
      active: input.active !== false,
      existingUser: true,
    });
  }
  const resource = await getScimUser(organisationId, existing.id);
  if (!resource) throw new Error("Unable to load created SCIM user");
  return resource;
}

export function parseScimBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (normalised === "true") return true;
    if (normalised === "false") return false;
  }
  return undefined;
}

export async function patchScimUser(
  organisationId: string,
  userId: string,
  operations: Array<{ op: string; path?: string; value?: unknown }>,
) {
  const current = await getScimUser(organisationId, userId);
  if (!current) return null;
  let active: boolean | undefined;
  for (const operation of operations) {
    if (operation.op.toLowerCase() !== "replace") continue;
    const path = operation.path?.toLowerCase();
    const next =
      path === "active"
        ? parseScimBoolean(operation.value)
        : !path &&
            typeof operation.value === "object" &&
            operation.value &&
            "active" in operation.value
          ? parseScimBoolean((operation.value as { active: unknown }).active)
          : undefined;
    if (next !== undefined) active = next;
    // userName/emails/name changes are ignored: SCIM must not rewrite global
    // identity fields shared with other organisations.
  }
  if (active !== undefined)
    await setScimMembershipActive(organisationId, userId, active);
  return getScimUser(organisationId, userId);
}

export async function disableScimUser(organisationId: string, userId: string) {
  const current = await getScimUser(organisationId, userId);
  if (!current) return null;
  await setScimMembershipActive(organisationId, userId, false);
  return getScimUser(organisationId, userId);
}

// SCIM can never mint owners/platform admins, nor change an owner's role.
const scimProtectedRoles: readonly Role[] = [
  "platform_administrator",
  "organisation_owner",
];

const scimGroupRolesError =
  "SCIM group roles must be a JSON object mapping group names to roles";

export function parseScimGroupRoles(raw: string, actorRole: Role) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(scimGroupRolesError);
  }
  const result = z.record(z.string(), z.string()).safeParse(parsed);
  if (!result.success) throw new Error(scimGroupRolesError);
  for (const [group, role] of Object.entries(result.data)) {
    if (
      !roles.includes(role as Role) ||
      scimProtectedRoles.includes(role as Role) ||
      !canGrantRole(actorRole, role as Role)
    )
      throw new Error(
        `SCIM group "${group}" cannot be mapped to role "${role}"`,
      );
  }
  return result.data as Record<string, Role>;
}

export function listScimGroups(policy: SecurityPolicy) {
  const mapping = policy.scimGroupRoles ?? {};
  const resources = Object.keys(mapping).map((displayName) => ({
    schemas: [scimGroupSchema],
    id: Buffer.from(displayName).toString("base64url"),
    displayName,
    meta: { resourceType: "Group" },
  }));
  return {
    schemas: [listSchema],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

function decodeGroupDisplayName(idOrName: string) {
  try {
    return Buffer.from(idOrName, "base64url").toString("utf8");
  } catch {
    return idOrName;
  }
}

export async function patchScimGroup(
  context: ScimOrgContext,
  groupId: string,
  body: {
    displayName?: string;
    Operations?: Array<{ op: string; path?: string; value?: unknown }>;
  },
) {
  const displayName =
    body.displayName?.trim() || decodeGroupDisplayName(groupId);
  const roleName = context.securityPolicy.scimGroupRoles?.[displayName];
  if (
    !roleName ||
    !roles.includes(roleName as Role) ||
    scimProtectedRoles.includes(roleName as Role)
  ) {
    return { ignored: true as const, displayName };
  }
  const role = roleName as Role;
  const memberIds = new Set<string>();
  for (const operation of body.Operations ?? []) {
    if (
      operation.op.toLowerCase() !== "add" &&
      operation.op.toLowerCase() !== "replace"
    )
      continue;
    if (operation.path && operation.path !== "members") continue;
    const value = operation.value;
    const entries = Array.isArray(value) ? value : value ? [value] : [];
    for (const entry of entries) {
      if (typeof entry === "string") memberIds.add(entry);
      else if (
        entry &&
        typeof entry === "object" &&
        "value" in entry &&
        typeof (entry as { value: unknown }).value === "string"
      )
        memberIds.add((entry as { value: string }).value);
    }
  }
  for (const userId of memberIds) {
    const [membership] = await db
      .select({ id: organisationMembers.id, role: organisationMembers.role })
      .from(organisationMembers)
      .where(
        and(
          eq(organisationMembers.organisationId, context.organisationId),
          eq(organisationMembers.userId, userId),
          isNull(organisationMembers.deletedAt),
        ),
      )
      .limit(1);
    if (
      !membership ||
      membership.role === role ||
      scimProtectedRoles.includes(membership.role as Role)
    )
      continue;
    await db
      .update(organisationMembers)
      .set({ role })
      .where(eq(organisationMembers.id, membership.id));
    await auditScim(context.organisationId, "scim.group.role_changed", userId, {
      group: displayName,
      from: membership.role,
      to: role,
    });
  }
  return {
    ignored: false as const,
    schemas: [scimGroupSchema],
    id: Buffer.from(displayName).toString("base64url"),
    displayName,
    members: [...memberIds].map((value) => ({ value })),
    meta: { resourceType: "Group" },
  };
}
