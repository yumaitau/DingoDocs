import { APIError } from "better-auth/api";
import { INVITATION_TOKEN_HEADER } from "./invitation-token";
import { SAML_ACS_PATH } from "./saml-paths";

export {
  INVITATION_TOKEN_HEADER,
  invitationTokenFromPath,
} from "./invitation-token";

/**
 * Who may create their own account (SIGN_UP_MODE):
 * - `open`: anyone (default).
 * - `invite`: only through an emailed invitation link: the request must carry
 *   that invitation's token and the email it was sent to.
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

type UserCreateContext =
  | {
      path?: string;
      headers?: Headers;
      request?: Request;
    }
  | null
  | undefined;

function invitationToken(context: NonNullable<UserCreateContext>) {
  const headers = context.headers ?? context.request?.headers;
  return headers?.get(INVITATION_TOKEN_HEADER)?.trim() || undefined;
}

/**
 * databaseHooks.user.create.before guard. A null context is a server-side
 * call outside any endpoint (seeds, scripts) and is allowed.
 */
export function createSignUpGuard(
  mode: SignUpMode,
  /** True when `token` is a pending, unexpired invitation for `email`. */
  hasPendingInvitation: (email: string, token: string) => Promise<boolean>,
) {
  return async (user: { email: string }, context: UserCreateContext) => {
    if (mode === "open" || !context) return;
    if (context.path && SIGN_UP_EXEMPT_PATHS.has(context.path)) return;
    if (mode === "invite") {
      const token = invitationToken(context);
      if (
        token &&
        (await hasPendingInvitation(user.email.trim().toLowerCase(), token))
      )
        return;
    }
    throw new APIError("FORBIDDEN", {
      code: SIGN_UP_DISABLED_CODE,
      message: SIGN_UP_DISABLED_MESSAGE,
    });
  };
}
