import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  assetNotes,
  assetScopeItems,
  assetTasks,
  assets,
  auditEvents,
  engagementMembers,
  engagementTransitions,
  engagements,
  notes,
  organisationMembers,
  ruleAcknowledgements,
  rulesOfEngagement,
  scopeItems,
  scopeVersions,
  tasks,
  timelineEvents,
  timeEntries,
  users,
} from "@/db/schema";
import type { Role } from "@/lib/permissions/matrix";

export type WorkspaceActor = {
  organisationId: string;
  userId: string;
};

export type EngagementStatus = (typeof engagements.$inferSelect)["status"];

const engagementRoles = [
  "engagement_manager",
  "lead_consultant",
  "consultant",
  "reviewer",
  "read_only",
] as const satisfies readonly Role[];

const transitionGraph: Record<EngagementStatus, readonly EngagementStatus[]> = {
  proposed: ["scoping", "cancelled"],
  scoping: ["scheduled", "cancelled"],
  scheduled: ["ready", "scoping", "cancelled"],
  ready: ["testing", "scheduled", "cancelled"],
  testing: ["reporting", "cancelled"],
  reporting: ["peer_review", "testing", "cancelled"],
  peer_review: ["quality_assurance", "reporting", "cancelled"],
  quality_assurance: ["client_review", "reporting", "cancelled"],
  client_review: ["retesting", "complete", "reporting", "cancelled"],
  retesting: ["reporting", "complete", "cancelled"],
  complete: ["archived", "retesting"],
  archived: [],
  cancelled: ["scoping", "archived"],
};

export class WorkspaceScopeError extends Error {
  constructor(message = "Record is not available in the active organisation") {
    super(message);
    this.name = "WorkspaceScopeError";
  }
}

export class WorkspaceTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceTransitionError";
  }
}

export async function createScopeDraft(
  actor: WorkspaceActor,
  input: { engagementId: string; changeSummary: string },
) {
  return db.transaction(async (tx) => {
    await requireEngagement(tx, actor, input.engagementId);
    const [latest] = await tx
      .select()
      .from(scopeVersions)
      .where(
        and(
          eq(scopeVersions.organisationId, actor.organisationId),
          eq(scopeVersions.engagementId, input.engagementId),
        ),
      )
      .orderBy(desc(scopeVersions.version))
      .limit(1);
    if (latest?.status === "draft") return latest;

    const [draft] = await tx
      .insert(scopeVersions)
      .values({
        organisationId: actor.organisationId,
        engagementId: input.engagementId,
        version: (latest?.version ?? 0) + 1,
        status: "draft",
        changeSummary: input.changeSummary,
        createdBy: actor.userId,
      })
      .returning();
    if (!draft) throw new Error("Unable to create scope version");

    if (latest) {
      const previousItems = await tx
        .select()
        .from(scopeItems)
        .where(
          and(
            eq(scopeItems.organisationId, actor.organisationId),
            eq(scopeItems.scopeVersionId, latest.id),
          ),
        );
      if (previousItems.length) {
        await tx.insert(scopeItems).values(
          previousItems.map((item) => ({
            organisationId: actor.organisationId,
            engagementId: input.engagementId,
            scopeVersionId: draft.id,
            name: item.name,
            type: item.type,
            value: item.value,
            environment: item.environment,
            owner: item.owner,
            businessCriticality: item.businessCriticality,
            technicalCriticality: item.technicalCriticality,
            scopeStatus: item.scopeStatus,
            exclusionReason: item.exclusionReason,
            testingRestrictions: item.testingRestrictions,
            approvedMethods: item.approvedMethods,
            tags: item.tags,
            notes: item.notes,
          })),
        );
      }
    }
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "scope.version.created",
      targetType: "scope_version",
      targetId: draft.id,
      metadata: { engagementId: input.engagementId, version: draft.version },
    });
    return draft;
  });
}

