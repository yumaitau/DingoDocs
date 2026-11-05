import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint, getIP, isAPIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { z } from "zod";
import { activeOrganisationCookie } from "@/lib/auth/active-organisation";
import {
  createSamlRequestCache,
  reserveSamlAssertionId,
  SAML_REQUEST_TTL_MS,
} from "@/lib/auth/saml-cache";
import {
  checkSignedAssertion,
  createSamlClient,
  newSamlRequestId,
  SAML_REQUEST_COOKIE,
  samlIdentity,
  samlPolicy,
  serviceProviderMetadata,
  signRelayState,
  verifyRelayState,
} from "@/lib/auth/saml-config";
import {
  ORGANISATION_SLUG_PATTERN,
  SAML_ACS_PATH,
  SAML_LOGIN_PATH,
  SAML_METADATA_PATH,
  SAML_PATH_PREFIX,
  SSO_CONTINUE_PATH,
  SSO_DISCOVER_PATH,
  SSO_ERROR_METHOD,
  SSO_FAILED_ERROR,
  samlServiceProviderUrls,
} from "@/lib/auth/saml-paths";
import { SECOND_FACTOR_REQUIRED_ERROR } from "@/lib/auth/second-factor-session-guard";
import { safeInternalPath } from "@/lib/security/internal-path";
import { emailDomain } from "@/server/services/domain-verification";
import {
  auditSaml,
  findSamlOrganisationByDomain,
  findSamlOrganisationBySlug,
  resolveSamlSignIn,
  type SamlRequestMeta,
} from "@/server/services/saml-sso";

const MAX_SAML_RESPONSE_LENGTH = 512 * 1_024;
const DISCOVERY_TICKET_TTL_MS = 5 * 60 * 1_000;
const SLUG_PAD = 100;

type EndpointContext = {
  context: { baseURL: string; secret: string };
  redirect: (url: string) => unknown;
  setSignedCookie: (
    key: string,
    value: string,
    secret: string,
    options: Record<string, unknown>,
  ) => Promise<unknown>;
};

function appOrigin(ctx: EndpointContext) {
  return new URL(ctx.context.baseURL).origin;
}

/** Every SSO failure looks the same to the browser. */
function failure(ctx: EndpointContext, error = SSO_FAILED_ERROR) {
  const url = new URL("/sign-in", appOrigin(ctx));
  url.searchParams.set("error", error);
  if (error !== SSO_FAILED_ERROR)
    url.searchParams.set("method", SSO_ERROR_METHOD);
  return ctx.redirect(url.toString());
}

function validSlug(slug: string | undefined): slug is string {
  return Boolean(slug && ORGANISATION_SLUG_PATTERN.test(slug));
}

async function startLogin(
  ctx: EndpointContext,
  slug: string | undefined,
  callbackURL: string | undefined,
) {
  if (!validSlug(slug)) throw failure(ctx);
  const organisation = await findSamlOrganisationBySlug(slug);
  const sso = samlPolicy(organisation?.securityPolicy);
  if (!organisation || !sso) throw failure(ctx);
  const requestId = newSamlRequestId();
  const saml = createSamlClient({
    authBaseURL: ctx.context.baseURL,
    slug: organisation.slug,
    sso,
    cacheProvider: createSamlRequestCache(organisation.id),
    requestId,
  });
  const relayState = signRelayState({
    secret: ctx.context.secret,
    organisationId: organisation.id,
    callbackURL: safeInternalPath(callbackURL),
  });
  let url: string;
  try {
    url = await saml.getAuthorizeUrlAsync(relayState, undefined, {});
  } catch {
    // A malformed entry point; the admin sees it in Settings, not the user.
    throw failure(ctx);
  }
  // The IdP posts back cross-site, so only SameSite=None reaches the ACS.
  // Browsers accept Secure cookies on https and on http://localhost.
  await ctx.setSignedCookie(
    SAML_REQUEST_COOKIE,
    requestId,
    ctx.context.secret,
    {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: acsCookiePath(ctx, organisation.slug),
      maxAge: SAML_REQUEST_TTL_MS / 1_000,
    },
  );
  throw ctx.redirect(url);
}

function acsCookiePath(ctx: EndpointContext, slug: string) {
  return new URL(samlServiceProviderUrls(ctx.context.baseURL, slug).acsUrl)
    .pathname;
}

/**
 * First-party per-organisation SAML 2.0 service provider. Sessions are minted
 * with internalAdapter.createSession, so databaseHooks (second-factor guard,
 * banned-user check, session audit) run exactly as for other sign-ins.
 */
