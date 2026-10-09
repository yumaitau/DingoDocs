import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  auditEvents,
  clientContacts,
  clients,
  comments,
  engagementContacts,
  engagementMembers,
  engagements,
  evidence,
  evidenceFindings,
  findingAssets,
  findings,
  findingTemplates,
  findingTransitions,
  findingVersions,
  importItems,
  importRuns,
  notes,
  organisationMembers,
  organisations,
  reports,
  reportReviews,
  reportTransitions,
  reportVersions,
  remediationUpdates,
  retestAttempts,
  retestEvidence,
  retestNotes,
  riskMatrices,
  runbookTemplates,
  scopeItems,
  scopeVersions,
  tasks,
  timeEntries,
  users,
} from "@/db/schema";
import {
  parseScannerImport,
  type ImportAdapterName,
  type NormalizedImportItem,
} from "@/lib/imports/adapters";
import { summariseScannerIngest } from "@/lib/imports/ingest-summary";
import { assertActorEngagementAccess } from "@/lib/permissions/require";
import { uploadEvidence } from "./evidence";
import { emitDomainEvent } from "./domain-events";
import { findingScheduleDefaults } from "./finding-schedule";
import {
  createTimelineEntry,
  createWorkspaceNote,
} from "./engagement-workspace";

export type ExchangeActor = { organisationId: string; userId: string };
export class ExchangeScopeError extends Error {
  constructor() {
    super("The requested exchange resource was not found");
    this.name = "ExchangeScopeError";
  }
}

export async function previewScannerImport(
  actor: ExchangeActor,
  input: {
    engagementId: string;
    adapter: ImportAdapterName;
    filename: string;
    mediaType: string;
    bytes: Uint8Array;
  },
) {
  const [engagement] = await db
    .select({ id: engagements.id })
    .from(engagements)
    .where(
      and(
        eq(engagements.id, input.engagementId),
        eq(engagements.organisationId, actor.organisationId),
        isNull(engagements.deletedAt),
      ),
    )
    .limit(1);
  if (!engagement) throw new ExchangeScopeError();
  await assertActorEngagementAccess(actor, input.engagementId);
  const normalized = parseScannerImport(input.adapter, input.bytes);
  const source = await uploadEvidence(
    { ...actor, canViewRestricted: true },
    {
      engagementId: input.engagementId,
      filename: input.filename,
      mediaType: input.mediaType,
      bytes: input.bytes,
      classification: "internal",
      allowDuplicate: true,
    },
  );
  await db
    .update(evidence)
    .set({ immutable: true })
    .where(eq(evidence.id, source.id));
  const existing = await db
    .select({ fingerprint: findings.sourceFingerprint })
    .from(findings)
    .where(
      and(
        eq(findings.organisationId, actor.organisationId),
        eq(findings.engagementId, input.engagementId),
        inArray(
          findings.sourceFingerprint,
          normalized.map((item) => item.fingerprint),
        ),
        isNull(findings.deletedAt),
      ),
    );
  const duplicate = new Set(
    existing.map((row) => row.fingerprint).filter(Boolean),
  );
  const actions = normalized.map((item) => {
    const action = duplicate.has(item.fingerprint) ? "duplicate" : "create";
    duplicate.add(item.fingerprint);
    return action;
  });
  const duplicateCount = actions.filter(
    (action) => action === "duplicate",
  ).length;
  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(importRuns)
      .values({
        organisationId: actor.organisationId,
        engagementId: input.engagementId,
        sourceEvidenceId: source.id,
        adapter: input.adapter,
        sourceFilename: source.originalFilename,
        sourceSha256: source.sha256,
        createdBy: actor.userId,
        summary: {
          total: normalized.length,
          new: normalized.length - duplicateCount,
          duplicate: duplicateCount,
          selected: normalized.length - duplicateCount,
        },
      })
      .returning();
    const items = await tx
      .insert(importItems)
      .values(
        normalized.map((item, index) => ({
          organisationId: actor.organisationId,
          importRunId: run!.id,
          fingerprint: item.fingerprint,
          externalId: item.externalId,
          title: item.title,
          severity: item.severity,
          assetIdentifier: item.assetIdentifier,
          action: actions[index],
          selected: actions[index] === "create",
          normalized: item,
        })),
      )
      .returning();
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "import.previewed",
      targetType: "import_run",
      targetId: run!.id,
      metadata: {
        adapter: input.adapter,
        engagementId: input.engagementId,
        sourceEvidenceId: source.id,
        total: normalized.length,
        duplicates: duplicateCount,
      },
    });
    return { run: run!, items, sourceEvidence: { ...source, immutable: true } };
  });
}

