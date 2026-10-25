export const SECOND_FACTOR_REQUIRED_ERROR = "two_factor_required";
export const SECOND_FACTOR_REQUIRED_MESSAGE =
  "This account uses an authenticator app. Sign in with your password and code.";

/**
 * Better Auth endpoints that create a session from email possession alone.
 * The twoFactor plugin only intercepts password sign-in, so these would
 * otherwise hand a full session to accounts that have a second factor.
 */
export const EMAIL_ONLY_SESSION_PATHS: ReadonlySet<string> = new Set([
  "/magic-link/verify",
  "/verify-email",
]);

type SessionCreateContext = {
  path?: string;
  redirect?: (url: string) => unknown;
  context?: { baseURL?: string };
} | null;

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
) {
  return async (
    session: { userId: string },
    context: SessionCreateContext | undefined,
  ) => {
    const path = context?.path;
    if (!path || !EMAIL_ONLY_SESSION_PATHS.has(path)) return;
    if (!(await isTwoFactorEnabled(session.userId))) return;
    const destination = secondFactorRequiredUrl(context?.context?.baseURL);
    // ctx.redirect returns a 302 APIError carrying the Location header.
    if (typeof context?.redirect === "function")
      throw context.redirect(destination);
    throw new Error(SECOND_FACTOR_REQUIRED_MESSAGE);
  };
}
