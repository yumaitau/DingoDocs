import { APIError, createAuthMiddleware } from "better-auth/api";

export const SESSION_REVOKED_CODE = "SESSION_REVOKED";
export const SESSION_REVOKED_MESSAGE =
  "This session was revoked by an organisation. Sign in again to continue.";

/**
 * Better Auth endpoints (ctx.path route templates) a revoked session may
 * still reach: fresh authentication, which proves the user again and starts a
 * new session, plus reading, listing and ending sessions.
 */
const EXACT_PATHS: ReadonlySet<string> = new Set([
  "/ok",
  "/error",
  "/get-session",
  "/list-sessions",
  "/sign-out",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/magic-link/verify",
  "/verify-email",
  "/send-verification-email",
  "/request-password-reset",
  "/passkey/generate-authenticate-options",
  "/passkey/verify-authentication",
  "/oauth-proxy-callback",
]);
const PATH_PREFIXES = [
  "/sign-in/",
  "/sign-up/",
  "/callback/",
  "/reset-password",
  // Per-organisation SSO: discovery, SAML login, ACS and SP metadata.
  "/sso/",
] as const;

export function isAllowedForRevokedSession(path: string | null | undefined) {
  if (!path) return false;
  return (
    EXACT_PATHS.has(path) ||
    PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

/**
 * Global Better Auth before-hook. Tenant revocation keeps the session row so
 * other organisations keep working, which means the old cookie can still
 * reach Better Auth. Endpoints that rotate a session (2FA enable/verify,
 * change-password, passkey registration, impersonation) would mint a
 * replacement with a new createdAt that passes the revocation cutoff, and
 * passkey registration would add a credential for a later fresh sign-in.
 * So a session revoked by any membership may only sign in again or sign out.
 */
export function createRevokedSessionGuard(
  isSessionTokenRevoked: (token: string) => Promise<boolean>,
) {
  const check = revokedSessionCheck(isSessionTokenRevoked);
  return createAuthMiddleware(async (ctx) => check(ctx));
}

type GuardContext = {
  path?: string;
  getSignedCookie: (
    name: string,
    secret: string,
  ) => Promise<string | false | null>;
  context: { secret: string; authCookies: { sessionToken: { name: string } } };
};

/** The hook body, exported for unit tests. */
export function revokedSessionCheck(
  isSessionTokenRevoked: (token: string) => Promise<boolean>,
) {
  return async (ctx: GuardContext) => {
    if (isAllowedForRevokedSession(ctx.path)) return;
    const token = await ctx.getSignedCookie(
      ctx.context.authCookies.sessionToken.name,
      ctx.context.secret,
    );
    if (!token) return;
    if (!(await isSessionTokenRevoked(token))) return;
    throw new APIError("UNAUTHORIZED", {
      message: SESSION_REVOKED_MESSAGE,
      code: SESSION_REVOKED_CODE,
    });
  };
}
