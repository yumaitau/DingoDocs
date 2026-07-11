import { and, desc, eq, isNull } from "drizzle-orm";
import { Plus, Search, SlidersHorizontal } from "lucide-react";
import { db } from "@/db";
import { clients, riskMatrices } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { requireOrganisationContext } from "@/lib/permissions/require";
import {
  createFindingTemplateAction,
  createRiskMatrixAction,
  reviseFindingTemplateAction,
  transitionTemplateReviewAction,
} from "@/server/actions/findings";
import { searchFindingTemplates } from "@/server/services/findings";

export default async function FindingsLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const context = await requireOrganisationContext();
  const { q = "" } = await searchParams;
  const [rows, clientRows, matrices] = await Promise.all([
    searchFindingTemplates(context.organisationId, q),
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(
        and(
          eq(clients.organisationId, context.organisationId),
          isNull(clients.deletedAt),
        ),
      ),
    db
      .select()
      .from(riskMatrices)
      .where(eq(riskMatrices.organisationId, context.organisationId))
      .orderBy(desc(riskMatrices.createdAt)),
  ]);

  return (
    <>
      <PageHeader
        title="Findings Library"
        description="Versioned, reviewed language and accessible risk models for consistent assessment findings."
      />
      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
          <section className="rounded-xl border bg-paper p-5">
            <div className="flex items-center gap-2">
              <Plus className="size-4" />
              <h2 className="font-semibold">New finding template</h2>
            </div>
            <TemplateForm
              action={createFindingTemplateAction}
              submit="Create draft template"
              includeStableKey
            />
          </section>
          <section className="rounded-xl border bg-paper p-5">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-4" />
              <h2 className="font-semibold">Risk matrix configuration</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Store organisation-wide or client-specific likelihood/impact
              ratings. Every colour must have a text label.
            </p>
            <form action={createRiskMatrixAction} className="mt-4 space-y-3">
              <Field label="Matrix name">
                <input className={field} name="name" required />
              </Field>
              <Field label="Client scope">
                <select className={field} name="clientId" defaultValue="">
                  <option value="">All clients</option>
                  {clientRows.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Definition (JSON)">
                <textarea
                  className={`${area} min-h-56 font-mono text-xs`}
                  name="definition"
                  required
                  defaultValue={defaultMatrix}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isDefault" />
                Default matrix for this scope
              </label>
              <Button type="submit">Save risk matrix version</Button>
            </form>
            {matrices.length ? (
              <ul className="mt-5 divide-y border-t text-sm">
                {matrices.map((matrix) => (
                  <li
                    key={matrix.id}
                    className="flex justify-between gap-3 py-2"
                  >
                    <span>
                      {matrix.name} · v{matrix.version}
                    </span>
                    <span className="text-xs text-slate-500">
                      {matrix.clientId ? "Client" : "Organisation"}
                      {matrix.isDefault ? " · default" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        <section>
          <form className="mb-4 flex max-w-xl items-end gap-2" method="get">
            <label className="relative block w-full">
              <Search className="absolute bottom-3 left-3 size-4 text-slate-400" />
              <span className="text-sm font-medium">Search templates</span>
              <input
                name="q"
                defaultValue={q}
                placeholder="Title, stable key, CWE, OWASP, tag, or mapping"
                className={`${field} pl-9`}
              />
            </label>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
          <div className="space-y-3">
            {rows.map((row) => (
              <article key={row.id} className="rounded-xl border bg-paper">
                <header className="flex flex-wrap items-start justify-between gap-3 border-b p-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{row.title}</h2>
                      <span className="font-mono text-xs text-slate-500">
                        {row.stableKey} · v{row.version}
                      </span>
                    </div>
                    <p className="mt-1 max-w-3xl text-sm text-slate-600">
                      {row.summary}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <StatusPill tone={severityTone(row.severity)}>
                      {row.severity}
                    </StatusPill>
                    <StatusPill
                      tone={
                        row.reviewStatus === "approved"
                          ? "success"
                          : row.reviewStatus === "changes_requested"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {row.reviewStatus.replaceAll("_", " ")}
                    </StatusPill>
                  </div>
                </header>
                <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.5fr)]">
                  <div>
                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <Item
                        label="Technical description"
                        value={row.technicalDescription}
                      />
                      <Item label="Remediation" value={row.remediation} />
                      <Item
                        label="Tags"
                        value={row.tags.join(", ") || "None"}
                      />
                      <Item
                        label="Assessment types"
                        value={row.assessmentTypes.join(", ") || "Any"}
                      />
                      <Item
                        label="Mappings"
                        value={
                          row.mappings
                            .map(
                              (mapping) =>
                                `${mapping.framework}: ${mapping.reference}`,
                            )
                            .join(", ") || "None"
                        }
                      />
                      <Item
                        label="Review history"
                        value={
                          row.supersededAt
                            ? `Superseded ${row.supersededAt.toLocaleDateString()}`
                            : "Latest version"
                        }
                      />
                    </dl>
                    {!row.supersededAt ? (
                      <details className="mt-4 rounded-lg border p-4">
                        <summary className="cursor-pointer font-medium">
                          Create revised version
                        </summary>
                        <TemplateForm
                          action={reviseFindingTemplateAction.bind(
                            null,
                            row.id,
                          )}
                          submit={`Create v${row.version + 1}`}
                          template={row}
                        />
                      </details>
                    ) : null}
                  </div>
                  <ReviewControls id={row.id} status={row.reviewStatus} />
                </div>
              </article>
            ))}
            {!rows.length ? (
              <div className="rounded-xl border bg-paper p-12 text-center text-sm text-slate-500">
                No templates match this search.
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </>
  );
}

type Template = Awaited<ReturnType<typeof searchFindingTemplates>>[number];

function TemplateForm({
  action,
  submit,
  includeStableKey = false,
  template,
}: {
  action: (formData: FormData) => void | Promise<void>;
  submit: string;
  includeStableKey?: boolean;
  template?: Template;
}) {
  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
      {includeStableKey ? (
        <Field label="Stable key">
          <input
            className={field}
            name="stableKey"
            placeholder="auto-generated when blank"
          />
        </Field>
      ) : null}
      <Field label="Title">
        <input
          className={field}
          name="title"
          required
          defaultValue={template?.title}
        />
      </Field>
      <Field label="Severity">
        <select
          className={field}
          name="severity"
          defaultValue={template?.severity ?? "medium"}
        >
          {severities.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </Field>
      <Field label="Likelihood">
        <input
          className={field}
          name="likelihood"
          defaultValue={template?.likelihood ?? ""}
        />
      </Field>
      <Area label="Summary" name="summary" required value={template?.summary} />
      <Area
        label="Executive description"
        name="executiveDescription"
        value={template?.executiveDescription}
      />
      <Area
        label="Technical description"
        name="technicalDescription"
        required
        value={template?.technicalDescription}
      />
      <Area
        label="Business impact"
        name="businessImpact"
        value={template?.businessImpact}
      />
      <Area
        label="Technical impact"
        name="technicalImpact"
        value={template?.technicalImpact}
      />
      <Area
        label="Risk rationale"
        name="riskRationale"
        value={template?.riskRationale}
      />
      <Area
        label="Remediation"
        name="remediation"
        required
        value={template?.remediation}
      />
      <Area
        label="Verification steps"
        name="verificationSteps"
        value={template?.verificationSteps}
      />
      <Area
        label="References"
        name="references"
        hint="One per line"
        value={template?.references.join("\n")}
      />
      <Area
        label="Tags"
        name="tags"
        hint="Comma or line separated"
        value={template?.tags.join(", ")}
      />
      <Area
        label="Assessment types"
        name="assessmentTypes"
        hint="Comma or line separated"
        value={template?.assessmentTypes.join(", ")}
      />
      <Area
        label="Framework mappings"
        name="mappings"
        hint="Framework | Reference | Optional title"
        value={template?.mappings
          .map((mapping) =>
            [mapping.framework, mapping.reference, mapping.title]
              .filter(Boolean)
              .join(" | "),
          )
          .join("\n")}
      />
      <Button type="submit" className="sm:col-span-2 sm:w-fit">
        {submit}
      </Button>
    </form>
  );
}

function ReviewControls({ id, status }: { id: string; status: string }) {
  const options =
    status === "draft"
      ? ["in_review"]
      : status === "in_review"
        ? ["changes_requested", "approved"]
        : status === "changes_requested"
          ? ["in_review"]
          : [];
  return (
    <section className="rounded-lg bg-muted p-4">
      <h3 className="font-medium">Independent review</h3>
      <p className="mt-1 text-xs text-slate-500">
        Review transitions and requested-change reasons are audited.
      </p>
      {options.length ? (
        <div className="mt-3 space-y-3">
          {options.map((option) => (
            <form
              key={option}
              action={transitionTemplateReviewAction.bind(null, id)}
              className="space-y-2"
            >
              <input type="hidden" name="toStatus" value={option} />
              {option === "changes_requested" ? (
                <textarea
                  className={area}
                  name="reason"
                  required
                  placeholder="Required changes"
                />
              ) : null}
              <Button
                type="submit"
                size="sm"
                variant={option === "approved" ? "primary" : "secondary"}
              >
                {option.replaceAll("_", " ")}
              </Button>
            </form>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-slate-500">
          No further review transition is available for this version.
        </p>
      )}
    </section>
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
    <label className="text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
function Area({
  label,
  name,
  value,
  required,
  hint,
}: {
  label: string;
  name: string;
  value?: string | null;
  required?: boolean;
  hint?: string;
}) {
  return (
    <Field label={label}>
      {hint ? (
        <span className="block text-xs font-normal text-slate-500">{hint}</span>
      ) : null}
      <textarea
        className={area}
        name={name}
        defaultValue={value ?? ""}
        required={required}
      />
    </Field>
  );
}
function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-slate-700">{value}</dd>
    </div>
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
function severityTone(severity: (typeof severities)[number]) {
  if (severity === "critical") return "danger" as const;
  if (severity === "high" || severity === "medium") return "warning" as const;
  return "info" as const;
}

const defaultMatrix = JSON.stringify(
  {
    likelihood: [
      { key: "unlikely", label: "Unlikely", order: 1 },
      { key: "likely", label: "Likely", order: 2 },
    ],
    impact: [
      { key: "minor", label: "Minor", order: 1 },
      { key: "major", label: "Major", order: 2 },
    ],
    ratings: [
      {
        likelihood: "unlikely",
        impact: "minor",
        severity: "low",
        label: "Low",
        colour: "#2563eb",
      },
      {
        likelihood: "unlikely",
        impact: "major",
        severity: "medium",
        label: "Medium",
        colour: "#ca8a04",
      },
      {
        likelihood: "likely",
        impact: "minor",
        severity: "medium",
        label: "Medium",
        colour: "#ca8a04",
      },
      {
        likelihood: "likely",
        impact: "major",
        severity: "high",
        label: "High",
        colour: "#dc2626",
      },
    ],
  },
  null,
  2,
);
