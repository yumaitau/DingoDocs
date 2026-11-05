/**
 * True when an administrator (or SCIM) revoked this member's sessions for the
 * organisation at or after the session was created. The user must sign in
 * again before the session works for that organisation; other organisations
 * are unaffected.
 */
export function sessionRevokedForMembership(
  sessionCreatedAt: Date | string | null | undefined,
  sessionsRevokedAt: Date | string | null | undefined,
) {
  if (sessionsRevokedAt == null) return false;
  const revoked = new Date(sessionsRevokedAt).getTime();
  if (Number.isNaN(revoked)) return false;
  if (sessionCreatedAt == null) return true;
  const created = new Date(sessionCreatedAt).getTime();
  // An unreadable creation time cannot prove the session is newer.
  return Number.isNaN(created) || revoked >= created;
}
