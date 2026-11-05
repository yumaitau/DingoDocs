# Deployment and operations

## Docker Compose

Create `.env` from `.env.example`, replace `BETTER_AUTH_SECRET` with at least 32 random bytes, configure the public application URL, and run `docker compose up -d`. PostgreSQL must become healthy, then the one-shot migration service applies migrations before the application starts. Mailpit provides local-only SMTP capture. MinIO is opt-in through the `s3` profile.

For production, replace development database and MinIO credentials, terminate TLS at a trusted reverse proxy, restrict service ports to an internal network, and persist PostgreSQL and file-storage volumes on encrypted media. Do not expose ports 5432, 9000, 9001, 1025, or 8025 publicly.

## PostgreSQL roles and row-level security

Tenant isolation uses PostgreSQL row-level security as well as application predicates (see [Security model](security.md#tenant-row-level-security)). Request work switches to the `NOLOGIN` role `dingodocs_tenant`, which is subject to the `tenant_isolation` policies. Migration 0016 creates that role and grants it to the user that runs migrations.

- **Self-hosted or Docker Compose.** No action is needed. The bundled user is a superuser, so the migration creates the role, and a superuser can `SET ROLE` to it, so RLS enforces.
- **Connecting user.** Prefer a non-superuser application user. It must be a member of `dingodocs_tenant`, and it must own the tables or have privileges on them for the owner path. A superuser connection still works, because tenant work switches roles, but code outside a tenant scope then bypasses RLS entirely. Code running as a superuser outside `withTenant` is not protected by RLS.
- **Managed PostgreSQL (RDS, Cloud SQL, Azure, and others) without `CREATEROLE`.** The migration prints `WARNING: dingodocs: cannot create or grant role dingodocs_tenant` and continues. The application logs a `db.tenant_rls.inactive` warning at first use and runs with RLS inactive, relying on application predicates only. To turn RLS on, ask a DBA (a user with `CREATEROLE`, such as `rds_superuser` members) to run the following, substituting the application's connecting user for `dingodocs_app`, then restart the application:

```sql
CREATE ROLE dingodocs_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT dingodocs_tenant TO dingodocs_app;
GRANT USAGE ON SCHEMA public TO dingodocs_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dingodocs_tenant;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dingodocs_tenant;
-- Run as dingodocs_app (the user that runs migrations) so future tables are covered:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dingodocs_tenant;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO dingodocs_tenant;
```

On PostgreSQL 16 and later, make sure the membership allows `SET` (the default for `GRANT ... TO`). The startup check probes `SET ROLE` and logs `db.tenant_rls.inactive` if it is refused. To confirm RLS is active, check that the log line is absent, or run `SELECT pg_has_role(current_user, 'dingodocs_tenant', 'SET');` as the application user (use `'MEMBER'` on PostgreSQL 15 and earlier).

## Backup and restore

Back up the PostgreSQL database and file store as a coordinated set. A database-only backup does not contain evidence or generated reports.

```bash
docker compose exec -T postgres pg_dump -U dingodocs -Fc dingodocs > dingodocs.dump
docker run --rm -v dingodocs_app_storage:/data -v "$PWD":/backup alpine \
  tar -czf /backup/dingodocs-storage.tgz -C /data .
```

Restore into an empty deployment, stop the application, restore PostgreSQL with `pg_restore`, restore the storage volume, then start the migration and application services. Verify `/api/ready`, sample evidence downloads, and published report checksums before reopening access.

## Upgrade

1. Read release notes and back up the database and storage together.
2. Pull the new source or image.
3. Run the migration service against a staging copy and execute tests.
4. Deploy with `docker compose up -d --build`.
5. Confirm migration completion, readiness, authentication, storage access, and background-job health.
6. Keep the prior image available until verification is complete. Database migrations are forward-moving; restore the coordinated backup for rollback when a migration is not backward compatible.

## Health

- `/api/health`: process liveness; does not touch dependencies
- `/api/ready`: PostgreSQL and active storage-provider readiness

Readiness also returns aggregate queued/running/retrying/dead-letter job counts; it never returns payloads or dependency error text. `x-request-id` is accepted or generated at the proxy and forwarded through server work and audit events. OpenTelemetry spans use the `dingodocs` tracer; attach the deployment's SDK/exporter and set `OTEL_EXPORTER_OTLP_ENDPOINT` when collection is required.

Application logs are structured and should be collected by the container platform. Passwords, session tokens, API keys, raw evidence, and report content must never be logged.

Detailed procedures: [backup and restore](backup-restore.md) and [upgrade](upgrade.md).

AWS Marketplace images have a separate compile-time identity, entitlement check, and migration lifecycle. See [AWS Marketplace container distribution](aws-marketplace.md).
