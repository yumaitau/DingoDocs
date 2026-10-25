// Shared by auth.ts and the proxy pathname signature so both resolve the
// same secret, including the non-production fallback.
export const DEVELOPMENT_AUTH_SECRET =
  "development-secret-change-before-production";

export function resolveAuthSecret(
  env: Partial<Record<"BETTER_AUTH_SECRET" | "NODE_ENV", string>> = process.env,
): string | null {
  if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET;
  return env.NODE_ENV === "production" ? null : DEVELOPMENT_AUTH_SECRET;
}
