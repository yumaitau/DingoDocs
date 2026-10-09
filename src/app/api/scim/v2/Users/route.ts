import {
  authenticateScimRequest,
  createScimUser,
  listScimUsers,
  ScimAuthError,
  scimError,
} from "@/server/services/scim";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await authenticateScimRequest(request);
    const body = await listScimUsers(context.organisationId);
    return Response.json(body, {
      headers: { "content-type": "application/scim+json" },
    });
  } catch (error) {
    if (error instanceof ScimAuthError) return scimError(401, error.message);
    return scimError(
      500,
      error instanceof Error ? error.message : "SCIM list failed",
    );
  }
}

export async function POST(request: Request) {
  try {
    const context = await authenticateScimRequest(request);
    const payload = (await request.json()) as {
      userName?: string;
      name?: { formatted?: string };
      active?: boolean;
      password?: string;
    };
    if (!payload.userName) return scimError(400, "userName is required");
    const resource = await createScimUser(context.organisationId, {
      userName: payload.userName,
      name: payload.name?.formatted,
      active: payload.active,
    });
    // Never echo password even if supplied.
    return Response.json(resource, {
      status: 201,
      headers: { "content-type": "application/scim+json" },
    });
  } catch (error) {
    if (error instanceof ScimAuthError) return scimError(401, error.message);
    return scimError(
      400,
      error instanceof Error ? error.message : "SCIM create failed",
    );
  }
}