export async function addScopeItem(
  actor: WorkspaceActor,
  input: {
    engagementId: string;
    scopeVersionId: string;
    name: string;
    type: string;
    value: string;
    environment?: string;
    scopeStatus: "in_scope" | "excluded";
    exclusionReason?: string;
    testingRestrictions?: string;
    approvedMethods?: string[];
  },
) {
  if (input.scopeStatus === "excluded" && !input.exclusionReason?.trim()) {
    throw new WorkspaceTransitionError("Excluded scope requires a reason");
  }
  return db.transaction(async (tx) => {
    await requireDraftScope(
      tx,
      actor,
      input.engagementId,
      input.scopeVersionId,
    );
    const [item] = await tx
      .insert(scopeItems)
      .values({
        organisationId: actor.organisationId,
        engagementId: input.engagementId,
        scopeVersionId: input.scopeVersionId,
        name: input.name,
        type: input.type,
        value: input.value,
        environment: input.environment,
        scopeStatus: input.scopeStatus,
        exclusionReason: input.exclusionReason,
        testingRestrictions: input.testingRestrictions,
        approvedMethods: input.approvedMethods ?? [],
      })
      .returning();
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "scope.item.created",
      targetType: "scope_item",
      targetId: item?.id,
      metadata: { engagementId: input.engagementId },
    });
    return item;
  });
}

export async function updateScopeItem(
  actor: WorkspaceActor,
  input: {
    engagementId: string;
    scopeVersionId: string;
    itemId: string;
    name: string;
    value: string;
    scopeStatus: "in_scope" | "excluded";
    exclusionReason?: string;
    testingRestrictions?: string;
  },
) {
  if (input.scopeStatus === "excluded" && !input.exclusionReason?.trim()) {
    throw new WorkspaceTransitionError("Excluded scope requires a reason");
  }
  return db.transaction(async (tx) => {
    await requireDraftScope(
      tx,
      actor,
      input.engagementId,
      input.scopeVersionId,
    );
    const [item] = await tx
      .update(scopeItems)
      .set({
        name: input.name,
        value: input.value,
        scopeStatus: input.scopeStatus,
        exclusionReason:
          input.scopeStatus === "excluded" ? input.exclusionReason : null,
        testingRestrictions: input.testingRestrictions,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scopeItems.id, input.itemId),
          eq(scopeItems.organisationId, actor.organisationId),
          eq(scopeItems.engagementId, input.engagementId),
          eq(scopeItems.scopeVersionId, input.scopeVersionId),
        ),
      )
      .returning();
    if (!item) throw new WorkspaceScopeError();
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "scope.item.updated",
      targetType: "scope_item",
      targetId: item.id,
      metadata: { engagementId: input.engagementId },
    });
    return item;
  });
}

export async function approveScopeVersion(
  actor: WorkspaceActor,
  input: { engagementId: string; scopeVersionId: string },
) {
  return db.transaction(async (tx) => {
    const version = await requireDraftScope(
      tx,
      actor,
      input.engagementId,
      input.scopeVersionId,
    );
    const items = await tx
      .select({ id: scopeItems.id })
      .from(scopeItems)
      .where(
        and(
          eq(scopeItems.organisationId, actor.organisationId),
          eq(scopeItems.scopeVersionId, input.scopeVersionId),
        ),
      )
      .limit(1);
    if (!items.length)
      throw new WorkspaceTransitionError("Scope cannot be approved empty");
    const [approved] = await tx
      .update(scopeVersions)
      .set({
        status: "approved",
        approvedBy: actor.userId,
        approvedAt: new Date(),
      })
      .where(
        and(
          eq(scopeVersions.id, version.id),
          eq(scopeVersions.status, "draft"),
        ),
      )
      .returning();
    if (!approved)
      throw new WorkspaceTransitionError("Scope version is no longer a draft");
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "scope.version.approved",
      targetType: "scope_version",
      targetId: approved.id,
      metadata: { engagementId: input.engagementId, version: approved.version },
    });
    return approved;
  });
}

