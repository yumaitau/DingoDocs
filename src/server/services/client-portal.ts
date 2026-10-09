import "server-only";

import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  clientContacts,
  comments,
  engagementContacts,
  engagements,
  evidence,
  findings,
  findingTransitions,
  findingVersions,
  remediationUpdates,
  reports,
  reportReviews,
  reportTransitions,
  reportVersions,
  retestAttempts,
  retestEvidence,
  retestNotes,
  scopeItems,
  scopeVersions,
} from "@/db/schema";
import {
  PortalNotFoundError,
  portalEngagementQuery,
  requirePortalEngagement,
} from "@/lib/permissions/portal";
import {
  assertEngagementAccess,
  PermissionDeniedError,
  requireActorPermission,
} from "@/lib/permissions/require";
import { CommentError, createComment, replyComment } from "./comments";
import { emitDomainEvent, withClientAudience } from "./domain-events";
import { createReportRevision } from "./reports";

export type PortalActor = { organisationId: string; userId: string };
export type RemediationStatus =
  | "open"
  | "in_progress"
  | "remediated"
  | "partially_remediated"
  | "not_remediated"
  | "risk_accepted";
export type RetestOutcome =
  | "fixed"
  | "partially_remediated"
  | "not_remediated"
  | "risk_accepted"
  | "unable_to_verify";

const visibleFindingStatuses = [
  "published",
  "remediation_in_progress",
  "ready_for_retest",
  "retested",
  "resolved",
  "risk_accepted",
  "closed",
] as const;

export { PortalNotFoundError } from "@/lib/permissions/portal";

export async function listPortalEngagements(actor: PortalActor) {
  return portalEngagementQuery(actor).orderBy(asc(engagements.name));
}