export async function applyScannerImport(
  actor: ExchangeActor,
  input: { importRunId: string; selectedItemIds: string[] },
) {
  const applied = await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(importRuns)
      .where(
        and(
          eq(importRuns.id, input.importRunId),
          eq(importRuns.organisationId, actor.organisationId),
          eq(importRuns.status, "previewed"),
        ),
      )
      .limit(1);
    if (!run) throw new ExchangeScopeError();
    const [engagement] = await tx
      .select({ clientId: engagements.clientId })
      .from(engagements)
      .where(
        and(
          eq(engagements.id, run.engagementId),
          eq(engagements.organisationId, actor.organisationId),
        ),
      )
      .limit(1);
    const scheduleBySeverity = new Map<
      string,
      { dueAt?: Date; retainUntil?: Date }
    >();
    const selectedIds = [...new Set(input.selectedItemIds)];
    const rows = selectedIds.length
      ? await tx
          .select()
          .from(importItems)
          .where(
            and(
              eq(importItems.organisationId, actor.organisationId),
              eq(importItems.importRunId, run.id),
              inArray(importItems.id, selectedIds),
              eq(importItems.action, "create"),
            ),
          )
      : [];
    if (rows.length !== selectedIds.length) throw new ExchangeScopeError();
    const applied: Array<{
      itemId: string;
      findingId: string;
      assetId?: string;
    }> = [];
    for (const row of rows) {
      const item = row.normalized as unknown as NormalizedImportItem;
      let assetId: string | undefined;
      if (item.assetIdentifier) {
        const existing = await tx
          .select({ id: assets.id })
          .from(assets)
          .where(
            and(
              eq(assets.organisationId, actor.organisationId),
              eq(assets.engagementId, run.engagementId),
              eq(assets.identifier, item.assetIdentifier),
              isNull(assets.deletedAt),
            ),
          )
          .limit(1);
        if (existing[0]) assetId = existing[0].id;
        else {
          const [asset] = await tx
            .insert(assets)
            .values({
              organisationId: actor.organisationId,
              engagementId: run.engagementId,
              name: item.assetIdentifier,
              type: "scanner_target",
              identifier: item.assetIdentifier,
              sourceProvenance: {
                importRunId: run.id,
                adapter: run.adapter,
                sourceEvidenceId: run.sourceEvidenceId,
              },
            })
            .returning({ id: assets.id });
          assetId = asset!.id;
        }
      }
      let schedule = scheduleBySeverity.get(item.severity);
      if (!schedule && engagement) {
        schedule = await findingScheduleDefaults(tx, {
          organisationId: actor.organisationId,
          clientId: engagement.clientId,
          severity: item.severity,
        });
        scheduleBySeverity.set(item.severity, schedule);
      }
      const [finding] = await tx
        .insert(findings)
        .values({
          organisationId: actor.organisationId,
          engagementId: run.engagementId,
          identifier: `IMP-${row.fingerprint.slice(0, 10).toUpperCase()}`,
          title: item.title,
          status: "draft",
          severity: item.severity,
          dueAt: schedule?.dueAt,
          retainUntil: schedule?.retainUntil,
          cvssScore: item.cvssScore?.toFixed(1),
          technicalDetail: item.description,
          remediation: item.remediation,
          references: item.references ?? [],
          authorId: actor.userId,
          sourceFingerprint: row.fingerprint,
          sourceProvenance: {
            importRunId: run.id,
            adapter: run.adapter,
            externalId: item.externalId,
            sourceEvidenceId: run.sourceEvidenceId,
            sourceSha256: run.sourceSha256,
          },
        })
        .returning({ id: findings.id });
      if (assetId)
        await tx.insert(findingAssets).values({
          organisationId: actor.organisationId,
          findingId: finding!.id,
          assetId,
        });
      await tx
        .update(importItems)
        .set({
          selected: true,
          findingId: finding!.id,
          assetId,
          appliedAt: new Date(),
        })
        .where(eq(importItems.id, row.id));
      applied.push({ itemId: row.id, findingId: finding!.id, assetId });
    }
    await tx
      .update(importItems)
      .set({ selected: false })
      .where(
        and(
          eq(importItems.importRunId, run.id),
          eq(importItems.action, "create"),
          selectedIds.length
            ? notInArray(importItems.id, selectedIds)
            : undefined,
        ),
      );
    await tx
      .update(importRuns)
      .set({
        status: "applied",
        appliedAt: new Date(),
        summary: {
          ...(run.summary as {
            total: number;
            new: number;
            duplicate: number;
            selected: number;
          }),
          selected: applied.length,
        },
      })
      .where(eq(importRuns.id, run.id));
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "import.applied",
      targetType: "import_run",
      targetId: run.id,
      metadata: { engagementId: run.engagementId, selected: applied.length },
    });
    return { applied, engagementId: run.engagementId };
  });
  await emitDomainEvent({
    organisationId: actor.organisationId,
    actorUserId: actor.userId,
    eventType: "import.applied",
    title: `Scanner import applied (${applied.applied.length} findings)`,
    actionUrl: `/engagements/${applied.engagementId}?view=findings`,
    payload: {
      importRunId: input.importRunId,
      engagementId: applied.engagementId,
      created: applied.applied.length,
    },
  });
  return applied.applied;
}

