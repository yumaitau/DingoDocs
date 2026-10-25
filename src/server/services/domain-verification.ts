import "server-only";

import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, organisations, type SecurityPolicy } from "@/db/schema";

export type ScimDomain = NonNullable<SecurityPolicy["scimDomains"]>[number];
export type TxtResolver = (hostname: string) => Promise<string[][]>;

type Actor = { organisationId: string; userId: string };

export const scimDomainTxtPrefix = "_dingodocs-verification";
const txtValuePrefix = "dingodocs-domain-verification=";
const maxDomainsPerOrganisation = 20;

/** Mailbox providers whose domains no single organisation can claim. */
export const sharedEmailProviderDomains = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "bigpond.com",
] as const;

// Second-level labels used by registries as public suffixes (com.au, co.uk…).
const publicSecondLevelLabels = new Set([
  "com",
  "net",
  "org",
  "edu",
  "gov",
  "co",
  "ac",
  "id",
  "asn",
]);

const labelPattern = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const tldPattern = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export class ScimDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScimDomainError";
  }
}

/** Lowercase, trim and validate a domain an organisation wants to claim. */
export function normaliseScimDomain(input: string) {
  const domain = input.trim().toLowerCase().replace(/\.$/, "");
  const labels = domain.split(".");
  if (
    domain.length > 253 ||
    labels.length < 2 ||
    !labels.every((label) => labelPattern.test(label)) ||
    !tldPattern.test(labels[labels.length - 1])
  )
    throw new ScimDomainError("Enter a valid domain name, such as example.com");
  if (labels.length === 2 && publicSecondLevelLabels.has(labels[0]))
    throw new ScimDomainError(
      `${domain} is a public suffix and can't be claimed`,
    );
  if (
    sharedEmailProviderDomains.some(
      (provider) => domain === provider || domain.endsWith(`.${provider}`),
    )
  )
    throw new ScimDomainError(
      `${domain} is a shared email provider and can't be claimed`,
    );
  return domain;
}

export function scimDomainTxtName(domain: string) {
  return `${scimDomainTxtPrefix}.${domain}`;
}

export function scimDomainTxtValue(token: string) {
  return `${txtValuePrefix}${token}`;
}

