import { and, desc, eq, ilike, or } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/permissions/require";
import { formatDateTime } from "@/lib/time-zone";

const field =
  "h-10 w-full rounded-md border bg-paper px-3 text-sm outline-none focus:border-[var(--harbour-500)]";

type AuditSearchParams = {
  q?: string | string[];
  action?: string | string[];
  targetType?: string | string[];
  format?: string | string[];
};

export type AuditListFilters = {
  q: string;
  action: string;
  targetType: string;
  format: string;
};

function firstParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ?? "";
}

export function readAuditListFilters(
  searchParams: AuditSearchParams,
): AuditListFilters {
  return {
    q: firstParam(searchParams.q),
    action: firstParam(searchParams.action),
    targetType: firstParam(searchParams.targetType),
    format: firstParam(searchParams.format),
  };
}

export async function loadAuditEvents(
  organisationId: string,
  filters: AuditListFilters,
) {
  const pattern = `%${filters.q}%`;
  return db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organisationId, organisationId),
        filters.action ? eq(auditEvents.action, filters.action) : undefined,
        filters.targetType
          ? eq(auditEvents.targetType, filters.targetType)
          : undefined,
        filters.q
          ? or(
              ilike(auditEvents.action, pattern),
              ilike(auditEvents.targetType, pattern),
              ilike(auditEvents.targetId, pattern),
            )
          : undefined,
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(200);
}

function csvCell(value: string) {
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function auditEventsToCsv(
  rows: Awaited<ReturnType<typeof loadAuditEvents>>,
  timeZone: string,
) {
  const lines = [
    [
      "action",
      "targetType",
      "targetId",
      "actorId",
      "createdAt",
      "requestId",
    ].join(","),
    ...rows.map((row) =>
      [
        row.action,
        row.targetType,
        row.targetId ?? "",
        row.actorId ?? "",
        formatDateTime(row.createdAt, timeZone),
        row.requestId ?? "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  return lines.join("\r\n");
}

export function auditCsvHref(filters: AuditListFilters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.action) params.set("action", filters.action);
  if (filters.targetType) params.set("targetType", filters.targetType);
  params.set("format", "csv");
  return `/api/exports/audit?${params.toString()}`;
}

const csvHeaders = {
  "content-type": "text/csv; charset=utf-8",
  "content-disposition": 'attachment; filename="audit-events.csv"',
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

export function auditCsvResponse(csv: string) {
  return new Response(csv, { headers: csvHeaders });
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<AuditSearchParams>;
}) {
  const context = await requirePermission("audit:view");
  const filters = readAuditListFilters(await searchParams);
  if (filters.format === "csv") redirect(auditCsvHref(filters));
  const rows = await loadAuditEvents(context.organisationId, filters);
  return (
    <>
      <PageHeader
        title="Audit Log"
        description="Append-only security and business events for the active organisation."
      />
      <div className="space-y-4 px-4 py-6 sm:px-6 lg:px-8">
        <form
          action="/audit"
          aria-label="Audit filters"
          className="grid gap-4 rounded-xl border bg-paper p-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto] xl:items-end"
          method="get"
        >
          <Filter label="Search">
            <input
              className={field}
              defaultValue={filters.q}
              name="q"
              placeholder="Action, target type, or target id"
              type="search"
            />
          </Filter>
          <Filter label="Action">
            <input
              className={field}
              defaultValue={filters.action}
              name="action"
              placeholder="Exact action"
            />
          </Filter>
          <Filter label="Target type">
            <input
              className={field}
              defaultValue={filters.targetType}
              name="targetType"
              placeholder="Exact target type"
            />
          </Filter>
          <div className="flex gap-2">
            <Button type="submit">Apply</Button>
            <Button asChild type="button" variant="secondary">
              <a href={auditCsvHref(filters)}>Export CSV</a>
            </Button>
          </div>
        </form>
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

function Filter({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">
        {label}
      </span>
      {children}
    </label>
  );
}
