"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { importAdapterNames } from "@/lib/imports/adapters";
import { requirePermission } from "@/lib/permissions/require";
import {
  applyScannerImport,
  previewScannerImport,
} from "@/server/services/data-exchange";

const id = z.string().uuid();
export async function previewScannerImportAction(formData: FormData) {
  const engagementId = id.parse(formData.get("engagementId"));
  const context = await requirePermission("finding:create", { engagementId });
  const file = z.instanceof(File).parse(formData.get("file"));
  const result = await previewScannerImport(context, {
    engagementId,
    adapter: z.enum(importAdapterNames).parse(formData.get("adapter")),
    filename: file.name,
    mediaType: file.type || mediaType(file.name),
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  redirect(`/imports/${result.run.id}`);
}

export async function applyScannerImportAction(
  importRunId: string,
  formData: FormData,
) {
  const context = await requirePermission("finding:create");
  await applyScannerImport(context, {
    importRunId: id.parse(importRunId),
    selectedItemIds: formData
      .getAll("itemIds")
      .map(String)
      .map((value) => id.parse(value)),
  });
  revalidatePath(`/imports/${importRunId}`);
}
function mediaType(filename: string) {
  return filename.toLowerCase().endsWith(".csv")
    ? "text/csv"
    : filename.toLowerCase().endsWith(".json")
      ? "application/json"
      : "application/xml";
}
