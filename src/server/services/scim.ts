import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  organisationMembers,
  organisations,
  scimTokens,
  users,
  type SecurityPolicy,
} from "@/db/schema";
import { roles, type Role } from "@/lib/permissions/matrix";

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
  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  )
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

export function scimError(status: number, detail: string) {
  return Response.json(
    {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: String(status),
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
  disabledAt: Date | null;
}) {
  return {
    schemas: [scimUserSchema],
    id: user.id,
    userName: user.email,
    name: { formatted: user.name },
    active: !user.disabledAt,
    emails: [{ value: user.email, primary: true }],
    meta: {
      resourceType: "User",
    },
  };
}

export async function listScimUsers(organisationId: string) {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      disabledAt: users.disabledAt,
    })
    .from(organisationMembers)
    .innerJoin(users, eq(users.id, organisationMembers.userId))
    .where(
      and(
        eq(organisationMembers.organisationId, organisationId),
        isNull(organisationMembers.deletedAt),
      ),
    );
  const resources = rows.map(toScimUser);
  return {
    schemas: [listSchema],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

export async function getScimUser(organisationId: string, userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      disabledAt: users.disabledAt,
    })
    .from(organisationMembers)
    .innerJoin(users, eq(users.id, organisationMembers.userId))
    .where(
      and(
        eq(organisationMembers.organisationId, organisationId),
        eq(users.id, userId),
        isNull(organisationMembers.deletedAt),
      ),
    )
    .limit(1);
  return row ? toScimUser(row) : null;
}

export async function createScimUser(
  organisationId: string,
  input: { userName: string; name?: string; active?: boolean },
) {
  const email = input.userName.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("userName must be an email");
  const displayName = input.name?.trim() || email.split("@")[0] || email;
  const [existing] = await db
    .select({ id: users.id, disabledAt: users.disabledAt, name: users.name })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  let userId = existing?.id;
  if (!existing) {
    const [created] = await db
      .insert(users)
      .values({
        email,
        name: displayName,
        emailVerified: true,
        disabledAt: input.active === false ? new Date() : null,
      })
      .returning({ id: users.id });
    userId = created.id;
  } else if (input.active === false && !existing.disabledAt) {
    await db
      .update(users)
      .set({ disabledAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, existing.id));
  } else if (input.active !== false && existing.disabledAt) {
    await db
      .update(users)
      .set({ disabledAt: null, updatedAt: new Date() })
      .where(eq(users.id, existing.id));
  }

  const [membership] = await db
    .select({ id: organisationMembers.id })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.organisationId, organisationId),
        eq(organisationMembers.userId, userId!),
        isNull(organisationMembers.deletedAt),
      ),
    )
    .limit(1);
  if (!membership) {
    await db.insert(organisationMembers).values({
      organisationId,
      userId: userId!,
      role: "read_only",
      joinedAt: new Date(),
    });
  }
  const resource = await getScimUser(organisationId, userId!);
  if (!resource) throw new Error("Unable to load created SCIM user");
  return resource;
}

export async function patchScimUser(
  organisationId: string,
  userId: string,
  operations: Array<{ op: string; path?: string; value?: unknown }>,
) {
  const current = await getScimUser(organisationId, userId);
  if (!current) return null;
  for (const operation of operations) {
    const op = operation.op.toLowerCase();
    if (op === "replace" && (operation.path === "active" || !operation.path)) {
      const value =
        typeof operation.value === "object" &&
        operation.value &&
        "active" in (operation.value as object)
          ? Boolean((operation.value as { active: unknown }).active)
          : Boolean(operation.value);
      await db
        .update(users)
        .set({
          disabledAt: value ? null : new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    }
    if (
      (op === "replace" || op === "add") &&
      (operation.path === "userName" || operation.path === "emails")
    ) {
      // Email rename is intentionally ignored to avoid account hijack.
    }
    if (
      (op === "replace" || op === "add") &&
      operation.path === "name.formatted" &&
      typeof operation.value === "string"
    ) {
      await db
        .update(users)
        .set({ name: operation.value.trim(), updatedAt: new Date() })
        .where(eq(users.id, userId));
    }
  }
  return getScimUser(organisationId, userId);
}

export async function disableScimUser(organisationId: string, userId: string) {
  const current = await getScimUser(organisationId, userId);
  if (!current) return null;
  await db
    .update(users)
    .set({ disabledAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
  return getScimUser(organisationId, userId);
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
  if (!roleName || !roles.includes(roleName as Role)) {
    return { ignored: true as const, displayName };
  }
  const role = roleName as Role;
  const memberIds = new Set<string>();
  for (const operation of body.Operations ?? []) {
    if (operation.op.toLowerCase() !== "add" && operation.op.toLowerCase() !== "replace")
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
      .select({ id: organisationMembers.id })
      .from(organisationMembers)
      .where(
        and(
          eq(organisationMembers.organisationId, context.organisationId),
          eq(organisationMembers.userId, userId),
          isNull(organisationMembers.deletedAt),
        ),
      )
      .limit(1);
    if (membership) {
      await db
        .update(organisationMembers)
        .set({ role })
        .where(eq(organisationMembers.id, membership.id));
    }
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
