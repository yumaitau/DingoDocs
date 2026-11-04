/** Longest lifetime an API credential may be issued with. */
export const maxApiKeyLifetimeDays = 365;
/** Lifetime used when the caller does not choose an expiry. */
export const defaultApiKeyLifetimeDays = 90;

const dayMs = 86_400_000;

/** Rejects expiries that are invalid, in the past, or beyond the maximum. */
export function assertApiKeyExpiry(expiresAt: Date, now = new Date()) {
  if (Number.isNaN(expiresAt.getTime()))
    throw new Error("API key expiry is not a valid date");
  if (expiresAt.getTime() <= now.getTime())
    throw new Error("API key expiry must be in the future");
  if (expiresAt.getTime() > now.getTime() + maxApiKeyLifetimeDays * dayMs)
    throw new Error(
      `API key expiry must be within ${maxApiKeyLifetimeDays} days`,
    );
}

/**
 * Converts a YYYY-MM-DD form value to an expiry at the end of that UTC day,
 * capped at the maximum lifetime so the last selectable date is accepted. No
 * date means the default lifetime.
 */
export function apiKeyExpiryFromDate(
  date: string | undefined,
  now = new Date(),
) {
  if (!date) return new Date(now.getTime() + defaultApiKeyLifetimeDays * dayMs);
  const max = now.getTime() + maxApiKeyLifetimeDays * dayMs;
  if (date > apiKeyDateBounds(now).max)
    throw new Error(
      `API key expiry must be within ${maxApiKeyLifetimeDays} days`,
    );
  const expiresAt = new Date(
    Math.min(Date.parse(`${date}T23:59:59.999Z`), max),
  );
  assertApiKeyExpiry(expiresAt, now);
  return expiresAt;
}

/** UTC date bounds and default for an expiry date input. */
export function apiKeyDateBounds(now = new Date()) {
  const day = (offset: number) =>
    new Date(now.getTime() + offset * dayMs).toISOString().slice(0, 10);
  return {
    min: day(0),
    max: day(maxApiKeyLifetimeDays),
    defaultValue: day(defaultApiKeyLifetimeDays),
  };
}
