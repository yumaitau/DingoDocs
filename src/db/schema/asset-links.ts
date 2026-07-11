import { uniqueIndex, pgTable, uuid } from "drizzle-orm/pg-core";
import { assets } from "./assets";
import { notes, tasks } from "./collaboration";
import { evidence } from "./evidence";
import { retestAttempts } from "./findings";
import { organisations } from "./organisations";

export const assetEvidence = pgTable(
  "asset_evidence",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    evidenceId: uuid("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("asset_evidence_uq").on(table.assetId, table.evidenceId),
  ],
);

export const assetTasks = pgTable(
  "asset_tasks",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("asset_tasks_uq").on(table.assetId, table.taskId)],
);

export const assetNotes = pgTable(
  "asset_notes",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("asset_notes_uq").on(table.assetId, table.noteId)],
);

export const assetRetestAttempts = pgTable(
  "asset_retest_attempts",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    retestAttemptId: uuid("retest_attempt_id")
      .notNull()
      .references(() => retestAttempts.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("asset_retest_attempts_uq").on(
      table.assetId,
      table.retestAttemptId,
    ),
  ],
);
