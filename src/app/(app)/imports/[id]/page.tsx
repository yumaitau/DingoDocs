import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/permissions/require";
import { applyScannerImportAction } from "@/server/actions/data-exchange";
import {
  ExchangeScopeError,
  getImportPreview,
} from "@/server/services/data-exchange";

export default async function ImportPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requirePermission("finding:create");
  let preview: Awaited<ReturnType<typeof getImportPreview>>;
  try {
    preview = await getImportPreview(context, id);
  } catch (error) {
    if (error instanceof ExchangeScopeError) notFound();
    throw error;
  }
  return (
    <>
      <PageHeader
        title={`Import preview · ${preview.run.adapter.toUpperCase()}`}
        description={`${preview.run.sourceFilename} · SHA-256 ${preview.run.sourceSha256}`}
        breadcrumbs={[
          { label: "Imports", href: "/imports" },
          { label: "Preview" },
        ]}
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <form
          action={applyScannerImportAction.bind(null, id)}
          className="rounded-xl border bg-paper"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
            <div>
              <h2 className="font-semibold">
                {preview.run.summary.total} records
              </h2>
              <p className="text-sm text-slate-500">
                {preview.run.summary.new} new · {preview.run.summary.duplicate}{" "}
                duplicates
              </p>
            </div>
            {preview.run.status === "previewed" && (
              <Button type="submit">Import selected</Button>
            )}
          </div>
          <ul className="divide-y">
            {preview.items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 p-4">
                <input
                  type="checkbox"
                  name="itemIds"
                  value={item.id}
                  defaultChecked={item.selected}
                  disabled={
                    item.action === "duplicate" ||
                    preview.run.status !== "previewed"
                  }
                  aria-label={`Import ${item.title}`}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.assetIdentifier || "No asset"} · {item.severity} ·{" "}
                    {item.action}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </form>
      </div>
    </>
  );
}
