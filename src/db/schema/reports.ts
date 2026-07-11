import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { clients } from "./clients";
import { engagements } from "./engagements";
import { reportStatusEnum } from "./enums";
import { organisations } from "./organisations";

export type ReportFormat = "pdf" | "docx" | "html" | "markdown" | "json";
export type ReportCondition = {
  field: "hasFindings" | "hasEvidence" | "hasScope" | "status";
  operator: "equals" | "not_equals" | "truthy";
  value?: string | boolean;
};
export type ReportSectionDefinition = {
  id: string;
  type:
    | "cover"
    | "executive_summary"
    | "reusable_content"
    | "prose"
    | "findings"
    | "scope"
    | "assets"
    | "chart"
    | "risk_matrix"
    | "evidence"
    | "appendix"
    | "page_break";
  title?: string;
  content?: string;
  reusableKey?: string;
  condition?: ReportCondition;
  options?: Record<string, string | number | boolean>;
};
export type ReportTemplateDefinition = {
  sections: ReportSectionDefinition[];
  reusableContent?: Record<string, string>;
  variables?: Record<string, string>;
  branding: {
    organisationName?: string;
    logoUrl?: string;
    primaryColour: string;
    accentColour: string;
  };
  typography: {
    bodyFont: string;
    headingFont: string;
    bodySize: number;
  };
  header: { left?: string; right?: string; showRule?: boolean };
  footer: { left?: string; showPageNumbers?: boolean };
  watermark?: string;
  classification: string;
  approvals?: Array<{ role: string; required: boolean }>;
  signatures?: Array<{ label: string; role: string }>;
};

export const reportTemplates = pgTable(
  "report_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    definition: jsonb("definition").$type<ReportTemplateDefinition>().notNull(),
    customCss: text("custom_css"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("report_templates_org_name_version_uq").on(
      table.organisationId,
      table.name,
      table.version,
    ),
    index("report_templates_org_client_idx").on(
      table.organisationId,
      table.clientId,
    ),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").references(() => reportTemplates.id, {
      onDelete: "set null",
    }),
    templateVersion: integer("template_version"),
    title: text("title").notNull(),
    status: reportStatusEnum("status").notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("reports_org_engagement_status_idx").on(
      table.organisationId,
      table.engagementId,
      table.status,
    ),
  ],
);

export const reportVersions = pgTable(
  "report_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: reportStatusEnum("status").notNull().default("draft"),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    immutable: boolean("immutable").notNull().default(false),
    storageKeyPdf: text("storage_key_pdf"),
    storageKeyDocx: text("storage_key_docx"),
    exportKeys: jsonb("export_keys")
      .$type<Partial<Record<ReportFormat, string>>>()
      .notNull()
      .default({}),
    exportChecksums: jsonb("export_checksums")
      .$type<Partial<Record<ReportFormat, string>>>()
      .notNull()
      .default({}),
    renderStatus: text("render_status").notNull().default("not_requested"),
    renderError: text("render_error"),
    renderedAt: timestamp("rendered_at", { withTimezone: true }),
    checksum: text("checksum"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedBy: uuid("approved_by").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("report_versions_report_version_uq").on(
      table.reportId,
      table.version,
    ),
    index("report_versions_org_idx").on(table.organisationId),
  ],
);

export const reportTransitions = pgTable(
  "report_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    reportVersionId: uuid("report_version_id")
      .notNull()
      .references(() => reportVersions.id, { onDelete: "cascade" }),
    fromStatus: reportStatusEnum("from_status").notNull(),
    toStatus: reportStatusEnum("to_status").notNull(),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("report_transitions_org_report_idx").on(
      table.organisationId,
      table.reportId,
    ),
  ],
);

export const reportReviews = pgTable(
  "report_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    reportVersionId: uuid("report_version_id")
      .notNull()
      .references(() => reportVersions.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decision: text("decision").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("report_reviews_org_version_idx").on(
      table.organisationId,
      table.reportVersionId,
    ),
  ],
);
