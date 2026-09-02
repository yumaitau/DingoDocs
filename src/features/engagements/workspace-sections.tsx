import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { EvidenceSection } from "@/features/evidence/evidence-section";
import { FindingsSection } from "@/features/findings/findings-section";
import {
  acknowledgeRulesAction,
  addScopeItemAction,
  approveRulesAction,
  approveScopeVersionAction,
  assignEngagementMemberAction,
  createAssetAction,
  createRulesVersionAction,
  createScopeDraftAction,
  createTimelineEntryAction,
  createWorkspaceNoteAction,
  createWorkspaceTaskAction,
  logWorkspaceTimeAction,
  transitionEngagementAction,
  updateScopeItemAction,
} from "@/server/actions/engagement-workspace";
import {
  applyRunbookTemplateAction,
  updateEngagementRunbookStepAction,
} from "@/server/actions/runbooks";
import {
  addRetestNoteAction,
  attachRetestEvidenceAction,
  completeRetestAction,
  grantPortalAccessAction,
  revokePortalAccessAction,
  scheduleRetestAction,
  setFindingPortalVisibilityAction,
  setReportPortalVisibilityAction,
} from "@/server/actions/client-portal";
import {
  getEngagementRetests,
  getPortalAdministration,
} from "@/server/services/client-portal";
import {
  getEngagementWorkspace,
  type EngagementStatus,
} from "@/server/services/engagement-workspace";
import {
  getRunbookLinkOptions,
  listEngagementRunbooks,
  listRunbookTemplates,
} from "@/server/services/runbooks";

const managedSections = new Set([
  "Scope",
  "Assets",
  "Rules of Engagement",
  "Team",
  "Methodology",
  "Notes",
  "Timeline",
  "Tasks",
  "Time Tracking",
  "Findings",
  "Evidence",
  "Retesting",
  "Client Portal",
]);

const field =
  "min-h-11 w-full rounded-md border bg-paper px-3 text-sm outline-none focus:border-[var(--harbour-500)]";
const area = `${field} py-2`;

export async function EngagementWorkspaceSection({
  title,
  engagementId,
  organisationId,
  userId,
}: {
  title: string;
  engagementId: string;
  organisationId: string;
  userId: string;
}) {
  if (!managedSections.has(title))
    return <UnimplementedSection title={title} />;
  const workspace = await getEngagementWorkspace(
    { organisationId },
    engagementId,
  );
  if (!workspace) return null;
  const props = { workspace, engagementId, userId };
  switch (title) {
    case "Scope":
      return <ScopeSection {...props} />;
    case "Assets":
      return <AssetsSection {...props} />;
    case "Rules of Engagement":
      return <RulesSection {...props} />;
    case "Team":
      return <TeamSection {...props} />;
    case "Methodology":
      return <MethodologySection {...props} organisationId={organisationId} />;
    case "Notes":
      return <NotesSection {...props} />;
    case "Timeline":
      return <TimelineSection {...props} />;
    case "Tasks":
      return <TasksSection {...props} />;
    case "Time Tracking":
      return <TimeSection {...props} />;
    case "Findings":
      return (
        <FindingsSection
          engagementId={engagementId}
          organisationId={organisationId}
          workspace={workspace}
        />
      );
    case "Evidence":
      return (
        <EvidenceSection
          engagementId={engagementId}
          organisationId={organisationId}
          workspace={workspace}
        />
      );
    case "Retesting":
      return <RetestingSection {...props} organisationId={organisationId} />;
    case "Client Portal":
      return (
        <ClientPortalAdministrationSection
          {...props}
          organisationId={organisationId}
        />
      );
    default:
      return null;
  }
}

