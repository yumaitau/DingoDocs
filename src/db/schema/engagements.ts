import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { clientContacts, clients } from "./clients";
import { engagementStatusEnum, organisationRoleEnum } from "./enums";
import { organisations } from "./organisations";

export const engagements = pgTable(
  "engagements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    reference: text("reference").notNull(),
    type: text("type").notNull(),
    status: engagementStatusEnum("status").notNull().default("proposed"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    reportingDeadline: date("reporting_deadline"),
    testingWindow: jsonb("testing_window")
      .$type<{
        timezone?: string;
        days?: string[];
        from?: string;
        to?: string;
      }>()
      .default({}),
    objectives: text("objectives"),
    assumptions: text("assumptions"),
    constraints: text("constraints"),
    dependencies: text("dependencies"),
    securityClassification: text("security_classification")
      .notNull()
      .default("Confidential"),
    health: text("health").notNull().default("on_track"),
    progress: integer("progress").notNull().default(0),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("engagements_org_reference_uq").on(
      table.organisationId,
      table.reference,
    ),
    index("engagements_org_client_idx").on(
      table.organisationId,
      table.clientId,
    ),
    index("engagements_org_status_idx").on(table.organisationId, table.status),
    check(
      "engagements_progress_range",
      sql`${table.progress} between 0 and 100`,
    ),
  ],
);

export const engagementMembers = pgTable(
  "engagement_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: organisationRoleEnum("role").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("engagement_members_engagement_user_uq").on(
      table.engagementId,
      table.userId,
    ),
    index("engagement_members_org_user_idx").on(
      table.organisationId,
      table.userId,
    ),
  ],
);

export const engagementContacts = pgTable(
  "engagement_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => clientContacts.id, { onDelete: "cascade" }),
    accessLevel: text("access_level").notNull().default("standard"),
  },
  (table) => [
    uniqueIndex("engagement_contacts_engagement_contact_uq").on(
      table.engagementId,
      table.contactId,
    ),
  ],
);

export const scopeVersions = pgTable(
  "scope_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    changeSummary: text("change_summary"),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("scope_versions_engagement_version_uq").on(
      table.engagementId,
      table.version,
    ),
    index("scope_versions_org_idx").on(table.organisationId),
  ],
);

export const scopeItems = pgTable(
  "scope_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    scopeVersionId: uuid("scope_version_id")
      .notNull()
      .references(() => scopeVersions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    value: text("value").notNull(),
    environment: text("environment"),
    owner: text("owner"),
    businessCriticality: text("business_criticality"),
    technicalCriticality: text("technical_criticality"),
    scopeStatus: text("scope_status").notNull().default("in_scope"),
    exclusionReason: text("exclusion_reason"),
    testingRestrictions: text("testing_restrictions"),
    approvedMethods: text("approved_methods")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("scope_items_org_engagement_idx").on(
      table.organisationId,
      table.engagementId,
    ),
    index("scope_items_value_idx").on(table.value),
  ],
);

export const rulesOfEngagement = pgTable(
  "rules_of_engagement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    permittedTestTimes: text("permitted_test_times"),
    sourceIpAddresses: text("source_ip_addresses")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    approvedTooling: text("approved_tooling")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    prohibitedTechniques: text("prohibited_techniques")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    restrictions: jsonb("restrictions")
      .$type<Record<string, boolean | string>>()
      .notNull()
      .default({}),
    emergencyContacts: jsonb("emergency_contacts")
      .$type<Array<{ name: string; phone?: string; email?: string }>>()
      .notNull()
      .default([]),
    stopTestingProcedure: text("stop_testing_procedure"),
    escalationProcedure: text("escalation_procedure"),
    evidenceHandling: text("evidence_handling"),
    dataDestruction: text("data_destruction"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("rules_engagement_version_uq").on(
      table.engagementId,
      table.version,
    ),
    index("rules_org_idx").on(table.organisationId),
  ],
);

export const ruleAcknowledgements = pgTable(
  "rule_acknowledgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    rulesId: uuid("rules_id")
      .notNull()
      .references(() => rulesOfEngagement.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("rule_acknowledgements_rule_user_uq").on(
      table.rulesId,
      table.userId,
    ),
  ],
);

export const engagementTransitions = pgTable(
  "engagement_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    fromStatus: engagementStatusEnum("from_status").notNull(),
    toStatus: engagementStatusEnum("to_status").notNull(),
    reason: text("reason"),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("engagement_transitions_org_engagement_idx").on(
      table.organisationId,
      table.engagementId,
      table.createdAt,
    ),
  ],
);
