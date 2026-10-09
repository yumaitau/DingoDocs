# DingoDocs TODO: fixes, wins, and market gap analysis

Researched 2026-10-09. Sources: static read of this repository (schema, services, actions, MCP tools, renderers, docs), live GitHub metadata for open-source competitors, and vendor sites, docs, release notes and review sites for commercial competitors. Baseline at time of research: `pnpm typecheck` clean, `pnpm lint` clean, `pnpm test` 87 passed with 11 integration files skipped (no `TEST_DATABASE_URL` locally).

Status markers: `[ ]` open, `[x]` done. Each item should be re-verified against the current code before work starts.

---

## Part 1. Fixes (verified defects)

Ranked by damage.

### 1.1 Client portal report leak (security)

- [x] The report model builder in `src/server/services/reports.ts` (around lines 760-792) selects every non-deleted finding and every non-deleted evidence row for the engagement. There is no filter on finding status, `clientVisible`, or evidence classification.
- [x] The portal preview route `src/app/api/portal/reports/[versionId]/preview/route.ts` renders that stored model with `renderReportHtml`. If a report reaches `client_review` or is shared, draft findings and internal/restricted evidence are visible to the client.
- [x] `docs/client-portal-guide.md` states draft findings and restricted evidence "never appear". Code does not enforce this; only human QA does.
- [x] Fix: filter findings to published-type statuses and `clientVisible = true`, filter evidence to `client_visible` classification, when building the model for client-shared versions. Alternatively build two models (internal, client) or filter at portal render time. Add an integration test that asserts a draft finding and a restricted evidence row do not appear in the portal preview.

### 1.2 Notifications and webhooks never fire

- [x] `queueNotification` (`src/server/services/notifications.ts`) has no callers outside tests.
- [x] `enqueueWebhookEvent` (`src/server/services/webhooks.ts`) has no callers outside tests.
- [x] The full pipeline exists: encrypted channel config (in-app, SMTP, Teams, Slack, Discord, generic webhook), HMAC v1 signatures, timestamp and event ID headers, 24h dual-secret rotation, exponential retry, SSRF-guarded URLs. Nothing produces events.
- [x] Fix: emit events from finding transitions, report transitions and publish, retest requested/scheduled/completed, remediation update submitted, comment created, invitation sent, scanner import applied.
- [x] Add an in-app notification inbox/bell. No UI currently reads the in-app channel.

### 1.3 MFA policy stored but never enforced

- [x] `organisations.securityPolicy.mfaMode` (optional / admin_required / all_users_required) and `users.mfaEnforcedAt` exist in schema but are never read outside the seed and migrations.
- [x] Fix: enforce in the session/authorisation layer. Redirect users without MFA to enrolment when policy requires it. Record `mfaEnforcedAt`.

### 1.4 Scanner import severity and parsing bugs (`src/lib/imports/adapters.ts`)

- [x] `mapSeverity` uses substring matching. ZAP XML `riskdesc` values like "Medium (High)" map to high and "Low (Medium)" map to medium because the parenthesised confidence is matched first. Match the leading token only.
- [x] ZAP JSON alerts carry `riskcode` and `riskdesc`, but `parseJson` reads `item.severity ?? item.risk`, so every ZAP JSON alert becomes informational. Read `riskcode`/`riskdesc` for ZAP JSON.
- [x] XML is parsed with regex (around lines 348-366). No CDATA handling, so Burp `issueDetail` CDATA sections are mangled. Use a real XML parser or handle CDATA explicitly.
- [x] `docs/architecture.md` says large imports run as background jobs. No import job type exists. Either implement or correct the doc.

### 1.5 Global search is a sequential scan

- [x] `src/server/services/global-search.ts` (around line 72) computes `to_tsvector` inline. No GIN index exists in any migration.
- [x] Fix: add generated `tsvector` columns (or expression indexes) with GIN indexes on the searched tables. Add a migration.

### 1.6 Built but never wired (dead UI state)

- [x] Engagement `health` and `progress` are displayed but never updated by any code. Only seed data sets them. Compute from tasks, runbook step completion, finding workflow states, and dates.
- [x] Risk matrices (per-org and per-client likelihood x impact tables, `findings.ts` around line 817) can be created in the UI but severity is never derived from them and reports never render them.
- [x] `timeline_events.attackMappings` (`src/db/schema/collaboration.ts:143`) is never read or written.
- [x] Engagement workspace tabs "Reports", "QA" and "Audit History" render placeholder text (`workspace-sections.tsx` around lines 57-71 and 1745). Data exists for all three.
- [x] `clients.retentionPolicy` and `clients.reportPreferences` are never used.
- [x] `organisations.dataRegion` is unused.
- [x] `evidence.encryptionMetadata` is unused. S3 uploads do not set SSE explicitly.
- [x] API scopes `tasks:write`, `webhooks:manage`, `notifications:manage` are declared in `src/lib/api/scopes.ts` but no route uses them.

