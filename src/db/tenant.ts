import { sql } from "drizzle-orm";
import { structuredLog } from "@/lib/observability/logger";
import {
  activeTenantScope,
  db,
  tenantScopeStorage,
  type DatabaseTransaction,
  type TenantScope,
} from "./index";

/** NOLOGIN role created by migration 0016; subject to tenant_isolation. */
export const TENANT_ROLE = "dingodocs_tenant";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TenantScopeMismatchError extends Error {
  constructor() {
    super("A tenant scope for another organisation is already active");
    this.name = "TenantScopeMismatchError";
  }
}

let roleCheck: Promise<boolean> | undefined;

/**
 * Whether this connection user can `SET ROLE dingodocs_tenant`. Checked once
 * per process. Without the role (managed Postgres where the migrator lacked
 * CREATEROLE) withTenant still sets app.organisation_id but RLS stays inert,
 * and isolation rests on the application's tenant predicates.
 */
export function tenantRoleAvailable() {
  roleCheck ??= checkTenantRole().catch((error: unknown) => {
    // Retry on the next call; a transient error must not disable RLS.
    roleCheck = undefined;
    throw error;
  });
  return roleCheck;
}

class RoleProbeRollback extends Error {}

async function checkTenantRole() {
  const [row] = await db.execute<{ member: boolean }>(
    sql`select exists (
      select 1 from pg_roles
      where rolname = ${TENANT_ROLE}
        and pg_has_role(current_user, oid, 'MEMBER')
    ) as member`,
  );
  let reason = "role is missing or not granted to the connecting user";
  if (row?.member === true) {
    // PostgreSQL 16 memberships can withhold SET; probe it and roll back.
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`set local role ${TENANT_ROLE}`));
        throw new RoleProbeRollback();
      });
    } catch (error) {
      if (error instanceof RoleProbeRollback) return true;
      reason = "connecting user cannot SET ROLE to it";
    }
  }
  structuredLog("warn", "db.tenant_rls.inactive", {
    role: TENANT_ROLE,
    reason: `${reason}; tenant row-level security is not enforced`,
  });
  return false;
}

/** Test hook: forget the cached role check. */
export function resetTenantRoleCheck() {
  roleCheck = undefined;
}

/**
 * Runs `fn` in a transaction scoped to one organisation. When the tenant role
 * is available the transaction runs as `dingodocs_tenant`, so the
 * tenant_isolation policies restrict every read and write to
 * `organisationId`. The global `db` resolves to this transaction for
 * everything `fn` awaits, and `db.transaction()` inside it is a savepoint.
 *
 * Keep the scope short: it holds a pooled connection and an open transaction
 * until `fn` settles. Do outbound network calls (webhooks, AI, storage)
 * outside it or in a background job.
 *
 * Nested calls for the same organisation run in a savepoint of the open
 * transaction; a call for a different organisation throws rather than
 * widening access.
 */
export async function withTenant<T>(
  organisationId: string,
  fn: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  if (!uuidPattern.test(organisationId))
    throw new Error("withTenant requires an organisation UUID");
  const current = activeTenantScope();
  if (current) {
    if (current.organisationId !== organisationId)
      throw new TenantScopeMismatchError();
    return db.transaction(fn);
  }
  const enforce = await tenantRoleAvailable();
  return db.transaction(async (tx) => {
    // set_config('role', ..., true) is SET LOCAL ROLE; one round trip sets
    // both. Both revert when the transaction ends, so a pooled connection
    // never carries the tenant role or organisation into the next request.
    await tx.execute(
      enforce
        ? sql`select set_config('role', ${TENANT_ROLE}, true), set_config('app.organisation_id', ${organisationId}, true)`
        : sql`select set_config('app.organisation_id', ${organisationId}, true)`,
    );
    const scope: TenantScope = { organisationId, tx, active: true };
    try {
      return await tenantScopeStorage.run(scope, () => fn(tx));
    } finally {
      scope.active = false;
    }
  });
}

/** The organisation of the active tenant scope, if any. */
export function currentTenantOrganisationId() {
  return activeTenantScope()?.organisationId;
}

/**
 * For best-effort work whose failure the caller swallows. Inside a tenant
 * scope a failed statement aborts the whole transaction (postgres-js then
 * fails the scope), so run the work in a savepoint that rolls back on its
 * own. Outside a scope the work runs as-is on the owner connection.
 */
export function savepointIfScoped<T>(work: () => Promise<T>): Promise<T> {
  return activeTenantScope() ? db.transaction(() => work()) : work();
}
