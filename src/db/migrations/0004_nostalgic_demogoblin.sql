CREATE TABLE "evidence_legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"placed_by" uuid,
	"released_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "passkeys" ADD COLUMN "aaguid" text;--> statement-breakpoint
ALTER TABLE "evidence_legal_holds" ADD CONSTRAINT "evidence_legal_holds_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_legal_holds" ADD CONSTRAINT "evidence_legal_holds_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_legal_holds" ADD CONSTRAINT "evidence_legal_holds_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_legal_holds" ADD CONSTRAINT "evidence_legal_holds_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_legal_holds_org_idx" ON "evidence_legal_holds" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "evidence_legal_holds_evidence_idx" ON "evidence_legal_holds" USING btree ("evidence_id","released_at");--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_idempotency_uq" ON "background_jobs" USING btree ("idempotency_key");--> statement-breakpoint
ALTER TABLE "passkeys" DROP COLUMN "last_used_at";