import { ArrowRight, CalendarDays, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { formatDate } from "@/lib/utils";
import { listPortalEngagements } from "@/server/services/client-portal";

export default async function PortalPage() {
  const actor = await requireOrganisationContext();
  const engagements = await listPortalEngagements(actor);
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
