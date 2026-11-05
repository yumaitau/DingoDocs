# Administrator guide

Organisation owners and administrators use **Security and operations** to invite members, choose least-privilege roles, force logout, place or release evidence legal holds, preview retention, and confirm destruction. Platform and organisation permissions are enforced on the server; hiding a control is never an authorisation boundary.

Deployment-wide identity providers are configured only through server environment variables. Google and GitHub use their client ID and secret pairs. Microsoft Entra also requires a tenant ID. Generic OpenID Connect requires an HTTPS discovery URL, exact issuer, client credentials, and optional scopes. A provider is disabled when its complete configuration is absent. Secrets must be injected by the deployment secret manager, rotated after suspected exposure, and never use `NEXT_PUBLIC_` names.

## SAML single sign-on

Each organisation can sign its people in with its own SAML 2.0 identity provider (Entra ID, Okta, Google Workspace, Keycloak and similar). Set it up in **Settings → Security and operations**.

1. **Verify your email domain.** Under **SCIM 2.0 → Verified domains**, add and verify every email domain your people sign in with (DNS TXT record). SAML sign-in is refused for any address whose domain this organisation hasn't verified, including existing members.
2. **Create the app in your IdP.** Copy these from **Per-organisation SSO** (they are also listed as `https://<host>/api/auth/sso/saml/<organisation-slug>/…`):
   - **SP entity ID / audience** (Entra: Identifier, Okta: Audience URI): `…/metadata`
   - **ACS URL** (Reply URL, Single sign-on URL), HTTP-POST binding: `…/acs`
   - **SP metadata URL**, if your IdP imports metadata: `…/metadata`
   - **Sign-in URL**, for an IdP dashboard tile or bookmark: `…/login`
3. **Configure the IdP.** Sign the assertion (signing the whole response as well is fine) with SHA-256. Send the user's email as an attribute (default name `email`) or as an email-format NameID. Send group names in an attribute if you want group-to-role mapping. Prefer a persistent NameID: DingoDocs links it to the user on first sign-in.
4. **Fill in the DingoDocs form** with protocol **SAML**:
   - **Issuer**: the IdP entity ID. Assertions from any other issuer are rejected.
   - **SAML entry point**: the IdP's HTTP-Redirect SSO URL (`https://` only).
   - **SAML IdP certificate**: the IdP signing certificate (PEM or base64). Paste two PEM blocks while rotating certificates.
   - **SAML email attribute** and **SAML groups attribute**: attribute names, if they differ from `email` or you want group mapping.
   - **SSO group → role JSON**: for example `{"pentest-leads":"lead_consultant"}`. Owner and platform administrator can never be granted through SSO. Unmapped users get `read_only`.
5. Save, then test with **Sign in with SSO** on the sign-in page: enter a work email on a verified domain or the organisation's slug.

Options:

- **Just-in-time provisioning** (off by default). When on, a person on a verified domain who isn't a member yet becomes one at first SAML sign-in, with the mapped role. A new account is created if needed; an existing account is added only if its email is already verified. When off, add people by invitation or SCIM first.
- **Allow IdP-initiated sign-in** (off by default). When off, only sign-ins started from DingoDocs are accepted, and each response must answer that request in the same browser. Turn it on only if people must start from the IdP dashboard; the dashboard tile can point at the sign-in URL instead.
- **IdP enforces MFA** (off by default). People who enrolled an authenticator app in DingoDocs can't use SAML sign-in unless this is on; they are told to sign in with password and code instead. Turn it on only when your IdP requires MFA for this application, because DingoDocs then trusts the IdP's MFA instead of asking for its own code.

Members who are deactivated, banned, or force-logged-out (until that point in time) cannot sign in through SAML. Every SAML sign-in, rejection (with the reason), JIT user or membership creation and account link is in the audit log under `sso.saml.*`. Users see only a generic "Single sign-on didn't complete" message, so check the audit log when someone can't sign in.

The old shared endpoint `/api/auth/saml/acs` now returns `410 Gone`. Replace it in the IdP with the organisation's own ACS URL. SAML Single Logout is not supported: signing out of the IdP does not end DingoDocs sessions, so use force logout or SCIM deactivation to remove access.

Invitations expire after 72 hours, store only a SHA-256 token hash, are bound to the invited email, and become unusable after acceptance or revocation. Use the audit page to review authentication failures, MFA changes, invitation lifecycle, session revocation, legal holds, and destruction.

Retention previews exclude held data. Manual purge requires the displayed `PURGE n` confirmation. Daily scheduled processing runs at 02:15 in `CRON_TIMEZONE`; destroyed blobs are removed while non-sensitive metadata and audit events remain. Review dead-letter jobs through readiness/central monitoring before retrying operational work.

Before production, remove the demo account, enforce email verification, configure SMTP and TLS, verify provider callback URLs, test backup/restore, and alert on repeated lockouts, dead-letter jobs, or readiness failures.
