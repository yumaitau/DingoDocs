/** Organisation MFA requirements understood by decideMfaEnforcement. */
export const MFA_MODES = [
  "optional",
  "admin_required",
  "all_users_required",
] as const;

export type MfaMode = (typeof MFA_MODES)[number];
