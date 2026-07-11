CREATE TABLE "report_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"report_version_id" uuid NOT NULL,
	"from_status" "report_status" NOT NULL,
	"to_status" "report_status" NOT NULL,
	"actor_id" uuid,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_versions" ADD COLUMN "status" "report_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_versions" ADD COLUMN "export_keys" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "report_versions" ADD COLUMN "export_checksums" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "report_versions" ADD COLUMN "render_status" text DEFAULT 'not_requested' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_versions" ADD COLUMN "render_error" text;--> statement-breakpoint
ALTER TABLE "report_versions" ADD COLUMN "rendered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "template_version" integer;--> statement-breakpoint
UPDATE "reports" AS r
SET "template_version" = t."version"
FROM "report_templates" AS t
WHERE r."template_id" = t."id";--> statement-breakpoint
WITH missing AS (
  SELECT
    r.*,
    gen_random_uuid() AS version_id,
    o."name" AS organisation_name,
    c."name" AS client_name,
    e."name" AS engagement_name,
    e."reference" AS engagement_reference
  FROM "reports" r
  JOIN "organisations" o ON o."id" = r."organisation_id"
  JOIN "clients" c ON c."id" = r."client_id"
  JOIN "engagements" e ON e."id" = r."engagement_id"
  WHERE NOT EXISTS (
    SELECT 1 FROM "report_versions" rv WHERE rv."report_id" = r."id"
  )
)
INSERT INTO "report_versions" (
  "id", "organisation_id", "report_id", "version", "status", "content",
  "immutable", "created_by", "created_at"
)
SELECT
  version_id,
  "organisation_id",
  "id",
  "current_version",
  "status",
  jsonb_build_object(
    'reportId', "id",
    'reportVersionId', version_id,
    'version', "current_version",
    'title', "title",
    'organisationName', organisation_name,
    'clientName', client_name,
    'engagementName', engagement_name,
    'engagementReference', engagement_reference,
    'classification', 'Confidential',
    'generatedAt', "created_at",
    'theme', jsonb_build_object(
      'primaryColour', '#174b6b', 'accentColour', '#d59b2d',
      'bodyFont', 'Arial', 'headingFont', 'Arial', 'bodySize', 11,
      'headerLeft', organisation_name, 'headerRight', 'Confidential',
      'footerLeft', engagement_reference, 'showPageNumbers', true,
      'watermark', 'CONFIDENTIAL'
    ),
    'sections', jsonb_build_array(
      jsonb_build_object('definition', jsonb_build_object('id', 'cover', 'type', 'cover')),
      jsonb_build_object('definition', jsonb_build_object('id', 'executive-summary', 'type', 'executive_summary', 'title', 'Executive summary'), 'content', 'Migrated report. Create a new revision to refresh engagement content.'),
      jsonb_build_object('definition', jsonb_build_object('id', 'findings', 'type', 'findings', 'title', 'Detailed findings'))
    ),
    'findings', '[]'::jsonb,
    'scope', '[]'::jsonb,
    'assets', '[]'::jsonb,
    'evidence', '[]'::jsonb,
    'severityCounts', jsonb_build_object('critical', 0, 'high', 0, 'medium', 0, 'low', 0, 'informational', 0),
    'signatures', '[]'::jsonb
  ),
  "status" IN ('published', 'superseded', 'archived'),
  "created_by",
  "created_at"
FROM missing;--> statement-breakpoint
ALTER TABLE "report_transitions" ADD CONSTRAINT "report_transitions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_transitions" ADD CONSTRAINT "report_transitions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_transitions" ADD CONSTRAINT "report_transitions_report_version_id_report_versions_id_fk" FOREIGN KEY ("report_version_id") REFERENCES "public"."report_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_transitions" ADD CONSTRAINT "report_transitions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_transitions_org_report_idx" ON "report_transitions" USING btree ("organisation_id","report_id");
