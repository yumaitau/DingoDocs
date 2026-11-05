export const roles = [
  "platform_administrator",
  "organisation_owner",
  "organisation_administrator",
  "engagement_manager",
  "lead_consultant",
  "consultant",
  "reviewer",
  "client_administrator",
  "client_user",
  "read_only",
] as const;

export type Role = (typeof roles)[number];

export const permissions = [
  "engagement:create",
  "engagement:edit",
  "engagement:manage_members",
  "engagement:archive",
  "scope:manage",
  "evidence:upload",
  "evidence:view_restricted",
  "finding:create",
  "finding:approve",
  "report:publish",
  "client:manage",
  "user:manage",
  "template:manage",
  "data:export",
  "organisation:export",
  "audit:view",
  "integration:configure",
] as const;

export type Permission = (typeof permissions)[number];

const all: readonly Permission[] = permissions;
const consultant: readonly Permission[] = [
  "scope:manage",
  "evidence:upload",
  "finding:create",
];
const lead: readonly Permission[] = [
  ...consultant,
  "engagement:edit",
  "evidence:view_restricted",
  "finding:approve",
];
const manager: readonly Permission[] = [
  ...lead,
  "engagement:manage_members",
  "engagement:create",
  "engagement:archive",
  "client:manage",
  "template:manage",
  "data:export",
  "report:publish",
];

export const permissionMatrix: Record<Role, readonly Permission[]> = {
  platform_administrator: all,
  organisation_owner: all,
  organisation_administrator: all,
  engagement_manager: manager,
  lead_consultant: lead,
  consultant,
  reviewer: ["evidence:view_restricted", "finding:approve", "data:export"],
  client_administrator: ["evidence:upload", "data:export"],
  client_user: ["evidence:upload"],
  read_only: [],
};

export function hasPermission(role: Role, permission: Permission) {
  return permissionMatrix[role].includes(permission);
}

export const organisationWideRoles = [
  "platform_administrator",
  "organisation_owner",
  "organisation_administrator",
] as const satisfies readonly Role[];

export const roleRank: Record<Role, number> = {
  platform_administrator: 0,
  organisation_owner: 1,
  organisation_administrator: 2,
  engagement_manager: 3,
  lead_consultant: 4,
  consultant: 5,
  reviewer: 6,
  client_administrator: 7,
  client_user: 8,
  read_only: 9,
};

export const engagementBoundPermissions = [
  "engagement:edit",
  "engagement:manage_members",
  "engagement:archive",
  "scope:manage",
  "evidence:upload",
  "evidence:view_restricted",
  "finding:create",
  "finding:approve",
  "report:publish",
  "data:export",
] as const satisfies readonly Permission[];

export function isOrganisationWideRole(role: string): role is Role {
  return (organisationWideRoles as readonly string[]).includes(role);
}

export function isEngagementBoundPermission(
  permission: Permission,
): permission is (typeof engagementBoundPermissions)[number] {
  return (engagementBoundPermissions as readonly Permission[]).includes(
    permission,
  );
}

/**
 * Service-account keys (CI, scanners, agents) are not people, so they get an
 * explicit allow-list rather than a role. They author drafts, notes, timeline
 * entries and evidence; anything that approves, publishes, releases to
 * clients, approves scope, exports data, or administers the organisation or
 * its integrations stays with a human. Scope approval (scope:manage) is
 * deliberately excluded, which also keeps service keys out of task, runbook
 * and time writes that are gated on it.
 */
export const serviceAccountPermissions: readonly Permission[] = [
  "finding:create",
  "evidence:upload",
];

export function serviceAccountHasPermission(permission: Permission) {
  return serviceAccountPermissions.includes(permission);
}

export function canSeeAllEngagements(actor: {
  role?: string | null;
  serviceAccountId?: string | null;
}) {
  // Service accounts see every engagement in their organisation because CI
  // ingest targets many engagements with one key. Per-engagement grants for
  // service accounts are deferred; until then the allow-list above limits
  // what they can do, not where.
  if (actor.serviceAccountId) return true;
  return Boolean(actor.role && isOrganisationWideRole(actor.role));
}

export function canGrantRole(actorRole: Role, targetRole: Role) {
  return roleRank[targetRole] >= roleRank[actorRole];
}

export function grantableRoles(actorRole: Role) {
  return roles.filter((role) => canGrantRole(actorRole, role));
}

export function effectiveRoles(input: {
  organisationRole?: Role;
  engagementRole?: Role;
  engagementId?: string;
}): Role[] {
  const organisationRole = input.organisationRole;
  if (!organisationRole) return [];
  if (
    organisationRole === "client_user" ||
    organisationRole === "client_administrator"
  )
    return [organisationRole];
  if (!input.engagementId) return [organisationRole];
  if (isOrganisationWideRole(organisationRole)) {
    if (input.engagementRole && input.engagementRole !== organisationRole)
      return [organisationRole, input.engagementRole];
    return [organisationRole];
  }
  if (!input.engagementRole) return [];
  return [input.engagementRole];
}

export function assertPermissionMatrix() {
  for (const role of roles) {
    if (!permissionMatrix[role])
      throw new Error(`Missing permission matrix entry for ${role}`);
  }
  if (hasPermission("client_user", "evidence:view_restricted"))
    throw new Error("Client users must not view restricted evidence");
  if (hasPermission("consultant", "report:publish"))
    throw new Error("Consultants must not publish reports");
  if (hasPermission("reviewer", "finding:create"))
    throw new Error("Reviewer independence guard failed");
  for (const permission of [
    "finding:approve",
    "report:publish",
    "scope:manage",
    "data:export",
  ] as const)
    if (serviceAccountHasPermission(permission))
      throw new Error(`Service accounts must not hold ${permission}`);
  if (canGrantRole("organisation_administrator", "organisation_owner"))
    throw new Error("Administrators must not grant owner");
  if (canGrantRole("organisation_owner", "platform_administrator"))
    throw new Error("Owners must not grant platform administrator");
  if (
    effectiveRoles({
      organisationRole: "consultant",
      engagementId: "engagement",
    }).length
  )
    throw new Error("Consultants must not inherit unassigned engagements");
}
