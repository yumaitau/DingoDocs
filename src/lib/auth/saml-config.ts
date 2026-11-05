import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  SAML,
  ValidateInResponseTo,
  type CacheProvider,
  type Profile,
} from "@node-saml/node-saml";
// node-saml has no exports map; this is the same hardened xmldom parser it
// uses itself (errors on malformed XML).
import { parseDomFromString } from "@node-saml/node-saml/lib/xml";
import type { SecurityPolicy } from "@/db/schema";
import { safeInternalPath } from "@/lib/security/internal-path";
import { samlServiceProviderUrls } from "./saml-paths";

export type SamlSsoPolicy = NonNullable<SecurityPolicy["sso"]> & {
  protocol: "saml";
  entryPoint: string;
  certificate: string;
};

export const SAML_CLOCK_SKEW_MS = 60_000;
/** An assertion is only accepted within this long of its IssueInstant. */
export const SAML_MAX_ASSERTION_AGE_MS = 5 * 60 * 1_000;
const RELAY_STATE_TTL_MS = 15 * 60 * 1_000;
const MAX_RELAY_CALLBACK_LENGTH = 512;

/** The organisation's SSO policy when it is a complete SAML configuration. */
export function samlPolicy(
  policy: SecurityPolicy | null | undefined,
): SamlSsoPolicy | null {
  const sso = policy?.sso;
  if (
    !sso ||
    sso.protocol !== "saml" ||
    !sso.entryPoint?.trim() ||
    !sso.certificate?.trim() ||
    !sso.issuer?.trim()
  )
    return null;
  return sso as SamlSsoPolicy;
}

/**
 * IdP signing certificates. Accepts one or more PEM blocks (for rotation) or a
 * bare base64 body as copied from IdP metadata.
 */
export function idpCertificates(value: string) {
  const blocks = value.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
  );
  if (blocks?.length) return blocks.map((block) => block.trim());
  const body = value.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return [`-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----`];
}

/**
 * node-saml instance for one organisation. The SP entity ID (and audience) is
 * the per-organisation metadata URL, so an assertion minted for another
 * organisation or another service provider is rejected.
 */
export function createSamlClient(input: {
  authBaseURL: string;
  slug: string;
  sso: SamlSsoPolicy;
  cacheProvider: CacheProvider;
  /** AuthnRequest ID to use, so the caller can bind it to the browser. */
  requestId?: string;
}) {
  const urls = samlServiceProviderUrls(input.authBaseURL, input.slug);
  return new SAML({
    idpCert: idpCertificates(input.sso.certificate),
    issuer: urls.entityId,
    audience: urls.entityId,
    callbackUrl: urls.acsUrl,
    entryPoint: input.sso.entryPoint.trim(),
    // Most IdPs sign only the assertion; that signature is required.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: input.sso.allowIdpInitiated
      ? ValidateInResponseTo.ifPresent
      : ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: 10 * 60 * 1_000,
    acceptedClockSkewMs: SAML_CLOCK_SKEW_MS,
    // node-saml caps NotOnOrAfter at IssueInstant + this, where present.
    // checkSignedAssertion enforces it even when no NotOnOrAfter exists.
    maxAssertionAgeMs: SAML_MAX_ASSERTION_AGE_MS,
    cacheProvider: input.cacheProvider,
    // Let the IdP choose its NameID format and authentication context;
    // requesting specific ones breaks common Entra and Okta setups.
    identifierFormat: null,
    disableRequestedAuthnContext: true,
    ...(input.requestId ? { generateUniqueId: () => input.requestId! } : {}),
  });
}

/** A fresh AuthnRequest ID in node-saml's format (an XML NCName). */
export function newSamlRequestId() {
  return `_${randomBytes(20).toString("hex")}`;
}

/** Cookie binding an SP-initiated request to the browser that started it. */
export const SAML_REQUEST_COOKIE = "dingodocs_saml_request";

export function serviceProviderMetadata(authBaseURL: string, slug: string) {
  const urls = samlServiceProviderUrls(authBaseURL, slug);
  // Metadata needs no IdP settings; a throwaway client carries the SP fields.
  return new SAML({
    idpCert: "unused",
    issuer: urls.entityId,
    callbackUrl: urls.acsUrl,
    identifierFormat: null,
    wantAssertionsSigned: true,
  }).generateServiceProviderMetadata(null, null);
}

function relaySignature(secret: string, payload: string) {
  return createHmac("sha256", secret)
    .update(`dingodocs-saml-relay:${payload}`)
    .digest("base64url")
    .slice(0, 32);
}

