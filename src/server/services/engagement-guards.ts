import "server-only";

/** Engagement statuses that end the engagement and freeze its content. */
export const readOnlyEngagementStatuses = ["archived", "cancelled"] as const;

/**
 * A workflow rule blocked the change (API: 409). Defined here so the guard
 * below can extend it without an import cycle; engagement-workspace re-exports
 * it under its historical path.
 */
export class WorkspaceTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceTransitionError";
  }
}

export class EngagementReadOnlyError extends WorkspaceTransitionError {
  constructor(
    message = "The engagement is archived or cancelled and is read-only",
  ) {
    super(message);
    this.name = "EngagementReadOnlyError";
  }
}

export function isEngagementWritable(engagement: {
  status: string;
  archivedAt: Date | null;
}) {
  return (
    !engagement.archivedAt &&
    !(readOnlyEngagementStatuses as readonly string[]).includes(
      engagement.status,
    )
  );
}

/**
 * Archived and cancelled engagements are read-only: nothing new may be
 * created under them. Reads, and the status transition that reopens a
 * cancelled engagement, do not call this.
 */
export function assertEngagementWritable(engagement: {
  status: string;
  archivedAt: Date | null;
}) {
  if (!isEngagementWritable(engagement)) throw new EngagementReadOnlyError();
}
