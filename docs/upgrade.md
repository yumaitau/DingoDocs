# Upgrade runbook

Read release notes and migration SQL, confirm supported Node/PostgreSQL versions, and create a coordinated database/storage backup. Rehearse the upgrade on a restored staging copy and run migrations, seed idempotency checks, unit/integration tests, a production build, browser tests, and a representative report export.

For deployment, drain writes, run the one-shot migration service once, deploy the pinned image digest, then verify liveness, readiness/job counts, sign-in and MFA, tenant boundaries, evidence access, report checksums, SMTP, and configured identity providers. Watch structured logs and dead-letter jobs through the observation window.

Application images can roll back only while the migrated schema remains backward compatible. Otherwise stop the service and restore the coordinated backup. Never reverse migration SQL against production data without a separately reviewed recovery plan.
