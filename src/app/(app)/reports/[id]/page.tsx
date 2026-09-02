import { Download, Eye, FileOutput, GitBranch } from "lucide-react";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { requireOrganisationContext } from "@/lib/permissions/require";
import { formatDateTime } from "@/lib/time-zone";
import {
  createReportRevisionAction,
  queueReportGenerationAction,
  transitionReportAction,
} from "@/server/actions/reports";
import {
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
  } catch (error) {
    if (error instanceof ReportScopeError) notFound();
    throw error;
  }
  const { report, current, versions, transitions } = workspace;
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
