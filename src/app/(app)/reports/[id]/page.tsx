import { Download, Eye, FileOutput, GitBranch } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { EngagementAccessError } from "@/lib/permissions/access";
import {
  assertEngagementAccess,
  requireOrganisationContext,
} from "@/lib/permissions/require";
import { osaiFileStem, osaiReadiness } from "@/lib/reports/layout";
import { OSAI_GUIDE_URL } from "@/lib/reports/osai-template";
import type { ReportDocumentModel } from "@/server/services/report-renderers";
import { formatDateTime } from "@/lib/time-zone";
import {
  createReportRevisionAction,
  queueReportGenerationAction,
  refreshReportFindingsAction,
  transitionReportAction,
} from "@/server/actions/reports";
import {
  diffReportVersions,
  getReportWorkspace,
  ReportScopeError,
  reportFormats,
  reportStatuses,
} from "@/server/services/reports";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOrganisationContext();
  let workspace: Awaited<ReturnType<typeof getReportWorkspace>>;
  try {
    workspace = await getReportWorkspace(context.organisationId, id);
    await assertEngagementAccess({
      userId: context.userId,
      organisationId: context.organisationId,
      engagementId: workspace.report.engagementId,
    });
  } catch (error) {
    if (
      error instanceof ReportScopeError ||
      error instanceof EngagementAccessError
    )
      notFound();
    throw error;
  }
  const { report, current, versions, transitions } = workspace;
  const model = current.content as ReportDocumentModel;
  const previousVersion = versions.find(
    (version) => version.version === current.version - 1,
  );
  const versionDiff =
    previousVersion != null
      ? diffReportVersions(
          previousVersion.content as ReportDocumentModel,
          model,
        )
      : null;
  const exam = model.exam;
  const examIssues = exam
    ? osaiReadiness(
        model.sections.map((s) => ({ ...s.definition, content: s.content })),
        exam.osid,
      )
    : [];
  let examStem = "OSAI-OS-XXXXX-Exam-Report";
  if (exam) {
    try {
      examStem = osaiFileStem(exam.osid);
    } catch {
      /* shown in readiness issues */
    }
  }
  return (
    <>
      <PageHeader
        title={report.title}
        description={`Version ${current.version} · ${current.status.replaceAll("_", " ")}`}
        breadcrumbs={[
          { label: "Reports", href: "/reports" },
          { label: report.title },
        ]}
        actions={
          <>
            {!current.immutable &&
              ["draft", "changes_requested"].includes(current.status) && (
                <>
                  <Button asChild>
                    <Link href={`/reports/${id}/edit`}>Write report</Link>
                  </Button>
                  <form action={refreshReportFindingsAction.bind(null, id)}>
                    <Button type="submit" variant="secondary">
                      Refresh findings
                    </Button>
                  </form>
                </>
              )}
            <StatusPill
              tone={report.status === "published" ? "success" : "info"}
            >
              {report.status.replaceAll("_", " ")}
            </StatusPill>
            <Button asChild variant="secondary">
              <a
                href={`/api/v1/reports/${report.id}/preview`}
                target="_blank"
                rel="noreferrer"
              >
                <Eye className="size-4" />
                Live preview
              </a>
            </Button>
          </>
        }
      />
      <div className="grid gap-6 px-4 py-6 sm:px-6 lg:px-8 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {exam && (
            <section className="rounded-xl border border-sky-200 bg-sky-50 p-5 text-slate-900">
              <h2 className="font-semibold">OSAI submission preparation</h2>
              <p className="mt-2 text-sm">
                {exam.candidateName} · {exam.osid || "OSID not entered"} ·{" "}
                {exam.candidateEmail}
              </p>
              {examIssues.length > 0 && (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                  {examIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-sm">
                Save edits, generate the PDF below and inspect every page.
                Commands and queries must be selectable text; screenshots
                support each attack stage. The checklist cannot verify
                completeness or guarantee a score.
              </p>
              <p className="mt-3 text-sm">
                On Kali, create an unencrypted archive containing only your PDF.
                Keep the archive under 100 MB and submit within 24 hours after
                the exam ends.
              </p>
              <pre className="mt-3 overflow-x-auto rounded bg-white p-3 text-xs">{`7z a ${examStem}.7z ${examStem}.pdf\n7z l ${examStem}.7z\nstat -c %s ${examStem}.7z\nmd5sum ${examStem}.7z`}</pre>
              <p className="mt-2 text-sm">
                Compare the local archive MD5 with the portal hash after upload.{" "}
                <a
                  className="underline"
                  href={OSAI_GUIDE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Check the current OffSec guide
                </a>{" "}
                before final submission.
              </p>
            </section>
          )}
          <section className="rounded-xl border bg-paper p-5">
            <div className="flex items-center gap-2">
              <FileOutput className="size-4" />
              <h2 className="font-semibold">Server-side exports</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              PDF, DOCX, HTML, Markdown, and JSON use the same immutable report
              model as live preview.
            </p>
            <form
              action={queueReportGenerationAction.bind(null, report.id)}
              className="mt-4 space-y-3"
            >
              <fieldset>
                <legend className="text-sm font-medium">Formats</legend>
                <div className="mt-2 flex flex-wrap gap-3">
                  {reportFormats.map((format) => (
                    <label
                      key={format}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        name="formats"
                        value={format}
                        defaultChecked
                      />
                      {format.toUpperCase()}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Button type="submit" disabled={current.immutable}>
                Queue generation
              </Button>
            </form>
            <div className="mt-5 rounded-lg bg-muted p-4 text-sm">
              <p>
                <strong>Status:</strong>{" "}
                {current.renderStatus.replaceAll("_", " ")}
              </p>
              {current.renderError ? (
                <p className="mt-1 text-red-700">{current.renderError}</p>
              ) : null}
              {current.renderedAt ? (
                <p className="mt-1 text-xs text-slate-500">
                  Rendered{" "}
                  {formatDateTime(current.renderedAt, context.timeZone)}
                </p>
              ) : null}
            </div>
            {current.renderStatus === "completed" ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {reportFormats
                  .filter((format) => current.exportKeys[format])
                  .map((format) => (
                    <form
                      key={format}
                      action={`/api/v1/reports/${report.id}/exports/${format}`}
                      method="post"
                    >
                      <Button type="submit" size="sm" variant="secondary">
                        <Download className="size-4" />
                        {format.toUpperCase()}
                      </Button>
                    </form>
                  ))}
              </div>
            ) : null}
          </section>
          <section className="rounded-xl border bg-paper p-5">
            <h2 className="font-semibold">Version history</h2>
            <div className="mt-3 divide-y">
              {versions.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center justify-between gap-3 py-3 text-sm"
                >
                  <span>
                    Version {version.version} ·{" "}
                    {version.status.replaceAll("_", " ")}
                  </span>
                  <span className="text-xs text-slate-500">
                    {version.immutable ? "Immutable" : "Editable"} ·{" "}
                    {formatDateTime(version.createdAt, context.timeZone)}
                  </span>
                </div>
              ))}
            </div>
            {versionDiff ? (
              <div className="mt-4 rounded-lg border bg-muted p-3 text-sm">
                <p className="font-medium">
                  Diff vs version {current.version - 1}
                </p>
                <ul className="mt-2 space-y-1 text-slate-600">
                  <li>
                    Added findings: {versionDiff.added.join(", ") || "none"}
                  </li>
                  <li>
                    Removed findings: {versionDiff.removed.join(", ") || "none"}
                  </li>
                  <li>
                    Changed findings: {versionDiff.changed.join(", ") || "none"}
                  </li>
                  <li>
                    Changed sections:{" "}
                    {versionDiff.changedSections.join(", ") || "none"}
                  </li>
                </ul>
              </div>
            ) : null}
            {current.immutable ? (
              <form
                action={createReportRevisionAction.bind(null, report.id)}
                className="mt-4"
              >
                <Button type="submit">
                  <GitBranch className="size-4" />
                  Create new revision
                </Button>
              </form>
            ) : null}
          </section>
          <section className="rounded-xl border bg-paper p-5">
            <h2 className="font-semibold">Audit trail</h2>
            <div className="mt-3 space-y-3">
              {transitions.map((transition) => (
                <div key={transition.id} className="border-l-2 pl-3 text-sm">
                  <p>
                    {transition.fromStatus.replaceAll("_", " ")} →{" "}
                    {transition.toStatus.replaceAll("_", " ")}
                  </p>
                  {transition.comment ? (
                    <p className="mt-1 text-slate-600">{transition.comment}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(transition.createdAt, context.timeZone)}
                  </p>
                </div>
              ))}
              {!transitions.length ? (
                <p className="text-sm text-slate-500">
                  No transitions recorded.
                </p>
              ) : null}
            </div>
          </section>
        </div>
        <aside className="space-y-6">
          <section className="rounded-xl border bg-paper p-5">
            <h2 className="font-semibold">Workflow</h2>
            <p className="mt-1 text-xs text-slate-500">
              Invalid transitions and edits to published versions are rejected
              server-side.
            </p>
            <form
              action={transitionReportAction.bind(null, report.id)}
              className="mt-4 space-y-3"
            >
              <label className="text-sm font-medium">
                Move to
                <select
                  className={field}
                  name="toStatus"
                  defaultValue={report.status}
                >
                  {reportStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                Review comment
                <textarea className={area} name="comment" />
              </label>
              <Button type="submit" disabled={current.immutable}>
                Apply transition
              </Button>
            </form>
          </section>
          <section className="rounded-xl border bg-paper p-5">
            <h2 className="font-semibold">Model snapshot</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Checksum</dt>
                <dd className="break-all font-mono text-xs">
                  {current.checksum ?? "Generate exports to calculate"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Created</dt>
                <dd>{formatDateTime(current.createdAt, context.timeZone)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Approval</dt>
                <dd>
                  {current.approvedAt
                    ? formatDateTime(current.approvedAt, context.timeZone)
                    : "Pending"}
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}

const field =
  "mt-1 min-h-11 w-full rounded-md border bg-paper px-3 text-sm outline-none focus:border-[var(--harbour-500)]";
const area = `${field} min-h-24 py-2`;
