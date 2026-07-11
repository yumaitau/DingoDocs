import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { assets } from "./assets";
import { clients } from "./clients";
import { engagements } from "./engagements";
import { findingStatusEnum, severityEnum } from "./enums";
import { organisations } from "./organisations";
import { reportVersions } from "./reports";

export type FrameworkMapping = {
  framework: string;
  reference: string;
  title?: string;
};

export const findingTemplates = pgTable(
  "finding_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    stableKey: text("stable_key").notNull(),
    version: integer("version").notNull().default(1),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    executiveDescription: text("executive_description"),
    technicalDescription: text("technical_description").notNull(),
    businessImpact: text("business_impact"),
    technicalImpact: text("technical_impact"),
    likelihood: text("likelihood"),
    severity: severityEnum("severity").notNull(),
    riskRationale: text("risk_rationale"),
    remediation: text("remediation").notNull(),
    verificationSteps: text("verification_steps"),
    references: text("references").array().notNull().default([]),
    tags: text("tags").array().notNull().default([]),
    assessmentTypes: text("assessment_types").array().notNull().default([]),
    mappings: jsonb("mappings")
      .$type<FrameworkMapping[]>()
      .notNull()
      .default([]),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewStatus: text("review_status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("finding_templates_org_key_version_uq").on(
      table.organisationId,
      table.stableKey,
      table.version,
    ),
    index("finding_templates_org_status_idx").on(
      table.organisationId,
      table.reviewStatus,
    ),
  ],
);

export const findings = pgTable(
  "findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(() => findingTemplates.id, {
      onDelete: "set null",
    }),
    templateVersion: integer("template_version"),
    templateSnapshot: jsonb("template_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    identifier: text("identifier").notNull(),
    title: text("title").notNull(),
    status: findingStatusEnum("status").notNull().default("draft"),
    severity: severityEnum("severity").notNull(),
    riskRating: text("risk_rating"),
    likelihood: text("likelihood"),
    impact: text("impact"),
    cvssVector: text("cvss_vector"),
    cvssScore: numeric("cvss_score", { precision: 3, scale: 1 }),
    executiveSummary: text("executive_summary"),
    technicalDetail: text("technical_detail"),
    reproductionSteps: text("reproduction_steps"),
    proofOfConcept: text("proof_of_concept"),
    businessImpact: text("business_impact"),
    technicalImpact: text("technical_impact"),
    remediation: text("remediation"),
    verificationGuidance: text("verification_guidance"),
    references: text("references").array().notNull().default([]),
    mappings: jsonb("mappings")
      .$type<FrameworkMapping[]>()
      .notNull()
      .default([]),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewerId: uuid("reviewer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    clientOwner: text("client_owner"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    retestStatus: text("retest_status"),
    version: integer("version").notNull().default(1),
    approvedVersion: integer("approved_version"),
    clientVisible: boolean("client_visible").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("findings_engagement_identifier_uq").on(
      table.engagementId,
      table.identifier,
    ),
    index("findings_org_engagement_status_idx").on(
      table.organisationId,
      table.engagementId,
      table.status,
    ),
    index("findings_org_severity_idx").on(table.organisationId, table.severity),
  ],
);

export type RiskMatrixDefinition = {
  likelihood: Array<{ key: string; label: string; order: number }>;
  impact: Array<{ key: string; label: string; order: number }>;
  ratings: Array<{
    likelihood: string;
    impact: string;
    severity: "informational" | "low" | "medium" | "high" | "critical";
    label: string;
    colour: string;
  }>;
};

export const riskMatrices = pgTable(
  "risk_matrices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    definition: jsonb("definition").$type<RiskMatrixDefinition>().notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (table) => [
    index("risk_matrices_org_client_idx").on(
      table.organisationId,
      table.clientId,
    ),
    uniqueIndex("risk_matrices_org_name_version_uq").on(
      table.organisationId,
      table.name,
      table.version,
    ),
  ],
);

export const findingAssets = pgTable(
  "finding_assets",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("finding_assets_uq").on(table.findingId, table.assetId),
  ],
);

export const findingVersions = pgTable(
  "finding_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    changedBy: uuid("changed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    changeSummary: text("change_summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("finding_versions_finding_version_uq").on(
      table.findingId,
      table.version,
    ),
    index("finding_versions_org_idx").on(table.organisationId),
  ],
);

export const findingTransitions = pgTable(
  "finding_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    fromStatus: findingStatusEnum("from_status").notNull(),
    toStatus: findingStatusEnum("to_status").notNull(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    comment: text("comment"),
    findingVersion: integer("finding_version").notNull(),
    overrideReason: text("override_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("finding_transitions_org_finding_idx").on(
      table.organisationId,
      table.findingId,
    ),
  ],
);

export const retestAttempts = pgTable(
  "retest_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedTo: uuid("assigned_to").references(() => users.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("requested"),
    outcome: text("outcome"),
    notes: text("notes"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    originalFindingVersion: integer("original_finding_version")
      .notNull()
      .default(1),
    originalSnapshot: jsonb("original_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    remediationSnapshot: jsonb("remediation_snapshot")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    comparison: jsonb("comparison")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    updatedReportVersionId: uuid("updated_report_version_id").references(
      () => reportVersions.id,
      { onDelete: "set null" },
    ),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("retest_attempts_org_finding_idx").on(
      table.organisationId,
      table.findingId,
    ),
    check(
      "retest_attempts_status_check",
      sql`${table.status} in ('requested', 'scheduled', 'in_progress', 'completed', 'cancelled')`,
    ),
    check(
      "retest_attempts_outcome_check",
      sql`${table.outcome} is null or ${table.outcome} in ('fixed', 'partially_remediated', 'not_remediated', 'risk_accepted', 'unable_to_verify')`,
    ),
  ],
);

export const remediationUpdates = pgTable(
  "remediation_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    submittedBy: uuid("submitted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull(),
    owner: text("owner"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("remediation_updates_org_finding_idx").on(
      table.organisationId,
      table.findingId,
      table.createdAt,
    ),
    check(
      "remediation_updates_status_check",
      sql`${table.status} in ('open', 'in_progress', 'remediated', 'partially_remediated', 'not_remediated', 'risk_accepted')`,
    ),
  ],
);

export const retestNotes = pgTable(
  "retest_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    retestAttemptId: uuid("retest_attempt_id")
      .notNull()
      .references(() => retestAttempts.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    visibility: text("visibility").notNull().default("internal"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("retest_notes_org_attempt_idx").on(
      table.organisationId,
      table.retestAttemptId,
      table.createdAt,
    ),
    check(
      "retest_notes_visibility_check",
      sql`${table.visibility} in ('internal', 'client')`,
    ),
  ],
);
