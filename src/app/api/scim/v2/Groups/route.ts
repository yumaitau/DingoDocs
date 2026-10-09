import {
  authenticateScimRequest,
  listScimGroups,
  patchScimGroup,
  ScimAuthError,
  scimError,
} from "@/server/services/scim";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const context = await authenticateScimRequest(request);
    const body = listScimGroups(context.securityPolicy);
    return Response.json(body, {
      headers: { "content-type": "application/scim+json" },
    });
  } catch (error) {
    if (error instanceof ScimAuthError) return scimError(401, error.message);
    return scimError(
      500,
      error instanceof Error ? error.message : "SCIM groups list failed",
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await authenticateScimRequest(request);
    const payload = (await request.json()) as {
      id?: string;
      displayName?: string;
      Operations?: Array<{ op: string; path?: string; value?: unknown }>;
    };
    const groupId = payload.id ?? payload.displayName ?? "";
    if (!groupId) return scimError(400, "Group id or displayName required");
    const result = await patchScimGroup(context, groupId, payload);
    if (result.ignored) {
      return Response.json(
        {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
          id: Buffer.from(result.displayName).toString("base64url"),
          displayName: result.displayName,
          meta: { resourceType: "Group" },
        },
        { headers: { "content-type": "application/scim+json" } },
      );
    }
    return Response.json(result, {
      headers: { "content-type": "application/scim+json" },
    });
  } catch (error) {
    if (error instanceof ScimAuthError) return scimError(401, error.message);
    return scimError(
      400,
      error instanceof Error ? error.message : "SCIM group patch failed",
    );
  }
}
