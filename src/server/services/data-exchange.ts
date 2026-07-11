import "server-only";

import { createHash } from "node:crypto";
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
import { uploadEvidence } from "./evidence";

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
  return db.transaction(async (tx) => {
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
      const [finding] = await tx
        .insert(findings)
        .values({
          organisationId: actor.organisationId,
          engagementId: run.engagementId,
          identifier: `IMP-${row.fingerprint.slice(0, 10).toUpperCase()}`,
          title: item.title,
          status: "draft",
          severity: item.severity,
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
    return applied;
  });
}

export async function getImportPreview(
  actor: Pick<ExchangeActor, "organisationId">,
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
