import "server-only";
import { and, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  auditEvents,
  evidence,
  findings,
  reports,
  tasks,
  users,
} from "@/db/schema";

const qaStatuses = [
  "ready_for_review",
  "changes_requested",
  "peer_reviewed",
  "qa_approved",
] as const;

export async function listEngagementReports(
  organisationId: string,
  engagementId: string,
) {
  return db
    .select({
      id: reports.id,
      title: reports.title,
      status: reports.status,
      createdAt: reports.createdAt,
      updatedAt: reports.updatedAt,
    })
    .from(reports)
    .where(
      and(
        eq(reports.organisationId, organisationId),
        eq(reports.engagementId, engagementId),
      ),
    )
    .orderBy(desc(reports.updatedAt));
}

export async function listEngagementQaFindings(
  organisationId: string,
  engagementId: string,
) {
  return db
    .select({
      id: findings.id,
      identifier: findings.identifier,
      title: findings.title,
      severity: findings.severity,
      status: findings.status,
    })
    .from(findings)
    .where(
      and(
        eq(findings.organisationId, organisationId),
        eq(findings.engagementId, engagementId),
        isNull(findings.deletedAt),
        inArray(findings.status, [...qaStatuses]),
      ),
    )
    .orderBy(desc(findings.updatedAt));
}

function idsOf(rows: Array<{ id: string }>) {
  return rows.map((row) => row.id);
}

function targetMatch(targetType: string, ids: string[]) {
  if (!ids.length) return undefined;
  return and(
    eq(auditEvents.targetType, targetType),
    inArray(auditEvents.targetId, ids),
  );
}

export async function listEngagementAuditEvents(
  organisationId: string,
  engagementId: string,
) {
  const scope = and(
    eq(findings.organisationId, organisationId),
    eq(findings.engagementId, engagementId),
  );
  const [findingRows, reportRows, evidenceRows, taskRows, assetRows] =
    await Promise.all([
      db.select({ id: findings.id }).from(findings).where(scope),
      db
        .select({ id: reports.id })
        .from(reports)
        .where(
          and(
            eq(reports.organisationId, organisationId),
            eq(reports.engagementId, engagementId),
          ),
        ),
      db
        .select({ id: evidence.id })
        .from(evidence)
        .where(
          and(
            eq(evidence.organisationId, organisationId),
            eq(evidence.engagementId, engagementId),
          ),
        ),
      db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.organisationId, organisationId),
            eq(tasks.engagementId, engagementId),
          ),
        ),
      db
        .select({ id: assets.id })
        .from(assets)
        .where(
          and(
            eq(assets.organisationId, organisationId),
            eq(assets.engagementId, engagementId),
          ),
        ),
    ]);
  const matches = [
    eq(auditEvents.targetId, engagementId),
    targetMatch("finding", idsOf(findingRows)),
    targetMatch("report", idsOf(reportRows)),
    targetMatch("evidence", idsOf(evidenceRows)),
    targetMatch("task", idsOf(taskRows)),
    targetMatch("asset", idsOf(assetRows)),
  ].filter((match): match is SQL => Boolean(match));
  return db
    .select({
      id: auditEvents.id,
      createdAt: auditEvents.createdAt,
      action: auditEvents.action,
      targetType: auditEvents.targetType,
      actorName: users.name,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(and(eq(auditEvents.organisationId, organisationId), or(...matches)))
    .orderBy(desc(auditEvents.createdAt))
    .limit(100);
}
