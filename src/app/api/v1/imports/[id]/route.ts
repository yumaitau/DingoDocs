import { NextResponse } from "next/server";
import { z } from "zod";
import { apiReadContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import { getImportPreview } from "@/server/services/data-exchange";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id } = await context.params;
    z.string().uuid().parse(id);
    const principal = await apiReadContext(request, "findings:read");
    const preview = await getImportPreview(principal, id);
    return NextResponse.json({ data: preview, requestId });
  } catch (error) {
    return apiError(error, requestId);
  }
}
