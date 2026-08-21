import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  auditEvents,
  backgroundJobs,
  clients,
  engagements,
  evidence,
  findings,
  organisations,
  reportReviews,
  reportTemplates,
  reportTransitions,
  reportVersions,
  reports,
  scopeItems,
  scopeVersions,
  type ReportFormat,
  type ReportSectionDefinition,
  type ReportTemplateDefinition,
} from "@/db/schema";
import { storage } from "@/lib/storage";
import type { StorageProvider } from "@/lib/storage/types";
import { safeLogoDataUri } from "@/lib/reports/branding";
import {
  DEFAULT_CONFIDENTIALITY_NOTICE,
  DEFAULT_METHODOLOGY,
  DEFAULT_PENTEST_GLOSSARY,
  DEFAULT_SEVERITY_RATINGS,
} from "@/lib/reports/professional-template";
import { renderReport, reportMediaTypes, type ReportDocumentModel } from "./report-renderers";

export type ReportActor = { organisationId: string; userId: string };
export type ReportStatus = typeof reports.$inferSelect.status;

const reportWorkflow: Record<ReportStatus, readonly ReportStatus[]> = {
  draft: ["internal_review"],
  internal_review: ["changes_requested", "qa_approved"],
  changes_requested: ["draft", "internal_review"],
  qa_approved: ["client_review", "approved", "changes_requested"],
  client_review: ["changes_requested", "approved"],
  approved: ["published", "changes_requested"],
  published: ["superseded", "archived"],
  superseded: ["archived"],
  archived: [],
};

export class ReportScopeError extends Error {
  constructor(message = "Report is unavailable in the active organisation") {
    super(message);
    this.name = "ReportScopeError";
  }
}

export function validateReportTemplate(definition: ReportTemplateDefinition) {
  if (!definition.sections.length) throw new Error("A report template requires sections");
  const ids = new Set<string>();
  for (const section of definition.sections) {
    if (!section.id?.trim() || ids.has(section.id))
      throw new Error("Report section identifiers must be unique");
    ids.add(section.id);
    if (section.type === "reusable_content" && !section.reusableKey)
      throw new Error("Reusable sections require a reusable content key");
  }
  if (
    !/^#[0-9a-f]{6}$/i.test(definition.branding.primaryColour) ||
    !/^#[0-9a-f]{6}$/i.test(definition.branding.accentColour)
  )
    throw new Error("Brand colours must use six-digit hexadecimal values");
  if (definition.typography.bodySize < 8 || definition.typography.bodySize > 16)
    throw new Error("Report body text must be between 8 and 16 points");
  return definition;
}

export async function createReportTemplate(
  actor: ReportActor,
  input: {
    name: string;
    clientId?: string;
    definition: ReportTemplateDefinition;
    customCss?: string;
  },
) {
  validateReportTemplate(input.definition);
  await assertClient(actor.organisationId, input.clientId);
  const [latest] = await db
    .select({ version: reportTemplates.version })
    .from(reportTemplates)
    .where(
      and(
        eq(reportTemplates.organisationId, actor.organisationId),
        eq(reportTemplates.name, input.name),
      ),
    )
    .orderBy(desc(reportTemplates.version))
    .limit(1);
  const [row] = await db
    .insert(reportTemplates)
    .values({
      organisationId: actor.organisationId,
      clientId: input.clientId,
      name: input.name.trim(),
      version: (latest?.version ?? 0) + 1,
      definition: input.definition,
      customCss: input.customCss,
      createdBy: actor.userId,
    })
    .returning();
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "report_template.created",
    targetType: "report_template",
    targetId: row?.id,
    metadata: {
      name: input.name,
      version: row?.version,
      clientId: input.clientId ?? null,
    },
  });
  return row;
}

