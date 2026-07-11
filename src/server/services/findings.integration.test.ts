import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("finding library and workflow with PostgreSQL", () => {
  const ids = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    author: randomUUID(),
    reviewer: randomUUID(),
    qa: randomUUID(),
    outsider: randomUUID(),
    client: randomUUID(),
    engagement: randomUUID(),
    asset: randomUUID(),
    evidence: randomUUID(),
  };
  const author = { organisationId: ids.orgA, userId: ids.author };
  const reviewer = { organisationId: ids.orgA, userId: ids.reviewer };
  const qa = { organisationId: ids.orgA, userId: ids.qa };
  let modules: Awaited<ReturnType<typeof load>>;
  let templateId: string;
  let findingId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    await modules.db.insert(modules.users).values([
      {
        id: ids.author,
        name: "Finding Author",
        email: `${ids.author}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.reviewer,
        name: "Peer Reviewer",
        email: `${ids.reviewer}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.qa,
        name: "QA Reviewer",
        email: `${ids.qa}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.outsider,
        name: "Tenant Outsider",
        email: `${ids.outsider}@test.invalid`,
        emailVerified: true,
      },
    ]);
    await modules.db.insert(modules.organisations).values([
      { id: ids.orgA, slug: `findings-${ids.orgA}`, name: "Findings Tenant" },
      {
        id: ids.orgB,
        slug: `findings-${ids.orgB}`,
        name: "Other Findings Tenant",
      },
    ]);
    await modules.db.insert(modules.clients).values({
      id: ids.client,
      organisationId: ids.orgA,
      name: "Findings Client",
    });
    await modules.db.insert(modules.engagements).values({
      id: ids.engagement,
      organisationId: ids.orgA,
      clientId: ids.client,
      name: "Findings Assessment",
      reference: `FND-${ids.engagement.slice(0, 8)}`,
      type: "Web Application",
    });
    await modules.db.insert(modules.assets).values({
      id: ids.asset,
      organisationId: ids.orgA,
      engagementId: ids.engagement,
      name: "Customer portal",
      type: "application",
      identifier: "portal.findings.test",
    });
    await modules.db.insert(modules.evidence).values({
      id: ids.evidence,
      organisationId: ids.orgA,
      clientId: ids.client,
      engagementId: ids.engagement,
      originalFilename: "finding-proof.png",
      storageProvider: "local",
      storageKey: `${ids.orgA}/${ids.engagement}/proof.png`,
      mediaType: "image/png",
      sizeBytes: 68,
      sha256: "a".repeat(64),
      uploadedBy: ids.author,
      classification: "internal",
      malwareScanStatus: "clean",
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
      .where(
        modules.inArray(modules.users.id, [
          ids.author,
          ids.reviewer,
          ids.qa,
          ids.outsider,
        ]),
      );
    await modules.sqlClient.end();
  });

  it("authors, maps, reviews, versions, and searches templates", async () => {
    const template = await modules.createFindingTemplate(author, {
      stableKey: "broken-access-control",
      title: "Broken access control",
      summary: "Authorisation checks can be bypassed.",
      technicalDescription:
        "A user can request another tenant's object identifier.",
      businessImpact: "Confidential information may be disclosed.",
      severity: "high",
      remediation: "Enforce object-level authorisation on every request.",
      tags: ["access-control", "multi-tenant"],
      assessmentTypes: ["web"],
      mappings: [
        {
          framework: "CWE",
          reference: "CWE-639",
          title: "Authorization Bypass Through User-Controlled Key",
        },
        { framework: "OWASP", reference: "A01:2021" },
      ],
    });
    templateId = template!.id;
    await modules.transitionTemplateReview(reviewer, {
      templateId,
      toStatus: "in_review",
    });
    const approved = await modules.transitionTemplateReview(reviewer, {
      templateId,
      toStatus: "approved",
    });
    expect(approved).toMatchObject({ reviewStatus: "approved", version: 1 });
    const matches = await modules.searchFindingTemplates(
      ids.orgA,
      "CWE-639",
      true,
    );
    expect(matches.map((item) => item.id)).toContain(templateId);
    expect(
      await modules.searchFindingTemplates(ids.orgB, "access control"),
    ).toHaveLength(0);
  });

  it("snapshots templates, compares explicit revisions, and versions authoring", async () => {
    const finding = await modules.createFindingFromTemplate(author, {
      engagementId: ids.engagement,
      templateId,
      identifier: "F-001",
      assetIds: [ids.asset],
    });
    findingId = finding.id;
    expect(finding.templateSnapshot).toMatchObject({
      summary: "Authorisation checks can be bypassed.",
    });
    const revision = await modules.reviseFindingTemplate(author, templateId, {
      summary:
        "Object authorisation checks can be bypassed across tenant boundaries.",
      remediation:
        "Use a central policy layer and deny cross-tenant identifiers.",
    });
    await modules.transitionTemplateReview(reviewer, {
      templateId: revision!.id,
      toStatus: "in_review",
    });
    await modules.transitionTemplateReview(reviewer, {
      templateId: revision!.id,
      toStatus: "approved",
    });
    const before = await modules.getEngagementFindings(
      ids.orgA,
      ids.engagement,
    );
    expect(before[0]?.executiveSummary).toBe(
      "Authorisation checks can be bypassed.",
    );
    const comparison = await modules.compareFindingTemplate(author, findingId);
    expect(comparison?.changes.map((change) => change.field)).toEqual(
      expect.arrayContaining(["summary", "remediation"]),
    );
    const updated = await modules.updateFindingFromLatestTemplate(
      author,
      findingId,
    );
    expect(updated).toMatchObject({
      templateVersion: 2,
      remediation:
        "Use a central policy layer and deny cross-tenant identifiers.",
    });
    const narrative = await modules.updateFindingNarrative(author, {
      findingId,
      title: "Broken object-level authorisation",
      severity: "critical",
      likelihood: "likely",
      impact: "major",
      cvssVector:
        "CVSS:4.0/AV:N/AC:L/AT:N/PR:L/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N",
      cvssScore: "9.3",
      executiveSummary: "A user can retrieve another tenant's records.",
      technicalDetail: "The object lookup is not scoped by tenant.",
      reproductionSteps: "Sign in, then replace the object identifier.",
      proofOfConcept: "GET /objects/other-tenant-id",
      businessImpact: "Cross-tenant disclosure.",
      technicalImpact: "Confidentiality and integrity loss.",
      remediation: "Scope every lookup to the active tenant.",
      verificationGuidance: "Repeat with identifiers from a separate tenant.",
      references: ["https://cwe.mitre.org/data/definitions/639.html"],
      mappings: [{ framework: "CWE", reference: "CWE-639" }],
      clientOwner: "Application Security",
      dueAt: new Date("2030-03-01T00:00:00.000Z"),
      changeSummary: "Add assessment-specific reproduction and scoring",
    });
    expect(narrative).toMatchObject({ cvssScore: "9.3", version: 3 });
    await modules.linkFindingEvidence(author, {
      findingId,
      evidenceIds: [ids.evidence],
    });
    await modules.addFindingComment(reviewer, {
      findingId,
      body: "Reproduced independently.",
      visibility: "team",
    });
    const enriched = await modules.getEngagementFindings(
      ids.orgA,
      ids.engagement,
    );
    expect(enriched[0]?.assetIds).toContain(ids.asset);
    expect(enriched[0]?.evidenceIds).toContain(ids.evidence);
    expect(enriched[0]?.comments[0]?.body).toBe("Reproduced independently.");
  });

  it("enforces independent peer review, QA, approval versions, and audited overrides", async () => {
    await modules.transitionFinding(author, {
      findingId,
      toStatus: "ready_for_review",
    });
    await expect(
      modules.transitionFinding(author, {
        findingId,
        toStatus: "peer_reviewed",
      }),
    ).rejects.toThrow("author cannot");
    await modules.transitionFinding(reviewer, {
      findingId,
      toStatus: "peer_reviewed",
      comment: "Peer review complete",
    });
    await expect(
      modules.transitionFinding(reviewer, {
        findingId,
        toStatus: "qa_approved",
      }),
    ).rejects.toThrow("different reviewer");
    const approved = await modules.transitionFinding(qa, {
      findingId,
      toStatus: "qa_approved",
      comment: "QA checks complete",
    });
    expect(approved?.approvedVersion).toBe(3);
    await modules.transitionFinding(qa, { findingId, toStatus: "published" });

    const overrideFinding = await modules.createFindingFromTemplate(author, {
      engagementId: ids.engagement,
      templateId: (
        await modules.searchFindingTemplates(
          ids.orgA,
          "broken-access-control",
          true,
        )
      )[0]!.id,
      identifier: "F-002",
    });
    await expect(
      modules.transitionFinding(qa, {
        findingId: overrideFinding.id,
        toStatus: "published",
        canOverride: true,
      }),
    ).rejects.toThrow("reason");
    await modules.transitionFinding(qa, {
      findingId: overrideFinding.id,
      toStatus: "published",
      canOverride: true,
      overrideReason:
        "Emergency client disclosure approved by the engagement manager",
    });
    const [audit] = await modules.db
      .select()
      .from(modules.auditEvents)
      .where(
        modules.and(
          modules.eq(
            modules.auditEvents.action,
            "finding.transition.overridden",
          ),
          modules.eq(modules.auditEvents.targetId, overrideFinding.id),
        ),
      );
    expect(audit?.metadata).toMatchObject({
      overrideReason:
        "Emergency client disclosure approved by the engagement manager",
    });
  });

  it("validates accessible organisation/client risk matrices and tenant isolation", async () => {
    const matrix = await modules.createRiskMatrix(author, {
      clientId: ids.client,
      name: "Client risk",
      isDefault: true,
      definition: {
        likelihood: [{ key: "likely", label: "Likely", order: 1 }],
        impact: [{ key: "major", label: "Major", order: 1 }],
        ratings: [
          {
            likelihood: "likely",
            impact: "major",
            severity: "high",
            label: "High",
            colour: "#dc2626",
          },
        ],
      },
    });
    expect(matrix).toMatchObject({
      clientId: ids.client,
      version: 1,
      isDefault: true,
    });
    await expect(
      modules.createRiskMatrix(author, {
        name: "Invalid",
        definition: {
          likelihood: [{ key: "likely", label: "", order: 1 }],
          impact: [{ key: "major", label: "Major", order: 1 }],
          ratings: [],
        },
      }),
    ).rejects.toThrow("accessible text labels");
    await expect(
      modules.createFindingFromTemplate(
        { organisationId: ids.orgB, userId: ids.outsider },
        { engagementId: ids.engagement, templateId, identifier: "FORBIDDEN" },
      ),
    ).rejects.toBeInstanceOf(modules.FindingScopeError);
    expect(
      await modules.getEngagementFindings(ids.orgB, ids.engagement),
    ).toHaveLength(0);
    await expect(
      modules.assertFindingEngagement(ids.orgA, randomUUID(), findingId),
    ).rejects.toBeInstanceOf(modules.FindingScopeError);
  });
});

async function load() {
  const [{ db, sqlClient }, schema, service, drizzle] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("./findings"),
    import("drizzle-orm"),
  ]);
  return { db, sqlClient, ...schema, ...service, ...drizzle };
}
