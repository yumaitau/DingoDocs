import {
  authenticateScimRequest,
  disableScimUser,
  getScimUser,
  patchScimUser,
  ScimAuthError,
  scimError,
  ScimRequestError,
} from "@/server/services/scim";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** Non-UUID ids cannot exist; answer 404 rather than a Postgres cast error. */
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const context = await authenticateScimRequest(request);
    if (!uuidPattern.test(id)) return scimError(404, "User not found");
    const resource = await getScimUser(context.organisationId, id);
    if (!resource) return scimError(404, "User not found");
    return Response.json(resource, {
      headers: { "content-type": "application/scim+json" },
    });
  } catch (error) {
    if (error instanceof ScimAuthError) return scimError(401, error.message);
    if (error instanceof ScimRequestError)
      return scimError(error.status, error.message, error.scimType);
    return scimError(
      500,
      error instanceof Error ? error.message : "SCIM get failed",
    );
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const context = await authenticateScimRequest(request);
    if (!uuidPattern.test(id)) return scimError(404, "User not found");
    const payload = (await request.json()) as {
      Operations?: Array<{ op: string; path?: string; value?: unknown }>;
    };
    const resource = await patchScimUser(
      context.organisationId,
      id,
      payload.Operations ?? [],
    );
    if (!resource) return scimError(404, "User not found");
    return Response.json(resource, {
      headers: { "content-type": "application/scim+json" },
    });
  } catch (error) {
    if (error instanceof ScimAuthError) return scimError(401, error.message);
    if (error instanceof ScimRequestError)
      return scimError(error.status, error.message, error.scimType);
    return scimError(
      400,
      error instanceof Error ? error.message : "SCIM patch failed",
    );
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const context = await authenticateScimRequest(request);
    if (!uuidPattern.test(id)) return scimError(404, "User not found");
    const resource = await disableScimUser(context.organisationId, id);
    if (!resource) return scimError(404, "User not found");
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ScimAuthError) return scimError(401, error.message);
    if (error instanceof ScimRequestError)
      return scimError(error.status, error.message, error.scimType);
    return scimError(
      500,
      error instanceof Error ? error.message : "SCIM delete failed",
    );
  }
}
