import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("tenant isolation with PostgreSQL", () => {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const clientA = randomUUID();
  let modules: Awaited<ReturnType<typeof load>>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    await modules.db.insert(modules.organisations).values([
      { id: orgA, slug: `test-${orgA}`, name: "Tenant A" },
      { id: orgB, slug: `test-${orgB}`, name: "Tenant B" },
    ]);
    await modules.db
      .insert(modules.clients)
      .values({ id: clientA, organisationId: orgA, name: "Tenant A Client" });
  });

  afterAll(async () => {
    if (!modules) return;
    await modules.db
      .delete(modules.organisations)
      .where(modules.inArray(modules.organisations.id, [orgA, orgB]));
    await modules.sqlClient.end();
  });

  it("never returns a record through another organisation scope", async () => {
    expect(
      await modules.getClient({ organisationId: orgA }, clientA),
    ).toMatchObject({ id: clientA, organisationId: orgA });
    expect(
      await modules.getClient({ organisationId: orgB }, clientA),
    ).toBeNull();
  });
});

async function load() {
  const [{ db, sqlClient }, schema, repository, drizzle] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("./tenant"),
    import("drizzle-orm"),
  ]);
  return { db, sqlClient, ...schema, ...repository, ...drizzle };
}
