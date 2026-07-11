import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { clients, engagements, findings, reports, tasks } from "@/db/schema";

export async function getDashboardData(organisationId: string) {
  const now = new Date();
  const inThirtyDays = new Date(now.getTime() + 30 * 86_400_000);
  const [
    activeResult,
    reviewResult,
    highRiskResult,
    overdueResult,
    upcoming,
    recentFindings,
    assignedTasks,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(engagements)
      .where(
        and(
          eq(engagements.organisationId, organisationId),
          inArray(engagements.status, [
            "ready",
            "testing",
            "reporting",
            "peer_review",
            "quality_assurance",
            "client_review",
            "retesting",
          ]),
          isNull(engagements.deletedAt),
        ),
      ),
    db
      .select({ value: count() })
      .from(reports)
      .where(
        and(
          eq(reports.organisationId, organisationId),
          inArray(reports.status, [
            "internal_review",
            "client_review",
            "qa_approved",
          ]),
        ),
      ),
    db
      .select({ value: count() })
      .from(findings)
      .where(
        and(
          eq(findings.organisationId, organisationId),
          inArray(findings.severity, ["high", "critical"]),
          inArray(findings.status, [
            "published",
            "remediation_in_progress",
            "ready_for_retest",
          ]),
        ),
      ),
    db
      .select({ value: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, organisationId),
          lte(tasks.dueAt, now),
          inArray(tasks.status, ["todo", "in_progress", "blocked"]),
        ),
      ),
    db
      .select({
        id: engagements.id,
        name: engagements.name,
        reference: engagements.reference,
        status: engagements.status,
        health: engagements.health,
        progress: engagements.progress,
        startDate: engagements.startDate,
        endDate: engagements.endDate,
        client: clients.name,
      })
      .from(engagements)
      .innerJoin(
        clients,
        and(
          eq(clients.id, engagements.clientId),
          eq(clients.organisationId, organisationId),
        ),
      )
      .where(
        and(
          eq(engagements.organisationId, organisationId),
          gte(engagements.startDate, now.toISOString().slice(0, 10)),
          lte(engagements.startDate, inThirtyDays.toISOString().slice(0, 10)),
          isNull(engagements.deletedAt),
        ),
      )
      .orderBy(asc(engagements.startDate))
      .limit(5),
    db
      .select({
        id: findings.id,
        identifier: findings.identifier,
        title: findings.title,
        severity: findings.severity,
        status: findings.status,
        updatedAt: findings.updatedAt,
      })
      .from(findings)
      .where(
        and(
          eq(findings.organisationId, organisationId),
          isNull(findings.deletedAt),
        ),
      )
      .orderBy(desc(findings.updatedAt))
      .limit(5),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueAt: tasks.dueAt,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, organisationId),
          inArray(tasks.status, ["todo", "in_progress", "blocked"]),
        ),
      )
      .orderBy(sql`${tasks.dueAt} asc nulls last`)
      .limit(5),
  ]);

  return {
    metrics: {
      activeEngagements: activeResult[0]?.value ?? 0,
      reportsInReview: reviewResult[0]?.value ?? 0,
      highRiskFindings: highRiskResult[0]?.value ?? 0,
      overdueTasks: overdueResult[0]?.value ?? 0,
    },
    upcoming,
    recentFindings,
    assignedTasks,
  };
}
