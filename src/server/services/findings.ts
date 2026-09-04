import { visibleToAuthor } from "@/lib/permissions/visibility";
import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  auditEvents,
  comments,
  engagements,
  evidence,
  evidenceFindings,
  findingAssets,
  findingTemplates,
  findingTransitions as findingTransitionRows,
  findingVersions,
  findings,
  riskMatrices,
  type FrameworkMapping,
  type RiskMatrixDefinition,
} from "@/db/schema";
import {
  assertFindingTransition,
  type FindingStatus,
} from "@/features/findings/workflow";

export type FindingActor = { organisationId: string; userId: string };
export type FindingNarrativeInput = {
  title: string;
  severity: "informational" | "low" | "medium" | "high" | "critical";
  likelihood?: string;
  impact?: string;
  cvssVector?: string;
  cvssScore?: string;
  executiveSummary?: string;
  technicalDetail?: string;
  reproductionSteps?: string;
  proofOfConcept?: string;
  businessImpact?: string;
  technicalImpact?: string;
  remediation?: string;
  verificationGuidance?: string;
  references?: string[];
  mappings?: FrameworkMapping[];
  clientOwner?: string;
  dueAt?: Date;
};
export type FindingTemplateInput = {
  stableKey?: string;
  title: string;
  summary: string;
  executiveDescription?: string;
  technicalDescription: string;
  businessImpact?: string;
  technicalImpact?: string;
  likelihood?: string;
  severity: "informational" | "low" | "medium" | "high" | "critical";
  riskRationale?: string;
  remediation: string;
  verificationSteps?: string;
  references?: string[];
  tags?: string[];
  assessmentTypes?: string[];
  mappings?: FrameworkMapping[];
};

const versionedFields = [
  "title",
  "summary",
  "executiveDescription",
  "technicalDescription",
  "businessImpact",
  "technicalImpact",
  "likelihood",
  "severity",
  "riskRationale",
  "remediation",
  "verificationSteps",
  "references",
  "tags",
  "assessmentTypes",
  "mappings",
] as const;

export class FindingScopeError extends Error {
  constructor(
    message = "Finding record is not available in the active organisation",
  ) {
    super(message);
    this.name = "FindingScopeError";
  }
}

export async function createFindingTemplate(
  actor: FindingActor,
  input: FindingTemplateInput,
) {
  const stableKey = input.stableKey?.trim() || slug(input.title);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: findingTemplates.id })
      .from(findingTemplates)
      .where(
        and(
          eq(findingTemplates.organisationId, actor.organisationId),
          eq(findingTemplates.stableKey, stableKey),
        ),
      )
      .limit(1);
    if (existing)
      throw new Error("A template with this stable key already exists");
    const [template] = await tx
      .insert(findingTemplates)
      .values({
        organisationId: actor.organisationId,
        stableKey,
        version: 1,
        ...normaliseTemplate(input),
        authorId: actor.userId,
        reviewStatus: "draft",
      })
      .returning();
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "finding_template.created",
      targetType: "finding_template",
      targetId: template?.id,
      metadata: { stableKey, version: 1 },
    });
    return template;
  });
}

export async function reviseFindingTemplate(
  actor: FindingActor,
  templateId: string,
  changes: Partial<FindingTemplateInput>,
) {
  return db.transaction(async (tx) => {
    const template = await requireTemplate(
      tx,
      actor.organisationId,
      templateId,
    );
    const [latest] = await tx
      .select()
      .from(findingTemplates)
      .where(
        and(
          eq(findingTemplates.organisationId, actor.organisationId),
          eq(findingTemplates.stableKey, template.stableKey),
        ),
      )
      .orderBy(desc(findingTemplates.version))
      .limit(1);
    if (!latest || latest.id !== template.id)
      throw new Error("Only the latest template version can be revised");
    const merged = normaliseTemplate({
      ...templateInputFromRow(template),
      ...changes,
    });
    const [revision] = await tx
      .insert(findingTemplates)
      .values({
        organisationId: actor.organisationId,
        stableKey: template.stableKey,
        version: template.version + 1,
        ...merged,
        authorId: actor.userId,
        reviewStatus: "draft",
      })
      .returning();
    await tx
      .update(findingTemplates)
      .set({ supersededAt: new Date() })
      .where(eq(findingTemplates.id, template.id));
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "finding_template.revised",
      targetType: "finding_template",
      targetId: revision?.id,
      metadata: {
        stableKey: template.stableKey,
        previousVersion: template.version,
        version: revision?.version,
      },
    });
    return revision;
  });
}

