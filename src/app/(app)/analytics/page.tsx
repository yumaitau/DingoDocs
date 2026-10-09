import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ShieldAlert,
  Target,
} from "lucide-react";
import Link from "next/link";
import {
  AnalyticsCharts,
  TimeRollupTable,
} from "@/components/analytics-charts";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { severityEnum } from "@/db/schema";
import { requireInternalOrganisationContext } from "@/lib/permissions/require";
import { formatDate } from "@/lib/utils";
import {
  listSlaPolicies,
  listViews,
  saveViewAction,
  upsertSlaPolicyAction,
} from "@/server/actions/planning";
import {
  getRiskAnalytics,
  parseRiskAnalyticsFilters,
  riskAnalyticsOptions,
} from "@/server/services/analytics";

const field =
  "h-10 w-full rounded-md border bg-paper px-3 text-sm outline-none focus:border-[var(--harbour-500)]";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireInternalOrganisationContext();
  const rawParams = await searchParams;
  const filters = parseRiskAnalyticsFilters(rawParams);
  const [data, views, slaPolicies] = await Promise.all([
    getRiskAnalytics(context, filters),
    listViews("analytics"),
    listSlaPolicies(),
  ]);
  const metrics = [
    {
      label: "Filtered findings",
      value: data.summary.total,
      note: "matching this view",
      icon: Target,
    },
    {
      label: "Critical or high",
      value: data.summary.highRisk,
      note: "need priority attention",
      icon: ShieldAlert,
    },
    {
      label: "Past due",
      value: data.summary.pastDue,
      note: "open beyond target date",
      icon: AlertTriangle,
    },
    {
      label: "Remediated",
      value: data.summary.remediated,
      note: "resolved or closed",
      icon: CheckCircle2,
    },
  ];
  const filterSnapshot = {
    period: filters.period,
    severity: filters.severity,
    status: filters.status,
    ...(filters.clientId ? { clientId: filters.clientId } : {}),
  };

  return (
    <>
      <PageHeader
        title="Risk analytics"
        description="Filter, compare, and drill into the findings driving client risk and remediation workload."
      />
      <div className="space-y-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <form
          aria-label="Analytics filters"
          className="grid gap-4 rounded-xl border bg-paper p-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.4fr_auto_auto] xl:items-end"
          method="get"
        >
          <Filter label="Period">
            <select
              className={field}
              defaultValue={filters.period}
              name="period"
            >
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 180 days</option>
              <option value="365">Last 12 months</option>
              <option value="all">All time</option>
            </select>
          </Filter>
          <Filter label="Severity">
            <select
              className={field}
              defaultValue={filters.severity}
              name="severity"
            >
              <option value="all">All severities</option>
              {riskAnalyticsOptions.severities.map((severity) => (
                <option key={severity} value={severity}>
                  {titleCase(severity)}
                </option>
              ))}
            </select>
          </Filter>
          <Filter label="Workflow">
            <select
              className={field}
              defaultValue={filters.status}
              name="status"
            >
              <option value="open">Open findings</option>
              <option value="remediated">Resolved or closed</option>
              <option value="risk_accepted">Risk accepted</option>
              <option value="all">All workflow states</option>
            </select>
          </Filter>
          <Filter label="Client">
            <select
              className={field}
              defaultValue={filters.clientId ?? ""}
              name="clientId"
            >
              <option value="">All clients</option>
              {filters.clientId &&
              !data.clientOptions.some(
                (client) => client.id === filters.clientId,
              ) ? (
                <option value={filters.clientId}>Unavailable client</option>
              ) : null}
              {data.clientOptions.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </Filter>
          <Button type="submit">Apply filters</Button>
          <Button asChild type="button" variant="secondary">
            <Link href="/analytics">Reset</Link>
          </Button>
        </form>

        <section className="rounded-xl border bg-paper p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Saved views</h2>
              <p className="mt-1 text-xs text-slate-500">
                Store the current filter query for quick return.
              </p>
            </div>
            <form action={saveViewAction} className="flex flex-wrap gap-2">
              <input type="hidden" name="resource" value="analytics" />
              <input
                type="hidden"
                name="filtersJson"
                value={JSON.stringify(filterSnapshot)}
              />
              <input
                className={field}
                name="name"
                placeholder="View name"
                required
                maxLength={120}
              />
              <Button type="submit" variant="secondary">
                Save view
              </Button>
            </form>
          </div>
          {views.length ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {views.map((view) => (
                <li key={view.id}>
                  <Link
                    className="inline-flex rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--harbour-50)]"
                    href={`/analytics?${toQuery(view.filters)}`}
                  >
                    {view.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-slate-500">No saved views yet.</p>
          )}
        </section>

        <section className="rounded-xl border bg-paper p-4">
          <h2 className="text-sm font-semibold">SLA by severity</h2>
          <p className="mt-1 text-xs text-slate-500">
            New findings take a due date from the client policy, then the
            organisation policy. Open findings past that window count as SLA
            overdue ({data.metrics.slaOverdue}).
          </p>
          <form
            action={upsertSlaPolicyAction}
            className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_8rem_auto] md:items-end"
          >
            <label className="text-xs font-medium text-slate-500">
              Severity
              <select className={`${field} mt-1`} name="severity" required>
                {severityEnum.enumValues.map((severity) => (
                  <option key={severity} value={severity}>
                    {titleCase(severity)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-500">
              Client
              <select className={`${field} mt-1`} name="clientId">
                <option value="">Organisation default</option>
                {data.clientOptions.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-500">
              Days
              <input
                className={`${field} mt-1`}
                min={1}
                name="days"
                required
                type="number"
              />
            </label>
            <Button type="submit" variant="secondary">
              Save SLA
            </Button>
          </form>
          {slaPolicies.length ? (
            <ul className="mt-3 divide-y text-sm">
              {slaPolicies.map((policy) => (
                <li key={policy.id} className="flex justify-between py-2">
                  <span>
                    {titleCase(policy.severity)} ·{" "}
                    {policy.clientName ?? "Organisation"}
                  </span>
                  <span className="tabular-nums">{policy.days} days</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-slate-500">No SLA policies yet.</p>
          )}
        </section>

        <section aria-labelledby="analytics-summary">
          <h2 id="analytics-summary" className="sr-only">
            Risk summary
          </h2>
          <div className="grid overflow-hidden rounded-xl border bg-paper sm:grid-cols-2 xl:grid-cols-4">
            {metrics.map(({ label, value, note, icon: Icon }, index) => (
              <div
                className={`flex min-h-28 items-start gap-3 p-5 ${
                  index ? "border-t sm:border-l sm:border-t-0" : ""
                }`}
                key={label}
              >
                <span className="grid size-8 place-items-center rounded-md bg-[var(--mist)] text-slate-500">
                  <Icon className="size-4" />
                </span>
                <span>
                  <span className="block text-2xl font-semibold tabular-nums tracking-[-0.03em]">
                    {value}
                  </span>
                  <span className="mt-0.5 block text-sm font-medium">
                    {label}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {note}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <AnalyticsCharts
          severityCounts={data.severityCounts}
          statusCounts={
            data.statusCounts.length ? data.statusCounts : data.workflowCounts
          }
          monthlyCounts={data.monthlyCounts}
        />

        <div className="grid gap-6 xl:grid-cols-3">
          <ChartCard title="Finding age">
            <BarList
              rows={data.ageBands}
              colour={(key) =>
                key === "180_plus"
                  ? "bg-rose-500"
                  : key === "90_179"
                    ? "bg-amber-500"
                    : "bg-slate-400"
              }
            />
          </ChartCard>
          <ChartCard title="Remediation and SLA">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Mean days to remediate</dt>
                <dd className="font-semibold tabular-nums">
                  {data.metrics.meanRemediationDays ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Retest pass rate</dt>
                <dd className="font-semibold tabular-nums">
                  {data.metrics.retestPassRate === null
                    ? "—"
                    : `${data.metrics.retestPassRate}% (${data.metrics.retestTotal})`}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Overdue vs org SLA</dt>
                <dd className="font-semibold tabular-nums">
                  {data.metrics.slaOverdue}
                </dd>
              </div>
            </dl>
          </ChartCard>
          <ChartCard title="Top recurring CWE">
            {data.metrics.topCwes.length ? (
              <ul className="space-y-2 text-sm">
                {data.metrics.topCwes.map((row) => (
                  <li
                    key={row.cwe}
                    className="flex justify-between gap-4 border-b pb-2 last:border-b-0 last:pb-0"
                  >
                    <span className="font-mono text-xs">{row.cwe}</span>
                    <span className="tabular-nums font-semibold">
                      {row.count}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">No CWE values in view.</p>
            )}
          </ChartCard>
        </div>

        <section aria-labelledby="client-risk-heading">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 id="client-risk-heading" className="text-base font-semibold">
                Client risk comparison
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Ranked by critical and high findings, then missed target dates.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-xl border bg-paper">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b bg-[var(--mist)] text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">Findings</th>
                  <th className="px-4 py-3">Critical / high</th>
                  <th className="px-4 py-3">Past due</th>
                  <th className="px-4 py-3 text-right">Drill down</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.clients.map((client) => (
                  <tr key={client.id}>
                    <td className="px-4 py-3 font-medium">{client.name}</td>
                    <td className="px-4 py-3 tabular-nums">{client.total}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {client.highRisk}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{client.pastDue}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        className="inline-flex items-center gap-1 text-xs font-medium text-[var(--harbour-700)] hover:underline"
                        href={analyticsClientHref(filters, client.id)}
                      >
                        Filter client <ArrowRight className="size-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.clients.length ? (
              <EmptyState message="No clients have findings in this view." />
            ) : null}
          </div>
        </section>

        <section aria-labelledby="time-rollups-heading">
          <div className="mb-3">
            <h2 id="time-rollups-heading" className="text-base font-semibold">
              Time rollups
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Hours logged by consultant and by engagement.
            </p>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <TimeRollupTable
              nameHeader="User"
              rows={data.timeByUser.map((row) => ({
                id: row.userId,
                name: row.userName,
                hours: row.hours,
                billable: row.billable,
                nonBillable: row.nonBillable,
              }))}
            />
            <TimeRollupTable
              nameHeader="Engagement"
              rows={data.timeByEngagement.map((row) => ({
                id: row.engagementId,
                name: row.engagementName,
                hours: row.hours,
                billable: row.billable,
                nonBillable: row.nonBillable,
              }))}
            />
          </div>
        </section>

        <section aria-labelledby="analytics-findings-heading">
          <div className="mb-3">
            <h2
              id="analytics-findings-heading"
              className="text-base font-semibold"
            >
              Findings in this view
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Most recently updated 50 results. Open an engagement to review the
              full record.
            </p>
          </div>
          <div className="overflow-x-auto rounded-xl border bg-paper">
            <table className="w-full min-w-[840px] text-left text-sm">
              <thead className="border-b bg-[var(--mist)] text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Finding</th>
                  <th className="px-4 py-3">Client / engagement</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Workflow</th>
                  <th className="px-4 py-3">Target date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.findings.map((finding) => (
                  <tr key={finding.id} className="hover:bg-[var(--harbour-50)]">
                    <td className="px-4 py-3">
                      <Link
                        className="font-medium hover:underline"
                        href={`/engagements/${finding.engagementId}?view=findings`}
                      >
                        {finding.title}
                      </Link>
                      <span className="mt-1 block font-mono text-xs text-slate-500">
                        {finding.identifier}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="block font-medium">
                        {finding.clientName}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {finding.engagementName}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={severityTone(finding.severity)}>
                        {finding.severity}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone="info">
                        {titleCase(finding.status)}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {finding.dueAt ? formatDate(finding.dueAt) : "Not set"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.findings.length ? (
              <EmptyState message="No findings match these filters." />
            ) : null}
          </div>
        </section>
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

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-paper p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function BarList({
  rows,
  colour,
}: {
  rows: Array<{ key: string; label: string; value: number }>;
  colour: (key: string) => string;
}) {
  const maximum = Math.max(...rows.map((row) => row.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="mb-1 flex justify-between gap-4 text-xs">
            <span className="text-slate-600">{row.label}</span>
            <span className="font-semibold tabular-nums">{row.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--mist-strong)]">
            <div
              aria-hidden="true"
              className={`h-full rounded-full ${colour(row.key)}`}
              style={{ width: `${(row.value / maximum) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="px-5 py-10 text-center text-sm text-slate-500">{message}</p>
  );
}

function severityTone(value: string) {
  return value === "critical"
    ? ("danger" as const)
    : value === "high" || value === "medium"
      ? ("warning" as const)
      : value === "low"
        ? ("info" as const)
        : ("neutral" as const);
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function analyticsClientHref(
  filters: ReturnType<typeof parseRiskAnalyticsFilters>,
  clientId: string,
) {
  const query = new URLSearchParams({
    period: filters.period,
    severity: filters.severity,
    status: filters.status,
    clientId,
  });
  return `/analytics?${query}`;
}

function toQuery(filters: Record<string, unknown>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}
