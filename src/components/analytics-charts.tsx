"use client";

import {
  createColumnHelper,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type NamedCount = { key: string; label: string; value: number };
type MonthCount = { month: string; label: string; value: number };
type TimeRow = {
  id: string;
  name: string;
  hours: number;
  billable: number;
  nonBillable: number;
};

const timeFeatures = tableFeatures({});
const timeHelper = createColumnHelper<typeof timeFeatures, TimeRow>();
const EMPTY_TIME_ROWS: TimeRow[] = [];
const userTimeColumns = timeHelper.columns([
  timeHelper.accessor("name", { header: "User" }),
  timeHelper.accessor("hours", { header: "Hours" }),
  timeHelper.accessor("billable", { header: "Billable" }),
  timeHelper.accessor("nonBillable", { header: "Non-billable" }),
]);
const engagementTimeColumns = timeHelper.columns([
  timeHelper.accessor("name", { header: "Engagement" }),
  timeHelper.accessor("hours", { header: "Hours" }),
  timeHelper.accessor("billable", { header: "Billable" }),
  timeHelper.accessor("nonBillable", { header: "Non-billable" }),
]);

const severityFill: Record<string, string> = {
  critical: "#e11d48",
  high: "#f97316",
  medium: "#fbbf24",
  low: "#0ea5e9",
  informational: "#94a3b8",
};

export function AnalyticsCharts({
  severityCounts,
  statusCounts,
  monthlyCounts,
}: {
  severityCounts: NamedCount[];
  statusCounts: NamedCount[];
  monthlyCounts: MonthCount[];
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <ChartCard title="Severity distribution">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={severityCounts}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
            <Tooltip />
            <Bar dataKey="value" name="Findings" radius={[4, 4, 0, 0]}>
              {severityCounts.map((row) => (
                <Cell key={row.key} fill={severityFill[row.key] ?? "#0f766e"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Status distribution">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={statusCounts}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              interval={0}
              angle={-25}
              textAnchor="end"
              height={56}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
            <Tooltip />
            <Bar
              dataKey="value"
              name="Findings"
              fill="var(--harbour-500)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Findings created (6 months)">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={monthlyCounts}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="value"
              name="Created"
              stroke="var(--harbour-700)"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
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
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function TimeRollupTable({
  rows,
  nameHeader,
}: {
  rows: TimeRow[];
  nameHeader: "User" | "Engagement";
}) {
  const table = useTable({
    features: timeFeatures,
    columns: nameHeader === "User" ? userTimeColumns : engagementTimeColumns,
    data: rows.length ? rows : EMPTY_TIME_ROWS,
  });

  if (!rows.length) {
    return (
      <p className="px-5 py-10 text-center text-sm text-slate-500">
        No time entries yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-paper">
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead className="border-b bg-[var(--mist)] text-xs font-medium text-slate-500">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="px-4 py-3">
                  {header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getAllCells().map((cell) => (
                <td
                  key={cell.id}
                  className={
                    cell.column.id === "name"
                      ? "px-4 py-3 font-medium"
                      : "px-4 py-3 tabular-nums"
                  }
                >
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