export async function transitionTemplateReview(
  actor: FindingActor,
  input: {
    templateId: string;
    toStatus: "in_review" | "changes_requested" | "approved";
    reason?: string;
  },
) {
  const allowed: Record<string, readonly string[]> = {
    draft: ["in_review"],
    in_review: ["changes_requested", "approved"],
    changes_requested: ["in_review"],
    approved: [],
  };
  return db.transaction(async (tx) => {
    const template = await requireTemplate(
      tx,
      actor.organisationId,
      input.templateId,
    );
    if (!allowed[template.reviewStatus]?.includes(input.toStatus)) {
      throw new Error(
        `Template cannot transition from ${template.reviewStatus} to ${input.toStatus}`,
      );
    }
    if (input.toStatus === "changes_requested" && !input.reason?.trim())
      throw new Error("Requested changes require a reason");
    const [updated] = await tx
      .update(findingTemplates)
      .set({ reviewStatus: input.toStatus })
      .where(
        and(
          eq(findingTemplates.id, template.id),
          eq(findingTemplates.reviewStatus, template.reviewStatus),
        ),
      )
      .returning();
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "finding_template.review_transition",
      targetType: "finding_template",
      targetId: template.id,
      previousValues: { reviewStatus: template.reviewStatus },
      newValues: { reviewStatus: input.toStatus },
      metadata: { reason: input.reason ?? null, version: template.version },
    });
    return updated;
  });
}

export async function searchFindingTemplates(
  organisationId: string,
  query = "",
  approvedOnly = false,
) {
  const search = query.trim();
  return db
    .select()
    .from(findingTemplates)
    .where(
      and(
        eq(findingTemplates.organisationId, organisationId),
        approvedOnly
          ? eq(findingTemplates.reviewStatus, "approved")
          : undefined,
        search
          ? or(
              ilike(findingTemplates.title, `%${search}%`),
              ilike(findingTemplates.summary, `%${search}%`),
              ilike(findingTemplates.stableKey, `%${search}%`),
              sql`${findingTemplates.tags}::text ilike ${`%${search}%`}`,
              sql`${findingTemplates.mappings}::text ilike ${`%${search}%`}`,
            )
          : undefined,
      ),
    )
    .orderBy(asc(findingTemplates.title), desc(findingTemplates.version))
    .limit(200);
}

export async function createFindingFromTemplate(
  actor: FindingActor,
  input: {
    engagementId: string;
    templateId: string;
    identifier: string;
    assetIds?: string[];
  },
) {
  return db.transaction(async (tx) => {
    await requireEngagement(tx, actor.organisationId, input.engagementId);
    const template = await requireTemplate(
      tx,
      actor.organisationId,
      input.templateId,
    );
    if (template.reviewStatus !== "approved")
      throw new Error("Only approved templates can create findings");
    const snapshot = templateSnapshot(template);
    const [finding] = await tx
      .insert(findings)
      .values({
        organisationId: actor.organisationId,
        engagementId: input.engagementId,
        templateId: template.id,
        templateVersion: template.version,
        templateSnapshot: snapshot,
        identifier: input.identifier,
        title: template.title,
        severity: template.severity,
        likelihood: template.likelihood,
        executiveSummary: template.executiveDescription ?? template.summary,
        technicalDetail: template.technicalDescription,
        businessImpact: template.businessImpact,
        technicalImpact: template.technicalImpact,
        remediation: template.remediation,
        verificationGuidance: template.verificationSteps,
        references: template.references,
        mappings: template.mappings,
        authorId: actor.userId,
      })
      .returning();
    if (!finding) throw new Error("Unable to create finding");
    const linkedAssets = await requireAssets(
      tx,
      actor.organisationId,
      input.engagementId,
      input.assetIds ?? [],
    );
    if (linkedAssets.length) {
      await tx.insert(findingAssets).values(
        linkedAssets.map(({ id }) => ({
          organisationId: actor.organisationId,
          findingId: finding.id,
          assetId: id,
        })),
      );
    }
    await tx.insert(findingVersions).values({
      organisationId: actor.organisationId,
      findingId: finding.id,
      version: 1,
      snapshot: findingSnapshot(finding),
      changedBy: actor.userId,
      changeSummary: `Created from template ${template.stableKey} v${template.version}`,
    });
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "finding.created_from_template",
      targetType: "finding",
      targetId: finding.id,
      metadata: {
        engagementId: input.engagementId,
        templateId: template.id,
        templateVersion: template.version,
      },
    });
    return finding;
  });
}

