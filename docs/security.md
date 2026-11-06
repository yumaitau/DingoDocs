# Security model

The practical baseline is OWASP ASVS Level 2 with additional controls for sensitive assessment evidence and multi-tenant operation.

## Primary threats and controls

| Threat                    | Principal controls                                                                                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cross-organisation access | Server-derived tenant context, organisation key on owned tables, scoped repositories, membership revalidation, PostgreSQL row-level security on tenant content tables (see below), integration tests                                             |
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

`SIGN_UP_MODE` controls who can create their own account: `open` (default) lets anyone sign up, `invite` accepts only an email with a pending organisation invitation, and `closed` refuses all self-service accounts. The check runs when the user record is created, so it covers email sign-up, magic links and OAuth callbacks alike. SAML JIT (gated by verified domains) and admin-created users are not affected. Any other value stops the app at start-up.

## Tenant row-level security

Every query already carries an explicit `organisation_id` predicate. PostgreSQL row-level security (RLS) is a second, independent layer that catches a missing predicate.

- **Policies.** Migrations 0014 and 0016 enable RLS and a `tenant_isolation` policy on 59 tenant content tables (clients, engagements, findings, evidence, reports and their child tables, collaboration, runbooks, imports, and integration configuration). The policy allows a row only when `organisation_id` equals the transaction-local setting `app.organisation_id`, for reads (`USING`) and for writes (`WITH CHECK`). An unset setting matches nothing.
- **Tables without RLS.** Auth, membership and system tables are read before an organisation is known, or across tenants by design, so they have no policy: `users`, `accounts`, `sessions`, `verification_tokens`, `two_factor`, `passkeys`, `login_attempts`, `organisations`, `organisation_members`, `organisation_invitations`, `api_keys`, `service_accounts`, `scim_tokens`, `audit_events` and `background_jobs`. The migration records the reason for each.
- **Tenant role.** Table owners and superusers bypass RLS. Migration 0016 therefore creates a `NOLOGIN NOSUPERUSER NOBYPASSRLS` role, `dingodocs_tenant`, grants it to the migrating user, and gives it table privileges. Request work runs in `withTenant(organisationId, fn)` (`src/db/tenant.ts`). This opens a transaction, switches to `dingodocs_tenant` with `SET LOCAL ROLE`, and sets `app.organisation_id`. Both revert at commit, so pooled connections never carry tenant state. A superuser can still `SET ROLE` to the tenant role, and RLS then applies. This is why it enforces under the Docker Compose superuser, and the integration test checks that case.
- **Owner path.** RLS is not `FORCE`d. Code outside a tenant scope runs as the connecting user and sees every row: migrations, the background job runner, authentication, SCIM token lookup and retention. That is the trusted system path. RLS only enforces when the connecting user is neither a superuser nor the owner, or when work runs inside `withTenant`.
- **Global `db` proxy.** `db` from `@/db` resolves to the tenant transaction while a scope is active (AsyncLocalStorage), so existing services are scoped without code changes. A nested `db.transaction()` becomes a savepoint. A scope for a different organisation cannot be nested inside another. Deferred work started inside a scope (a timer, `after()` or an un-awaited promise) that touches `db` after the scope ends throws `TenantScopeEndedError` instead of falling back to the unrestricted owner connection. Such work must open a fresh `withTenant(organisationId, ...)`, or call `withSystemDb` explicitly, and only for tables without RLS.
- **Scoped surfaces.** All `/api/v1` handlers run their authorised work inside a tenant scope, as do the client portal and SCIM routes, `/api/search`, `/api/notifications`, organisation and audit exports, the repository layer in `src/server/repositories/tenant.ts`, and the evidence, import, webhook and notification-channel services. Storage reads and writes, DNS checks for outbound URLs, and report rendering run outside the transaction. Webhook, notification, malware-scan and report-generation delivery are background jobs. App pages and server actions that do not go through the repository layer are not yet scoped and rely on application predicates. Use `runInOrganisation(context, fn)` from `@/lib/permissions/require` when adding scoping to them.
- **Managed PostgreSQL.** When the migrating user lacks `CREATEROLE`, the migration logs a warning and continues. The app detects at startup that it cannot assume the role, logs `db.tenant_rls.inactive` once, and keeps working with only the GUC set, so RLS stays inactive. Have a DBA create the role (see [Deployment](deployment.md#postgresql-roles-and-row-level-security)).

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

## Per-organisation SAML SSO

SAML sign-in is a first-party Better Auth plugin (`src/lib/auth/saml-plugin.ts`) with endpoints under `/api/auth/sso/saml/<organisation-slug>/` (`login`, `acs`, `metadata`). Setup steps are in the [administrator guide](admin-guide.md#saml-single-sign-on).

Response validation (`@node-saml/node-saml`):

- The organisation is taken from the ACS path slug, never from RelayState. RelayState only carries an HMAC-signed, organisation-bound, expiring internal callback path.
- The assertion must be signed by a certificate configured for that organisation, its Issuer must equal the configured IdP entity ID, and its Audience must equal the organisation's SP entity ID (`…/sso/saml/<slug>/metadata`). An assertion minted for another organisation or another service provider fails.
- Clock skew tolerance is 60 seconds. node-saml skips timestamps that are absent, so after its validation the ACS re-checks the signed assertion itself (from node-saml's verified assertion XML, never the raw response, to resist signature wrapping): `IssueInstant` must be within 5 minutes, `Conditions` `NotBefore`/`NotOnOrAfter` must hold when present, and there must be a bearer `SubjectConfirmationData` with a future `NotOnOrAfter`, a `Recipient` equal to the organisation's ACS URL and, when the response has an `InResponseTo`, the same `InResponseTo`.
- SP-initiated only by default (`InResponseTo` is required). AuthnRequest IDs are stored in `verification_tokens` (not process memory, so all replicas share them) for 10 minutes and consumed atomically on first use. The ID is also bound to the starting browser by a signed, `SameSite=None`, ACS-path-scoped cookie, so a response captured by one person can't sign in another browser (login CSRF).
- Every assertion ID is recorded in `verification_tokens` until `max(NotOnOrAfter values, IssueInstant + 5 minutes) + 60 seconds`, which is the last moment the assertion could pass the checks above. An assertion whose deadline has already passed is rejected before anything is stored. The reservation is insert-if-absent and never replaces an existing row, expired or not, so a second use is always rejected, including for IdP-initiated responses. Expired rows are removed by Better Auth's verification cleanup, and only after the assertion they record can no longer validate.
- The ACS is a cross-site POST from the IdP, so Better Auth's origin check is skipped for the `/sso/saml` prefix only (the only POST under it is the ACS). The assertion signature, audience and single-use `InResponseTo` are the protection there. `/sso/discover` keeps the normal origin check.

Identity resolution is scoped to the organisation:

- The email comes from the configured attribute (default `email`) or an email-shaped NameID, lowercased. Its domain must be DNS-verified by this organisation. Sessions are not tenant-scoped, so without domain proof one organisation's IdP could assert the address of a guest member and get that person's session for their other organisations.
- An active member of this organisation is signed in. With JIT provisioning on, a new user (email verified, because the domain is proven) or a membership for an existing verified user is created, with the role from the group mapping (`read_only` default; owner and platform administrator are never granted, using the SCIM rules). Unverified look-alike accounts are never adopted. Users who are an owner or platform administrator in any organisation cannot sign in through SAML; they use their local credential, because organisation administrators control the IdP configuration.
- Each IdP subject is linked as an `accounts` row with `providerId = saml:<organisationId>` and `accountId = NameID`. A NameID already linked to a different user is rejected.
- Disabled or banned users, deactivated memberships and memberships whose `sessions_revoked_at` is later than now are refused. All failures redirect to `/sign-in?error=sso_failed` and never reveal whether the user, organisation or domain exists; the reason is written to the audit log (`sso.saml.rejected`). Discovery by email returns the same opaque, encrypted continue link for every domain. Following that link does reveal whether a domain uses SSO (it goes to the IdP or back to `sso_failed`); this is accepted as standard home-realm discovery behaviour.

Sessions are created with `internalAdapter.createSession`, so the `databaseHooks` (second-factor guard, banned-user check, session audit) and the revoked-session guard apply as for any other sign-in. For TOTP-enrolled users the ACS is allow-listed in the second-factor guard only when the organisation sets **IdP enforces MFA**; otherwise they are sent to `/sign-in?error=two_factor_required` and must use password and code. A successful SAML sign-in sets the active-organisation cookie to that organisation.

Not implemented: SAML Single Logout, signed AuthnRequests, encrypted assertions, and per-org OIDC sign-in (OIDC settings are stored only).

See [SECURITY.md](../SECURITY.md) for vulnerability reporting.
