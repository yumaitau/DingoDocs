import {
  authenticateScimRequest,
  disableScimUser,
  getScimUser,
  patchScimUser,
  ScimAuthError,
  scimError,
} from "@/server/services/scim";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const context = await authenticateScimRequest(request);
    const resource = await getScimUser(context.organisationId, id);
    if (!resource) return scimError(404, "User not found");
    return Response.json(resource, {
      headers: { "content-type": "application/scim+json" },
    });
  } catch (error) {
    if (error instanceof ScimAuthError) return scimError(401, error.message);
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
    const resource = await disableScimUser(context.organisationId, id);
    if (!resource) return scimError(404, "User not found");
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ScimAuthError) return scimError(401, error.message);
    return scimError(
      500,
      error instanceof Error ? error.message : "SCIM delete failed",
    );
  }
}
