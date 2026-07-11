import { desc, eq } from "drizzle-orm";
import { FileText, Plus } from "lucide-react";
import { db } from "@/db";
import { reports } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { formatDate } from "@/lib/utils";

export default async function ReportsPage() {
  const context = await requireOrganisationContext();
  const rows = await db
    .select()
    .from(reports)
    .where(eq(reports.organisationId, context.organisationId))
    .orderBy(desc(reports.updatedAt))
    .limit(100);
  return (
    <>
      <PageHeader
        title="Reports"
        description="Build, review, approve, and publish immutable assessment reports."
        actions={
          <Button>
            <Plus className="size-4" />
            New report
          </Button>
        }
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
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
                        {formatDate(report.updatedAt)}
                      </p>
                    </div>
                  </div>
                  <StatusPill
                    tone={report.status === "published" ? "success" : "info"}
                  >
                    {report.status.replaceAll("_", " ")}
                  </StatusPill>
                  <Button variant="secondary" size="sm">
                    Open
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="No reports yet. Reports are created from an engagement workspace." />
          )}
        </div>
      </div>
    </>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="p-14 text-center text-sm text-slate-500">{text}</div>;
}