export async function createAsset(
  actor: WorkspaceActor,
  input: {
    engagementId: string;
    name: string;
    type: string;
    identifier: string;
    environment?: string;
    owner?: string;
    criticality?: string;
    scopeItemIds?: string[];
  },
) {
  return db.transaction(async (tx) => {
    await requireEngagement(tx, actor, input.engagementId);
    const linkedScope = await requireScopeItemIds(
      tx,
      actor,
      input.engagementId,
      input.scopeItemIds ?? [],
    );
    const [asset] = await tx
      .insert(assets)
      .values({
        organisationId: actor.organisationId,
        engagementId: input.engagementId,
        name: input.name,
        type: input.type,
        identifier: input.identifier,
        environment: input.environment,
        owner: input.owner,
        criticality: input.criticality,
      })
      .returning();
    if (!asset) throw new Error("Unable to create asset");
    if (linkedScope.length) {
      await tx.insert(assetScopeItems).values(
        linkedScope.map(({ id }) => ({
          organisationId: actor.organisationId,
          assetId: asset.id,
          scopeItemId: id,
        })),
      );
    }
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "asset.created",
      targetType: "asset",
      targetId: asset.id,
      metadata: { engagementId: input.engagementId },
    });
    return asset;
  });
}

export async function createRulesVersion(
  actor: WorkspaceActor,
  input: {
    engagementId: string;
    permittedTestTimes?: string;
    sourceIpAddresses?: string[];
    approvedTooling?: string[];
    prohibitedTechniques?: string[];
    stopTestingProcedure?: string;
    escalationProcedure?: string;
    evidenceHandling?: string;
    dataDestruction?: string;
  },
) {
  return db.transaction(async (tx) => {
    await requireEngagement(tx, actor, input.engagementId);
    const [latest] = await tx
      .select({ version: rulesOfEngagement.version })
      .from(rulesOfEngagement)
      .where(
        and(
          eq(rulesOfEngagement.organisationId, actor.organisationId),
          eq(rulesOfEngagement.engagementId, input.engagementId),
        ),
      )
      .orderBy(desc(rulesOfEngagement.version))
      .limit(1);
    const [rules] = await tx
      .insert(rulesOfEngagement)
      .values({
        organisationId: actor.organisationId,
        engagementId: input.engagementId,
        version: (latest?.version ?? 0) + 1,
        permittedTestTimes: input.permittedTestTimes,
        sourceIpAddresses: input.sourceIpAddresses ?? [],
        approvedTooling: input.approvedTooling ?? [],
        prohibitedTechniques: input.prohibitedTechniques ?? [],
        stopTestingProcedure: input.stopTestingProcedure,
        escalationProcedure: input.escalationProcedure,
        evidenceHandling: input.evidenceHandling,
        dataDestruction: input.dataDestruction,
        createdBy: actor.userId,
      })
      .returning();
    if (!rules) throw new Error("Unable to create Rules of Engagement");
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "rules.created",
      targetType: "rules_of_engagement",
      targetId: rules.id,
      metadata: { engagementId: input.engagementId, version: rules.version },
    });
    return rules;
  });
}

export async function approveRules(
  actor: WorkspaceActor,
  input: { engagementId: string; rulesId: string },
) {
  return db.transaction(async (tx) => {
    const [rules] = await tx
      .update(rulesOfEngagement)
      .set({ approvedAt: new Date() })
      .where(
        and(
          eq(rulesOfEngagement.id, input.rulesId),
          eq(rulesOfEngagement.organisationId, actor.organisationId),
          eq(rulesOfEngagement.engagementId, input.engagementId),
          isNull(rulesOfEngagement.approvedAt),
        ),
      )
      .returning();
    if (!rules) throw new WorkspaceScopeError();
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "rules.approved",
      targetType: "rules_of_engagement",
      targetId: rules.id,
      metadata: { engagementId: input.engagementId, version: rules.version },
    });
    return rules;
  });
}