export async function reviseReportTemplate(
  actor: ReportActor,
  templateId: string,
  input: { definition: ReportTemplateDefinition; customCss?: string },
) {
  validateReportTemplate(input.definition);
  return db.transaction(async (tx) => {
    const template = await requireTemplate(tx, actor.organisationId, templateId);
    const [latest] = await tx
      .select()
      .from(reportTemplates)
      .where(
        and(
          eq(reportTemplates.organisationId, actor.organisationId),
          eq(reportTemplates.name, template.name),
        ),
      )
      .orderBy(desc(reportTemplates.version))
      .limit(1);
    if (!latest || latest.id !== template.id)
      throw new Error("Only the latest report template can be revised");
    const [revision] = await tx
      .insert(reportTemplates)
      .values({
        organisationId: actor.organisationId,
        clientId: template.clientId,
        name: template.name,
        version: template.version + 1,
        definition: input.definition,
        customCss: input.customCss,
        createdBy: actor.userId,
      })
      .returning();
    await tx
      .update(reportTemplates)
      .set({ supersededAt: new Date() })
      .where(eq(reportTemplates.id, template.id));
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "report_template.revised",
      targetType: "report_template",
      targetId: revision?.id,
      metadata: {
        previousTemplateId: template.id,
        version: revision?.version,
      },
    });
    return revision;
  });
}

export async function createReport(
  actor: ReportActor,
  input: { engagementId: string; templateId: string; title: string },
) {
  const template = await requireTemplate(db, actor.organisationId, input.templateId);
  const engagement = await requireEngagement(actor.organisationId, input.engagementId);
  if (template.clientId && template.clientId !== engagement.clientId)
    throw new ReportScopeError("Template belongs to another client");
  const reportId = randomUUID();
  const versionId = randomUUID();
  const model = await buildReportModel({
    organisationId: actor.organisationId,
    reportId,
    reportVersionId: versionId,
    version: 1,
    title: input.title,
    engagement,
    template,
  });
  return db.transaction(async (tx) => {
    const [report] = await tx
      .insert(reports)
      .values({
        id: reportId,
        organisationId: actor.organisationId,
        clientId: engagement.clientId,
        engagementId: engagement.id,
        templateId: template.id,
        templateVersion: template.version,
        title: input.title.trim(),
        createdBy: actor.userId,
      })
      .returning();
    const [version] = await tx
      .insert(reportVersions)
      .values({
        id: versionId,
        organisationId: actor.organisationId,
        reportId,
        version: 1,
        status: "draft",
        content: model,
        createdBy: actor.userId,
      })
      .returning();
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "report.created",
      targetType: "report",
      targetId: reportId,
      metadata: {
        engagementId: engagement.id,
        templateId: template.id,
        templateVersion: template.version,
      },
    });
    return { report, version, model };
  });
}

export async function createReportRevision(actor: ReportActor, reportId: string) {
  return db.transaction(async (tx) => {
    const report = await requireReport(tx, actor.organisationId, reportId);
    const current = await requireCurrentVersion(tx, actor.organisationId, report);
    if (!current.immutable && report.status !== "published")
      throw new Error("Create a revision only after a report has been published");
    const version = report.currentVersion + 1;
    const id = randomUUID();
    if (!report.templateId) throw new Error("A report template is required to create a revision");
    const template = await requireTemplate(tx, actor.organisationId, report.templateId);
    const engagement = await requireEngagement(actor.organisationId, report.engagementId);
    const content = await buildReportModel({
      organisationId: actor.organisationId,
      reportId: report.id,
      reportVersionId: id,
      version,
      title: report.title,
      engagement,
      template,
    });
    await tx
      .update(reportVersions)
      .set({ status: "superseded" })
      .where(eq(reportVersions.id, current.id));
    const [revision] = await tx
      .insert(reportVersions)
      .values({
        id,
        organisationId: actor.organisationId,
        reportId: report.id,
        version,
        status: "draft",
        content,
        createdBy: actor.userId,
      })
      .returning();
    await tx
      .update(reports)
      .set({ currentVersion: version, status: "draft", updatedAt: new Date() })
      .where(eq(reports.id, report.id));
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "report.revision_created",
      targetType: "report",
      targetId: report.id,
      metadata: { previousVersion: current.version, version },
    });
    return revision;
  });
}

