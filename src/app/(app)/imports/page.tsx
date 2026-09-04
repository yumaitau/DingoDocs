import { hasPermission, type Role } from "@/lib/permissions/matrix";
import { db } from "@/db";
import { engagements } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { importAdapterNames } from "@/lib/imports/adapters";
import { requirePermission } from "@/lib/permissions/require";
import { previewScannerImportAction } from "@/server/actions/data-exchange";

export default async function ImportsPage() {
  const context = await requirePermission("finding:create");
  const rows = await db
    .select({
      id: engagements.id,
      name: engagements.name,
      reference: engagements.reference,
    })
    .from(engagements)
    .where(
      and(
        eq(engagements.organisationId, context.organisationId),
        isNull(engagements.deletedAt),
      ),
    )
    .orderBy(asc(engagements.name));
  return (
    <>
      <PageHeader
        title="Imports and exports"
        description="Preview scanner data before selective import, or export organisation data."
      />
      <div className="grid gap-6 px-4 py-6 lg:grid-cols-2 sm:px-6 lg:px-8">
        <section className="rounded-xl border bg-paper p-5">
          <h2 className="font-semibold">Scanner import</h2>
          <p className="mt-1 text-sm text-slate-500">
            The original file is preserved as internal evidence. Preview remains
            selective in the UI. Scanner MCP ingest auto-applies new records as
            draft findings and writes a testing-journal note; nothing is
            published to the client.
          </p>
          <form action={previewScannerImportAction} className="mt-5 space-y-4">
            <label className="block text-sm font-medium">
              Engagement
              <select
                name="engagementId"
                required
                className="mt-1 min-h-11 w-full rounded-md border bg-paper px-3"
              >
                <option value="">Select engagement</option>
                {rows.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.reference} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Source format
              <select
                name="adapter"
                required
                className="mt-1 min-h-11 w-full rounded-md border bg-paper px-3"
              >
                {importAdapterNames.map((name) => (
                  <option key={name} value={name}>
                    {name.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Scanner file
              <input
                type="file"
                name="file"
                required
                accept=".xml,.nessus,.csv,.json,.jsonl,.txt"
                className="mt-1 block w-full text-sm"
              />
            </label>
            <Button type="submit">Validate and preview</Button>
          </form>
        </section>
        <section className="rounded-xl border bg-paper p-5">
          <h2 className="font-semibold">Organisation exports</h2>
          <p className="mt-1 text-sm text-slate-500">
            Data exports include operational records and evidence metadata.
            Migration exports add templates, notes, and member mappings.
          </p>
          {hasPermission(context.role as Role, "organisation:export") && (
            <div className="mt-5 flex flex-wrap gap-3">
              <form action="/api/exports/organisation?mode=data" method="post">
                <Button type="submit" variant="secondary">
                  Download data export
                </Button>
              </form>
              <form
                action="/api/exports/organisation?mode=migration"
                method="post"
              >
                <Button type="submit">Download migration export</Button>
              </form>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
