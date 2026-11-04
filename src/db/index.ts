import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

const globalForDatabase = globalThis as unknown as {
  sqlClient?: ReturnType<typeof postgres>;
};
const sqlClient =
  globalForDatabase.sqlClient ??
  postgres(
    connectionString ?? "postgres://invalid:invalid@127.0.0.1:5432/invalid",
    {
      max: process.env.NODE_ENV === "production" ? 20 : 5,
      idle_timeout: 30,
      connect_timeout: 10,
      prepare: false,
    },
  );

if (process.env.NODE_ENV !== "production")
  globalForDatabase.sqlClient = sqlClient;

const rootDb = drizzle(sqlClient, { schema });
export type Database = typeof rootDb;
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

/**
 * The tenant transaction a withTenant() scope (src/db/tenant.ts) is running.
 * `active` turns false when the scope ends, so callbacks that outlive it
 * (timers, after()) fall back to the owner connection instead of issuing
 * queries on a connection that has gone back to the pool.
 */
export type TenantScope = {
  readonly organisationId: string;
  readonly tx: DatabaseTransaction;
  active: boolean;
};

// One instance per process, even if bundling loads this module more than once
// (Next.js server layers), so every copy of `db` sees the same scope.
const storageKey = Symbol.for("dingodocs.db.tenantScope");
const globalStorage = globalThis as unknown as {
  [storageKey]?: AsyncLocalStorage<TenantScope>;
};
export const tenantScopeStorage = (globalStorage[storageKey] ??=
  new AsyncLocalStorage<TenantScope>());

export function activeTenantScope() {
  const scope = tenantScopeStorage.getStore();
  return scope?.active ? scope : undefined;
}

/**
 * `db` is the root (owner) database outside a tenant scope and the tenant
 * transaction inside one, so existing `db.select()` calls pick up RLS without
 * threading `tx` through every service. A nested `db.transaction()` inside a
 * scope becomes a savepoint, and code in its callback that uses `db` runs in
 * that savepoint too.
 */
export const db: Database = new Proxy(rootDb, {
  get(target, property) {
    const scope = activeTenantScope();
    if (!scope) {
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
    if (property === "transaction") {
      return <T>(callback: (tx: DatabaseTransaction) => Promise<T>) =>
        scope.tx.transaction((nested) => {
          const nestedScope: TenantScope = { ...scope, tx: nested };
          return tenantScopeStorage
            .run(nestedScope, () => callback(nested))
            .finally(() => {
              nestedScope.active = false;
            });
        });
    }
    const value = Reflect.get(scope.tx, property, scope.tx);
    return typeof value === "function" ? value.bind(scope.tx) : value;
  },
});

export { schema, sqlClient };
