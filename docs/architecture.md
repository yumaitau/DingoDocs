# Architecture

DingoDocs is a Next.js 16 App Router monolith. React Server Components render protected data by default; Client Components are limited to browser interactions such as the command palette and responsive navigation. Server Actions handle first-party mutations, Route Handlers expose versioned integration APIs, and services/repositories hold business and persistence logic.

## Boundaries

- `src/app`: routes, layouts, Route Handlers, and thin request composition
- `src/features`: domain workflow rules independent of React
- `src/server/actions`: validated first-party mutations
- `src/server/services`: multi-step domain orchestration
- `src/server/repositories`: tenant-aware persistence access
- `src/db/schema`: domain-separated Drizzle schemas
- `src/lib/auth`: Better Auth and session resolution
- `src/lib/permissions`: RBAC matrix and authoritative server checks
- `src/lib/storage`: local and S3-compatible storage providers
- `src/lib/jobs`: PostgreSQL-backed job claiming, retries, and dead-letter state
- `src/lib/audit`: redacted audit event recording
- `src/mcp`: shared MCP tool catalog, JSON-RPC protocol, stdio server, and REST client
- `src/lib/reports`: professional pentest template and white-label branding helpers

## MCP and scanner ingest

The REST API under `/api/v1` is the source of truth. The stdio MCP process (`pnpm mcp`) and the HTTP JSON-RPC endpoint (`POST /api/mcp`) are facades: they authenticate a Bearer `dd_pat_` / `dd_svc_` key, then call the same tenant-scoped routes. Scanner ingest (`POST /api/v1/engagements/{id}/imports`) stores the original output as internal evidence, creates draft findings and assets for new fingerprints, and records a testing-journal note plus timeline event. Findings created this way remain `draft` until they complete the existing review and publication workflow.

White-label report rendering merges organisation branding with the template definition. Logo fields accept `data:image/png` or `data:image/jpeg` URIs only; `http(s)` URLs are discarded to prevent SSRF during PDF generation.

## Entity overview

```mermaid
erDiagram
  ORGANISATION ||--o{ ORGANISATION_MEMBER : contains
  USER ||--o{ ORGANISATION_MEMBER : joins
  ORGANISATION ||--o{ CLIENT : owns
  CLIENT ||--o{ CLIENT_CONTACT : has
  CLIENT ||--o{ ENGAGEMENT : commissions
  ENGAGEMENT ||--o{ SCOPE_VERSION : versions
  SCOPE_VERSION ||--o{ SCOPE_ITEM : contains
  ENGAGEMENT ||--o{ ASSET : tracks
  ENGAGEMENT ||--o{ FINDING : produces
  FINDING_TEMPLATE ||--o{ FINDING : snapshots
  FINDING ||--o{ FINDING_VERSION : versions
  FINDING ||--o{ FINDING_TRANSITION : transitions
  FINDING ||--o{ REMEDIATION_UPDATE : records
  FINDING ||--o{ RETEST_ATTEMPT : verifies
  RETEST_ATTEMPT ||--o{ RETEST_NOTE : documents
  RETEST_ATTEMPT }o--o{ EVIDENCE : supports
  ENGAGEMENT ||--o{ EVIDENCE : preserves
  EVIDENCE }o--o{ FINDING : supports
  ENGAGEMENT ||--o{ REPORT : generates
  REPORT ||--o{ REPORT_VERSION : publishes
  ENGAGEMENT ||--o{ TASK : coordinates
  ORGANISATION ||--o{ AUDIT_EVENT : records
```

## Authentication

Better Auth owns users, credential and OAuth accounts, sessions, verification tokens, and TOTP records through its Drizzle adapter. Session tokens are secure HTTP-only cookies. The route proxy is only a fast redirect path; protected layouts, Server Actions, and Route Handlers resolve the session again on the server. Authentication tables remain separate from the engagement domain while foreign keys preserve attribution.

Email/password, magic-link, TOTP, session revocation data, and OAuth proxy foundations are configured. Social and OIDC providers are enabled only when their server-side environment credentials are configured.

## Authorisation and multi-tenancy

Every organisation-owned table contains `organisation_id`. An active-organisation cookie is a hint, never authority. `resolveActiveOrganisation` checks that hint against current membership and falls back only to another valid membership. Server operations call `requirePermission`; repository lookups accept a server-derived tenant scope and combine it with record identifiers.

Client-provided organisation identifiers are not accepted as authority. Cross-client and cross-engagement access is further constrained through membership, classification, publication state, and evidence visibility in the relevant services.

Client roles have a separate `/portal` route group and cannot render the internal application layout. Portal services derive access through the current user, client contact, and engagement-contact grant in one tenant-scoped join. Findings require both a publication timestamp and explicit client visibility; report visibility is version-specific. Approved scope, client-visible evidence and comments, and client-visible retest notes are selected independently, so internal notes and QA content are never loaded and then filtered in the browser. The same role boundary rejects browser sessions and client-owned keys at organisation-wide REST endpoints.

Remediation updates and retest requests are append-only. A retest request snapshots the original finding and remediation state, while completion creates a new finding version and, when a published report exists, a new draft report revision. Original report versions remain immutable.

## Background work

The application starts the job runner only from `instrumentation.ts` in the Node.js runtime. PostgreSQL rows are claimed with `FOR UPDATE SKIP LOCKED`. Failed jobs use exponential backoff and reach `dead_letter` after their configured attempt limit. Report rendering, large imports, evidence processing, notification delivery, and retention work register handlers against this mechanism.
