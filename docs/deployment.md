# Deployment and operations

## Docker Compose

Create `.env` from `.env.example`, replace `BETTER_AUTH_SECRET` with at least 32 random bytes, configure the public application URL, and run `docker compose up -d`. PostgreSQL must become healthy, then the one-shot migration service applies migrations before the application starts. Mailpit provides local-only SMTP capture. MinIO is opt-in through the `s3` profile.

For production, replace development database and MinIO credentials, terminate TLS at a trusted reverse proxy, restrict service ports to an internal network, and persist PostgreSQL and file-storage volumes on encrypted media. Do not expose ports 5432, 9000, 9001, 1025, or 8025 publicly.

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