export async function acknowledgeRules(
  actor: WorkspaceActor,
  input: { engagementId: string; rulesId: string },
) {
  return db.transaction(async (tx) => {
    const [rules] = await tx
      .select({ id: rulesOfEngagement.id })
      .from(rulesOfEngagement)
      .innerJoin(
        engagementMembers,
        and(
          eq(engagementMembers.engagementId, rulesOfEngagement.engagementId),
          eq(
            engagementMembers.organisationId,
            rulesOfEngagement.organisationId,
          ),
        ),
      )
      .where(
        and(
          eq(rulesOfEngagement.id, input.rulesId),
          eq(rulesOfEngagement.organisationId, actor.organisationId),
          eq(rulesOfEngagement.engagementId, input.engagementId),
          eq(engagementMembers.userId, actor.userId),
          isNull(engagementMembers.deletedAt),
        ),
      )
      .limit(1);
    if (!rules) throw new WorkspaceScopeError();
    const [approved] = await tx
      .select({ approvedAt: rulesOfEngagement.approvedAt })
      .from(rulesOfEngagement)
      .where(eq(rulesOfEngagement.id, rules.id))
      .limit(1);
    if (!approved?.approvedAt)
      throw new WorkspaceTransitionError("Rules must be approved first");
    const [acknowledgement] = await tx
      .insert(ruleAcknowledgements)
      .values({
        organisationId: actor.organisationId,
        rulesId: rules.id,
        userId: actor.userId,
      })
      .onConflictDoNothing()
      .returning();
    if (acknowledgement) {
      await tx.insert(auditEvents).values({
        organisationId: actor.organisationId,
        actorId: actor.userId,
        action: "rules.acknowledged",
        targetType: "rules_of_engagement",
        targetId: rules.id,
        metadata: { engagementId: input.engagementId },
      });
    }
    return acknowledgement ?? null;
  });
}

export async function assignEngagementMember(
  actor: WorkspaceActor,
  input: { engagementId: string; userId: string; role: Role },
) {
  if (
    !engagementRoles.includes(input.role as (typeof engagementRoles)[number])
  ) {
    throw new WorkspaceTransitionError(
      "Role cannot be assigned to an engagement",
    );
  }
  return db.transaction(async (tx) => {
    await requireEngagement(tx, actor, input.engagementId);
    const [membership] = await tx
      .select({ userId: organisationMembers.userId })
      .from(organisationMembers)
      .where(
        and(
          eq(organisationMembers.organisationId, actor.organisationId),
          eq(organisationMembers.userId, input.userId),
          isNull(organisationMembers.deletedAt),
        ),
      )
      .limit(1);
    if (!membership)
      throw new WorkspaceScopeError("User is not an active member");
    const [assigned] = await tx
      .insert(engagementMembers)
      .values({
        organisationId: actor.organisationId,
        engagementId: input.engagementId,
        userId: input.userId,
        role: input.role,
      })
      .onConflictDoUpdate({
        target: [engagementMembers.engagementId, engagementMembers.userId],
        set: { role: input.role, deletedAt: null, assignedAt: new Date() },
      })
      .returning();
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "engagement.member.assigned",
      targetType: "engagement_member",
      targetId: assigned?.id,
      metadata: {
        engagementId: input.engagementId,
        userId: input.userId,
        role: input.role,
      },
    });
    return assigned;
  });
}

export async function createWorkspaceNote(
  actor: WorkspaceActor,
  input: {
    engagementId: string;
    title: string;
    body: string;
    kind: "note" | "testing_journal";
    visibility?: "private" | "team" | "client";
    assetIds?: string[];
  },
) {
  return db.transaction(async (tx) => {
    await requireEngagement(tx, actor, input.engagementId);
    const linkedAssets = await requireAssetIds(
      tx,
      actor,
      input.engagementId,
      input.assetIds ?? [],
    );
    const [note] = await tx
      .insert(notes)
      .values({
        organisationId: actor.organisationId,
        engagementId: input.engagementId,
        title: input.title,
        kind: input.kind,
        content: { type: "doc", text: input.body },
        visibility: input.visibility ?? "team",
        authorId: actor.userId,
      })
      .returning();
    if (!note) throw new Error("Unable to create note");
    if (linkedAssets.length) {
      await tx.insert(assetNotes).values(
        linkedAssets.map(({ id }) => ({
          organisationId: actor.organisationId,
          assetId: id,
          noteId: note.id,
        })),
      );
    }
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: `${input.kind}.created`,
      targetType: "note",
      targetId: note.id,
      metadata: {
        engagementId: input.engagementId,
        visibility: note.visibility,
      },
    });
    return note;
  });
}

