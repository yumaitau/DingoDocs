import { safeInternalPath } from "@/lib/security/internal-path";

export const TWO_FACTOR_PAGE_PATH = "/sign-in/two-factor";

/**
 * Extract the base32 secret from an `otpauth://totp/...` URI so users can
 * type it into an authenticator without scanning a QR code.
 */
export function totpSecretFromUri(uri: string | null | undefined) {
  if (!uri) return null;
  try {
    const url = new URL(uri);
    if (url.protocol !== "otpauth:") return null;
    const secret = url.searchParams.get("secret")?.replace(/\s+/g, "");
    if (!secret || !/^[A-Z2-7]+=*$/i.test(secret)) return null;
    return secret.toUpperCase();
  } catch {
    return null;
  }
}

/** Group a base32 secret into blocks of four for easier manual entry. */
export function formatTotpSecret(secret: string) {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

/** Strip spaces and dashes users paste with authenticator codes. */
export function normaliseOtpCode(value: string) {
  return value.replace(/[\s-]+/g, "");
}

/** Two-factor challenge URL that preserves a validated same-origin `next`. */
export function twoFactorChallengePath(next: string | null | undefined) {
  const params = new URLSearchParams({ next: safeInternalPath(next) });
  return `${TWO_FACTOR_PAGE_PATH}?${params.toString()}`;
}
