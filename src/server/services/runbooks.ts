import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  engagementRunbooks,
  engagementRunbookSteps,
  engagements,
  evidence,
  findings,
  runbookTemplates,
  runbookTemplateSteps,
  tasks,
} from "@/db/schema";

export type RunbookActor = { organisationId: string; userId: string };
export type RunbookStepStatus =
  "not_started" | "in_progress" | "completed" | "blocked" | "not_applicable";

type TemplateStepInput = {
  title: string;
  objective?: string;
  procedure: string;
  expectedEvidence?: string;
  required?: boolean;
};

export class RunbookScopeError extends Error {
  constructor(message = "Runbook is not available in the active organisation") {
    super(message);
    this.name = "RunbookScopeError";
  }
}

export class RunbookTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunbookTransitionError";
  }
}

export async function createRunbookTemplate(
  actor: RunbookActor,
  input: {
    name: string;
    description?: string;
    assessmentTypes?: string[];
    tags?: string[];
    steps: TemplateStepInput[];
  },
) {
  if (!input.steps.length)
    throw new RunbookTransitionError("A runbook requires at least one step");
  return db.transaction(async (tx) => {
    const [template] = await tx
      .insert(runbookTemplates)
      .values({
        organisationId: actor.organisationId,
        name: input.name,
        description: input.description,
        assessmentTypes: input.assessmentTypes ?? [],
        tags: input.tags ?? [],
        createdBy: actor.userId,
      })
      .returning();
    if (!template) throw new Error("Unable to create runbook template");
    await tx.insert(runbookTemplateSteps).values(
      input.steps.map((step, index) => ({
        organisationId: actor.organisationId,
        templateId: template.id,
        position: index + 1,
        title: step.title,
        objective: step.objective,
        procedure: step.procedure,
        expectedEvidence: step.expectedEvidence,
        required: step.required ?? true,
      })),
    );
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "runbook_template.created",
      targetType: "runbook_template",
      targetId: template.id,
      metadata: { name: template.name, stepCount: input.steps.length },
    });
    return template;
  });
}

export async function publishRunbookTemplate(
  actor: RunbookActor,
  templateId: string,
) {
  return db.transaction(async (tx) => {
    const [template] = await tx
      .select()
      .from(runbookTemplates)
      .where(
        and(
          eq(runbookTemplates.id, templateId),
          eq(runbookTemplates.organisationId, actor.organisationId),
          isNull(runbookTemplates.archivedAt),
        ),
      )
      .limit(1);
    if (!template) throw new RunbookScopeError();
    if (template.status !== "draft")
      throw new RunbookTransitionError("Only draft runbooks can be published");
    const [updated] = await tx
      .update(runbookTemplates)
      .set({ status: "published", updatedAt: new Date() })
      .where(eq(runbookTemplates.id, template.id))
      .returning();
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "runbook_template.published",
      targetType: "runbook_template",
      targetId: template.id,
      previousValues: { status: template.status },
      newValues: { status: "published" },
    });
    return updated;
  });
}

export async function listRunbookTemplates(
  organisationId: string,
  publishedOnly = false,
) {
  const rows = await db
    .select()
    .from(runbookTemplates)
    .where(
      and(
        eq(runbookTemplates.organisationId, organisationId),
        isNull(runbookTemplates.archivedAt),
        publishedOnly ? eq(runbookTemplates.status, "published") : undefined,
      ),
    )
    .orderBy(desc(runbookTemplates.updatedAt));
  const steps = rows.length
    ? await db
        .select()
        .from(runbookTemplateSteps)
        .where(
          and(
            eq(runbookTemplateSteps.organisationId, organisationId),
            inArray(
              runbookTemplateSteps.templateId,
              rows.map((row) => row.id),
            ),
          ),
        )
        .orderBy(asc(runbookTemplateSteps.position))
    : [];
  return rows.map((template) => ({
    ...template,
    steps: steps.filter((step) => step.templateId === template.id),
  }));
}

