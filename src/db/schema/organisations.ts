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
import { organisationRoleEnum } from "./enums";

export type SecurityPolicy = {
  mfaMode?: "optional" | "admin_required" | "all_users_required";
  mfaGracePeriodDays?: number;
};

export const organisations = pgTable(
  "organisations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    branding: jsonb("branding")
      .$type<{ logoUrl?: string; accentColour?: string }>()
      .default({}),
    securityPolicy: jsonb("security_policy")
      .$type<SecurityPolicy>()
      .default({ mfaMode: "optional" }),
    dataRegion: text("data_region").notNull().default("ap-southeast-2"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("organisations_slug_uq").on(table.slug)],
);

export const organisationMembers = pgTable(
  "organisation_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: organisationRoleEnum("role").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("organisation_members_org_user_uq").on(
      table.organisationId,
      table.userId,
    ),
    index("organisation_members_user_idx").on(table.userId),
  ],
);

export const organisationInvitations = pgTable(
  "organisation_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: organisationRoleEnum("role").notNull(),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("organisation_invitations_token_uq").on(table.tokenHash),
    index("organisation_invites_org_email_idx").on(
      table.organisationId,
      table.email,
    ),
  ],
);