export async function getPortalEngagement(
  actor: PortalActor,
  engagementId: string,
) {
  const engagement = await requirePortalEngagement(actor, engagementId);
  const approvedScopes = await db
    .select()
    .from(scopeVersions)
    .where(
      and(
        eq(scopeVersions.organisationId, actor.organisationId),
        eq(scopeVersions.engagementId, engagementId),
        eq(scopeVersions.status, "approved"),
      ),
    )
    .orderBy(desc(scopeVersions.version))
    .limit(1);
  const approvedScope = approvedScopes[0];
  const [scope, visibleFindings, visibleReports, visibleEvidence] =
    await Promise.all([
      approvedScope
        ? db
            .select({
              id: scopeItems.id,
              name: scopeItems.name,
              type: scopeItems.type,
              value: scopeItems.value,
              environment: scopeItems.environment,
              scopeStatus: scopeItems.scopeStatus,
              exclusionReason: scopeItems.exclusionReason,
              testingRestrictions: scopeItems.testingRestrictions,
              approvedMethods: scopeItems.approvedMethods,
            })
            .from(scopeItems)
            .where(
              and(
                eq(scopeItems.organisationId, actor.organisationId),
                eq(scopeItems.engagementId, engagementId),
                eq(scopeItems.scopeVersionId, approvedScope.id),
              ),
            )
        : Promise.resolve([]),
      db
        .select({
          id: findings.id,
          identifier: findings.identifier,
          title: findings.title,
          status: findings.status,
          severity: findings.severity,
          executiveSummary: findings.executiveSummary,
          businessImpact: findings.businessImpact,
          remediation: findings.remediation,
          verificationGuidance: findings.verificationGuidance,
          clientOwner: findings.clientOwner,
          dueAt: findings.dueAt,
          retestStatus: findings.retestStatus,
          version: findings.version,
          publishedAt: findings.publishedAt,
        })
        .from(findings)
        .where(
          and(
            eq(findings.organisationId, actor.organisationId),
            eq(findings.engagementId, engagementId),
            eq(findings.clientVisible, true),
            isNotNull(findings.publishedAt),
            inArray(findings.status, [...visibleFindingStatuses]),
            isNull(findings.deletedAt),
          ),
        )
        .orderBy(asc(findings.identifier)),
      db
        .select({
          id: reports.id,
          title: reports.title,
          reportStatus: reports.status,
          versionId: reportVersions.id,
          version: reportVersions.version,
          versionStatus: reportVersions.status,
          content: reportVersions.content,
          publishedAt: reportVersions.publishedAt,
          clientApprovedAt: reportVersions.clientApprovedAt,
        })
        .from(reports)
        .innerJoin(
          reportVersions,
          and(
            eq(reportVersions.reportId, reports.id),
            eq(reportVersions.organisationId, reports.organisationId),
          ),
        )
        .where(
          and(
            eq(reports.organisationId, actor.organisationId),
            eq(reports.engagementId, engagementId),
            eq(reports.clientId, engagement.clientId),
            eq(reportVersions.clientVisible, true),
            inArray(reportVersions.status, [
              "client_review",
              "approved",
              "published",
              "superseded",
            ]),
          ),
        )
        .orderBy(asc(reports.title), desc(reportVersions.version)),
      db
        .select({
          id: evidence.id,
          originalFilename: evidence.originalFilename,
          mediaType: evidence.mediaType,
          sizeBytes: evidence.sizeBytes,
          sha256: evidence.sha256,
          version: evidence.version,
          createdAt: evidence.createdAt,
        })
        .from(evidence)
        .where(
          and(
            eq(evidence.organisationId, actor.organisationId),
            eq(evidence.clientId, engagement.clientId),
            eq(evidence.engagementId, engagementId),
            eq(evidence.classification, "client_visible"),
            isNull(evidence.deletedAt),
            isNull(evidence.quarantinedAt),
          ),
        )
        .orderBy(desc(evidence.createdAt)),
    ]);

  const findingIds = visibleFindings.map((item) => item.id);
  const reportIds = [...new Set(visibleReports.map((item) => item.id))];
  const targetIds = [...findingIds, ...reportIds];
  const [clientComments, updates, attempts] = await Promise.all([
    targetIds.length
      ? db
          .select({
            id: comments.id,
            targetType: comments.targetType,
            targetId: comments.targetId,
            body: comments.body,
            parentId: comments.parentId,
            mentions: comments.mentions,
            authorId: comments.authorId,
            createdAt: comments.createdAt,
            editedAt: comments.editedAt,
          })
          .from(comments)
          .where(
            and(
              eq(comments.organisationId, actor.organisationId),
              eq(comments.visibility, "client"),
              inArray(comments.targetId, targetIds),
              isNull(comments.deletedAt),
            ),
          )
          .orderBy(asc(comments.createdAt))
      : Promise.resolve([]),
    findingIds.length
      ? db
          .select()
          .from(remediationUpdates)
          .where(
            and(
              eq(remediationUpdates.organisationId, actor.organisationId),
              inArray(remediationUpdates.findingId, findingIds),
            ),
          )
          .orderBy(asc(remediationUpdates.createdAt))
      : Promise.resolve([]),
    findingIds.length
      ? db
          .select()
          .from(retestAttempts)
          .where(
            and(
              eq(retestAttempts.organisationId, actor.organisationId),
              inArray(retestAttempts.findingId, findingIds),
            ),
          )
          .orderBy(desc(retestAttempts.requestedAt))
      : Promise.resolve([]),
  ]);
  const attemptIds = attempts.map((item) => item.id);
  const clientRetestNotes = attemptIds.length
    ? await db
        .select()
        .from(retestNotes)
        .where(
          and(
            eq(retestNotes.organisationId, actor.organisationId),
            inArray(retestNotes.retestAttemptId, attemptIds),
            eq(retestNotes.visibility, "client"),
          ),
        )
        .orderBy(asc(retestNotes.createdAt))
    : [];

  return {
    engagement,
    approvedScope: approvedScope ?? null,
    scope,
    findings: visibleFindings,
    reports: visibleReports,
    evidence: visibleEvidence,
    comments: clientComments,
    remediationUpdates: updates,
    retestAttempts: attempts,
    retestNotes: clientRetestNotes,
    analytics: buildPortalAnalytics(visibleFindings, updates, attempts),
  };
}