export async function getImportPreview(
  actor: {
    organisationId: string;
    userId?: string;
    role?: string | null;
    serviceAccountId?: string | null;
  },
  importRunId: string,
) {
  const [run] = await db
    .select()
    .from(importRuns)
    .where(
      and(
        eq(importRuns.id, importRunId),
        eq(importRuns.organisationId, actor.organisationId),
      ),
    )
    .limit(1);
  if (!run) throw new ExchangeScopeError();
  await assertActorEngagementAccess(actor, run.engagementId);
  const items = await db
    .select()
    .from(importItems)
    .where(
      and(
        eq(importItems.organisationId, actor.organisationId),
        eq(importItems.importRunId, run.id),
      ),
    )
    .orderBy(asc(importItems.title));
  return { run, items };
}

export async function ingestScannerImport(
  actor: ExchangeActor,
  input: {
    engagementId: string;
    adapter: ImportAdapterName;
    filename: string;
    mediaType?: string;
    bytes: Uint8Array;
    applyCreates?: boolean;
  },
) {
  const preview = await previewScannerImport(actor, {
    engagementId: input.engagementId,
    adapter: input.adapter,
    filename: input.filename,
    mediaType:
      input.mediaType ?? mediaTypeForImport(input.filename, input.bytes),
    bytes: input.bytes,
  });
  const selectedItemIds = preview.items
    .filter((item) => item.action === "create")
    .map((item) => item.id);
  const applied =
    input.applyCreates === false
      ? []
      : await applyScannerImport(actor, {
          importRunId: preview.run.id,
          selectedItemIds,
        });
  const summary = summariseScannerIngest({
    adapter: input.adapter,
    filename: input.filename,
    appliedCount: applied.length,
    items: preview.items.map((item) => ({
      title: item.title,
      severity: item.severity,
      action: item.action,
      assetIdentifier: item.assetIdentifier,
    })),
  });
  const note = await createWorkspaceNote(actor, {
    engagementId: input.engagementId,
    title: `Scanner ingest (${input.adapter})`,
    body: summary.note,
    kind: "testing_journal",
    visibility: "team",
  });
  const timeline = await createTimelineEntry(actor, {
    engagementId: input.engagementId,
    occurredAt: new Date(),
    phase: "testing",
    description: summary.timeline,
    clientVisible: false,
  });
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "import.ingested",
    targetType: "import_run",
    targetId: preview.run.id,
    metadata: {
      engagementId: input.engagementId,
      adapter: input.adapter,
      applied: applied.length,
      publication: "draft",
      noteId: note.id,
      timelineId: timeline?.id,
    },
  });
  return {
    run: preview.run,
    items: preview.items,
    applied,
    note,
    timeline,
    publication: "draft" as const,
    summary,
  };
}

export function mediaTypeForImport(filename: string, bytes: Uint8Array) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  const source = new TextDecoder("utf-8").decode(bytes).trimStart();
  if (source.startsWith("<")) return "application/xml";
  try {
    JSON.parse(new TextDecoder("utf-8").decode(bytes));
    return "application/json";
  } catch {
    return "text/plain";
  }
}