export async function createFindingDraft(
  actor: FindingActor,
  input: FindingNarrativeInput & {
    engagementId: string;
    identifier: string;
    assetIds?: string[];
    sourceProvenance?: Record<string, unknown>;
  },
) {
  const cvssScore = validateFindingNarrative(input);
  return db.transaction(async (tx) => {
    await requireEngagement(tx, actor.organisationId, input.engagementId);
    const [finding] = await tx
      .insert(findings)
      .values({
        organisationId: actor.organisationId,
        engagementId: input.engagementId,
        identifier: input.identifier.trim(),
        title: input.title.trim(),
        severity: input.severity,
        likelihood: input.likelihood?.trim(),
        impact: input.impact?.trim(),
        cvssVector: input.cvssVector?.trim(),
        cvssScore: cvssScore?.toFixed(1),
        executiveSummary: input.executiveSummary?.trim(),
        technicalDetail: input.technicalDetail?.trim(),
        reproductionSteps: input.reproductionSteps?.trim(),
        proofOfConcept: input.proofOfConcept?.trim(),
        businessImpact: input.businessImpact?.trim(),
        technicalImpact: input.technicalImpact?.trim(),
        remediation: input.remediation?.trim(),
        verificationGuidance: input.verificationGuidance?.trim(),
        references: input.references ?? [],
        mappings: input.mappings ?? [],
        clientOwner: input.clientOwner?.trim(),
        dueAt: input.dueAt,
        authorId: actor.userId,
        sourceProvenance: input.sourceProvenance ?? {},
      })
      .returning();
    if (!finding) throw new Error("Unable to create finding");
    const linkedAssets = await requireAssets(
      tx,
      actor.organisationId,
      input.engagementId,
      input.assetIds ?? [],
    );
    if (linkedAssets.length) {
      await tx.insert(findingAssets).values(
        linkedAssets.map(({ id }) => ({
          organisationId: actor.organisationId,
          findingId: finding.id,
          assetId: id,
        })),
      );
    }
    await tx.insert(findingVersions).values({
      organisationId: actor.organisationId,
      findingId: finding.id,
      version: finding.version,
      snapshot: findingSnapshot(finding),
      changedBy: actor.userId,
      changeSummary: "Created as a draft",
    });
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "finding.created",
      targetType: "finding",
      targetId: finding.id,
      metadata: {
        engagementId: input.engagementId,
        sourceProvenance: input.sourceProvenance ?? {},
      },
    });
    return finding;
  });
}

export async function compareFindingTemplate(
  actor: Pick<FindingActor, "organisationId">,
  findingId: string,
) {
  const finding = await requireFinding(db, actor.organisationId, findingId);
  if (!finding.templateId || !finding.templateVersion) return null;
  const source = await requireTemplate(
    db,
    actor.organisationId,
    finding.templateId,
  );
  const [latest] = await db
    .select()
    .from(findingTemplates)
    .where(
      and(
        eq(findingTemplates.organisationId, actor.organisationId),
        eq(findingTemplates.stableKey, source.stableKey),
        gt(findingTemplates.version, finding.templateVersion),
        eq(findingTemplates.reviewStatus, "approved"),
      ),
    )
    .orderBy(desc(findingTemplates.version))
    .limit(1);
  if (!latest) return null;
  const previous = finding.templateSnapshot;
  const next = templateSnapshot(latest);
  const changes = versionedFields.flatMap((field) => {
    const before = previous[field];
    const after = next[field];
    return JSON.stringify(before) === JSON.stringify(after)
      ? []
      : [{ field, before, after }];
  });
  return { latest, changes };
}

