ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "cwe" text;
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "owasp" text;
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "attack_techniques" text[] DEFAULT ARRAY[]::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "cve" text;
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "epss_score" text;
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "kev" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "compliance_tags" text[] DEFAULT ARRAY[]::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "retain_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN IF NOT EXISTS "program_id" uuid;
--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN IF NOT EXISTS "recurrence" text;
--> statement-breakpoint
ALTER TABLE "engagements" ADD COLUMN IF NOT EXISTS "retain_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'assessment' NOT NULL;
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "retain_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "parent_id" uuid;
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "mentions" text[] DEFAULT ARRAY[]::text[] NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "programs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "year" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "programs_org_client_idx" ON "programs" ("organisation_id","client_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "engagements" ADD CONSTRAINT "engagements_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "client_id" uuid REFERENCES "clients"("id") ON DELETE set null,
  "name" text NOT NULL,
  "stage" text DEFAULT 'lead' NOT NULL,
  "value" text,
  "sow_template" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunities_org_idx" ON "opportunities" ("organisation_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sla_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "client_id" uuid REFERENCES "clients"("id") ON DELETE cascade,
  "severity" text NOT NULL,
  "days" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sla_policies_scope_uq" ON "sla_policies" ("organisation_id","client_id","severity");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "saved_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "resource" text NOT NULL,
  "filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_views_owner_idx" ON "saved_views" ("organisation_id","user_id","resource");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comment_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "comment_id" uuid NOT NULL REFERENCES "comments"("id") ON DELETE cascade,
  "body" text NOT NULL,
  "edited_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_revisions_comment_idx" ON "comment_revisions" ("comment_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "integration_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "provider" text NOT NULL,
  "configuration_encrypted" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integration_connections_org_provider_uq" ON "integration_connections" ("organisation_id","provider");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scim_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL REFERENCES "organisations"("id") ON DELETE cascade,
  "token_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scim_tokens_hash_uq" ON "scim_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scim_tokens_org_idx" ON "scim_tokens" ("organisation_id");
--> statement-breakpoint
ALTER TABLE "findings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "engagements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "findings";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "findings" USING (organisation_id::text = current_setting('app.organisation_id', true)) WITH CHECK (organisation_id::text = current_setting('app.organisation_id', true));
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "engagements";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "engagements" USING (organisation_id::text = current_setting('app.organisation_id', true)) WITH CHECK (organisation_id::text = current_setting('app.organisation_id', true));
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "reports";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "reports" USING (organisation_id::text = current_setting('app.organisation_id', true)) WITH CHECK (organisation_id::text = current_setting('app.organisation_id', true));
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "evidence";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "evidence" USING (organisation_id::text = current_setting('app.organisation_id', true)) WITH CHECK (organisation_id::text = current_setting('app.organisation_id', true));
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "clients";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "clients" USING (organisation_id::text = current_setting('app.organisation_id', true)) WITH CHECK (organisation_id::text = current_setting('app.organisation_id', true));
