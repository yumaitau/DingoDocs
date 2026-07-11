# Security model

The practical baseline is OWASP ASVS Level 2 with additional controls for sensitive assessment evidence and multi-tenant operation.

## Primary threats and controls

| Threat                    | Principal controls                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Cross-organisation access | Server-derived tenant context, organisation key on owned tables, scoped repositories, membership revalidation, integration tests |
| Identifier enumeration    | UUID identifiers, tenant predicates, uniform not-found behaviour                                                                 |
| Session theft             | HTTP-only secure cookies, SameSite, finite expiry, revocation records, MFA support                                               |
| Stored XSS                | React output encoding, structured rich-text rendering, restrictive CSP, server-side validation                                   |
| Evidence leakage          | Private storage, opaque keys, signed short-lived S3 URLs, server-authorised downloads, download audit events                     |
| Malicious uploads         | Size and type allowlists, filename normalisation, SHA-256 hashing, malware-scan state, quarantine-ready jobs                     |
| Workflow bypass           | Explicit transition graph, permission checks, reasoned override, append-only transition and audit records                        |
| Secret disclosure         | Server-only provider credentials, redacted audit metadata, no browser storage tokens, no sensitive content in email              |
| Job replay or duplication | Idempotency keys, transactional claiming, retry/backoff, dead-letter state                                                       |

## Operational requirements

Use TLS, a high-entropy Better Auth secret, encrypted disks, isolated networks, regular backups, dependency scanning, and a supported PostgreSQL release. Configure an SMTP provider before production and ensure notification templates contain links and metadata only, never finding or evidence content.

AI is disabled by default. Enabling an external provider is an explicit organisation decision and generated content remains an untrusted draft requiring human confirmation.

See [SECURITY.md](../SECURITY.md) for vulnerability reporting.
