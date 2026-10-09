import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  engagementRunbooks,
  engagementRunbookSteps,
  engagements,
  findings,
  tasks,
} from "@/db/schema";

const terminalEngagementStatuses = new Set([
  "complete",
  "archived",
  "cancelled",
]);
const finishedTaskStatuses = new Set(["done", "cancelled"]);
const finishedStepStatuses = new Set(["completed", "not_applicable"]);
const progressedFindingStatuses = new Set([
  "published",
  "remediation_in_progress",
  "ready_for_retest",
  "retested",
  "resolved",
  "risk_accepted",
  "closed",
]);

export type EngagementHealthInput = {
  status: string;
  endDate: string | null;
  now: Date;
  tasks: Array<{ status: string; dueAt: Date | null }>;
  steps: Array<{ status: string }>;
  findings: Array<{
    status: string;
    severity: string;
    deletedAt: Date | null;
  }>;
};

export function scoreEngagementHealth(input: EngagementHealthInput) {
  const ratios: number[] = [];
  if (input.tasks.length) {
    const finished = input.tasks.filter((task) =>
      finishedTaskStatuses.has(task.status),
    ).length;
    ratios.push(finished / input.tasks.length);
  }
  if (input.steps.length) {
    const finished = input.steps.filter((step) =>
      finishedStepStatuses.has(step.status),
    ).length;
    ratios.push(finished / input.steps.length);
  }
  const liveFindings = input.findings.filter((finding) => !finding.deletedAt);
  if (liveFindings.length) {
    const progressed = liveFindings.filter((finding) =>
      progressedFindingStatuses.has(finding.status),
    ).length;
    ratios.push(progressed / liveFindings.length);
  }
  const progress = ratios.length
    ? Math.min(
        100,
        Math.max(
          0,
          Math.round(
            (ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length) *
              100,
          ),
        ),
      )
    : 0;
  const today = input.now.toISOString().slice(0, 10);
  const endPast = input.endDate !== null && input.endDate < today;
  const overdueTask = input.tasks.some(
    (task) =>
      task.dueAt !== null &&
      task.dueAt.getTime() < input.now.getTime() &&
      !finishedTaskStatuses.has(task.status),
  );
  const openHighFinding = liveFindings.some(
    (finding) =>
      (finding.severity === "critical" || finding.severity === "high") &&
      !progressedFindingStatuses.has(finding.status),
  );
  const atRisk =
    (endPast && !terminalEngagementStatuses.has(input.status)) ||
    overdueTask ||
    (openHighFinding && endPast);
  return {
    progress,
    health: atRisk ? ("at_risk" as const) : ("on_track" as const),
  };
}

export async function refreshEngagementHealth(
  organisationId: string,
  engagementId: string,
) {
  const [engagement] = await db
    .select({
      status: engagements.status,
      endDate: engagements.endDate,
      health: engagements.health,
      progress: engagements.progress,
      updatedAt: engagements.updatedAt,
    })
    .from(engagements)
    .where(
      and(
        eq(engagements.id, engagementId),
        eq(engagements.organisationId, organisationId),
        isNull(engagements.deletedAt),
      ),
    )
    .limit(1);
  if (!engagement) return null;
  const [taskRows, stepRows, findingRows] = await Promise.all([
    db
      .select({ status: tasks.status, dueAt: tasks.dueAt })
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, organisationId),
          eq(tasks.engagementId, engagementId),
        ),
      ),
    db
      .select({ status: engagementRunbookSteps.status })
      .from(engagementRunbookSteps)
      .innerJoin(
        engagementRunbooks,
        eq(engagementRunbooks.id, engagementRunbookSteps.engagementRunbookId),
      )
      .where(
        and(
          eq(engagementRunbookSteps.organisationId, organisationId),
          eq(engagementRunbooks.organisationId, organisationId),
          eq(engagementRunbooks.engagementId, engagementId),
        ),
      ),
    db
      .select({
        status: findings.status,
        severity: findings.severity,
        deletedAt: findings.deletedAt,
      })
      .from(findings)
      .where(
        and(
          eq(findings.organisationId, organisationId),
          eq(findings.engagementId, engagementId),
        ),
      ),
  ]);
  const scored = scoreEngagementHealth({
    status: engagement.status,
    endDate: engagement.endDate,
    now: new Date(),
    tasks: taskRows,
    steps: stepRows,
    findings: findingRows,
  });
  if (
    scored.health === engagement.health &&
    scored.progress === engagement.progress
  ) {
    return {
      health: engagement.health,
      progress: engagement.progress,
      updatedAt: engagement.updatedAt,
    };
  }
  const updatedAt = new Date();
  await db
    .update(engagements)
    .set({
      health: scored.health,
      progress: scored.progress,
      updatedAt,
    })
    .where(
      and(
        eq(engagements.id, engagementId),
        eq(engagements.organisationId, organisationId),
      ),
    );
  return {
    health: scored.health,
    progress: scored.progress,
    updatedAt,
  };
}