export async function createTimelineEntry(
  actor: WorkspaceActor,
  input: {
    engagementId: string;
    occurredAt: Date;
    phase: string;
    description: string;
    commands?: string;
    clientVisible?: boolean;
  },
) {
  return db.transaction(async (tx) => {
    await requireEngagement(tx, actor, input.engagementId);
    const [entry] = await tx
      .insert(timelineEvents)
      .values({
        organisationId: actor.organisationId,
        engagementId: input.engagementId,
        occurredAt: input.occurredAt,
        phase: input.phase,
        description: input.description,
        commands: input.commands,
        consultantId: actor.userId,
        clientVisible: input.clientVisible ?? false,
      })
      .returning();
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "timeline.entry.created",
      targetType: "timeline_event",
      targetId: entry?.id,
      metadata: { engagementId: input.engagementId },
    });
    return entry;
  });
}

export async function createWorkspaceTask(
  actor: WorkspaceActor,
  input: {
    engagementId: string;
    title: string;
    description?: string;
    priority?: "low" | "normal" | "high" | "urgent";
    assigneeId?: string;
    dueAt?: Date;
    assetIds?: string[];
  },
) {
  return db.transaction(async (tx) => {
    await requireEngagement(tx, actor, input.engagementId);
    if (input.assigneeId) {
      const [assignee] = await tx
        .select({ id: engagementMembers.id })
        .from(engagementMembers)
        .where(
          and(
            eq(engagementMembers.organisationId, actor.organisationId),
            eq(engagementMembers.engagementId, input.engagementId),
            eq(engagementMembers.userId, input.assigneeId),
            isNull(engagementMembers.deletedAt),
          ),
        )
        .limit(1);
      if (!assignee)
        throw new WorkspaceScopeError("Assignee is not on the engagement");
    }
    const linkedAssets = await requireAssetIds(
      tx,
      actor,
      input.engagementId,
      input.assetIds ?? [],
    );
    const [task] = await tx
      .insert(tasks)
      .values({
        organisationId: actor.organisationId,
        engagementId: input.engagementId,
        title: input.title,
        description: input.description,
        priority: input.priority ?? "normal",
        assigneeId: input.assigneeId,
        dueAt: input.dueAt,
        createdBy: actor.userId,
      })
      .returning();
    if (!task) throw new Error("Unable to create task");
    if (linkedAssets.length) {
      await tx.insert(assetTasks).values(
        linkedAssets.map(({ id }) => ({
          organisationId: actor.organisationId,
          assetId: id,
          taskId: task.id,
        })),
      );
    }
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "task.created",
      targetType: "task",
      targetId: task.id,
      metadata: { engagementId: input.engagementId },
    });
    return task;
  });
}

export async function logWorkspaceTime(
  actor: WorkspaceActor,
  input: {
    engagementId: string;
    category: string;
    hours: string;
    description?: string;
    startedAt: Date;
    billable?: boolean;
  },
) {
  const numericHours = Number(input.hours);
  if (
    !Number.isFinite(numericHours) ||
    numericHours <= 0 ||
    numericHours > 24
  ) {
    throw new WorkspaceTransitionError(
      "Hours must be greater than 0 and at most 24",
    );
  }
  return db.transaction(async (tx) => {
    await requireEngagement(tx, actor, input.engagementId);
    const [entry] = await tx
      .insert(timeEntries)
      .values({
        organisationId: actor.organisationId,
        engagementId: input.engagementId,
        userId: actor.userId,
        category: input.category,
        hours: numericHours.toFixed(2),
        description: input.description,
        startedAt: input.startedAt,
        billable: input.billable ?? true,
      })
      .returning();
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "time_entry.created",
      targetType: "time_entry",
      targetId: entry?.id,
      metadata: {
        engagementId: input.engagementId,
        hours: numericHours.toFixed(2),
      },
    });
    return entry;
  });
}

