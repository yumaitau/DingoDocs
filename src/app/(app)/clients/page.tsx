import { Building2, Plus, Search } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { listClients } from "@/server/repositories/tenant";

export default async function ClientsPage() {
  const context = await requireOrganisationContext();
  const rows = await listClients(context);
  return (
    <>
      <PageHeader
        title="Clients"
        description="Organisations whose assessment work and reporting you manage."
        actions={
          <Button asChild>
            <Link href="/clients/new">
              <Plus className="size-4" />
              New client
            </Link>
          </Button>
        }
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <span className="sr-only">Search clients</span>
            <input
              placeholder="Search clients"
              className="h-9 w-full rounded-md border bg-paper pl-9 pr-3 text-sm"
            />
          </label>
          <span className="text-xs text-slate-500">{rows.length} clients</span>
        </div>
        <div className="overflow-hidden rounded-xl border bg-paper">
          {rows.length ? (
            <div className="divide-y">
              {rows.map((client) => (
                <Link
                  href={`/clients/${client.id}`}
                  key={client.id}
                  className="grid gap-3 p-4 hover:bg-[var(--harbour-50)] sm:grid-cols-[minmax(0,1fr)_180px_170px] sm:items-center"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-slate-500">
                      <Building2 className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {client.name}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-slate-500">
                        {client.legalName ?? "Legal name not set"}
                      </div>
                    </div>
                  </div>
                  <span className="text-sm text-slate-600">
                    {client.industry ?? "Industry not set"}
                  </span>
                  <span className="text-xs text-slate-500">
                    {client.securityClassification}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              title="No clients yet"
              body="Create a client before planning its first engagement."
            />
          )}
        </div>
      </div>
    </>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-5 py-16 text-center">
      <Building2 className="mx-auto size-7 text-slate-400" />
      <h2 className="mt-3 text-sm font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{body}</p>
    </div>
  );
}
