import { pgEnum } from "drizzle-orm/pg-core";

export const organisationRoleEnum = pgEnum("organisation_role", [
  "platform_administrator",
  "organisation_owner",
  "organisation_administrator",
  "engagement_manager",
  "lead_consultant",
  "consultant",
  "reviewer",
  "client_administrator",
  "client_user",
  "read_only",
]);

export const engagementStatusEnum = pgEnum("engagement_status", [
  "proposed",
  "scoping",
  "scheduled",
  "ready",
  "testing",
  "reporting",
  "peer_review",
  "quality_assurance",
  "client_review",
  "retesting",
  "complete",
  "archived",
  "cancelled",
]);

export const severityEnum = pgEnum("severity", [
  "informational",
  "low",
  "medium",
  "high",
  "critical",
]);

export const findingStatusEnum = pgEnum("finding_status", [
  "draft",
  "in_progress",
  "ready_for_review",
  "changes_requested",
  "peer_reviewed",
  "qa_approved",
  "published",
  "remediation_in_progress",
  "ready_for_retest",
  "retested",
  "resolved",
  "risk_accepted",
  "closed",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "draft",
  "internal_review",
  "changes_requested",
  "qa_approved",
  "client_review",
  "approved",
  "published",
  "superseded",
  "archived",
]);

export const evidenceClassificationEnum = pgEnum("evidence_classification", [
  "internal",
  "restricted",
  "client_visible",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
]);
export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);
