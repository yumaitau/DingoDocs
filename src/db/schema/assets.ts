import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { engagements, scopeItems } from "./engagements";
import { organisations } from "./organisations";

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    engagementId: uuid("engagement_id")
      .notNull()
      .references(() => engagements.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    identifier: text("identifier").notNull(),
    environment: text("environment"),
    owner: text("owner"),
    criticality: text("criticality"),
    notes: text("notes"),
    sourceProvenance: jsonb("source_provenance")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("assets_engagement_identifier_uq").on(
      table.engagementId,
      table.identifier,
    ),
    index("assets_org_engagement_idx").on(
      table.organisationId,
      table.engagementId,
    ),
  ],
);

export const assetScopeItems = pgTable(
  "asset_scope_items",
  {
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    scopeItemId: uuid("scope_item_id")
      .notNull()
      .references(() => scopeItems.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("asset_scope_items_uq").on(table.assetId, table.scopeItemId),
  ],
);