export function buildPortalAnalytics(
  findings: Array<{
    id: string;
    severity: string;
    status: string;
    dueAt: Date | null;
  }>,
  remediationUpdates: Array<{
    findingId: string;
    status: string;
    createdAt: Date;
  }>,
  retestAttempts: Array<{
    findingId: string;
    outcome: string | null;
    completedAt?: Date | null;
  }>,
) {
  const closed = new Set(["resolved", "closed", "risk_accepted"]);
  const openFindings = findings.filter((finding) => !closed.has(finding.status));
  const openBySeverity: Record<string, number> = {};
  for (const finding of openFindings) {
    openBySeverity[finding.severity] = (openBySeverity[finding.severity] ?? 0) + 1;
  }
  const latestRemediation = new Map<string, string>();
  const sortedUpdates = [...remediationUpdates].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  for (const update of sortedUpdates) {
    latestRemediation.set(update.findingId, update.status);
  }
  const remediationStatusCounts: Record<string, number> = {};
  for (const finding of findings) {
    const status = latestRemediation.get(finding.id) ?? "open";
    remediationStatusCounts[status] = (remediationStatusCounts[status] ?? 0) + 1;
  }
  const retestOutcomeCounts: Record<string, number> = {};
  for (const attempt of retestAttempts) {
    if (!attempt.outcome) continue;
    retestOutcomeCounts[attempt.outcome] =
      (retestOutcomeCounts[attempt.outcome] ?? 0) + 1;
  }
  const now = Date.now();
  const overdueCount = findings.filter(
    (finding) =>
      finding.dueAt != null &&
      finding.dueAt.getTime() < now &&
      !closed.has(finding.status),
  ).length;
  return {
    openBySeverity,
    remediationStatusCounts,
    retestOutcomeCounts,
    overdueCount,
    openCount: openFindings.length,
  };
}