async function MethodologySection({
  engagementId,
  organisationId,
}: SectionProps & { organisationId: string }) {
  const [runbooks, templates, links] = await Promise.all([
    listEngagementRunbooks(organisationId, engagementId),
    listRunbookTemplates(organisationId, true),
    getRunbookLinkOptions(organisationId, engagementId),
  ]);
  return (
    <Stack>
      <SectionHeader
        title="Methodology runbooks"
        description="Apply a published procedure, record execution status, and connect each test to its evidence, finding, or follow-up task."
        state={`${runbooks.length} applied`}
      />
      <ActionDetails label="Apply published runbook" open={!runbooks.length}>
        {templates.length ? (
          <form
            action={applyRunbookTemplateAction.bind(null, engagementId)}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <Field label="Runbook">
              <select className={field} name="templateId" required>
                <option value="">Select procedure</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · v{template.version} ·{" "}
                    {template.steps.length} steps
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit">Apply snapshot</Button>
          </form>
        ) : (
          <p className="text-sm text-slate-500">
            Publish a reusable procedure in Runbooks before applying it here.
          </p>
        )}
      </ActionDetails>

      {runbooks.map((runbook) => {
        const terminal = runbook.steps.filter((step) =>
          ["completed", "not_applicable"].includes(step.status),
        ).length;
        const progress = runbook.steps.length
          ? Math.round((terminal / runbook.steps.length) * 100)
          : 0;
        return (
          <section key={runbook.id} className="rounded-xl border bg-paper">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
              <div>
                <h3 className="font-semibold">{runbook.templateName}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Snapshot v{runbook.templateVersion} · {terminal}/
                  {runbook.steps.length} steps complete
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold tabular-nums">
                  {progress}%
                </span>
                <StatusPill
                  tone={
                    runbook.status === "complete"
                      ? "success"
                      : runbook.status === "blocked"
                        ? "danger"
                        : runbook.status === "in_progress"
                          ? "info"
                          : "neutral"
                  }
                >
                  {runbook.status.replaceAll("_", " ")}
                </StatusPill>
              </div>
            </div>
            <ol className="divide-y">
              {runbook.steps.map((step) => (
                <li key={step.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-3xl">
                      <h4 className="font-medium">
                        {step.position}. {step.title}
                      </h4>
                      {step.objective ? (
                        <p className="mt-1 text-sm text-slate-600">
                          {step.objective}
                        </p>
                      ) : null}
                      <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                        {step.procedure}
                      </p>
                      {step.expectedEvidence ? (
                        <p className="mt-2 text-xs text-slate-500">
                          Expected evidence: {step.expectedEvidence}
                        </p>
                      ) : null}
                    </div>
                    <StatusPill
                      tone={
                        step.status === "completed"
                          ? "success"
                          : step.status === "blocked"
                            ? "danger"
                            : step.status === "in_progress"
                              ? "info"
                              : "neutral"
                      }
                    >
                      {step.status.replaceAll("_", " ")}
                    </StatusPill>
                  </div>
                  <details className="mt-4 rounded-lg border bg-[var(--mist)]">
                    <summary className="cursor-pointer p-3 text-sm font-medium">
                      Update execution record
                    </summary>
                    <form
                      action={updateEngagementRunbookStepAction.bind(
                        null,
                        engagementId,
                        step.id,
                      )}
                      className="grid gap-3 border-t p-4 lg:grid-cols-2"
                    >
                      <Field label="Execution status">
                        <select
                          className={field}
                          name="status"
                          defaultValue={step.status}
                        >
                          <option value="not_started">Not started</option>
                          <option value="in_progress">In progress</option>
                          <option value="completed">Completed</option>
                          <option value="blocked">Blocked</option>
                          <option value="not_applicable">Not applicable</option>
                        </select>
                      </Field>
                      <Field label="Testing notes">
                        <textarea
                          className={area}
                          name="notes"
                          rows={3}
                          defaultValue={step.notes ?? ""}
                        />
                      </Field>
                      <Field label="Linked finding">
                        <select
                          className={field}
                          name="findingId"
                          defaultValue={step.findingId ?? ""}
                        >
                          <option value="">None</option>
                          {links.findings.map((finding) => (
                            <option key={finding.id} value={finding.id}>
                              {finding.label} · {finding.title}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Linked evidence">
                        <select
                          className={field}
                          name="evidenceId"
                          defaultValue={step.evidenceId ?? ""}
                        >
                          <option value="">None</option>
                          {links.evidence.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Linked task">
                        <select
                          className={field}
                          name="taskId"
                          defaultValue={step.taskId ?? ""}
                        >
                          <option value="">None</option>
                          {links.tasks.map((task) => (
                            <option key={task.id} value={task.id}>
                              {task.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="flex items-end">
                        <Button type="submit">Save execution record</Button>
                      </div>
                    </form>
                  </details>
                </li>
              ))}
            </ol>
          </section>
        );
      })}

      {!runbooks.length ? (
        <RecordList empty="No methodology runbooks applied yet.">
          {null}
        </RecordList>
      ) : null}
    </Stack>
  );
}

async function ClientPortalAdministrationSection({
  workspace,
  engagementId,
  organisationId,
}: SectionProps & { organisationId: string }) {
  const portal = await getPortalAdministration(
    { organisationId },
    engagementId,
  );
  return (
    <Stack>
      <SectionHeader
        title="Client portal"
        description="Grant named contacts access, then explicitly share only published findings and permitted report versions."
        state={`${portal.grants.length} contacts`}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <ActionDetails label="Grant contact access" open>
          <form
            action={grantPortalAccessAction.bind(null, engagementId)}
            className="grid gap-3 sm:grid-cols-2"
          >
            <Field label="Client contact">
              <select className={field} name="contactId" required>
                <option value="">Select linked user</option>
                {portal.contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name} ({contact.email})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Access level">
              <select
                className={field}
                name="accessLevel"
                defaultValue="standard"
              >
                <option value="standard">Standard</option>
                <option value="administrator">Administrator</option>
                <option value="read_only">Read only</option>
              </select>
            </Field>
            <Button type="submit">Grant access</Button>
          </form>
        </ActionDetails>
        <div className="rounded-xl border bg-paper">
          <div className="border-b p-4">
            <h3 className="font-semibold">Authorised contacts</h3>
          </div>
          {portal.grants.length ? (
            <ul className="divide-y">
              {portal.grants.map((grant) => (
                <li
                  key={grant.id}
                  className="flex items-center justify-between gap-3 p-4"
                >
                  <div>
                    <p className="text-sm font-medium">{grant.name}</p>
                    <p className="text-xs text-slate-500">
                      {grant.email} · {grant.accessLevel}
                    </p>
                  </div>
                  <form
                    action={revokePortalAccessAction.bind(
                      null,
                      engagementId,
                      grant.id,
                    )}
                  >
                    <Button type="submit" size="sm" variant="secondary">
                      Revoke
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-slate-500">
              No contacts can access this engagement.
            </p>
          )}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border bg-paper">
          <div className="border-b p-4">
            <h3 className="font-semibold">Finding publication</h3>
            <p className="mt-1 text-xs text-slate-500">
              Draft and unpublished findings cannot be shared.
            </p>
          </div>
          <ul className="divide-y">
            {portal.findings.map((finding) => (
              <li
                key={finding.id}
                className="flex items-center justify-between gap-3 p-4"
              >
                <div>
                  <p className="text-sm font-medium">
                    {finding.identifier} · {finding.title}
                  </p>
                  <p className="text-xs capitalize text-slate-500">
                    {finding.status.replaceAll("_", " ")}
                  </p>
                </div>
                <form
                  action={setFindingPortalVisibilityAction.bind(
                    null,
                    engagementId,
                    finding.id,
                  )}
                >
                  <input
                    type="hidden"
                    name="visible"
                    value={finding.clientVisible ? "false" : "true"}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    variant={finding.clientVisible ? "secondary" : "primary"}
                    disabled={!finding.publishedAt && !finding.clientVisible}
                  >
                    {finding.clientVisible ? "Hide" : "Share"}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border bg-paper">
          <div className="border-b p-4">
            <h3 className="font-semibold">Report publication</h3>
            <p className="mt-1 text-xs text-slate-500">
              Only client review, approved, or published versions can be shared.
            </p>
          </div>
          <ul className="divide-y">
            {portal.reports.map((report) => {
              const shareable = [
                "client_review",
                "approved",
                "published",
                "superseded",
              ].includes(report.versionStatus);
              return (
                <li
                  key={report.versionId}
                  className="flex items-center justify-between gap-3 p-4"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {report.title} · v{report.version}
                    </p>
                    <p className="text-xs capitalize text-slate-500">
                      {report.versionStatus.replaceAll("_", " ")}
                    </p>
                  </div>
                  <form
                    action={setReportPortalVisibilityAction.bind(
                      null,
                      engagementId,
                      report.versionId,
                    )}
                  >
                    <input
                      type="hidden"
                      name="visible"
                      value={report.clientVisible ? "false" : "true"}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant={report.clientVisible ? "secondary" : "primary"}
                      disabled={!shareable && !report.clientVisible}
                    >
                      {report.clientVisible ? "Hide" : "Share"}
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      {!workspace.availableMembers.length ? (
        <p className="text-xs text-slate-500">
          Client contacts are managed from the client record and must be linked
          to a user account before access can be granted.
        </p>
      ) : null}
    </Stack>
  );
}

async function RetestingSection({
  workspace,
  engagementId,
  organisationId,
}: SectionProps & { organisationId: string }) {
  const retests = await getEngagementRetests({ organisationId }, engagementId);
  return (
    <Stack>
      <SectionHeader
        title="Retesting"
        description="Schedule client requests, preserve evidence and notes, compare results, and generate a new report revision."
        state={`${retests.attempts.length} attempts`}
      />
      <RecordList empty="No retest requests have been submitted.">
        {retests.attempts.map(({ attempt, finding }) => {
          const notes = retests.notes.filter(
            (note) => note.retestAttemptId === attempt.id,
          );
          const attachments = retests.attachments.filter(
            (item) => item.retestAttemptId === attempt.id,
          );
          return (
            <article key={attempt.id} className="border-b p-5 last:border-b-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {finding.identifier} · original version{" "}
                    {attempt.originalFindingVersion}
                  </p>
                  <h3 className="mt-1 font-semibold">{finding.title}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Requested {attempt.requestedAt.toLocaleString()}
                    {attempt.scheduledFor
                      ? ` · scheduled ${attempt.scheduledFor.toLocaleString()}`
                      : ""}
                  </p>
                </div>
                <StatusPill
                  tone={attempt.status === "completed" ? "success" : "info"}
                >
                  {attempt.outcome?.replaceAll("_", " ") ?? attempt.status}
                </StatusPill>
              </div>
              {attempt.notes ? (
                <p className="mt-3 text-sm text-slate-600">{attempt.notes}</p>
              ) : null}
              <details
                className="mt-4 rounded-lg border p-4"
                open={attempt.status !== "completed"}
              >
                <summary className="cursor-pointer text-sm font-semibold">
                  Retest controls
                </summary>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  {attempt.status !== "completed" ? (
                    <form
                      action={scheduleRetestAction}
                      className="space-y-3 rounded-lg bg-muted p-4"
                    >
                      <input
                        type="hidden"
                        name="attemptId"
                        value={attempt.id}
                      />
                      <input
                        type="hidden"
                        name="engagementId"
                        value={engagementId}
                      />
                      <h4 className="text-sm font-semibold">
                        Schedule and assign
                      </h4>
                      <Field label="Assignee">
                        <select
                          className={field}
                          name="assignedTo"
                          required
                          defaultValue={attempt.assignedTo ?? ""}
                        >
                          <option value="">Select tester</option>
                          {workspace.members.map((member) => (
                            <option key={member.userId} value={member.userId}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Scheduled for">
                        <input
                          className={field}
                          type="datetime-local"
                          name="scheduledFor"
                          required
                        />
                      </Field>
                      <Button type="submit" variant="secondary">
                        Save schedule
                      </Button>
                    </form>
                  ) : null}
                  <form
                    action={addRetestNoteAction}
                    className="space-y-3 rounded-lg bg-muted p-4"
                  >
                    <input type="hidden" name="attemptId" value={attempt.id} />
                    <input
                      type="hidden"
                      name="engagementId"
                      value={engagementId}
                    />
                    <h4 className="text-sm font-semibold">Add note</h4>
                    <Field label="Visibility">
                      <select
                        className={field}
                        name="visibility"
                        defaultValue="internal"
                      >
                        <option value="internal">Internal only</option>
                        <option value="client">Shared with client</option>
                      </select>
                    </Field>
                    <Field label="Note">
                      <textarea
                        className={area}
                        name="body"
                        required
                        rows={3}
                      />
                    </Field>
                    <Button type="submit" variant="secondary">
                      Add note
                    </Button>
                  </form>
                  <form
                    action={attachRetestEvidenceAction}
                    className="space-y-3 rounded-lg bg-muted p-4"
                  >
                    <input type="hidden" name="attemptId" value={attempt.id} />
                    <input
                      type="hidden"
                      name="engagementId"
                      value={engagementId}
                    />
                    <h4 className="text-sm font-semibold">Attach evidence</h4>
                    <Field label="Evidence">
                      <select className={field} name="evidenceId" required>
                        <option value="">Select evidence</option>
                        {retests.availableEvidence.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.filename}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Button type="submit" variant="secondary">
                      Attach
                    </Button>
                  </form>
                  {attempt.status !== "completed" ? (
                    <form
                      action={completeRetestAction}
                      className="space-y-3 rounded-lg bg-muted p-4"
                    >
                      <input
                        type="hidden"
                        name="attemptId"
                        value={attempt.id}
                      />
                      <input
                        type="hidden"
                        name="engagementId"
                        value={engagementId}
                      />
                      <h4 className="text-sm font-semibold">Complete retest</h4>
                      <Field label="Outcome">
                        <select className={field} name="outcome" required>
                          <option value="fixed">Fixed</option>
                          <option value="partially_remediated">
                            Partially remediated
                          </option>
                          <option value="not_remediated">Not remediated</option>
                          <option value="risk_accepted">Risk accepted</option>
                          <option value="unable_to_verify">
                            Unable to verify
                          </option>
                        </select>
                      </Field>
                      <Field label="Comparison with original finding">
                        <textarea
                          className={area}
                          name="comparison"
                          required
                          rows={3}
                        />
                      </Field>
                      <Field label="Outcome notes">
                        <textarea className={area} name="notes" rows={2} />
                      </Field>
                      <Button type="submit">
                        Complete and create report revision
                      </Button>
                    </form>
                  ) : null}
                </div>
              </details>
              {attachments.length || notes.length ? (
                <div className="mt-4 grid gap-4 text-xs text-slate-600 sm:grid-cols-2">
                  <div>
                    <h4 className="font-semibold text-slate-800">Evidence</h4>
                    <ul className="mt-1 space-y-1">
                      {attachments.map((item) => (
                        <li key={item.evidenceId}>
                          {item.filename} · {item.classification}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-semibold text-slate-800">Notes</h4>
                    <ul className="mt-1 space-y-1">
                      {notes.map((note) => (
                        <li key={note.id}>
                          <span className="font-medium">{note.visibility}</span>{" "}
                          · {note.body}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </RecordList>
    </Stack>
  );
}

type Workspace = NonNullable<
  Awaited<ReturnType<typeof getEngagementWorkspace>>
>;
type SectionProps = {
  workspace: Workspace;
  engagementId: string;
  userId: string;
};

function ScopeSection({ workspace, engagementId }: SectionProps) {
  const current = workspace.currentScope;
  const draft = current?.status === "draft" ? current : null;
  return (
    <Stack>
      <SectionHeader
        title="Scope"
        description="Every edit is made in a new immutable version and requires approval."
        state={
          current
            ? `Version ${current.version} · ${current.status}`
            : "No version"
        }
      />
      {!draft ? (
        <ActionDetails label={current ? "Create new version" : "Create scope"}>
          <form
            action={createScopeDraftAction.bind(null, engagementId)}
            className="space-y-3"
          >
            <Field label="Change summary">
              <input
                className={field}
                name="changeSummary"
                required
                minLength={3}
              />
            </Field>
            <Button type="submit">
              <Plus className="size-4" />
              Create draft
            </Button>
          </form>
        </ActionDetails>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <ActionDetails label="Add scope item" open>
            <form
              action={addScopeItemAction.bind(null, engagementId)}
              className="grid gap-3 sm:grid-cols-2"
            >
              <input type="hidden" name="scopeVersionId" value={draft.id} />
              <Field label="Name">
                <input className={field} name="name" required />
              </Field>
              <Field label="Type">
                <input
                  className={field}
                  name="type"
                  placeholder="Web application"
                  required
                />
              </Field>
              <Field label="Target" wide>
                <input className={field} name="value" required />
              </Field>
              <Field label="Environment">
                <input className={field} name="environment" />
              </Field>
              <Field label="Scope state">
                <select
                  className={field}
                  name="scopeStatus"
                  defaultValue="in_scope"
                >
                  <option value="in_scope">In scope</option>
                  <option value="excluded">Excluded</option>
                </select>
              </Field>
              <Field label="Exclusion reason" wide>
                <textarea className={area} name="exclusionReason" rows={2} />
              </Field>
              <Field label="Testing restrictions" wide>
                <textarea
                  className={area}
                  name="testingRestrictions"
                  rows={2}
                />
              </Field>
              <Field label="Approved methods (comma-separated)" wide>
                <input className={field} name="approvedMethods" />
              </Field>
              <Button type="submit">Add item</Button>
            </form>
          </ActionDetails>
          <div className="rounded-xl border bg-paper p-5">
            <h3 className="font-semibold">Approve version {draft.version}</h3>
            <p className="mt-1 text-sm text-slate-500">
              Approval freezes this version. Further changes create another
              version.
            </p>
            <form
              action={approveScopeVersionAction.bind(null, engagementId)}
              className="mt-4"
            >
              <input type="hidden" name="scopeVersionId" value={draft.id} />
              <Button type="submit">
                <CheckCircle2 className="size-4" />
                Approve scope
              </Button>
            </form>
          </div>
        </div>
      )}
      <RecordList empty="No scope items in this version.">
        {workspace.currentScopeItems.map((item) => (
          <article key={item.id} className="border-b p-4 last:border-b-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-medium">{item.name}</h3>
                <p className="mt-1 font-mono text-xs text-slate-500">
                  {item.value}
                </p>
              </div>
              <StatusPill
                tone={item.scopeStatus === "excluded" ? "warning" : "success"}
              >
                {item.scopeStatus.replaceAll("_", " ")}
              </StatusPill>
            </div>
            {item.exclusionReason ? (
              <p className="mt-2 text-sm text-slate-600">
                Reason: {item.exclusionReason}
              </p>
            ) : null}
            {draft ? (
              <details className="mt-3 rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Edit item
                </summary>
                <form
                  action={updateScopeItemAction.bind(null, engagementId)}
                  className="mt-3 grid gap-3 sm:grid-cols-2"
                >
                  <input type="hidden" name="scopeVersionId" value={draft.id} />
                  <input type="hidden" name="itemId" value={item.id} />
                  <Field label="Name">
                    <input
                      className={field}
                      name="name"
                      defaultValue={item.name}
                      required
                    />
                  </Field>
                  <Field label="Target">
                    <input
                      className={field}
                      name="value"
                      defaultValue={item.value}
                      required
                    />
                  </Field>
                  <Field label="Scope state">
                    <select
                      className={field}
                      name="scopeStatus"
                      defaultValue={item.scopeStatus}
                    >
                      <option value="in_scope">In scope</option>
                      <option value="excluded">Excluded</option>
                    </select>
                  </Field>
                  <Field label="Exclusion reason">
                    <input
                      className={field}
                      name="exclusionReason"
                      defaultValue={item.exclusionReason ?? ""}
                    />
                  </Field>
                  <Field label="Testing restrictions" wide>
                    <textarea
                      className={area}
                      name="testingRestrictions"
                      defaultValue={item.testingRestrictions ?? ""}
                    />
                  </Field>
                  <Button type="submit">Save changes</Button>
                </form>
              </details>
            ) : null}
          </article>
        ))}
      </RecordList>
      {workspace.scopeVersions.length ? (
        <p className="text-xs text-slate-500">
          Version history:{" "}
          {workspace.scopeVersions
            .map((version) => `v${version.version} ${version.status}`)
            .join(" · ")}
        </p>
      ) : null}
    </Stack>
  );
}

function AssetsSection({ workspace, engagementId }: SectionProps) {
  return (
    <Stack>
      <SectionHeader
        title="Assets"
        description="Assets remain linked to the engagement and its versioned scope."
        state={`${workspace.assets.length} assets`}
      />
      <ActionDetails label="Add asset" open>
        <form
          action={createAssetAction.bind(null, engagementId)}
          className="grid gap-3 sm:grid-cols-2"
        >
          <Field label="Name">
            <input className={field} name="name" required />
          </Field>
          <Field label="Type">
            <input
              className={field}
              name="type"
              placeholder="Application, host, API"
              required
            />
          </Field>
          <Field label="Identifier" wide>
            <input className={field} name="identifier" required />
          </Field>
          <Field label="Environment">
            <input className={field} name="environment" />
          </Field>
          <Field label="Owner">
            <input className={field} name="owner" />
          </Field>
          <Field label="Criticality">
            <select className={field} name="criticality" defaultValue="medium">
              <option>low</option>
              <option>medium</option>
              <option>high</option>
              <option>critical</option>
            </select>
          </Field>
          {workspace.currentScopeItems.length ? (
            <CheckGroup
              label="Linked scope items"
              name="scopeItemIds"
              options={workspace.currentScopeItems.map((item) => ({
                value: item.id,
                label: `${item.name} — ${item.value}`,
              }))}
            />
          ) : null}
          <Button type="submit">Add asset</Button>
        </form>
      </ActionDetails>
      <RecordList empty="No assets recorded.">
        {workspace.assets.map((asset) => (
          <article
            key={asset.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b p-4 last:border-b-0"
          >
            <div>
              <h3 className="font-medium">{asset.name}</h3>
              <p className="mt-1 font-mono text-xs text-slate-500">
                {asset.identifier}
              </p>
            </div>
            <div className="flex gap-2">
              <StatusPill tone="neutral">{asset.type}</StatusPill>
              {asset.criticality ? (
                <StatusPill
                  tone={
                    asset.criticality === "critical" ||
                    asset.criticality === "high"
                      ? "danger"
                      : "info"
                  }
                >
                  {asset.criticality}
                </StatusPill>
              ) : null}
            </div>
          </article>
        ))}
      </RecordList>
    </Stack>
  );
}

function RulesSection({ workspace, engagementId, userId }: SectionProps) {
  const latest = workspace.rules[0];
  const acknowledged = latest
    ? workspace.ruleAcknowledgements.some(
        (entry) => entry.rulesId === latest.id && entry.userId === userId,
      )
    : false;
  return (
    <Stack>
      <SectionHeader
        title="Rules of Engagement"
        description="Structured rules are versioned, approved, and acknowledged by assigned team members."
        state={
          latest
            ? `Version ${latest.version} · ${latest.approvedAt ? "approved" : "draft"}`
            : "No rules"
        }
      />
      {latest ? (
        <article className="rounded-xl border bg-paper p-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Item
              label="Permitted test times"
              value={latest.permittedTestTimes ?? "Not specified"}
            />
            <Item
              label="Source IP addresses"
              value={latest.sourceIpAddresses.join(", ") || "None"}
            />
            <Item
              label="Approved tooling"
              value={latest.approvedTooling.join(", ") || "None"}
            />
            <Item
              label="Prohibited techniques"
              value={latest.prohibitedTechniques.join(", ") || "None"}
            />
            <Item
              label="Stop-testing procedure"
              value={latest.stopTestingProcedure ?? "Not specified"}
            />
            <Item
              label="Escalation procedure"
              value={latest.escalationProcedure ?? "Not specified"}
            />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {!latest.approvedAt ? (
              <form action={approveRulesAction.bind(null, engagementId)}>
                <input type="hidden" name="rulesId" value={latest.id} />
                <Button type="submit">Approve rules</Button>
              </form>
            ) : !acknowledged ? (
              <form action={acknowledgeRulesAction.bind(null, engagementId)}>
                <input type="hidden" name="rulesId" value={latest.id} />
                <Button type="submit">Acknowledge rules</Button>
              </form>
            ) : (
              <StatusPill tone="success">Acknowledged</StatusPill>
            )}
          </div>
        </article>
      ) : null}
      {latest?.approvedAt || !latest ? (
        <ActionDetails
          label={latest ? "Create new version" : "Create rules"}
          open={!latest}
        >
          <form
            action={createRulesVersionAction.bind(null, engagementId)}
            className="grid gap-3 sm:grid-cols-2"
          >
            <Field label="Permitted test times" wide>
              <input className={field} name="permittedTestTimes" />
            </Field>
            <Field label="Source IP addresses">
              <textarea className={area} name="sourceIpAddresses" rows={3} />
            </Field>
            <Field label="Approved tooling">
              <textarea className={area} name="approvedTooling" rows={3} />
            </Field>
            <Field label="Prohibited techniques" wide>
              <textarea className={area} name="prohibitedTechniques" rows={3} />
            </Field>
            <Field label="Stop-testing procedure" wide>
              <textarea
                className={area}
                name="stopTestingProcedure"
                rows={3}
                required
              />
            </Field>
            <Field label="Escalation procedure" wide>
              <textarea
                className={area}
                name="escalationProcedure"
                rows={3}
                required
              />
            </Field>
            <Field label="Evidence handling" wide>
              <textarea
                className={area}
                name="evidenceHandling"
                rows={3}
                required
              />
            </Field>
            <Field label="Data destruction" wide>
              <textarea
                className={area}
                name="dataDestruction"
                rows={3}
                required
              />
            </Field>
            <Button type="submit">Save draft version</Button>
          </form>
        </ActionDetails>
      ) : null}
    </Stack>
  );
}

function TeamSection({ workspace, engagementId }: SectionProps) {
  return (
    <Stack>
      <SectionHeader
        title="Team assignments"
        description="Only active organisation members can receive engagement-level roles."
        state={`${workspace.members.length} assigned`}
      />
      <ActionDetails label="Assign team member" open>
        <form
          action={assignEngagementMemberAction.bind(null, engagementId)}
          className="grid gap-3 sm:grid-cols-2"
        >
          <Field label="Organisation member">
            <select className={field} name="userId" required>
              <option value="">Select a member</option>
              {workspace.availableMembers.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name} ({member.email})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Engagement role">
            <select className={field} name="role" defaultValue="consultant">
              <option value="engagement_manager">Engagement manager</option>
              <option value="lead_consultant">Lead consultant</option>
              <option value="consultant">Consultant</option>
              <option value="reviewer">Reviewer</option>
              <option value="read_only">Read only</option>
            </select>
          </Field>
          <Button type="submit">Assign member</Button>
        </form>
      </ActionDetails>
      <RecordList empty="No team members assigned.">
        {workspace.members.map((member) => (
          <article
            key={member.id}
            className="flex items-center justify-between gap-3 border-b p-4 last:border-b-0"
          >
            <div>
              <h3 className="font-medium">{member.name}</h3>
              <p className="text-xs text-slate-500">{member.email}</p>
            </div>
            <StatusPill tone="info">
              {member.role.replaceAll("_", " ")}
            </StatusPill>
          </article>
        ))}
      </RecordList>
    </Stack>
  );
}

function NotesSection({ workspace, engagementId }: SectionProps) {
  return (
    <Stack>
      <SectionHeader
        title="Notes and testing journal"
        description="Internal working notes and client-visible updates are stored separately by visibility."
        state={`${workspace.notes.length} entries`}
      />
      <ActionDetails label="Add note or journal entry" open>
        <form
          action={createWorkspaceNoteAction.bind(null, engagementId)}
          className="grid gap-3 sm:grid-cols-2"
        >
          <Field label="Type">
            <select className={field} name="kind">
              <option value="note">Note</option>
              <option value="testing_journal">Testing journal</option>
            </select>
          </Field>
          <Field label="Visibility">
            <select className={field} name="visibility">
              <option value="private">Private</option>
              <option value="team">Team</option>
              <option value="client">Client visible</option>
            </select>
          </Field>
          <Field label="Title" wide>
            <input className={field} name="title" required />
          </Field>
          <Field label="Content" wide>
            <textarea className={area} name="body" rows={5} required />
          </Field>
          {workspace.assets.length ? (
            <CheckGroup
              label="Linked assets"
              name="assetIds"
              options={workspace.assets.map((asset) => ({
                value: asset.id,
                label: asset.name,
              }))}
            />
          ) : null}
          <Button type="submit">Save entry</Button>
        </form>
      </ActionDetails>
      <RecordList empty="No notes or journal entries.">
        {workspace.notes.map((note) => (
          <article key={note.id} className="border-b p-4 last:border-b-0">
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-medium">{note.title}</h3>
              <div className="flex gap-2">
                <StatusPill tone="neutral">
                  {note.kind.replaceAll("_", " ")}
                </StatusPill>
                <StatusPill
                  tone={note.visibility === "client" ? "info" : "neutral"}
                >
                  {note.visibility}
                </StatusPill>
              </div>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
              {contentText(note.content)}
            </p>
          </article>
        ))}
      </RecordList>
    </Stack>
  );
}

function TimelineSection({ workspace, engagementId }: SectionProps) {
  return (
    <Stack>
      <SectionHeader
        title="Attack timeline"
        description="Timestamped testing activity preserves commands and client visibility state."
        state={`${workspace.timeline.length} events`}
      />
      <ActionDetails label="Add timeline event" open>
        <form
          action={createTimelineEntryAction.bind(null, engagementId)}
          className="grid gap-3 sm:grid-cols-2"
        >
          <Field label="Occurred at">
            <input
              className={field}
              name="occurredAt"
              type="datetime-local"
              required
            />
          </Field>
          <Field label="Phase">
            <input className={field} name="phase" required />
          </Field>
          <Field label="Description" wide>
            <textarea className={area} name="description" rows={4} required />
          </Field>
          <Field label="Commands" wide>
            <textarea className={area} name="commands" rows={3} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="clientVisible" />
            Client visible
          </label>
          <Button type="submit">Add event</Button>
        </form>
      </ActionDetails>
      <RecordList empty="No timeline events.">
        {workspace.timeline.map((entry) => (
          <article key={entry.id} className="border-b p-4 last:border-b-0">
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-medium">{entry.phase}</h3>
              <time className="text-xs text-slate-500">
                {entry.occurredAt.toLocaleString()}
              </time>
            </div>
            <p className="mt-2 text-sm text-slate-600">{entry.description}</p>
            {entry.commands ? (
              <pre className="mt-2 overflow-x-auto rounded-md bg-slate-950 p-3 text-xs text-white">
                {entry.commands}
              </pre>
            ) : null}
          </article>
        ))}
      </RecordList>
    </Stack>
  );
}

function TasksSection({ workspace, engagementId }: SectionProps) {
  return (
    <Stack>
      <SectionHeader
        title="Tasks"
        description="Tasks are scoped to this engagement and can only be assigned to its team."
        state={`${workspace.tasks.length} tasks`}
      />
      <ActionDetails label="Add task" open>
        <form
          action={createWorkspaceTaskAction.bind(null, engagementId)}
          className="grid gap-3 sm:grid-cols-2"
        >
          <Field label="Title" wide>
            <input className={field} name="title" required />
          </Field>
          <Field label="Priority">
            <select className={field} name="priority" defaultValue="normal">
              <option>low</option>
              <option>normal</option>
              <option>high</option>
              <option>urgent</option>
            </select>
          </Field>
          <Field label="Assignee">
            <select className={field} name="assigneeId">
              <option value="">Unassigned</option>
              {workspace.members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due">
            <input className={field} name="dueAt" type="datetime-local" />
          </Field>
          <Field label="Description" wide>
            <textarea className={area} name="description" rows={3} />
          </Field>
          {workspace.assets.length ? (
            <CheckGroup
              label="Linked assets"
              name="assetIds"
              options={workspace.assets.map((asset) => ({
                value: asset.id,
                label: asset.name,
              }))}
            />
          ) : null}
          <Button type="submit">Create task</Button>
        </form>
      </ActionDetails>
      <RecordList empty="No tasks.">
        {workspace.tasks.map((task) => (
          <article
            key={task.id}
            className="flex flex-wrap items-start justify-between gap-3 border-b p-4 last:border-b-0"
          >
            <div>
              <h3 className="font-medium">{task.title}</h3>
              {task.description ? (
                <p className="mt-1 text-sm text-slate-500">
                  {task.description}
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <StatusPill tone="neutral">
                {task.status.replaceAll("_", " ")}
              </StatusPill>
              <StatusPill
                tone={
                  task.priority === "urgent" || task.priority === "high"
                    ? "warning"
                    : "info"
                }
              >
                {task.priority}
              </StatusPill>
            </div>
          </article>
        ))}
      </RecordList>
    </Stack>
  );
}

function TimeSection({ workspace, engagementId }: SectionProps) {
  const total = workspace.timeEntries.reduce(
    (sum, entry) => sum + Number(entry.hours),
    0,
  );
  return (
    <Stack>
      <SectionHeader
        title="Time tracking"
        description="Consultant time is recorded against the engagement with billable state."
        state={`${total.toFixed(2)} hours`}
      />
      <ActionDetails label="Log time" open>
        <form
          action={logWorkspaceTimeAction.bind(null, engagementId)}
          className="grid gap-3 sm:grid-cols-2"
        >
          <Field label="Category">
            <input
              className={field}
              name="category"
              placeholder="Testing"
              required
            />
          </Field>
          <Field label="Hours">
            <input
              className={field}
              name="hours"
              type="number"
              min="0.01"
              max="24"
              step="0.25"
              required
            />
          </Field>
          <Field label="Started at">
            <input
              className={field}
              name="startedAt"
              type="datetime-local"
              required
            />
          </Field>
          <Field label="Description">
            <input className={field} name="description" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="billable" defaultChecked />
            Billable
          </label>
          <Button type="submit">Log time</Button>
        </form>
      </ActionDetails>
      <RecordList empty="No time entries.">
        {workspace.timeEntries.map((entry) => (
          <article
            key={entry.id}
            className="flex flex-wrap justify-between gap-3 border-b p-4 last:border-b-0"
          >
            <div>
              <h3 className="font-medium">{entry.category}</h3>
              <p className="text-xs text-slate-500">
                {entry.startedAt.toLocaleString()} ·{" "}
                {entry.description ?? "No description"}
              </p>
            </div>
            <StatusPill tone={entry.billable ? "success" : "neutral"}>
              {entry.hours}h · {entry.billable ? "billable" : "non-billable"}
            </StatusPill>
          </article>
        ))}
      </RecordList>
    </Stack>
  );
}

const nextStatuses: Record<EngagementStatus, readonly EngagementStatus[]> = {
  proposed: ["scoping", "cancelled"],
  scoping: ["scheduled", "cancelled"],
  scheduled: ["ready", "scoping", "cancelled"],
  ready: ["testing", "scheduled", "cancelled"],
  testing: ["reporting", "cancelled"],
  reporting: ["peer_review", "testing", "cancelled"],
  peer_review: ["quality_assurance", "reporting", "cancelled"],
  quality_assurance: ["client_review", "reporting", "cancelled"],
  client_review: ["retesting", "complete", "reporting", "cancelled"],
  retesting: ["reporting", "complete", "cancelled"],
  complete: ["archived", "retesting"],
  archived: [],
  cancelled: ["scoping", "archived"],
};

export function EngagementStatusPanel({
  engagementId,
  status,
}: {
  engagementId: string;
  status: EngagementStatus;
}) {
  const options = nextStatuses[status];
  if (!options.length) return null;
  return (
    <section className="mt-6 rounded-xl border bg-paper p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 size-5 text-[var(--harbour-600)]" />
        <div>
          <h2 className="font-semibold">Delivery status</h2>
          <p className="mt-1 text-sm text-slate-500">
            Transitions are validated server-side and written to audit history.
          </p>
        </div>
      </div>
      <form
        action={transitionEngagementAction.bind(null, engagementId)}
        className="mt-4 grid gap-3 sm:grid-cols-[minmax(180px,0.5fr)_1fr_auto]"
      >
        <label className="text-xs font-medium text-slate-600">
          Next status
          <select className={`${field} mt-1`} name="toStatus">
            {options.map((option) => (
              <option key={option} value={option}>
                {option.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Reason
          <input className={`${field} mt-1`} name="reason" />
        </label>
        <Button type="submit" className="self-end">
          Change status
        </Button>
      </form>
    </section>
  );
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
function ActionDetails({
  label,
  children,
  open = false,
}: {
  label: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="rounded-xl border bg-paper" open={open}>
      <summary className="cursor-pointer px-5 py-4 text-sm font-semibold focus-visible:outline-offset-[-3px]">
        {label}
      </summary>
      <div className="border-t p-5">{children}</div>
    </details>
  );
}
function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <label
      className={`block text-xs font-medium text-slate-600 ${wide ? "sm:col-span-2" : ""}`}
    >
      <span className="mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}
function CheckGroup({
  label,
  name,
  options,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <fieldset className="sm:col-span-2">
      <legend className="text-xs font-medium text-slate-600">{label}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-2 rounded-md border p-2 text-sm"
          >
            <input type="checkbox" name={name} value={option.value} />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
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
function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
        {value}
      </dd>
    </div>
  );
}
function contentText(content: Record<string, unknown>) {
  return typeof content.text === "string"
    ? content.text
    : JSON.stringify(content);
}
function UnimplementedSection({ title }: { title: string }) {
  return (
    <section className="rounded-xl border bg-paper">
      <div className="border-b p-5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">
          This workspace is scoped to the active engagement and organisation.
        </p>
      </div>
      <div className="px-5 py-14 text-center">
        <Clock3 className="mx-auto size-7 text-slate-400" />
        <p className="mt-3 text-sm font-medium">
          No {title.toLowerCase()} records yet
        </p>
      </div>
    </section>
  );
}
