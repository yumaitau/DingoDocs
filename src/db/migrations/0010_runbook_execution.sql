CREATE TABLE "engagement_runbook_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_runbook_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"objective" text,
	"procedure" text NOT NULL,
	"expected_evidence" text,
	"required" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"notes" text,
	"finding_id" uuid,
	"evidence_id" uuid,
	"task_id" uuid,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_runbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"template_id" uuid,
	"template_name" text NOT NULL,
	"template_version" integer NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runbook_template_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"objective" text,
	"procedure" text NOT NULL,
	"expected_evidence" text,
	"required" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runbook_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"assessment_types" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "engagement_runbook_steps" ADD CONSTRAINT "engagement_runbook_steps_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_runbook_steps" ADD CONSTRAINT "engagement_runbook_steps_engagement_runbook_id_engagement_runbooks_id_fk" FOREIGN KEY ("engagement_runbook_id") REFERENCES "public"."engagement_runbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_runbook_steps" ADD CONSTRAINT "engagement_runbook_steps_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_runbook_steps" ADD CONSTRAINT "engagement_runbook_steps_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_runbook_steps" ADD CONSTRAINT "engagement_runbook_steps_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_runbook_steps" ADD CONSTRAINT "engagement_runbook_steps_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_runbooks" ADD CONSTRAINT "engagement_runbooks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_runbooks" ADD CONSTRAINT "engagement_runbooks_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_runbooks" ADD CONSTRAINT "engagement_runbooks_template_id_runbook_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."runbook_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_runbooks" ADD CONSTRAINT "engagement_runbooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runbook_template_steps" ADD CONSTRAINT "runbook_template_steps_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runbook_template_steps" ADD CONSTRAINT "runbook_template_steps_template_id_runbook_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."runbook_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runbook_templates" ADD CONSTRAINT "runbook_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runbook_templates" ADD CONSTRAINT "runbook_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_runbook_steps_position_uq" ON "engagement_runbook_steps" USING btree ("engagement_runbook_id","position");--> statement-breakpoint
CREATE INDEX "engagement_runbook_steps_org_idx" ON "engagement_runbook_steps" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "engagement_runbook_steps_status_idx" ON "engagement_runbook_steps" USING btree ("engagement_runbook_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_runbooks_engagement_template_version_uq" ON "engagement_runbooks" USING btree ("engagement_id","template_id","template_version");--> statement-breakpoint
CREATE INDEX "engagement_runbooks_org_engagement_idx" ON "engagement_runbooks" USING btree ("organisation_id","engagement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runbook_template_steps_position_uq" ON "runbook_template_steps" USING btree ("template_id","position");--> statement-breakpoint
CREATE INDEX "runbook_template_steps_org_idx" ON "runbook_template_steps" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runbook_templates_org_name_version_uq" ON "runbook_templates" USING btree ("organisation_id","name","version");--> statement-breakpoint
CREATE INDEX "runbook_templates_org_status_idx" ON "runbook_templates" USING btree ("organisation_id","status");