export async function exportOrganisation(
  actor: ExchangeActor,
  mode: "data" | "migration" = "data",
) {
  const organisationId = actor.organisationId;
  const [
    organisation,
    clientRows,
    engagementRows,
    findingRows,
    evidenceRows,
    assetRows,
    scopeVersionRows,
    scopeItemRows,
    reportRows,
    reportVersionRows,
    taskRows,
    auditRows,
    timeRows,
    noteRows,
    templateRows,
    memberRows,
  ] = await Promise.all([
    db.select().from(organisations).where(eq(organisations.id, organisationId)),
    db.select().from(clients).where(eq(clients.organisationId, organisationId)),
    db
      .select()
      .from(engagements)
      .where(eq(engagements.organisationId, organisationId)),
    db
      .select()
      .from(findings)
      .where(eq(findings.organisationId, organisationId)),
    db
      .select({
        id: evidence.id,
        clientId: evidence.clientId,
        engagementId: evidence.engagementId,
        originalFilename: evidence.originalFilename,
        mediaType: evidence.mediaType,
        sizeBytes: evidence.sizeBytes,
        sha256: evidence.sha256,
        classification: evidence.classification,
        restrictions: evidence.restrictions,
        retentionStatus: evidence.retentionStatus,
        retentionUntil: evidence.retentionUntil,
        version: evidence.version,
        immutable: evidence.immutable,
        malwareScanStatus: evidence.malwareScanStatus,
        createdAt: evidence.createdAt,
      })
      .from(evidence)
      .where(eq(evidence.organisationId, organisationId)),
    db.select().from(assets).where(eq(assets.organisationId, organisationId)),
    db
      .select()
      .from(scopeVersions)
      .where(eq(scopeVersions.organisationId, organisationId)),
    db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.organisationId, organisationId)),
    db.select().from(reports).where(eq(reports.organisationId, organisationId)),
    db
      .select({
        id: reportVersions.id,
        reportId: reportVersions.reportId,
        version: reportVersions.version,
        status: reportVersions.status,
        content: reportVersions.content,
        immutable: reportVersions.immutable,
        renderStatus: reportVersions.renderStatus,
        checksum: reportVersions.checksum,
        createdBy: reportVersions.createdBy,
        approvedBy: reportVersions.approvedBy,
        approvedAt: reportVersions.approvedAt,
        clientVisible: reportVersions.clientVisible,
        clientApprovedBy: reportVersions.clientApprovedBy,
        clientApprovedAt: reportVersions.clientApprovedAt,
        publishedAt: reportVersions.publishedAt,
        createdAt: reportVersions.createdAt,
      })
      .from(reportVersions)
      .where(eq(reportVersions.organisationId, organisationId)),
    db.select().from(tasks).where(eq(tasks.organisationId, organisationId)),
    db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organisationId, organisationId)),
    db
      .select()
      .from(timeEntries)
      .where(eq(timeEntries.organisationId, organisationId)),
    db.select().from(notes).where(eq(notes.organisationId, organisationId)),
    db
      .select()
      .from(findingTemplates)
      .where(eq(findingTemplates.organisationId, organisationId)),
    db
      .select({
        userId: organisationMembers.userId,
        role: organisationMembers.role,
        name: users.name,
        email: users.email,
        joinedAt: organisationMembers.joinedAt,
      })
      .from(organisationMembers)
      .innerJoin(users, eq(users.id, organisationMembers.userId))
      .where(
        and(
          eq(organisationMembers.organisationId, organisationId),
          isNull(organisationMembers.deletedAt),
        ),
      ),
  ]);
  if (!organisation[0]) throw new ExchangeScopeError();
  const migrationData =
    mode === "migration"
      ? await Promise.all([
          db
            .select()
            .from(clientContacts)
            .where(eq(clientContacts.organisationId, organisationId)),
          db
            .select()
            .from(engagementContacts)
            .where(eq(engagementContacts.organisationId, organisationId)),
          db
            .select()
            .from(engagementMembers)
            .where(eq(engagementMembers.organisationId, organisationId)),
          db
            .select()
            .from(comments)
            .where(eq(comments.organisationId, organisationId)),
          db
            .select()
            .from(findingVersions)
            .where(eq(findingVersions.organisationId, organisationId)),
          db
            .select()
            .from(findingTransitions)
            .where(eq(findingTransitions.organisationId, organisationId)),
          db
            .select()
            .from(evidenceFindings)
            .where(eq(evidenceFindings.organisationId, organisationId)),
          db
            .select()
            .from(reportTransitions)
            .where(eq(reportTransitions.organisationId, organisationId)),
          db
            .select()
            .from(reportReviews)
            .where(eq(reportReviews.organisationId, organisationId)),
          db
            .select()
            .from(remediationUpdates)
            .where(eq(remediationUpdates.organisationId, organisationId)),
          db
            .select()
            .from(retestAttempts)
            .where(eq(retestAttempts.organisationId, organisationId)),
          db
            .select()
            .from(retestNotes)
            .where(eq(retestNotes.organisationId, organisationId)),
          db
            .select()
            .from(retestEvidence)
            .where(eq(retestEvidence.organisationId, organisationId)),
        ])
      : null;
  const payload = {
    format: "dingodocs-organisation",
    version: 1,
    mode,
    exportedAt: new Date().toISOString(),
    organisation: organisation[0],
    clients: clientRows,
    engagements: engagementRows,
    findings: findingRows,
    evidence: evidenceRows,
    assets: assetRows,
    scopeVersions: scopeVersionRows,
    scopeItems: scopeItemRows,
    reports: reportRows,
    reportVersions: reportVersionRows,
    tasks: taskRows,
    auditEvents: auditRows,
    timeEntries: timeRows,
    ...(mode === "migration"
      ? {
          notes: noteRows,
          findingTemplates: templateRows,
          members: memberRows,
          clientContacts: migrationData![0],
          engagementContacts: migrationData![1],
          engagementMembers: migrationData![2],
          comments: migrationData![3],
          findingVersions: migrationData![4],
          findingTransitions: migrationData![5],
          evidenceFindings: migrationData![6],
          reportTransitions: migrationData![7],
          reportReviews: migrationData![8],
          remediationUpdates: migrationData![9],
          retestAttempts: migrationData![10],
          retestNotes: migrationData![11],
          retestEvidence: migrationData![12],
        }
      : {}),
  };
  const json = JSON.stringify(payload, null, 2);
  const checksum = createHash("sha256").update(json).digest("hex");
  await db.insert(auditEvents).values({
    organisationId,
    actorId: actor.userId,
    action: `organisation.${mode}_exported`,
    targetType: "organisation",
    targetId: organisationId,
    metadata: {
      checksum,
      counts: {
        engagements: engagementRows.length,
        findings: findingRows.length,
        evidence: evidenceRows.length,
      },
    },
  });
  return { payload, json, checksum };
}

