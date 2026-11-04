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
 * `active` turns false when the scope ends. AsyncLocalStorage still hands the
 * ended scope to callbacks created inside it (timers, after(), un-awaited
 * promises), and those must not silently fall back to the unrestricted owner
 * connection, so `db` throws TenantScopeEndedError for them instead.
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

export class TenantScopeEndedError extends Error {
  constructor() {
    super(
      "Tenant scope has ended; open a new withTenant scope for deferred work",
    );
    this.name = "TenantScopeEndedError";
  }
}

/**
 * The scope state for the current async context:
 * - `none`: no tenant scope was ever entered (genuine system work, owner
 *   connection);
 * - `active`: inside a live withTenant() scope;
 * - `ended`: work started inside a scope that has since finished.
 */
export function tenantScopeState():
  | { state: "none" }
  | { state: "active"; scope: TenantScope }
  | { state: "ended"; scope: TenantScope } {
  const scope = tenantScopeStorage.getStore();
  if (!scope) return { state: "none" };
  return scope.active ? { state: "active", scope } : { state: "ended", scope };
}

/** The live tenant scope, or undefined when none is active (ended or absent). */
export function activeTenantScope() {
  const current = tenantScopeState();
  return current.state === "active" ? current.scope : undefined;
}

/**
 * Runs `fn` with no tenant scope at all, so `db` is the owner connection even
 * when called from deferred work that outlived a scope. Only for tables
 * without row-level security (auth, membership, audit, jobs); tenant content
 * must go through withTenant(). Every call site needs a comment saying why.
 */
export function withSystemDb<T>(fn: () => T): T {
  return tenantScopeStorage.exit(fn);
}

/**
 * `db` is the root (owner) database outside a tenant scope and the tenant
 * transaction inside one, so existing `db.select()` calls pick up RLS without
 * threading `tx` through every service. A nested `db.transaction()` inside a
 * scope becomes a savepoint, and code in its callback that uses `db` runs in
 * that savepoint too. Use after a scope has ended throws
 * TenantScopeEndedError rather than widening to the owner connection.
 */
export const db: Database = new Proxy(rootDb, {
  get(target, property) {
    const current = tenantScopeState();
    if (current.state === "none") {
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
    if (current.state === "ended") throw new TenantScopeEndedError();
    const { scope } = current;
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
