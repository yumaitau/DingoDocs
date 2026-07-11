import { Download, FileText, ImageIcon, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { createEvidenceAnnotationAction } from "@/server/actions/evidence";
import { listEngagementEvidence } from "@/server/services/evidence";
import type { getEngagementWorkspace } from "@/server/services/engagement-workspace";
import { EvidenceUploadZone } from "./evidence-upload-zone";

type Workspace = NonNullable<
  Awaited<ReturnType<typeof getEngagementWorkspace>>
>;

export async function EvidenceSection({
  engagementId,
  organisationId,
  workspace,
}: {
  engagementId: string;
  organisationId: string;
  workspace: Workspace;
}) {
  const rows = await listEngagementEvidence(organisationId, engagementId);
  return (
    <div className="space-y-6">
      <EvidenceUploadZone
        engagementId={engagementId}
        assets={workspace.assets.map((asset) => ({
          id: asset.id,
          name: asset.name,
        }))}
      />
      <section className="rounded-xl border bg-paper">
        <div className="border-b p-5">
          <h2 className="font-semibold">Evidence register</h2>
          <p className="mt-1 text-sm text-slate-500">
            Authorised previews never expose storage credentials. Downloads are
            audited.
          </p>
        </div>
        <div className="divide-y">
          {rows.map((row) => (
            <article
              key={row.id}
              className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.65fr)]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {row.mediaType.startsWith("image/") ? (
                    <ImageIcon className="size-4" />
                  ) : (
                    <FileText className="size-4" />
                  )}
                  <h3 className="truncate font-medium">
                    {row.originalFilename}
                  </h3>
                  <StatusPill
                    tone={
                      row.classification === "restricted" ? "warning" : "info"
                    }
                  >
                    {row.classification.replaceAll("_", " ")}
                  </StatusPill>
                  <StatusPill
                    tone={
                      row.malwareScanStatus === "clean"
                        ? "success"
                        : row.malwareScanStatus === "infected"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    scan: {row.malwareScanStatus}
                  </StatusPill>
                </div>
                <dl className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                  <div>
                    <dt className="inline font-medium">Version: </dt>
                    <dd className="inline">{row.version}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Size: </dt>
                    <dd className="inline">{formatBytes(row.sizeBytes)}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="inline font-medium">SHA-256: </dt>
                    <dd className="break-all font-mono">{row.sha256}</dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild variant="secondary">
                    <a
                      href={`/api/v1/evidence/${row.id}/preview`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ScanSearch className="size-4" />
                      Preview
                    </a>
                  </Button>
                  <form
                    action={`/api/v1/evidence/${row.id}/download`}
                    method="post"
                  >
                    <Button type="submit" variant="secondary">
                      <Download className="size-4" />
                      Download
                    </Button>
                  </form>
                </div>
                {row.mediaType.startsWith("image/") ? (
                  // The protected route applies the same tenant and restriction checks as downloads.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/v1/evidence/${row.id}/preview`}
                    alt={`Preview of ${row.originalFilename}`}
                    className="mt-4 max-h-80 rounded-lg border object-contain"
                  />
                ) : null}
              </div>
              {row.mediaType.startsWith("image/") ? (
                <AnnotationForm
                  engagementId={engagementId}
                  evidenceId={row.id}
                />
              ) : (
                <div className="rounded-lg bg-muted p-4 text-sm text-slate-500">
                  Screenshot annotations are available for PNG, JPEG, and WebP
                  evidence.
                </div>
              )}
            </article>
          ))}
          {!rows.length ? (
            <p className="p-10 text-center text-sm text-slate-500">
              No evidence has been uploaded.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function AnnotationForm({
  engagementId,
  evidenceId,
}: {
  engagementId: string;
  evidenceId: string;
}) {
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">
        Create annotated version
      </summary>
      <p className="mt-2 text-xs text-slate-500">
        Coordinates are pixels from the top-left. The source remains immutable.
      </p>
      <form
        action={createEvidenceAnnotationAction.bind(
          null,
          engagementId,
          evidenceId,
        )}
        className="mt-4 grid gap-3 sm:grid-cols-2"
      >
        <label className="text-sm font-medium sm:col-span-2">
          Operation
          <select name="type" className={field} defaultValue="redaction">
            <option value="crop">Crop</option>
            <option value="blur">Blur</option>
            <option value="redaction">Redaction</option>
            <option value="highlight">Highlight</option>
            <option value="rectangle">Rectangle</option>
            <option value="ellipse">Ellipse</option>
            <option value="drawing">Freehand drawing</option>
            <option value="text">Text</option>
            <option value="callout">Numbered callout</option>
          </select>
        </label>
        <NumberField name="left" label="Left / X" />
        <NumberField name="top" label="Top / Y" />
        <NumberField name="width" label="Width" />
        <NumberField name="height" label="Height" />
        <NumberField name="x" label="Text/callout X" />
        <NumberField name="y" label="Text/callout Y" />
        <NumberField name="sigma" label="Blur strength" step="0.1" />
        <NumberField name="number" label="Callout number" />
        <label className="text-sm font-medium">
          Colour
          <input
            className={field}
            name="colour"
            type="color"
            defaultValue="#dc2626"
          />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          Text
          <input className={field} name="text" maxLength={500} />
        </label>
        <label className="text-sm font-medium sm:col-span-2">
          Drawing points
          <span className="block text-xs font-normal text-slate-500">
            Space-separated x,y pairs, for example 10,10 30,25
          </span>
          <input className={field} name="points" />
        </label>
        <Button type="submit" className="sm:col-span-2">
          Save as new evidence version
        </Button>
      </form>
    </details>
  );
}

function NumberField({
  name,
  label,
  step = "1",
}: {
  name: string;
  label: string;
  step?: string;
}) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input className={field} name={name} type="number" min="0" step={step} />
    </label>
  );
}

const field =
  "mt-1 min-h-11 w-full rounded-md border bg-paper px-3 text-sm outline-none focus:border-[var(--harbour-500)]";

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
