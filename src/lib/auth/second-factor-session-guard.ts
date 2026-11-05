import { SAML_ACS_PATH } from "./saml-paths";

export const SECOND_FACTOR_REQUIRED_ERROR = "two_factor_required";
export const SECOND_FACTOR_REQUIRED_MESSAGE =
  "This account uses an authenticator app. Sign in with your password and code.";

/**
 * Better Auth endpoints (ctx.path route templates) that may create a session
 * for a TOTP-enrolled account. Everything else, such as magic links,
 * verify-email auto sign-in and OAuth callbacks that implicitly link a
 * matching verified email, proves only email or IdP possession and is
 * refused. Allow-listed so a new session-creating endpoint fails closed.
 */
export const SECOND_FACTOR_SESSION_PATHS: ReadonlySet<string> = new Set([
  // The twoFactor plugin's after-hook swaps this session for a TOTP challenge.
  "/sign-in/email",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/verify-otp",
  // Passkey assertion is itself phishing-resistant multi-factor sign-in.
  "/passkey/verify-authentication",
  // Rotations of a session the user already holds.
  "/two-factor/enable",
  "/two-factor/disable",
  "/passkey/verify-registration",
  "/change-password",
  "/admin/impersonate-user",
]);

/**
 * Endpoints allow-listed only when the organisation that owns the request
 * trusts its IdP's MFA (SSO policy `idpEnforcesMfa`). Decided per request by
 * `trustsIdpMfa`; without that callback they stay blocked.
 */
export const IDP_MFA_SESSION_PATHS: ReadonlySet<string> = new Set([
  SAML_ACS_PATH,
]);

type SessionCreateContext = {
  path?: string;
  params?: Record<string, string | undefined>;
  redirect?: (url: string) => unknown;
  context?: { baseURL?: string };
} | null;

type SecondFactorGuardOptions = {
  /** True when the request's organisation trusts its IdP to enforce MFA. */
  trustsIdpMfa?: (
    context: NonNullable<SessionCreateContext>,
  ) => Promise<boolean>;
};

export function secondFactorRequiredUrl(baseURL: string | undefined) {
  const url = new URL("/sign-in", baseURL || "http://localhost");
  url.searchParams.set("error", SECOND_FACTOR_REQUIRED_ERROR);
  return baseURL ? url.toString() : `${url.pathname}${url.search}`;
}

/**
 * databaseHooks.session.create.before guard. Runs at session creation, so a
 * different callbackURL or errorCallbackURL cannot route around it.
 */
export function createSecondFactorSessionGuard(
  isTwoFactorEnabled: (userId: string) => Promise<boolean>,
  options: SecondFactorGuardOptions = {},
) {
  return async (
    session: { userId: string },
    context: SessionCreateContext | undefined,
  ) => {
    // No endpoint context means trusted server code created the session.
    if (!context) return;
    const path = context.path;
    if (path && SECOND_FACTOR_SESSION_PATHS.has(path)) return;
    if (!(await isTwoFactorEnabled(session.userId))) return;
    if (
      path &&
      IDP_MFA_SESSION_PATHS.has(path) &&
      options.trustsIdpMfa &&
      (await options.trustsIdpMfa(context))
    )
      return;
    const destination = secondFactorRequiredUrl(context?.context?.baseURL);
    // ctx.redirect returns a 302 APIError carrying the Location header.
    if (typeof context?.redirect === "function")
      throw context.redirect(destination);
    throw new Error(SECOND_FACTOR_REQUIRED_MESSAGE);
  };
}
