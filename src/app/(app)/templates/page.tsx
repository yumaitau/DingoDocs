import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { BookOpen, Plus } from "lucide-react";
import { db } from "@/db";
import { reportTemplates } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireInternalOrganisationContext } from "@/lib/permissions/require";

export default async function TemplatesPage() {
  const context = await requireInternalOrganisationContext();
  const rows = await db
    .select()
    .from(reportTemplates)
    .where(eq(reportTemplates.organisationId, context.organisationId))
    .orderBy(desc(reportTemplates.createdAt));
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
          <p className="mt-2 text-sm text-slate-600">
            Create reusable report layouts with drag-and-drop text, commands,
            screenshots and engagement data. Start with the OSAI exam structure,
            a professional pentest report, or a blank page.
          </p>
          <Button asChild className="mt-4">
            <Link href="/templates/new">Open template builder</Link>
          </Button>
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
              <div className="mt-5 flex gap-3">
                {!template.supersededAt && (
                  <Button asChild variant="secondary">
                    <Link href={`/templates/${template.id}`}>Edit layout</Link>
                  </Button>
                )}
                <Button asChild variant="secondary">
                  <Link href={`/templates/new?copy=${template.id}`}>
                    Use as starting point
                  </Link>
                </Button>
              </div>
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
