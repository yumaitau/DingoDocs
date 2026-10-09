CREATE OR REPLACE FUNCTION dingodocs_text_array_to_string(items text[], delimiter text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
  RETURN array_to_string(items, delimiter);
END;
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_clients_identity_gin" ON "clients" USING gin (to_tsvector('simple', coalesce(name,'')||' '||coalesce(legal_name,'')||' '||coalesce(industry,'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_engagements_name_gin" ON "engagements" USING gin (to_tsvector('simple', coalesce(name,'')||' '||coalesce(reference,'')||' '||coalesce(objectives,'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_findings_full_gin" ON "findings" USING gin (to_tsvector('simple', coalesce(title,'')||' '||coalesce(identifier,'')||' '||coalesce(executive_summary,'')||' '||coalesce(technical_detail,'')||' '||coalesce(remediation,'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_findings_portal_gin" ON "findings" USING gin (to_tsvector('simple', coalesce(title,'')||' '||coalesce(identifier,'')||' '||coalesce(executive_summary,'')||' '||coalesce(remediation,'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_finding_templates_text_gin" ON "finding_templates" USING gin (to_tsvector('simple', coalesce(title,'')||' '||coalesce(summary,'')||' '||coalesce(technical_description,'')||' '||dingodocs_text_array_to_string(tags,' ')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_runbook_templates_text_gin" ON "runbook_templates" USING gin (to_tsvector('simple', coalesce(name,'')||' '||coalesce(description,'')||' '||dingodocs_text_array_to_string(assessment_types,' ')||' '||dingodocs_text_array_to_string(tags,' ')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_assets_identity_gin" ON "assets" USING gin (to_tsvector('simple', coalesce(name,'')||' '||coalesce(identifier,'')||' '||coalesce(notes,'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_scope_items_notes_gin" ON "scope_items" USING gin (to_tsvector('simple', coalesce(name,'')||' '||coalesce(value,'')||' '||coalesce(notes,'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_scope_items_portal_gin" ON "scope_items" USING gin (to_tsvector('simple', coalesce(name,'')||' '||coalesce(value,'')||' '||coalesce(testing_restrictions,'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_evidence_file_gin" ON "evidence" USING gin (to_tsvector('simple', coalesce(original_filename,'')||' '||coalesce(media_type,'')||' '||coalesce(sha256,'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_reports_title_gin" ON "reports" USING gin (to_tsvector('simple', coalesce(title,'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_notes_body_gin" ON "notes" USING gin (to_tsvector('simple', coalesce(title,'')||' '||coalesce(content::text,'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_tasks_title_gin" ON "tasks" USING gin (to_tsvector('simple', coalesce(title,'')||' '||coalesce(description,'')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_users_identity_gin" ON "users" USING gin (to_tsvector('simple', coalesce(name,'')||' '||coalesce(email,'')));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION audit_events_append_only();
