import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  findings,
  remediationUpdates,
  retestAttempts,
} from "@/db/schema";
import { FindingScopeError } from "@/server/services/findings";
import { emitDomainEvent } from "@/server/services/domain-events";

type RetestActor = { organisationId: string; userId: string };

/** Internal/API retest request — same insert path as portal, without portal visibility gates. */
export async function requestRetestForApi(
  actor: RetestActor,
  findingId: string,
  note?: string,
) {
  const [finding] = await db
    .select()
    .from(findings)
    .where(
      and(
        eq(findings.id, findingId),
        eq(findings.organisationId, actor.organisationId),
        isNull(findings.deletedAt),
      ),
    )
    .limit(1);
  if (!finding) throw new FindingScopeError("Finding was not found");

  const [latestRemediation] = await db
    .select()
    .from(remediationUpdates)
    .where(
      and(
        eq(remediationUpdates.organisationId, actor.organisationId),
        eq(remediationUpdates.findingId, findingId),
      ),
    )
    .orderBy(desc(remediationUpdates.createdAt))
    .limit(1);

  const [attempt] = await db
    .insert(retestAttempts)
    .values({
      organisationId: actor.organisationId,
      findingId,
      requestedBy: actor.userId,
      status: "requested",
      notes: note?.trim() || null,
      originalFindingVersion: finding.version,
      originalSnapshot: { ...finding },
      remediationSnapshot: latestRemediation ? { ...latestRemediation } : {},
    })
    .returning();

  await db.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action: "api.retest_requested",
    targetType: "retest_attempt",
    targetId: attempt!.id,
    metadata: { findingId, findingVersion: finding.version },
  });

  await emitDomainEvent({
    organisationId: actor.organisationId,
    actorUserId: actor.userId,
    eventType: "retest.requested",
    title: `Retest requested for ${finding.identifier}`,
    actionUrl: `/engagements/${finding.engagementId}?view=findings`,
    payload: {
      attemptId: attempt!.id,
      findingId: finding.id,
      identifier: finding.identifier,
    },
  });

  return attempt;
}