type OrganisationBundle = {
  format?: string;
  version?: number;
  mode?: string;
  checksum?: string;
  organisation?: { id?: string };
  clients?: Array<Record<string, unknown>>;
  engagements?: Array<Record<string, unknown>>;
  findings?: Array<Record<string, unknown>>;
  findingTemplates?: Array<Record<string, unknown>>;
  templates?: Array<Record<string, unknown>>;
  runbooks?: Array<Record<string, unknown>>;
  runbookTemplates?: Array<Record<string, unknown>>;
  riskMatrices?: Array<Record<string, unknown>>;
  evidence?: unknown[];
};

function asUuid(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null;
}

async function resolveImportId(
  organisationId: string,
  table:
    | "clients"
    | "engagements"
    | "findings"
    | "finding_templates"
    | "runbook_templates"
    | "risk_matrices",
  candidate: unknown,
) {
  const id = asUuid(candidate);
  if (!id) return randomUUID();
  if (table === "clients") {
    const [row] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(eq(clients.id, id), eq(clients.organisationId, organisationId)),
      )
      .limit(1);
    return row ? id : randomUUID();
  }
  if (table === "engagements") {
    const [row] = await db
      .select({ id: engagements.id })
      .from(engagements)
      .where(
        and(
          eq(engagements.id, id),
          eq(engagements.organisationId, organisationId),
        ),
      )
      .limit(1);
    return row ? id : randomUUID();
  }
  if (table === "findings") {
    const [row] = await db
      .select({ id: findings.id })
      .from(findings)
      .where(
        and(eq(findings.id, id), eq(findings.organisationId, organisationId)),
      )
      .limit(1);
    return row ? id : randomUUID();
  }
  if (table === "finding_templates") {
    const [row] = await db
      .select({ id: findingTemplates.id })
      .from(findingTemplates)
      .where(
        and(
          eq(findingTemplates.id, id),
          eq(findingTemplates.organisationId, organisationId),
        ),
      )
      .limit(1);
    return row ? id : randomUUID();
  }
  if (table === "runbook_templates") {
    const [row] = await db
      .select({ id: runbookTemplates.id })
      .from(runbookTemplates)
      .where(
        and(
          eq(runbookTemplates.id, id),
          eq(runbookTemplates.organisationId, organisationId),
        ),
      )
      .limit(1);
    return row ? id : randomUUID();
  }
  const [row] = await db
    .select({ id: riskMatrices.id })
    .from(riskMatrices)
    .where(
      and(
        eq(riskMatrices.id, id),
        eq(riskMatrices.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ? id : randomUUID();
}

/**
 * Import an organisation export bundle. Evidence binaries are skipped.
 * Ids that already belong to the actor org are reused (idempotent upsert);
 * foreign ids get remapped.
 */
export async function importOrganisationBundle(
  actor: ExchangeActor,
  json: string | OrganisationBundle,
) {
  const bundle: OrganisationBundle =
    typeof json === "string" ? (JSON.parse(json) as OrganisationBundle) : json;

  if (bundle.checksum) {
    const { checksum, ...rest } = bundle;
    const recomputed = createHash("sha256")
      .update(JSON.stringify(rest))
      .digest("hex");
    if (recomputed !== checksum)
      throw new Error("Organisation bundle checksum mismatch");
  }

  const bundleOrgId = bundle.organisation?.id;
  if (!bundleOrgId || bundleOrgId !== actor.organisationId) {
    throw new Error(
      "Organisation bundle organisation id does not match the active organisation",
    );
  }

  const clientIdMap = new Map<string, string>();
  const engagementIdMap = new Map<string, string>();
  const counts = {
    clients: 0,
    engagements: 0,
    findings: 0,
    templates: 0,
    runbooks: 0,
    riskMatrices: 0,
    evidenceSkipped: Array.isArray(bundle.evidence)
      ? bundle.evidence.length
      : 0,
  };

  await db.transaction(async (tx) => {
    for (const row of bundle.clients ?? []) {
      const sourceId = asUuid(row.id) ?? randomUUID();
      const targetId = await resolveImportId(
        actor.organisationId,
        "clients",
        sourceId,
      );
      clientIdMap.set(sourceId, targetId);
      const values = {
        id: targetId,
        organisationId: actor.organisationId,
        name: String(row.name ?? "Imported client"),
        legalName: (row.legalName as string | null | undefined) ?? null,
        tradingName: (row.tradingName as string | null | undefined) ?? null,
        industry: (row.industry as string | null | undefined) ?? null,
        address: (row.address as string | null | undefined) ?? null,
        notes: (row.notes as string | null | undefined) ?? null,
        securityClassification: String(
          row.securityClassification ?? "Confidential",
        ),
        branding: (row.branding as Record<string, unknown> | undefined) ?? {},
        reportPreferences:
          (row.reportPreferences as Record<string, unknown> | undefined) ?? {},
        retentionPolicy:
          (row.retentionPolicy as Record<string, unknown> | undefined) ?? {},
        updatedAt: new Date(),
        deletedAt: null,
      };
      await tx
        .insert(clients)
        .values(values)
        .onConflictDoUpdate({
          target: clients.id,
          set: {
            name: values.name,
            legalName: values.legalName,
            tradingName: values.tradingName,
            industry: values.industry,
            address: values.address,
            notes: values.notes,
            securityClassification: values.securityClassification,
            branding: values.branding,
            reportPreferences: values.reportPreferences,
            retentionPolicy: values.retentionPolicy,
            updatedAt: values.updatedAt,
            deletedAt: null,
          },
        });
      counts.clients += 1;
    }

    for (const row of bundle.engagements ?? []) {
      const sourceId = asUuid(row.id) ?? randomUUID();
      const sourceClientId = asUuid(row.clientId);
      const clientId = sourceClientId
        ? clientIdMap.get(sourceClientId)
        : undefined;
      if (!clientId) continue;
      const targetId = await resolveImportId(
        actor.organisationId,
        "engagements",
        sourceId,
      );
      engagementIdMap.set(sourceId, targetId);
      const values = {
        id: targetId,
        organisationId: actor.organisationId,
        clientId,
        name: String(row.name ?? "Imported engagement"),
        reference: String(row.reference ?? `IMP-${targetId.slice(0, 8)}`),
        type: String(row.type ?? "assessment"),
        status:
          (row.status as typeof engagements.$inferInsert.status) ?? "proposed",
        objectives: (row.objectives as string | null | undefined) ?? null,
        assumptions: (row.assumptions as string | null | undefined) ?? null,
        constraints: (row.constraints as string | null | undefined) ?? null,
        dependencies: (row.dependencies as string | null | undefined) ?? null,
        securityClassification: String(
          row.securityClassification ?? "Confidential",
        ),
        health: String(row.health ?? "on_track"),
        progress: Number(row.progress ?? 0),
        tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
        retainUntil: row.retainUntil ? new Date(String(row.retainUntil)) : null,
        updatedAt: new Date(),
        deletedAt: null,
      };
      await tx
        .insert(engagements)
        .values(values)
        .onConflictDoUpdate({
          target: engagements.id,
          set: {
            clientId: values.clientId,
            name: values.name,
            reference: values.reference,
            type: values.type,
            status: values.status,
            objectives: values.objectives,
            assumptions: values.assumptions,
            constraints: values.constraints,
            dependencies: values.dependencies,
            securityClassification: values.securityClassification,
            health: values.health,
            progress: values.progress,
            tags: values.tags,
            retainUntil: values.retainUntil,
            updatedAt: values.updatedAt,
            deletedAt: null,
          },
        });
      counts.engagements += 1;
    }

    const templateRows = [
      ...(bundle.findingTemplates ?? []),
      ...(bundle.templates ?? []),
    ];
    for (const row of templateRows) {
      const sourceId = asUuid(row.id) ?? randomUUID();
      const targetId = await resolveImportId(
        actor.organisationId,
        "finding_templates",
        sourceId,
      );
      const values = {
        id: targetId,
        organisationId: actor.organisationId,
        stableKey: String(row.stableKey ?? `import-${targetId}`),
        version: Number(row.version ?? 1),
        title: String(row.title ?? "Imported template"),
        summary: String(row.summary ?? ""),
        executiveDescription:
          (row.executiveDescription as string | null | undefined) ?? null,
        technicalDescription: String(row.technicalDescription ?? ""),
        businessImpact:
          (row.businessImpact as string | null | undefined) ?? null,
        technicalImpact:
          (row.technicalImpact as string | null | undefined) ?? null,
        likelihood: (row.likelihood as string | null | undefined) ?? null,
        severity:
          (row.severity as typeof findingTemplates.$inferInsert.severity) ??
          "informational",
        riskRationale: (row.riskRationale as string | null | undefined) ?? null,
        remediation: String(row.remediation ?? ""),
        verificationSteps:
          (row.verificationSteps as string | null | undefined) ?? null,
        references: Array.isArray(row.references)
          ? (row.references as string[])
          : [],
        tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
        assessmentTypes: Array.isArray(row.assessmentTypes)
          ? (row.assessmentTypes as string[])
          : [],
        mappings: Array.isArray(row.mappings) ? row.mappings : [],
      };
      await tx
        .insert(findingTemplates)
        .values(values as typeof findingTemplates.$inferInsert)
        .onConflictDoUpdate({
          target: findingTemplates.id,
          set: {
            title: values.title,
            summary: values.summary,
            technicalDescription: values.technicalDescription,
            remediation: values.remediation,
            severity: values.severity,
          },
        });
      counts.templates += 1;
    }

    for (const row of bundle.findings ?? []) {
      const sourceId = asUuid(row.id) ?? randomUUID();
      const sourceEngagementId = asUuid(row.engagementId);
      const engagementId = sourceEngagementId
        ? engagementIdMap.get(sourceEngagementId)
        : undefined;
      if (!engagementId) continue;
      const targetId = await resolveImportId(
        actor.organisationId,
        "findings",
        sourceId,
      );
      const values = {
        id: targetId,
        organisationId: actor.organisationId,
        engagementId,
        identifier: String(row.identifier ?? `F-${targetId.slice(0, 8)}`),
        title: String(row.title ?? "Imported finding"),
        status: (row.status as typeof findings.$inferInsert.status) ?? "draft",
        severity:
          (row.severity as typeof findings.$inferInsert.severity) ??
          "informational",
        executiveSummary:
          (row.executiveSummary as string | null | undefined) ?? null,
        technicalDetail:
          (row.technicalDetail as string | null | undefined) ?? null,
        remediation: (row.remediation as string | null | undefined) ?? null,
        references: Array.isArray(row.references)
          ? (row.references as string[])
          : [],
        mappings: Array.isArray(row.mappings) ? row.mappings : [],
        sourceProvenance:
          (row.sourceProvenance as Record<string, unknown> | undefined) ?? {},
        retainUntil: row.retainUntil ? new Date(String(row.retainUntil)) : null,
        updatedAt: new Date(),
        deletedAt: null,
      };
      await tx
        .insert(findings)
        .values(values as typeof findings.$inferInsert)
        .onConflictDoUpdate({
          target: findings.id,
          set: {
            engagementId: values.engagementId,
            identifier: values.identifier,
            title: values.title,
            status: values.status,
            severity: values.severity,
            executiveSummary: values.executiveSummary,
            technicalDetail: values.technicalDetail,
            remediation: values.remediation,
            sourceProvenance: values.sourceProvenance,
            retainUntil: values.retainUntil,
            updatedAt: values.updatedAt,
            deletedAt: null,
          },
        });
      counts.findings += 1;
    }

    const runbookRows = [
      ...(bundle.runbookTemplates ?? []),
      ...(bundle.runbooks ?? []),
    ];
    for (const row of runbookRows) {
      const sourceId = asUuid(row.id) ?? randomUUID();
      const targetId = await resolveImportId(
        actor.organisationId,
        "runbook_templates",
        sourceId,
      );
      const values = {
        id: targetId,
        organisationId: actor.organisationId,
        name: String(row.name ?? "Imported runbook"),
        description: (row.description as string | null | undefined) ?? null,
        assessmentTypes: Array.isArray(row.assessmentTypes)
          ? (row.assessmentTypes as string[])
          : [],
        tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
        version: Number(row.version ?? 1),
        status: String(row.status ?? "draft"),
        createdBy: actor.userId,
        updatedAt: new Date(),
      };
      await tx
        .insert(runbookTemplates)
        .values(values)
        .onConflictDoUpdate({
          target: runbookTemplates.id,
          set: {
            name: values.name,
            description: values.description,
            assessmentTypes: values.assessmentTypes,
            tags: values.tags,
            status: values.status,
            updatedAt: values.updatedAt,
          },
        });
      counts.runbooks += 1;
    }

    for (const row of bundle.riskMatrices ?? []) {
      const sourceId = asUuid(row.id) ?? randomUUID();
      const targetId = await resolveImportId(
        actor.organisationId,
        "risk_matrices",
        sourceId,
      );
      const values = {
        id: targetId,
        organisationId: actor.organisationId,
        clientId: (() => {
          const sourceClientId = asUuid(row.clientId);
          if (!sourceClientId) return null;
          return clientIdMap.get(sourceClientId) ?? null;
        })(),
        name: String(row.name ?? "Imported matrix"),
        definition: (row.definition as {
          likelihood: Array<{ key: string; label: string; order: number }>;
          impact: Array<{ key: string; label: string; order: number }>;
          ratings: Array<{
            likelihood: string;
            impact: string;
            severity: "informational" | "low" | "medium" | "high" | "critical";
            label: string;
            colour: string;
          }>;
        }) ?? { likelihood: [], impact: [], ratings: [] },
        isDefault: Boolean(row.isDefault),
        version: Number(row.version ?? 1),
        createdBy: actor.userId,
      };
      await tx
        .insert(riskMatrices)
        .values(values as typeof riskMatrices.$inferInsert)
        .onConflictDoUpdate({
          target: riskMatrices.id,
          set: {
            name: values.name,
            definition: values.definition,
            isDefault: values.isDefault,
            version: values.version,
          },
        });
      counts.riskMatrices += 1;
    }
  });

  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "organisation.imported",
    targetType: "organisation",
    targetId: actor.organisationId,
    metadata: counts,
  });
  await emitDomainEvent({
    organisationId: actor.organisationId,
    actorUserId: actor.userId,
    eventType: "import.applied",
    title: `Organisation bundle imported (${counts.findings} findings)`,
    actionUrl: "/imports",
    payload: counts,
  });
  return counts;
}