async function requireVisibleFinding(actor: PortalActor, findingId: string) {
  const rows = await db
    .select({ finding: findings, engagementId: findings.engagementId })
    .from(findings)
    .where(
      and(
        eq(findings.id, findingId),
        eq(findings.organisationId, actor.organisationId),
        eq(findings.clientVisible, true),
        isNotNull(findings.publishedAt),
        inArray(findings.status, [...visibleFindingStatuses]),
        isNull(findings.deletedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new PortalNotFoundError();
  await requirePortalEngagement(actor, rows[0].engagementId, true);
  return rows[0].finding;
}

export async function addPortalComment(
  actor: PortalActor,
  input: {
    targetType: "finding" | "report";
    targetId: string;
    body: string;
    parentId?: string;
  },
) {
  let title = "Comment added";
  let actionUrl: string | undefined;
  if (input.targetType === "finding") {
    const finding = await requireVisibleFinding(actor, input.targetId);
    title = `Comment on ${finding.identifier}`;
    actionUrl = `/engagements/${finding.engagementId}?view=findings`;
  } else {
    const row = await db
      .select({ engagementId: reports.engagementId })
      .from(reports)
      .innerJoin(
        reportVersions,
        and(
          eq(reportVersions.reportId, reports.id),
          eq(reportVersions.version, reports.currentVersion),
          eq(reportVersions.clientVisible, true),
        ),
      )
      .where(
        and(
          eq(reports.id, input.targetId),
          eq(reports.organisationId, actor.organisationId),
          inArray(reportVersions.status, [
            "client_review",
            "approved",
            "published",
          ]),
        ),
      )
      .limit(1);
    if (!row[0]) throw new PortalNotFoundError();
    await requirePortalEngagement(actor, row[0].engagementId, true);
    title = "Comment on report";
    actionUrl = `/reports/${input.targetId}`;
  }
  try {
    if (input.parentId) {
      return await replyComment(actor, {
        parentId: input.parentId,
        body: input.body,
        targetType: input.targetType,
        targetId: input.targetId,
        visibility: "client",
        title,
        actionUrl,
      });
    }
    return await createComment(actor, {
      targetType: input.targetType,
      targetId: input.targetId,
      body: input.body,
      visibility: "client",
      title,
      actionUrl,
    });
  } catch (error) {
    if (error instanceof CommentError) throw new PortalNotFoundError();
    throw error;
  }
}

export async function submitRemediationUpdate(
  actor: PortalActor,
  input: {
    findingId: string;
    status: RemediationStatus;
    owner?: string;
    note?: string;
  },
) {
  const finding = await requireVisibleFinding(actor, input.findingId);
  const nextFindingStatus =
    input.status === "remediated"
      ? "ready_for_retest"
      : input.status === "risk_accepted"
        ? "risk_accepted"
        : input.status === "open"
          ? finding.status
          : "remediation_in_progress";
  const update = await db.transaction(async (tx) => {
    const [update] = await tx
      .insert(remediationUpdates)
      .values({
        organisationId: actor.organisationId,
        findingId: finding.id,
        submittedBy: actor.userId,
        status: input.status,
        owner: input.owner?.trim() || null,
        note: input.note?.trim() || null,
      })
      .returning();
    await tx
      .update(findings)
      .set({
        clientOwner: input.owner?.trim() || finding.clientOwner,
        status: nextFindingStatus,
        retestStatus:
          input.status === "remediated"
            ? "requested_by_client"
            : finding.retestStatus,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(findings.id, finding.id),
          eq(findings.organisationId, actor.organisationId),
        ),
      );
    if (nextFindingStatus !== finding.status) {
      await tx.insert(findingTransitions).values({
        organisationId: actor.organisationId,
        findingId: finding.id,
        fromStatus: finding.status,
        toStatus: nextFindingStatus,
        actorId: actor.userId,
        comment: input.note,
        findingVersion: finding.version,
        overrideReason: "Client remediation update",
      });
    }
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "portal.remediation_updated",
      targetType: "finding",
      targetId: finding.id,
      previousValues: {
        status: finding.status,
        clientOwner: finding.clientOwner,
      },
      newValues: {
        remediationStatus: input.status,
        findingStatus: nextFindingStatus,
        clientOwner: input.owner,
      },
    });
    return update;
  });
  await emitDomainEvent({
    organisationId: actor.organisationId,
    actorUserId: actor.userId,
    eventType: "remediation.submitted",
    title: `Remediation submitted for ${finding.identifier}`,
    actionUrl: `/engagements/${finding.engagementId}?view=findings`,
    payload: {
      updateId: update.id,
      findingId: finding.id,
      identifier: finding.identifier,
      status: input.status,
    },
  });
  return update;
}

export async function requestRetest(
  actor: PortalActor,
  findingId: string,
  note?: string,
) {
  const finding = await requireVisibleFinding(actor, findingId);
  const [latestRemediation] = await db
    .select()
    .from(remediationUpdates)
    .where(
      and(
        eq(remediationUpdates.organisationId, actor.organisationId),
        eq(remediationUpdates.findingId, findingId),
      ),
    )
    .orderBy(desc(remediationUpdates.createdAt))
    .limit(1);
  const [attempt] = await db
    .insert(retestAttempts)
    .values({
      organisationId: actor.organisationId,
      findingId,
      requestedBy: actor.userId,
      status: "requested",
      notes: note?.trim() || null,
      originalFindingVersion: finding.version,
      originalSnapshot: { ...finding },
      remediationSnapshot: latestRemediation ? { ...latestRemediation } : {},
    })
    .returning();
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "portal.retest_requested",
    targetType: "retest_attempt",
    targetId: attempt!.id,
    metadata: { findingId, findingVersion: finding.version },
  });
  await emitDomainEvent({
    organisationId: actor.organisationId,
    actorUserId: actor.userId,
    eventType: "retest.requested",
    title: `Retest requested for ${finding.identifier}`,
    actionUrl: `/engagements/${finding.engagementId}?view=findings`,
    payload: {
      attemptId: attempt!.id,
      findingId: finding.id,
      identifier: finding.identifier,
    },
  });
  return attempt;
}

