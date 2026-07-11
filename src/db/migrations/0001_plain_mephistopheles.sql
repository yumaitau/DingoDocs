CREATE TABLE "asset_evidence" (
	"organisation_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_notes" (
	"organisation_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"note_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_retest_attempts" (
	"organisation_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"retest_attempt_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_tasks" (
	"organisation_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"task_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"from_status" "engagement_status" NOT NULL,
	"to_status" "engagement_status" NOT NULL,
	"reason" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "kind" text DEFAULT 'note' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_evidence" ADD CONSTRAINT "asset_evidence_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_notes" ADD CONSTRAINT "asset_notes_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_notes" ADD CONSTRAINT "asset_notes_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_notes" ADD CONSTRAINT "asset_notes_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_retest_attempts" ADD CONSTRAINT "asset_retest_attempts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_retest_attempts" ADD CONSTRAINT "asset_retest_attempts_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_retest_attempts" ADD CONSTRAINT "asset_retest_attempts_retest_attempt_id_retest_attempts_id_fk" FOREIGN KEY ("retest_attempt_id") REFERENCES "public"."retest_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tasks" ADD CONSTRAINT "asset_tasks_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tasks" ADD CONSTRAINT "asset_tasks_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_tasks" ADD CONSTRAINT "asset_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_transitions" ADD CONSTRAINT "engagement_transitions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_transitions" ADD CONSTRAINT "engagement_transitions_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_transitions" ADD CONSTRAINT "engagement_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_evidence_uq" ON "asset_evidence" USING btree ("asset_id","evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_notes_uq" ON "asset_notes" USING btree ("asset_id","note_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_retest_attempts_uq" ON "asset_retest_attempts" USING btree ("asset_id","retest_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_tasks_uq" ON "asset_tasks" USING btree ("asset_id","task_id");--> statement-breakpoint
CREATE INDEX "engagement_transitions_org_engagement_idx" ON "engagement_transitions" USING btree ("organisation_id","engagement_id","created_at");