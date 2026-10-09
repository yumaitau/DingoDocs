import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { engagementMembers, organisationMembers } from "@/db/schema";
import {
  loadMfaEnforcement,
  mfaAccessDecision,
  MfaRequiredError,
} from "@/lib/auth/mfa-policy";
import { requireSession } from "@/lib/auth/session";
import { resolveActiveOrganisation } from "@/lib/auth/active-organisation";
import { EngagementAccessError } from "./access";
import {
  canSeeAllEngagements,
  effectiveRoles,
  hasPermission,
  isEngagementBoundPermission,
  isOrganisationWideRole,
  type Permission,
  type Role,
} from "./matrix";

export class PermissionDeniedError extends Error {
  constructor(
    readonly permission: Permission,
    reason: string,
  ) {
    super(`Permission denied for ${permission}: ${reason}`);
    this.name = "PermissionDeniedError";
  }
}

export async function guardOrganisationMfa(input: {
  userId: string;
  organisationId: string;
  role: string;
}) {
  const decision = await loadMfaEnforcement(
    input.userId,
    input.organisationId,
    input.role,
  );
  if (!decision.blocked) return decision;
  const headerList = await headers();
  const effect = mfaAccessDecision({
    blocked: true,
    pathname: headerList.get("x-pathname"),
    serverAction: headerList.has("next-action"),
  });
  if (effect === "redirect") redirect("/account/security");
  if (effect === "deny") throw new MfaRequiredError();
  return decision;
}

export async function requireOrganisationContext() {
  const session = await requireSession();
  const organisation = await resolveActiveOrganisation(session.user.id);
  if (!organisation)
    throw new PermissionDeniedError(
      "data:export",
      "no active organisation membership",
    );
  await guardOrganisationMfa({
    userId: session.user.id,
    organisationId: organisation.organisationId,
    role: organisation.role,
  });
  return { userId: session.user.id, ...organisation };
}

export async function requireInternalOrganisationContext() {
  const context = await requireOrganisationContext();
  if (
    context.role === "client_user" ||
    context.role === "client_administrator"
  ) {
    throw new PermissionDeniedError(
      "data:export",
      "client accounts must use the restricted client portal",
    );
  }
  return context;
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

  let engagementRole: Role | undefined;
  if (
    input.engagementId &&
    membership[0] &&
    membership[0].role !== "client_user" &&
    membership[0].role !== "client_administrator"
  ) {
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
    engagementRole = engagementMembership[0]?.role as Role | undefined;
  }
  return effectiveRoles({
    organisationRole: membership[0]?.role as Role | undefined,
    engagementRole,
    engagementId: input.engagementId,
  });
}

export async function assertEngagementAccess(input: {
  userId: string;
  organisationId: string;
  engagementId: string;
}) {
  const roles = await rolesForOperation(input);
  if (
    !roles.length ||
    roles.every(
      (role) => role === "client_user" || role === "client_administrator",
    )
  )
    throw new EngagementAccessError();
  return roles;
}

export async function assertActorEngagementAccess(
  actor: {
    organisationId: string;
    userId?: string;
    role?: string | null;
    serviceAccountId?: string | null;
  },
  engagementId: string,
) {
  if (canSeeAllEngagements(actor)) return;
  if (!actor.userId) throw new EngagementAccessError();
  await assertEngagementAccess({
    userId: actor.userId,
    organisationId: actor.organisationId,
    engagementId,
  });
}

export async function requirePermission(
  permission: Permission,
  input?: { engagementId?: string },
) {
  const context = await requireOrganisationContext();
  const operationRoles = await requireActorPermission(
    context,
    permission,
    input,
  );
  return { ...context, roles: operationRoles };
}

export async function requireActorPermission(
  actor: { userId: string; organisationId: string },
  permission: Permission,
  input?: { engagementId?: string },
) {
  const operationRoles = await rolesForOperation({
    userId: actor.userId,
    organisationId: actor.organisationId,
    engagementId: input?.engagementId,
  });
  if (!operationRoles.some((role) => hasPermission(role, permission))) {
    throw new PermissionDeniedError(
      permission,
      `roles [${operationRoles.join(", ") || "none"}] are not permitted`,
    );
  }
  if (
    isEngagementBoundPermission(permission) &&
    !input?.engagementId &&
    !operationRoles.some((role) => isOrganisationWideRole(role))
  ) {
    throw new PermissionDeniedError(
      permission,
      "engagement context is required",
    );
  }
  return operationRoles;
}
