import {
  bigint,
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
import { evidenceClassificationEnum } from "./enums";
import { findings } from "./findings";
import { organisations } from "./organisations";

export const evidence = pgTable(
  "evidence",
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
    parentId: uuid("parent_id"),
    originalFilename: text("original_filename").notNull(),
    storageProvider: text("storage_provider").notNull(),
    storageKey: text("storage_key").notNull(),
    mediaType: text("media_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    classification: evidenceClassificationEnum("classification")
      .notNull()
      .default("restricted"),
    restrictions: jsonb("restrictions")
      .$type<{
        userIds?: string[];
        reason?: string;
        clientVisibleAfterPublication?: boolean;
      }>()
      .notNull()
      .default({}),
    retentionStatus: text("retention_status").notNull().default("active"),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    encryptionMetadata: jsonb("encryption_metadata")
      .$type<Record<string, string>>()
      .default({}),
    version: integer("version").notNull().default(1),
    immutable: boolean("immutable").notNull().default(false),
    malwareScanStatus: text("malware_scan_status").notNull().default("pending"),
    malwareScanResult: jsonb("malware_scan_result")
      .$type<{ engine?: string; signature?: string; scannedAt?: string }>()
      .notNull()
      .default({}),
    quarantinedAt: timestamp("quarantined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("evidence_storage_key_uq").on(table.storageKey),
    index("evidence_org_engagement_idx").on(
      table.organisationId,
      table.engagementId,
    ),
    index("evidence_org_sha_idx").on(table.organisationId, table.sha256),
  ],
);

export const evidenceFindings = pgTable(
  "evidence_findings",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("evidence_findings_uq").on(table.evidenceId, table.findingId),
  ],
);

export const evidenceAnnotations = pgTable(
  "evidence_annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    sourceEvidenceId: uuid("source_evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    outputEvidenceId: uuid("output_evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    annotationData: jsonb("annotation_data")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("evidence_annotations_org_source_idx").on(
      table.organisationId,
      table.sourceEvidenceId,
    ),
  ],
);
