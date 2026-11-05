import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteAuditEventsForOrganisations } from "@/server/testing/delete-audit-events";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

type FindingRow = { id: string; organisation_id: string };

run("tenant row-level security with PostgreSQL", () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  const engagementA = randomUUID();
  const engagementB = randomUUID();
  const findingA = randomUUID();
  const findingB = randomUUID();
  const apiOwners: string[] = [];
  let modules: Awaited<ReturnType<typeof load>>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    const { db, schema } = modules;
    await db.insert(schema.organisations).values([
      { id: orgA, slug: `rls-${orgA}`, name: "RLS Tenant A" },
      { id: orgB, slug: `rls-${orgB}`, name: "RLS Tenant B" },
    ]);
    await db.insert(schema.clients).values([
      { id: clientA, organisationId: orgA, name: "RLS Client A" },
      { id: clientB, organisationId: orgB, name: "RLS Client B" },
    ]);
    await db.insert(schema.engagements).values([
      {
        id: engagementA,
        organisationId: orgA,
        clientId: clientA,
        name: "RLS Engagement A",
        reference: "RLS-A",
        type: "Web application",
      },
      {
        id: engagementB,
        organisationId: orgB,
        clientId: clientB,
        name: "RLS Engagement B",
        reference: "RLS-B",
        type: "Web application",
      },
    ]);
    await db.insert(schema.findings).values([
      {
        id: findingA,
        organisationId: orgA,
        engagementId: engagementA,
        identifier: "RLS-A-1",
        title: "Tenant A finding",
        severity: "high",
      },
      {
        id: findingB,
        organisationId: orgB,
        engagementId: engagementB,
        identifier: "RLS-B-1",
        title: "Tenant B finding",
        severity: "low",
      },
    ]);
  });

  afterAll(async () => {
    if (!modules) return;
    // API key creation writes append-only audit rows.
    await deleteAuditEventsForOrganisations(modules.sqlClient, [orgA, orgB]);
    await modules.db
      .delete(modules.schema.organisations)
      .where(modules.inArray(modules.schema.organisations.id, [orgA, orgB]));
    if (apiOwners.length)
      await modules.db
        .delete(modules.schema.users)
        .where(modules.inArray(modules.schema.users.id, apiOwners));
    await modules.sqlClient.end();
  });

  const unfilteredFindingIds = async () => {
    const rows = await modules.db.execute<FindingRow>(
      modules.sql`select id, organisation_id from findings where id in (${findingA}, ${findingB})`,
    );
    return rows.map((row) => row.id).sort();
  };

  it("connects as a superuser that can still assume the tenant role", async () => {
    const [row] = await modules.db.execute<{
      superuser: boolean;
      member: boolean;
    }>(
      modules.sql`select rolsuper as superuser,
        pg_has_role(current_user, 'dingodocs_tenant', 'MEMBER') as member
        from pg_roles where rolname = current_user`,
    );
    // The compose and CI user is a superuser; RLS must still enforce once
    // withTenant switches to dingodocs_tenant.
    expect(row).toMatchObject({ member: true });
    expect(await modules.tenantRoleAvailable()).toBe(true);
  });

  it("restricts unfiltered reads to the scoped organisation", async () => {
    const scoped = await modules.withTenant(orgA, async () => {
      const [identity] = await modules.db.execute<{
        role: string;
        organisation: string;
      }>(
        modules.sql`select current_user as role, current_setting('app.organisation_id', true) as organisation`,
      );
      expect(identity).toEqual({
        role: "dingodocs_tenant",
        organisation: orgA,
      });
      return unfilteredFindingIds();
    });
    expect(scoped).toEqual([findingA]);
    // The query builder through the global db proxy is scoped too.
    const viaBuilder = await modules.withTenant(orgB, () =>
      modules.db
        .select({ id: modules.schema.findings.id })
        .from(modules.schema.findings)
        .where(
          modules.inArray(modules.schema.findings.id, [findingA, findingB]),
        ),
    );
    expect(viaBuilder.map((row) => row.id)).toEqual([findingB]);
  });

  it("rejects writes for another organisation with the WITH CHECK clause", async () => {
    await expect(
      modules.withTenant(orgA, () =>
        modules.db.insert(modules.schema.findings).values({
          organisationId: orgB,
          engagementId: engagementB,
          identifier: `RLS-X-${randomUUID().slice(0, 8)}`,
          title: "Cross-tenant write",
          severity: "critical",
        }),
      ),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "42501" }),
    });
    // Updates cannot reach the other tenant's rows at all.
    const updated = await modules.withTenant(orgA, () =>
      modules.db
        .update(modules.schema.findings)
        .set({ title: "Overwritten" })
        .where(modules.eq(modules.schema.findings.id, findingB))
        .returning({ id: modules.schema.findings.id }),
    );
    expect(updated).toEqual([]);
  });

  it("leaves the owner path outside a scope unrestricted", async () => {
    expect(await unfilteredFindingIds()).toEqual([findingA, findingB].sort());
    const [identity] = await modules.db.execute<{ role: string }>(
      modules.sql`select current_user as role`,
    );
    expect(identity?.role).not.toBe("dingodocs_tenant");
  });

  it("runs nested db.transaction calls as savepoints of the tenant transaction", async () => {
    const identifier = `RLS-N-${randomUUID().slice(0, 8)}`;
    const result = await modules.withTenant(orgA, async (outer) => {
      const inner = await modules.db.transaction(async (tx) => {
        expect(tx).not.toBe(outer);
        const [created] = await tx
          .insert(modules.schema.findings)
          .values({
            organisationId: orgA,
            engagementId: engagementA,
            identifier,
            title: "Nested insert",
            severity: "medium",
          })
          .returning({ id: modules.schema.findings.id });
        // The global db inside the savepoint sees the uncommitted row.
        const seen = await modules.db
          .select({ id: modules.schema.findings.id })
          .from(modules.schema.findings)
          .where(modules.eq(modules.schema.findings.identifier, identifier));
        return { created, seen, ids: await unfilteredFindingIds() };
      });
      // A failed savepoint rolls back on its own and the scope continues.
      await expect(
        modules.db.transaction(async (tx) => {
          await tx.insert(modules.schema.findings).values({
            organisationId: orgB,
            engagementId: engagementB,
            identifier: `${identifier}-B`,
            title: "Denied nested insert",
            severity: "low",
          });
        }),
      ).rejects.toBeTruthy();
      const [role] = await modules.db.execute<{ role: string }>(
        modules.sql`select current_user as role`,
      );
      return { ...inner, role: role?.role };
    });
    expect(result.seen.map((row) => row.id)).toEqual([result.created?.id]);
    expect(result.ids).toEqual([findingA]);
    expect(result.role).toBe("dingodocs_tenant");
    const [persisted] = await modules.db
      .select({ organisationId: modules.schema.findings.organisationId })
      .from(modules.schema.findings)
      .where(modules.eq(modules.schema.findings.identifier, identifier));
    expect(persisted?.organisationId).toBe(orgA);
  });

  it("refuses to nest a scope for a different organisation", async () => {
    await expect(
      modules.withTenant(orgA, () => modules.withTenant(orgB, async () => 1)),
    ).rejects.toBeInstanceOf(modules.TenantScopeMismatchError);
    // Same-organisation nesting is a savepoint and keeps the scope.
    const ids = await modules.withTenant(orgA, () =>
      modules.withTenant(orgA, () => unfilteredFindingIds()),
    );
    expect(ids).toEqual([findingA]);
  });

  // A continuation registered inside the scope keeps the (ended) scope in its
  // AsyncLocalStorage context; the gate releases it after the scope commits.
  const deferInsideScope = async <T>(work: () => Promise<T>) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let deferred!: Promise<T>;
    await modules.withTenant(orgA, async () => {
      deferred = gate.then(work);
    });
    release();
    return deferred;
  };

  it("refuses db use from deferred work after the scope ends", async () => {
    // Falling back to the owner connection here would bypass RLS.
    await expect(
      deferInsideScope(() => unfilteredFindingIds()),
    ).rejects.toBeInstanceOf(modules.TenantScopeEndedError);
    await expect(
      deferInsideScope(() => unfilteredFindingIds()),
    ).rejects.toThrow(
      "Tenant scope has ended; open a new withTenant scope for deferred work",
    );
  });

  it("lets deferred work open a fresh tenant scope explicitly", async () => {
    expect(
      await deferInsideScope(() =>
        modules.withTenant(orgA, () => unfilteredFindingIds()),
      ),
    ).toEqual([findingA]);
    // The fresh scope is independent of the ended one, so it may name any
    // organisation the deferred work was authorised for.
    expect(
      await deferInsideScope(() =>
        modules.withTenant(orgB, () => unfilteredFindingIds()),
      ),
    ).toEqual([findingB]);
    // The deliberate system escape hatch clears the ended scope.
    expect(
      await deferInsideScope(() =>
        modules.withSystemDb(() => unfilteredFindingIds()),
      ),
    ).toEqual([findingA, findingB].sort());
  });

  it("scopes /api/v1 handlers to the API key's organisation", async () => {
    const owner = randomUUID();
    await modules.db.insert(modules.schema.users).values({
      id: owner,
      name: "RLS API owner",
      email: `${owner}@test.invalid`,
      emailVerified: true,
    });
    await modules.db.insert(modules.schema.organisationMembers).values({
      organisationId: orgA,
      userId: owner,
      role: "organisation_owner",
    });
    const { createApiCredential } = await import("@/lib/api/authentication");
    const { GET } = await import("@/app/api/v1/findings/route");
    const key = await createApiCredential(
      { organisationId: orgA, userId: owner },
      {
        name: "RLS route test",
        kind: "personal",
        scopes: ["findings:read"],
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    );
    const response = await GET(
      new Request("https://test.invalid/api/v1/findings?pageSize=100", {
        headers: { authorization: `Bearer ${key.plaintext}` },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ id: string }> };
    const ids = body.data.map((row) => row.id);
    expect(ids).toContain(findingA);
    expect(ids).not.toContain(findingB);
    apiOwners.push(owner);
  });

  it("isolates concurrent scopes for different organisations", async () => {
    const [a, b] = await Promise.all([
      modules.withTenant(orgA, () => unfilteredFindingIds()),
      modules.withTenant(orgB, () => unfilteredFindingIds()),
    ]);
    expect(a).toEqual([findingA]);
    expect(b).toEqual([findingB]);
  });
});

async function load() {
  const [{ db, sqlClient }, schema, tenant, drizzle] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("./tenant"),
    import("drizzle-orm"),
  ]);
  return {
    db,
    sqlClient,
    schema,
    ...tenant,
    sql: drizzle.sql,
    eq: drizzle.eq,
    inArray: drizzle.inArray,
  };
}