### 1.7 Hygiene

- [x] Unused dependencies: `@tiptap/*`, `recharts`, `@dnd-kit/*`, `@tanstack/react-table`, `@tanstack/react-virtual`, `react-hook-form`, `@hookform/resolvers`. Either use them (several are needed for Part 2) or remove them. Tiptap, recharts, dnd-kit, and react-table are now used. `@tanstack/react-virtual`, `react-hook-form`, and `@hookform/resolvers` were removed.
- [x] `src/lib/integrations/crypto.ts` falls back to `BETTER_AUTH_SECRET` and, outside production, to the hardcoded string `development-integration-key`. Fail closed when `INTEGRATION_ENCRYPTION_KEY` is missing in production; warn loudly elsewhere.
- [x] Audit table is append-only by convention only. Add a trigger or revoke UPDATE/DELETE from the application role.
- [x] Seed hardcodes `admin@dingodocs.local` / `DingoDocs-Demo-2026!` (`src/db/seeds/index.ts:42`) with no production guard. Add a `NODE_ENV=production` refusal.
- [x] `docker-compose.yml` uses `POSTGRES_PASSWORD=dingodocs`. Document or require override.
- [x] README lists 16 MCP tools; code ships 17 (`list_timeline` is missing from the README).
- [x] Docs promise features the code does not have: "structured rich-text rendering" (everything is plain text), "saved views / persistent filters" (none found), background import jobs (none).
- [x] Audit page shows the last 200 events with no filter, search, or export.
- [x] No Postgres row-level security. Tenant isolation is application-level `organisation_id` predicates only. Consider RLS as defence in depth. Migration `0014_tier2_platform.sql` enables RLS without FORCE. The table owner still bypasses. Do not FORCE until every transaction sets `app.organisation_id` with `SET LOCAL`. Migration not applied in this session.

---

## Part 2. Wins

### Tier 1: wire what already exists (days each, highest return)

- [x] Hook notification and webhook producers into business events (fix 1.2). Add in-app bell and inbox.
- [x] Apply the risk matrix to derive severity from likelihood x impact and render the matrix in reports.
- [x] Compute engagement health and progress from real data.
- [x] Move AI out of the Integrations prompt box and into the finding editor. The gating (env flag, org opt-in, typed confirmation), audit (prompt hash, `untrusted_draft`), and three providers (Ollama, OpenAI Responses API, Anthropic) already exist. Add actions: draft remediation, rewrite for executive audience, expand reproduction steps, summarise scanner output into a finding, generate executive summary from published findings, grammar/consistency review. Pass finding and engagement context in a system prompt. Allow applying a draft to a field with an explicit accept step. SysReptor, PwnDoc 1.7, Cyver LLeMy, Dradis Echo and PentestPad all ship this.
- [x] Fill the three placeholder engagement tabs with existing report, QA transition, and audit data.
- [x] Write `timeline_events.attackMappings` from the timeline entry UI and MCP `add_timeline_entry`.
- [x] Use `clients.reportPreferences` as defaults when creating reports and `clients.retentionPolicy` for evidence defaults.

### Tier 2: match table stakes (every serious rival has these)

Findings and authoring

