import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReportTemplateDefinition } from "@/db/schema";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("restricted client portal and retest lifecycle with PostgreSQL", () => {
  const ids = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    clientUser: randomUUID(),
    tester: randomUUID(),
    outsider: randomUUID(),
    clientA: randomUUID(),
    clientB: randomUUID(),
    clientOtherOrg: randomUUID(),
    engagementA: randomUUID(),
    engagementB: randomUUID(),
    engagementOtherOrg: randomUUID(),
    contactA: randomUUID(),
    contactB: randomUUID(),
    scopeApproved: randomUUID(),
    scopeDraft: randomUUID(),
    findingVisible: randomUUID(),
    findingHidden: randomUUID(),
    findingDraft: randomUUID(),
    evidenceVisible: randomUUID(),
    evidenceInternal: randomUUID(),
    evidenceRestricted: randomUUID(),
    reportTemplate: randomUUID(),
    reportReview: randomUUID(),
    reportReviewVersion: randomUUID(),
    reportPublished: randomUUID(),
    reportPublishedVersion: randomUUID(),
    reportInternal: randomUUID(),
    reportInternalVersion: randomUUID(),
  };
  const clientActor = {
    organisationId: ids.orgA,
    userId: ids.clientUser,
  };
  const testerActor = { organisationId: ids.orgA, userId: ids.tester };
  let modules: Awaited<ReturnType<typeof load>>;
  let attemptId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    await modules.db.insert(modules.users).values([
      {
        id: ids.clientUser,
        name: "Portal Client",
        email: `${ids.clientUser}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.tester,
        name: "Retest Consultant",
        email: `${ids.tester}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.outsider,
        name: "Other Tenant User",
        email: `${ids.outsider}@test.invalid`,
        emailVerified: true,
      },
    ]);
    await modules.db.insert(modules.organisations).values([
      { id: ids.orgA, slug: `portal-${ids.orgA}`, name: "Portal Tenant" },
      { id: ids.orgB, slug: `portal-${ids.orgB}`, name: "Other Tenant" },
    ]);
    await modules.db.insert(modules.organisationMembers).values([
      {
        organisationId: ids.orgA,
        userId: ids.clientUser,
        role: "client_user",
      },
      {
        organisationId: ids.orgA,
        userId: ids.tester,
        role: "lead_consultant",
      },
      {
        organisationId: ids.orgB,
        userId: ids.outsider,
        role: "client_user",
      },
    ]);
    await modules.db.insert(modules.clients).values([
      { id: ids.clientA, organisationId: ids.orgA, name: "Authorised Client" },
      { id: ids.clientB, organisationId: ids.orgA, name: "Sibling Client" },
      {
        id: ids.clientOtherOrg,
        organisationId: ids.orgB,
        name: "Other Organisation Client",
      },
    ]);
    await modules.db.insert(modules.engagements).values([
      {
        id: ids.engagementA,
        organisationId: ids.orgA,
        clientId: ids.clientA,
        name: "Authorised assessment",
        reference: `CPA-${ids.engagementA.slice(0, 8)}`,
        type: "Web application",
      },
      {
        id: ids.engagementB,
        organisationId: ids.orgA,
        clientId: ids.clientB,
        name: "Sibling client assessment",
        reference: `CPB-${ids.engagementB.slice(0, 8)}`,
        type: "Cloud",
      },
      {
        id: ids.engagementOtherOrg,
        organisationId: ids.orgB,
        clientId: ids.clientOtherOrg,
        name: "Other organisation assessment",
        reference: `CPO-${ids.engagementOtherOrg.slice(0, 8)}`,
        type: "API",
      },
    ]);
    await modules.db.insert(modules.clientContacts).values([
      {
        id: ids.contactA,
        organisationId: ids.orgA,
        clientId: ids.clientA,
        userId: ids.clientUser,
        name: "Portal Client",
        email: `${ids.clientUser}@test.invalid`,
      },
      {
        id: ids.contactB,
        organisationId: ids.orgA,
        clientId: ids.clientB,
        userId: ids.outsider,
        name: "Sibling Client User",
        email: `${ids.outsider}@test.invalid`,
      },
    ]);
    await modules.db.insert(modules.engagementContacts).values({
      organisationId: ids.orgA,
      engagementId: ids.engagementA,
      contactId: ids.contactA,
    });
    await modules.db.insert(modules.scopeVersions).values([
      {
        id: ids.scopeApproved,
        organisationId: ids.orgA,
        engagementId: ids.engagementA,
        version: 1,
        status: "approved",
        approvedBy: ids.tester,
        approvedAt: new Date(),
        createdBy: ids.tester,
      },
      {
        id: ids.scopeDraft,
        organisationId: ids.orgA,
        engagementId: ids.engagementA,
        version: 2,
        status: "draft",
        createdBy: ids.tester,
      },
    ]);
    await modules.db.insert(modules.scopeItems).values([
      {
        organisationId: ids.orgA,
        engagementId: ids.engagementA,
        scopeVersionId: ids.scopeApproved,
        name: "Published target",
        type: "application",
        value: "portal.example.test",
      },
      {
        organisationId: ids.orgA,
        engagementId: ids.engagementA,
        scopeVersionId: ids.scopeDraft,
        name: "Draft secret target",
        type: "host",
        value: "internal-only.example.test",
      },
    ]);
    await modules.db.insert(modules.findings).values([
      {
        id: ids.findingVisible,
        organisationId: ids.orgA,
        engagementId: ids.engagementA,
        identifier: "F-001",
        title: "Published portal finding",
        status: "published",
        severity: "high",
        executiveSummary: "A client-safe summary.",
        technicalDetail: "Internal exploit detail must not be selected.",
        remediation: "Apply object-level authorisation.",
        authorId: ids.tester,
        clientVisible: true,
        publishedAt: new Date(),
      },
      {
        id: ids.findingHidden,
        organisationId: ids.orgA,
        engagementId: ids.engagementA,
        identifier: "F-002",
        title: "Published but withheld finding",
        status: "published",
        severity: "critical",
        clientVisible: false,
        publishedAt: new Date(),
      },
      {
        id: ids.findingDraft,
        organisationId: ids.orgA,
        engagementId: ids.engagementA,
        identifier: "F-003",
        title: "Draft accidentally flagged visible",
        status: "draft",
        severity: "medium",
        clientVisible: true,
      },
    ]);
    await modules.db
      .insert(modules.evidence)
      .values([
        evidenceRow(ids.evidenceVisible, "shared.txt", "client_visible"),
        evidenceRow(ids.evidenceInternal, "internal.txt", "internal"),
        evidenceRow(ids.evidenceRestricted, "restricted.txt", "restricted"),
      ]);
    await modules.db.insert(modules.comments).values([
      {
        organisationId: ids.orgA,
        targetType: "finding",
        targetId: ids.findingVisible,
        body: "Safe client comment",
        visibility: "client",
        authorId: ids.clientUser,
      },
      {
        organisationId: ids.orgA,
        targetType: "finding",
        targetId: ids.findingVisible,
        body: "Internal QA comment",
        visibility: "team",
        authorId: ids.tester,
      },
    ]);
    await modules.db.insert(modules.reportTemplates).values({
      id: ids.reportTemplate,
      organisationId: ids.orgA,
      clientId: ids.clientA,
      name: "Portal report template",
      definition: reportDefinition(),
      createdBy: ids.tester,
    });
    await modules.db.insert(modules.reports).values([
      {
        id: ids.reportReview,
        organisationId: ids.orgA,
        clientId: ids.clientA,
        engagementId: ids.engagementA,
        templateId: ids.reportTemplate,
        templateVersion: 1,
        title: "Client review draft",
        status: "client_review",
        currentVersion: 1,
        createdBy: ids.tester,
      },
      {
        id: ids.reportPublished,
        organisationId: ids.orgA,
        clientId: ids.clientA,
        engagementId: ids.engagementA,
        templateId: ids.reportTemplate,
        templateVersion: 1,
        title: "Published report",
        status: "published",
        currentVersion: 1,
        createdBy: ids.tester,
      },
      {
        id: ids.reportInternal,
        organisationId: ids.orgA,
        clientId: ids.clientA,
        engagementId: ids.engagementA,
        templateId: ids.reportTemplate,
        templateVersion: 1,
        title: "Internal report",
        status: "internal_review",
        currentVersion: 1,
        createdBy: ids.tester,
      },
    ]);
    await modules.db.insert(modules.reportVersions).values([
      {
        id: ids.reportReviewVersion,
        organisationId: ids.orgA,
        reportId: ids.reportReview,
        version: 1,
        status: "client_review",
        content: { classification: "client review" },
        clientVisible: true,
        createdBy: ids.tester,
      },
      {
        id: ids.reportPublishedVersion,
        organisationId: ids.orgA,
        reportId: ids.reportPublished,
        version: 1,
        status: "published",
        content: { classification: "published" },
        immutable: true,
        clientVisible: true,
        publishedAt: new Date(),
        createdBy: ids.tester,
      },
      {
        id: ids.reportInternalVersion,
        organisationId: ids.orgA,
        reportId: ids.reportInternal,
        version: 1,
        status: "internal_review",
        content: { secret: "internal QA" },
        clientVisible: false,
        createdBy: ids.tester,
      },
    ]);
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
          ids.clientUser,
          ids.tester,
          ids.outsider,
        ]),
      );
    await modules.sqlClient.end();
  });

  it("returns only explicitly authorised and published client-safe records", async () => {
    const list = await modules.listPortalEngagements(clientActor);
    expect(list.map((item) => item.id)).toEqual([ids.engagementA]);
    const portal = await modules.getPortalEngagement(
      clientActor,
      ids.engagementA,
    );
    expect(portal.scope.map((item) => item.value)).toEqual([
      "portal.example.test",
    ]);
    expect(portal.findings.map((item) => item.id)).toEqual([
      ids.findingVisible,
    ]);
    expect(portal.findings[0]).not.toHaveProperty("technicalDetail");
    expect(portal.evidence.map((item) => item.id)).toEqual([
      ids.evidenceVisible,
    ]);
    expect(portal.comments.map((item) => item.body)).toEqual([
      "Safe client comment",
    ]);
    expect(portal.reports.map((item) => item.id)).toEqual(
      expect.arrayContaining([ids.reportReview, ids.reportPublished]),
    );
    expect(portal.reports.map((item) => item.id)).not.toContain(
      ids.reportInternal,
    );
  });

  it("uses the same not-found response for random, cross-client, and cross-organisation identifiers", async () => {
    for (const engagementId of [
      randomUUID(),
      ids.engagementB,
      ids.engagementOtherOrg,
    ]) {
      const error = await modules
        .getPortalEngagement(clientActor, engagementId)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(modules.PortalNotFoundError);
      expect(error).toMatchObject({
        name: "PortalNotFoundError",
        message: "The requested portal resource was not found",
      });
    }
    await expect(
      modules.submitRemediationUpdate(clientActor, {
        findingId: ids.findingHidden,
        status: "in_progress",
      }),
    ).rejects.toBeInstanceOf(modules.PortalNotFoundError);
    await expect(
      modules.getPortalReportVersion(clientActor, ids.reportInternalVersion),
    ).rejects.toBeInstanceOf(modules.PortalNotFoundError);
  });

  it("rejects client-owned API keys at the shared REST authentication boundary", async () => {
    const credential = await modules.createApiCredential(clientActor, {
      name: "Client key must not bypass portal policy",
      kind: "personal",
      scopes: ["findings:read"],
    });
    const error = await modules
      .authenticateApiRequest(
        new Request("https://dingodocs.test/api/v1/findings", {
          headers: { authorization: `Bearer ${credential.plaintext}` },
        }),
        "findings:read",
      )
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(modules.ApiAuthenticationError);
    expect(error).toMatchObject({
      status: 403,
      code: "client_portal_required",
    });
  });

  it("records client comments, explicit remediation states, report approval, and immutable retest requests", async () => {
    await modules.addPortalComment(clientActor, {
      targetType: "finding",
      targetId: ids.findingVisible,
      body: "Deployment is complete.",
    });
    await modules.submitRemediationUpdate(clientActor, {
      findingId: ids.findingVisible,
      status: "partially_remediated",
      owner: "Security Engineering",
      note: "Primary endpoint fixed; legacy endpoint remains.",
    });
    await modules.submitRemediationUpdate(clientActor, {
      findingId: ids.findingVisible,
      status: "remediated",
      owner: "Security Engineering",
      note: "Legacy endpoint removed.",
    });
    const attempt = await modules.requestRetest(
      clientActor,
      ids.findingVisible,
      "Please verify both endpoints.",
    );
    attemptId = attempt!.id;
    expect(attempt).toMatchObject({
      originalFindingVersion: 1,
      remediationSnapshot: { status: "remediated" },
    });
    expect(attempt?.originalSnapshot).toMatchObject({
      id: ids.findingVisible,
      title: "Published portal finding",
      version: 1,
    });
    const approved = await modules.approvePortalReport(
      clientActor,
      ids.reportReview,
    );
    expect(approved).toMatchObject({
      status: "approved",
      clientApprovedBy: ids.clientUser,
    });
    const [review] = await modules.db
      .select()
      .from(modules.reportReviews)
      .where(
        modules.eq(
          modules.reportReviews.reportVersionId,
          ids.reportReviewVersion,
        ),
      );
    expect(review?.decision).toBe("client_approved");
  });

  it("schedules, assigns, evidences, compares, completes, and revises the published report without rewriting history", async () => {
    await modules.scheduleRetest(testerActor, {
      attemptId,
      assignedTo: ids.tester,
      scheduledFor: new Date("2026-08-01T01:00:00.000Z"),
    });
    await modules.addRetestNote(testerActor, {
      attemptId,
      visibility: "internal",
      body: "Use the regression account.",
    });
    await modules.addRetestNote(testerActor, {
      attemptId,
      visibility: "client",
      body: "Retest is scheduled.",
    });
    await modules.attachRetestEvidence(testerActor, {
      attemptId,
      evidenceId: ids.evidenceInternal,
    });
    const completed = await modules.completeRetest(testerActor, {
      attemptId,
      outcome: "partially_remediated",
      notes: "The legacy path is fixed; one alternate path remains.",
      comparison: {
        original: "Both paths vulnerable",
        current: "One alternate path remains",
      },
    });
    expect(completed.attempt).toMatchObject({
      status: "completed",
      outcome: "partially_remediated",
      originalFindingVersion: 1,
    });
    expect(completed.attempt.updatedReportVersionId).toBeTruthy();
    expect(completed.finding).toMatchObject({ status: "retested", version: 2 });
    const [originalVersion] = await modules.db
      .select()
      .from(modules.reportVersions)
      .where(modules.eq(modules.reportVersions.id, ids.reportPublishedVersion));
    expect(originalVersion).toMatchObject({
      version: 1,
      status: "superseded",
      immutable: true,
      clientVisible: true,
    });
    const [revision] = await modules.db
      .select()
      .from(modules.reportVersions)
      .where(
        modules.eq(
          modules.reportVersions.id,
          completed.attempt.updatedReportVersionId!,
        ),
      );
    expect(revision).toMatchObject({
      version: 2,
      status: "draft",
      clientVisible: false,
    });
    const portal = await modules.getPortalEngagement(
      clientActor,
      ids.engagementA,
    );
    expect(portal.retestNotes.map((note) => note.body)).toEqual([
      "Retest is scheduled.",
    ]);
    expect(portal.retestNotes.map((note) => note.body)).not.toContain(
      "Use the regression account.",
    );
  });

  function evidenceRow(
    id: string,
    filename: string,
    classification: "internal" | "restricted" | "client_visible",
  ) {
    return {
      id,
      organisationId: ids.orgA,
      clientId: ids.clientA,
      engagementId: ids.engagementA,
      originalFilename: filename,
      storageProvider: "local",
      storageKey: `${ids.orgA}/${ids.engagementA}/${id}`,
      mediaType: "text/plain",
      sizeBytes: 10,
      sha256: id.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      uploadedBy: ids.tester,
      classification,
      malwareScanStatus: "clean",
    } as const;
  }
});

function reportDefinition(): ReportTemplateDefinition {
  return {
    sections: [{ id: "findings", type: "findings", title: "Findings" }],
    reusableContent: {},
    variables: {},
    branding: { primaryColour: "#174b6b", accentColour: "#d59b2d" },
    typography: { bodyFont: "Arial", headingFont: "Arial", bodySize: 11 },
    header: {},
    footer: { showPageNumbers: true },
    classification: "Confidential",
  };
}

async function load() {
  const [{ db, sqlClient }, schema, service, api, drizzle] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("./client-portal"),
    import("@/lib/api/authentication"),
    import("drizzle-orm"),
  ]);
  return { db, sqlClient, ...schema, ...service, ...api, ...drizzle };
}