export async function transitionReport(
  actor: ReportActor,
  input: { reportId: string; toStatus: ReportStatus; comment?: string },
) {
  return db.transaction(async (tx) => {
    const report = await requireReport(tx, actor.organisationId, input.reportId);
    const version = await requireCurrentVersion(tx, actor.organisationId, report);
    if (version.immutable) throw new Error("Published report versions are immutable");
    if (!reportWorkflow[report.status].includes(input.toStatus))
      throw new Error(`Report cannot transition from ${report.status} to ${input.toStatus}`);
    if (input.toStatus === "changes_requested" && !input.comment?.trim())
      throw new Error("Changes requested requires a comment");
    if (input.toStatus === "qa_approved" && version.createdBy === actor.userId)
      throw new Error("Report authors cannot complete QA approval");
    if (input.toStatus === "approved" && version.approvedBy === actor.userId)
      throw new Error("Final approval requires a different approver from QA");
    if (input.toStatus === "published" && version.renderStatus !== "completed")
      throw new Error("Generate final exports before publication");
    const now = new Date();
    const [updated] = await tx
      .update(reports)
      .set({ status: input.toStatus, updatedAt: now })
      .where(and(eq(reports.id, report.id), eq(reports.status, report.status)))
      .returning();
    if (!updated) throw new Error("Report state changed; reload and retry");
    await tx
      .update(reportVersions)
      .set({
        status: input.toStatus,
        immutable: input.toStatus === "published",
        approvedBy: ["qa_approved", "approved", "published"].includes(input.toStatus)
          ? actor.userId
          : version.approvedBy,
        approvedAt: input.toStatus === "approved" ? now : version.approvedAt,
        publishedAt: input.toStatus === "published" ? now : version.publishedAt,
      })
      .where(eq(reportVersions.id, version.id));
    await tx.insert(reportTransitions).values({
      organisationId: actor.organisationId,
      reportId: report.id,
      reportVersionId: version.id,
      fromStatus: report.status,
      toStatus: input.toStatus,
      actorId: actor.userId,
      comment: input.comment,
    });
    await tx.insert(reportReviews).values({
      organisationId: actor.organisationId,
      reportVersionId: version.id,
      reviewerId: actor.userId,
      decision: input.toStatus,
      comment: input.comment,
    });
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: input.toStatus === "published" ? "report.published" : "report.transitioned",
      targetType: "report",
      targetId: report.id,
      previousValues: { status: report.status },
      newValues: { status: input.toStatus },
      metadata: { version: version.version, comment: input.comment ?? null },
    });
    return updated;
  });
}

export async function queueReportGeneration(
  actor: ReportActor,
  reportId: string,
  formats: ReportFormat[] = ["pdf", "docx", "html", "markdown", "json"],
) {
  const report = await requireReport(db, actor.organisationId, reportId);
  const version = await requireCurrentVersion(db, actor.organisationId, report);
  if (version.immutable) throw new Error("Published report versions are immutable");
  const selected = [...new Set(formats)];
  await db.transaction(async (tx) => {
    await tx
      .update(reportVersions)
      .set({ renderStatus: "queued", renderError: null })
      .where(eq(reportVersions.id, version.id));
    await tx
      .insert(backgroundJobs)
      .values({
        organisationId: actor.organisationId,
        type: "report.generate",
        payload: { reportVersionId: version.id, formats: selected },
        idempotencyKey: `report.generate:${version.id}:${selected.sort().join(",")}`,
      })
      .onConflictDoNothing();
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "report.generation_queued",
      targetType: "report",
      targetId: report.id,
      metadata: { version: version.version, formats: selected },
    });
  });
  return version;
}

export async function generateReportJob(
  reportVersionId: string,
  formats: ReportFormat[],
  provider: StorageProvider = storage(),
) {
  const [version] = await db
    .select()
    .from(reportVersions)
    .where(eq(reportVersions.id, reportVersionId))
    .limit(1);
  if (!version) return;
  const [report] = await db.select().from(reports).where(eq(reports.id, version.reportId)).limit(1);
  if (!report) return;
  await db
    .update(reportVersions)
    .set({ renderStatus: "running", renderError: null })
    .where(eq(reportVersions.id, version.id));
  const keys = { ...version.exportKeys };
  const checksums = { ...version.exportChecksums };
  const storedKeys: string[] = [];
  try {
    for (const format of formats) {
      const output = await renderReport(version.content as ReportDocumentModel, format);
      const key = `${version.organisationId}/${report.clientId}/${report.id}/v${version.version}/${randomUUID()}.${format === "markdown" ? "md" : format}`;
      const stored = await provider.put({
        key,
        body: output,
        mediaType: reportMediaTypes[format],
        expectedSize: output.byteLength,
      });
      storedKeys.push(stored.key);
      keys[format] = stored.key;
      checksums[format] = stored.sha256;
    }
    await db
      .update(reportVersions)
      .set({
        exportKeys: keys,
        exportChecksums: checksums,
        storageKeyPdf: keys.pdf,
        storageKeyDocx: keys.docx,
        checksum: checksums.pdf ?? checksums.docx,
        renderStatus: "completed",
        renderedAt: new Date(),
        renderError: null,
      })
      .where(eq(reportVersions.id, version.id));
  } catch (error) {
    await Promise.all(storedKeys.map((key) => provider.delete(key)));
    await db
      .update(reportVersions)
      .set({
        renderStatus: "failed",
        renderError:
          error instanceof Error ? error.message.slice(0, 2_000) : "Unknown render failure",
      })
      .where(eq(reportVersions.id, version.id));
    throw error;
  }
}

