import { CalendarDays, Plus, Search } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { formatDate } from "@/lib/utils";
import { listEngagements } from "@/server/repositories/tenant";

export default async function EngagementsPage() {
  const context = await requireOrganisationContext();
  const rows = await listEngagements(context);
  return (
    <>
      <PageHeader
        title="Engagements"
        description="Plan, deliver, review, and close professional security assessments."
        actions={
          <Button asChild>
            <Link href="/engagements/new">
              <Plus className="size-4" />
              New engagement
            </Link>
          </Button>
        }
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="relative mr-auto block w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <span className="sr-only">Search engagements</span>
            <input
              placeholder="Search engagements"
              className="h-9 w-full rounded-md border bg-paper pl-9 pr-3 text-sm"
            />
          </label>
          {["Active", "At risk", "Mine"].map((filter) => (
            <button
              key={filter}
              className="h-9 rounded-md border bg-paper px-3 text-xs font-medium text-slate-600 hover:bg-muted"
            >
              {filter}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border bg-paper">
          <table className="w-full min-w-[780px] text-left">
            <thead className="border-b bg-[var(--mist)] text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Engagement</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Dates</th>
                <th className="px-4 py-3 font-medium">Health</th>
                <th className="px-4 py-3 font-medium">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((engagement) => (
                <tr
                  key={engagement.id}
                  className="hover:bg-[var(--harbour-50)]"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/engagements/${engagement.id}`}
                      className="font-medium hover:underline"
                    >
                      {engagement.name}
                    </Link>
                    <div className="mt-1 font-mono text-xs text-slate-500">
                      {engagement.reference} · {engagement.type}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill tone="info">
                      {engagement.status.replaceAll("_", " ")}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <CalendarDays className="mr-1.5 inline size-3.5" />
                    {formatDate(engagement.startDate)} –{" "}
                    {formatDate(engagement.endDate)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill
                      tone={
                        engagement.health === "at_risk" ? "warning" : "success"
                      }
                    >
                      {engagement.health.replaceAll("_", " ")}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-28">
                      <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                        <span>{engagement.progress}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-[var(--harbour-500)]"
                          style={{ width: `${engagement.progress}%` }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? (
            <div className="px-5 py-16 text-center text-sm text-slate-500">
              No engagements yet. Create one to begin scoping.
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
