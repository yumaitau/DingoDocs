import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  clients,
  engagements,
  findings,
  findingStatusEnum,
  findingTransitions,
  retestAttempts,
  severityEnum,
  slaPolicies,
  timeEntries,
  users,
} from "@/db/schema";
import {
  engagementVisibility,
  type AccessActor,
} from "@/lib/permissions/access";

const periods = ["30", "90", "180", "365", "all"] as const;
const statusGroups = ["open", "remediated", "risk_accepted", "all"] as const;
const terminalStatuses = new Set(["resolved", "closed"]);
const openStatuses = findingStatusEnum.enumValues.filter(
  (value) => !["resolved", "risk_accepted", "closed"].includes(value),
);

export type RiskAnalyticsFilters = {
  period: (typeof periods)[number];
  severity: "all" | (typeof severityEnum.enumValues)[number];
  status: (typeof statusGroups)[number];
  clientId?: string;
};

export const riskAnalyticsOptions = {
  periods,
  severities: severityEnum.enumValues,
  statusGroups,
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function parseRiskAnalyticsFilters(
  raw: Record<string, string | string[] | undefined>,
): RiskAnalyticsFilters {
  const period = first(raw.period);
  const severity = first(raw.severity);
  const status = first(raw.status);
  const clientId = first(raw.clientId);
  return {
    period: periods.includes(period as (typeof periods)[number])
      ? (period as RiskAnalyticsFilters["period"])
      : "all",
    severity:
      severity === "all" ||
      (severity !== undefined &&
        (severityEnum.enumValues as readonly string[]).includes(severity))
        ? (severity as RiskAnalyticsFilters["severity"])
        : "all",
    status: statusGroups.includes(status as (typeof statusGroups)[number])
      ? (status as RiskAnalyticsFilters["status"])
      : "open",
    clientId: z.string().uuid().safeParse(clientId).success
      ? clientId
      : undefined,
  };
}

export async function getRiskAnalytics(
  actor: AccessActor,
  filters: RiskAnalyticsFilters,
  now = new Date(),
) {
  const organisationId = actor.organisationId;
  const conditions: SQL[] = [
    eq(findings.organisationId, organisationId),
    isNull(findings.deletedAt),
    eq(engagements.organisationId, organisationId),
    isNull(engagements.deletedAt),
    eq(clients.organisationId, organisationId),
    isNull(clients.deletedAt),
  ];
  const visibility = engagementVisibility(actor, findings.engagementId);
  if (visibility) conditions.push(visibility);
  if (filters.clientId)
    conditions.push(eq(engagements.clientId, filters.clientId));
  if (filters.severity !== "all")
    conditions.push(eq(findings.severity, filters.severity));
  if (filters.period !== "all")
    conditions.push(
      gte(
        findings.createdAt,
        new Date(now.getTime() - Number(filters.period) * 86_400_000),
      ),
    );

  const statusCondition = analyticsStatusCondition(filters.status);
  if (statusCondition) conditions.push(statusCondition);

  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 5);
  sixMonthsAgo.setUTCDate(1);
  sixMonthsAgo.setUTCHours(0, 0, 0, 0);

  const [
    rows,
    clientOptions,
    transitionRows,
    retestRows,
    slaRows,
    timeRows,
    monthlyRaw,
  ] = await Promise.all([
    db
      .select({
        id: findings.id,
        identifier: findings.identifier,
        title: findings.title,
        severity: findings.severity,
        status: findings.status,
        dueAt: findings.dueAt,
        cwe: findings.cwe,
        publishedAt: findings.publishedAt,
        createdAt: findings.createdAt,
        updatedAt: findings.updatedAt,
        engagementId: engagements.id,
        engagementName: engagements.name,
        clientId: clients.id,
        clientName: clients.name,
      })
      .from(findings)
      .innerJoin(
        engagements,
        and(
          eq(engagements.id, findings.engagementId),
          eq(engagements.organisationId, organisationId),
        ),
      )
      .innerJoin(
        clients,
        and(
          eq(clients.id, engagements.clientId),
          eq(clients.organisationId, organisationId),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(findings.updatedAt)),
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(
        and(
          eq(clients.organisationId, organisationId),
          isNull(clients.deletedAt),
        ),
      )
      .orderBy(asc(clients.name)),
    db
      .select({
        findingId: findingTransitions.findingId,
        toStatus: findingTransitions.toStatus,
        createdAt: findingTransitions.createdAt,
      })
      .from(findingTransitions)
      .where(
        and(
          eq(findingTransitions.organisationId, organisationId),
          inArray(findingTransitions.toStatus, ["resolved", "closed"]),
        ),
      ),
    db
      .select({
        outcome: retestAttempts.outcome,
      })
      .from(retestAttempts)
      .where(
        and(
          eq(retestAttempts.organisationId, organisationId),
          isNotNull(retestAttempts.outcome),
        ),
      ),
    db
      .select({
        severity: slaPolicies.severity,
        days: slaPolicies.days,
        clientId: slaPolicies.clientId,
      })
      .from(slaPolicies)
      .where(
        and(
          eq(slaPolicies.organisationId, organisationId),
          isNull(slaPolicies.clientId),
        ),
      ),
    db
      .select({
        userId: timeEntries.userId,
        userName: users.name,
        engagementId: timeEntries.engagementId,
        engagementName: engagements.name,
        hours: timeEntries.hours,
        billable: timeEntries.billable,
      })
      .from(timeEntries)
      .innerJoin(users, eq(users.id, timeEntries.userId))
      .innerJoin(
        engagements,
        and(
          eq(engagements.id, timeEntries.engagementId),
          eq(engagements.organisationId, organisationId),
        ),
      )
      .where(
        and(
          eq(timeEntries.organisationId, organisationId),
          isNull(engagements.deletedAt),
          engagementVisibility(actor, timeEntries.engagementId),
        ),
      ),
    db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${findings.createdAt}), 'YYYY-MM')`,
        count: sql<number>`count(*)::int`,
      })
      .from(findings)
      .innerJoin(
        engagements,
        and(
          eq(engagements.id, findings.engagementId),
          eq(engagements.organisationId, organisationId),
        ),
      )
      .where(
        and(
          eq(findings.organisationId, organisationId),
          isNull(findings.deletedAt),
          isNull(engagements.deletedAt),
          gte(findings.createdAt, sixMonthsAgo),
          engagementVisibility(actor, findings.engagementId),
        ),
      )
      .groupBy(sql`date_trunc('month', ${findings.createdAt})`)
      .orderBy(sql`date_trunc('month', ${findings.createdAt})`),
  ]);

  const severityCounts = severityEnum.enumValues.map((severity) => ({
    key: severity,
    label: severity[0].toUpperCase() + severity.slice(1),
    value: rows.filter((row) => row.severity === severity).length,
  }));
  const workflowCounts = [
    {
      key: "authoring",
      label: "Authoring",
      statuses: ["draft", "in_progress", "changes_requested"],
    },
    {
      key: "review",
      label: "Review and QA",
      statuses: ["ready_for_review", "peer_reviewed", "qa_approved"],
    },
    {
      key: "remediation",
      label: "Remediation",
      statuses: [
        "published",
        "remediation_in_progress",
        "ready_for_retest",
        "retested",
      ],
    },
    {
      key: "risk_accepted",
      label: "Risk accepted",
      statuses: ["risk_accepted"],
    },
    {
      key: "closed",
      label: "Resolved or closed",
      statuses: ["resolved", "closed"],
    },
  ].map(({ key, label, statuses }) => ({
    key,
    label,
    value: rows.filter((row) => statuses.includes(row.status)).length,
  }));

  const statusCounts = findingStatusEnum.enumValues
    .map((status) => ({
      key: status,
      label: titleCase(status),
      value: rows.filter((row) => row.status === status).length,
    }))
    .filter((row) => row.value > 0);

  const ageBands = [
    { key: "under_30", label: "Under 30 days", minimum: 0, maximum: 30 },
    { key: "30_89", label: "30–89 days", minimum: 30, maximum: 90 },
    { key: "90_179", label: "90–179 days", minimum: 90, maximum: 180 },
    { key: "180_plus", label: "180+ days", minimum: 180 },
  ].map((band) => ({
    key: band.key,
    label: band.label,
    value: rows.filter((row) => {
      const age = (now.getTime() - row.createdAt.getTime()) / 86_400_000;
      return (
        age >= band.minimum &&
        (band.maximum === undefined || age < band.maximum)
      );
    }).length,
  }));

  const clientMap = new Map<
    string,
    {
      id: string;
      name: string;
      total: number;
      highRisk: number;
      pastDue: number;
    }
  >();
  for (const row of rows) {
    const value = clientMap.get(row.clientId) ?? {
      id: row.clientId,
      name: row.clientName,
      total: 0,
      highRisk: 0,
      pastDue: 0,
    };
    value.total += 1;
    if (row.severity === "critical" || row.severity === "high")
      value.highRisk += 1;
    if (isPastDue(row, now)) value.pastDue += 1;
    clientMap.set(row.clientId, value);
  }

  const resolvedAtByFinding = new Map<string, Date>();
  for (const row of transitionRows) {
    const existing = resolvedAtByFinding.get(row.findingId);
    if (!existing || row.createdAt < existing)
      resolvedAtByFinding.set(row.findingId, row.createdAt);
  }
  const remediationDurations: number[] = [];
  for (const row of rows) {
    if (!row.publishedAt) continue;
    if (!terminalStatuses.has(row.status)) continue;
    const resolvedAt = resolvedAtByFinding.get(row.id);
    if (!resolvedAt) continue;
    const days =
      (resolvedAt.getTime() - row.publishedAt.getTime()) / 86_400_000;
    if (days >= 0) remediationDurations.push(days);
  }
  const meanRemediationDays =
    remediationDurations.length > 0
      ? Math.round(
          (remediationDurations.reduce((sum, value) => sum + value, 0) /
            remediationDurations.length) *
            10,
        ) / 10
      : null;

  const retestTotal = retestRows.length;
  const retestPassed = retestRows.filter(
    (row) => row.outcome === "fixed",
  ).length;
  const retestPassRate =
    retestTotal > 0
      ? Math.round((retestPassed / retestTotal) * 1000) / 10
      : null;

  const slaBySeverity = new Map(
    slaRows.map((row) => [row.severity, row.days] as const),
  );
  let slaOverdue = 0;
  for (const row of rows) {
    if (!openStatuses.includes(row.status)) continue;
    const days = slaBySeverity.get(row.severity);
    if (days === undefined) continue;
    const anchor = row.publishedAt ?? row.createdAt;
    const deadline = new Date(anchor.getTime() + days * 86_400_000);
    if (deadline < now) slaOverdue += 1;
  }

  const cweCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.cwe) continue;
    cweCounts.set(row.cwe, (cweCounts.get(row.cwe) ?? 0) + 1);
  }
  const topCwes = [...cweCounts.entries()]
    .map(([cwe, count]) => ({ cwe, count }))
    .sort((left, right) => right.count - left.count || left.cwe.localeCompare(right.cwe))
    .slice(0, 10);

  const monthKeys: string[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const cursor = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
    );
    monthKeys.push(
      `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  const monthlyMap = new Map(
    monthlyRaw.map((row) => [row.month, Number(row.count)] as const),
  );
  const monthlyCounts = monthKeys.map((month) => ({
    month,
    label: monthLabel(month),
    value: monthlyMap.get(month) ?? 0,
  }));

  const timeByUser = new Map<
    string,
    { userId: string; userName: string; hours: number; billable: number; nonBillable: number }
  >();
  const timeByEngagement = new Map<
    string,
    {
      engagementId: string;
      engagementName: string;
      hours: number;
      billable: number;
      nonBillable: number;
    }
  >();
  for (const row of timeRows) {
    const hours = Number(row.hours);
    const user = timeByUser.get(row.userId) ?? {
      userId: row.userId,
      userName: row.userName,
      hours: 0,
      billable: 0,
      nonBillable: 0,
    };
    user.hours += hours;
    if (row.billable) user.billable += hours;
    else user.nonBillable += hours;
    timeByUser.set(row.userId, user);

    const engagement = timeByEngagement.get(row.engagementId) ?? {
      engagementId: row.engagementId,
      engagementName: row.engagementName,
      hours: 0,
      billable: 0,
      nonBillable: 0,
    };
    engagement.hours += hours;
    if (row.billable) engagement.billable += hours;
    else engagement.nonBillable += hours;
    timeByEngagement.set(row.engagementId, engagement);
  }

  return {
    filters,
    clientOptions,
    summary: {
      total: rows.length,
      highRisk: rows.filter(
        (row) => row.severity === "critical" || row.severity === "high",
      ).length,
      pastDue: rows.filter((row) => isPastDue(row, now)).length,
      remediated: rows.filter((row) => terminalStatuses.has(row.status)).length,
    },
    severityCounts,
    statusCounts,
    workflowCounts,
    ageBands,
    monthlyCounts,
    metrics: {
      meanRemediationDays,
      retestPassRate,
      retestTotal,
      slaOverdue,
      topCwes,
    },
    timeByUser: [...timeByUser.values()]
      .map((row) => ({
        ...row,
        hours: roundHours(row.hours),
        billable: roundHours(row.billable),
        nonBillable: roundHours(row.nonBillable),
      }))
      .sort((left, right) => right.hours - left.hours),
    timeByEngagement: [...timeByEngagement.values()]
      .map((row) => ({
        ...row,
        hours: roundHours(row.hours),
        billable: roundHours(row.billable),
        nonBillable: roundHours(row.nonBillable),
      }))
      .sort((left, right) => right.hours - left.hours),
    clients: [...clientMap.values()].sort(
      (left, right) =>
        right.highRisk - left.highRisk ||
        right.pastDue - left.pastDue ||
        left.name.localeCompare(right.name),
    ),
    findings: rows.slice(0, 50),
  };
}

function analyticsStatusCondition(status: RiskAnalyticsFilters["status"]) {
  if (status === "all") return undefined;
  if (status === "risk_accepted") return eq(findings.status, "risk_accepted");
  const values =
    status === "remediated"
      ? (["resolved", "closed"] as const)
      : findingStatusEnum.enumValues.filter(
          (value) => !["resolved", "risk_accepted", "closed"].includes(value),
        );
  return sqlIn(values);
}

function sqlIn(
  values: readonly (typeof findingStatusEnum.enumValues)[number][],
) {
  return inArray(findings.status, [...values]);
}

function isPastDue(row: { dueAt: Date | null; status: string }, now: Date) {
  return Boolean(
    row.dueAt &&
      row.dueAt < now &&
      !terminalStatuses.has(row.status) &&
      row.status !== "risk_accepted",
  );
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-");
  const date = new Date(Date.UTC(Number(year), Number(monthNumber) - 1, 1));
  return date.toLocaleString("en-AU", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function roundHours(value: number) {
  return Math.round(value * 100) / 100;
}
