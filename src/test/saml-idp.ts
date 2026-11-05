import {
  generateKeyPairSync,
  randomBytes,
  sign,
  X509Certificate,
  type KeyObject,
} from "node:crypto";
// node-saml has no exports map; signXml wraps its own xml-crypto dependency.
import { signXml } from "@node-saml/node-saml/lib/xml";

/**
 * A throwaway SAML identity provider for tests: an RSA key, a self-signed
 * X.509 certificate built with node:crypto, and signed SAML responses.
 */

function derLength(length: number) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let n = length; n > 0; n >>= 8) bytes.unshift(n & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, ...parts: Buffer[]) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

const sequence = (...parts: Buffer[]) => der(0x30, ...parts);

function integer(value: Buffer) {
  return der(
    0x02,
    value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value,
  );
}

function objectId(dotted: string) {
  const [first, second, ...rest] = dotted.split(".").map(Number);
  const bytes = [40 * first + second];
  for (const arc of rest) {
    const chunk = [arc & 0x7f];
    for (let n = arc >> 7; n > 0; n >>= 7) chunk.unshift((n & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
}

function utcTime(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = `${pad(date.getUTCFullYear() % 100)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return der(0x17, Buffer.from(text));
}

function commonName(cn: string) {
  return sequence(
    der(0x31, sequence(objectId("2.5.4.3"), der(0x0c, Buffer.from(cn)))),
  );
}

function selfSignedCertificate(
  publicKey: KeyObject,
  privateKey: KeyObject,
  cn: string,
) {
  const sha256WithRsa = sequence(
    objectId("1.2.840.113549.1.1.11"),
    Buffer.from([0x05, 0x00]),
  );
  const now = Date.now();
  const tbs = sequence(
    der(0xa0, integer(Buffer.from([2]))),
    integer(randomBytes(8)),
    sha256WithRsa,
    commonName(cn),
    sequence(
      utcTime(new Date(now - 60_000)),
      utcTime(new Date(now + 86_400_000)),
    ),
    commonName(cn),
    publicKey.export({ type: "spki", format: "der" }),
  );
  const signature = sign("sha256", tbs, privateKey);
  const certificate = sequence(
    tbs,
    sha256WithRsa,
    der(0x03, Buffer.concat([Buffer.from([0]), signature])),
  );
  const body = certificate
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n");
  const pem = `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`;
  new X509Certificate(pem); // fail fast if the encoding is wrong
  return pem;
}

export type TestIdp = {
  entityId: string;
  entryPoint: string;
  certificate: string;
  privateKey: string;
};

export function createTestIdp(
  entityId = "https://idp.test.invalid/metadata",
): TestIdp {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    entityId,
    entryPoint: "https://idp.test.invalid/sso",
    certificate: selfSignedCertificate(
      publicKey,
      privateKey,
      "DingoDocs Test IdP",
    ),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type TestAssertion = {
  audience: string;
  acsUrl: string;
  nameID: string;
  inResponseTo?: string;
  attributes?: Record<string, string | string[]>;
  issuer?: string;
  assertionId?: string;
  notOnOrAfter?: Date;
  /** Bearer SubjectConfirmationData NotOnOrAfter (default: notOnOrAfter). */
  bearerNotOnOrAfter?: Date;
  /** Omit NotBefore/NotOnOrAfter from Conditions, keeping the audience. */
  conditionsWithoutTimes?: boolean;
  /** IssueInstant of the response and assertion (default: now). */
  issuedAt?: Date;
  /** SubjectConfirmationData Recipient (default: acsUrl). */
  recipient?: string;
  /** Sign with a different key than the one the SP trusts. */
  signingKey?: string;
};

/** Base64 SAMLResponse with a signed assertion, as an IdP would POST it. */
export function buildSamlResponse(idp: TestIdp, input: TestAssertion) {
  const now = input.issuedAt ?? new Date();
  const instant = now.toISOString();
  const notBefore = new Date(now.getTime() - 30_000).toISOString();
  const notOnOrAfter = (
    input.notOnOrAfter ?? new Date(now.getTime() + 5 * 60_000)
  ).toISOString();
  const bearerNotOnOrAfter = (
    input.bearerNotOnOrAfter ?? new Date(notOnOrAfter)
  ).toISOString();
  const conditionTimes = input.conditionsWithoutTimes
    ? ""
    : ` NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"`;
  const issuer = escapeXml(input.issuer ?? idp.entityId);
  const inResponseTo = input.inResponseTo
    ? ` InResponseTo="${escapeXml(input.inResponseTo)}"`
    : "";
  const assertionId =
    input.assertionId ?? `_a${randomBytes(16).toString("hex")}`;
  const attributes = Object.entries(input.attributes ?? {})
    .map(
      ([name, value]) =>
        `<saml:Attribute Name="${escapeXml(name)}">${(Array.isArray(value)
          ? value
          : [value]
        )
          .map(
            (item) =>
              `<saml:AttributeValue>${escapeXml(item)}</saml:AttributeValue>`,
          )
          .join("")}</saml:Attribute>`,
    )
    .join("");
  const xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomBytes(16).toString("hex")}" Version="2.0" IssueInstant="${instant}" Destination="${escapeXml(input.acsUrl)}"${inResponseTo}>` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    `<saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${instant}">` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${escapeXml(input.nameID)}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${bearerNotOnOrAfter}" Recipient="${escapeXml(input.recipient ?? input.acsUrl)}"${inResponseTo}/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions${conditionTimes}><saml:AudienceRestriction><saml:Audience>${escapeXml(input.audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${instant}" SessionIndex="_s${randomBytes(8).toString("hex")}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    (attributes
      ? `<saml:AttributeStatement>${attributes}</saml:AttributeStatement>`
      : "") +
    `</saml:Assertion></samlp:Response>`;
  const assertionXPath = "//*[local-name(.)='Assertion']";
  const signed = signXml(
    xml,
    assertionXPath,
    {
      reference: `${assertionXPath}/*[local-name(.)='Issuer']`,
      action: "after",
    },
    {
      privateKey: input.signingKey ?? idp.privateKey,
      publicCert: idp.certificate,
      signatureAlgorithm: "sha256",
      digestAlgorithm: "sha256",
    },
  );
  return Buffer.from(signed).toString("base64");
}
