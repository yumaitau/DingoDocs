import { randomUUID } from "node:crypto";
import { deleteAuditEventsForOrganisations } from "@/server/testing/delete-audit-events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReportTemplateDefinition } from "@/db/schema";
import type { StorageProvider } from "@/lib/storage/types";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("review, publication and retest guards with PostgreSQL", () => {
  const ids = {
    org: randomUUID(),
    owner: randomUUID(),
    author: randomUUID(),
    reviewer: randomUUID(),
    qa: randomUUID(),
    member: randomUUID(),
    clientUser: randomUUID(),
    client: randomUUID(),
    contact: randomUUID(),
    engagementA: randomUUID(),
    engagementB: randomUUID(),
    draft: randomUUID(),
    hidden: randomUUID(),
    visible: randomUUID(),
    closed: randomUUID(),
    peer: randomUUID(),
    approved: randomUUID(),
    bulkDraft: randomUUID(),
    bulkDraftTwo: randomUUID(),
    bulkPublished: randomUUID(),
    retestB: randomUUID(),
    evidenceLinked: randomUUID(),
    evidenceUnlinked: randomUUID(),
  };
  const owner = { organisationId: ids.org, userId: ids.owner };
  const author = { organisationId: ids.org, userId: ids.author };
  const qa = { organisationId: ids.org, userId: ids.qa };
  const member = { organisationId: ids.org, userId: ids.member };
  const clientActor = { organisationId: ids.org, userId: ids.clientUser };
  let modules: Awaited<ReturnType<typeof load>>;
  let reportId: string;
  let reportVersionId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    const userIds = [
      ids.owner,
      ids.author,
      ids.reviewer,
      ids.qa,
      ids.member,
      ids.clientUser,
    ];
    await modules.db.insert(modules.users).values(
      userIds.map((id) => ({
        id,
        name: `Guard user ${id.slice(0, 8)}`,
        email: `${id}@test.invalid`,
        emailVerified: true,
      })),
    );
    await modules.db.insert(modules.organisations).values({
      id: ids.org,
      slug: `guards-${ids.org}`,
      name: "Guard Tenant",
    });
    await modules.db.insert(modules.organisationMembers).values([
      {
        organisationId: ids.org,
        userId: ids.owner,
        role: "organisation_owner",
      },
      { organisationId: ids.org, userId: ids.author, role: "consultant" },
      { organisationId: ids.org, userId: ids.reviewer, role: "reviewer" },
      { organisationId: ids.org, userId: ids.qa, role: "reviewer" },
      { organisationId: ids.org, userId: ids.member, role: "consultant" },
      { organisationId: ids.org, userId: ids.clientUser, role: "client_user" },
    ]);
    await modules.db.insert(modules.clients).values({
      id: ids.client,
      organisationId: ids.org,
      name: "Guard Client",
    });
    await modules.db.insert(modules.engagements).values([
      {
        id: ids.engagementA,
        organisationId: ids.org,
        clientId: ids.client,
        name: "Guarded assessment",
        reference: `GRD-${ids.engagementA.slice(0, 8)}`,
        type: "Web Application",
        status: "reporting",
      },
      {
        id: ids.engagementB,
        organisationId: ids.org,
        clientId: ids.client,
        name: "Second assessment",
        reference: `GRB-${ids.engagementB.slice(0, 8)}`,
        type: "Cloud",
      },
    ]);
    // The member approves on A but is only a consultant on B.
    await modules.db.insert(modules.engagementMembers).values([
      {
        organisationId: ids.org,
        engagementId: ids.engagementA,
        userId: ids.member,
        role: "lead_consultant",
      },
      {
        organisationId: ids.org,
        engagementId: ids.engagementB,
        userId: ids.member,
        role: "consultant",
      },
    ]);
    await modules.db.insert(modules.clientContacts).values({
      id: ids.contact,
      organisationId: ids.org,
      clientId: ids.client,
      userId: ids.clientUser,
      name: "Guard Client User",
      email: `${ids.clientUser}@test.invalid`,
    });
    await modules.db.insert(modules.engagementContacts).values({
      organisationId: ids.org,
      engagementId: ids.engagementA,
      contactId: ids.contact,
    });
    const published = { publishedAt: new Date(), approvedVersion: 1 };
    const finding = (
      id: string,
      identifier: string,
      title: string,
      values: Partial<typeof modules.findings.$inferInsert> = {},
    ) => ({
      id,
      organisationId: ids.org,
      engagementId: ids.engagementA,
      identifier,
      title,
      severity: "high" as const,
      remediation: `Fix ${title}`,
      authorId: ids.author,
      ...values,
    });
    await modules.db.insert(modules.findings).values([
      finding(ids.draft, "DRAFT-001", "Draft secret title", {
        severity: "critical",
      }),
      finding(ids.hidden, "HID-001", "Hidden published title", {
        status: "published",
        clientVisible: false,
        ...published,
      }),
      finding(ids.visible, "VIS-001", "Visible published title", {
        status: "published",
        clientVisible: true,
        ...published,
      }),
      finding(ids.closed, "CLS-001", "Closed client finding", {
        status: "closed",
        clientVisible: true,
        ...published,
      }),
      finding(ids.peer, "PEER-001", "Peer reviewed finding", {
        status: "peer_reviewed",
        reviewerId: ids.reviewer,
      }),
      finding(ids.approved, "QA-001", "QA approved finding", {
        status: "qa_approved",
        reviewerId: ids.qa,
        approvedVersion: 1,
      }),
      finding(ids.bulkDraft, "BULK-001", "Bulk draft", {
        engagementId: ids.engagementB,
        severity: "low",
      }),
      finding(ids.bulkDraftTwo, "BULK-002", "Bulk draft two", {
        engagementId: ids.engagementB,
        severity: "low",
      }),
      finding(ids.bulkPublished, "BULK-003", "Bulk published", {
        engagementId: ids.engagementB,
        severity: "low",
        status: "published",
        ...published,
      }),
      finding(ids.retestB, "RTB-001", "Retest on B", {
        engagementId: ids.engagementB,
        status: "published",
        ...published,
      }),
    ]);
    const evidence = (id: string, filename: string) => ({
      id,
      organisationId: ids.org,
      clientId: ids.client,
      engagementId: ids.engagementA,
      originalFilename: filename,
      storageProvider: "local",
      storageKey: `${ids.org}/${id}`,
      mediaType: "image/png",
      sizeBytes: 68,
      sha256: id.replaceAll("-", "").padEnd(64, "0"),
      uploadedBy: ids.author,
      classification: "restricted" as const,
      malwareScanStatus: "clean",
    });
    await modules.db
      .insert(modules.evidence)
      .values([
        evidence(ids.evidenceLinked, "linked-proof.png"),
        evidence(ids.evidenceUnlinked, "draft-only-proof.png"),
      ]);
    await modules.db.insert(modules.evidenceFindings).values([
      {
        organisationId: ids.org,
        evidenceId: ids.evidenceLinked,
        findingId: ids.visible,
      },
      {
        organisationId: ids.org,
        evidenceId: ids.evidenceUnlinked,
        findingId: ids.draft,
      },
    ]);
  });

  afterAll(async () => {
    if (!modules) return;
    await deleteAuditEventsForOrganisations(modules.sqlClient, [ids.org]);
    await modules.db
      .delete(modules.organisations)
      .where(modules.eq(modules.organisations.id, ids.org));
    await modules.db
      .delete(modules.users)
      .where(
        modules.inArray(modules.users.id, [
          ids.owner,
          ids.author,
          ids.reviewer,
          ids.qa,
          ids.member,
          ids.clientUser,
        ]),
      );
    await modules.sqlClient.end();
  });

  it("builds reports from QA-approved findings only and keeps withheld findings out of the client view", async () => {
    const template = await modules.createReportTemplate(owner, {
      name: "Guarded template",
      definition: definition(),
    });
    const created = await modules.createReport(owner, {
      engagementId: ids.engagementA,
      templateId: template!.id,
      title: "Guarded report",
    });
    reportId = created.report!.id;
    reportVersionId = created.version!.id;
    const internal = created.model;
    expect(internal.findings.map((row) => row.identifier).sort()).toEqual([
      "CLS-001",
      "HID-001",
      "QA-001",
      "VIS-001",
    ]);
    expect(internal.evidence.map((row) => row.filename)).toEqual([
      "linked-proof.png",
    ]);
    const internalHtml = modules.renderReportHtml(internal);
    expect(internalHtml).not.toContain("Draft secret title");
    expect(internalHtml).not.toContain("DRAFT-001");
    expect(internalHtml).not.toContain("Peer reviewed finding");
    expect(internalHtml).not.toContain("draft-only-proof.png");

    const client = await modules.presentClientReport(ids.org, internal);
    const clientHtml = modules.renderReportHtml(client);
    for (const leaked of [
      "Draft secret title",
      "DRAFT-001",
      "Hidden published title",
      "HID-001",
      "QA approved finding",
    ])
      expect(clientHtml).not.toContain(leaked);
    expect(clientHtml).toContain("Visible published title");
    const summary = client.sections.find(
      (section) => section.definition.type === "executive_summary",
    )?.content;
    expect(summary).toContain("VIS-001");
    expect(summary).not.toContain("HID-001");
    expect(
      client.sections.find((section) => section.definition.id === "notes")
        ?.content,
    ).toContain("[REDACTED]");
  });

  it("archives a published report without touching its immutable version", async () => {
    await modules.db
      .update(modules.reports)
      .set({ status: "published" })
      .where(modules.eq(modules.reports.id, reportId));
    await modules.db
      .update(modules.reportVersions)
      .set({ status: "published", immutable: true })
      .where(modules.eq(modules.reportVersions.id, reportVersionId));
    await expect(
      modules.transitionReport(owner, { reportId, toStatus: "draft" }),
    ).rejects.toThrow("cannot transition");
    await expect(
      modules.transitionReport(owner, { reportId, toStatus: "archived" }),
    ).resolves.toMatchObject({ status: "archived" });
    const [version] = await modules.db
      .select()
      .from(modules.reportVersions)
      .where(modules.eq(modules.reportVersions.id, reportVersionId));
    expect(version).toMatchObject({ immutable: true, status: "archived" });
  });

  it("marks report generation failed even when export cleanup fails", async () => {
    const created = await modules.createReport(owner, {
      engagementId: ids.engagementA,
      templateId: (await modules.createReportTemplate(owner, {
        name: "Cleanup template",
        definition: definition(),
      }))!.id,
      title: "Cleanup report",
    });
    let puts = 0;
    const provider = {
      name: "failing",
      async put(input: { key: string }) {
        if (++puts > 1) throw new Error("storage write failed");
        return { key: input.key, sha256: "0".repeat(64), size: 1 };
      },
      async delete() {
        throw new Error("storage delete failed");
      },
    } as unknown as StorageProvider;
    await expect(
      modules.generateReportJob(
        created.version!.id,
        ["html", "markdown"],
        provider,
      ),
    ).rejects.toThrow("storage write failed");
    const [version] = await modules.db
      .select()
      .from(modules.reportVersions)
      .where(modules.eq(modules.reportVersions.id, created.version!.id));
    expect(version).toMatchObject({
      renderStatus: "failed",
      renderError: "storage write failed",
    });
  });

  it("denies service-account keys approval and publication", async () => {
    const service = await modules.createApiCredential(owner, {
      name: "Scanner agent",
      kind: "service",
      serviceAccountName: "Scanner agent",
      scopes: ["findings:write"],
    });
    const request = () =>
      new Request("http://localhost/api/v1/findings", {
        method: "POST",
        headers: { authorization: `Bearer ${service.plaintext}` },
      });
    for (const permission of ["finding:approve", "report:publish"] as const)
      await expect(
        modules.apiWriteContext(request(), "findings:write", permission),
      ).rejects.toMatchObject({
        status: 403,
        code: "service_account_forbidden",
      });
    await expect(
      modules.apiWriteContext(request(), "findings:write", "finding:create"),
    ).resolves.toMatchObject({ serviceAccountId: expect.any(String) });

    const { POST } =
      await import("@/app/api/v1/findings/[id]/transition/route");
    const response = await POST(
      new Request(
        `http://localhost/api/v1/findings/${ids.visible}/transition`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${service.plaintext}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ status: "closed" }),
        },
      ),
      { params: Promise.resolve({ id: ids.visible }) },
    );
    expect(response.status).toBe(403);
    const [unchanged] = await modules.db
      .select({ status: modules.findings.status })
      .from(modules.findings)
      .where(modules.eq(modules.findings.id, ids.visible));
    expect(unchanged?.status).toBe("published");
  });

  it("stops authors approving or publishing their own findings", async () => {
    await expect(
      modules.transitionFinding(author, {
        findingId: ids.peer,
        toStatus: "qa_approved",
      }),
    ).rejects.toThrow("author cannot");
    await expect(
      modules.transitionFinding(author, {
        findingId: ids.approved,
        toStatus: "published",
      }),
    ).rejects.toThrow("author cannot");
    await expect(
      modules.transitionFinding(author, {
        findingId: ids.approved,
        toStatus: "published",
        canOverride: true,
        overrideReason: "Two-person team; QA lead unavailable",
      }),
    ).resolves.toMatchObject({ status: "published" });
    await expect(
      modules.transitionFinding(qa, {
        findingId: ids.peer,
        toStatus: "qa_approved",
      }),
    ).resolves.toMatchObject({ status: "qa_approved", reviewerId: ids.qa });
  });

  it("gates bulk updates by permission, editable status and rolls back on failure", async () => {
    expect(modules.bulkFindingUpdatePermission({ status: "in_progress" })).toBe(
      "finding:create",
    );
    for (const status of ["qa_approved", "published", "closed"] as const)
      expect(modules.bulkFindingUpdatePermission({ status })).toBe(
        "finding:approve",
      );
    expect(modules.bulkFindingUpdatePermission({ clientVisible: true })).toBe(
      "finding:approve",
    );

    await expect(
      modules.bulkUpdateFindings(owner, {
        ids: [ids.bulkDraft],
        assigneeId: ids.member,
      }),
    ).rejects.toThrow("assignment is not supported");
    await expect(
      modules.bulkUpdateFindings(owner, {
        ids: [ids.bulkDraft, ids.bulkPublished],
        severity: "critical",
      }),
    ).rejects.toThrow("severity can only change");
    await expect(
      modules.bulkUpdateFindings(owner, {
        ids: [ids.bulkDraftTwo, ids.bulkPublished],
        status: "ready_for_review",
      }),
    ).rejects.toThrow("cannot transition");
    const untouched = await modules.db
      .select()
      .from(modules.findings)
      .where(
        modules.inArray(modules.findings.id, [
          ids.bulkDraft,
          ids.bulkDraftTwo,
          ids.bulkPublished,
        ]),
      );
    for (const row of untouched)
      expect(row).toMatchObject({ severity: "low", version: 1 });
    expect(untouched.find((row) => row.id === ids.bulkDraftTwo)?.status).toBe(
      "draft",
    );

    const [updated] = await modules.bulkUpdateFindings(owner, {
      ids: [ids.bulkDraft],
      severity: "critical",
      status: "ready_for_review",
    });
    expect(updated).toMatchObject({
      severity: "critical",
      status: "ready_for_review",
      version: 2,
      authorId: ids.author,
    });
    const snapshots = await modules.db
      .select()
      .from(modules.findingVersions)
      .where(modules.eq(modules.findingVersions.findingId, ids.bulkDraft));
    expect(snapshots.map((row) => row.version)).toEqual([1]);
  });

  it("authorises retest work against the attempt's engagement", async () => {
    const [attemptB] = await modules.db
      .insert(modules.retestAttempts)
      .values({
        organisationId: ids.org,
        findingId: ids.retestB,
        requestedBy: ids.owner,
      })
      .returning();
    await expect(
      modules.scheduleRetest(member, {
        attemptId: attemptB!.id,
        assignedTo: ids.member,
        scheduledFor: new Date(),
      }),
    ).rejects.toBeInstanceOf(modules.PermissionDeniedError);
    await expect(
      modules.addRetestNote(member, {
        attemptId: attemptB!.id,
        body: "Cross-engagement note",
        visibility: "internal",
      }),
    ).rejects.toBeInstanceOf(modules.PermissionDeniedError);

    const attemptA = await modules.requestRetestForApi(owner, ids.visible);
    await expect(
      modules.addRetestNote(member, {
        attemptId: attemptA.id,
        body: "Same-engagement note",
        visibility: "internal",
      }),
    ).resolves.toMatchObject({ retestAttemptId: attemptA.id });
  });

  it("rejects API retests for unpublished, closed or already open findings", async () => {
    await expect(
      modules.requestRetestForApi(owner, ids.draft),
    ).rejects.toBeInstanceOf(modules.WorkspaceTransitionError);
    await expect(
      modules.requestRetestForApi(owner, ids.closed),
    ).rejects.toBeInstanceOf(modules.WorkspaceTransitionError);
    // The previous test opened an attempt on the visible finding.
    await expect(
      modules.requestRetestForApi(owner, ids.visible),
    ).rejects.toThrow("already open");
  });

  it("keeps client remediation updates inside the finding workflow", async () => {
    await expect(
      modules.submitRemediationUpdate(clientActor, {
        findingId: ids.closed,
        status: "in_progress",
      }),
    ).rejects.toThrow("cannot be reopened from the portal");
    const [closed] = await modules.db
      .select({ status: modules.findings.status })
      .from(modules.findings)
      .where(modules.eq(modules.findings.id, ids.closed));
    expect(closed?.status).toBe("closed");
    const updates = await modules.db
      .select()
      .from(modules.remediationUpdates)
      .where(modules.eq(modules.remediationUpdates.findingId, ids.closed));
    expect(updates).toHaveLength(0);
  });
});

