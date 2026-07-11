import { describe, expect, it } from "vitest";
import {
  assertPermissionMatrix,
  hasPermission,
  permissionMatrix,
  permissions,
  roles,
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
});
