import { and, count, eq, isNull } from "drizzle-orm";
import {
  CalendarDays,
  CircleCheck,
  Clock3,
  FileText,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  clients,
  engagementMembers,
  evidence,
  findings,
  tasks,
} from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  EngagementStatusPanel,
  EngagementWorkspaceSection,
} from "@/features/engagements/workspace-sections";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { cn, formatDate } from "@/lib/utils";
import { getEngagement } from "@/server/repositories/tenant";

const tabs = [
  "Overview",
  "Scope",
  "Assets",
  "Rules of Engagement",
  "Team",
  "Methodology",
  "Findings",
  "Evidence",
  "Notes",
  "Timeline",
  "Tasks",
  "Time Tracking",
  "Reports",
  "QA",
  "Retesting",
  "Client Portal",
  "Audit History",
];

export default async function EngagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view } = await searchParams;
  const context = await requireOrganisationContext();
  const engagement = await getEngagement(context, id);
  if (!engagement) notFound();
  const [client, findingCount, evidenceCount, taskCount, memberCount] =
    await Promise.all([
      db
        .select({ name: clients.name })
        .from(clients)
        .where(
          and(
            eq(clients.organisationId, context.organisationId),
            eq(clients.id, engagement.clientId),
          ),
        )
        .limit(1),
      db
        .select({ value: count() })
        .from(findings)
        .where(
          and(
            eq(findings.organisationId, context.organisationId),
            eq(findings.engagementId, id),
            isNull(findings.deletedAt),
          ),
        ),
      db
        .select({ value: count() })
        .from(evidence)
        .where(
          and(
            eq(evidence.organisationId, context.organisationId),
            eq(evidence.engagementId, id),
            isNull(evidence.deletedAt),
          ),
        ),
      db
        .select({ value: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.organisationId, context.organisationId),
            eq(tasks.engagementId, id),
          ),
        ),
      db
        .select({ value: count() })
        .from(engagementMembers)
        .where(
          and(
            eq(engagementMembers.organisationId, context.organisationId),
            eq(engagementMembers.engagementId, id),
            isNull(engagementMembers.deletedAt),
          ),
        ),
    ]);
  const active = tabs.find((tab) => slug(tab) === view) ?? "Overview";

  return (
    <>
      <PageHeader
        title={engagement.name}
        description={`${client[0]?.name ?? "Client"} · ${engagement.reference} · ${engagement.type}`}
        breadcrumbs={[
          { label: "Engagements", href: "/engagements" },
          { label: engagement.name },
        ]}
        actions={
          <>
            <StatusPill
              tone={engagement.health === "at_risk" ? "warning" : "success"}
            >
              {engagement.health.replaceAll("_", " ")}
            </StatusPill>
            <Button variant="secondary">More actions</Button>
          </>
        }
      />
      <nav
        aria-label="Engagement sections"
        className="scrollbar-subtle overflow-x-auto border-b bg-paper px-4 sm:px-6 lg:px-8"
      >
        <div className="flex min-w-max gap-1">
          {tabs.map((tab) => (
            <Link
              key={tab}
              href={`/engagements/${id}?view=${slug(tab)}`}
              aria-current={active === tab ? "page" : undefined}
              className={cn(
                "border-b-2 px-3 py-3 text-xs font-medium",
                active === tab
                  ? "border-[var(--harbour-600)] text-[var(--harbour-700)]"
                  : "border-transparent text-slate-500 hover:text-slate-800",
              )}
            >
              {tab}
            </Link>
          ))}
        </div>
      </nav>
      <div className="px-4 py-6 sm:px-6 lg:px-8">
        {active === "Overview" ? (
          <>
            <Overview
              engagement={engagement}
              client={client[0]?.name ?? "Unknown client"}
              counts={{
                findings: findingCount[0]?.value ?? 0,
                evidence: evidenceCount[0]?.value ?? 0,
                tasks: taskCount[0]?.value ?? 0,
                members: memberCount[0]?.value ?? 0,
              }}
            />
            <EngagementStatusPanel
              engagementId={id}
              status={engagement.status}
            />
          </>
        ) : (
          <EngagementWorkspaceSection
            title={active}
            engagementId={id}
            organisationId={context.organisationId}
            userId={context.userId}
          />
        )}
      </div>
    </>
  );
}

function Overview({
  engagement,
  client,
  counts,
}: {
  engagement: Awaited<ReturnType<typeof getEngagement>> & {};
  client: string;
  counts: {
    findings: number;
    evidence: number;
    tasks: number;
    members: number;
  };
}) {
  if (!engagement) return null;
  const summary: Array<[string, number, LucideIcon]> = [
    ["Findings", counts.findings, ShieldCheck],
    ["Evidence files", counts.evidence, FileText],
    ["Open tasks", counts.tasks, CircleCheck],
    ["Team members", counts.members, Users],
  ];
  return (
    <div className="space-y-6">
      <section className="grid overflow-hidden rounded-xl border bg-paper sm:grid-cols-2 xl:grid-cols-4">
        {summary.map(([label, value, Icon], index) => (
          <div
            key={label}
            className={cn(
              "p-5",
              index ? "border-t sm:border-l sm:border-t-0" : "",
            )}
          >
            <Icon className="size-4 text-slate-400" />
            <p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>
            <p className="mt-0.5 text-xs text-slate-500">{label}</p>
          </div>
        ))}
      </section>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="rounded-xl border bg-paper">
          <div className="border-b p-5">
            <h2 className="text-base font-semibold">Engagement brief</h2>
          </div>
          <dl className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-2">
            <Item label="Client" value={client} />
            <Item label="Assessment type" value={engagement.type} />
            <Item
              label="Status"
              value={engagement.status.replaceAll("_", " ")}
            />
            <Item
              label="Classification"
              value={engagement.securityClassification}
            />
            <Item
              label="Start date"
              value={formatDate(engagement.startDate)}
              icon={CalendarDays}
            />
            <Item
              label="Reporting deadline"
              value={formatDate(engagement.reportingDeadline)}
              icon={Clock3}
            />
          </dl>
          {engagement.objectives ? (
            <div className="border-t p-5">
              <h3 className="text-xs font-medium text-slate-500">Objectives</h3>
              <p className="mt-2 max-w-[75ch] text-sm leading-6 text-slate-700">
                {engagement.objectives}
              </p>
            </div>
          ) : null}
        </section>
        <section className="rounded-xl border bg-paper p-5">
          <h2 className="text-base font-semibold">Delivery progress</h2>
          <div className="mt-5 flex items-end justify-between">
            <span className="text-3xl font-semibold tracking-[-0.03em]">
              {engagement.progress}%
            </span>
            <StatusPill tone="info">
              {engagement.status.replaceAll("_", " ")}
            </StatusPill>
          </div>
          <div className="mt-3 h-2 rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[var(--harbour-500)]"
              style={{ width: `${engagement.progress}%` }}
            />
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">
            Progress is based on completed delivery stages, finding review, and
            report approval.
          </p>
        </section>
      </div>
    </div>
  );
}

function Item({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: typeof CalendarDays;
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 flex items-center gap-1.5 text-sm capitalize">
        {Icon ? <Icon className="size-3.5 text-slate-400" /> : null}
        {value}
      </dd>
    </div>
  );
}
function slug(value: string) {
  return value.toLowerCase().replaceAll(" ", "-");
}
