<p align="center">
  <img src="docs/assets/dingodocs-banner.png" alt="DingoDocs penetration testing engagement tracker" width="100%">
</p>

# DingoDocs

DingoDocs is an open source, self-hosted penetration testing engagement and reporting platform. It keeps scope, assets, evidence, findings, review, reporting, client remediation, and retesting inside one auditable organisation boundary.

The current implementation establishes the production foundation and core engagement workspace: Next.js 16, Better Auth, PostgreSQL through Drizzle, organisation-aware RBAC, tenant-scoped repositories, append-only audit events, local/S3-compatible storage, background jobs, a responsive application shell, and working client and engagement creation flows.

## Quick start

Requirements: Node.js 20 or newer, pnpm 10, and Docker.

```bash
cp .env.example .env
docker compose up -d postgres mailpit
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://localhost:3000` and sign in with the seeded local account:

- Email: `admin@dingodocs.local`
- Password: `DingoDocs-Demo-2026!`

Change or remove demo credentials before using any non-development deployment. Mailpit is available at `http://localhost:8025`.

For a production-style local deployment, set a strong `BETTER_AUTH_SECRET` and run:

```bash
docker compose up -d
```

The Compose migration service applies PostgreSQL migrations before the application starts. MinIO is optional and starts with `docker compose --profile s3 up -d`.

## Commands

```text
pnpm dev             Start the development server
pnpm build           Create a production build
pnpm lint            Run ESLint
pnpm typecheck       Run strict TypeScript checks
pnpm test            Run unit and configured integration tests
pnpm test:e2e        Run Playwright tests
pnpm db:generate     Generate a Drizzle migration
pnpm db:migrate      Apply migrations
pnpm db:seed         Load local demonstration data
pnpm db:studio       Open Drizzle Studio
pnpm docker:up       Start Compose services
pnpm docker:down     Stop Compose services
```

## Architecture

Domain schema is split under `src/db/schema`. Protected operations resolve the authenticated user and revalidate active organisation membership on the server. Repositories require a tenant scope and include `organisation_id` in record lookups. UI visibility is never treated as authorisation.

See [Architecture](docs/architecture.md), [Deployment](docs/deployment.md), [Administrator guide](docs/admin-guide.md), [User guide](docs/user-guide.md), [Client portal guide](docs/client-portal-guide.md), [Backup/restore](docs/backup-restore.md), [Upgrade](docs/upgrade.md), [Threat model](docs/threat-model.md), [Data flow](docs/data-flow.md), [Security model](docs/security.md), and [API](docs/api.md).

## Project status

DingoDocs is under active development. The engagement workspace, secure evidence lifecycle, formal finding workflow, report rendering, authentication hardening, retention operations, audit model, and local/S3-compatible storage are implemented. Scanner adapters and expanded client remediation/retesting experiences remain subsequent delivery phases.

## Licence

Apache License 2.0. No telemetry, licence keys, proprietary cloud dependency, or paid feature gating is included.
