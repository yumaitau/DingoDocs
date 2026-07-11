CREATE TABLE "retest_evidence" (
	"organisation_id" uuid NOT NULL,
	"retest_attempt_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remediation_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"submitted_by" uuid,
	"status" text NOT NULL,
	"owner" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retest_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"retest_attempt_id" uuid NOT NULL,
	"author_id" uuid,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "client_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "retest_attempts" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "retest_attempts" ADD COLUMN "original_finding_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "retest_attempts" ADD COLUMN "original_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "retest_attempts" ADD COLUMN "remediation_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "retest_attempts" ADD COLUMN "comparison" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "retest_attempts" ADD COLUMN "updated_report_version_id" uuid;--> statement-breakpoint
ALTER TABLE "report_versions" ADD COLUMN "client_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "report_versions" ADD COLUMN "client_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "report_versions" ADD COLUMN "client_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "retest_evidence" ADD CONSTRAINT "retest_evidence_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retest_evidence" ADD CONSTRAINT "retest_evidence_retest_attempt_id_retest_attempts_id_fk" FOREIGN KEY ("retest_attempt_id") REFERENCES "public"."retest_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retest_evidence" ADD CONSTRAINT "retest_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_updates" ADD CONSTRAINT "remediation_updates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_updates" ADD CONSTRAINT "remediation_updates_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_updates" ADD CONSTRAINT "remediation_updates_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retest_notes" ADD CONSTRAINT "retest_notes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retest_notes" ADD CONSTRAINT "retest_notes_retest_attempt_id_retest_attempts_id_fk" FOREIGN KEY ("retest_attempt_id") REFERENCES "public"."retest_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retest_notes" ADD CONSTRAINT "retest_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "retest_evidence_uq" ON "retest_evidence" USING btree ("retest_attempt_id","evidence_id");--> statement-breakpoint
CREATE INDEX "remediation_updates_org_finding_idx" ON "remediation_updates" USING btree ("organisation_id","finding_id","created_at");--> statement-breakpoint
CREATE INDEX "retest_notes_org_attempt_idx" ON "retest_notes" USING btree ("organisation_id","retest_attempt_id","created_at");--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_client_approved_by_users_id_fk" FOREIGN KEY ("client_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
