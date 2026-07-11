import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { engagementMembers, organisationMembers } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { resolveActiveOrganisation } from "@/lib/auth/active-organisation";
import { hasPermission, type Permission, type Role } from "./matrix";

export class PermissionDeniedError extends Error {
  constructor(
    readonly permission: Permission,
    reason: string,
  ) {
    super(`Permission denied for ${permission}: ${reason}`);
    this.name = "PermissionDeniedError";
  }
}

export async function requireOrganisationContext() {
  const session = await requireSession();
  const organisation = await resolveActiveOrganisation(session.user.id);
  if (!organisation)
    throw new PermissionDeniedError(
      "data:export",
      "no active organisation membership",
    );
  return { userId: session.user.id, ...organisation };
}

export async function rolesForOperation(input: {
  userId: string;
  organisationId: string;
  engagementId?: string;
}) {
  const membership = await db
    .select({ role: organisationMembers.role })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.organisationId, input.organisationId),
        eq(organisationMembers.userId, input.userId),
        isNull(organisationMembers.deletedAt),
      ),
    )
    .limit(1);

  const result: Role[] = membership[0] ? [membership[0].role as Role] : [];
  if (input.engagementId) {
    const engagementMembership = await db
      .select({ role: engagementMembers.role })
      .from(engagementMembers)
      .where(
        and(
          eq(engagementMembers.organisationId, input.organisationId),
          eq(engagementMembers.engagementId, input.engagementId),
          eq(engagementMembers.userId, input.userId),
          isNull(engagementMembers.deletedAt),
        ),
      )
      .limit(1);
    if (
      engagementMembership[0] &&
      !result.includes(engagementMembership[0].role as Role)
    )
      result.push(engagementMembership[0].role as Role);
  }
  return result;
}

export async function requirePermission(
  permission: Permission,
  input?: { engagementId?: string },
) {
  const context = await requireOrganisationContext();
  const operationRoles = await rolesForOperation({
    userId: context.userId,
    organisationId: context.organisationId,
    engagementId: input?.engagementId,
  });
  if (!operationRoles.some((role) => hasPermission(role, permission))) {
    throw new PermissionDeniedError(
      permission,
      `roles [${operationRoles.join(", ") || "none"}] are not permitted`,
    );
  }
  return { ...context, roles: operationRoles };
}
