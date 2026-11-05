import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveAuthSecret } from "./secret";

export const PATHNAME_HEADER = "x-pathname";
export const REQUEST_METHOD_HEADER = "x-request-method";
export const PATHNAME_SIGNATURE_HEADER = "x-pathname-signature";

// Domain separation so this HMAC can never be confused with Better Auth's
// own signed values, which use the same secret. v2 binds the method too, so a
// signature for a GET page render cannot vouch for a POST to the same path.
const SIGNATURE_CONTEXT = "dingodocs:x-pathname:v2\n";

export type SignedRequest = { method: string; pathname: string };

/** HMAC-SHA256 (base64url) of method and pathname, or null without a secret. */
export function signRequest(
  request: SignedRequest,
  secret: string | null = resolveAuthSecret(),
): string | null {
  if (!secret) return null;
  return createHmac("sha256", secret)
    .update(`${SIGNATURE_CONTEXT}${request.method}\n${request.pathname}`)
    .digest("base64url");
}

/**
 * Returns the method and pathname only when the proxy signed them.
 * API routes bypass the proxy, so unsigned values are client-controlled.
 */
export function verifiedRequest(
  method: string | null | undefined,
  pathname: string | null | undefined,
  signature: string | null | undefined,
  secret: string | null = resolveAuthSecret(),
): SignedRequest | null {
  if (!method || !pathname || !signature) return null;
  // The method is newline-delimited in the HMAC input, so refuse anything
  // that could shift the boundary between method and pathname.
  if (!/^[A-Z]+$/.test(method)) return null;
  const expected = signRequest({ method, pathname }, secret);
  if (!expected) return null;
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length) return null;
  return timingSafeEqual(actual, wanted) ? { method, pathname } : null;
}

export function verifiedRequestFromHeaders(
  headers: Pick<Headers, "get">,
  secret?: string | null,
): SignedRequest | null {
  return verifiedRequest(
    headers.get(REQUEST_METHOD_HEADER),
    headers.get(PATHNAME_HEADER),
    headers.get(PATHNAME_SIGNATURE_HEADER),
    secret === undefined ? resolveAuthSecret() : secret,
  );
}
