import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("runbooks with PostgreSQL", () => {
  const ids = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    actor: randomUUID(),
    outsider: randomUUID(),
    client: randomUUID(),
    engagement: randomUUID(),
  };
  const actor = { organisationId: ids.orgA, userId: ids.actor };
  let modules: Awaited<ReturnType<typeof load>>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    await modules.db.insert(modules.users).values([
      {
        id: ids.actor,
        name: "Runbook Manager",
        email: `${ids.actor}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.outsider,
        name: "Other Tenant Manager",
        email: `${ids.outsider}@test.invalid`,
        emailVerified: true,
      },
    ]);
    await modules.db.insert(modules.organisations).values([
      { id: ids.orgA, slug: `runbooks-${ids.orgA}`, name: "Runbook Tenant" },
      { id: ids.orgB, slug: `runbooks-${ids.orgB}`, name: "Other Tenant" },
    ]);
    await modules.db.insert(modules.clients).values({
      id: ids.client,
      organisationId: ids.orgA,
      name: "Runbook Client",
    });
    await modules.db.insert(modules.engagements).values({
      id: ids.engagement,
      organisationId: ids.orgA,
      clientId: ids.client,
      name: "Runbook Assessment",
      reference: `RUN-${ids.engagement.slice(0, 8)}`,
      type: "Web Application Assessment",
      status: "testing",
    });
  });

  afterAll(async () => {
    if (!modules) return;
    await modules.db
      .delete(modules.auditEvents)
      .where(
        modules.inArray(modules.auditEvents.organisationId, [
          ids.orgA,
          ids.orgB,
        ]),
      );
    await modules.db
      .delete(modules.organisations)
      .where(modules.inArray(modules.organisations.id, [ids.orgA, ids.orgB]));
    await modules.db
      .delete(modules.users)
      .where(modules.inArray(modules.users.id, [ids.actor, ids.outsider]));
    await modules.sqlClient.end();
  });

  it("publishes, snapshots, executes, and audits a tenant-scoped runbook", async () => {
    const template = await modules.createRunbookTemplate(actor, {
      name: "Web application methodology",
      description: "Repeatable attack surface validation",
      assessmentTypes: ["Web Application Assessment"],
      tags: ["owasp"],
      steps: [
        {
          title: "Map the attack surface",
          objective: "Identify reachable entry points",
          procedure: "Enumerate authenticated and unauthenticated routes.",
          expectedEvidence: "Route inventory",
        },
        {
          title: "Validate access controls",
          procedure: "Test role and tenant boundaries.",
        },
      ],
    });
    const searchActor = {
      ...actor,
      role: "organisation_owner",
    };
    expect(await modules.globalSearch(searchActor, "attack surface")).toEqual([
      expect.objectContaining({
        type: "runbook",
        id: template.id,
        href: "/runbooks",
      }),
    ]);
    expect(
      await modules.globalSearch(
        {
          organisationId: ids.orgB,
          userId: ids.outsider,
          role: "organisation_owner",
        },
        "attack surface",
      ),
    ).toEqual([]);

    await expect(
      modules.publishRunbookTemplate(
        { organisationId: ids.orgB, userId: ids.outsider },
        template.id,
      ),
    ).rejects.toThrow(modules.RunbookScopeError);

    await modules.publishRunbookTemplate(actor, template.id);
    const applied = await modules.applyRunbookTemplate(actor, {
      engagementId: ids.engagement,
      templateId: template.id,
    });
    const [templateStep] = await modules.db
      .select()
      .from(modules.runbookTemplateSteps)
      .where(modules.eq(modules.runbookTemplateSteps.templateId, template.id))
      .orderBy(modules.asc(modules.runbookTemplateSteps.position))
      .limit(1);
    expect(templateStep).toBeDefined();
    await modules.db
      .update(modules.runbookTemplateSteps)
      .set({ title: "Changed after application" })
      .where(modules.eq(modules.runbookTemplateSteps.id, templateStep!.id));

    const [runbook] = await modules.listEngagementRunbooks(
      ids.orgA,
      ids.engagement,
    );
    expect(runbook?.templateName).toBe("Web application methodology");
    expect(runbook?.steps[0]?.title).toBe("Map the attack surface");
    expect(runbook?.steps).toHaveLength(2);

    await expect(
      modules.updateEngagementRunbookStep(actor, {
        engagementId: ids.engagement,
        stepId: runbook!.steps[0]!.id,
        status: "completed",
        findingId: randomUUID(),
      }),
    ).rejects.toThrow(modules.RunbookScopeError);

    for (const step of runbook!.steps) {
      await modules.updateEngagementRunbookStep(actor, {
        engagementId: ids.engagement,
        stepId: step.id,
        status: "completed",
        notes: "Execution evidence reviewed.",
      });
    }

    const [completed] = await modules.listEngagementRunbooks(
      ids.orgA,
      ids.engagement,
    );
    expect(completed?.id).toBe(applied.id);
    expect(completed?.status).toBe("complete");
    expect(completed?.completedAt).toBeInstanceOf(Date);
    expect(
      completed?.steps.every((step) => step.completedBy === ids.actor),
    ).toBe(true);

    const audit = await modules.db
      .select({ action: modules.auditEvents.action })
      .from(modules.auditEvents)
      .where(
        modules.and(
          modules.eq(modules.auditEvents.organisationId, ids.orgA),
          modules.inArray(modules.auditEvents.action, [
            "runbook_template.created",
            "runbook_template.published",
            "engagement_runbook.applied",
            "engagement_runbook_step.updated",
          ]),
        ),
      );
    expect(new Set(audit.map((event) => event.action))).toEqual(
      new Set([
        "runbook_template.created",
        "runbook_template.published",
        "engagement_runbook.applied",
        "engagement_runbook_step.updated",
      ]),
    );
  });
});

async function load() {
  const [{ db, sqlClient }, schema, service, search, drizzle] =
    await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("./runbooks"),
      import("./global-search"),
      import("drizzle-orm"),
    ]);
  return { db, sqlClient, ...schema, ...service, ...search, ...drizzle };
}
