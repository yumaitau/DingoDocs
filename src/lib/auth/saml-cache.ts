import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { CacheItem, CacheProvider } from "@node-saml/node-saml";
import { db } from "@/db";
import { verificationTokens } from "@/db/schema";

/**
 * Persistent, multi-replica SAML state on the verification_tokens table:
 * AuthnRequest IDs (single use, 10 minutes), assertion-ID replay tombstones
 * (until NotOnOrAfter). Rows use their own
 * `purpose` values and plain identifiers, so they never collide with Better
 * Auth's hashed verification identifiers. Better Auth's expired-row cleanup
 * also removes them.
 */
export const SAML_REQUEST_TTL_MS = 10 * 60 * 1_000;
const REQUEST_PURPOSE = "saml_request";
const ASSERTION_PURPOSE = "saml_assertion";

function requestKey(organisationId: string, requestId: string) {
  return `saml-request:${organisationId}:${requestId}`;
}

/** Atomically deletes an unexpired row and returns its value (first caller wins). */
async function consume(identifier: string, purpose: string) {
  const [row] = await db
    .delete(verificationTokens)
    .where(
      and(
        eq(verificationTokens.identifier, identifier),
        eq(verificationTokens.purpose, purpose),
        gt(verificationTokens.expiresAt, new Date()),
      ),
    )
    .returning({ value: verificationTokens.value });
  return row?.value ?? null;
}

/**
 * node-saml CacheProvider for one request. `getAsync` consumes the stored
 * request ID, so two replicas racing on the same InResponseTo cannot both
 * accept it; the consumed value is memoised because node-saml reads the same
 * ID twice (Response and SubjectConfirmationData) within one validation.
 */
export function createSamlRequestCache(organisationId: string): CacheProvider {
  const consumed = new Map<string, string>();
  return {
    async saveAsync(key: string, value: string): Promise<CacheItem | null> {
      const createdAt = Date.now();
      await db.insert(verificationTokens).values({
        identifier: requestKey(organisationId, key),
        value,
        purpose: REQUEST_PURPOSE,
        expiresAt: new Date(createdAt + SAML_REQUEST_TTL_MS),
      });
      return { value, createdAt };
    },
    async getAsync(key: string) {
      const memo = consumed.get(key);
      if (memo !== undefined) return memo;
      const value = await consume(
        requestKey(organisationId, key),
        REQUEST_PURPOSE,
      );
      if (value !== null) consumed.set(key, value);
      return value;
    },
    async removeAsync(key: string | null) {
      if (!key) return null;
      consumed.delete(key);
      await db
        .delete(verificationTokens)
        .where(
          and(
            eq(verificationTokens.identifier, requestKey(organisationId, key)),
            eq(verificationTokens.purpose, REQUEST_PURPOSE),
          ),
        );
      return key;
    },
  };
}

/**
 * Records an assertion ID until it expires. Returns false when the ID was
 * already recorded (a replay). Serialised per ID with an advisory lock,
 * because verification_tokens.identifier has no unique index.
 */
export async function reserveSamlAssertionId(
  organisationId: string,
  assertionId: string,
  expiresAt: Date,
) {
  const identifier = `saml-assertion:${organisationId}:${assertionId}`;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${identifier}))`,
    );
    // Expired tombstones can be replaced: node-saml has already rejected an
    // assertion past its NotOnOrAfter (plus clock skew).
    await tx
      .delete(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, identifier),
          eq(verificationTokens.purpose, ASSERTION_PURPOSE),
          lt(verificationTokens.expiresAt, new Date()),
        ),
      );
    const [existing] = await tx
      .select({ id: verificationTokens.id })
      .from(verificationTokens)
      .where(
        and(
          eq(verificationTokens.identifier, identifier),
          eq(verificationTokens.purpose, ASSERTION_PURPOSE),
        ),
      )
      .limit(1);
    if (existing) return false;
    await tx.insert(verificationTokens).values({
      identifier,
      value: "used",
      purpose: ASSERTION_PURPOSE,
      expiresAt,
    });
    return true;
  });
}
