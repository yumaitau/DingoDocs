CREATE TABLE "risk_matrices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"client_id" uuid,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "restrictions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "retention_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "malware_scan_result" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "quarantined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "template_version" integer;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "template_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "approved_version" integer;--> statement-breakpoint
UPDATE "findings" AS f
SET
  "template_version" = t."version",
  "template_snapshot" = jsonb_build_object(
    'title', t."title",
    'summary', t."summary",
    'executiveDescription', t."executive_description",
    'technicalDescription', t."technical_description",
    'businessImpact', t."business_impact",
    'technicalImpact', t."technical_impact",
    'likelihood', t."likelihood",
    'severity', t."severity",
    'riskRationale', t."risk_rationale",
    'remediation', t."remediation",
    'verificationSteps', t."verification_steps",
    'references', t."references",
    'tags', t."tags",
    'assessmentTypes', t."assessment_types",
    'mappings', t."mappings"
  )
FROM "finding_templates" AS t
WHERE f."template_id" = t."id";--> statement-breakpoint
UPDATE "findings"
SET "approved_version" = "version"
WHERE "status" IN ('qa_approved', 'published', 'remediation_in_progress', 'ready_for_retest', 'retested', 'resolved', 'risk_accepted', 'closed');--> statement-breakpoint
ALTER TABLE "risk_matrices" ADD CONSTRAINT "risk_matrices_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_matrices" ADD CONSTRAINT "risk_matrices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_matrices" ADD CONSTRAINT "risk_matrices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "risk_matrices_org_client_idx" ON "risk_matrices" USING btree ("organisation_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_matrices_org_name_version_uq" ON "risk_matrices" USING btree ("organisation_id","name","version");