export async function updateFindingFromLatestTemplate(
  actor: FindingActor,
  findingId: string,
) {
  return db.transaction(async (tx) => {
    const finding = await requireFinding(tx, actor.organisationId, findingId);
    if (!["draft", "in_progress", "changes_requested"].includes(finding.status))
      throw new Error(
        "Finding cannot update its template in the current state",
      );
    const comparison = await compareFindingTemplate(actor, findingId);
    if (!comparison) throw new Error("No newer approved template is available");
    await snapshotCurrentFinding(tx, actor, finding, "Before template update");
    const template = comparison.latest;
    const [updated] = await tx
      .update(findings)
      .set({
        templateId: template.id,
        templateVersion: template.version,
        templateSnapshot: templateSnapshot(template),
        title: template.title,
        severity: template.severity,
        likelihood: template.likelihood,
        executiveSummary: template.executiveDescription ?? template.summary,
        technicalDetail: template.technicalDescription,
        businessImpact: template.businessImpact,
        technicalImpact: template.technicalImpact,
        remediation: template.remediation,
        verificationGuidance: template.verificationSteps,
        references: template.references,
        mappings: template.mappings,
        version: finding.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(findings.id, finding.id),
          eq(findings.version, finding.version),
          eq(findings.status, finding.status),
        ),
      )
      .returning();
    if (!updated)
      throw new Error("Finding state changed; reload and try again");
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "finding.template_updated",
      targetType: "finding",
      targetId: finding.id,
      metadata: {
        previousTemplateVersion: finding.templateVersion,
        templateVersion: template.version,
        changedFields: comparison.changes.map((change) => change.field),
      },
    });
    return updated;
  });
}

export async function updateFindingNarrative(
  actor: FindingActor,
  input: FindingNarrativeInput & {
    findingId: string;
    changeSummary: string;
  },
) {
  const cvssScore = validateFindingNarrative(input);
  return db.transaction(async (tx) => {
    const finding = await requireFinding(
      tx,
      actor.organisationId,
      input.findingId,
    );
    if (!["draft", "in_progress", "changes_requested"].includes(finding.status))
      throw new Error(
        "Finding content can only change during authoring or requested changes",
      );
    await snapshotCurrentFinding(tx, actor, finding, input.changeSummary);
    const [updated] = await tx
      .update(findings)
      .set({
        title: input.title,
        severity: input.severity,
        likelihood: input.likelihood,
        impact: input.impact,
        cvssVector: input.cvssVector,
        cvssScore: cvssScore?.toFixed(1),
        executiveSummary: input.executiveSummary,
        technicalDetail: input.technicalDetail,
        reproductionSteps: input.reproductionSteps,
        proofOfConcept: input.proofOfConcept,
        businessImpact: input.businessImpact,
        technicalImpact: input.technicalImpact,
        remediation: input.remediation,
        verificationGuidance: input.verificationGuidance,
        references: input.references ?? [],
        mappings: input.mappings ?? [],
        clientOwner: input.clientOwner,
        dueAt: input.dueAt,
        version: finding.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(findings.id, finding.id),
          eq(findings.version, finding.version),
          eq(findings.status, finding.status),
        ),
      )
      .returning();
    if (!updated)
      throw new Error("Finding state changed; reload and try again");
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "finding.updated",
      targetType: "finding",
      targetId: finding.id,
      metadata: {
        version: finding.version + 1,
        changeSummary: input.changeSummary,
      },
    });
    return updated;
  });
}

export async function patchFindingNarrative(
  actor: FindingActor,
  input: Partial<FindingNarrativeInput> & {
    findingId: string;
    changeSummary: string;
  },
) {
  const current = await requireFinding(
    db,
    actor.organisationId,
    input.findingId,
  );
  return updateFindingNarrative(actor, {
    findingId: input.findingId,
    title: input.title ?? current.title,
    severity: input.severity ?? current.severity,
    likelihood: input.likelihood ?? current.likelihood ?? undefined,
    impact: input.impact ?? current.impact ?? undefined,
    cvssVector: input.cvssVector ?? current.cvssVector ?? undefined,
    cvssScore: input.cvssScore ?? current.cvssScore ?? undefined,
    executiveSummary:
      input.executiveSummary ?? current.executiveSummary ?? undefined,
    technicalDetail:
      input.technicalDetail ?? current.technicalDetail ?? undefined,
    reproductionSteps:
      input.reproductionSteps ?? current.reproductionSteps ?? undefined,
    proofOfConcept: input.proofOfConcept ?? current.proofOfConcept ?? undefined,
    businessImpact: input.businessImpact ?? current.businessImpact ?? undefined,
    technicalImpact:
      input.technicalImpact ?? current.technicalImpact ?? undefined,
    remediation: input.remediation ?? current.remediation ?? undefined,
    verificationGuidance:
      input.verificationGuidance ?? current.verificationGuidance ?? undefined,
    references: input.references ?? current.references,
    mappings: input.mappings ?? current.mappings,
    clientOwner: input.clientOwner ?? current.clientOwner ?? undefined,
    dueAt: input.dueAt ?? current.dueAt ?? undefined,
    changeSummary: input.changeSummary,
  });
}

