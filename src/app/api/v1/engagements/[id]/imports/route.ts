import { NextResponse } from "next/server";
import { z } from "zod";
import { importAdapterNames } from "@/lib/imports/adapters";
import { apiWriteContext } from "@/lib/api/authentication";
import { apiError } from "@/lib/api/responses";
import {
  ingestScannerImport,
  mediaTypeForImport,
  previewScannerImport,
} from "@/server/services/data-exchange";

export const runtime = "nodejs";

const jsonSchema = z.object({
  adapter: z.enum(importAdapterNames),
  filename: z.string().trim().min(1).max(240).default("scanner-output.txt"),
  content: z.string().min(1).max(2_000_000),
  mode: z.enum(["preview", "ingest"]).default("ingest"),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = request.headers.get("x-request-id");
  try {
    const { id: engagementId } = await context.params;
    z.string().uuid().parse(engagementId);
    const principal = await apiWriteContext(
      request,
      "imports:write",
      "finding:create",
      {
        engagementId,
      },
    );
    if (!principal.userId)
      throw new Error("API key does not have an attributable owner");
    const actor = {
      organisationId: principal.organisationId,
      userId: principal.userId,
    };
    const contentType = request.headers.get("content-type") ?? "";
    const parsed = contentType.includes("multipart/form-data")
      ? await fromFormData(request)
      : jsonSchema.parse(await request.json());
    const bytes = new TextEncoder().encode(parsed.content);
    if (parsed.mode === "preview") {
      const preview = await previewScannerImport(actor, {
        engagementId,
        adapter: parsed.adapter,
        filename: parsed.filename,
        mediaType: mediaTypeForImport(parsed.filename, bytes),
        bytes,
      });
      return NextResponse.json(
        {
          data: {
            run: preview.run,
            items: preview.items,
            publication: "draft",
          },
          requestId,
        },
        { status: 201 },
      );
    }
    const ingested = await ingestScannerImport(actor, {
      engagementId,
      adapter: parsed.adapter,
      filename: parsed.filename,
      bytes,
    });
    return NextResponse.json(
      {
        data: {
          run: ingested.run,
          items: ingested.items,
          applied: ingested.applied,
          noteId: ingested.note.id,
          timelineId: ingested.timeline?.id,
          publication: ingested.publication,
          summary: ingested.summary,
        },
        requestId,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error, requestId);
  }
}

async function fromFormData(request: Request) {
  const form = await request.formData();
  const file = z
    .instanceof(File)
    .parse(form.get("file") ?? form.get("content"));
  return jsonSchema.parse({
    adapter: form.get("adapter"),
    filename: file.name || form.get("filename") || "scanner-output.txt",
    content: await file.text(),
    mode: form.get("mode") || "ingest",
  });
}
