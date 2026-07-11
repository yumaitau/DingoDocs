import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
  apiKeys,
  auditEvents,
  organisationMembers,
  serviceAccounts,
} from "@/db/schema";
import type { ApiScope } from "@/lib/api/scopes";
import type { Permission } from "@/lib/permissions/matrix";
import {
  requireOrganisationContext,
  requirePermission,
} from "@/lib/permissions/require";

export { apiScopes, type ApiScope } from "@/lib/api/scopes";

export class ApiAuthenticationError extends Error {
  constructor(
    message: string,
    readonly status = 401,
    readonly code = "invalid_api_key",
  ) {
    super(message);
    this.name = "ApiAuthenticationError";
  }
}

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export type ApiPrincipal = {
  organisationId: string;
  apiKeyId: string;
  userId?: string;
  serviceAccountId?: string;
  scopes: string[];
};

export async function authenticateApiRequest(
  request: Request,
  requiredScope: ApiScope,
): Promise<ApiPrincipal | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{20,})$/.exec(authorization);
  if (!match) throw new ApiAuthenticationError("Bearer API key is malformed");
  const [key] = await db
    .select({
      id: apiKeys.id,
      organisationId: apiKeys.organisationId,
      scopes: apiKeys.scopes,
      userId: apiKeys.userId,
      createdBy: apiKeys.createdBy,
      serviceAccountId: apiKeys.serviceAccountId,
      serviceDisabledAt: serviceAccounts.disabledAt,
    })
    .from(apiKeys)
    .leftJoin(serviceAccounts, eq(serviceAccounts.id, apiKeys.serviceAccountId))
    .where(
      and(
        eq(apiKeys.keyHash, tokenHash(match[1])),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
      ),
    )
    .limit(1);
  if (!key || (key.serviceAccountId && key.serviceDisabledAt))
    throw new ApiAuthenticationError("API key is invalid or expired");
  if (!key.scopes.includes(requiredScope))
    throw new ApiAuthenticationError(
      `API key does not grant ${requiredScope}`,
      403,
      "insufficient_scope",
    );
  if (key.userId) {
    const [membership] = await db
      .select({ id: organisationMembers.id })
      .from(organisationMembers)
      .where(
        and(
          eq(organisationMembers.organisationId, key.organisationId),
          eq(organisationMembers.userId, key.userId),
          isNull(organisationMembers.deletedAt),
        ),
      )
      .limit(1);
    if (!membership)
      throw new ApiAuthenticationError("API key owner is no longer a member");
  }
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id));
  return {
    organisationId: key.organisationId,
    apiKeyId: key.id,
    userId: key.userId ?? key.createdBy ?? undefined,
    serviceAccountId: key.serviceAccountId ?? undefined,
    scopes: key.scopes,
  };
}

export async function apiReadContext(request: Request, scope: ApiScope) {
  const principal = await authenticateApiRequest(request, scope);
  return principal ?? requireOrganisationContext();
}

export async function apiWriteContext(
  request: Request,
  scope: ApiScope,
  permission: Permission,
  input?: { engagementId?: string },
) {
  const principal = await authenticateApiRequest(request, scope);
  return principal ?? requirePermission(permission, input);
}

export async function createApiCredential(
  actor: { organisationId: string; userId: string },
  input: {
    name: string;
    kind: "personal" | "service";
    scopes: ApiScope[];
    serviceAccountName?: string;
    expiresAt?: Date;
  },
) {
  const prefix = input.kind === "personal" ? "dd_pat" : "dd_svc";
  const plaintext = `${prefix}_${randomBytes(32).toString("base64url")}`;
  return db.transaction(async (tx) => {
    let serviceAccountId: string | undefined;
    if (input.kind === "service") {
      if (!input.serviceAccountName?.trim())
        throw new Error("Service account name is required");
      const [account] = await tx
        .insert(serviceAccounts)
        .values({
          organisationId: actor.organisationId,
          name: input.serviceAccountName.trim(),
          createdBy: actor.userId,
        })
        .returning({ id: serviceAccounts.id });
      serviceAccountId = account.id;
    }
    const [credential] = await tx
      .insert(apiKeys)
      .values({
        organisationId: actor.organisationId,
        name: input.name.trim(),
        kind: input.kind,
        userId: input.kind === "personal" ? actor.userId : undefined,
        serviceAccountId,
        keyPrefix: `${prefix}_${plaintext.slice(prefix.length + 1, prefix.length + 9)}`,
        keyHash: tokenHash(plaintext),
        scopes: [...new Set(input.scopes)],
        createdBy: actor.userId,
        expiresAt: input.expiresAt,
      })
      .returning({ id: apiKeys.id, keyPrefix: apiKeys.keyPrefix });
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "api_key.created",
      targetType: "api_key",
      targetId: credential.id,
      metadata: { kind: input.kind, scopes: input.scopes },
    });
    return { ...credential, plaintext };
  });
}

export async function revokeApiCredential(
  actor: { organisationId: string; userId: string },
  apiKeyId: string,
) {
  const [key] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, apiKeyId),
        eq(apiKeys.organisationId, actor.organisationId),
        isNull(apiKeys.revokedAt),
      ),
    )
    .returning({ id: apiKeys.id });
  if (!key) throw new Error("Active API key was not found");
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "api_key.revoked",
    targetType: "api_key",
    targetId: key.id,
  });
}