export async function transitionFinding(
  actor: FindingActor,
  input: {
    findingId: string;
    toStatus: FindingStatus;
    comment?: string;
    canOverride?: boolean;
    overrideReason?: string;
  },
) {
  return db.transaction(async (tx) => {
    const finding = await requireFinding(
      tx,
      actor.organisationId,
      input.findingId,
    );
    const workflowDecision = assertFindingTransition({
      from: finding.status,
      to: input.toStatus,
      canOverride: input.canOverride ?? false,
      overrideReason: input.overrideReason,
    });
    if (input.toStatus === "peer_reviewed" && finding.authorId === actor.userId)
      throw new Error("A finding author cannot complete peer review");
    if (input.toStatus === "qa_approved" && finding.reviewerId === actor.userId)
      throw new Error("QA approval requires a different reviewer");
    const approvalVersionMismatch =
      input.toStatus === "published" &&
      finding.approvedVersion !== finding.version;
    if (approvalVersionMismatch && !input.canOverride)
      throw new Error(
        "Publication requires QA approval of the current finding version",
      );
    if (approvalVersionMismatch && !input.overrideReason?.trim())
      throw new Error(
        "A publication approval-version override requires a reason",
      );
    const override = workflowDecision.override || approvalVersionMismatch;
    if (input.toStatus === "changes_requested" && !input.comment?.trim())
      throw new Error("Changes requested requires a comment");
    const [updated] = await tx
      .update(findings)
      .set({
        status: input.toStatus,
        reviewerId: ["peer_reviewed", "qa_approved"].includes(input.toStatus)
          ? actor.userId
          : finding.reviewerId,
        approvedVersion:
          input.toStatus === "qa_approved"
            ? finding.version
            : finding.approvedVersion,
        publishedAt:
          input.toStatus === "published" ? new Date() : finding.publishedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(findings.id, finding.id),
          eq(findings.status, finding.status),
          eq(findings.version, finding.version),
        ),
      )
      .returning();
    if (!updated)
      throw new Error("Finding state changed; reload and try again");
    await tx.insert(findingTransitionRows).values({
      organisationId: actor.organisationId,
      findingId: finding.id,
      fromStatus: finding.status,
      toStatus: input.toStatus,
      actorId: actor.userId,
      comment: input.comment,
      findingVersion: finding.version,
      overrideReason: override ? input.overrideReason : undefined,
    });
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: override
        ? "finding.transition.overridden"
        : "finding.transitioned",
      targetType: "finding",
      targetId: finding.id,
      previousValues: { status: finding.status },
      newValues: { status: input.toStatus },
      metadata: {
        findingVersion: finding.version,
        comment: input.comment ?? null,
        overrideReason: override ? input.overrideReason : null,
        approvalVersionMismatch,
      },
    });
    return updated;
  });
}

export async function addFindingComment(
  actor: FindingActor,
  input: {
    findingId: string;
    body: string;
    visibility: "private" | "team" | "client";
  },
) {
  const finding = await requireFinding(
    db,
    actor.organisationId,
    input.findingId,
  );
  const [comment] = await db
    .insert(comments)
    .values({
      organisationId: actor.organisationId,
      targetType: "finding",
      targetId: finding.id,
      body: input.body,
      visibility: input.visibility,
      authorId: actor.userId,
    })
    .returning();
  return comment;
}

