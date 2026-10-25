import "server-only";

import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { evidence, findings, reports, type ReportCondition } from "@/db/schema";
import { redactReportText } from "@/lib/reports/redact";
import type {
  ReportDocumentModel,
  ReportFindingModel,
} from "./report-renderers";

/** Findings in these statuses have passed QA and may appear in a report. */
export const reportableFindingStatuses = [
  "qa_approved",
  "published",
  "remediation_in_progress",
  "ready_for_retest",
  "retested",
  "resolved",
  "risk_accepted",
  "closed",
] as const;

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

export function defaultExecutiveSummary(
  severityCounts: Record<string, number>,
  findings: ReportFindingModel[],
) {
  const total = findings.length;
  if (total === 0)
    return "No confirmed findings were identified within the approved scope and testing window.";
  const parts = severityOrder
    .filter((severity) => (severityCounts[severity] ?? 0) > 0)
    .map((severity) => `${severityCounts[severity]} ${severity}`);
  const top = findings
    .slice(0, 5)
    .map(
      (finding) =>
        `${finding.identifier} (${finding.severity}): ${finding.title}`,
    )
    .join("; ");
  return `This assessment identified ${total} finding${total === 1 ? "" : "s"} (${parts.join(", ")}). Highest priority items: ${top}.`;
}

function clientConditionMatches(
  condition: ReportCondition | undefined,
  context: Record<string, boolean>,
) {
  if (!condition || !(condition.field in context)) return true;
  const value = context[condition.field];
  if (condition.operator === "truthy") return value;
  if (condition.operator === "not_equals") return value !== condition.value;
  return value === condition.value;
}

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
  // Stored sections were derived from the internal model. Recompute the
  // generated executive summary and strip references to withheld findings so
  // a snapshot cannot leak them through the portal.
  const visibleTerms = new Set(
    visibleFindings.flatMap((finding) => [
      finding.identifier.toLowerCase(),
      finding.title.toLowerCase(),
    ]),
  );
  const withheldTerms = model.findings
    .filter((finding) => !allowedIdentifiers.has(finding.identifier))
    .flatMap((finding) => [finding.identifier, finding.title])
    .filter((term) => term.trim() && !visibleTerms.has(term.toLowerCase()));
  const generatedSummary = defaultExecutiveSummary(
    model.severityCounts,
    model.findings,
  );
  const context = {
    hasFindings: visibleFindings.length > 0,
    hasEvidence: visibleEvidence.length > 0,
    hasCritical: (severityCounts.critical ?? 0) > 0,
    hasHigh: (severityCounts.high ?? 0) > 0,
  };
  const sections = model.sections
    .filter((section) =>
      clientConditionMatches(section.definition.condition, context),
    )
    .map((section) => {
      if (
        section.definition.type === "executive_summary" &&
        section.content === generatedSummary
      )
        return {
          ...section,
          content: defaultExecutiveSummary(severityCounts, visibleFindings),
        };
      if (!section.content || !withheldTerms.length) return section;
      return {
        ...section,
        content: redactReportText(section.content, withheldTerms),
      };
    });
  return {
    ...model,
    sections,
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
