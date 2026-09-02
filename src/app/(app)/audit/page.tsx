import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { requirePermission } from "@/lib/permissions/require";
import { formatDateTime } from "@/lib/time-zone";

export default async function AuditPage() {
  const context = await requirePermission("audit:view");
  const rows = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.organisationId, context.organisationId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(200);
  return (
    <>
      <PageHeader
        title="Audit Log"
        description="Append-only security and business events for the active organisation."
      />
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="overflow-x-auto rounded-xl border bg-paper">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b bg-muted text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Request</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-medium">{row.action}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {row.targetType} · {row.targetId?.slice(0, 8) ?? "system"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {row.actorId?.slice(0, 8) ?? "system"}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {formatDateTime(row.createdAt, context.timeZone)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {row.requestId?.slice(0, 12) ?? "n/a"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? (
            <div className="p-12 text-center text-sm text-slate-500">
              No audit events recorded yet.
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
