# Threat model

Protected assets are account credentials, OAuth tokens, sessions, client identities, engagement scope, evidence blobs, findings, report drafts/exports, audit records, encryption material, and backups. Trust boundaries exist at the browser, reverse proxy, Next.js server, PostgreSQL, object store, SMTP/identity providers, worker jobs, administrator operations, and backup media.

Primary adversaries include an unauthenticated internet attacker, malicious or compromised tenant user, cross-tenant user, stolen-session holder, compromised provider, malicious upload author, privileged operator, and supply-chain attacker.

| Scenario            | Controls                                                                                                       | Residual/operational requirement                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Credential stuffing | per-route throttling, hashed attempt identifiers, 15-minute lockout, MFA/passkeys, breached-password rejection | alert on lockouts and provider anomalies                             |
| Session theft       | HTTP-only Secure SameSite cookies, eight-hour expiry, device and admin revocation, password-reset revocation   | TLS and secure endpoints are mandatory                               |
| Cross-tenant access | server-derived organisation context, RBAC, tenant predicates, integration tests                                | review every new query and export                                    |
| OAuth takeover      | exact issuer validation, PKCE, encrypted provider tokens, verified local email before linking                  | restrict callback URLs and rotate secrets                            |
| Evidence disclosure | private opaque storage, classification/restrictions, audited access, retention/legal holds                     | storage IAM and backup encryption                                    |
| XSS/CSRF            | React encoding, CSP, origin checks, SameSite cookies, validated Server Actions                                 | remove inline CSP allowances when framework nonce support is adopted |
| Job/data leakage    | payload-free structured logs/metrics, redaction, typed handlers, idempotency                                   | restrict observability access                                        |
| Supply chain        | locked dependencies, audit, secret scan, SBOM, container scan, pinned CI actions                               | review dependency updates                                            |

Revisit this model for every new integration, storage provider, authentication method, public route, or data export.
