import { APIError } from "better-auth/api";
import { SAML_ACS_PATH } from "./saml-paths";

/**
 * Who may create their own account (SIGN_UP_MODE):
 * - `open`: anyone (default).
 * - `invite`: only an email with a pending organisation invitation.
 * - `closed`: nobody; accounts come from SAML JIT, SCIM or a platform admin.
 */
export type SignUpMode = "open" | "invite" | "closed";

export const SIGN_UP_DISABLED_CODE = "SIGN_UP_DISABLED";
export const SIGN_UP_DISABLED_MESSAGE =
  "Self-service sign-up is disabled. Ask an administrator for an invitation.";

/**
 * Better Auth endpoints (ctx.path route templates) that create users under
 * their own controls, whatever the mode: SAML JIT is gated by verified
 * domains and the organisation's SSO policy, and admin creation needs a
 * platform administrator. Every other user-creating endpoint (email sign-up,
 * magic link, OAuth callbacks, future ones) follows SIGN_UP_MODE.
 */
export const SIGN_UP_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  SAML_ACS_PATH,
  "/admin/create-user",
]);

type ProviderEnvironment = Readonly<Record<string, string | undefined>>;

export function signUpMode(env: ProviderEnvironment = process.env): SignUpMode {
  const value = (env.SIGN_UP_MODE ?? "open").trim().toLowerCase();
  if (value === "open" || value === "invite" || value === "closed")
    return value;
  throw new Error("SIGN_UP_MODE must be open, invite or closed");
}

type UserCreateContext = { path?: string } | null | undefined;

/**
 * databaseHooks.user.create.before guard. A null context is a server-side
 * call outside any endpoint (seeds, scripts) and is allowed.
 */
export function createSignUpGuard(
  mode: SignUpMode,
  hasPendingInvitation: (email: string) => Promise<boolean>,
) {
  return async (user: { email: string }, context: UserCreateContext) => {
    if (mode === "open" || !context) return;
    if (context.path && SIGN_UP_EXEMPT_PATHS.has(context.path)) return;
    if (
      mode === "invite" &&
      (await hasPendingInvitation(user.email.trim().toLowerCase()))
    )
      return;
    throw new APIError("FORBIDDEN", {
      code: SIGN_UP_DISABLED_CODE,
      message: SIGN_UP_DISABLED_MESSAGE,
    });
  };
}
