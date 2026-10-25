import "server-only";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  findings,
  remediationUpdates,
  retestAttempts,
} from "@/db/schema";
import { WorkspaceTransitionError } from "@/server/services/engagement-workspace";
import { FindingScopeError } from "@/server/services/findings";
import { emitDomainEvent } from "@/server/services/domain-events";

type RetestActor = { organisationId: string; userId: string };

/** Published findings that are still open to verification. */
const retestableStatuses = new Set([
  "published",
  "remediation_in_progress",
  "ready_for_retest",
  "retested",
  "resolved",
  "risk_accepted",
]);
const openAttemptStatuses = ["requested", "scheduled"];

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
  if (!retestableStatuses.has(finding.status))
    throw new WorkspaceTransitionError(
      `A retest cannot be requested for a ${finding.status} finding`,
    );

  const attempt = await db.transaction(async (tx) => {
    // Lock the finding so concurrent requests cannot both open an attempt.
    await tx
      .select({ id: findings.id })
      .from(findings)
      .where(eq(findings.id, finding.id))
      .for("update");
    const [openAttempt] = await tx
      .select({ id: retestAttempts.id })
      .from(retestAttempts)
      .where(
        and(
          eq(retestAttempts.organisationId, actor.organisationId),
          eq(retestAttempts.findingId, findingId),
          inArray(retestAttempts.status, openAttemptStatuses),
        ),
      )
      .limit(1);
    if (openAttempt)
      throw new WorkspaceTransitionError(
        "A retest is already open for this finding",
      );

    const [latestRemediation] = await tx
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

    const [attempt] = await tx
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

    await tx.insert(auditEvents).values({
      organisationId: actor.organisationId,
      actorId: actor.userId,
      action: "api.retest_requested",
      targetType: "retest_attempt",
      targetId: attempt!.id,
      metadata: { findingId, findingVersion: finding.version },
    });
    return attempt!;
  });

  await emitDomainEvent({
    organisationId: actor.organisationId,
    actorUserId: actor.userId,
    eventType: "retest.requested",
    title: `Retest requested for ${finding.identifier}`,
    actionUrl: `/engagements/${finding.engagementId}?view=findings`,
    engagementId: finding.engagementId,
    payload: {
      attemptId: attempt.id,
      findingId: finding.id,
      identifier: finding.identifier,
    },
  });

  return attempt;
}
