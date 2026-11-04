import { describe, expect, it } from "vitest";
import {
  assertPermissionMatrix,
  canGrantRole,
  effectiveRoles,
  hasPermission,
  permissionMatrix,
  permissions,
  roles,
  serviceAccountHasPermission,
  serviceAccountPermissions,
} from "./matrix";

describe("permission matrix", () => {
  it("covers every role and passes independence guards", () => {
    expect(() => assertPermissionMatrix()).not.toThrow();
    expect(Object.keys(permissionMatrix).sort()).toEqual([...roles].sort());
  });

  it("contains only declared permissions", () => {
    for (const grants of Object.values(permissionMatrix))
      for (const grant of grants) expect(permissions).toContain(grant);
  });

  it("does not grant publication or restricted evidence to ordinary client users", () => {
    expect(hasPermission("client_user", "report:publish")).toBe(false);
    expect(hasPermission("client_user", "evidence:view_restricted")).toBe(
      false,
    );
  });

  it("prevents administrators from granting owner or platform roles", () => {
    expect(
      canGrantRole("organisation_administrator", "organisation_owner"),
    ).toBe(false);
    expect(
      canGrantRole("organisation_administrator", "platform_administrator"),
    ).toBe(false);
    expect(canGrantRole("organisation_owner", "platform_administrator")).toBe(
      false,
    );
    expect(canGrantRole("organisation_owner", "organisation_owner")).toBe(true);
    expect(canGrantRole("organisation_administrator", "consultant")).toBe(true);
  });

  it("does not let consultants act on unassigned engagements", () => {
    expect(
      effectiveRoles({
        organisationRole: "consultant",
        engagementId: "eng-1",
      }),
    ).toEqual([]);
    expect(
      effectiveRoles({
        organisationRole: "consultant",
        engagementRole: "lead_consultant",
        engagementId: "eng-1",
      }),
    ).toEqual(["lead_consultant"]);
    expect(
      effectiveRoles({
        organisationRole: "organisation_owner",
        engagementId: "eng-1",
      }),
    ).toEqual(["organisation_owner"]);
  });

  it("limits service accounts to an explicit authoring allow-list", () => {
    expect([...serviceAccountPermissions].sort()).toEqual([
      "evidence:upload",
      "finding:create",
    ]);
    for (const permission of serviceAccountPermissions)
      expect(permissions).toContain(permission);
    for (const permission of [
      "finding:approve",
      "report:publish",
      "scope:manage",
      "data:export",
      "engagement:create",
      "engagement:edit",
      "template:manage",
      "integration:configure",
      "user:manage",
      "organisation:export",
    ] as const)
      expect(serviceAccountHasPermission(permission)).toBe(false);
    expect(serviceAccountHasPermission("finding:create")).toBe(true);
  });
});
