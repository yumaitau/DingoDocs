import "server-only";

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { evidence, findings, reports } from "@/db/schema";
import type { ReportDocumentModel } from "./report-renderers";

const clientVisibleFindingStatuses = [
  "published",
  "remediation_in_progress",
  "ready_for_retest",
  "retested",
  "resolved",
  "risk_accepted",
  "closed",
] as const;

const severityOrder = [
  "critical",
  "high",
  "medium",
  "low",
  "informational",
] as const;

export function filterClientReportModel(
  model: ReportDocumentModel,
  allowedIdentifiers: Set<string>,
  allowedEvidenceSha256: Set<string>,
): ReportDocumentModel {
  const visibleFindings = model.findings.filter((finding) =>
    allowedIdentifiers.has(finding.identifier),
  );
  const recommendations = visibleFindings
    .filter((finding) => finding.remediation)
    .map((finding) => ({
      identifier: finding.identifier,
      title: finding.title,
      severity: finding.severity,
      remediation: finding.remediation ?? "",
    }));
  const severityCounts = Object.fromEntries(
    severityOrder.map((severity) => [
      severity,
      visibleFindings.filter((finding) => finding.severity === severity).length,
    ]),
  );
  const visibleEvidence = model.evidence.filter(
    (item) =>
      item.classification === "client_visible" &&
      allowedEvidenceSha256.has(item.sha256),
  );
  return {
    ...model,
    findings: visibleFindings,
    recommendations,
    severityCounts,
    evidence: visibleEvidence,
  };
}

export async function presentClientReport(
  actorOrganisationId: string,
  model: ReportDocumentModel,
): Promise<ReportDocumentModel> {
  const [report] = await db
    .select({ engagementId: reports.engagementId })
    .from(reports)
    .where(
      and(
        eq(reports.id, model.reportId),
        eq(reports.organisationId, actorOrganisationId),
      ),
    )
    .limit(1);
  if (!report) return filterClientReportModel(model, new Set(), new Set());

  const [findingRows, evidenceRows] = await Promise.all([
    db
      .select({ identifier: findings.identifier })
      .from(findings)
      .where(
        and(
          eq(findings.organisationId, actorOrganisationId),
          eq(findings.engagementId, report.engagementId),
          eq(findings.clientVisible, true),
          isNotNull(findings.publishedAt),
          inArray(findings.status, [...clientVisibleFindingStatuses]),
          isNull(findings.deletedAt),
        ),
      ),
    db
      .select({ sha256: evidence.sha256 })
      .from(evidence)
      .where(
        and(
          eq(evidence.organisationId, actorOrganisationId),
          eq(evidence.engagementId, report.engagementId),
          eq(evidence.classification, "client_visible"),
          isNull(evidence.deletedAt),
          isNull(evidence.quarantinedAt),
        ),
      ),
  ]);

  return filterClientReportModel(
    model,
    new Set(findingRows.map((row) => row.identifier)),
    new Set(evidenceRows.map((row) => row.sha256)),
  );
}