export async function approvePortalReport(
  actor: PortalActor,
  reportId: string,
) {
  const rows = await db
    .select({ report: reports, version: reportVersions })
    .from(reports)
    .innerJoin(
      reportVersions,
      and(
        eq(reportVersions.reportId, reports.id),
        eq(reportVersions.version, reports.currentVersion),
        eq(reportVersions.organisationId, reports.organisationId),
      ),
    )
    .where(
      and(
        eq(reports.id, reportId),
        eq(reports.organisationId, actor.organisationId),
        eq(reports.status, "client_review"),
        eq(reportVersions.status, "client_review"),
        eq(reportVersions.clientVisible, true),
      ),
    )
    .limit(1);
  const current = rows[0];
  if (!current) throw new PortalNotFoundError();
  await requirePortalEngagement(actor, current.report.engagementId, true);
  return db.transaction(async (tx) => {
    const now = new Date();
    const [version] = await tx
      .update(reportVersions)
      .set({
        status: "approved",
        clientApprovedBy: actor.userId,
        clientApprovedAt: now,
      })
      .where(eq(reportVersions.id, current.version.id))
      .returning();
    await tx
      .update(reports)
      .set({ status: "approved", updatedAt: now })
      .where(eq(reports.id, reportId));
    await tx.insert(reportReviews).values({
      organisationId: actor.organisationId,
      reportVersionId: current.version.id,
      reviewerId: actor.userId,
      decision: "client_approved",
    });
    await tx.insert(reportTransitions).values({
      organisationId: actor.organisationId,
      reportId,
      reportVersionId: current.version.id,
      fromStatus: "client_review",
      toStatus: "approved",
      actorId: actor.userId,
      comment: "Approved in the client portal",
    });
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "portal.report_approved",
      targetType: "report",
      targetId: reportId,
      metadata: { reportVersionId: current.version.id },
    });
    return version;
  });
}