export async function transitionEngagement(
  actor: WorkspaceActor,
  input: { engagementId: string; toStatus: EngagementStatus; reason?: string },
) {
  return db.transaction(async (tx) => {
    const engagement = await requireEngagement(tx, actor, input.engagementId);
    if (!transitionGraph[engagement.status].includes(input.toStatus)) {
      throw new WorkspaceTransitionError(
        `Cannot transition engagement from ${engagement.status} to ${input.toStatus}`,
      );
    }
    const [updated] = await tx
      .update(engagements)
      .set({
        status: input.toStatus,
        version: engagement.version + 1,
        updatedAt: new Date(),
        archivedAt:
          input.toStatus === "archived" ? new Date() : engagement.archivedAt,
      })
      .where(
        and(
          eq(engagements.id, input.engagementId),
          eq(engagements.organisationId, actor.organisationId),
          eq(engagements.version, engagement.version),
        ),
      )
      .returning();
    if (!updated)
      throw new WorkspaceTransitionError(
        "Engagement changed; reload and try again",
      );
    await tx.insert(engagementTransitions).values({
      organisationId: actor.organisationId,
      engagementId: input.engagementId,
      fromStatus: engagement.status,
      toStatus: input.toStatus,
      reason: input.reason,
      actorId: actor.userId,
    });
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "engagement.status.changed",
      targetType: "engagement",
      targetId: input.engagementId,
      previousValues: { status: engagement.status },
      newValues: { status: input.toStatus },
      metadata: { reason: input.reason ?? null },
    });
    return updated;
  });
}

export async function getEngagementWorkspace(
  actor: Pick<WorkspaceActor, "organisationId">,
  engagementId: string,
) {
  const engagement = await db
    .select()
    .from(engagements)
    .where(
      and(
        eq(engagements.id, engagementId),
        eq(engagements.organisationId, actor.organisationId),
        isNull(engagements.deletedAt),
      ),
    )
    .limit(1);
  if (!engagement[0]) return null;
  const [
    scope,
    assetRows,
    rules,
    memberRows,
    availableMembers,
    acknowledgements,
    noteRows,
    timeline,
    taskRows,
    time,
  ] = await Promise.all([
    db
      .select()
      .from(scopeVersions)
      .where(
        and(
          eq(scopeVersions.organisationId, actor.organisationId),
          eq(scopeVersions.engagementId, engagementId),
        ),
      )
      .orderBy(desc(scopeVersions.version)),
    db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.organisationId, actor.organisationId),
          eq(assets.engagementId, engagementId),
          isNull(assets.deletedAt),
        ),
      )
      .orderBy(asc(assets.name)),
    db
      .select()
      .from(rulesOfEngagement)
      .where(
        and(
          eq(rulesOfEngagement.organisationId, actor.organisationId),
          eq(rulesOfEngagement.engagementId, engagementId),
        ),
      )
      .orderBy(desc(rulesOfEngagement.version)),
    db
      .select({
        id: engagementMembers.id,
        userId: engagementMembers.userId,
        role: engagementMembers.role,
        assignedAt: engagementMembers.assignedAt,
        name: users.name,
        email: users.email,
      })
      .from(engagementMembers)
      .innerJoin(users, eq(users.id, engagementMembers.userId))
      .where(
        and(
          eq(engagementMembers.organisationId, actor.organisationId),
          eq(engagementMembers.engagementId, engagementId),
          isNull(engagementMembers.deletedAt),
        ),
      )
      .orderBy(asc(users.name)),
    db
      .select({
        userId: organisationMembers.userId,
        role: organisationMembers.role,
        name: users.name,
        email: users.email,
      })
      .from(organisationMembers)
      .innerJoin(users, eq(users.id, organisationMembers.userId))
      .where(
        and(
          eq(organisationMembers.organisationId, actor.organisationId),
          isNull(organisationMembers.deletedAt),
        ),
      )
      .orderBy(asc(users.name)),
    db
      .select({
        rulesId: ruleAcknowledgements.rulesId,
        userId: ruleAcknowledgements.userId,
        acknowledgedAt: ruleAcknowledgements.acknowledgedAt,
      })
      .from(ruleAcknowledgements)
      .innerJoin(
        rulesOfEngagement,
        eq(rulesOfEngagement.id, ruleAcknowledgements.rulesId),
      )
      .where(
        and(
          eq(ruleAcknowledgements.organisationId, actor.organisationId),
          eq(rulesOfEngagement.engagementId, engagementId),
        ),
      ),
    db
      .select()
      .from(notes)
      .where(
        and(
          eq(notes.organisationId, actor.organisationId),
          eq(notes.engagementId, engagementId),
          isNull(notes.deletedAt),
        ),
      )
      .orderBy(desc(notes.createdAt)),
    db
      .select()
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.organisationId, actor.organisationId),
          eq(timelineEvents.engagementId, engagementId),
        ),
      )
      .orderBy(desc(timelineEvents.occurredAt)),
    db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, actor.organisationId),
          eq(tasks.engagementId, engagementId),
        ),
      )
      .orderBy(desc(tasks.createdAt)),
    db
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.organisationId, actor.organisationId),
          eq(timeEntries.engagementId, engagementId),
        ),
      )
      .orderBy(desc(timeEntries.startedAt)),
  ]);
  const currentScope = scope[0];
  const currentScopeItems = currentScope
    ? await db
        .select()
        .from(scopeItems)
        .where(
          and(
            eq(scopeItems.organisationId, actor.organisationId),
            eq(scopeItems.scopeVersionId, currentScope.id),
          ),
        )
        .orderBy(asc(scopeItems.name))
    : [];
  return {
    engagement: engagement[0],
    scopeVersions: scope,
    currentScope,
    currentScopeItems,
    assets: assetRows,
    rules,
    members: memberRows,
    availableMembers,
    ruleAcknowledgements: acknowledgements,
    notes: noteRows,
    timeline,
    tasks: taskRows,
    timeEntries: time,
  };
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function requireEngagement(
  tx: Transaction,
  actor: Pick<WorkspaceActor, "organisationId">,
  engagementId: string,
) {
  const [engagement] = await tx
    .select()
    .from(engagements)
    .where(
      and(
        eq(engagements.id, engagementId),
        eq(engagements.organisationId, actor.organisationId),
        isNull(engagements.deletedAt),
      ),
    )
    .limit(1);
  if (!engagement) throw new WorkspaceScopeError();
  return engagement;
}

