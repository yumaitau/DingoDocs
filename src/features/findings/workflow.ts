import { findingStatusEnum } from "@/db/schema";

export type FindingStatus = (typeof findingStatusEnum.enumValues)[number];

export const findingTransitions: Record<
  FindingStatus,
  readonly FindingStatus[]
> = {
  draft: ["in_progress", "ready_for_review"],
  in_progress: ["draft", "ready_for_review"],
  ready_for_review: ["changes_requested", "peer_reviewed"],
  changes_requested: ["in_progress", "ready_for_review"],
  peer_reviewed: ["changes_requested", "qa_approved"],
  qa_approved: ["changes_requested", "published"],
  published: [
    "remediation_in_progress",
    "ready_for_retest",
    "risk_accepted",
    "closed",
  ],
  remediation_in_progress: ["ready_for_retest", "risk_accepted"],
  ready_for_retest: ["retested"],
  retested: ["resolved", "remediation_in_progress", "risk_accepted"],
  resolved: ["closed", "ready_for_retest"],
  risk_accepted: ["closed", "ready_for_retest"],
  closed: [],
};

export function canTransitionFinding(from: FindingStatus, to: FindingStatus) {
  return findingTransitions[from].includes(to);
}

export function assertFindingTransition(input: {
  from: FindingStatus;
  to: FindingStatus;
  canOverride: boolean;
  overrideReason?: string;
}) {
  if (canTransitionFinding(input.from, input.to)) return { override: false };
  if (!input.canOverride)
    throw new Error(
      `Finding cannot transition from ${input.from} to ${input.to}`,
    );
  if (!input.overrideReason?.trim())
    throw new Error("A workflow override requires a reason");
  return { override: true };
}
