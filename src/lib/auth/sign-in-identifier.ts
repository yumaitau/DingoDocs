export function isEmailSignInPath(pathname: string) {
  return pathname.replace(/\/+$/, "").endsWith("/sign-in/email");
}

const JSON_CONTENT_TYPE = /^application\/([a-z0-9.+-]*\+)?json/;

/**
 * Extracts the sign-in email from any body Better Auth would accept (JSON,
 * urlencoded or multipart). Returns undefined for other endpoints and null
 * for an email sign-in whose identifier cannot be read, so the caller refuses
 * it instead of skipping the lockout check.
 */
export async function emailIdentifier(
  request: Request,
): Promise<string | null | undefined> {
  if (!isEmailSignInPath(new URL(request.url).pathname)) return undefined;
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  let email: unknown;
  try {
    if (JSON_CONTENT_TYPE.test(contentType)) {
      const body = (await request.clone().json()) as unknown;
      email =
        body && typeof body === "object"
          ? (body as { email?: unknown }).email
          : undefined;
    } else if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      email = (await request.clone().formData()).get("email");
    } else {
      return null;
    }
  } catch {
    return null;
  }
  if (typeof email !== "string") return null;
  const identifier = email.trim().toLowerCase().slice(0, 320);
  return identifier || null;
}
