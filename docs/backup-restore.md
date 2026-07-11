# Backup and restore runbook

Treat PostgreSQL and object storage as one recovery set. Pause application writes or use storage/database snapshots with a shared recovery timestamp. Encrypt backups, restrict their service account, record checksums, copy them off-host, and test restoration on a schedule matching the organisation recovery objectives.

## Backup

1. Record the release/image digest and migration number.
2. Run `pg_dump -Fc` against PostgreSQL.
3. snapshot or archive the local/S3-compatible object store, preserving object keys and metadata.
4. hash both artifacts, store them together, and record the operation outside the backed-up system.

## Restore

1. Isolate an empty environment with the recorded application release.
2. Restore PostgreSQL using `pg_restore --clean --if-exists`, then restore the matching object set.
3. Apply only migrations newer than the restored schema.
4. start one application instance and verify `/api/ready`, authentication, organisation isolation, sampled evidence SHA-256 values, generated-report checksums, and background jobs.
5. rotate credentials used during recovery and document the test or incident.

Never restore a database and object snapshot from different recovery points without a documented reconciliation; doing so can orphan or misassociate sensitive evidence.

## Organisation migration export

An organisation owner can download a checksummed migration export from **Imports & Exports**. It contains the organisation, member mappings, clients, engagements, approved and draft domain records, finding templates and provenance, findings, assets, scope versions/items, evidence metadata, report versions, notes, tasks, audit events, and time entries. It deliberately excludes passwords, sessions, API/webhook secrets, encrypted provider credentials, and evidence/report binary objects.

Treat the JSON export and the matching private object-storage archive as one encrypted migration set. Verify the response `x-content-sha256` checksum, transfer both artifacts, and retain the source release/migration number. A migration restore must validate every referenced user and object checksum in an isolated environment before cutover. The PostgreSQL integration suite asserts the export domains, migration-only superset, checksum, tenant boundary, and absence of storage locators; the operational `pg_dump` plus object snapshot remains the authoritative full-disaster-recovery backup.
