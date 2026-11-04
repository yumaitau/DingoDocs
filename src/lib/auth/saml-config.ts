import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  SAML,
  ValidateInResponseTo,
  type CacheProvider,
  type Profile,
} from "@node-saml/node-saml";
import type { SecurityPolicy } from "@/db/schema";
import { safeInternalPath } from "@/lib/security/internal-path";
import { samlServiceProviderUrls } from "./saml-paths";

export type SamlSsoPolicy = NonNullable<SecurityPolicy["sso"]> & {
  protocol: "saml";
  entryPoint: string;
  certificate: string;
};

export const SAML_CLOCK_SKEW_MS = 60_000;
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

type XmlJs = { $?: Record<string, string> } & Record<string, unknown>;

/**
 * Assertion ID and the latest NotOnOrAfter from the signed assertion, for the
 * replay tombstone. Undefined when either is missing.
 */
export function assertionReplayKey(profile: Profile) {
  const parsed = profile.getAssertion?.() as { Assertion?: XmlJs } | undefined;
  const assertion = parsed?.Assertion;
  const id = assertion?.$?.ID;
  const times: number[] = [];
  const conditions = (assertion?.Conditions as XmlJs[] | undefined)?.[0];
  if (conditions?.$?.NotOnOrAfter)
    times.push(Date.parse(conditions.$.NotOnOrAfter));
  for (const subject of (assertion?.Subject as XmlJs[] | undefined) ?? [])
    for (const confirmation of (subject.SubjectConfirmation as
      XmlJs[] | undefined) ?? [])
      for (const data of (confirmation.SubjectConfirmationData as
        XmlJs[] | undefined) ?? [])
        if (data.$?.NotOnOrAfter) times.push(Date.parse(data.$.NotOnOrAfter));
  const valid = times.filter((time) => Number.isFinite(time));
  if (!id || !valid.length) return undefined;
  return {
    id,
    expiresAt: new Date(Math.max(...valid) + SAML_CLOCK_SKEW_MS),
  };
}

/** Better Auth base URL as configured in auth.ts (`<origin>/api/auth`). */
export function deploymentAuthBaseURL() {
  const url = (process.env.BETTER_AUTH_URL ?? "http://localhost:3000").trim();
  const parsed = new URL(url);
  return parsed.pathname !== "/" && parsed.pathname !== ""
    ? url.replace(/\/+$/, "")
    : `${parsed.origin}/api/auth`;
}