export async function getReportWorkspace(organisationId: string, reportId: string) {
  const report = await requireReport(db, organisationId, reportId);
  const versions = await db
    .select()
    .from(reportVersions)
    .where(
      and(eq(reportVersions.organisationId, organisationId), eq(reportVersions.reportId, reportId)),
    )
    .orderBy(desc(reportVersions.version));
  const transitions = await db
    .select()
    .from(reportTransitions)
    .where(
      and(
        eq(reportTransitions.organisationId, organisationId),
        eq(reportTransitions.reportId, reportId),
      ),
    )
    .orderBy(asc(reportTransitions.createdAt));
  return {
    report,
    current: versions.find((version) => version.version === report.currentVersion)!,
    versions,
    transitions,
  };
}

export async function getReportExport(
  actor: ReportActor,
  input: { reportVersionId: string; format: ReportFormat },
) {
  const [version] = await db
    .select()
    .from(reportVersions)
    .where(
      and(
        eq(reportVersions.id, input.reportVersionId),
        eq(reportVersions.organisationId, actor.organisationId),
      ),
    )
    .limit(1);
  const key = version?.exportKeys[input.format];
  if (!version || !key) throw new ReportScopeError("Report export is unavailable");
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "report.export_downloaded",
    targetType: "report",
    targetId: version.reportId,
    metadata: {
      reportVersionId: version.id,
      version: version.version,
      format: input.format,
    },
  });
  return { version, key, mediaType: reportMediaTypes[input.format] };
}

