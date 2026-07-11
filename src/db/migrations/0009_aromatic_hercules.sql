CREATE TABLE "import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"import_run_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"severity" text NOT NULL,
	"asset_identifier" text,
	"action" text NOT NULL,
	"selected" boolean DEFAULT true NOT NULL,
	"normalized" jsonb NOT NULL,
	"finding_id" uuid,
	"asset_id" uuid,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"source_evidence_id" uuid NOT NULL,
	"adapter" text NOT NULL,
	"source_filename" text NOT NULL,
	"source_sha256" text NOT NULL,
	"status" text DEFAULT 'previewed' NOT NULL,
	"summary" jsonb DEFAULT '{"total":0,"new":0,"duplicate":0,"selected":0}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "source_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "source_fingerprint" text;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "source_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_source_evidence_id_evidence_id_fk" FOREIGN KEY ("source_evidence_id") REFERENCES "public"."evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_items_org_run_idx" ON "import_items" USING btree ("organisation_id","import_run_id");--> statement-breakpoint
CREATE INDEX "import_items_org_fingerprint_idx" ON "import_items" USING btree ("organisation_id","fingerprint");--> statement-breakpoint
CREATE INDEX "import_runs_org_engagement_idx" ON "import_runs" USING btree ("organisation_id","engagement_id","created_at");--> statement-breakpoint
CREATE INDEX "findings_org_source_fingerprint_idx" ON "findings" USING btree ("organisation_id","source_fingerprint");