export async function applyRunbookTemplate(
  actor: RunbookActor,
  input: { engagementId: string; templateId: string },
) {
  return db.transaction(async (tx) => {
    const [engagement] = await tx
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
    if (!engagement) throw new RunbookScopeError("Engagement is unavailable");
    const [template] = await tx
      .select()
      .from(runbookTemplates)
      .where(
        and(
          eq(runbookTemplates.id, input.templateId),
          eq(runbookTemplates.organisationId, actor.organisationId),
          eq(runbookTemplates.status, "published"),
          isNull(runbookTemplates.archivedAt),
        ),
      )
      .limit(1);
    if (!template)
      throw new RunbookScopeError("Published runbook is unavailable");
    const templateSteps = await tx
      .select()
      .from(runbookTemplateSteps)
      .where(
        and(
          eq(runbookTemplateSteps.organisationId, actor.organisationId),
          eq(runbookTemplateSteps.templateId, template.id),
        ),
      )
      .orderBy(asc(runbookTemplateSteps.position));
    if (!templateSteps.length)
      throw new RunbookTransitionError("Published runbook has no steps");
    const [existing] = await tx
      .select({ id: engagementRunbooks.id })
      .from(engagementRunbooks)
      .where(
        and(
          eq(engagementRunbooks.organisationId, actor.organisationId),
          eq(engagementRunbooks.engagementId, engagement.id),
          eq(engagementRunbooks.templateId, template.id),
          eq(engagementRunbooks.templateVersion, template.version),
        ),
      )
      .limit(1);
    if (existing)
      throw new RunbookTransitionError(
        "This runbook version is already applied to the engagement",
      );
    const [runbook] = await tx
      .insert(engagementRunbooks)
      .values({
        organisationId: actor.organisationId,
        engagementId: engagement.id,
        templateId: template.id,
        templateName: template.name,
        templateVersion: template.version,
        createdBy: actor.userId,
      })
      .onConflictDoNothing()
      .returning();
    if (!runbook)
      throw new RunbookTransitionError(
        "This runbook version is already applied to the engagement",
      );
    await tx.insert(engagementRunbookSteps).values(
      templateSteps.map((step) => ({
        organisationId: actor.organisationId,
        engagementRunbookId: runbook.id,
        position: step.position,
        title: step.title,
        objective: step.objective,
        procedure: step.procedure,
        expectedEvidence: step.expectedEvidence,
        required: step.required,
      })),
    );
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "engagement_runbook.applied",
      targetType: "engagement_runbook",
      targetId: runbook.id,
      metadata: {
        engagementId: engagement.id,
        templateId: template.id,
        templateVersion: template.version,
      },
    });
    return runbook;
  });
}

export async function updateEngagementRunbookStep(
  actor: RunbookActor,
  input: {
    engagementId: string;
    stepId: string;
    status: RunbookStepStatus;
    notes?: string;
    findingId?: string | null;
    evidenceId?: string | null;
    taskId?: string | null;
  },
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        step: engagementRunbookSteps,
        runbook: engagementRunbooks,
      })
      .from(engagementRunbookSteps)
      .innerJoin(
        engagementRunbooks,
        eq(engagementRunbooks.id, engagementRunbookSteps.engagementRunbookId),
      )
      .where(
        and(
          eq(engagementRunbookSteps.id, input.stepId),
          eq(engagementRunbookSteps.organisationId, actor.organisationId),
          eq(engagementRunbooks.engagementId, input.engagementId),
        ),
      )
      .limit(1);
    if (!current) throw new RunbookScopeError("Runbook step is unavailable");
    await validateLink(
      tx,
      findings,
      findings.id,
      findings.deletedAt,
      input.findingId,
      actor.organisationId,
      input.engagementId,
    );
    await validateLink(
      tx,
      evidence,
      evidence.id,
      evidence.deletedAt,
      input.evidenceId,
      actor.organisationId,
      input.engagementId,
    );
    await validateLink(
      tx,
      tasks,
      tasks.id,
      undefined,
      input.taskId,
      actor.organisationId,
      input.engagementId,
    );
    const completed = ["completed", "not_applicable"].includes(input.status);
    const now = new Date();
    const [updated] = await tx
      .update(engagementRunbookSteps)
      .set({
        status: input.status,
        notes: input.notes,
        findingId: input.findingId ?? null,
        evidenceId: input.evidenceId ?? null,
        taskId: input.taskId ?? null,
        completedBy: completed ? actor.userId : null,
        completedAt: completed ? now : null,
        updatedAt: now,
      })
      .where(eq(engagementRunbookSteps.id, current.step.id))
      .returning();
    const steps = await tx
      .select({
        status: engagementRunbookSteps.status,
        required: engagementRunbookSteps.required,
      })
      .from(engagementRunbookSteps)
      .where(
        eq(engagementRunbookSteps.engagementRunbookId, current.runbook.id),
      );
    const required = steps.filter((step) => step.required);
    const completionSet = required.length ? required : steps;
    const allComplete = completionSet.every((step) =>
      ["completed", "not_applicable"].includes(step.status),
    );
    const blocked = steps.some((step) => step.status === "blocked");
    const started = steps.some((step) => step.status !== "not_started");
    const status = allComplete
      ? "complete"
      : blocked
        ? "blocked"
        : started
          ? "in_progress"
          : "not_started";
    await tx
      .update(engagementRunbooks)
      .set({
        status,
        startedAt: started
          ? (current.runbook.startedAt ?? now)
          : current.runbook.startedAt,
        completedAt: status === "complete" ? now : null,
      })
      .where(eq(engagementRunbooks.id, current.runbook.id));
    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "engagement_runbook_step.updated",
      targetType: "engagement_runbook_step",
      targetId: current.step.id,
      previousValues: { status: current.step.status },
      newValues: { status: input.status },
      metadata: {
        engagementId: input.engagementId,
        engagementRunbookId: current.runbook.id,
        linkedFinding: Boolean(input.findingId),
        linkedEvidence: Boolean(input.evidenceId),
        linkedTask: Boolean(input.taskId),
      },
    });
    return updated;
  });
}