async function requireInternalRetest(actor: PortalActor, attemptId: string) {
  const rows = await db
    .select({ attempt: retestAttempts, finding: findings })
    .from(retestAttempts)
    .innerJoin(
      findings,
      and(
        eq(findings.id, retestAttempts.findingId),
        eq(findings.organisationId, retestAttempts.organisationId),
      ),
    )
    .where(
      and(
        eq(retestAttempts.id, attemptId),
        eq(retestAttempts.organisationId, actor.organisationId),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new PortalNotFoundError();
  await assertEngagementAccess({
    userId: actor.userId,
    organisationId: actor.organisationId,
    engagementId: rows[0].finding.engagementId,
  });
  return rows[0];
}

export async function scheduleRetest(
  actor: PortalActor,
  input: { attemptId: string; assignedTo: string; scheduledFor: Date },
) {
  const { finding } = await requireInternalRetest(actor, input.attemptId);
  const [attempt] = await db
    .update(retestAttempts)
    .set({
      assignedTo: input.assignedTo,
      scheduledFor: input.scheduledFor,
      status: "scheduled",
    })
    .where(
      and(
        eq(retestAttempts.id, input.attemptId),
        eq(retestAttempts.organisationId, actor.organisationId),
      ),
    )
    .returning();
  if (attempt) {
    await emitDomainEvent({
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      eventType: "retest.scheduled",
      title: `Retest scheduled for ${finding.identifier}`,
      actionUrl: `/engagements/${finding.engagementId}?view=findings`,
      payload: {
        attemptId: attempt.id,
        findingId: finding.id,
        identifier: finding.identifier,
      },
    });
  }
  return attempt;
}

export async function addRetestNote(
  actor: PortalActor,
  input: { attemptId: string; body: string; visibility: "internal" | "client" },
) {
  await requireInternalRetest(actor, input.attemptId);
  const [note] = await db
    .insert(retestNotes)
    .values({
      organisationId: actor.organisationId,
      retestAttemptId: input.attemptId,
      authorId: actor.userId,
      visibility: input.visibility,
      body: input.body.trim(),
    })
    .returning();
  return note;
}

export async function attachRetestEvidence(
  actor: PortalActor,
  input: { attemptId: string; evidenceId: string },
) {
  const { finding } = await requireInternalRetest(actor, input.attemptId);
  const rows = await db
    .select({ id: evidence.id })
    .from(evidence)
    .where(
      and(
        eq(evidence.id, input.evidenceId),
        eq(evidence.organisationId, actor.organisationId),
        eq(evidence.engagementId, finding.engagementId),
        isNull(evidence.deletedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new PortalNotFoundError();
  await db.insert(retestEvidence).values({
    organisationId: actor.organisationId,
    retestAttemptId: input.attemptId,
    evidenceId: input.evidenceId,
  });
}

export async function completeRetest(
  actor: PortalActor,
  input: {
    attemptId: string;
    outcome: RetestOutcome;
    notes?: string;
    comparison: Record<string, unknown>;
  },
) {
  const current = await requireInternalRetest(actor, input.attemptId);
  const nextStatus =
    input.outcome === "fixed"
      ? "resolved"
      : input.outcome === "risk_accepted"
        ? "risk_accepted"
        : "retested";
  const nextVersion = current.finding.version + 1;
  await db.transaction(async (tx) => {
    await tx
      .update(retestAttempts)
      .set({
        status: "completed",
        outcome: input.outcome,
        notes: input.notes?.trim() || current.attempt.notes,
        comparison: input.comparison,
        completedAt: new Date(),
      })
      .where(eq(retestAttempts.id, input.attemptId));
    const snapshot = {
      ...current.finding,
      status: nextStatus,
      retestStatus: input.outcome,
      version: nextVersion,
    };
    await tx.insert(findingVersions).values({
      organisationId: actor.organisationId,
      findingId: current.finding.id,
      version: nextVersion,
      snapshot,
      changedBy: actor.userId,
      changeSummary: `Retest completed: ${input.outcome}`,
    });
    await tx
      .update(findings)
      .set({
        status: nextStatus,
        retestStatus: input.outcome,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(findings.id, current.finding.id));
    await tx.insert(findingTransitions).values({
      organisationId: actor.organisationId,
      findingId: current.finding.id,
      fromStatus: current.finding.status,
      toStatus: nextStatus,
      actorId: actor.userId,
      comment: input.notes,
      findingVersion: nextVersion,
      overrideReason: "Retest outcome",
    });
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "retest.completed",
      targetType: "retest_attempt",
      targetId: input.attemptId,
      metadata: {
        findingId: current.finding.id,
        originalFindingVersion: current.attempt.originalFindingVersion,
        resultFindingVersion: nextVersion,
        outcome: input.outcome,
      },
    });
  });
  await emitDomainEvent(
    withClientAudience({
      organisationId: actor.organisationId,
      actorUserId: actor.userId,
      eventType: "retest.completed",
      title: `Retest completed for ${current.finding.identifier}`,
      actionUrl: `/engagements/${current.finding.engagementId}?view=findings`,
      payload: {
        attemptId: input.attemptId,
        findingId: current.finding.id,
        identifier: current.finding.identifier,
        outcome: input.outcome,
      },
    }),
  );

  const published = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.organisationId, actor.organisationId),
        eq(reports.engagementId, current.finding.engagementId),
        eq(reports.status, "published"),
      ),
    )
    .orderBy(desc(reports.updatedAt))
    .limit(1);
  if (published[0]) {
    try {
      await requireActorPermission(actor, "report:publish", {
        engagementId: current.finding.engagementId,
      });
      const revision = await createReportRevision(actor, published[0].id);
      await db
        .update(retestAttempts)
        .set({ updatedReportVersionId: revision.id })
        .where(eq(retestAttempts.id, input.attemptId));
    } catch (error) {
      if (!(error instanceof PermissionDeniedError)) throw error;
    }
  }
  return requireInternalRetest(actor, input.attemptId);
}

export async function getEngagementRetests(
  actor: Pick<PortalActor, "organisationId">,
  engagementId: string,
) {
  const attempts = await db
    .select({ attempt: retestAttempts, finding: findings })
    .from(retestAttempts)
    .innerJoin(
      findings,
      and(
        eq(findings.id, retestAttempts.findingId),
        eq(findings.organisationId, retestAttempts.organisationId),
      ),
    )
    .where(
      and(
        eq(retestAttempts.organisationId, actor.organisationId),
        eq(findings.engagementId, engagementId),
        isNull(findings.deletedAt),
      ),
    )
    .orderBy(desc(retestAttempts.requestedAt));
  const attemptIds = attempts.map((row) => row.attempt.id);
  const [notes, attachments, availableEvidence] = await Promise.all([
    attemptIds.length
      ? db
          .select()
          .from(retestNotes)
          .where(
            and(
              eq(retestNotes.organisationId, actor.organisationId),
              inArray(retestNotes.retestAttemptId, attemptIds),
            ),
          )
          .orderBy(asc(retestNotes.createdAt))
      : Promise.resolve([]),
    attemptIds.length
      ? db
          .select({
            retestAttemptId: retestEvidence.retestAttemptId,
            evidenceId: evidence.id,
            filename: evidence.originalFilename,
            classification: evidence.classification,
          })
          .from(retestEvidence)
          .innerJoin(evidence, eq(evidence.id, retestEvidence.evidenceId))
          .where(
            and(
              eq(retestEvidence.organisationId, actor.organisationId),
              inArray(retestEvidence.retestAttemptId, attemptIds),
            ),
          )
      : Promise.resolve([]),
    db
      .select({ id: evidence.id, filename: evidence.originalFilename })
      .from(evidence)
      .where(
        and(
          eq(evidence.organisationId, actor.organisationId),
          eq(evidence.engagementId, engagementId),
          isNull(evidence.deletedAt),
          isNull(evidence.quarantinedAt),
        ),
      )
      .orderBy(desc(evidence.createdAt)),
  ]);
  return { attempts, notes, attachments, availableEvidence };
}

export async function getPortalAdministration(
  actor: Pick<PortalActor, "organisationId">,
  engagementId: string,
) {
  const engagement = await db
    .select({ id: engagements.id, clientId: engagements.clientId })
    .from(engagements)
    .where(
      and(
        eq(engagements.id, engagementId),
        eq(engagements.organisationId, actor.organisationId),
        isNull(engagements.deletedAt),
      ),
    )
    .limit(1);
  if (!engagement[0]) throw new PortalNotFoundError();
  const [contacts, grants, portalFindings, portalReports] = await Promise.all([
    db
      .select({
        id: clientContacts.id,
        name: clientContacts.name,
        email: clientContacts.email,
        role: clientContacts.role,
      })
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.organisationId, actor.organisationId),
          eq(clientContacts.clientId, engagement[0].clientId),
          isNotNull(clientContacts.userId),
          isNull(clientContacts.deletedAt),
        ),
      )
      .orderBy(asc(clientContacts.name)),
    db
      .select({
        id: engagementContacts.id,
        contactId: engagementContacts.contactId,
        accessLevel: engagementContacts.accessLevel,
        name: clientContacts.name,
        email: clientContacts.email,
      })
      .from(engagementContacts)
      .innerJoin(
        clientContacts,
        and(
          eq(clientContacts.id, engagementContacts.contactId),
          eq(clientContacts.organisationId, engagementContacts.organisationId),
        ),
      )
      .where(
        and(
          eq(engagementContacts.organisationId, actor.organisationId),
          eq(engagementContacts.engagementId, engagementId),
          eq(clientContacts.clientId, engagement[0].clientId),
          isNull(clientContacts.deletedAt),
        ),
      )
      .orderBy(asc(clientContacts.name)),
    db
      .select({
        id: findings.id,
        identifier: findings.identifier,
        title: findings.title,
        status: findings.status,
        publishedAt: findings.publishedAt,
        clientVisible: findings.clientVisible,
      })
      .from(findings)
      .where(
        and(
          eq(findings.organisationId, actor.organisationId),
          eq(findings.engagementId, engagementId),
          isNull(findings.deletedAt),
        ),
      )
      .orderBy(asc(findings.identifier)),
    db
      .select({
        reportId: reports.id,
        title: reports.title,
        reportStatus: reports.status,
        versionId: reportVersions.id,
        version: reportVersions.version,
        versionStatus: reportVersions.status,
        clientVisible: reportVersions.clientVisible,
      })
      .from(reports)
      .innerJoin(
        reportVersions,
        and(
          eq(reportVersions.reportId, reports.id),
          eq(reportVersions.organisationId, reports.organisationId),
          eq(reportVersions.version, reports.currentVersion),
        ),
      )
      .where(
        and(
          eq(reports.organisationId, actor.organisationId),
          eq(reports.engagementId, engagementId),
        ),
      )
      .orderBy(asc(reports.title)),
  ]);
  return {
    clientId: engagement[0].clientId,
    contacts,
    grants,
    findings: portalFindings,
    reports: portalReports,
  };
}

