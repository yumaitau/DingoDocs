import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { engagements } from "./engagements";
import { evidence } from "./evidence";
import { findings } from "./findings";
import { organisations } from "./organisations";
import { tasks } from "./collaboration";

export const runbookTemplates = pgTable(
  "runbook_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    assessmentTypes: text("assessment_types")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("runbook_templates_org_name_version_uq").on(
      table.organisationId,
      table.name,
      table.version,
    ),
    index("runbook_templates_org_status_idx").on(
      table.organisationId,
      table.status,
    ),
  ],
);

export const runbookTemplateSteps = pgTable(
  "runbook_template_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => runbookTemplates.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    objective: text("objective"),
    procedure: text("procedure").notNull(),
    expectedEvidence: text("expected_evidence"),
    required: boolean("required").notNull().default(true),
  },
  (table) => [
    uniqueIndex("runbook_template_steps_position_uq").on(
      table.templateId,
      table.position,
    ),
    index("runbook_template_steps_org_idx").on(table.organisationId),
  ],
);

export const engagementRunbooks = pgTable(
  "engagement_runbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(() => runbookTemplates.id, {
      onDelete: "set null",
    }),
    templateName: text("template_name").notNull(),
    templateVersion: integer("template_version").notNull(),
    status: text("status").notNull().default("not_started"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("engagement_runbooks_engagement_template_version_uq").on(
      table.engagementId,
      table.templateId,
      table.templateVersion,
    ),
    index("engagement_runbooks_org_engagement_idx").on(
      table.organisationId,
      table.engagementId,
    ),
  ],
);

export const engagementRunbookSteps = pgTable(
  "engagement_runbook_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    engagementRunbookId: uuid("engagement_runbook_id")
      .notNull()
      .references(() => engagementRunbooks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    objective: text("objective"),
    procedure: text("procedure").notNull(),
    expectedEvidence: text("expected_evidence"),
    required: boolean("required").notNull().default(true),
    status: text("status").notNull().default("not_started"),
    notes: text("notes"),
    findingId: uuid("finding_id").references(() => findings.id, {
      onDelete: "set null",
    }),
    evidenceId: uuid("evidence_id").references(() => evidence.id, {
      onDelete: "set null",
    }),
    taskId: uuid("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    completedBy: uuid("completed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("engagement_runbook_steps_position_uq").on(
      table.engagementRunbookId,
      table.position,
    ),
    index("engagement_runbook_steps_org_idx").on(table.organisationId),
    index("engagement_runbook_steps_status_idx").on(
      table.engagementRunbookId,
      table.status,
    ),
  ],
);