type EngagementRow = typeof engagements.$inferSelect;
type TemplateRow = typeof reportTemplates.$inferSelect;
async function buildReportModel(input: {
  organisationId: string;
  reportId: string;
  reportVersionId: string;
  version: number;
  title: string;
  engagement: EngagementRow;
  template: TemplateRow;
}): Promise<ReportDocumentModel> {
  const [organisationRows, clientRows, scopeVersionRows, assetRows, findingRows, evidenceRows] =
    await Promise.all([
      db
        .select({
          name: organisations.name,
          branding: organisations.branding,
        })
        .from(organisations)
        .where(eq(organisations.id, input.organisationId))
        .limit(1),
      db
        .select({
          name: clients.name,
          branding: clients.branding,
          address: clients.address,
        })
        .from(clients)
        .where(
          and(
            eq(clients.id, input.engagement.clientId),
            eq(clients.organisationId, input.organisationId),
          ),
        )
        .limit(1),
      db
        .select({ id: scopeVersions.id })
        .from(scopeVersions)
        .where(
          and(
            eq(scopeVersions.organisationId, input.organisationId),
            eq(scopeVersions.engagementId, input.engagement.id),
            eq(scopeVersions.status, "approved"),
          ),
        )
        .orderBy(desc(scopeVersions.version))
        .limit(1),
      db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.organisationId, input.organisationId),
            eq(assets.engagementId, input.engagement.id),
            isNull(assets.deletedAt),
          ),
        )
        .orderBy(asc(assets.name)),
      db
        .select()
        .from(findings)
        .where(
          and(
            eq(findings.organisationId, input.organisationId),
            eq(findings.engagementId, input.engagement.id),
            isNull(findings.deletedAt),
          ),
        )
        .orderBy(desc(findings.severity), asc(findings.identifier)),
      db
        .select()
        .from(evidence)
        .where(
          and(
            eq(evidence.organisationId, input.organisationId),
            eq(evidence.engagementId, input.engagement.id),
            isNull(evidence.deletedAt),
          ),
        )
        .orderBy(asc(evidence.originalFilename)),
    ]);
  const scopeRows = scopeVersionRows[0]
    ? await db
        .select()
        .from(scopeItems)
        .where(
          and(
            eq(scopeItems.organisationId, input.organisationId),
            eq(scopeItems.scopeVersionId, scopeVersionRows[0].id),
          ),
        )
        .orderBy(asc(scopeItems.name))
    : [];
  const definition = input.template.definition;
  const organisationBranding = organisationRows[0]?.branding ?? {};
  const branding = {
    ...organisationBranding,
    ...definition.branding,
  };
  const organisationName = branding.organisationName ?? organisationRows[0]?.name ?? "Organisation";
  const clientName = clientRows[0]?.name ?? "Client";
  const whiteLabel = branding.whiteLabel === true;
  const startDate = input.engagement.startDate ?? "";
  const endDate = input.engagement.endDate ?? "";
  const variables: Record<string, string> = {
    "organisation.name": organisationName,
    "organisation.tagline": branding.tagline ?? "",
    "client.name": clientName,
    "engagement.name": input.engagement.name,
    "engagement.reference": input.engagement.reference,
    "engagement.startDate": startDate,
    "engagement.endDate": endDate,
    "engagement.objectives": input.engagement.objectives ?? "",
    "engagement.constraints": input.engagement.constraints ?? "",
    "report.title": input.title,
    "report.version": String(input.version),
    "report.classification": definition.classification,
    "generated.date": new Date().toISOString().slice(0, 10),
    ...definition.variables,
  };
  const interpolate = (value?: string) =>
    value?.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => variables[key] ?? "") ?? "";
  const severityCounts = Object.fromEntries(
    ["critical", "high", "medium", "low", "informational"].map((severity) => [
      severity,
      findingRows.filter((finding) => finding.severity === severity).length,
    ]),
  );
  const context = {
    hasFindings: findingRows.length > 0,
    hasEvidence: evidenceRows.length > 0,
    hasScope: scopeRows.length > 0,
    status: input.engagement.status,
  };
  const sections = definition.sections
    .filter((section) => conditionMatches(section.condition, context))
    .map((section) => ({
      definition: {
        ...section,
        title: interpolate(section.title),
        content: undefined,
      },
      content: interpolate(resolveSectionContent(section, definition)),
    }));
  const recommendations = findingRows
    .filter((finding) => finding.remediation)
    .map((finding) => ({
      identifier: finding.identifier,
      title: finding.title,
      severity: finding.severity,
      remediation: finding.remediation ?? "",
    }));
  return {
    reportId: input.reportId,
    reportVersionId: input.reportVersionId,
    version: input.version,
    title: input.title,
    organisationName,
    clientName,
    engagementName: input.engagement.name,
    engagementReference: input.engagement.reference,
    classification: definition.classification,
    generatedAt: new Date().toISOString(),
    whiteLabel,
    tagline: branding.tagline,
    logoDataUri: safeLogoDataUri(branding.logoUrl),
    clientLogoDataUri: safeLogoDataUri(
      definition.branding.clientLogoUrl ?? clientRows[0]?.branding?.logoUrl,
    ),
    startDate: input.engagement.startDate,
    endDate: input.engagement.endDate,
    preparedBy: branding.preparedBy,
    address: branding.address ?? clientRows[0]?.address ?? undefined,
    website: branding.website,
    contactEmail: branding.contactEmail,
    contactPhone: branding.contactPhone,
    documentControl: [
      { field: "Document title", value: input.title },
      { field: "Version", value: String(input.version) },
      { field: "Client", value: clientName },
      {
        field: "Engagement",
        value: `${input.engagement.name} (${input.engagement.reference})`,
      },
      { field: "Classification", value: definition.classification },
      { field: "Date of issue", value: variables["generated.date"] ?? "" },
      {
        field: "Testing window",
        value:
          startDate || endDate
            ? `${startDate || "not recorded"} – ${endDate || "not recorded"}`
            : "Not recorded",
      },
      { field: "Prepared by", value: branding.preparedBy ?? organisationName },
    ],
    severityRatings: DEFAULT_SEVERITY_RATINGS,
    glossary: DEFAULT_PENTEST_GLOSSARY,
    contacts: [
      {
        role: "Assessing organisation",
        name: organisationName,
        email: branding.contactEmail,
        phone: branding.contactPhone,
      },
      ...(branding.preparedBy
        ? [
            {
              role: "Prepared by",
              name: branding.preparedBy,
              email: branding.contactEmail,
            },
          ]
        : []),
    ],
    recommendations,
    theme: {
      primaryColour: branding.primaryColour ?? definition.branding.primaryColour,
      accentColour: branding.accentColour ?? definition.branding.accentColour,
      bodyFont: definition.typography.bodyFont,
      headingFont: definition.typography.headingFont,
      bodySize: definition.typography.bodySize,
      customCss: input.template.customCss,
      headerLeft: interpolate(definition.header.left),
      headerRight: interpolate(definition.header.right),
      footerLeft: interpolate(definition.footer.left),
      showPageNumbers: definition.footer.showPageNumbers ?? true,
      watermark: interpolate(definition.watermark),
    },
    sections,
    findings: findingRows.map((finding) => ({
      identifier: finding.identifier,
      title: finding.title,
      severity: finding.severity,
      status: finding.status,
      executiveSummary: finding.executiveSummary,
      technicalDetail: finding.technicalDetail,
      businessImpact: finding.businessImpact,
      remediation: finding.remediation,
      cvssVector: finding.cvssVector,
      cvssScore: finding.cvssScore,
    })),
    scope: scopeRows.map((item) => ({
      name: item.name,
      value: item.value,
      status: item.scopeStatus,
    })),
    assets: assetRows.map((asset) => ({
      name: asset.name,
      type: asset.type,
      identifier: asset.identifier,
      criticality: asset.criticality,
    })),
    evidence: evidenceRows.map((item) => ({
      filename: item.originalFilename,
      mediaType: item.mediaType,
      classification: item.classification,
      sha256: item.sha256,
    })),
    severityCounts,
    signatures: definition.signatures ?? [],
  };
}

