/**
 * Client-safe SAML constants (no Node imports): the sign-in form and the
 * second-factor guard, which the form also imports, read these.
 */

/** Better Auth route templates (ctx.path) for the first-party SAML plugin. */
export const SAML_PATH_PREFIX = "/sso/saml";
export const SAML_LOGIN_PATH = "/sso/saml/:orgSlug/login";
export const SAML_ACS_PATH = "/sso/saml/:orgSlug/acs";
export const SAML_METADATA_PATH = "/sso/saml/:orgSlug/metadata";
export const SSO_DISCOVER_PATH = "/sso/discover";
export const SSO_CONTINUE_PATH = "/sso/continue";

/** Sign-in page error codes and the marker that SSO raised two_factor_required. */
export const SSO_FAILED_ERROR = "sso_failed";
export const SSO_ERROR_METHOD = "sso";

export const SSO_FAILED_MESSAGE =
  "Single sign-on didn't complete. Ask your administrator to check that your account can use SSO for this organisation.";
export const SSO_TWO_FACTOR_MESSAGE =
  'This account uses an authenticator app. Sign in with your password and code, or ask your administrator to enable "IdP enforces MFA" for single sign-on.';

/** Organisation slugs as created by createOrganisation and the seeds. */
export const ORGANISATION_SLUG_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

/**
 * Service-provider URLs an administrator copies into the IdP. `authBaseURL`
 * is the Better Auth base, such as `https://app.example.com/api/auth`.
 */
export function samlServiceProviderUrls(authBaseURL: string, slug: string) {
  const base = `${authBaseURL.replace(/\/+$/, "")}${SAML_PATH_PREFIX}/${encodeURIComponent(slug)}`;
  return {
    entityId: `${base}/metadata`,
    metadataUrl: `${base}/metadata`,
    acsUrl: `${base}/acs`,
    loginUrl: `${base}/login`,
  };
}