export async function linkFindingEvidence(
  actor: FindingActor,
  input: { findingId: string; evidenceIds: string[] },
) {
  return db.transaction(async (tx) => {
    const finding = await requireFinding(
      tx,
      actor.organisationId,
      input.findingId,
    );
    const ids = [...new Set(input.evidenceIds)];
    const rows = ids.length
      ? await tx
          .select({ id: evidence.id })
          .from(evidence)
          .where(
            and(
              eq(evidence.organisationId, actor.organisationId),
              eq(evidence.engagementId, finding.engagementId),
              inArray(evidence.id, ids),
              isNull(evidence.deletedAt),
            ),
          )
      : [];
    if (rows.length !== ids.length) throw new FindingScopeError();
    if (rows.length) {
      await tx
        .insert(evidenceFindings)
        .values(
          rows.map((row) => ({
            organisationId: actor.organisationId,
            evidenceId: row.id,
            findingId: finding.id,
          })),
        )
        .onConflictDoNothing();
    }
    return rows;
  });
}

export async function createRiskMatrix(
  actor: FindingActor,
  input: {
    clientId?: string;
    name: string;
    definition: RiskMatrixDefinition;
    isDefault?: boolean;
  },
) {
  validateRiskMatrix(input.definition);
  if (input.clientId) {
    const clients = await db.query.clients.findMany({
      columns: { id: true },
      where: (client, { and: all, eq: equal, isNull: empty }) =>
        all(
          equal(client.id, input.clientId!),
          equal(client.organisationId, actor.organisationId),
          empty(client.deletedAt),
        ),
    });
    if (!clients.length) throw new FindingScopeError("Client is unavailable");
  }
  const [latest] = await db
    .select({ version: riskMatrices.version })
    .from(riskMatrices)
    .where(
      and(
        eq(riskMatrices.organisationId, actor.organisationId),
        eq(riskMatrices.name, input.name),
      ),
    )
    .orderBy(desc(riskMatrices.version))
    .limit(1);
  const [matrix] = await db
    .insert(riskMatrices)
    .values({
      organisationId: actor.organisationId,
      clientId: input.clientId,
      name: input.name,
      definition: input.definition,
      isDefault: input.isDefault ?? false,
      version: (latest?.version ?? 0) + 1,
      createdBy: actor.userId,
    })
    .returning();
  return matrix;
}

export async function getEngagementFindings(
  organisationId: string,
  engagementId: string,
  userId?: string,
) {
  const rows = await db
    .select()
    .from(findings)
    .where(
      and(
        eq(findings.organisationId, organisationId),
        eq(findings.engagementId, engagementId),
        isNull(findings.deletedAt),
      ),
    )
    .orderBy(desc(findings.createdAt));
  const ids = rows.map((finding) => finding.id);
  const [assetLinks, evidenceLinks, commentRows] = await Promise.all([
    ids.length
      ? db
          .select()
          .from(findingAssets)
          .where(inArray(findingAssets.findingId, ids))
      : [],
    ids.length
      ? db
          .select()
          .from(evidenceFindings)
          .where(inArray(evidenceFindings.findingId, ids))
      : [],
    ids.length
      ? db
          .select()
          .from(comments)
          .where(
            and(
              eq(comments.organisationId, organisationId),
              eq(comments.targetType, "finding"),
              inArray(comments.targetId, ids),
              isNull(comments.deletedAt),
              visibleToAuthor(comments.visibility, comments.authorId, userId),
            ),
          )
          .orderBy(asc(comments.createdAt))
      : [],
  ]);
  return rows.map((finding) => ({
    ...finding,
    assetIds: assetLinks
      .filter((link) => link.findingId === finding.id)
      .map((link) => link.assetId),
    evidenceIds: evidenceLinks
      .filter((link) => link.findingId === finding.id)
      .map((link) => link.evidenceId),
    comments: commentRows.filter((comment) => comment.targetId === finding.id),
  }));
}