/** Domain part of an email address, lowercased; undefined if malformed. */
export function emailDomain(email: string) {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return undefined;
  return email
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

/** Exact-match check: subdomains must be verified separately. */
export function isVerifiedScimDomain(
  policy: SecurityPolicy | null | undefined,
  domain: string | undefined,
) {
  if (!domain) return false;
  return (policy?.scimDomains ?? []).some(
    (entry) => entry.domain === domain && Boolean(entry.verifiedAt),
  );
}

/** True when any TXT record (chunks joined) equals the expected value. */
export async function txtRecordMatches(
  domain: string,
  token: string,
  resolver: TxtResolver = resolveTxt,
) {
  let records: string[][];
  try {
    records = await resolver(scimDomainTxtName(domain));
  } catch {
    return false;
  }
  const expected = scimDomainTxtValue(token);
  return records.some((chunks) => chunks.join("").trim() === expected);
}

async function loadPolicy(organisationId: string) {
  const [org] = await db
    .select({ securityPolicy: organisations.securityPolicy })
    .from(organisations)
    .where(
      and(
        eq(organisations.id, organisationId),
        isNull(organisations.deletedAt),
      ),
    )
    .limit(1);
  if (!org) throw new ScimDomainError("Organisation not found");
  return (org.securityPolicy ?? {}) as SecurityPolicy;
}

export async function listScimDomains(organisationId: string) {
  return (await loadPolicy(organisationId)).scimDomains ?? [];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Locks the organisation row and returns its policy, so jsonb edits don't race. */
async function lockPolicy(tx: Tx, organisationId: string) {
  const [org] = await tx
    .select({ securityPolicy: organisations.securityPolicy })
    .from(organisations)
    .where(
      and(
        eq(organisations.id, organisationId),
        isNull(organisations.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
  if (!org) throw new ScimDomainError("Organisation not found");
  return (org.securityPolicy ?? {}) as SecurityPolicy;
}

async function savePolicy(
  tx: Tx,
  organisationId: string,
  policy: SecurityPolicy,
) {
  await tx
    .update(organisations)
    .set({ securityPolicy: policy, updatedAt: new Date() })
    .where(eq(organisations.id, organisationId));
}

async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  domain: string,
  metadata: Record<string, unknown> = {},
) {
  await tx.insert(auditEvents).values({
    organisationId: actor.organisationId,
    actorId: actor.userId,
    action,
    targetType: "scim_domain",
    targetId: domain,
    metadata: { domain, ...metadata },
  });
}

export async function addScimDomain(actor: Actor, input: string) {
  const domain = normaliseScimDomain(input);
  return db.transaction(async (tx) => {
    const policy = await lockPolicy(tx, actor.organisationId);
    const domains = policy.scimDomains ?? [];
    if (domains.some((entry) => entry.domain === domain))
      throw new ScimDomainError(`${domain} has already been added`);
    if (domains.length >= maxDomainsPerOrganisation)
      throw new ScimDomainError(
        `An organisation can have at most ${maxDomainsPerOrganisation} SCIM domains`,
      );
    const entry: ScimDomain = {
      domain,
      token: randomBytes(16).toString("hex"),
    };
    await savePolicy(tx, actor.organisationId, {
      ...policy,
      scimDomains: [...domains, entry],
    });
    await audit(tx, actor, "scim.domain.added", domain);
    return entry;
  });
}

export async function verifyScimDomain(
  actor: Actor,
  input: string,
  resolver: TxtResolver = resolveTxt,
) {
  const domain = normaliseScimDomain(input);
  const pending = (await listScimDomains(actor.organisationId)).find(
    (entry) => entry.domain === domain,
  );
  if (!pending) throw new ScimDomainError(`${domain} has not been added`);
  if (pending.verifiedAt) return pending;
  // DNS lookup happens before taking any locks.
  if (!(await txtRecordMatches(domain, pending.token, resolver)))
    throw new ScimDomainError(
      `TXT record ${scimDomainTxtName(domain)} with value ${scimDomainTxtValue(pending.token)} was not found`,
    );
  return db.transaction(async (tx) => {
    const policy = await lockPolicy(tx, actor.organisationId);
    const domains = policy.scimDomains ?? [];
    const index = domains.findIndex(
      (entry) => entry.domain === domain && entry.token === pending.token,
    );
    if (index < 0)
      throw new ScimDomainError(`${domain} changed during verification`);
    // Serialise verifications of the same domain across organisations.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`scim-domain:${domain}`}))`,
    );
    const [claimed] = await tx
      .select({ id: organisations.id })
      .from(organisations)
      .where(
        and(
          ne(organisations.id, actor.organisationId),
          isNull(organisations.deletedAt),
          sql`jsonb_path_exists(${organisations.securityPolicy}, '$.scimDomains[*] ? (@.domain == $d && exists(@.verifiedAt))', jsonb_build_object('d', ${domain}::text))`,
        ),
      )
      .limit(1);
    if (claimed)
      throw new ScimDomainError(
        `${domain} is already verified by another organisation`,
      );
    const verified: ScimDomain = {
      ...domains[index],
      verifiedAt: new Date().toISOString(),
    };
    await savePolicy(tx, actor.organisationId, {
      ...policy,
      scimDomains: domains.map((entry, i) => (i === index ? verified : entry)),
    });
    await audit(tx, actor, "scim.domain.verified", domain);
    return verified;
  });
}

export async function removeScimDomain(actor: Actor, input: string) {
  const domain = input.trim().toLowerCase().replace(/\.$/, "");
  await db.transaction(async (tx) => {
    const policy = await lockPolicy(tx, actor.organisationId);
    const domains = policy.scimDomains ?? [];
    const existing = domains.find((entry) => entry.domain === domain);
    if (!existing) throw new ScimDomainError(`${domain} has not been added`);
    await savePolicy(tx, actor.organisationId, {
      ...policy,
      scimDomains: domains.filter((entry) => entry !== existing),
    });
    await audit(tx, actor, "scim.domain.removed", domain, {
      wasVerified: Boolean(existing.verifiedAt),
    });
  });
}
