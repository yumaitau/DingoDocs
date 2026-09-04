import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasPermission, type Role } from "@/lib/permissions/matrix";

const state = vi.hoisted(() => ({
  role: "client_administrator" as Role,
  export: vi.fn(),
}));
vi.mock("@/lib/permissions/require", () => {
  class PermissionDeniedError extends Error {}
  return {
    PermissionDeniedError,
    requirePermission: async (
      permission: Parameters<typeof hasPermission>[1],
    ) => {
      if (!hasPermission(state.role, permission))
        throw new PermissionDeniedError("Forbidden");
      return { organisationId: "organisation", userId: "user" };
    },
  };
});
vi.mock("@/server/services/data-exchange", () => ({
  exportOrganisation: state.export,
  ExchangeScopeError: class extends Error {},
}));
import { POST } from "./route";

describe("organisation export boundary", () => {
  beforeEach(() => {
    state.export
      .mockReset()
      .mockResolvedValue({ json: "{}", checksum: "test" });
  });

  it.each([
    "client_user",
    "client_administrator",
    "read_only",
    "consultant",
    "reviewer",
    "engagement_manager",
  ] as Role[])("denies whole-organisation exports to %s", async (role) => {
    state.role = role;
    for (const mode of ["data", "migration"]) {
      const response = await POST(
        new Request(
          `https://test.invalid/api/exports/organisation?mode=${mode}`,
          { method: "POST" },
        ),
      );
      expect(response.status).toBe(403);
      expect(state.export).not.toHaveBeenCalled();
    }
  });

  it.each(["organisation_owner", "organisation_administrator"] as Role[])(
    "allows organisation export for %s",
    async (role) => {
      state.role = role;
      const response = await POST(
        new Request(
          "https://test.invalid/api/exports/organisation?mode=migration",
          { method: "POST" },
        ),
      );
      expect(response.status).toBe(200);
      expect(state.export).toHaveBeenCalledWith(
        { organisationId: "organisation", userId: "user" },
        "migration",
      );
    },
  );
});
