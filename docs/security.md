# Security model

The practical baseline is OWASP ASVS Level 2 with additional controls for sensitive assessment evidence and multi-tenant operation.

## Primary threats and controls

| Threat                    | Principal controls                                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cross-organisation access | Server-derived tenant context, organisation key on owned tables, scoped repositories, membership revalidation, integration tests                                                                                                                 |
| Cross-engagement access   | Need-to-know ACL: only organisation owners/admins see every engagement; other roles require an engagement membership. Lists, search, evidence, reports, and writes use that membership. Engagement assignment is the ACL, not a privilege add-on |
| Invitation privilege      | Invites cannot grant a more privileged role than the inviter. Accepting an invite cannot overwrite an active membership                                                                                                                          |
| Identifier enumeration    | UUID identifiers, tenant predicates, uniform not-found behaviour                                                                                                                                                                                 |
| Session theft             | HTTP-only secure cookies, SameSite, finite expiry, revocation records, MFA support                                                                                                                                                               |
| Stored XSS                | React output encoding, restrictive CSP, server-side validation                                                                                                                                                                                   |
| Evidence leakage          | Private storage, opaque keys, signed short-lived S3 URLs, server-authorised downloads, download audit events                                                                                                                                     |
| Malicious uploads         | Size and type allowlists, filename normalisation, SHA-256 hashing, malware-scan state, quarantine-ready jobs                                                                                                                                     |
| Workflow bypass           | Explicit transition graph, permission checks, reasoned override, append-only transition and audit records                                                                                                                                        |
| Client portal leakage     | Separate role-gated routes, named engagement grants, explicit publication flags, server-side field selection, uniform 404 tests                                                                                                                  |
| Secret disclosure         | Server-only provider credentials, redacted audit metadata, no browser storage tokens, no sensitive content in email                                                                                                                              |
| Job replay or duplication | Idempotency keys, transactional claiming, retry/backoff, dead-letter state                                                                                                                                                                       |

## Operational requirements

Use TLS, a high-entropy Better Auth secret, encrypted disks, isolated networks, regular backups, dependency scanning, and a supported PostgreSQL release. Configure an SMTP provider before production and ensure notification templates contain links and metadata only, never finding or evidence content.

AI is disabled by default. Enabling an external provider is an explicit organisation decision and generated content remains an untrusted draft requiring human confirmation.

Client roles are intentionally excluded from organisation-wide REST reads, report preview/export handlers, and the internal application shell. Client-owned API keys receive `client_portal_required`; service credentials remain organisation-scoped integrations and are treated as organisation-wide for engagement ACL. Personal API keys inherit the owner's need-to-know membership. Client evidence preview/download is the exception and reuses the evidence service's client/contact, engagement, classification, restriction, quarantine, and tenant checks.

Better Auth's admin plugin defaults every new user to `role=user`. Break-glass impersonation and admin APIs are limited to user ids in `BETTER_AUTH_ADMIN_USER_IDS`. Banned or `disabledAt` users lose their session on the next request.

## SCIM provisioning and verified domains

A SCIM token lets an organisation's identity provider manage that organisation's memberships. User accounts are global, so SCIM may only create or attach users whose email domain the organisation has proven it controls.

1. In **Settings → SCIM 2.0 → Verified domains**, add the email domain (for example `example.com`). Domains are lowercased, a trailing dot is ignored, and single labels, public suffixes such as `com.au`, and shared mailbox providers (Gmail, Outlook, Hotmail, Yahoo, iCloud, Proton and similar) are rejected.
2. Create the DNS TXT record shown next to the domain:
   - Name: `_dingodocs-verification.<domain>`
   - Value: `dingodocs-domain-verification=<token>`
3. Select **Verify**. DingoDocs looks up the TXT record and marks the domain verified when the value matches. A domain can be verified by only one organisation at a time; another organisation must remove it first.

Matching is exact: `sub.example.com` needs its own verification. Adding, verifying and removing a domain are recorded in the audit log (`scim.domain.added`, `scim.domain.verified`, `scim.domain.removed`). The TXT record can be deleted after verification; removing the domain in DingoDocs stops further provisioning on it.

`POST /api/scim/v2/Users` behaviour:

- Email domain not verified for the organisation: `403`, `scimType: invalidValue`. No user or membership is created.
- New address on a verified domain: a user is created with the IdP-asserted address treated as verified, plus a `read_only` membership.
- Existing verified account on a verified domain: a membership is attached, even when the person belongs to other organisations. Global name and disabled state are never changed by SCIM.
- Existing account whose email is not verified: `409`, `scimType: uniqueness`. The account must be verified or removed first, so a pre-registered look-alike account can't be adopted and elevated through group pushes.

**Upgrading existing SCIM setups:** creates now fail with `403` until the organisation verifies its domains. Users already provisioned keep working: `GET`, `PATCH` and `DELETE` on existing members, and Group pushes, do not require a verified domain. Verify domains before the IdP's next create or re-POST cycle.

See [SECURITY.md](../SECURITY.md) for vulnerability reporting.
