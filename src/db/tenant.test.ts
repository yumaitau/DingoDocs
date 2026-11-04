import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  member: false,
  statements: [] as string[],
  warnings: [] as Array<{ event: string; attributes: unknown }>,
}));

vi.mock("@/lib/observability/logger", () => ({
  structuredLog: (_level: string, event: string, attributes: unknown) =>
    state.warnings.push({ event, attributes }),
}));

vi.mock("./index", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  type Query = Parameters<InstanceType<typeof PgDialect>["sqlToQuery"]>[0];
  const dialect = new PgDialect();
  const storage = new AsyncLocalStorage<{
    organisationId: string;
    tx: unknown;
    active: boolean;
  }>();
  const render = (query: unknown) => dialect.sqlToQuery(query as Query).sql;
  const tx = {
    execute: async (query: unknown) => {
      state.statements.push(render(query));
      return [];
    },
  };
  const db = {
    execute: async (query: unknown) => {
      state.statements.push(render(query));
      return [{ member: state.member }];
    },
    transaction: async (fn: (value: unknown) => Promise<unknown>) => fn(tx),
  };
  return {
    db,
    tenantScopeStorage: storage,
    activeTenantScope: () => {
      const scope = storage.getStore();
      return scope?.active ? scope : undefined;
    },
  };
});

import { resetTenantRoleCheck, withTenant } from "./tenant";

const organisationId = "7b0c1e6e-3d5f-4c1a-9b77-2f1d5e0c9a11";

describe("withTenant without the tenant role", () => {
  beforeEach(() => {
    state.member = false;
    state.statements = [];
    state.warnings = [];
    resetTenantRoleCheck();
  });

  it("sets only the organisation setting and warns once", async () => {
    await withTenant(organisationId, async () => "first");
    await withTenant(organisationId, async () => "second");
    const roleSwitches = state.statements.filter((statement) =>
      statement.includes("set_config('role'"),
    );
    expect(roleSwitches).toEqual([]);
    expect(
      state.statements.filter((statement) =>
        statement.includes("set_config('app.organisation_id'"),
      ),
    ).toHaveLength(2);
    expect(state.warnings.map((warning) => warning.event)).toEqual([
      "db.tenant_rls.inactive",
    ]);
  });

  it("rejects identifiers that are not organisation UUIDs", async () => {
    await expect(
      withTenant("not-a-uuid", async () => undefined),
    ).rejects.toThrow("withTenant requires an organisation UUID");
  });
});
