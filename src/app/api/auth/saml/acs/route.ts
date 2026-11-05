export const runtime = "nodejs";

const message =
  "This SAML endpoint has moved. Each organisation now has its own ACS URL: " +
  "/api/auth/sso/saml/<organisation-slug>/acs. Copy it, the entity ID and the " +
  "metadata URL from Settings > Per-organisation SSO into your identity provider.";

/**
 * Retired shared ACS. It never created sessions, and the organisation came
 * from client-controlled RelayState, so nothing should still depend on it.
 */
function gone() {
  return new Response(message, {
    status: 410,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const GET = gone;
export const POST = gone;
