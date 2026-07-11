import { Plus, Search } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { findingTemplates } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { requireOrganisationContext } from "@/lib/permissions/require";

export default async function FindingsLibraryPage() {
  const context = await requireOrganisationContext();
  const rows = await db
    .select()
    .from(findingTemplates)
    .where(eq(findingTemplates.organisationId, context.organisationId))
    .orderBy(desc(findingTemplates.createdAt))
    .limit(100);
  return (
    <>
      <PageHeader
        title="Findings Library"
        description="Versioned, reviewed language for consistent assessment findings."
        actions={
          <Button>
            <Plus className="size-4" />
            New template
          </Button>
        }
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center gap-3">
          <label className="relative block w-full max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <span className="sr-only">Search finding templates</span>
            <input
              placeholder="Search title, CWE, OWASP, or tag"
              className="h-9 w-full rounded-md border bg-paper pl-9 pr-3 text-sm"
            />
          </label>
        </div>
        <div className="overflow-x-auto rounded-xl border bg-paper">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b bg-muted text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Template</th>
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium">Version</th>
                <th className="px-4 py-3 font-medium">Review</th>
                <th className="px-4 py-3 font-medium">Tags</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-[var(--harbour-50)]">
                  <td className="px-4 py-3">
                    <span className="font-medium">{row.title}</span>
                    <p className="mt-1 max-w-xl truncate text-xs text-slate-500">
                      {row.summary}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill
                      tone={
                        row.severity === "critical"
                          ? "danger"
                          : row.severity === "high" || row.severity === "medium"
                            ? "warning"
                            : "info"
                      }
                    >
                      {row.severity}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    v{row.version}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill
                      tone={
                        row.reviewStatus === "approved" ? "success" : "neutral"
                      }
                    >
                      {row.reviewStatus}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {row.tags.slice(0, 3).join(", ") || "No tags"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? (
            <div className="p-12 text-center text-sm text-slate-500">
              Your findings library is empty.
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
