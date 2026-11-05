import { z } from "zod";
import { apiError } from "@/lib/api/responses";
import {
  requireOrganisationContext,
  runInOrganisation,
} from "@/lib/permissions/require";
import { globalSearch } from "@/server/services/global-search";

export async function GET(request: Request) {
  try {
    const context = await requireOrganisationContext();
    const query = z
      .string()
      .max(200)
      .parse(new URL(request.url).searchParams.get("q") ?? "");
    return Response.json(
      {
        results: await runInOrganisation(context, () =>
          globalSearch(context, query),
        ),
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error, request.headers.get("x-request-id"));
  }
}
