import type { Permission } from "@/lib/permissions/matrix";

/**
 * Permission needed to move a report to a status. Publication lifecycle and
 * review gates are human-only: service-account keys hold neither
 * report:publish nor finding:approve.
 */
export function reportTransitionPermission(toStatus: string): Permission {
  if (["published", "superseded", "archived"].includes(toStatus))
    return "report:publish";
  if (
    ["changes_requested", "qa_approved", "client_review", "approved"].includes(
      toStatus,
    )
  )
    return "finding:approve";
  return "finding:create";
}
