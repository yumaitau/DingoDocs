/**
 * Client-safe invitation constants (no Node or Better Auth imports): the
 * sign-up form reads these.
 */

/**
 * Request header carrying the invitation token in invite mode. The token is
 * the secret from the emailed /invite/<token> link, so knowing an invited
 * address is not enough to claim it.
 */
export const INVITATION_TOKEN_HEADER = "x-dingodocs-invitation";

/** The invitation token in an internal `/invite/<token>` path, if any. */
export function invitationTokenFromPath(path: string | null | undefined) {
  const match = /^\/invite\/([A-Za-z0-9_-]{16,128})(?:[/?#]|$)/.exec(
    path ?? "",
  );
  return match?.[1];
}
