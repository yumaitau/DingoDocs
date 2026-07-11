import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { engagements } from "./engagements";
import { taskPriorityEnum, taskStatusEnum } from "./enums";
import { findings } from "./findings";
import { organisations } from "./organisations";

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("note"),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    visibility: text("visibility").notNull().default("team"),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("notes_org_engagement_idx").on(
      table.organisationId,
      table.engagementId,
    ),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    body: text("body").notNull(),
    visibility: text("visibility").notNull().default("team"),
    authorId: uuid("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("comments_org_target_idx").on(
      table.organisationId,
      table.targetType,
      table.targetId,
    ),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id").references(() => engagements.id, {
      onDelete: "cascade",
    }),
    findingId: uuid("finding_id").references(() => findings.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("todo"),
    priority: taskPriorityEnum("priority").notNull().default("normal"),
    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    clientVisible: boolean("client_visible").notNull().default(false),
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
    index("tasks_org_assignee_status_idx").on(
      table.organisationId,
      table.assigneeId,
      table.status,
    ),
    index("tasks_org_engagement_idx").on(
      table.organisationId,
      table.engagementId,
    ),
  ],
);

export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    phase: text("phase").notNull(),
    description: text("description").notNull(),
    commands: text("commands"),
    consultantId: uuid("consultant_id").references(() => users.id, {
      onDelete: "set null",
    }),
    attackMappings: jsonb("attack_mappings")
      .$type<Array<{ id: string; name?: string }>>()
      .notNull()
      .default([]),
    clientVisible: boolean("client_visible").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("timeline_events_org_engagement_time_idx").on(
      table.organisationId,
      table.engagementId,
      table.occurredAt,
    ),
  ],
);

export const timeEntries = pgTable(
  "time_entries",
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
      .references(() => users.id, { onDelete: "restrict" }),
    category: text("category").notNull(),
    hours: numeric("hours", { precision: 6, scale: 2 }).notNull(),
    billable: boolean("billable").notNull().default(true),
    description: text("description"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("time_entries_org_engagement_idx").on(
      table.organisationId,
      table.engagementId,
    ),
    index("time_entries_org_user_idx").on(table.organisationId, table.userId),
  ],
);
