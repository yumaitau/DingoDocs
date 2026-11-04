-- Tenant row-level security that actually enforces.
--
-- The application connects as the table owner (often a superuser), which
-- bypasses RLS. Request work that has an authorised organisation runs inside
-- withTenant() (src/db/tenant.ts): a transaction that does
-- `SET LOCAL ROLE dingodocs_tenant` and sets `app.organisation_id`. This
-- NOLOGIN, NOSUPERUSER, NOBYPASSRLS role is subject to the policies below.
-- Superusers may SET ROLE to it, and RLS then applies, so this also works
-- with the docker-compose superuser.
--
-- No FORCE ROW LEVEL SECURITY: owner connections (migrations, the job runner,
-- auth and SCIM lookups, retention) are the trusted system path and keep
-- bypassing RLS.
--
-- Managed Postgres without CREATEROLE: role creation is skipped with a
-- WARNING and RLS stays inert; the app detects the missing role at startup,
-- logs `db.tenant_rls.inactive`, and keeps working on its application-level
-- tenant predicates. A DBA can run the role block from docs/deployment.md.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dingodocs_tenant') THEN
    CREATE ROLE dingodocs_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  GRANT dingodocs_tenant TO CURRENT_USER;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'dingodocs: cannot create or grant role dingodocs_tenant (%); tenant row-level security stays inactive until a DBA creates it', SQLERRM;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dingodocs_tenant') THEN
    RAISE WARNING 'dingodocs: role dingodocs_tenant is missing; skipping tenant grants';
    RETURN;
  END IF;
  GRANT USAGE ON SCHEMA public TO dingodocs_tenant;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dingodocs_tenant;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dingodocs_tenant;
  -- Tables and sequences created by later migrations (run as this user).
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dingodocs_tenant;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO dingodocs_tenant;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'dingodocs: cannot grant table privileges to dingodocs_tenant (%); tenant row-level security stays inactive', SQLERRM;
END $$;
--> statement-breakpoint
-- tenant_isolation on every table that holds tenant content and is only read
-- after an organisation is authorised. Each has organisation_id NOT NULL.
--
-- Clients and engagements: clients, client_contacts, programs, opportunities,
--   engagements, engagement_members (read for engagement ACL after the org is
--   known), engagement_contacts, engagement_transitions, scope_versions,
--   scope_items, rules_of_engagement, rule_acknowledgements, sla_policies.
-- Findings: findings, finding_versions, finding_transitions, finding_assets,
--   finding_templates, risk_matrices, retest_attempts, retest_notes,
--   retest_evidence, remediation_updates.
-- Evidence: evidence, evidence_findings, evidence_annotations,
--   evidence_legal_holds.
-- Assets: assets, asset_scope_items, asset_evidence, asset_tasks,
--   asset_notes, asset_retest_attempts.
-- Reports: reports, report_versions, report_transitions, report_reviews,
--   report_templates.
-- Collaboration: notes, comments, comment_revisions, tasks, timeline_events,
--   time_entries, saved_views, notifications (per-user inbox rows).
-- Runbooks: runbook_templates, runbook_template_steps, engagement_runbooks,
--   engagement_runbook_steps.
-- Imports: import_runs, import_items.
-- Integration content (encrypted secrets and delivery payloads; the job
--   runner reads them on the owner path, so RLS does not affect delivery):
--   webhooks, webhook_deliveries, notification_channels,
--   notification_deliveries, integration_connections, ai_configurations,
--   ai_assist_runs.
--
-- Deliberately WITHOUT RLS (read across tenants, or before an organisation is
-- known, by auth, SCIM or system paths):
--   users, accounts, sessions, verification_tokens, two_factor, passkeys,
--     login_attempts: Better Auth and SAML resolve these by email, token or
--     session id before any organisation is known; no organisation_id.
--   organisations, organisation_members: active-organisation resolution and
--     membership checks read every membership of a user.
--   organisation_invitations: invite acceptance looks up a token before the
--     invitee belongs to the organisation.
--   api_keys, service_accounts: bearer authentication looks up the key hash
--     (joined to its service account) to learn the organisation.
--   scim_tokens: SCIM authentication looks up the token hash to learn the
--     organisation.
--   audit_events: organisation_id is nullable (pre-auth events), sign-in
--     audit fans out one row per membership, and the table is append-only.
--   background_jobs: organisation_id is nullable and the runner claims jobs
--     for every tenant.
DO $$
DECLARE
  table_name text;
  tenant_tables text[] := ARRAY[
    'clients', 'client_contacts', 'programs', 'opportunities',
    'engagements', 'engagement_members', 'engagement_contacts',
    'engagement_transitions', 'scope_versions', 'scope_items',
    'rules_of_engagement', 'rule_acknowledgements', 'sla_policies',
    'findings', 'finding_versions', 'finding_transitions', 'finding_assets',
    'finding_templates', 'risk_matrices', 'retest_attempts', 'retest_notes',
    'retest_evidence', 'remediation_updates',
    'evidence', 'evidence_findings', 'evidence_annotations',
    'evidence_legal_holds',
    'assets', 'asset_scope_items', 'asset_evidence', 'asset_tasks',
    'asset_notes', 'asset_retest_attempts',
    'reports', 'report_versions', 'report_transitions', 'report_reviews',
    'report_templates',
    'notes', 'comments', 'comment_revisions', 'tasks', 'timeline_events',
    'time_entries', 'saved_views', 'notifications',
    'runbook_templates', 'runbook_template_steps', 'engagement_runbooks',
    'engagement_runbook_steps',
    'import_runs', 'import_items',
    'webhooks', 'webhook_deliveries', 'notification_channels',
    'notification_deliveries', 'integration_connections',
    'ai_configurations', 'ai_assist_runs'
  ];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    -- Compare uuid to uuid so the predicate can use organisation_id indexes.
    -- An unset or reset setting is NULL or '', which matches no row.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (organisation_id = nullif(current_setting(''app.organisation_id'', true), '''')::uuid) '
      'WITH CHECK (organisation_id = nullif(current_setting(''app.organisation_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;
END $$;