function definition(): ReportTemplateDefinition {
  return {
    sections: [
      { id: "cover", type: "cover" },
      { id: "summary", type: "executive_summary", title: "Executive summary" },
      { id: "findings", type: "findings", title: "Findings" },
      {
        id: "evidence",
        type: "evidence",
        title: "Evidence",
        condition: { field: "hasEvidence", operator: "truthy" },
      },
      {
        id: "notes",
        type: "appendix",
        title: "Notes",
        content: "Follow-up on Hidden published title is tracked internally.",
      },
    ],
    reusableContent: {},
    variables: {},
    branding: {
      organisationName: "Guard Security",
      primaryColour: "#174b6b",
      accentColour: "#d59b2d",
    },
    typography: { bodyFont: "Arial", headingFont: "Arial", bodySize: 11 },
    header: { left: "{{organisation.name}}", right: "", showRule: true },
    footer: { left: "{{engagement.reference}}", showPageNumbers: true },
    watermark: "",
    classification: "Confidential",
    approvals: [],
    signatures: [],
  };
}

async function load() {
  const [
    { db, sqlClient },
    schema,
    drizzle,
    authentication,
    permissions,
    findingsService,
    reportsService,
    clientView,
    renderer,
    portal,
    retestApi,
    workspace,
  ] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("drizzle-orm"),
    import("@/lib/api/authentication"),
    import("@/lib/permissions/require"),
    import("./findings"),
    import("./reports"),
    import("./report-client-view"),
    import("./report-renderers"),
    import("./client-portal"),
    import("./retest-api"),
    import("./engagement-workspace"),
  ]);
  return {
    db,
    sqlClient,
    ...schema,
    ...drizzle,
    ...authentication,
    PermissionDeniedError: permissions.PermissionDeniedError,
    ...findingsService,
    ...reportsService,
    ...clientView,
    ...renderer,
    ...portal,
    ...retestApi,
    WorkspaceTransitionError: workspace.WorkspaceTransitionError,
  };
}
