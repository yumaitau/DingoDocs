import { ClipboardList, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { requireOrganisationContext } from "@/lib/permissions/require";
import {
  createRunbookTemplateAction,
  publishRunbookTemplateAction,
} from "@/server/actions/runbooks";
import { listRunbookTemplates } from "@/server/services/runbooks";

const field =
  "min-h-11 w-full rounded-md border bg-paper px-3 text-sm outline-none focus:border-[var(--harbour-500)]";
const area = `${field} py-2`;

export default async function RunbooksPage() {
  const context = await requireOrganisationContext();
  const templates = await listRunbookTemplates(context.organisationId);
  return (
    <>
      <PageHeader
        title="Runbooks"
        description="Standardise repeatable assessment procedures, then snapshot them into live engagements."
        breadcrumbs={[{ label: "Runbooks" }]}
      />
      <div className="space-y-6 p-4 sm:p-6 lg:p-8">
        <details
          className="rounded-xl border bg-paper"
          open={!templates.length}
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 p-5 font-semibold">
            <Plus className="size-4" /> Create runbook template
          </summary>
          <form
            action={createRunbookTemplateAction}
            className="space-y-5 border-t p-5"
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Name">
                <input className={field} name="name" required maxLength={160} />
              </Field>
              <Field label="Assessment types">
                <input
                  className={field}
                  name="assessmentTypes"
                  placeholder="Web application, API, cloud"
                />
              </Field>
              <Field label="Description">
                <textarea className={area} name="description" rows={3} />
              </Field>
              <Field label="Tags">
                <input
                  className={field}
                  name="tags"
                  placeholder="OWASP, external, repeatable"
                />
              </Field>
            </div>
            <div>
              <h2 className="font-semibold">Procedure steps</h2>
              <p className="mt-1 text-sm text-slate-500">
                Blank rows are ignored. Every saved step needs a title and
                procedure.
              </p>
              <div className="mt-4 space-y-4">
                {[1, 2, 3].map((position) => (
                  <section
                    key={position}
                    className="rounded-lg border bg-[var(--mist)] p-4"
                  >
                    <h3 className="text-sm font-semibold">Step {position}</h3>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      <Field label={`Step ${position} title`}>
                        <input
                          className={field}
                          name="stepTitle"
                          required={position === 1}
                          maxLength={160}
                        />
                      </Field>
                      <Field label={`Step ${position} objective`}>
                        <input className={field} name="stepObjective" />
                      </Field>
                      <Field label={`Step ${position} procedure`}>
                        <textarea
                          className={area}
                          name="stepProcedure"
                          required={position === 1}
                          rows={3}
                        />
                      </Field>
                      <Field label={`Step ${position} expected evidence`}>
                        <textarea
                          className={area}
                          name="stepExpectedEvidence"
                          rows={3}
                        />
                      </Field>
                    </div>
                  </section>
                ))}
              </div>
            </div>
            <Button type="submit">Save draft runbook</Button>
          </form>
        </details>

        <section className="rounded-xl border bg-paper">
          <div className="border-b p-5">
            <h2 className="font-semibold">Procedure library</h2>
            <p className="mt-1 text-sm text-slate-500">
              Published versions are immutable snapshots when applied to an
              engagement.
            </p>
          </div>
          {templates.length ? (
            <div className="divide-y">
              {templates.map((template) => (
                <article key={template.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <ClipboardList className="size-4 text-slate-400" />
                        <h3 className="font-semibold">{template.name}</h3>
                        <StatusPill
                          tone={
                            template.status === "published"
                              ? "success"
                              : "neutral"
                          }
                        >
                          {template.status}
                        </StatusPill>
                      </div>
                      <p className="mt-2 max-w-3xl text-sm text-slate-600">
                        {template.description || "No description supplied."}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        Version {template.version} · {template.steps.length}{" "}
                        steps
                        {template.assessmentTypes.length
                          ? ` · ${template.assessmentTypes.join(", ")}`
                          : ""}
                      </p>
                    </div>
                    {template.status === "draft" ? (
                      <form action={publishRunbookTemplateAction}>
                        <input
                          type="hidden"
                          name="templateId"
                          value={template.id}
                        />
                        <Button type="submit" variant="secondary">
                          Publish
                        </Button>
                      </form>
                    ) : null}
                  </div>
                  <ol className="mt-4 grid gap-2 lg:grid-cols-2">
                    {template.steps.map((step) => (
                      <li
                        key={step.id}
                        className="rounded-md border p-3 text-sm"
                      >
                        <span className="font-medium">
                          {step.position}. {step.title}
                        </span>
                        <p className="mt-1 text-xs text-slate-500">
                          {step.procedure}
                        </p>
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          ) : (
            <p className="p-8 text-center text-sm text-slate-500">
              No reusable runbooks yet.
            </p>
          )}
        </section>
      </div>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}
