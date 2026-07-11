import { and, eq, isNull, lte, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  backgroundJobs,
  evidence,
  evidenceLegalHolds,
  organisations,
} from "@/db/schema";
import { storage, type StorageProvider } from "@/lib/storage";

export type RetentionActor = { organisationId: string; userId: string };

export async function previewRetention(
  organisationId: string,
  asOf = new Date(),
) {
  return db
    .select({
      id: evidence.id,
      filename: evidence.originalFilename,
      retentionUntil: evidence.retentionUntil,
      sizeBytes: evidence.sizeBytes,
    })
    .from(evidence)
    .where(
      and(
        eq(evidence.organisationId, organisationId),
        isNull(evidence.deletedAt),
        eq(evidence.retentionStatus, "active"),
        lte(evidence.retentionUntil, asOf),
        notExists(
          db
            .select({ id: evidenceLegalHolds.id })
            .from(evidenceLegalHolds)
            .where(
              and(
                eq(evidenceLegalHolds.evidenceId, evidence.id),
                isNull(evidenceLegalHolds.releasedAt),
              ),
            ),
        ),
      ),
    );
}

export async function placeLegalHold(
  actor: RetentionActor,
  input: { evidenceId: string; reason: string },
) {
  const [target] = await db
    .select({ id: evidence.id })
    .from(evidence)
    .where(
      and(
        eq(evidence.id, input.evidenceId),
        eq(evidence.organisationId, actor.organisationId),
        isNull(evidence.deletedAt),
      ),
    )
    .limit(1);
  if (!target) throw new Error("Evidence was not found in this organisation");
  const [hold] = await db
    .insert(evidenceLegalHolds)
    .values({
      organisationId: actor.organisationId,
      evidenceId: input.evidenceId,
      reason: input.reason.trim(),
      placedBy: actor.userId,
    })
    .returning();
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "retention.legal_hold.placed",
    targetType: "evidence",
    targetId: input.evidenceId,
    metadata: { holdId: hold.id, reason: input.reason.trim() },
  });
  return hold;
}

export async function releaseLegalHold(actor: RetentionActor, holdId: string) {
  const [hold] = await db
    .update(evidenceLegalHolds)
    .set({ releasedAt: new Date(), releasedBy: actor.userId })
    .where(
      and(
        eq(evidenceLegalHolds.id, holdId),
        eq(evidenceLegalHolds.organisationId, actor.organisationId),
        isNull(evidenceLegalHolds.releasedAt),
      ),
    )
    .returning();
  if (!hold) throw new Error("Active legal hold was not found");
  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "retention.legal_hold.released",
    targetType: "evidence",
    targetId: hold.evidenceId,
    metadata: { holdId: hold.id },
  });
  return hold;
}

export async function purgeExpiredEvidence(
  organisationId: string,
  options: {
    actorId?: string;
    confirmation?: string;
    provider?: StorageProvider;
    asOf?: Date;
    scheduled?: boolean;
  } = {},
) {
  const candidates = await previewRetention(
    organisationId,
    options.asOf ?? new Date(),
  );
  const expected = `PURGE ${candidates.length}`;
  if (!options.scheduled && options.confirmation !== expected)
    throw new Error(`Type ${expected} to confirm irreversible destruction`);
  const selectedProvider = options.provider ?? storage();
  const cutoff = (options.asOf ?? new Date()).toISOString();
  let destroyed = 0;
  for (const candidate of candidates) {
    const didDestroy = await db.transaction(async (tx) => {
      const records = await tx.execute<{ storage_key: string }>(sql`
        select e.storage_key
        from evidence e
        where e.id = ${candidate.id}
          and e.organisation_id = ${organisationId}
          and e.deleted_at is null
          and e.retention_status = 'active'
          and e.retention_until <= ${cutoff}::timestamptz
          and not exists (
            select 1 from evidence_legal_holds h
            where h.evidence_id = e.id and h.released_at is null
          )
        for update
      `);
      const record = records[0];
      if (!record) return false;
      await selectedProvider.delete(record.storage_key);
      await tx
        .update(evidence)
        .set({ retentionStatus: "destroyed", deletedAt: new Date() })
        .where(
          and(
            eq(evidence.id, candidate.id),
            eq(evidence.organisationId, organisationId),
            isNull(evidence.deletedAt),
          ),
        );
      await tx.insert(auditEvents).values({
        organisationId,
        actorId: options.actorId,
        action: "retention.evidence.destroyed",
        targetType: "evidence",
        targetId: candidate.id,
        metadata: {
          scheduled: Boolean(options.scheduled),
          filename: candidate.filename,
          sizeBytes: candidate.sizeBytes,
          retainedMetadata: true,
        },
      });
      return true;
    });
    if (didDestroy) destroyed += 1;
  }
  return { eligible: candidates.length, destroyed };
}

export async function enqueueScheduledRetention(asOf = new Date()) {
  const date = asOf.toISOString().slice(0, 10);
  const orgs = await db.select({ id: organisations.id }).from(organisations);
  for (const organisation of orgs) {
    await db
      .insert(backgroundJobs)
      .values({
        organisationId: organisation.id,
        type: "retention.process",
        payload: { organisationId: organisation.id, asOf: asOf.toISOString() },
        idempotencyKey: `retention:${organisation.id}:${date}`,
      })
      .onConflictDoNothing();
  }
  return orgs.length;
}

export async function retentionJobMetrics() {
  const rows = await db.execute<{
    status: string;
    count: number;
  }>(sql`
    select status, count(*)::int as count
    from background_jobs
    group by status
  `);
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}
