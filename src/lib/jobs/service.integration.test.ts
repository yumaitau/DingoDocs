import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("background job lease reclaim and fencing", () => {
  const jobIds = [randomUUID(), randomUUID(), randomUUID()];
  let modules: Awaited<ReturnType<typeof load>>;

  // created_at far in the past so `order by created_at limit 1` picks ours.
  const insertStaleRunning = (id: string, attempts: number) =>
    modules.db.insert(modules.backgroundJobs).values({
      id,
      type: "health.noop",
      status: "running",
      payload: {},
      attempts,
      maxAttempts: 3,
      lockedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      createdAt: new Date("1970-01-01T00:00:00Z"),
    });
  // Ready decoy so claims in this test never touch other suites' jobs.
  const insertDecoy = (id: string) =>
    modules.db.insert(modules.backgroundJobs).values({
      id,
      type: "health.noop",
      payload: {},
      createdAt: new Date("1970-01-01T00:00:01Z"),
    });
  const job = async (id: string) =>
    (
      await modules.db
        .select()
        .from(modules.backgroundJobs)
        .where(modules.eq(modules.backgroundJobs.id, id))
    )[0]!;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
  });

  afterAll(async () => {
    if (!modules) return;
    await modules.db
      .delete(modules.backgroundJobs)
      .where(modules.inArray(modules.backgroundJobs.id, jobIds));
    await modules.sqlClient.end();
  });

  it("reclaims an expired running job and fences the late original worker", async () => {
    await insertStaleRunning(jobIds[0]!, 1);
    await insertDecoy(jobIds[2]!);
    // The original (crashed/slow) worker holds the old locked_at as token.
    const [{ token }] = await modules.sqlClient<{ token: string }[]>`
      select locked_at::text as token from background_jobs where id = ${jobIds[0]!}
    `;
    const original = {
      id: jobIds[0]!,
      lock_token: token!,
      attempts: 1,
      max_attempts: 3,
    };

    const [reclaimed] = await modules.claimJobs(1);
    expect(reclaimed).toMatchObject({ id: jobIds[0], attempts: 2 });
    expect(reclaimed!.lock_token).not.toBe(token);

    // A second claim must not steal the fresh lease (it takes the decoy).
    expect((await modules.claimJobs(1)).map((row) => row.id)).not.toContain(
      jobIds[0],
    );

    await expect(modules.completeJob(original)).resolves.toBe(false);
    await expect(modules.failJob(original, "late")).resolves.toMatchObject({
      applied: false,
    });
    expect(await job(jobIds[0]!)).toMatchObject({
      status: "running",
      attempts: 2,
      lastError: null,
    });

    await expect(modules.completeJob(reclaimed!)).resolves.toBe(true);
    expect((await job(jobIds[0]!)).status).toBe("completed");
  });

  it("dead-letters an expired running job that used its final attempt", async () => {
    await insertStaleRunning(jobIds[1]!, 3);
    // limit 0: only the dead-letter sweep runs; no other jobs are claimed.
    await modules.claimJobs(0);
    expect(await job(jobIds[1]!)).toMatchObject({
      status: "dead_letter",
      attempts: 3,
    });
  });
});

async function load() {
  const [{ db, sqlClient }, schema, service, drizzle] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("./service"),
    import("drizzle-orm"),
  ]);
  return { db, sqlClient, ...schema, ...service, ...drizzle };
}
