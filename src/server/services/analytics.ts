import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  clients,
  engagements,
  findings,
  findingStatusEnum,
  severityEnum,
} from "@/db/schema";

const periods = ["30", "90", "180", "365", "all"] as const;
const statusGroups = ["open", "remediated", "risk_accepted", "all"] as const;
const terminalStatuses = new Set(["resolved", "closed"]);

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
  organisationId: string,
  filters: RiskAnalyticsFilters,
  now = new Date(),
) {
  const conditions: SQL[] = [
    eq(findings.organisationId, organisationId),
    isNull(findings.deletedAt),
    eq(engagements.organisationId, organisationId),
    isNull(engagements.deletedAt),
    eq(clients.organisationId, organisationId),
    isNull(clients.deletedAt),
  ];
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

  const [rows, clientOptions] = await Promise.all([
    db
      .select({
        id: findings.id,
        identifier: findings.identifier,
        title: findings.title,
        severity: findings.severity,
        status: findings.status,
        dueAt: findings.dueAt,
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
    workflowCounts,
    ageBands,
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