- [x] Rich text or Markdown findings with inline screenshots. Tiptap is installed and unused. All narrative is currently plain text with newlines converted to `<br>`. Tiptap stores markdown. Screenshot insert accepts http(s) image URLs.
- [x] CVSS calculator for both 3.1 and 4.0 with vector-to-score computation and validation. Currently a free-text 4.0 vector and a hand-typed score, and `services/findings.ts` around line 1061 rejects anything not starting `CVSS:4.0/`.
- [x] First-class CWE, OWASP (Top 10, ASVS, WSTG), MITRE ATT&CK fields instead of the generic `mappings` text lines. Add CVE and KEV/EPSS lookup where available.
- [x] Seeded vulnerability library. One template ships today. Ship 100+ reviewed writeups covering common web, API, network, cloud, mobile and AD findings. Add import of public libraries (for example the OWASP/community YAML sets and PwnDoc/SysReptor template exports). 130 original writeups (15 German). Public import is generic `findings[]` JSON, not a copyrighted OWASP YAML dump.
- [x] Finding library search and filtering by framework mapping, tags, assessment type.
- [x] Bulk operations on findings (status, severity, assign, client-visible toggle).
- [x] Threaded comments with replies, edit history, and @mentions. Inline comments on report sections (Ghostwriter's most requested feature; Dradis Pro has PR-style review).
- [x] Saved views and persistent filters (promised in docs).
- [x] Spellcheck/grammar (LanguageTool as SysReptor and PwnDoc do) and general report QA lint: empty sections, findings missing remediation, unreferenced evidence, placeholder text left in.

Reporting

- [x] Render the complete finding in reports. Renderers (`src/server/services/report-renderers.ts` around lines 36-47) output only executive summary, technical detail, business impact, remediation and CVSS. Reproduction steps, proof of concept, technical impact, references, mappings, affected assets and inline evidence are dropped. PDF also drops business impact and CVSS; DOCX drops business impact.
- [x] Unify the three hand-written renderers. Options: single HTML/CSS source rendered to PDF via headless Chromium (as SysReptor, WriteHat, Faraday do) while keeping the `docx` library for Word, or a shared intermediate document model consumed by all renderers. One-source PDF + DOCX + Markdown is rare in OSS (only APTRS and reptr) and is a differentiator in itself.
- [x] PDF is hardcoded LETTER and Helvetica; template fonts are ignored. Support A4, template fonts, and print CSS in PDF. A4 or Letter. Bundled Noto Sans Mono when the theme asks, otherwise Helvetica.
- [x] Real charts in PDF and DOCX. The "chart" and "risk_matrix" sections render as severity-count tables outside HTML. Render SVG server-side or draw with pdfkit.
- [x] Executive summary generated from data (severity distribution, top findings, trends vs previous engagement), with AI assist optional. An empty executive summary fills from severity counts and the top five findings.
- [x] "Refresh findings" on a report. The model is frozen when the report is created (`reports.ts` around line 215) and `saveReportDraft` only edits sections.
- [x] Report version diff (what changed between versions).
- [x] Attestation / letter of attestation report type and remediation summary letter. Cobalt, Bugcrowd and HackerOne offer these; authoring platforms mostly do not.
- [x] Retest-only report type, and zero-finding report type (Synack ships this).
- [x] Text redaction in reports (image redaction exists for evidence; nothing for report text).
- [x] Executive presentation export (PPTX) as AttackForge, PlexTrac and Hexway offer.
- [x] XLSX findings export.
- [x] More template variables and conditions. Currently about 13 `{{...}}` keys and four conditions.
- [x] Larger media budget or external asset storage for templates. Current caps: 2 MB per image, 12 MB layout, 250 blocks.

Methodology and engagement

- [x] Preloaded runbook templates: OWASP WSTG, MASTG, ASVS, PTES, OSSTMM, cloud (AWS/Azure/GCP) checklists, Active Directory, API, thick client, OT. The runbook engine exists; content is empty. This is AttackForge's biggest differentiator and Dradis CE ships OWASP/PTES/OSCP/HIPAA/PCI.
- [x] Kanban view for tasks (list only today).
- [x] Time tracking rollups: per engagement, per consultant, billable vs non-billable, utilisation. Entries exist, no reporting.
- [x] Scheduling: resource calendar, capacity view, recurring engagements (PlexTrac scheduler, Cyver planning).
- [x] Programs: a parent grouping of engagements per client or year, with roll-up analytics.
- [x] Pre-sales: opportunities and statement-of-work templates (Canopy's differentiator). Lower priority.
- [x] SLA policies by severity and client, with due dates derived automatically. `dueAt` is manual today and no SLA exists.

Integrations

- [x] Jira integration: one-way export first, then bi-directional status sync. Follow with Azure DevOps, GitHub Issues, ServiceNow. Webhooks give a generic path meanwhile once fix 1.2 lands.
- [x] Additional scanner importers: Qualys, Acunetix, Invicti/Netsparker, Nexpose/InsightVM, Tenable.io API, SARIF (covers Semgrep, CodeQL, many SAST tools), Trivy, Grype, Prowler, ScoutSuite, BloodHound, Nikto, WPScan, testssl/SSLyze, Metasploit. Also import from PlexTrac, Dradis, Ghostwriter and SysReptor exports for migration. Added SARIF, Trivy, Grype, Nikto, WPScan, testssl, Prowler, ScoutSuite, BloodHound, and generic `findings[]` for PlexTrac, Dradis, Ghostwriter, and SysReptor. Skipped Qualys, Acunetix/Invicti, Nexpose, Tenable.io API, and Metasploit because those formats were ambiguous.
- [x] REST API gaps: finding transitions, report create/transition, templates CRUD. `tasks:write`, `webhooks:manage`, and `notifications:manage` now have routes. List, get, create, and revise (new version). Templates are not hard-deleted.
- [x] MCP tool gaps: template library (list/get/create from template), report create/transition/export, tasks, finding transitions, retest requests, runbook step completion, time entries.
- [x] Slack and Teams native notifications for engagement events (channels exist; wire them).
- [x] SAML 2.0. Only Google, GitHub, Microsoft Entra and one generic OIDC provider exist, all deployment-wide env vars. Add per-organisation SSO configuration and group-to-role mapping. Per-org OIDC/SAML config is stored. ACS rejects unsigned assertions via `@node-saml/node-saml`. Interactive session handoff returns 501. Group-to-role mapping is SCIM.
- [x] SCIM provisioning. No competitor publicly documents SCIM, so this is optional but would be a first.
- [x] Organisation import/restore. A checksummed export exists in "data" and "migration" modes but contains metadata only (no evidence blobs, templates, runbooks, RoE, timeline, risk matrices) and there is no importer. Importer skips evidence binaries.

Client portal

- [x] PDF and DOCX download of shared report versions. Only HTML preview exists.
- [x] Client-side exports: CSV/XLSX of findings, Jira push from the portal.
- [x] Portal analytics: open findings by severity, remediation progress, SLA status, retest outcomes.
- [x] Live chat or threaded discussion per finding (Cyver has live chat). Threaded finding and report comments. No live-chat socket.
- [x] Client-side notifications on publish, retest result, and comment reply (depends on fix 1.2).

Analytics

- [x] Mean time to remediate, SLA compliance, trend lines over time, recurring vulnerability classes across engagements and clients, tester productivity and time-tracking reports, retest pass rates.
- [x] Render charts in the analytics UI (recharts is installed and unused).

Security and compliance

- [x] Retention for findings, reports and engagements (only evidence has retention today).
- [x] Application-level encryption option for evidence at rest and explicit S3 SSE.
- [x] Audit log filter, search, export, and SIEM forwarding.
- [x] Compliance mapping tags on findings and reports (PCI DSS, ISO 27001, SOC 2, NIST CSF, CMMC, DORA, Essential Eight) with a compliance-view report section. HackerOne, Bugcrowd, Cobalt, PlexTrac and Cyver all market this.

### Tier 3: differentiate (where the market has holes)

- [x] Lean into the authenticated read+write MCP server. Only AttackForge matches it; PlexTrac is read-only; SysReptor has an alpha third-party server; Reconmap's is experimental with two tools. Expand the tool catalogue (see integrations above), publish a Skills / `AGENTS.md` pack as AttackForge and SysReptor do, document agent workflows (scanner to draft finding to review), and market it as the primary differentiator.
- [x] Hold the line on the free tier: review workflow with separation of duties, SSO, audit log, multi-organisation tenancy, client portal, retest loop, all under Apache-2.0. SysReptor paywalls collaboration, comments, version history, SSO and permissions and caps community at three users. Dradis CE is single-project. Ghostwriter has no portal or retest. No OSS tool combines all six.
- [x] Self-hosted with local AI (Ollama already supported). PlexTrac AI is cloud-only, AttackForge is cloud. Data-sovereignty and air-gapped buyers care.
- [x] Surface the retest loop (snapshots, comparison, automatic draft revision) in portal analytics and SLA tracking. It is already stronger than Ghostwriter and SysReptor.
- [x] Translation of finding writeups into the client's language via the existing AI service. Only AttackForge agents do this today.
- [x] Screenshot analysis (vision) in AI assist: describe evidence, suggest captions, flag sensitive data before publishing. SysReptor is the only competitor with vision.
- [x] Reporting-as-code: git-friendly Markdown/YAML export and import of findings and templates, plus a CLI (`dingodocs` binary or `pnpm` script) for CI pipelines with severity gates. Emerging Typst/Markdown niche (reptr, pwn2report) with no product owner.
- [x] Scan comparison / diff between imports or engagements (Hexway differentiator, Hexway now appears defunct).
- [x] Attack-chain visualisation from timeline and ATT&CK mappings (AttackForge differentiator).
- [x] Exploit intelligence enrichment: EPSS, KEV, Exploit-DB links on findings (AttackForge agents, Rootshell Velma).
- [x] Multi-language UI and multi-language finding library (PwnDoc, SysReptor, Reconmap, Cervantes). Shell navigation and severity words in en/de/fr/es, plus a German slice of the finding library. The rest of the UI stays English.

---

## Part 3. Current feature inventory (for reference)

Findings

- Fields: identifier, title, severity (info/low/medium/high/critical), riskRating/likelihood/impact (free text), cvssVector + cvssScore (4.0 only), executiveSummary, technicalDetail, reproductionSteps, proofOfConcept, businessImpact, technicalImpact, remediation, verificationGuidance, references[], mappings[], clientOwner, dueAt, retestStatus, clientVisible, provenance, soft delete.
- 13-state workflow (`src/features/findings/workflow.ts`): draft, in_progress, ready_for_review, changes_requested, peer_reviewed, qa_approved, published, remediation_in_progress, ready_for_retest, retested, resolved, risk_accepted, closed. Author cannot peer-review; QA must differ from reviewer; publish requires approved version; override requires reason.
- Versioned finding snapshots with optimistic locking. Finding transitions table plus audit events.
- Finding templates versioned by stableKey, with review states, create-from-template snapshot, compare and update-from-latest. One seeded template.
- Assets M:N (same engagement only). Evidence M:N. Retest evidence.
- Retest attempts: requested/scheduled/in_progress/completed/cancelled; outcomes fixed/partial/not/risk_accepted/unable_to_verify; snapshots original finding and remediation; comparison JSON. Remediation updates append-only. Internal vs client retest notes. Completing a retest versions the finding and drafts a report revision.

Reporting

- Formats: PDF (pdfkit), DOCX (docx), HTML, Markdown, JSON. Three independent renderers.
- Craft.js block canvas with 22 section types: cover, executive_summary, reusable_content, prose, code, image, findings, scope, assets, chart, risk_matrix, evidence, appendix, page_break, table_of_contents, confidentiality, document_control, methodology, severity_ratings, recommendations, glossary, contacts. Presets: blank, professional pentest, OSAI exam.
- Branding on org and template: logos as data URIs, colours, tagline, contacts, preparedBy, whiteLabel, header/footer, watermark, classification, signatures, approval roles.
- Report workflow: draft, internal_review, changes_requested, qa_approved, client_review, approved, published, superseded, archived. Author cannot QA; final approver differs from QA; publish requires completed render; published versions immutable; revisions allowed; optimistic editRevision.
- SHA-256 export checksums per format.
- Evidence image annotation: crop, blur, redaction box, highlight, shapes, text, numbered callouts.
- OSAI exam preparation checklist.

Engagements

- Type, 13 statuses, dates, testing window, objectives/assumptions/constraints/dependencies, classification, tags, health, progress.
- Versioned scope (draft/approved) with typed scope items, environment, criticality, exclusions, approved methods. Assets link to scope items.
- Versioned rules of engagement with per-user acknowledgement.
- Engagement members with roles as the need-to-know ACL.
- Runbook templates with ordered steps applied to engagements; steps link to findings, evidence, tasks.
- Plain-text notes, timeline with phases and commands, tasks, time entries (category, hours, billable).

Collaboration

- Generic comments table with private/team/client visibility. No threads, edits, mentions, or inline report comments.
- No real-time editing; optimistic conflicts only.
- Notification channels and webhook infrastructure complete but unused (fix 1.2).
- Audit page: last 200 events.

Client portal

- Separate route group; invite bound to email; per-engagement grants; multiple clients and contacts.
- Visible: approved scope, published + clientVisible findings, client_visible evidence, client comments, explicitly shared report versions.
- Client actions: comment on findings and reports, submit remediation status with owner and note, upload remediation evidence, request retest, approve a report in client_review.
- Report access: HTML preview only.

Integrations

- Scanner adapters (`src/lib/imports/adapters.ts`): nmap, nessus, openvas, zap (XML + JSON), burp, nuclei (JSON/JSONL), csv, generic json. Preview, fingerprint dedupe, apply as draft findings and assets, raw output kept as internal evidence, journal note and timeline entry. 10k record cap.
- Org JSON export (data and migration modes), metadata only, no importer.
- API keys: `dd_pat_` and `dd_svc_`, SHA-256 hashed, scoped, expiring, revocable.
- REST `/api/v1` with OpenAPI at `/api/openapi`: clients GET; engagements GET/POST; assets/notes/timeline GET/POST; scope GET; evidence POST; imports POST/GET; findings GET/POST/PATCH; findings evidence POST; reports GET, export, preview; tasks GET.
- MCP (17 tools, stdio and HTTP JSON-RPC): list_engagements, get_engagement, list_findings, get_finding, create_finding_write_up, update_finding_write_up, add_testing_note, list_notes, add_timeline_entry, list_timeline, list_assets, create_asset, list_scope, ingest_scanner_results, preview_scanner_import, capture_evidence, attach_evidence_to_finding.
- SSO: Google, GitHub, Microsoft Entra, one generic OIDC, deployment-wide env vars.
- AI: Ollama, OpenAI (Responses API, store false), Anthropic. Gated by `AI_ENABLED`, org enablement, typed confirmation. Prompt hash and `untrusted_draft` output stored. Used only from a free-form prompt box on the Integrations page.

Analytics

- Dashboard: active engagements, reports in review, high-risk findings, overdue tasks, recent items.
- Risk analytics: filters by period, severity, status group, client; totals; severity, workflow, age-band and per-client breakdowns; top 50 findings.

Security

- Roles: platform_administrator, organisation_owner, organisation_administrator, engagement_manager, lead_consultant, consultant, reviewer, client_administrator, client_user, read_only.
- Permissions matrix in `src/lib/permissions/matrix.ts` plus engagement membership ACL.
- Better Auth 1.7.5: password (14+ characters, breach check), magic link, TOTP with backup codes and lockout, passkeys, session listing and revocation, 12h absolute session cap, login attempts, impersonation allowlist.
- Audit events with actor, IP, user agent, request ID, previous/new values.
- Evidence retention dates, legal holds, purge confirmation, nightly cron 02:15. SHA-256 hashing and dedupe. External malware scan via `MALWARE_SCAN_URL` with quarantine.
- AES-256-GCM for integration secrets.

---

## Part 4. Market landscape (2026-10-09)

### Summary table

| Vendor                                     | Pricing                                                                  | Deployment                                    | Edge                                                                                                                                                                                                                                                                                                  | Weakness                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| PlexTrac (acquired by Brinqa, 2026-08-19)  | Quote only. Entry ~$8k/yr, median ~$40k/yr                               | Cloud, private hosted, on-prem; AI cloud-only | 25k+ CVE/CWE/KEV writeup library, Jira + ServiceNow bi-directional, read-only MCP (Mar 2026), runbooks (ATT&CK, Atomic Red Team), scheduler, portal                                                                                                                                                   | Cost, opaque pricing, heavy UX, template limits, cloud-only AI                                          |
| AttackForge                                | Core Pro $50/mo, Team $150, Consultancy $300, SME $800; Enterprise quote | Cloud; Enterprise dedicated infra             | Read+write MCP with Skills and per-user tool gating (Dec 2025), agent swarms and client-language writeups (Aug 2026), CVSS 3.1 + 4.0, preloaded OWASP WSTG/MASTG/OT/CI-CD suites, MITRE ATLAS, attack-chain visualisation, Jira/ServiceNow/Bugcrowd/HackerOne/Synack bi-directional, portal with SLAs | Dated UI, cloud-only, performance at peak                                                               |
| SysReptor                                  | Community free (3 users, source-available licence), Pro ~$65/user/mo     | Docker self-host or Syslifters cloud          | Best UX, Markdown authoring, HTML/CSS/Vue designer, CVSS 3.1 + 4.0, in-app AI agent with BYO or self-hosted LLM, vision, Skills, real-time collab (Pro), LanguageTool                                                                                                                                 | PDF only, paywalls collab/comments/history/SSO/permissions, no portal, no Jira native, licence not OSI  |
| Dradis CE / Pro                            | CE free (GPLv2); Pro Assess $100/user/mo, Remediate $149                 | Self-host only                                | 47+ importers, methodologies (OWASP, PTES, OSCP, HIPAA, PCI), Word/Excel Liquid templates, PR-style QA review, Rules Engine, portal, Jira/ADO/ServiceNow, SSO, Echo AI with on-prem Ollama                                                                                                            | Dated UX, CE single project and HTML/CSV only                                                           |
| Ghostwriter (SpecterOps)                   | Free (BSD-3)                                                             | Docker                                        | Full engagement management, oplogs, C2 auto-logging, DOCX/XLSX/PPTX/JSON via Jinja2, TipTap collaborative editor, CVSS 3.1 + 4.0, GraphQL API, Slack native, SSO via allauth                                                                                                                          | No scanner importers, no Jira, no retest workflow, no comments/tracked changes (top request), no portal |
| PwnDoc                                     | Free (MIT), revived 2026                                                 | Docker                                        | CVSS 3.1 + 4.0, vuln library, real-time collab, review workflow with threaded comments, retest, custom roles, TOTP, encrypted backup/restore, LanguageTool, AI writing + AI QA with OpenAI/Anthropic/DeepSeek/Ollama/Bedrock (1.7)                                                                    | DOCX only, YAML/JSON import only, no SSO, no portal, no audit log, solo maintainer                      |
| Reconmap (Netfoe)                          | OSS (Apache-2.0) + SaaS from £39/mo                                      | Docker, SaaS                                  | Multi-organisation tenancy, audit log, Keycloak SSO (OIDC/SAML/LDAP), Jira + Azure DevOps + webhooks, DOCX/Markdown/Typst, SARIF and CycloneDX import, command scheduling, time tracking, i18n, AI assistant, experimental MCP                                                                        | Small team, stack churn (PHP to .NET), login-after-update bugs                                          |
| Faraday (Infobyte)                         | Community GPL (1 user); Pro ~$670/mo, Corporate ~$1875/mo                | Docker, SaaS                                  | 120+ importers, dedupe pipelines, CWE/OWASP, Jira/GitLab/ServiceNow, FaradAI triage (Jul 2026)                                                                                                                                                                                                        | Vulnerability aggregation, not client deliverable; DOCX dropped                                         |
| Cyver Core                                 | Team €249/mo, Professional €549/mo, Enterprise quote                     | SaaS (Azure EU)                               | Strong portal (findings as tickets, live chat, retest), free LLeMy AI copilot, checklists and compliance norms, timesheets, SAML                                                                                                                                                                      | SaaS only, opinionated, slow feature pace, pricing climbs                                               |
| PentestPad                                 | Professional €49/user/mo, Business €129, Enterprise quote                | Cloud (EU) or self-host/air-gap               | AI assistant with token quotas, autonomous CLI agent, 20+ importers, DOCX/PDF/XLSX, white-label portal with retest                                                                                                                                                                                    | Newer, smaller                                                                                          |
| Canopy (CheckSec)                          | Standard £550/user/yr, Premium £999, Enterprise quote                    | SaaS, self-host historically                  | Pre-sales opportunities and SoW templates, knowledge base, taxonomies, methodologies, Word templates, portal                                                                                                                                                                                          | No AI found                                                                                             |
| Hexway Hive + Apiary                       | Community free; Pentest $78/user/mo                                      | Docker, cloud                                 | DOCX + PPTX, checklists, scan comparison, Jira, Slack, Apiary portal                                                                                                                                                                                                                                  | Site returns 404 (Oct 2026), no releases since 2024                                                     |
| Rootshell Prism                            | Quote                                                                    | SaaS                                          | Consumes reports from any provider, SLA tracking, Velma exploit intel, auto-close remediation, Jira/ServiceNow                                                                                                                                                                                        | Not an authoring tool                                                                                   |
| Pentest-Tools.com                          | $95-190/mo                                                               | SaaS                                          | Scanner-first with DOCX/PDF/HTML/Google Doc reports, auto exec summary                                                                                                                                                                                                                                | Reporting is bolt-on, no portal                                                                         |
| Vulnrepo                                   | Free (Apache-2.0)                                                        | Browser, optional backend                     | Client-side encrypted, broad importers (Burp, Nessus, Nmap, OpenVAS, Trivy, Semgrep, SARIF, ZAP, Wiz), CWE/ATT&CK/PCI templates, ASVS/PCI checklists, Ollama                                                                                                                                          | Solo-user, no collab/SSO/portal                                                                         |
| Cervantes (OWASP)                          | Free (AGPL)                                                              | Docker                                        | Clients/projects/vulns, checklists, Jira, dashboards, i18n                                                                                                                                                                                                                                            | Smaller community                                                                                       |
| APTRS                                      | Free (MIT)                                                               | Docker                                        | PDF/DOCX/Excel from DOCX or HTML templates, retest, schedules, customer portal                                                                                                                                                                                                                        | Smaller community                                                                                       |
| WriteHat, PeTeReport, PwnDoc-ng, Serpico   | Free                                                                     | Docker                                        | Historic Markdown/LaTeX/DOCX approaches                                                                                                                                                                                                                                                               | Dormant or dead                                                                                         |
| PTaaS: Cobalt, Synack, HackerOne, Bugcrowd | Credit/quote                                                             | SaaS                                          | Attestation letters (Cobalt), AI exec summaries and asset-scoped/zero-finding reports (Synack, Sep 2026), compliance-mapped reports (SOC 2, ISO, PCI, GDPR, DORA, NIST), bi-directional Jira/ServiceNow, retest SLAs                                                                                  | Not self-hostable authoring tools                                                                       |

### Table stakes vs differentiators

Table stakes (nearly every live product): finding template library; CVSS 3.1 calculator; DOCX templating (SysReptor PDF-only is the outlier); PDF output; Nessus/Burp/Nmap/Qualys/OpenVAS/ZAP import; Jira export; white-label; comments and review workflow; RBAC and MFA; REST API; Docker deployment; basic dashboards; retest tracking; client portal (all commercial except SysReptor, Vulnrepo, Pentest-Tools); SSO in paid tier.

Emerging table stakes (2025-2026): CVSS 4.0; AI drafting of finding and remediation text; AI executive summary; ServiceNow bi-directional sync; Markdown authoring.

Differentiators (few or one vendor): MCP server (AttackForge read+write, PlexTrac read-only, SysReptor in-app agent); translation to client language (AttackForge); screenshot vision in AI (SysReptor); preloaded methodology suites (AttackForge, Dradis); attack-chain visualisation (AttackForge); pre-sales/SoW (Canopy); timesheets and scheduling (Cyver, PlexTrac, Reconmap); exploit intel and auto-close (Rootshell); scan comparison and PPTX (Hexway); real-time Google-Docs-style editing (SysReptor, PlexTrac, Ghostwriter, PwnDoc); self-host with local LLM (Dradis, SysReptor, Vulnrepo, PentestPad, PwnDoc); attestation letters (Cobalt, Bugcrowd, HackerOne); asset-scoped and zero-finding reports (Synack); multi-organisation tenancy (Reconmap); SCIM (nobody verified); one-source PDF + DOCX + Markdown (APTRS, reptr only).

Common complaints across the market: PlexTrac cost and heaviness; dated UX (AttackForge, Dradis); PDF-only (SysReptor) or DOCX-only (PwnDoc); Jinja2/DOCX template learning curve (Ghostwriter, PwnDoc); source-available licence and paywalled collaboration (SysReptor); crippled community editions (Dradis CE, Faraday); cloud-only data residency (PlexTrac, AttackForge Core, Cyver); stale release cadence (Hexway); importer gaps (PwnDoc, Ghostwriter); solo-maintainer risk (PwnDoc, Reconmap); updates breaking login (Reconmap).

### Where DingoDocs can win

No open-source tool combines broad scanner importers, a review workflow with separation of duties, SSO, an audit log, multi-organisation tenancy, a client portal with a retest loop, and an authenticated read+write MCP server in a free tier under an OSI licence. DingoDocs already has the skeleton of all of these. The gap is wiring and polish (Part 1 and Tier 1), then report output quality (Tier 2 reporting), then methodology content and integrations (Tier 2), with MCP, local AI and reporting-as-code as the marketing edge (Tier 3).

### Caveats

- SysReptor community 3-user cap sourced from a Dradis comparison page and Pro badges in SysReptor docs; pricing page is JavaScript-rendered.
- Cyver pricing from search snippets; site blocks automated fetch.
- PlexTrac CVSS 4.0 and any vendor's SCIM support unverified.
- AttackForge self-host unconfirmed (Enterprise "dedicated infrastructure").
- Reddit sentiment not fetched directly; sentiment comes from GitHub issues, vendor comparison pages (biased), Help Net Security and practitioner blogs.
- Hexway status inferred from sitewide 404 and absence of 2025-2026 release notes.

### Sources

Commercial: plextrac.com/pricing; plextrac.com/introducing-plextrac-enabled-mcp/; helpnetsecurity.com/2026/08/19/brinqa-plextrac-acqisition; attackforge.com/pricing; support.attackforge.com/release-notes/2025; support.attackforge.com/attackforge-enterprise/modules/ai-mcp-and-skills; blog.attackforge.com/blog/august-2026; core.cyver.io/pricing/; core.cyver.io/feature-highlight-introducing-our-genai-copilot-llemy/; rootshellsecurity.net/platform/; g2.com/products/hexway-hive/pricing; sysreptor.com/pricing; docs.sysreptor.com/reporting/ai-agent; pentest-tools.com/pricing; checksec.com/pricing.html; docs.checksec.com/canopy/3.10/user_guide/key_concepts.html; dradis.com/pro/; dradis.com/compare/pentest-report-generator-roundup.html; pentestpad.com/pricing; pentestpad.com/blog/best-pentest-reporting-tools-2026; selecthub.com/p/vulnerability-management-software/plextrac/; cobalt.io/platform/ptaas; synack.com/blog/executive-ready-pentest-reporting/; hackerone.com/product/pentest; bugcrowd.com/products/pen-test-as-a-service/; faradaysec.com.

Open source: github.com/Syslifters/sysreptor; github.com/GhostManager/Ghostwriter; docs.specterops.io/ghostwriter-docs/home.md; github.com/dradis/dradis-ce; github.com/infobyte/faraday; docs.faradaysec.com; github.com/pwndoc/pwndoc; github.com/pwndoc-ng/pwndoc-ng; github.com/reconmap/reconmap; github.com/BuffaloWill/Serpico; github.com/blacklanternsecurity/writehat; github.com/1modm/petereport; gitlab.com/invuls/pentest-projects/pcf; github.com/kac89/vulnrepo; github.com/CervantesSec/cervantes; github.com/APTRS/APTRS; github.com/vral-parmar/reptr; github.com/slvnlrt/reptor-mcp; github.com/walidfaour/pwndoc-mcp-server; logos-red.com/blog/ghostwriter-vs-sysreptor/; dradis.com/compare/dradis-vs-sysreptor.html; dradis.com/compare/dradis-vs-pwndoc.html; helpnetsecurity.com/2025/02/12/sysreptor-open-source-penetration-testing-reporting-platform/.
