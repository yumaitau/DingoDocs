# Administrator guide

Organisation owners and administrators use **Security and operations** to invite members, choose least-privilege roles, force logout, place or release evidence legal holds, preview retention, and confirm destruction. Platform and organisation permissions are enforced on the server; hiding a control is never an authorisation boundary.

Configure identity providers only through server environment variables. Google and GitHub use their client ID and secret pairs. Microsoft Entra also requires a tenant ID. Generic OpenID Connect requires an HTTPS discovery URL, exact issuer, client credentials, and optional scopes. A provider is disabled when its complete configuration is absent. Secrets must be injected by the deployment secret manager, rotated after suspected exposure, and never use `NEXT_PUBLIC_` names.

Invitations expire after 72 hours, store only a SHA-256 token hash, are bound to the invited email, and become unusable after acceptance or revocation. Use the audit page to review authentication failures, MFA changes, invitation lifecycle, session revocation, legal holds, and destruction.

Retention previews exclude held data. Manual purge requires the displayed `PURGE n` confirmation. Daily scheduled processing runs at 02:15 in `CRON_TIMEZONE`; destroyed blobs are removed while non-sensitive metadata and audit events remain. Review dead-letter jobs through readiness/central monitoring before retrying operational work.

Before production, remove the demo account, enforce email verification, configure SMTP and TLS, verify provider callback URLs, test backup/restore, and alert on repeated lockouts, dead-letter jobs, or readiness failures.