export const samlSso = () =>
  ({
    id: "dingodocs-saml",
    init(ctx) {
      // The IdP posts the ACS cross-site, so Better Auth's Origin check would
      // refuse any browser that already holds a cookie for this site. The
      // signed assertion plus a single-use InResponseTo is the CSRF defence
      // there. Only POSTs are origin-checked, and the only POST under this
      // prefix is the ACS. Test environments already skip every check.
      const skip = ctx.skipOriginCheck;
      if (skip === true) return;
      return {
        context: {
          skipOriginCheck: [
            ...(Array.isArray(skip) ? skip : []),
            SAML_PATH_PREFIX,
          ],
        },
      };
    },
    endpoints: {
      samlLogin: createAuthEndpoint(
        SAML_LOGIN_PATH,
        {
          method: "GET",
          query: z
            .object({ callbackURL: z.string().max(2_048).optional() })
            .optional(),
        },
        async (ctx) =>
          startLogin(ctx, ctx.params.orgSlug, ctx.query?.callbackURL),
      ),

      samlMetadata: createAuthEndpoint(
        SAML_METADATA_PATH,
        { method: "GET" },
        async (ctx) => {
          // Derived only from the slug, so it reveals nothing about whether
          // the organisation exists and works before the IdP is configured.
          if (!validSlug(ctx.params.orgSlug))
            return new Response("Not found", { status: 404 });
          return new Response(
            serviceProviderMetadata(ctx.context.baseURL, ctx.params.orgSlug),
            {
              headers: {
                "content-type": "application/samlmetadata+xml; charset=utf-8",
                "cache-control": "public, max-age=300",
              },
            },
          );
        },
      ),

      samlAcs: createAuthEndpoint(
        SAML_ACS_PATH,
        {
          method: "POST",
          body: z
            .object({
              SAMLResponse: z.string().optional(),
              RelayState: z.string().max(4_096).optional(),
            })
            .optional(),
          metadata: {
            allowedMediaTypes: [
              "application/x-www-form-urlencoded",
              "multipart/form-data",
            ],
          },
        },
        async (ctx) => {
          const slug = ctx.params.orgSlug;
          // The organisation comes from the path, never from RelayState.
          if (!validSlug(slug)) throw failure(ctx);
          const organisation = await findSamlOrganisationBySlug(slug);
          const sso = samlPolicy(organisation?.securityPolicy);
          if (!organisation || !sso) throw failure(ctx);
          const meta: SamlRequestMeta = {
            ipAddress: ctx.request
              ? getIP(ctx.request, ctx.context.options)
              : null,
            userAgent: ctx.headers?.get("user-agent"),
            requestId: ctx.headers?.get("x-request-id"),
          };
          const reject = async (
            reason: string,
            userId?: string,
            error = SSO_FAILED_ERROR,
          ) => {
            await auditSaml(organisation.id, "sso.saml.rejected", {
              userId,
              meta,
              metadata: { reason },
            });
            return failure(ctx, error);
          };

          const samlResponse = ctx.body?.SAMLResponse;
          if (!samlResponse || samlResponse.length > MAX_SAML_RESPONSE_LENGTH)
            throw await reject("missing_response");
          const saml = createSamlClient({
            authBaseURL: ctx.context.baseURL,
            slug: organisation.slug,
            sso,
            cacheProvider: createSamlRequestCache(organisation.id),
          });
          let profile;
          try {
            const result = await saml.validatePostResponseAsync({
              SAMLResponse: samlResponse,
            });
            if (result.loggedOut || !result.profile)
              throw new Error("No assertion");
            profile = result.profile;
          } catch (error) {
            throw await reject(
              `invalid_response: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`,
            );
          }
          if (profile.issuer !== sso.issuer.trim())
            throw await reject("issuer_mismatch");
          // Bind SP-initiated responses to the browser that started them, so
          // a response captured by one user can't sign in another (login CSRF).
          const inResponseTo =
            typeof profile.inResponseTo === "string"
              ? profile.inResponseTo
              : undefined;
          if (inResponseTo) {
            const bound = await ctx.getSignedCookie(
              SAML_REQUEST_COOKIE,
              ctx.context.secret,
            );
            if (!bound || bound !== inResponseTo)
              throw await reject("request_not_bound_to_browser");
          }
          ctx.setCookie(SAML_REQUEST_COOKIE, "", {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            path: acsCookiePath(ctx, organisation.slug),
            maxAge: 0,
          });
          // node-saml skips timestamps it doesn't find; enforce them on the
          // signed assertion before anything is reserved or resolved.
          const assertion = await checkSignedAssertion({
            assertionXml: profile.getAssertionXml?.(),
            acsUrl: samlServiceProviderUrls(
              ctx.context.baseURL,
              organisation.slug,
            ).acsUrl,
            inResponseTo,
          });
          if (!assertion.ok) throw await reject(assertion.reason);
          if (
            !(await reserveSamlAssertionId(
              organisation.id,
              assertion.id,
              assertion.replayUntil,
            ))
          )
            throw await reject("replayed_assertion");

          const resolution = await resolveSamlSignIn({
            organisation,
            sso,
            identity: samlIdentity(profile, sso),
            meta,
            adapter: {
              createUser: (data) =>
                ctx.context.internalAdapter.createUser(data, {
                  method: "sso-saml",
                  sso: { providerId: `saml:${organisation.id}` },
                }),
              linkAccount: (data) =>
                ctx.context.internalAdapter.linkAccount(data),
            },
          });
          if (!resolution.ok)
            throw await reject(
              resolution.reason,
              resolution.userId,
              resolution.reason === "two_factor_required"
                ? SECOND_FACTOR_REQUIRED_ERROR
                : SSO_FAILED_ERROR,
            );

          let session;
          try {
            session = await ctx.context.internalAdapter.createSession(
              resolution.userId,
            );
          } catch (error) {
            // The second-factor guard answers with a sign-in redirect.
            if (isAPIError(error) && error.status === "FOUND") {
              await auditSaml(organisation.id, "sso.saml.rejected", {
                userId: resolution.userId,
                meta,
                metadata: { reason: "session_guard" },
              });
              throw error;
            }
            throw await reject("session_refused", resolution.userId);
          }
          const user = await ctx.context.internalAdapter.findUserById(
            resolution.userId,
          );
          if (!session || !user)
            throw await reject("session_refused", resolution.userId);
          await setSessionCookie(ctx, { session, user });
          ctx.setCookie(activeOrganisationCookie, organisation.id, {
            httpOnly: true,
            sameSite: "lax",
            secure: ctx.context.authCookies.sessionToken.attributes.secure,
            path: "/",
            maxAge: 60 * 60 * 24 * 30,
          });
          await auditSaml(organisation.id, "sso.saml.signed_in", {
            userId: resolution.userId,
            meta,
            metadata: {
              sessionId: session.id,
              provisioned: resolution.provisioned,
            },
          });
          const destination = verifyRelayState({
            secret: ctx.context.secret,
            organisationId: organisation.id,
            relayState: ctx.body?.RelayState,
          });
          throw ctx.redirect(new URL(destination, appOrigin(ctx)).toString());
        },
      ),

      ssoDiscover: createAuthEndpoint(
        SSO_DISCOVER_PATH,
        {
          method: "POST",
          body: z.object({
            email: z.string().max(320),
            callbackURL: z.string().max(2_048).optional(),
          }),
        },
        async (ctx) => {
          // Always the same response shape: an opaque, encrypted continue
          // ticket, so the caller can't tell whether the domain uses SSO.
          const domain = emailDomain(ctx.body.email.trim().toLowerCase());
          const slug = domain
            ? await findSamlOrganisationByDomain(domain)
            : null;
          const ticket = await symmetricEncrypt({
            key: ctx.context.secret,
            data: JSON.stringify({
              s: (slug ?? "").padEnd(SLUG_PAD, " "),
              c: safeInternalPath(ctx.body.callbackURL),
              e: Date.now() + DISCOVERY_TICKET_TTL_MS,
            }),
          });
          const url = new URL(`${ctx.context.baseURL}${SSO_CONTINUE_PATH}`);
          url.searchParams.set("ticket", ticket);
          return ctx.json({ url: url.toString() });
        },
      ),

      ssoContinue: createAuthEndpoint(
        SSO_CONTINUE_PATH,
        {
          method: "GET",
          query: z.object({ ticket: z.string().max(4_096) }).optional(),
        },
        async (ctx) => {
          let slug: string | undefined;
          let callbackURL: string | undefined;
          try {
            const parsed = JSON.parse(
              await symmetricDecrypt({
                key: ctx.context.secret,
                data: ctx.query?.ticket ?? "",
              }),
            ) as { s?: string; c?: string; e?: number };
            if (typeof parsed.e === "number" && parsed.e > Date.now()) {
              slug = parsed.s?.trim() || undefined;
              callbackURL = parsed.c;
            }
          } catch {
            slug = undefined;
          }
          return startLogin(ctx, slug, callbackURL);
        },
      ),
    },
    rateLimit: [
      {
        // Per IP and path. Generous enough for a whole office behind one NAT.
        pathMatcher: (path: string) => path.startsWith("/sso/"),
        window: 60,
        max: 60,
      },
    ],
  }) satisfies BetterAuthPlugin;