/** Signed RelayState binding the post-login path to one organisation. */
export function signRelayState(input: {
  secret: string;
  organisationId: string;
  callbackURL: string;
  now?: number;
}) {
  let callback = safeInternalPath(input.callbackURL);
  if (callback.length > MAX_RELAY_CALLBACK_LENGTH) callback = "/dashboard";
  const expires = Math.floor(
    ((input.now ?? Date.now()) + RELAY_STATE_TTL_MS) / 1_000,
  ).toString(36);
  const encoded = Buffer.from(callback).toString("base64url");
  const payload = `${encoded}.${expires}`;
  return `${payload}.${relaySignature(input.secret, `${input.organisationId}:${payload}`)}`;
}

/**
 * The post-login path from a RelayState this deployment signed for this
 * organisation, else the default. RelayState is attacker-reachable, so it
 * never selects the organisation and never yields an external URL.
 */
export function verifyRelayState(input: {
  secret: string;
  organisationId: string;
  relayState: string | undefined;
  now?: number;
}) {
  const parts = input.relayState?.split(".") ?? [];
  if (parts.length !== 3) return safeInternalPath(null);
  const [encoded, expires, signature] = parts;
  const expected = relaySignature(
    input.secret,
    `${input.organisationId}:${encoded}.${expires}`,
  );
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return safeInternalPath(null);
  if (parseInt(expires, 36) * 1_000 < (input.now ?? Date.now()))
    return safeInternalPath(null);
  return safeInternalPath(Buffer.from(encoded, "base64url").toString("utf8"));
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  return undefined;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(strings);
  return [];
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function attribute(profile: Profile, name: string) {
  const attributes = (profile.attributes ?? {}) as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(attributes, name)
    ? attributes[name]
    : profile[name];
}

/** Identity claims from a validated profile, per the organisation's mapping. */
export function samlIdentity(profile: Profile, sso: SamlSsoPolicy) {
  const nameID = typeof profile.nameID === "string" ? profile.nameID : "";
  const emailAttribute = sso.emailAttribute?.trim() || "email";
  const fromAttribute =
    firstString(attribute(profile, emailAttribute)) ??
    (emailAttribute === "email" ? firstString(profile.email) : undefined);
  const candidate =
    fromAttribute ?? (EMAIL_PATTERN.test(nameID) ? nameID : undefined);
  const email = candidate?.trim().toLowerCase();
  const groupsAttribute = sso.groupsAttribute?.trim();
  const name =
    firstString(attribute(profile, "displayName")) ??
    firstString(
      attribute(
        profile,
        "http://schemas.microsoft.com/identity/claims/displayname",
      ),
    ) ??
    firstString(attribute(profile, "name"));
  return {
    nameID: nameID.trim(),
    email: email && EMAIL_PATTERN.test(email) ? email : undefined,
    name,
    groups: groupsAttribute ? strings(attribute(profile, groupsAttribute)) : [],
  };
}

const SAML_ASSERTION_NS = "urn:oasis:names:tc:SAML:2.0:assertion";
const BEARER_METHOD = "urn:oasis:names:tc:SAML:2.0:cm:bearer";

function children(parent: Element, localName: string) {
  const found: Element[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling)
    if (
      node.nodeType === 1 &&
      (node as Element).localName === localName &&
      (node as Element).namespaceURI === SAML_ASSERTION_NS
    )
      found.push(node as Element);
  return found;
}

/** A timestamp attribute: undefined when absent, NaN when malformed. */
function instant(element: Element, name: string) {
  const value = element.getAttribute(name);
  return value ? Date.parse(value) : undefined;
}

export type SignedAssertionCheck =
  { ok: true; id: string; replayUntil: Date } | { ok: false; reason: string };

/**
 * Checks node-saml leaves to its options, or skips when they are absent, on
 * the signed assertion only. `assertionXml` must be profile.getAssertionXml(),
 * which node-saml builds from the verified signature reference, never the raw
 * response, so wrapped (unsigned) elements cannot influence the result.
 *
 * Requires an IssueInstant within the maximum age, Conditions times when
 * present, and a bearer SubjectConfirmation addressed to this ACS that is
 * unexpired and, when the response carries an InResponseTo, answers it in
 * the signed SubjectConfirmationData.
 * Returns the replay deadline: the latest validity time plus clock skew.
 */
export async function checkSignedAssertion(input: {
  assertionXml: string | undefined;
  acsUrl: string;
  inResponseTo?: string;
  now?: number;
}): Promise<SignedAssertionCheck> {
  const now = input.now ?? Date.now();
  const skew = SAML_CLOCK_SKEW_MS;
  if (!input.assertionXml) return { ok: false, reason: "missing_assertion" };
  let assertion: Element;
  try {
    assertion = (await parseDomFromString(input.assertionXml)).documentElement;
  } catch {
    return { ok: false, reason: "unparseable_assertion" };
  }
  if (
    assertion.localName !== "Assertion" ||
    assertion.namespaceURI !== SAML_ASSERTION_NS
  )
    return { ok: false, reason: "missing_assertion" };
  const id = assertion.getAttribute("ID");
  if (!id) return { ok: false, reason: "missing_assertion_id" };

  const issued = instant(assertion, "IssueInstant");
  if (issued === undefined || Number.isNaN(issued))
    return { ok: false, reason: "missing_issue_instant" };
  if (issued > now + skew)
    return { ok: false, reason: "issue_instant_in_future" };
  const maxAgeDeadline = issued + SAML_MAX_ASSERTION_AGE_MS;
  if (now - skew >= maxAgeDeadline)
    return { ok: false, reason: "assertion_too_old" };
  const deadlines = [maxAgeDeadline];

  const conditions = children(assertion, "Conditions");
  if (conditions.length > 1)
    return { ok: false, reason: "multiple_conditions" };
  if (conditions[0]) {
    const notBefore = instant(conditions[0], "NotBefore");
    const notOnOrAfter = instant(conditions[0], "NotOnOrAfter");
    if (Number.isNaN(notBefore) || Number.isNaN(notOnOrAfter))
      return { ok: false, reason: "malformed_conditions" };
    if (notBefore !== undefined && now + skew < notBefore)
      return { ok: false, reason: "conditions_not_yet_valid" };
    if (notOnOrAfter !== undefined) {
      if (now - skew >= notOnOrAfter)
        return { ok: false, reason: "conditions_expired" };
      deadlines.push(notOnOrAfter);
    }
  }

  // At least one bearer confirmation must satisfy every requirement.
  let bearerDeadline: number | undefined;
  let rejection = "missing_bearer_confirmation";
  for (const subject of children(assertion, "Subject"))
    for (const confirmation of children(subject, "SubjectConfirmation")) {
      if (confirmation.getAttribute("Method") !== BEARER_METHOD) continue;
      for (const data of children(confirmation, "SubjectConfirmationData")) {
        const notBefore = instant(data, "NotBefore");
        const notOnOrAfter = instant(data, "NotOnOrAfter");
        if (notOnOrAfter === undefined || Number.isNaN(notOnOrAfter)) {
          rejection = "bearer_without_expiry";
          continue;
        }
        if (now - skew >= notOnOrAfter) {
          rejection = "bearer_expired";
          continue;
        }
        if (Number.isNaN(notBefore) || (notBefore && now + skew < notBefore)) {
          rejection = "bearer_not_yet_valid";
          continue;
        }
        if (data.getAttribute("Recipient") !== input.acsUrl) {
          rejection = "recipient_mismatch";
          continue;
        }
        // Response/@InResponseTo sits outside an assertion-only signature, so
        // the signed confirmation must answer the same request (SAML
        // profiles 4.1.4.2). Otherwise an unsolicited assertion could be
        // wrapped in a response that claims an attacker's request ID.
        const answers = data.getAttribute("InResponseTo");
        if (input.inResponseTo && answers !== input.inResponseTo) {
          rejection = "in_response_to_mismatch";
          continue;
        }
        if (!input.inResponseTo && answers) {
          rejection = "in_response_to_unexpected";
          continue;
        }
        bearerDeadline = Math.max(bearerDeadline ?? 0, notOnOrAfter);
      }
    }
  if (bearerDeadline === undefined) return { ok: false, reason: rejection };
  deadlines.push(bearerDeadline);

  const replayUntil = Math.max(...deadlines) + skew;
  if (replayUntil <= now) return { ok: false, reason: "assertion_expired" };
  return { ok: true, id, replayUntil: new Date(replayUntil) };
}

/** Better Auth base URL as configured in auth.ts (`<origin>/api/auth`). */
export function deploymentAuthBaseURL() {
  const url = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").trim();
  const parsed = new URL(url);
  return parsed.pathname !== "/" && parsed.pathname !== ""
    ? url.replace(/\/+$/, "")
    : `${parsed.origin}/api/auth`;
}
