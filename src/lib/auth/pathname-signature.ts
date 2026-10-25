import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveAuthSecret } from "./secret";

export const PATHNAME_HEADER = "x-pathname";
export const PATHNAME_SIGNATURE_HEADER = "x-pathname-signature";

// Domain separation so this HMAC can never be confused with Better Auth's
// own signed values, which use the same secret.
const SIGNATURE_CONTEXT = "dingodocs:x-pathname:v1\n";

/** HMAC-SHA256 (base64url) of the pathname, or null when no secret exists. */
export function signPathname(
  pathname: string,
  secret: string | null = resolveAuthSecret(),
): string | null {
  if (!secret) return null;
  return createHmac("sha256", secret)
    .update(SIGNATURE_CONTEXT + pathname)
    .digest("base64url");
}

/**
 * Returns the pathname only when the signature was produced by the proxy.
 * API routes bypass the proxy, so an unsigned x-pathname is client-controlled.
 */
export function verifiedPathname(
  pathname: string | null | undefined,
  signature: string | null | undefined,
  secret: string | null = resolveAuthSecret(),
): string | null {
  if (!pathname || !signature) return null;
  const expected = signPathname(pathname, secret);
  if (!expected) return null;
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length) return null;
  return timingSafeEqual(actual, wanted) ? pathname : null;
}

export function verifiedPathnameFromHeaders(
  headers: Pick<Headers, "get">,
  secret?: string | null,
): string | null {
  return verifiedPathname(
    headers.get(PATHNAME_HEADER),
    headers.get(PATHNAME_SIGNATURE_HEADER),
    secret === undefined ? resolveAuthSecret() : secret,
  );
}
