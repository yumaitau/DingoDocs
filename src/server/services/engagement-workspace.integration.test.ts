import { randomUUID } from "node:crypto";
import { deleteAuditEventsForOrganisations } from "@/server/testing/delete-audit-events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testUrl = process.env.TEST_DATABASE_URL;
const run = testUrl ? describe : describe.skip;

run("engagement workspace with PostgreSQL", () => {
  const ids = {
    orgA: randomUUID(),
    orgB: randomUUID(),
    actor: randomUUID(),
    consultant: randomUUID(),
    outsider: randomUUID(),
    approver: randomUUID(),
    client: randomUUID(),
    engagement: randomUUID(),
    archived: randomUUID(),
  };
  const actor = { organisationId: ids.orgA, userId: ids.actor };
  const approver = { organisationId: ids.orgA, userId: ids.approver };
  let modules: Awaited<ReturnType<typeof load>>;

  beforeAll(async () => {
    process.env.DATABASE_URL = testUrl;
    modules = await load();
    await modules.db.insert(modules.users).values([
      {
        id: ids.actor,
        name: "Workspace Manager",
        email: `${ids.actor}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.consultant,
        name: "Workspace Consultant",
        email: `${ids.consultant}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.outsider,
        name: "Other Tenant User",
        email: `${ids.outsider}@test.invalid`,
        emailVerified: true,
      },
      {
        id: ids.approver,
        name: "Scope Approver",
        email: `${ids.approver}@test.invalid`,
        emailVerified: true,
      },
    ]);
    await modules.db.insert(modules.organisations).values([
      { id: ids.orgA, slug: `workspace-${ids.orgA}`, name: "Workspace Tenant" },
      { id: ids.orgB, slug: `workspace-${ids.orgB}`, name: "Other Tenant" },
    ]);
    await modules.db.insert(modules.organisationMembers).values([
      {
        organisationId: ids.orgA,
        userId: ids.actor,
        role: "organisation_owner",
        joinedAt: new Date(),
      },
      {
        organisationId: ids.orgA,
        userId: ids.consultant,
        role: "consultant",
        joinedAt: new Date(),
      },
      {
        organisationId: ids.orgB,
        userId: ids.outsider,
        role: "organisation_owner",
        joinedAt: new Date(),
      },
      {
        organisationId: ids.orgA,
        userId: ids.approver,
        role: "organisation_administrator",
        joinedAt: new Date(),
      },
    ]);
    await modules.db.insert(modules.clients).values({
      id: ids.client,
      organisationId: ids.orgA,
      name: "Workspace Client",
    });
    await modules.db.insert(modules.engagements).values([
      {
        id: ids.engagement,
        organisationId: ids.orgA,
        clientId: ids.client,
        name: "Workspace Test",
        reference: `TEST-${ids.engagement.slice(0, 8)}`,
        type: "Web Application Assessment",
        status: "scoping",
      },
      {
        id: ids.archived,
        organisationId: ids.orgA,
        clientId: ids.client,
        name: "Archived Workspace",
        reference: `ARCH-${ids.archived.slice(0, 8)}`,
        type: "Web Application Assessment",
        status: "archived",
        archivedAt: new Date(),
      },
    ]);
    await modules.db.insert(modules.engagementMembers).values({
      organisationId: ids.orgA,
      engagementId: ids.engagement,
      userId: ids.actor,
      role: "engagement_manager",
    });
  });

  afterAll(async () => {
    if (!modules) return;
    await deleteAuditEventsForOrganisations(modules.sqlClient, [
      ids.orgA,
      ids.orgB,
    ]);
    await modules.db
      .delete(modules.organisations)
      .where(modules.inArray(modules.organisations.id, [ids.orgA, ids.orgB]));
    await modules.db
      .delete(modules.users)
      .where(
        modules.inArray(modules.users.id, [
          ids.actor,
          ids.consultant,
          ids.outsider,
          ids.approver,
        ]),
      );
    await modules.sqlClient.end();
  });

  it("clones approved scope into a new immutable draft", async () => {
    const first = await modules.createScopeDraft(actor, {
      engagementId: ids.engagement,
      changeSummary: "Initial test scope",
    });
    const item = await modules.addScopeItem(actor, {
      engagementId: ids.engagement,
      scopeVersionId: first.id,
      name: "Customer portal",
      type: "web_application",
      value: "portal.workspace.test",
      scopeStatus: "in_scope",
    });
    await expect(
      modules.approveScopeVersion(actor, {
        engagementId: ids.engagement,
        scopeVersionId: first.id,
      }),
    ).rejects.toThrow("someone other than its author");
    await expect(
      modules.approveScopeVersion(
        { organisationId: ids.orgA, userId: ids.consultant },
        { engagementId: ids.engagement, scopeVersionId: first.id },
      ),
    ).rejects.toThrow("engagement:edit");
    await modules.approveScopeVersion(approver, {
      engagementId: ids.engagement,
      scopeVersionId: first.id,
    });
    const second = await modules.createScopeDraft(actor, {
      engagementId: ids.engagement,
      changeSummary: "Exclude the legacy host",
    });
    const [cloned] = await modules.db
      .select()
      .from(modules.scopeItems)
      .where(modules.eq(modules.scopeItems.scopeVersionId, second.id));
    expect(second.version).toBe(2);
    expect(cloned).toMatchObject({
      value: item?.value,
      scopeStatus: "in_scope",
    });
    await modules.updateScopeItem(actor, {
      engagementId: ids.engagement,
      scopeVersionId: second.id,
      itemId: cloned!.id,
      name: cloned!.name,
      value: cloned!.value,
      scopeStatus: "excluded",
      exclusionReason: "Legacy system is outside the authorised window",
    });
    const [original] = await modules.db
      .select()
      .from(modules.scopeItems)
      .where(modules.eq(modules.scopeItems.id, item!.id));
    expect(original?.scopeStatus).toBe("in_scope");
    expect(
      modules.addScopeItem(
        { organisationId: ids.orgB, userId: ids.outsider },
        {
          engagementId: ids.engagement,
          scopeVersionId: second.id,
          name: "Cross tenant",
          type: "host",
          value: "forbidden.test",
          scopeStatus: "in_scope",
        },
      ),
    ).rejects.toBeInstanceOf(modules.WorkspaceScopeError);
  });

  it("enforces engagement roles and approved Rules of Engagement", async () => {
    const rules = await modules.createRulesVersion(actor, {
      engagementId: ids.engagement,
      permittedTestTimes: "09:00–17:00 Australia/Sydney",
      sourceIpAddresses: ["192.0.2.10"],
      approvedTooling: ["Burp Suite"],
      prohibitedTechniques: ["Denial of service"],
      stopTestingProcedure: "Stop immediately and contact the client.",
      escalationProcedure: "Call the nominated incident contact.",
      evidenceHandling: "Store evidence as restricted.",
      dataDestruction: "Destroy after the retention period.",
    });
    await expect(
      modules.acknowledgeRules(actor, {
        engagementId: ids.engagement,
        rulesId: rules.id,
      }),
    ).rejects.toBeInstanceOf(modules.WorkspaceTransitionError);
    await modules.approveRules(actor, {
      engagementId: ids.engagement,
      rulesId: rules.id,
    });
    await modules.acknowledgeRules(actor, {
      engagementId: ids.engagement,
      rulesId: rules.id,
    });
    await modules.assignEngagementMember(actor, {
      engagementId: ids.engagement,
      userId: ids.consultant,
      role: "consultant",
    });
    await expect(
      modules.assignEngagementMember(actor, {
        engagementId: ids.engagement,
        userId: ids.outsider,
        role: "consultant",
      }),
    ).rejects.toBeInstanceOf(modules.WorkspaceScopeError);
    await expect(
      modules.assignEngagementMember(actor, {
        engagementId: ids.engagement,
        userId: ids.consultant,
        role: "organisation_owner",
      }),
    ).rejects.toBeInstanceOf(modules.WorkspaceTransitionError);
  });

  it("prevents leads from promoting themselves to engagement manager", async () => {
    await modules.db
      .update(modules.organisationMembers)
      .set({ role: "lead_consultant" })
      .where(modules.eq(modules.organisationMembers.userId, ids.consultant));
    try {
      await expect(
        modules.assignEngagementMember(
          { organisationId: ids.orgA, userId: ids.consultant },
          {
            engagementId: ids.engagement,
            userId: ids.consultant,
            role: "engagement_manager",
          },
        ),
      ).rejects.toThrow("Permission denied");
    } finally {
      await modules.db
        .update(modules.organisationMembers)
        .set({ role: "consultant" })
        .where(modules.eq(modules.organisationMembers.userId, ids.consultant));
    }
  });

  it("keeps private notes out of other members' workspace, API and search results", async () => {
    const privateNote = await modules.createWorkspaceNote(actor, {
      engagementId: ids.engagement,
      title: "Cobaltprivatecanary",
      body: "Confidential author note",
      kind: "note",
      visibility: "private",
    });
    const teamNote = await modules.createWorkspaceNote(actor, {
      engagementId: ids.engagement,
      title: "Shared note",
      body: "Shared body",
      kind: "note",
      visibility: "team",
    });
    const own = await modules.getEngagementWorkspace(actor, ids.engagement);
    expect(own!.notes.map((note) => note.id)).toContain(privateNote.id);
    const other = { organisationId: ids.orgA, userId: ids.consultant };
    const workspace = await modules.getEngagementWorkspace(
      other,
      ids.engagement,
    );
    expect(workspace!.notes.map((note) => note.id)).not.toContain(
      privateNote.id,
    );
    expect(workspace!.notes.map((note) => note.id)).toContain(teamNote.id);
    const { globalSearch } = await import("./global-search");
    expect(
      await globalSearch(
        { ...other, role: "consultant" },
        "Cobaltprivatecanary",
      ),
    ).toHaveLength(0);
    expect(
      await globalSearch(
        { ...actor, role: "organisation_owner" },
        "Cobaltprivatecanary",
      ),
    ).toHaveLength(1);
    const { createApiCredential } = await import("@/lib/api/authentication");
    const { GET } = await import("@/app/api/v1/engagements/[id]/notes/route");
    for (const owner of [actor, other]) {
      const key = await createApiCredential(owner, {
        name: "Notes test",
        kind: "personal",
        scopes: ["engagements:read"],
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      const response = await GET(
        new Request(
          "https://test.invalid/api/v1/engagements/" +
            ids.engagement +
            "/notes",
          {
            headers: { authorization: `Bearer ${key.plaintext}` },
          },
        ),
        { params: Promise.resolve({ id: ids.engagement }) },
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(
        body.data.some((note: { id: string }) => note.id === privateNote.id),
      ).toBe(owner.userId === actor.userId);
    }
  });

  it("stops service principals releasing timeline entries to the client", async () => {
    await expect(
      modules.createTimelineEntry(
        { ...actor, serviceAccountId: randomUUID() },
        {
          engagementId: ids.engagement,
          occurredAt: new Date(),
          phase: "testing",
          description: "Agent entry",
          clientVisible: true,
        },
      ),
    ).rejects.toThrow("service accounts cannot make timeline entries");

    const { createApiCredential } = await import("@/lib/api/authentication");
    const { POST } =
      await import("@/app/api/v1/engagements/[id]/timeline/route");
    const key = await createApiCredential(actor, {
      name: "Timeline agent",
      kind: "service",
      serviceAccountName: "Timeline agent",
      scopes: ["notes:write"],
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const post = (clientVisible: boolean) =>
      POST(
        new Request(
          `https://test.invalid/api/v1/engagements/${ids.engagement}/timeline`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${key.plaintext}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              phase: "testing",
              description: "Agent timeline entry",
              clientVisible,
            }),
          },
        ),
        { params: Promise.resolve({ id: ids.engagement }) },
      );
    const denied = await post(true);
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      error: { code: "service_account_forbidden" },
    });
    const allowed = await post(false);
    expect(allowed.status).toBe(201);
    await expect(allowed.json()).resolves.toMatchObject({
      data: { clientVisible: false },
    });
  });

  it("persists linked work records and audited status transitions", async () => {
    const workspace = await modules.getEngagementWorkspace(
      actor,
      ids.engagement,
    );
    const scopeItem = workspace?.currentScopeItems[0];
    const asset = await modules.createAsset(actor, {
      engagementId: ids.engagement,
      name: "Workspace portal",
      type: "application",
      identifier: `portal-${ids.engagement}.test`,
      criticality: "high",
      scopeItemIds: scopeItem ? [scopeItem.id] : [],
    });
    const note = await modules.createWorkspaceNote(actor, {
      engagementId: ids.engagement,
      title: "Testing journal",
      body: "Validated tenant boundaries.",
      kind: "testing_journal",
      assetIds: [asset.id],
    });
    const task = await modules.createWorkspaceTask(actor, {
      engagementId: ids.engagement,
      title: "Complete authenticated testing",
      assigneeId: ids.consultant,
      assetIds: [asset.id],
    });
    await modules.createTimelineEntry(actor, {
      engagementId: ids.engagement,
      occurredAt: new Date(),
      phase: "Testing",
      description: "Authenticated assessment started",
    });
    await modules.logWorkspaceTime(actor, {
      engagementId: ids.engagement,
      category: "Testing",
      hours: "1.5",
      startedAt: new Date(),
    });
    expect(
      await modules.db
        .select()
        .from(modules.assetNotes)
        .where(modules.eq(modules.assetNotes.noteId, note.id)),
    ).toHaveLength(1);
    expect(
      await modules.db
        .select()
        .from(modules.assetTasks)
        .where(modules.eq(modules.assetTasks.taskId, task.id)),
    ).toHaveLength(1);
    await expect(
      modules.transitionEngagement(actor, {
        engagementId: ids.engagement,
        toStatus: "testing",
      }),
    ).rejects.toBeInstanceOf(modules.WorkspaceTransitionError);
    await modules.transitionEngagement(actor, {
      engagementId: ids.engagement,
      toStatus: "scheduled",
      reason: "Scope and team are ready",
    });
    const transitions = await modules.db
      .select()
      .from(modules.engagementTransitions)
      .where(
        modules.and(
          modules.eq(modules.engagementTransitions.organisationId, ids.orgA),
          modules.eq(
            modules.engagementTransitions.engagementId,
            ids.engagement,
          ),
        ),
      );
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      fromStatus: "scoping",
      toStatus: "scheduled",
    });
  });

  it("keeps archived engagements readable but rejects new content", async () => {
    const { EngagementReadOnlyError } = await import("./engagement-guards");
    const writes = [
      () =>
        modules.createWorkspaceNote(actor, {
          engagementId: ids.archived,
          title: "Late note",
          body: "Should not be written",
          kind: "note",
        }),
      () =>
        modules.createWorkspaceTask(actor, {
          engagementId: ids.archived,
          title: "Late task",
        }),
      () =>
        modules.createTimelineEntry(actor, {
          engagementId: ids.archived,
          occurredAt: new Date(),
          phase: "Testing",
          description: "Late entry",
        }),
      () =>
        modules.createScopeDraft(actor, {
          engagementId: ids.archived,
          changeSummary: "Late scope",
        }),
    ];
    for (const write of writes)
      await expect(write()).rejects.toBeInstanceOf(EngagementReadOnlyError);
    const {
      addFindingComment,
      bulkUpdateFindings,
      createFindingDraft,
      transitionFinding,
    } = await import("./findings");
    await expect(
      createFindingDraft(actor, {
        engagementId: ids.archived,
        identifier: "LATE-1",
        title: "Late finding",
        severity: "low",
      }),
    ).rejects.toBeInstanceOf(EngagementReadOnlyError);
    const [archivedFinding] = await modules.db
      .insert(modules.findings)
      .values({
        organisationId: ids.orgA,
        engagementId: ids.archived,
        identifier: "ARCH-1",
        title: "Archived finding",
        status: "published",
        severity: "low",
      })
      .returning();
    const [rules] = await modules.db
      .insert(modules.rulesOfEngagement)
      .values({
        organisationId: ids.orgA,
        engagementId: ids.archived,
        version: 1,
        createdBy: ids.actor,
      })
      .returning();
    const findingWrites = [
      () =>
        transitionFinding(actor, {
          findingId: archivedFinding!.id,
          toStatus: "closed",
        }),
      () =>
        addFindingComment(actor, {
          findingId: archivedFinding!.id,
          body: "Late comment",
          visibility: "team",
        }),
      () =>
        bulkUpdateFindings(actor, {
          ids: [archivedFinding!.id],
          status: "closed",
        }),
      () =>
        modules.approveRules(approver, {
          engagementId: ids.archived,
          rulesId: rules!.id,
        }),
      () =>
        modules.acknowledgeRules(actor, {
          engagementId: ids.archived,
          rulesId: rules!.id,
        }),
    ];
    for (const write of findingWrites)
      await expect(write()).rejects.toBeInstanceOf(EngagementReadOnlyError);
    const [unchanged] = await modules.db
      .select({ status: modules.findings.status })
      .from(modules.findings)
      .where(modules.eq(modules.findings.id, archivedFinding!.id));
    expect(unchanged?.status).toBe("published");
    const { uploadEvidence } = await import("./evidence");
    const provider = {
      name: "test",
      put: async () => {
        throw new Error("storage must not be reached");
      },
      get: async () => new ReadableStream<Uint8Array>(),
      delete: async () => undefined,
      exists: async () => false,
      healthCheck: async () => undefined,
    };
    await expect(
      uploadEvidence(
        { ...actor, canViewRestricted: true },
        {
          engagementId: ids.archived,
          filename: "late.txt",
          mediaType: "text/plain",
          bytes: new TextEncoder().encode("late evidence"),
          classification: "internal",
        },
        provider,
      ),
    ).rejects.toBeInstanceOf(EngagementReadOnlyError);
    await expect(
      modules.getEngagementWorkspace(actor, ids.archived),
    ).resolves.toMatchObject({ engagement: { id: ids.archived } });
  });
});

async function load() {
  const [{ db, sqlClient }, schema, service, drizzle] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("./engagement-workspace"),
    import("drizzle-orm"),
  ]);
  return { db, sqlClient, ...schema, ...service, ...drizzle };
}
