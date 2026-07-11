import { and, desc, eq, isNull } from "drizzle-orm";
import { BookOpen, Plus } from "lucide-react";
import { db } from "@/db";
import {
  clients,
  reportTemplates,
  type ReportTemplateDefinition,
} from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireOrganisationContext } from "@/lib/permissions/require";
import {
  createReportTemplateAction,
  reviseReportTemplateAction,
} from "@/server/actions/reports";

export default async function TemplatesPage() {
  const context = await requireOrganisationContext();
  const [rows, clientRows] = await Promise.all([
    db
      .select()
      .from(reportTemplates)
      .where(eq(reportTemplates.organisationId, context.organisationId))
      .orderBy(desc(reportTemplates.createdAt)),
    db
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(
        and(
          eq(clients.organisationId, context.organisationId),
          isNull(clients.deletedAt),
        ),
      )
      .orderBy(clients.name),
  ]);
  return (
    <>
      <PageHeader
        title="Templates"
        description="Versioned organisation and client report structures, branding, approvals, signatures, and page furniture."
      />
      <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-xl border bg-paper p-5">
          <div className="flex items-center gap-2">
            <Plus className="size-4" />
            <h2 className="font-semibold">New report template</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            The definition controls ordered and conditional sections, reusable
            content, variables, typography, headers, footers, watermarks,
            approvals, and signatures.
          </p>
          <form
            action={createReportTemplateAction}
            className="mt-4 grid gap-3 md:grid-cols-2"
          >
            <label className="text-sm font-medium">
              Template name
              <input className={field} name="name" required />
            </label>
            <label className="text-sm font-medium">
              Client scope
              <select className={field} name="clientId" defaultValue="">
                <option value="">Organisation-wide</option>
                {clientRows.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium md:col-span-2">
              Definition (JSON)
              <textarea
                className={`${area} min-h-[32rem] font-mono text-xs`}
                name="definition"
                required
                defaultValue={JSON.stringify(starterDefinition, null, 2)}
              />
            </label>
            <label className="text-sm font-medium md:col-span-2">
              Custom print CSS
              <textarea
                className={area}
                name="customCss"
                placeholder="Optional CSS applied to HTML preview and export"
              />
            </label>
            <Button type="submit" className="md:col-span-2 md:w-fit">
              Create template v1
            </Button>
          </form>
        </section>
        <div className="grid gap-4 xl:grid-cols-2">
          {rows.map((template) => (
            <article
              key={template.id}
              className="rounded-xl border bg-paper p-5"
            >
              <BookOpen className="size-5 text-[var(--harbour-600)]" />
              <div className="mt-4 flex items-center justify-between gap-3">
                <h2 className="font-semibold">{template.name}</h2>
                <span className="font-mono text-xs text-slate-500">
                  v{template.version}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {template.clientId ? "Client-specific" : "Organisation"} ·{" "}
                {template.definition.sections.length} sections ·{" "}
                {template.supersededAt ? "Superseded" : "Latest"}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                {template.definition.sections.map((section) => (
                  <span
                    key={section.id}
                    className="rounded-full bg-muted px-2 py-1"
                  >
                    {section.type.replaceAll("_", " ")}
                  </span>
                ))}
              </div>
              {!template.supersededAt ? (
                <details className="mt-5 rounded-lg border p-4">
                  <summary className="cursor-pointer font-medium">
                    Create revised version
                  </summary>
                  <form
                    action={reviseReportTemplateAction.bind(null, template.id)}
                    className="mt-3 space-y-3"
                  >
                    <label className="text-sm font-medium">
                      Definition (JSON)
                      <textarea
                        className={`${area} min-h-[30rem] font-mono text-xs`}
                        name="definition"
                        required
                        defaultValue={JSON.stringify(
                          template.definition,
                          null,
                          2,
                        )}
                      />
                    </label>
                    <label className="text-sm font-medium">
                      Custom print CSS
                      <textarea
                        className={area}
                        name="customCss"
                        defaultValue={template.customCss ?? ""}
                      />
                    </label>
                    <Button type="submit">
                      Create v{template.version + 1}
                    </Button>
                  </form>
                </details>
              ) : null}
            </article>
          ))}
          {!rows.length ? (
            <div className="col-span-full rounded-xl border bg-paper p-14 text-center text-sm text-slate-500">
              No report templates yet.
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

const field =
  "mt-1 min-h-11 w-full rounded-md border bg-paper px-3 text-sm outline-none focus:border-[var(--harbour-500)]";
const area = `${field} min-h-24 py-2`;
const starterDefinition: ReportTemplateDefinition = {
  sections: [
    { id: "cover", type: "cover" },
    {
      id: "executive-summary",
      type: "executive_summary",
      title: "Executive summary",
      content:
        "This report presents the outcomes of {{engagement.name}} for {{client.name}}.",
    },
    {
      id: "methodology",
      type: "reusable_content",
      title: "Methodology",
      reusableKey: "methodology",
    },
    {
      id: "severity-chart",
      type: "chart",
      title: "Finding severity overview",
      condition: { field: "hasFindings", operator: "truthy" },
    },
    { id: "scope", type: "scope", title: "Assessment scope" },
    { id: "assets", type: "assets", title: "Assessed assets" },
    { id: "findings", type: "findings", title: "Detailed findings" },
    {
      id: "evidence",
      type: "evidence",
      title: "Evidence register",
      condition: { field: "hasEvidence", operator: "truthy" },
    },
    {
      id: "appendix",
      type: "appendix",
      title: "Appendix: report controls",
      content:
        "This document is controlled according to the classification shown in its header and footer.",
      options: { pageBreakBefore: true },
    },
  ],
  reusableContent: {
    methodology:
      "Testing followed a risk-based methodology and the approved Rules of Engagement.",
  },
  variables: {},
  branding: { primaryColour: "#174b6b", accentColour: "#d59b2d" },
  typography: { bodyFont: "Arial", headingFont: "Arial", bodySize: 11 },
  header: {
    left: "{{organisation.name}}",
    right: "Confidential",
    showRule: true,
  },
  footer: { left: "{{engagement.reference}}", showPageNumbers: true },
  watermark: "CONFIDENTIAL",
  classification: "Confidential",
  approvals: [
    { role: "peer_reviewer", required: true },
    { role: "quality_assurance", required: true },
  ],
  signatures: [
    { label: "Prepared by", role: "Lead consultant" },
    { label: "Approved by", role: "Quality assurance" },
  ],
};
