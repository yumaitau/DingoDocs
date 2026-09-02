import { and, desc, eq, isNull } from "drizzle-orm";
import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { db } from "@/db";
import { engagements, reportTemplates, reports } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { formatDateTime } from "@/lib/time-zone";
import { createReportAction } from "@/server/actions/reports";

export default async function ReportsPage() {
  const context = await requireOrganisationContext();
  const [rows, engagementRows, templates] = await Promise.all([
    db
      .select()
      .from(reports)
      .where(eq(reports.organisationId, context.organisationId))
      .orderBy(desc(reports.updatedAt))
      .limit(100),
    db
      .select({
        id: engagements.id,
        name: engagements.name,
        clientId: engagements.clientId,
      })
      .from(engagements)
      .where(
        and(
          eq(engagements.organisationId, context.organisationId),
          isNull(engagements.deletedAt),
        ),
      )
      .orderBy(desc(engagements.createdAt)),
    db
      .select()
      .from(reportTemplates)
      .where(
        and(
          eq(reportTemplates.organisationId, context.organisationId),
          isNull(reportTemplates.supersededAt),
        ),
      )
      .orderBy(desc(reportTemplates.version)),
  ]);
  return (
    <>
      <PageHeader
        title="Reports"
        description="Build, preview, review, approve, and publish immutable assessment reports."
      />
      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-xl border bg-paper p-5">
          <div className="flex items-center gap-2">
            <Plus className="size-4" />
            <h2 className="font-semibold">New report</h2>
          </div>
          <form
            action={createReportAction}
            className="mt-4 grid gap-3 md:grid-cols-3"
          >
            <label className="text-sm font-medium">
              Engagement
              <select
                className={field}
                name="engagementId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Select engagement
                </option>
                {engagementRows.map((engagement) => (
                  <option key={engagement.id} value={engagement.id}>
                    {engagement.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Template
              <select
                className={field}
                name="templateId"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Select template
                </option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · v{template.version}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Report title
              <input
                className={field}
                name="title"
                required
                placeholder="Assessment report"
              />
            </label>
            <Button
              type="submit"
              className="md:col-span-3 md:w-fit"
              disabled={!engagementRows.length || !templates.length}
            >
              Create report
            </Button>
          </form>
        </section>
        <div className="overflow-hidden rounded-xl border bg-paper">
          {rows.length ? (
            <div className="divide-y">
              {rows.map((report) => (
                <div
                  key={report.id}
                  className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_160px_110px] sm:items-center"
                >
                  <div className="flex gap-3">
                    <span className="grid size-9 place-items-center rounded-md bg-muted">
                      <FileText className="size-4 text-slate-500" />
                    </span>
                    <div>
                      <p className="text-sm font-medium">{report.title}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Version {report.currentVersion} · Updated{" "}
                        {formatDateTime(report.updatedAt, context.timeZone)}
                      </p>
                    </div>
                  </div>
                  <StatusPill
                    tone={
                      report.status === "published"
                        ? "success"
                        : report.status === "changes_requested"
                          ? "warning"
                          : "info"
                    }
                  >
                    {report.status.replaceAll("_", " ")}
                  </StatusPill>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/reports/${report.id}`}>Open</Link>
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-14 text-center text-sm text-slate-500">
              No reports yet. Create one from an engagement and a versioned
              template.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const field =
  "mt-1 min-h-11 w-full rounded-md border bg-paper px-3 text-sm outline-none focus:border-[var(--harbour-500)]";
