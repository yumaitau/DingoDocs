import { and, eq, isNull, sql } from "drizzle-orm";
import { SAML, ValidateInResponseTo } from "@node-saml/node-saml";
import { db } from "@/db";
import { organisations, users, type SecurityPolicy } from "@/db/schema";

export const runtime = "nodejs";

/**
 * Per-org SAML ACS. Validates the assertion with the organisation IdP
 * certificate. Interactive better-auth session minting is not wired here —
 * forging a session cookie would be unsafe.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const samlResponse = form.get("SAMLResponse");
  if (typeof samlResponse !== "string" || !samlResponse.trim()) {
    return new Response("SAMLResponse required", { status: 401 });
  }
  const relayState =
    typeof form.get("RelayState") === "string"
      ? String(form.get("RelayState"))
      : "";

  const organisation = await resolveOrganisation(relayState);
  if (!organisation) {
    return new Response("Organisation SSO configuration not found", {
      status: 401,
    });
  }
  const sso = organisation.securityPolicy.sso;
  if (
    !sso ||
    sso.protocol !== "saml" ||
    !sso.certificate?.trim() ||
    !sso.entryPoint?.trim() ||
    !sso.issuer?.trim()
  ) {
    return new Response("SAML is not configured for this organisation", {
      status: 401,
    });
  }

  const callbackUrl = new URL("/api/auth/saml/acs", request.url).toString();
  const saml = new SAML({
    idpCert: normalizePem(sso.certificate),
    issuer: sso.issuer,
    callbackUrl,
    entryPoint: sso.entryPoint,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    audience: false,
    validateInResponseTo: ValidateInResponseTo.never,
  });

  let profileEmail: string | undefined;
  try {
    const { profile, loggedOut } = await saml.validatePostResponseAsync({
      SAMLResponse: samlResponse,
      ...(relayState ? { RelayState: relayState } : {}),
    });
    if (loggedOut || !profile) {
      return new Response("SAML assertion did not yield a user profile", {
        status: 401,
      });
    }
    profileEmail =
      (typeof profile.email === "string" && profile.email) ||
      (typeof profile.nameID === "string" && profile.nameID.includes("@")
        ? profile.nameID
        : undefined) ||
      undefined;
    if (!profileEmail) {
      return new Response("SAML assertion missing email attribute", {
        status: 401,
      });
    }
  } catch {
    return new Response("SAML assertion validation failed", { status: 401 });
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.email, profileEmail.toLowerCase()))
    .limit(1);
  if (!user || user.disabledAt) {
    return new Response("User not found or disabled", { status: 401 });
  }

  // Validation succeeded. better-auth has no safe public API here to mint an
  // interactive session without forging cookies / bypassing MFA plugins.
  return new Response(
    "SAML assertion validated but interactive session handoff is not wired",
    { status: 501 },
  );
}

async function resolveOrganisation(relayState: string) {
  if (relayState) {
    const [byId] = await db
      .select({
        id: organisations.id,
        securityPolicy: organisations.securityPolicy,
      })
      .from(organisations)
      .where(
        and(eq(organisations.id, relayState), isNull(organisations.deletedAt)),
      )
      .limit(1);
    if (byId?.securityPolicy?.sso?.protocol === "saml") {
      return {
        id: byId.id,
        securityPolicy: (byId.securityPolicy ?? {}) as SecurityPolicy,
      };
    }
  }

  const rows = await db
    .select({
      id: organisations.id,
      securityPolicy: organisations.securityPolicy,
    })
    .from(organisations)
    .where(
      and(
        isNull(organisations.deletedAt),
        sql`${organisations.securityPolicy} -> 'sso' ->> 'protocol' = 'saml'`,
      ),
    )
    .limit(25);
  if (rows.length === 1) {
    return {
      id: rows[0].id,
      securityPolicy: (rows[0].securityPolicy ?? {}) as SecurityPolicy,
    };
  }
  return null;
}

function normalizePem(value: string) {
  const trimmed = value.trim();
  if (trimmed.includes("BEGIN CERTIFICATE")) return trimmed;
  const body = trimmed.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----`;
}