export async function grantPortalAccess(
  actor: PortalActor,
  input: { engagementId: string; contactId: string; accessLevel: string },
) {
  const administration = await getPortalAdministration(
    actor,
    input.engagementId,
  );
  if (
    !administration.contacts.some((contact) => contact.id === input.contactId)
  )
    throw new PortalNotFoundError();
  const [grant] = await db
    .insert(engagementContacts)
    .values({
      organisationId: actor.organisationId,
      engagementId: input.engagementId,
      contactId: input.contactId,
      accessLevel: input.accessLevel,
    })
    .onConflictDoUpdate({
      target: [engagementContacts.engagementId, engagementContacts.contactId],
      set: { accessLevel: input.accessLevel },
    })
    .returning();
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "portal.access_granted",
    targetType: "engagement",
    targetId: input.engagementId,
    metadata: { contactId: input.contactId, accessLevel: input.accessLevel },
  });
  return grant;
}

export async function revokePortalAccess(
  actor: PortalActor,
  input: { engagementId: string; grantId: string },
) {
  const grant = await db
    .delete(engagementContacts)
    .where(
      and(
        eq(engagementContacts.id, input.grantId),
        eq(engagementContacts.engagementId, input.engagementId),
        eq(engagementContacts.organisationId, actor.organisationId),
      ),
    )
    .returning();
  if (!grant[0]) throw new PortalNotFoundError();
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "portal.access_revoked",
    targetType: "engagement",
    targetId: grant[0].engagementId,
    metadata: { contactId: grant[0].contactId },
  });
  return grant[0];
}