export async function listEngagementRunbooks(
  organisationId: string,
  engagementId: string,
) {
  const rows = await db
    .select()
    .from(engagementRunbooks)
    .where(
      and(
        eq(engagementRunbooks.organisationId, organisationId),
        eq(engagementRunbooks.engagementId, engagementId),
      ),
    )
    .orderBy(desc(engagementRunbooks.createdAt));
  const steps = rows.length
    ? await db
        .select()
        .from(engagementRunbookSteps)
        .where(
          and(
            eq(engagementRunbookSteps.organisationId, organisationId),
            inArray(
              engagementRunbookSteps.engagementRunbookId,
              rows.map((row) => row.id),
            ),
          ),
        )
        .orderBy(asc(engagementRunbookSteps.position))
    : [];
  return rows.map((runbook) => ({
    ...runbook,
    steps: steps.filter((step) => step.engagementRunbookId === runbook.id),
  }));
}

export async function getRunbookLinkOptions(
  organisationId: string,
  engagementId: string,
) {
  const [findingRows, evidenceRows, taskRows] = await Promise.all([
    db
      .select({
        id: findings.id,
        label: findings.identifier,
        title: findings.title,
      })
      .from(findings)
      .where(
        and(
          eq(findings.organisationId, organisationId),
          eq(findings.engagementId, engagementId),
          isNull(findings.deletedAt),
        ),
      )
      .orderBy(asc(findings.identifier)),
    db
      .select({ id: evidence.id, label: evidence.originalFilename })
      .from(evidence)
      .where(
        and(
          eq(evidence.organisationId, organisationId),
          eq(evidence.engagementId, engagementId),
          isNull(evidence.deletedAt),
        ),
      )
      .orderBy(asc(evidence.originalFilename)),
    db
      .select({ id: tasks.id, label: tasks.title })
      .from(tasks)
      .where(
        and(
          eq(tasks.organisationId, organisationId),
          eq(tasks.engagementId, engagementId),
        ),
      )
      .orderBy(asc(tasks.title)),
  ]);
  return { findings: findingRows, evidence: evidenceRows, tasks: taskRows };
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function validateLink(
  tx: Transaction,
  table: typeof findings | typeof evidence | typeof tasks,
  idColumn: typeof findings.id | typeof evidence.id | typeof tasks.id,
  deletedAtColumn:
    typeof findings.deletedAt | typeof evidence.deletedAt | undefined,
  recordId: string | null | undefined,
  organisationId: string,
  engagementId: string,
) {
  if (!recordId) return;
  const [record] = await tx
    .select({ id: idColumn })
    .from(table)
    .where(
      and(
        eq(idColumn, recordId),
        eq(table.organisationId, organisationId),
        eq(table.engagementId, engagementId),
        deletedAtColumn ? isNull(deletedAtColumn) : undefined,
      ),
    )
    .limit(1);
  if (!record) throw new RunbookScopeError("Linked record is unavailable");
}
