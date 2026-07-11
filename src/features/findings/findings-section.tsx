import {
  GitCompareArrows,
  MessageSquareText,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import {
  addFindingCommentAction,
  createEngagementFindingAction,
  linkFindingEvidenceAction,
  transitionFindingAction,
  updateFindingFromTemplateAction,
  updateFindingNarrativeAction,
} from "@/server/actions/findings";
import { listEngagementEvidence } from "@/server/services/evidence";
import type { getEngagementWorkspace } from "@/server/services/engagement-workspace";
import {
  compareFindingTemplate,
  getEngagementFindings,
  searchFindingTemplates,
} from "@/server/services/findings";

type Workspace = NonNullable<
  Awaited<ReturnType<typeof getEngagementWorkspace>>
>;

export async function FindingsSection({
  engagementId,
  organisationId,
  workspace,
}: {
  engagementId: string;
  organisationId: string;
  workspace: Workspace;
}) {
  const [rows, templates, evidence] = await Promise.all([
    getEngagementFindings(organisationId, engagementId),
    searchFindingTemplates(organisationId, "", true),
    listEngagementEvidence(organisationId, engagementId),
  ]);
  const comparisons = new Map(
    await Promise.all(
      rows.map(
        async (finding) =>
          [
            finding.id,
            await compareFindingTemplate({ organisationId }, finding.id),
          ] as const,
      ),
    ),
  );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border bg-paper p-5">
        <h2 className="font-semibold">Create engagement finding</h2>
        <p className="mt-1 text-sm text-slate-500">
          New findings snapshot the approved template, so later library edits
          cannot silently change assessment content.
        </p>
        <form
          action={createEngagementFindingAction.bind(null, engagementId)}
          className="mt-4 grid gap-3 md:grid-cols-2"
        >
          <Field label="Approved template">
            <select
              name="templateId"
              className={field}
              required
              defaultValue=""
            >
              <option value="" disabled>
                Select a template
              </option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.title} · v{template.version}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Finding identifier">
            <input
              className={field}
              name="identifier"
              placeholder="F-001"
              required
            />
          </Field>
          {workspace.assets.length ? (
            <fieldset className="md:col-span-2">
              <legend className="text-sm font-medium">Affected assets</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {workspace.assets.map((asset) => (
                  <label
                    key={asset.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input type="checkbox" name="assetIds" value={asset.id} />
                    {asset.name}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          <Button
            type="submit"
            disabled={!templates.length}
            className="md:col-span-2 md:w-fit"
          >
            <Plus className="size-4" />
            Create finding
          </Button>
        </form>
        {!templates.length ? (
          <p className="mt-3 text-sm text-amber-700">
            Approve a finding template in the library before creating an
            engagement finding.
          </p>
        ) : null}
      </section>

      <div className="space-y-4">
        {rows.map((finding) => {
          const comparison = comparisons.get(finding.id);
          return (
            <article key={finding.id} className="rounded-xl border bg-paper">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldCheck className="size-4 text-slate-400" />
                    <span className="font-mono text-xs text-slate-500">
                      {finding.identifier}
                    </span>
                    <h2 className="font-semibold">{finding.title}</h2>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Finding v{finding.version} · template v
                    {finding.templateVersion ?? "custom"}
                    {finding.approvedVersion
                      ? ` · approved v${finding.approvedVersion}`
                      : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <StatusPill tone={severityTone(finding.severity)}>
                    {finding.severity}
                  </StatusPill>
                  <StatusPill tone="info">
                    {finding.status.replaceAll("_", " ")}
                  </StatusPill>
                </div>
              </header>
              <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
                <details open>
                  <summary className="cursor-pointer font-medium">
                    Authoring and scoring
                  </summary>
                  <form
                    action={updateFindingNarrativeAction.bind(
                      null,
                      engagementId,
                      finding.id,
                    )}
                    className="mt-4 grid gap-3 sm:grid-cols-2"
                  >
                    <Field label="Title" wide>
                      <input
                        className={field}
                        name="title"
                        defaultValue={finding.title}
                        required
                      />
                    </Field>
                    <Field label="Severity">
                      <select
                        className={field}
                        name="severity"
                        defaultValue={finding.severity}
                      >
                        {severities.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="CVSS v4 score">
                      <input
                        className={field}
                        name="cvssScore"
                        inputMode="decimal"
                        defaultValue={finding.cvssScore ?? ""}
                        placeholder="0.0–10.0"
                      />
                    </Field>
                    <Field label="CVSS v4 vector" wide>
                      <input
                        className={field}
                        name="cvssVector"
                        defaultValue={finding.cvssVector ?? ""}
                        placeholder="CVSS:4.0/AV:N/AC:L/…"
                      />
                    </Field>
                    <Field label="Likelihood">
                      <input
                        className={field}
                        name="likelihood"
                        defaultValue={finding.likelihood ?? ""}
                      />
                    </Field>
                    <Field label="Impact">
                      <input
                        className={field}
                        name="impact"
                        defaultValue={finding.impact ?? ""}
                      />
                    </Field>
                    <Area
                      label="Executive summary"
                      name="executiveSummary"
                      value={finding.executiveSummary}
                    />
                    <Area
                      label="Technical detail"
                      name="technicalDetail"
                      value={finding.technicalDetail}
                    />
                    <Area
                      label="Reproduction steps"
                      name="reproductionSteps"
                      value={finding.reproductionSteps}
                    />
                    <Area
                      label="Proof of concept"
                      name="proofOfConcept"
                      value={finding.proofOfConcept}
                    />
                    <Area
                      label="Business impact"
                      name="businessImpact"
                      value={finding.businessImpact}
                    />
                    <Area
                      label="Technical impact"
                      name="technicalImpact"
                      value={finding.technicalImpact}
                    />
                    <Area
                      label="Remediation"
                      name="remediation"
                      value={finding.remediation}
                    />
                    <Area
                      label="Verification guidance"
                      name="verificationGuidance"
                      value={finding.verificationGuidance}
                    />
                    <Area
                      label="References"
                      name="references"
                      value={finding.references.join("\n")}
                      hint="One URL or reference per line"
                    />
                    <Area
                      label="Framework mappings"
                      name="mappings"
                      value={finding.mappings
                        .map((mapping) =>
                          [mapping.framework, mapping.reference, mapping.title]
                            .filter(Boolean)
                            .join(" | "),
                        )
                        .join("\n")}
                      hint="Framework | Reference | Optional title"
                    />
                    <Field label="Client owner">
                      <input
                        className={field}
                        name="clientOwner"
                        defaultValue={finding.clientOwner ?? ""}
                      />
                    </Field>
                    <Field label="Due date">
                      <input
                        className={field}
                        name="dueAt"
                        type="date"
                        defaultValue={
                          finding.dueAt?.toISOString().slice(0, 10) ?? ""
                        }
                      />
                    </Field>
                    <Field label="Change summary" wide>
                      <input
                        className={field}
                        name="changeSummary"
                        required
                        minLength={3}
                      />
                    </Field>
                    <Button type="submit" className="sm:col-span-2 sm:w-fit">
                      Save new version
                    </Button>
                  </form>
                </details>
                <div className="space-y-4">
                  {comparison ? (
                    <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                      <div className="flex items-center gap-2 font-medium text-blue-950">
                        <GitCompareArrows className="size-4" />
                        Template v{comparison.latest.version} available
                      </div>
                      <ul className="mt-2 text-xs text-blue-900">
                        {comparison.changes.map((change) => (
                          <li key={change.field}>Changed: {change.field}</li>
                        ))}
                      </ul>
                      <form
                        action={updateFindingFromTemplateAction.bind(
                          null,
                          engagementId,
                          finding.id,
                        )}
                        className="mt-3"
                      >
                        <Button type="submit" size="sm">
                          Apply latest approved template
                        </Button>
                      </form>
                    </section>
                  ) : null}
                  <TransitionForm
                    engagementId={engagementId}
                    findingId={finding.id}
                  />
                  <details className="rounded-lg border p-4">
                    <summary className="cursor-pointer font-medium">
                      Linked evidence and screenshots (
                      {finding.evidenceIds.length})
                    </summary>
                    <form
                      action={linkFindingEvidenceAction.bind(
                        null,
                        engagementId,
                        finding.id,
                      )}
                      className="mt-3 space-y-3"
                    >
                      <div className="max-h-44 space-y-2 overflow-y-auto">
                        {evidence.map((item) => (
                          <label
                            key={item.id}
                            className="flex items-start gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              name="evidenceIds"
                              value={item.id}
                              defaultChecked={finding.evidenceIds.includes(
                                item.id,
                              )}
                            />
                            <span>
                              {item.originalFilename}
                              <span className="block text-xs text-slate-500">
                                v{item.version} · {item.classification}
                              </span>
                            </span>
                          </label>
                        ))}
                        {!evidence.length ? (
                          <p className="text-sm text-slate-500">
                            Upload evidence first.
                          </p>
                        ) : null}
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!evidence.length}
                      >
                        Link selected evidence
                      </Button>
                    </form>
                  </details>
                  <details className="rounded-lg border p-4">
                    <summary className="cursor-pointer font-medium">
                      Comments ({finding.comments.length})
                    </summary>
                    <div className="mt-3 space-y-2">
                      {finding.comments.map((comment) => (
                        <div
                          key={comment.id}
                          className="rounded bg-muted p-3 text-sm"
                        >
                          <p>{comment.body}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {comment.visibility}
                          </p>
                        </div>
                      ))}
                    </div>
                    <form
                      action={addFindingCommentAction.bind(
                        null,
                        engagementId,
                        finding.id,
                      )}
                      className="mt-3 space-y-2"
                    >
                      <textarea
                        className={area}
                        name="body"
                        required
                        placeholder="Review note or implementation comment"
                      />
                      <select
                        className={field}
                        name="visibility"
                        defaultValue="team"
                      >
                        <option value="private">Private</option>
                        <option value="team">Team</option>
                        <option value="client">Client</option>
                      </select>
                      <Button type="submit" size="sm">
                        <MessageSquareText className="size-4" />
                        Add comment
                      </Button>
                    </form>
                  </details>
                </div>
              </div>
            </article>
          );
        })}
        {!rows.length ? (
          <div className="rounded-xl border bg-paper p-12 text-center text-sm text-slate-500">
            No findings have been created for this engagement.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TransitionForm({
  engagementId,
  findingId,
}: {
  engagementId: string;
  findingId: string;
}) {
  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer font-medium">
        Workflow transition
      </summary>
      <form
        action={transitionFindingAction.bind(null, engagementId, findingId)}
        className="mt-3 space-y-3"
      >
        <Field label="Move to">
          <select className={field} name="toStatus">
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Comment">
          <textarea className={area} name="comment" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="override" />
          Authorised workflow override
        </label>
        <Field label="Override reason">
          <textarea className={area} name="overrideReason" />
        </Field>
        <Button type="submit" size="sm">
          Apply transition
        </Button>
      </form>
    </details>
  );
}

function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`text-sm font-medium ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      {children}
    </label>
  );
}

function Area({
  label,
  name,
  value,
  hint,
}: {
  label: string;
  name: string;
  value: string | null;
  hint?: string;
}) {
  return (
    <Field label={label}>
      {hint ? (
        <span className="block text-xs font-normal text-slate-500">{hint}</span>
      ) : null}
      <textarea className={area} name={name} defaultValue={value ?? ""} />
    </Field>
  );
}

const field =
  "mt-1 min-h-11 w-full rounded-md border bg-paper px-3 text-sm outline-none focus:border-[var(--harbour-500)]";
const area = `${field} min-h-24 py-2`;
const severities = [
  "informational",
  "low",
  "medium",
  "high",
  "critical",
] as const;
const statuses = [
  "draft",
  "in_progress",
  "ready_for_review",
  "changes_requested",
  "peer_reviewed",
  "qa_approved",
  "published",
  "remediation_in_progress",
  "ready_for_retest",
  "retested",
  "resolved",
  "risk_accepted",
  "closed",
] as const;

function severityTone(severity: (typeof severities)[number]) {
  if (severity === "critical") return "danger" as const;
  if (severity === "high" || severity === "medium") return "warning" as const;
  return "info" as const;
}