async function requireDraftScope(
  tx: Transaction,
  actor: WorkspaceActor,
  engagementId: string,
  scopeVersionId: string,
) {
  await requireEngagement(tx, actor, engagementId);
  const [version] = await tx
    .select()
    .from(scopeVersions)
    .where(
      and(
        eq(scopeVersions.id, scopeVersionId),
        eq(scopeVersions.organisationId, actor.organisationId),
        eq(scopeVersions.engagementId, engagementId),
        eq(scopeVersions.status, "draft"),
      ),
    )
    .limit(1);
  if (!version)
    throw new WorkspaceTransitionError("Scope version is not editable");
  return version;
}

async function requireScopeItemIds(
  tx: Transaction,
  actor: Pick<WorkspaceActor, "organisationId">,
  engagementId: string,
  ids: string[],
): Promise<Array<{ id: string }>> {
  if (!ids.length) return [];
  const uniqueIds = [...new Set(ids)];
  const rows = await tx
    .select({ id: scopeItems.id })
    .from(scopeItems)
    .where(
      and(
        eq(scopeItems.organisationId, actor.organisationId),
        eq(scopeItems.engagementId, engagementId),
        inArray(scopeItems.id, uniqueIds),
      ),
    );
  if (rows.length !== uniqueIds.length) throw new WorkspaceScopeError();
  return rows;
}

async function requireAssetIds(
  tx: Transaction,
  actor: Pick<WorkspaceActor, "organisationId">,
  engagementId: string,
  ids: string[],
): Promise<Array<{ id: string }>> {
  if (!ids.length) return [];
  const uniqueIds = [...new Set(ids)];
  const rows = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.organisationId, actor.organisationId),
        eq(assets.engagementId, engagementId),
        inArray(assets.id, uniqueIds),
        isNull(assets.deletedAt),
      ),
    );
  if (rows.length !== uniqueIds.length) throw new WorkspaceScopeError();
  return rows;
}
