import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ShieldAlert,
  Target,
} from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { requireInternalOrganisationContext } from "@/lib/permissions/require";
import { formatDate } from "@/lib/utils";
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
  const filters = parseRiskAnalyticsFilters(await searchParams);
  const data = await getRiskAnalytics(context.organisationId, filters);
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

        <div className="grid gap-6 xl:grid-cols-3">
          <ChartCard title="Severity distribution">
            <BarList
              rows={data.severityCounts}
              colour={(key) => severityColour(key)}
            />
          </ChartCard>
          <ChartCard title="Workflow position">
            <BarList
              rows={data.workflowCounts}
              colour={() => "bg-[var(--harbour-500)]"}
            />
          </ChartCard>
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

function severityColour(value: string) {
  return value === "critical"
    ? "bg-rose-600"
    : value === "high"
      ? "bg-orange-500"
      : value === "medium"
        ? "bg-amber-400"
        : value === "low"
          ? "bg-sky-500"
          : "bg-slate-400";
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