function resolveSectionContent(
  section: ReportSectionDefinition,
  definition: ReportTemplateDefinition,
) {
  if (section.type === "reusable_content" || section.reusableKey)
    return definition.reusableContent?.[section.reusableKey ?? ""] ?? section.content;
  if (section.type === "methodology")
    return (
      definition.reusableContent?.[section.reusableKey ?? "methodology"] ??
      section.content ??
      DEFAULT_METHODOLOGY
    );
  if (section.type === "confidentiality") return section.content ?? DEFAULT_CONFIDENTIALITY_NOTICE;
  return section.content;
}

function conditionMatches(
  condition: ReportSectionDefinition["condition"],
  context: Record<string, string | boolean>,
) {
  if (!condition) return true;
  const value = context[condition.field];
  if (condition.operator === "truthy") return Boolean(value);
  if (condition.operator === "not_equals") return value !== condition.value;
  return value === condition.value;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Queryable = typeof db | Transaction;
async function requireTemplate(query: Queryable, organisationId: string, id: string) {
  const [row] = await query
    .select()
    .from(reportTemplates)
    .where(and(eq(reportTemplates.id, id), eq(reportTemplates.organisationId, organisationId)))
    .limit(1);
  if (!row) throw new ReportScopeError();
  return row;
}
async function requireReport(query: Queryable, organisationId: string, id: string) {
  const [row] = await query
    .select()
    .from(reports)
    .where(and(eq(reports.id, id), eq(reports.organisationId, organisationId)))
    .limit(1);
  if (!row) throw new ReportScopeError();
  return row;
}
async function requireCurrentVersion(
  query: Queryable,
  organisationId: string,
  report: typeof reports.$inferSelect,
) {
  const [row] = await query
    .select()
    .from(reportVersions)
    .where(
      and(
        eq(reportVersions.organisationId, organisationId),
        eq(reportVersions.reportId, report.id),
        eq(reportVersions.version, report.currentVersion),
      ),
    )
    .limit(1);
  if (!row) throw new ReportScopeError("Current report version is unavailable");
  return row;
}
async function requireEngagement(organisationId: string, id: string) {
  const [row] = await db
    .select()
    .from(engagements)
    .where(
      and(
        eq(engagements.id, id),
        eq(engagements.organisationId, organisationId),
        isNull(engagements.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new ReportScopeError();
  return row;
}
async function assertClient(organisationId: string, id?: string) {
  if (!id) return;
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(
      and(
        eq(clients.id, id),
        eq(clients.organisationId, organisationId),
        isNull(clients.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new ReportScopeError("Client is unavailable");
}

export const reportFormats: readonly ReportFormat[] = ["pdf", "docx", "html", "markdown", "json"];
export const reportStatuses = Object.keys(reportWorkflow) as ReportStatus[];
