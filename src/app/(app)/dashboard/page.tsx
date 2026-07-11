import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckSquare,
  FileCheck2,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { formatDate } from "@/lib/utils";
import { getDashboardData } from "@/server/services/dashboard";

export default async function DashboardPage() {
  const context = await requireOrganisationContext();
  const data = await getDashboardData(context.organisationId);
  const metrics = [
    {
      label: "Active engagements",
      value: data.metrics.activeEngagements,
      icon: CalendarDays,
      href: "/engagements",
      note: "currently in delivery",
    },
    {
      label: "Reports in review",
      value: data.metrics.reportsInReview,
      icon: FileCheck2,
      href: "/reports",
      note: "need a decision",
    },
    {
      label: "High-risk findings",
      value: data.metrics.highRiskFindings,
      icon: ShieldAlert,
      href: "/findings-library",
      note: "published and open",
    },
    {
      label: "Overdue tasks",
      value: data.metrics.overdueTasks,
      icon: AlertTriangle,
      href: "/tasks",
      note: "past their due date",
    },
  ];

  return (
    <>
      <PageHeader
        title="Good morning"
        description="Here is what needs attention across your security assessment work."
        actions={
          <Button asChild>
            <Link href="/engagements/new">New engagement</Link>
          </Button>
        }
      />
      <div className="space-y-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section
          aria-labelledby="operational-summary"
          className="overflow-hidden rounded-xl border bg-paper"
        >
          <h2 id="operational-summary" className="sr-only">
            Operational summary
          </h2>
          <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
            {metrics.map(({ label, value, icon: Icon, href, note }) => (
              <Link
                href={href}
                key={label}
                className="group flex min-h-28 items-start gap-3 p-4 hover:bg-[var(--harbour-50)] sm:p-5"
              >
                <span className="mt-0.5 grid size-8 place-items-center rounded-md bg-[var(--mist)] text-slate-500 group-hover:bg-[var(--harbour-100)] group-hover:text-[var(--harbour-700)]">
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
              </Link>
            ))}
          </div>
        </section>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.8fr)]">
          <section aria-labelledby="upcoming-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="upcoming-heading" className="text-base font-semibold">
                Upcoming engagements
              </h2>
              <Link
                href="/engagements"
                className="flex items-center gap-1 text-xs font-medium text-[var(--harbour-700)] hover:underline"
              >
                View all <ArrowRight className="size-3" />
              </Link>
            </div>
            <div className="overflow-hidden rounded-xl border bg-paper">
              {data.upcoming.length ? (
                <div className="divide-y">
                  {data.upcoming.map((engagement) => (
                    <Link
                      href={`/engagements/${engagement.id}`}
                      key={engagement.id}
                      className="grid gap-3 p-4 hover:bg-[var(--harbour-50)] sm:grid-cols-[minmax(0,1fr)_140px_90px] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {engagement.name}
                          </span>
                          <StatusPill
                            tone={
                              engagement.health === "at_risk"
                                ? "warning"
                                : "success"
                            }
                          >
                            {engagement.health === "at_risk"
                              ? "At risk"
                              : "On track"}
                          </StatusPill>
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {engagement.client} · {engagement.reference}
                        </p>
                      </div>
                      <div className="text-xs text-slate-600">
                        <span className="block font-medium text-slate-800">
                          {formatDate(engagement.startDate)}
                        </span>
                        Starts in schedule
                      </div>
                      <div>
                        <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                          <span>Progress</span>
                          <span>{engagement.progress}%</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--mist-strong)]">
                          <div
                            className="h-full rounded-full bg-[var(--harbour-500)]"
                            style={{ width: `${engagement.progress}%` }}
                          />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No engagements start in the next 30 days"
                  action="Plan an engagement"
                  href="/engagements/new"
                />
              )}
            </div>
          </section>

          <section aria-labelledby="tasks-heading">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="tasks-heading" className="text-base font-semibold">
                Your task queue
              </h2>
              <Link
                href="/tasks"
                className="text-xs font-medium text-[var(--harbour-700)] hover:underline"
              >
                View all
              </Link>
            </div>
            <div className="rounded-xl border bg-paper p-2">
              {data.assignedTasks.length ? (
                <ul className="space-y-1">
                  {data.assignedTasks.map((task) => (
                    <li key={task.id}>
                      <Link
                        href="/tasks"
                        className="flex items-start gap-3 rounded-lg p-3 hover:bg-muted"
                      >
                        <CheckSquare className="mt-0.5 size-4 text-slate-400" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {task.title}
                          </span>
                          <span className="mt-1 block text-xs text-slate-500">
                            {task.dueAt
                              ? `Due ${formatDate(task.dueAt)}`
                              : "No due date"}
                          </span>
                        </span>
                        <StatusPill
                          tone={
                            task.priority === "urgent"
                              ? "danger"
                              : task.priority === "high"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {task.priority}
                        </StatusPill>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="Your task queue is clear" />
              )}
            </div>
          </section>
        </div>

        <section aria-labelledby="findings-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="findings-heading" className="text-base font-semibold">
              Recently updated findings
            </h2>
            <Link
              href="/findings-library"
              className="text-xs font-medium text-[var(--harbour-700)] hover:underline"
            >
              Open library
            </Link>
          </div>
          <div className="overflow-x-auto rounded-xl border bg-paper">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b bg-[var(--mist)] text-xs font-medium text-slate-500">
                <tr>
                  <th className="px-4 py-3">Finding</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Workflow</th>
                  <th className="px-4 py-3">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.recentFindings.map((finding) => (
                  <tr key={finding.id} className="hover:bg-[var(--harbour-50)]">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-slate-500">
                        {finding.identifier}
                      </span>
                      <span className="ml-3 font-medium">{finding.title}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Severity value={finding.severity} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone="info">
                        {finding.status.replaceAll("_", " ")}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatDate(finding.updatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.recentFindings.length ? (
              <EmptyState
                title="No findings have been created yet"
                action="Open findings library"
                href="/findings-library"
              />
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}

function Severity({
  value,
}: {
  value: "informational" | "low" | "medium" | "high" | "critical";
}) {
  const tone =
    value === "critical"
      ? "danger"
      : value === "high" || value === "medium"
        ? "warning"
        : value === "low"
          ? "info"
          : "neutral";
  return <StatusPill tone={tone}>{value}</StatusPill>;
}

function EmptyState({
  title,
  action,
  href,
}: {
  title: string;
  action?: string;
  href?: string;
}) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {action && href ? (
        <Link
          href={href}
          className="mt-2 inline-block text-xs font-medium text-[var(--harbour-700)] hover:underline"
        >
          {action}
        </Link>
      ) : (
        <p className="mt-1 text-xs text-slate-500">You are all caught up.</p>
      )}
    </div>
  );
}
