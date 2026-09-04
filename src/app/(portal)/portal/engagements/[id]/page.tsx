import { canWritePortal } from "@/lib/permissions/portal";
import {
  ArrowLeft,
  FileCheck2,
  FileText,
  MessageSquare,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { formatDateTime } from "@/lib/time-zone";
import {
  addPortalCommentAction,
  approvePortalReportAction,
  requestRetestAction,
  submitRemediationAction,
  uploadRemediationEvidenceAction,
} from "@/server/actions/client-portal";
import {
  getPortalEngagement,
  PortalNotFoundError,
} from "@/server/services/client-portal";

export default async function PortalEngagementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireOrganisationContext();
  let portal: Awaited<ReturnType<typeof getPortalEngagement>>;
  try {
    portal = await getPortalEngagement(actor, id);
  } catch (error) {
    if (error instanceof PortalNotFoundError) notFound();
    throw error;
  }
  const { engagement } = portal;
  const canWrite = canWritePortal(engagement.accessLevel);
  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/portal"
          className="inline-flex items-center gap-2 text-sm font-medium text-[var(--harbour-700)] hover:underline"
        >
          <ArrowLeft className="size-4" /> All engagements
        </Link>
        <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {engagement.clientName} · {engagement.reference}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              {engagement.name}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {engagement.type} ·{" "}
              <span className="capitalize">
                {engagement.status.replaceAll("_", " ")}
              </span>
            </p>
          </div>
          <span className="rounded-full bg-primary-soft px-3 py-1.5 text-xs font-semibold text-[var(--harbour-700)]">
            {engagement.accessLevel} access
          </span>
        </div>
        {engagement.objectives && (
          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-600">
            {engagement.objectives}
          </p>
        )}
      </div>

      <section className="rounded-xl border bg-paper">
        <SectionHeading
          icon={ShieldCheck}
          title="Approved scope"
          description={
            portal.approvedScope
              ? `Scope version ${portal.approvedScope.version}, approved ${portal.approvedScope.approvedAt ? formatDateTime(portal.approvedScope.approvedAt, actor.timeZone) : "without a recorded date"}.`
              : "No approved scope has been shared yet."
          }
        />
        {portal.scope.length > 0 && (
          <ul className="divide-y">
            {portal.scope.map((item) => (
              <li
                key={item.id}
                className="grid gap-2 p-5 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="mt-1 break-all font-mono text-xs text-slate-500">
                    {item.value}
                  </p>
                  {item.testingRestrictions && (
                    <p className="mt-2 text-sm text-slate-600">
                      Restriction: {item.testingRestrictions}
                    </p>
                  )}
                </div>
                <span className="text-xs font-medium capitalize text-slate-500">
                  {item.scopeStatus.replaceAll("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Published findings</h2>
          <p className="mt-1 text-sm text-slate-600">
            Track ownership, submit remediation evidence, and request
            verification.
          </p>
        </div>
        {portal.findings.length ? (
          portal.findings.map((finding) => {
            const updates = portal.remediationUpdates.filter(
              (update) => update.findingId === finding.id,
            );
            const attempts = portal.retestAttempts.filter(
              (attempt) => attempt.findingId === finding.id,
            );
            const comments = portal.comments.filter(
              (comment) =>
                comment.targetType === "finding" &&
                comment.targetId === finding.id,
            );
            return (
              <article key={finding.id} className="rounded-xl border bg-paper">
                <div className="border-b p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {finding.identifier} · version {finding.version}
                      </p>
                      <h3 className="mt-1 text-lg font-semibold">
                        {finding.title}
                      </h3>
                    </div>
                    <div className="flex gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${severityClass(finding.severity)}`}
                      >
                        {finding.severity}
                      </span>
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium capitalize">
                        {finding.status.replaceAll("_", " ")}
                      </span>
                    </div>
                  </div>
                  {finding.executiveSummary && (
                    <p className="mt-4 text-sm leading-6 text-slate-700">
                      {finding.executiveSummary}
                    </p>
                  )}
                </div>
                <div className="grid gap-6 p-5 lg:grid-cols-2">
                  <div className="space-y-4">
                    {finding.businessImpact && (
                      <TextBlock
                        title="Business impact"
                        body={finding.businessImpact}
                      />
                    )}
                    {finding.remediation && (
                      <TextBlock
                        title="Recommended remediation"
                        body={finding.remediation}
                      />
                    )}
                    {finding.verificationGuidance && (
                      <TextBlock
                        title="Verification guidance"
                        body={finding.verificationGuidance}
                      />
                    )}
                    {updates.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold">
                          Remediation history
                        </h4>
                        <ul className="mt-2 space-y-2 border-l pl-3">
                          {updates.map((update) => (
                            <li
                              key={update.id}
                              className="text-xs text-slate-600"
                            >
                              <span className="font-semibold capitalize text-slate-800">
                                {update.status.replaceAll("_", " ")}
                              </span>
                              {update.owner ? ` · ${update.owner}` : ""} ·{" "}
                              {formatDateTime(update.createdAt, actor.timeZone)}
                              {update.note && (
                                <p className="mt-1">{update.note}</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {attempts.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold">Retesting</h4>
                        <ul className="mt-2 space-y-2">
                          {attempts.map((attempt) => (
                            <li
                              key={attempt.id}
                              className="rounded-lg bg-muted p-3 text-xs text-slate-600"
                            >
                              <span className="font-semibold capitalize text-slate-800">
                                {attempt.status}
                              </span>
                              {attempt.outcome
                                ? ` · ${attempt.outcome.replaceAll("_", " ")}`
                                : ""}
                              {attempt.scheduledFor
                                ? ` · scheduled ${formatDateTime(attempt.scheduledFor, actor.timeZone)}`
                                : ""}
                              {portal.retestNotes
                                .filter(
                                  (note) => note.retestAttemptId === attempt.id,
                                )
                                .map((note) => (
                                  <p key={note.id} className="mt-2">
                                    {note.body}
                                  </p>
                                ))}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {comments.length > 0 && (
                      <CommentList
                        comments={comments}
                        timeZone={actor.timeZone}
                      />
                    )}
                  </div>
                  <div className="space-y-4">
                    {canWrite && (
                      <form
                        action={submitRemediationAction.bind(
                          null,
                          id,
                          finding.id,
                        )}
                        className="space-y-3 rounded-lg border p-4"
                      >
                        <h4 className="text-sm font-semibold">
                          Update remediation
                        </h4>
                        <label className="block text-xs font-medium text-slate-600">
                          Status
                          <select
                            name="status"
                            required
                            className="mt-1 min-h-10 w-full rounded-md border bg-paper px-3 text-sm"
                          >
                            <option value="in_progress">In progress</option>
                            <option value="remediated">
                              Remediated — ready for retest
                            </option>
                            <option value="partially_remediated">
                              Partially remediated
                            </option>
                            <option value="not_remediated">
                              Not remediated
                            </option>
                            <option value="risk_accepted">Risk accepted</option>
                            <option value="open">Open</option>
                          </select>
                        </label>
                        <label className="block text-xs font-medium text-slate-600">
                          Owner
                          <input
                            name="owner"
                            defaultValue={finding.clientOwner ?? ""}
                            maxLength={200}
                            className="mt-1 min-h-10 w-full rounded-md border px-3 text-sm"
                          />
                        </label>
                        <label className="block text-xs font-medium text-slate-600">
                          Update note
                          <textarea
                            name="note"
                            rows={3}
                            maxLength={5000}
                            className="mt-1 w-full rounded-md border p-3 text-sm"
                          />
                        </label>
                        <Button type="submit">Save update</Button>
                      </form>
                    )}
                    {canWrite && (
                      <form
                        action={uploadRemediationEvidenceAction.bind(
                          null,
                          id,
                          finding.id,
                        )}
                        className="space-y-3 rounded-lg border p-4"
                      >
                        <h4 className="text-sm font-semibold">
                          Remediation evidence
                        </h4>
                        <p className="text-xs text-slate-500">
                          Uploads are shared with your organisation and linked
                          to this finding.
                        </p>
                        <input
                          name="file"
                          type="file"
                          required
                          className="block w-full text-xs file:mr-3 file:rounded-md file:border file:bg-paper file:px-3 file:py-2"
                        />
                        <Button type="submit" variant="secondary">
                          Upload evidence
                        </Button>
                      </form>
                    )}
                    {canWrite && (
                      <form
                        action={requestRetestAction.bind(null, id, finding.id)}
                        className="space-y-3 rounded-lg border p-4"
                      >
                        <h4 className="flex items-center gap-2 text-sm font-semibold">
                          <RefreshCcw className="size-4" /> Request retest
                        </h4>
                        <textarea
                          name="note"
                          rows={2}
                          maxLength={5000}
                          placeholder="What changed and what should be verified?"
                          className="w-full rounded-md border p-3 text-sm"
                        />
                        <Button type="submit" variant="secondary">
                          Request retest
                        </Button>
                      </form>
                    )}
                    {canWrite && (
                      <form
                        action={addPortalCommentAction.bind(
                          null,
                          id,
                          "finding",
                          finding.id,
                        )}
                        className="space-y-3 rounded-lg border p-4"
                      >
                        <h4 className="flex items-center gap-2 text-sm font-semibold">
                          <MessageSquare className="size-4" /> Add comment
                        </h4>
                        <textarea
                          name="body"
                          required
                          rows={2}
                          maxLength={5000}
                          className="w-full rounded-md border p-3 text-sm"
                        />
                        <Button type="submit" variant="secondary">
                          Post comment
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <EmptyState message="No published findings have been shared." />
        )}
      </section>

      <section className="rounded-xl border bg-paper">
        <SectionHeading
          icon={FileCheck2}
          title="Reports"
          description="Review report drafts explicitly shared for client review and published report history."
        />
        {portal.reports.length ? (
          <ul className="divide-y">
            {portal.reports.map((report) => {
              const reportComments = portal.comments.filter(
                (comment) =>
                  comment.targetType === "report" &&
                  comment.targetId === report.id,
              );
              return (
                <li key={report.versionId} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{report.title}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Version {report.version} ·{" "}
                        <span className="capitalize">
                          {report.versionStatus.replaceAll("_", " ")}
                        </span>
                        {report.publishedAt
                          ? ` · published ${formatDateTime(report.publishedAt, actor.timeZone)}`
                          : ""}
                      </p>
                    </div>
                    {canWrite &&
                      report.reportStatus === "client_review" &&
                      report.versionStatus === "client_review" && (
                        <form
                          action={approvePortalReportAction.bind(
                            null,
                            id,
                            report.id,
                          )}
                        >
                          <Button type="submit">Approve report</Button>
                        </form>
                      )}
                    <Button asChild variant="secondary">
                      <a
                        href={`/api/portal/reports/${report.versionId}/preview`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View report
                      </a>
                    </Button>
                  </div>
                  {reportComments.length > 0 && (
                    <div className="mt-4">
                      <CommentList
                        comments={reportComments}
                        timeZone={actor.timeZone}
                      />
                    </div>
                  )}
                  {canWrite && report.versionStatus === "client_review" && (
                    <form
                      action={addPortalCommentAction.bind(
                        null,
                        id,
                        "report",
                        report.id,
                      )}
                      className="mt-4 flex gap-2"
                    >
                      <input
                        name="body"
                        required
                        maxLength={5000}
                        placeholder="Comment on this report"
                        className="min-h-10 min-w-0 flex-1 rounded-md border px-3 text-sm"
                      />
                      <Button type="submit" variant="secondary">
                        Comment
                      </Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="border-t p-5 text-sm text-slate-500">
            No reports have been shared.
          </div>
        )}
      </section>

      <section className="rounded-xl border bg-paper">
        <SectionHeading
          icon={FileText}
          title="Shared evidence"
          description="Only evidence explicitly classified as client visible appears here."
        />
        {portal.evidence.length ? (
          <ul className="divide-y">
            {portal.evidence.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 p-5"
              >
                <div>
                  <p className="text-sm font-medium">{item.originalFilename}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.mediaType} · version {item.version} ·{" "}
                    {formatDateTime(item.createdAt, actor.timeZone)}
                  </p>
                </div>
                <code className="text-[10px] text-slate-400">
                  SHA-256 {item.sha256.slice(0, 12)}…
                </code>
                <Button asChild size="sm" variant="secondary">
                  <a
                    href={`/api/v1/evidence/${item.id}/preview`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Preview
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="border-t p-5 text-sm text-slate-500">
            No client-visible evidence has been shared.
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof ShieldCheck;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 p-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-[var(--harbour-700)]">
        <Icon className="size-5" />
      </span>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function TextBlock({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h4 className="text-sm font-semibold">{title}</h4>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">
        {body}
      </p>
    </div>
  );
}

function CommentList({
  comments,
  timeZone,
}: {
  comments: Array<{ id: string; body: string; createdAt: Date }>;
  timeZone: string;
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold">Client discussion</h4>
      <ul className="mt-2 space-y-2">
        {comments.map((comment) => (
          <li
            key={comment.id}
            className="rounded-lg bg-muted p-3 text-sm text-slate-700"
          >
            {comment.body}
            <p className="mt-1 text-[11px] text-slate-400">
              {formatDateTime(comment.createdAt, timeZone)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-paper p-8 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

function severityClass(severity: string) {
  if (severity === "critical") return "bg-red-100 text-red-800";
  if (severity === "high") return "bg-orange-100 text-orange-800";
  if (severity === "medium") return "bg-amber-100 text-amber-800";
  if (severity === "low") return "bg-blue-100 text-blue-800";
  return "bg-slate-100 text-slate-700";
}