export async function assertFindingEngagement(
  organisationId: string,
  engagementId: string,
  findingId: string,
) {
  const finding = await requireFinding(db, organisationId, findingId);
  if (finding.engagementId !== engagementId) throw new FindingScopeError();
  return finding;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Queryable = typeof db | Transaction;

async function requireTemplate(
  query: Queryable,
  organisationId: string,
  templateId: string,
) {
  const [template] = await query
    .select()
    .from(findingTemplates)
    .where(
      and(
        eq(findingTemplates.id, templateId),
        eq(findingTemplates.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!template) throw new FindingScopeError();
  return template;
}

async function requireFinding(
  query: Queryable,
  organisationId: string,
  findingId: string,
) {
  const [finding] = await query
    .select()
    .from(findings)
    .where(
      and(
        eq(findings.id, findingId),
        eq(findings.organisationId, organisationId),
        isNull(findings.deletedAt),
      ),
    )
    .limit(1);
  if (!finding) throw new FindingScopeError();
  return finding;
}

async function requireEngagement(
  query: Queryable,
  organisationId: string,
  engagementId: string,
) {
  const [engagement] = await query
    .select({ id: engagements.id })
    .from(engagements)
    .where(
      and(
        eq(engagements.id, engagementId),
        eq(engagements.organisationId, organisationId),
        isNull(engagements.deletedAt),
      ),
    )
    .limit(1);
  if (!engagement) throw new FindingScopeError();
  return engagement;
}

async function requireAssets(
  tx: Transaction,
  organisationId: string,
  engagementId: string,
  assetIds: string[],
) {
  const ids = [...new Set(assetIds)];
  if (!ids.length) return [];
  const rows = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.organisationId, organisationId),
        eq(assets.engagementId, engagementId),
        inArray(assets.id, ids),
        isNull(assets.deletedAt),
      ),
    );
  if (rows.length !== ids.length) throw new FindingScopeError();
  return rows;
}

async function snapshotCurrentFinding(
  tx: Transaction,
  actor: FindingActor,
  finding: typeof findings.$inferSelect,
  changeSummary: string,
) {
  await tx
    .insert(findingVersions)
    .values({
      organisationId: actor.organisationId,
      findingId: finding.id,
      version: finding.version,
      snapshot: findingSnapshot(finding),
      changedBy: actor.userId,
      changeSummary,
    })
    .onConflictDoNothing();
}

function normaliseTemplate(input: FindingTemplateInput) {
  return {
    title: input.title.trim(),
    summary: input.summary.trim(),
    executiveDescription: input.executiveDescription?.trim(),
    technicalDescription: input.technicalDescription.trim(),
    businessImpact: input.businessImpact?.trim(),
    technicalImpact: input.technicalImpact?.trim(),
    likelihood: input.likelihood?.trim(),
    severity: input.severity,
    riskRationale: input.riskRationale?.trim(),
    remediation: input.remediation.trim(),
    verificationSteps: input.verificationSteps?.trim(),
    references: input.references ?? [],
    tags: input.tags ?? [],
    assessmentTypes: input.assessmentTypes ?? [],
    mappings: input.mappings ?? [],
  };
}

function validateFindingNarrative(input: {
  cvssVector?: string;
  cvssScore?: string;
}) {
  if (input.cvssVector && !input.cvssVector.startsWith("CVSS:4.0/"))
    throw new Error("CVSS vector must use CVSS v4.0");
  const cvssScore = input.cvssScore ? Number(input.cvssScore) : undefined;
  if (
    cvssScore !== undefined &&
    (!Number.isFinite(cvssScore) || cvssScore < 0 || cvssScore > 10)
  )
    throw new Error("CVSS score must be between 0 and 10");
  return cvssScore;
}

function templateInputFromRow(
  row: typeof findingTemplates.$inferSelect,
): FindingTemplateInput {
  return {
    stableKey: row.stableKey,
    ...Object.fromEntries(versionedFields.map((field) => [field, row[field]])),
  } as FindingTemplateInput;
}

function templateSnapshot(row: typeof findingTemplates.$inferSelect) {
  return Object.fromEntries(
    versionedFields.map((field) => [field, row[field]]),
  );
}

function findingSnapshot(row: typeof findings.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validateRiskMatrix(definition: RiskMatrixDefinition) {
  if (!definition.likelihood.length || !definition.impact.length)
    throw new Error("Risk matrix requires likelihood and impact axes");
  const likelihood = new Set(definition.likelihood.map((item) => item.key));
  const impact = new Set(definition.impact.map((item) => item.key));
  for (const item of [...definition.likelihood, ...definition.impact]) {
    if (!item.key.trim() || !item.label.trim())
      throw new Error("Risk matrix entries require accessible text labels");
  }
  for (const rating of definition.ratings) {
    if (!likelihood.has(rating.likelihood) || !impact.has(rating.impact))
      throw new Error("Risk matrix rating references an unknown axis value");
    if (!rating.label.trim() || !/^#[0-9a-f]{6}$/i.test(rating.colour))
      throw new Error("Risk ratings require a text label and six-digit colour");
  }
}

function slug(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}
