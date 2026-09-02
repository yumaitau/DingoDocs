import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("risk analytics with PostgreSQL", () => {
  const ids = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    clientA: randomUUID(),
    clientB: randomUUID(),
    clientOther: randomUUID(),
    engagementA: randomUUID(),
    engagementB: randomUUID(),
    engagementOther: randomUUID(),
  };
  const now = new Date("2026-09-02T00:00:00Z");
  let modules: Awaited<ReturnType<typeof load>>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    await modules.db.insert(modules.organisations).values([
      { id: ids.orgA, slug: `analytics-${ids.orgA}`, name: "Analytics A" },
      { id: ids.orgB, slug: `analytics-${ids.orgB}`, name: "Analytics B" },
    ]);
    await modules.db.insert(modules.clients).values([
      { id: ids.clientA, organisationId: ids.orgA, name: "Alpha Client" },
      { id: ids.clientB, organisationId: ids.orgA, name: "Beta Client" },
      { id: ids.clientOther, organisationId: ids.orgB, name: "Other Client" },
    ]);
    await modules.db.insert(modules.engagements).values([
      {
        id: ids.engagementA,
        organisationId: ids.orgA,
        clientId: ids.clientA,
        name: "Alpha assessment",
        reference: "AN-A",
        type: "Web application",
      },
      {
        id: ids.engagementB,
        organisationId: ids.orgA,
        clientId: ids.clientB,
        name: "Beta assessment",
        reference: "AN-B",
        type: "API",
      },
      {
        id: ids.engagementOther,
        organisationId: ids.orgB,
        clientId: ids.clientOther,
        name: "Other assessment",
        reference: "AN-X",
        type: "Cloud",
      },
    ]);
    await modules.db.insert(modules.findings).values([
      {
        organisationId: ids.orgA,
        engagementId: ids.engagementA,
        identifier: "AN-001",
        title: "Critical open issue",
        severity: "critical",
        status: "published",
        dueAt: new Date("2026-08-01T00:00:00Z"),
        createdAt: new Date("2026-08-13T00:00:00Z"),
      },
      {
        organisationId: ids.orgA,
        engagementId: ids.engagementA,
        identifier: "AN-002",
        title: "Resolved low issue",
        severity: "low",
        status: "resolved",
        createdAt: new Date("2026-05-25T00:00:00Z"),
      },
      {
        organisationId: ids.orgA,
        engagementId: ids.engagementA,
        identifier: "AN-003",
        title: "Accepted medium issue",
        severity: "medium",
        status: "risk_accepted",
        createdAt: new Date("2026-02-14T00:00:00Z"),
      },
      {
        organisationId: ids.orgA,
        engagementId: ids.engagementB,
        identifier: "AN-004",
        title: "Long-running high issue",
        severity: "high",
        status: "remediation_in_progress",
        createdAt: new Date("2025-07-29T00:00:00Z"),
      },
      {
        organisationId: ids.orgA,
        engagementId: ids.engagementA,
        identifier: "AN-005",
        title: "Draft informational issue",
        severity: "informational",
        status: "draft",
        createdAt: new Date("2025-01-10T00:00:00Z"),
      },
      {
        organisationId: ids.orgA,
        engagementId: ids.engagementB,
        identifier: "AN-006",
        title: "Medium issue under review",
        severity: "medium",
        status: "ready_for_review",
        createdAt: new Date("2025-02-10T00:00:00Z"),
      },
      {
        organisationId: ids.orgB,
        engagementId: ids.engagementOther,
        identifier: "AN-X01",
        title: "Other tenant critical issue",
        severity: "critical",
        status: "published",
        dueAt: new Date("2026-01-01T00:00:00Z"),
        createdAt: new Date("2026-08-20T00:00:00Z"),
      },
    ]);
  });

  afterAll(async () => {
    if (!modules) return;
    await modules.db
      .delete(modules.organisations)
      .where(modules.inArray(modules.organisations.id, [ids.orgA, ids.orgB]));
    await modules.sqlClient.end();
  });

  it("normalizes untrusted URL filters", () => {
    expect(
      modules.parseRiskAnalyticsFilters({
        period: "forever",
        severity: "urgent",
        status: "deleted",
        clientId: "not-a-uuid",
      }),
    ).toEqual({
      period: "all",
      severity: "all",
      status: "open",
      clientId: undefined,
    });
  });

  it("aggregates all workflow states without crossing tenant boundaries", async () => {
    const result = await modules.getRiskAnalytics(
      ids.orgA,
      { period: "all", severity: "all", status: "all" },
      now,
    );

    expect(result.summary).toEqual({
      total: 6,
      highRisk: 2,
      pastDue: 1,
      remediated: 1,
    });
    expect(result.severityCounts).toEqual([
      { key: "informational", label: "Informational", value: 1 },
      { key: "low", label: "Low", value: 1 },
      { key: "medium", label: "Medium", value: 2 },
      { key: "high", label: "High", value: 1 },
      { key: "critical", label: "Critical", value: 1 },
    ]);
    expect(result.workflowCounts).toEqual([
      { key: "authoring", label: "Authoring", value: 1 },
      { key: "review", label: "Review and QA", value: 1 },
      { key: "remediation", label: "Remediation", value: 2 },
      { key: "risk_accepted", label: "Risk accepted", value: 1 },
      { key: "closed", label: "Resolved or closed", value: 1 },
    ]);
    expect(result.clients.map((client) => client.name)).toEqual([
      "Alpha Client",
      "Beta Client",
    ]);
    expect(result.findings).not.toContainEqual(
      expect.objectContaining({ title: "Other tenant critical issue" }),
    );
  });

  it("applies time, workflow, severity, and client filters", async () => {
    const recentOpen = await modules.getRiskAnalytics(
      ids.orgA,
      modules.parseRiskAnalyticsFilters({ period: "180" }),
      now,
    );
    expect(recentOpen.findings.map((finding) => finding.identifier)).toEqual([
      "AN-001",
    ]);

    const client = await modules.getRiskAnalytics(
      ids.orgA,
      {
        period: "all",
        severity: "high",
        status: "open",
        clientId: ids.clientB,
      },
      now,
    );
    expect(client.summary.total).toBe(1);
    expect(client.clients).toEqual([
      expect.objectContaining({ name: "Beta Client", highRisk: 1 }),
    ]);
  });
});

async function load() {
  const [{ db, sqlClient }, schema, analytics, { inArray }] = await Promise.all(
    [
      import("@/db"),
      import("@/db/schema"),
      import("./analytics"),
      import("drizzle-orm"),
    ],
  );
  return { db, sqlClient, inArray, ...schema, ...analytics };
}
