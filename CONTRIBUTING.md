# Contributing

Contributions must preserve tenant isolation, server-side authorisation, auditability, and accessible keyboard operation. Start with an issue for large domain or schema changes. Use focused commits, add database migrations for schema changes, and include real PostgreSQL coverage for security boundaries.

Before submitting a change, run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`. UI changes should be checked at mobile and desktop widths with keyboard-only navigation and reduced motion enabled.

Never commit credentials, `.env` files, production samples, or generated evidence/report artifacts. Authentication and provider configuration stays server-only. Logs, spans, fixtures, screenshots, and test failures must use synthetic data and pass the shared redaction rules. Update the threat model and data-flow document when adding a trust boundary.

Generate migrations with `pnpm db:generate`, inspect the SQL for destructive changes, and prove it can apply to both an empty database and the previous released schema. Do not edit an already released migration. Pull requests must leave dependency audit, secret scanning, SBOM generation, container scanning, and Playwright CI green.