export async function setFindingPortalVisibility(
  actor: PortalActor,
  input: { engagementId: string; findingId: string; visible: boolean },
) {
  const rows = await db
    .select({ id: findings.id, publishedAt: findings.publishedAt })
    .from(findings)
    .where(
      and(
        eq(findings.id, input.findingId),
        eq(findings.organisationId, actor.organisationId),
        eq(findings.engagementId, input.engagementId),
        isNull(findings.deletedAt),
      ),
    )
    .limit(1);
  if (!rows[0] || (input.visible && !rows[0].publishedAt))
    throw new PortalNotFoundError();
  await db
    .update(findings)
    .set({ clientVisible: input.visible, updatedAt: new Date() })
    .where(eq(findings.id, input.findingId));
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: input.visible ? "portal.finding_shared" : "portal.finding_hidden",
    targetType: "finding",
    targetId: input.findingId,
    metadata: { engagementId: input.engagementId },
  });
}

export async function setReportPortalVisibility(
  actor: PortalActor,
  input: { engagementId: string; reportVersionId: string; visible: boolean },
) {
  const rows = await db
    .select({ id: reportVersions.id, status: reportVersions.status })
    .from(reportVersions)
    .innerJoin(
      reports,
      and(
        eq(reports.id, reportVersions.reportId),
        eq(reports.organisationId, reportVersions.organisationId),
      ),
    )
    .where(
      and(
        eq(reportVersions.id, input.reportVersionId),
        eq(reportVersions.organisationId, actor.organisationId),
        eq(reports.engagementId, input.engagementId),
      ),
    )
    .limit(1);
  if (
    !rows[0] ||
    (input.visible &&
      !["client_review", "approved", "published", "superseded"].includes(
        rows[0].status,
      ))
  )
    throw new PortalNotFoundError();
  await db
    .update(reportVersions)
    .set({ clientVisible: input.visible })
    .where(eq(reportVersions.id, input.reportVersionId));
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: input.visible ? "portal.report_shared" : "portal.report_hidden",
    targetType: "report_version",
    targetId: input.reportVersionId,
    metadata: { engagementId: input.engagementId },
  });
}

export async function getPortalReportVersion(
  actor: PortalActor,
  reportVersionId: string,
) {
  const rows = await db
    .select({
      reportId: reports.id,
      engagementId: reports.engagementId,
      title: reports.title,
      versionId: reportVersions.id,
      version: reportVersions.version,
      status: reportVersions.status,
      content: reportVersions.content,
      exportKeys: reportVersions.exportKeys,
    })
    .from(reportVersions)
    .innerJoin(
      reports,
      and(
        eq(reports.id, reportVersions.reportId),
        eq(reports.organisationId, reportVersions.organisationId),
      ),
    )
    .where(
      and(
        eq(reportVersions.id, reportVersionId),
        eq(reportVersions.organisationId, actor.organisationId),
        eq(reportVersions.clientVisible, true),
        inArray(reportVersions.status, [
          "client_review",
          "approved",
          "published",
          "superseded",
        ]),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new PortalNotFoundError();
  await requirePortalEngagement(actor, rows[0].engagementId);
  return rows[0];
}
