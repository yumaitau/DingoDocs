# Contributing

Contributions must preserve tenant isolation, server-side authorisation, auditability, and accessible keyboard operation. Start with an issue for large domain or schema changes. Use focused commits, add database migrations for schema changes, and include real PostgreSQL coverage for security boundaries.

Before submitting a change, run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`. UI changes should be checked at mobile and desktop widths with keyboard-only navigation and reduced motion enabled.
