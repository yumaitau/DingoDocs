import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { StatusPill } from "@/components/ui/status-pill";
import { formatDateTime } from "@/lib/time-zone";
import {
  listEngagementAuditEvents,
  listEngagementQaFindings,
  listEngagementReports,
} from "@/server/services/engagement-panels";

export async function EngagementReportsSection({
  organisationId,
  engagementId,
  timeZone,
}: {
  organisationId: string;
  engagementId: string;
  timeZone: string;
}) {
  const rows = await listEngagementReports(organisationId, engagementId);
  return (
    <Stack>
      <SectionHeader
        title="Reports"
        description="Reports produced for this engagement."
        state={`${rows.length} reports`}
      />
      {rows.length ? (
        <RecordList empty="No reports for this engagement yet">
          {rows.map((report) => (
            <article
              key={report.id}
              className="flex flex-wrap items-start justify-between gap-3 border-b p-4 last:border-b-0"
            >
              <div>
                <h3 className="font-medium">
                  <Link
                    href={`/reports/${report.id}`}
                    className="hover:underline"
                  >
                    {report.title}
                  </Link>
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Updated {formatDateTime(report.updatedAt, timeZone)}
                </p>
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
            </article>
          ))}
        </RecordList>
      ) : (
        <section className="overflow-hidden rounded-xl border bg-paper">
          <div className="p-10 text-center">
            <CircleAlert className="mx-auto size-5 text-slate-400" />
            <p className="mt-2 text-sm text-slate-500">
              No reports for this engagement yet
            </p>
            <Link
              href="/reports"
              className="mt-3 inline-block text-sm font-medium text-[var(--harbour-700)] hover:underline"
            >
              Create a report
            </Link>
          </div>
        </section>
      )}
    </Stack>
  );
}

export async function EngagementQaSection({
  organisationId,
  engagementId,
}: {
  organisationId: string;
  engagementId: string;
}) {
  const rows = await listEngagementQaFindings(organisationId, engagementId);
  return (
    <Stack>
      <SectionHeader
        title="QA"
        description="Findings in review, changes requested, peer review, or QA approval."
        state={`${rows.length} findings`}
      />
      <RecordList empty="No findings are in QA review.">
        {rows.map((finding) => (
          <article
            key={finding.id}
            className="flex flex-wrap items-start justify-between gap-3 border-b p-4 last:border-b-0"
          >
            <div>
              <h3 className="font-medium">
                <Link
                  href={`/engagements/${engagementId}?view=findings`}
                  className="hover:underline"
                >
                  {finding.identifier}
                </Link>
              </h3>
              <p className="mt-1 text-sm text-slate-600">{finding.title}</p>
            </div>
            <div className="flex gap-2">
              <StatusPill tone={severityTone(finding.severity)}>
                {finding.severity}
              </StatusPill>
              <StatusPill tone="info">
                {finding.status.replaceAll("_", " ")}
              </StatusPill>
            </div>
          </article>
        ))}
      </RecordList>
    </Stack>
  );
}

export async function EngagementAuditSection({
  organisationId,
  engagementId,
  timeZone,
}: {
  organisationId: string;
  engagementId: string;
  timeZone: string;
}) {
  const rows = await listEngagementAuditEvents(organisationId, engagementId);
  return (
    <Stack>
      <SectionHeader
        title="Audit History"
        description="Recent audit events for this engagement and its findings, reports, evidence, tasks, and assets."
        state={`${rows.length} events`}
      />
      <RecordList empty="No audit history for this engagement.">
        {rows.map((event) => (
          <article key={event.id} className="border-b p-4 last:border-b-0">
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-medium">{event.action}</h3>
              <time className="text-xs text-slate-500">
                {formatDateTime(event.createdAt, timeZone)}
              </time>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {event.targetType}
              {event.actorName ? ` · ${event.actorName}` : ""}
            </p>
          </article>
        ))}
      </RecordList>
    </Stack>
  );
}

function severityTone(severity: string) {
  if (severity === "critical") return "danger" as const;
  if (severity === "high" || severity === "medium") return "warning" as const;
  return "info" as const;
}

function SectionHeader({
  title,
  description,
  state,
}: {
  title: string;
  description: string;
  state: string;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-paper p-5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <StatusPill tone="info">{state}</StatusPill>
    </header>
  );
}

function Stack({ children }: { children: React.ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}

function RecordList({
  children,
  empty,
}: {
  children: React.ReactNode;
  empty: string;
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);
  return (
    <section className="overflow-hidden rounded-xl border bg-paper">
      {hasChildren ? (
        children
      ) : (
        <div className="p-10 text-center">
          <CircleAlert className="mx-auto size-5 text-slate-400" />
          <p className="mt-2 text-sm text-slate-500">{empty}</p>
        </div>
      )}
    </section>
  );
}
