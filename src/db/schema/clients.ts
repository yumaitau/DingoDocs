import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organisations } from "./organisations";

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    tradingName: text("trading_name"),
    industry: text("industry"),
    address: text("address"),
    notes: text("notes"),
    securityClassification: text("security_classification")
      .notNull()
      .default("Confidential"),
    branding: jsonb("branding")
      .$type<{ logoUrl?: string; primaryColour?: string }>()
      .default({}),
    reportPreferences: jsonb("report_preferences")
      .$type<Record<string, unknown>>()
      .default({}),
    retentionPolicy: jsonb("retention_policy")
      .$type<Record<string, unknown>>()
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
    uniqueIndex("clients_org_name_uq").on(table.organisationId, table.name),
    index("clients_org_idx").on(table.organisationId),
  ],
);

export const clientContacts = pgTable(
  "client_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    role: text("role"),
    contactType: text("contact_type").notNull().default("security"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("client_contacts_org_client_idx").on(
      table.organisationId,
      table.clientId,
    ),
    uniqueIndex("client_contacts_client_email_uq").on(
      table.clientId,
      table.email,
    ),
  ],
);
