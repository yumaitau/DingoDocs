"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { importAdapterNames } from "@/lib/imports/adapters";
import {
  requireInternalOrganisationContext,
  requirePermission,
} from "@/lib/permissions/require";
import {
  applyScannerImport,
  getImportPreview,
  importOrganisationBundle,
  mediaTypeForImport,
  previewScannerImport,
} from "@/server/services/data-exchange";

const id = z.string().uuid();

export type OrganisationImportState = {
  message?: string;
  error?: string;
};

export async function importOrganisationBundleAction(
  _state: OrganisationImportState,
  formData: FormData,
): Promise<OrganisationImportState> {
  try {
    const context = await requirePermission("organisation:export");
    const file = z.instanceof(File).parse(formData.get("file"));
    const text = await file.text();
    const counts = await importOrganisationBundle(context, text);
    revalidatePath("/imports");
    return {
      message: `Imported clients=${counts.clients} engagements=${counts.engagements} findings=${counts.findings} templates=${counts.templates} runbooks=${counts.runbooks} matrices=${counts.riskMatrices} (evidence binaries skipped=${counts.evidenceSkipped})`,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Organisation import failed",
    };
  }
}

export async function previewScannerImportAction(formData: FormData) {
  const engagementId = id.parse(formData.get("engagementId"));
  const context = await requirePermission("finding:create", { engagementId });
  const file = z.instanceof(File).parse(formData.get("file"));
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await previewScannerImport(context, {
    engagementId,
    adapter: z.enum(importAdapterNames).parse(formData.get("adapter")),
    filename: file.name,
    mediaType: file.type || mediaTypeForImport(file.name, bytes),
    bytes,
  });
  redirect(`/imports/${result.run.id}`);
}

export async function applyScannerImportAction(
  importRunId: string,
  formData: FormData,
) {
  const organisation = await requireInternalOrganisationContext();
  const preview = await getImportPreview(organisation, id.parse(importRunId));
  const context = await requirePermission("finding:create", {
    engagementId: preview.run.engagementId,
  });
  await applyScannerImport(context, {
    importRunId: id.parse(importRunId),
    selectedItemIds: formData
      .getAll("itemIds")
      .map(String)
      .map((value) => id.parse(value)),
  });
  revalidatePath(`/imports/${importRunId}`);
}
