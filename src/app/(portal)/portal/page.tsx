import { ArrowRight, CalendarDays, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { formatDate } from "@/lib/utils";
import { listPortalEngagements } from "@/server/services/client-portal";
import { globalSearch } from "@/server/services/global-search";

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const actor = await requireOrganisationContext();
  const query = (await searchParams).q?.trim() ?? "";
  const [engagements, results] = await Promise.all([
    listPortalEngagements(actor),
    query.length >= 2 ? globalSearch(actor, query) : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-[var(--harbour-700)]">
          Client portal
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Your engagements
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Review approved scope, published findings, remediation, and reports
          shared with your account.
        </p>
      </div>
      <form className="flex max-w-xl gap-2" action="/portal">
        <label className="sr-only" htmlFor="portal-search">
          Search shared records
        </label>
        <input
          id="portal-search"
          name="q"
          defaultValue={query}
          placeholder="Search shared engagements, findings, scope, evidence, reports, and tasks"
          className="min-h-11 min-w-0 flex-1 rounded-md border bg-paper px-3 text-sm"
        />
        <button className="rounded-md bg-primary px-4 text-sm font-medium text-white">
          Search
        </button>
      </form>
      {query && (
        <section className="rounded-xl border bg-paper">
          <div className="border-b p-4">
            <h2 className="font-semibold">Search results</h2>
            <p className="text-xs text-slate-500">
              Only explicitly shared records are searched.
            </p>
          </div>
          {results.length ? (
            <ul className="divide-y">
              {results.map((result) => (
                <li key={`${result.type}-${result.id}`}>
                  <Link
                    href={result.href}
                    className="flex items-center justify-between gap-3 p-4 hover:bg-muted"
                  >
                    <span>
                      <span className="block text-sm font-medium">
                        {result.title}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {result.subtitle}
                      </span>
                    </span>
                    <span className="text-[10px] uppercase text-slate-400">
                      {result.type}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-slate-500">
              No shared records match “{query}”.
            </p>
          )}
        </section>
      )}
      {engagements.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {engagements.map((engagement) => (
            <li key={engagement.id}>
              <Link
                href={`/portal/engagements/${engagement.id}`}
                className="group block h-full rounded-xl border bg-paper p-5 shadow-sm transition hover:border-[var(--harbour-300)] hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {engagement.clientName} · {engagement.reference}
                    </p>
                    <h2 className="mt-2 text-lg font-semibold">
                      {engagement.name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {engagement.type}
                    </p>
                  </div>
                  <ArrowRight className="mt-1 size-5 text-slate-400 transition group-hover:translate-x-1 group-hover:text-[var(--harbour-600)]" />
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <span className="rounded-full bg-muted px-2.5 py-1 font-medium capitalize">
                    {engagement.status.replaceAll("_", " ")}
                  </span>
                  {(engagement.startDate || engagement.endDate) && (
                    <span className="flex items-center gap-1.5">
                      <CalendarDays className="size-3.5" />
                      {engagement.startDate
                        ? formatDate(engagement.startDate)
                        : "TBC"}{" "}
                      –{" "}
                      {engagement.endDate
                        ? formatDate(engagement.endDate)
                        : "TBC"}
                    </span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <section className="rounded-xl border border-dashed bg-paper p-10 text-center">
          <ShieldCheck className="mx-auto size-9 text-slate-400" />
          <h2 className="mt-3 font-semibold">
            No engagements have been shared
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Ask your security contact to grant this account access.
          </p>
        </section>
      )}
    </div>
  );
}
