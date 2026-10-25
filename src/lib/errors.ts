import { DrizzleQueryError } from "drizzle-orm/errors";
import { ZodError } from "zod";

/** Postgres SQLSTATE codes are five digits/uppercase letters (e.g. 23505). */
const sqlStatePattern = /^[0-9A-Z]{5}$/;

function isDatabaseError(error: Error): boolean {
  if (error instanceof DrizzleQueryError) return true;
  if (error.message.startsWith("Failed query")) return true;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && sqlStatePattern.test(code);
}

/**
 * Message safe to return from a server action. Validation errors yield their
 * first issue, database errors (which embed SQL and parameters) yield the
 * fallback, and other errors are treated as intentional domain messages.
 */
export function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? fallback;
  if (!(error instanceof Error)) return fallback;
  if (isDatabaseError(error)) return fallback;
  if (error.cause instanceof Error && isDatabaseError(error.cause))
    return fallback;
  return error.message || fallback;
}
