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
}
