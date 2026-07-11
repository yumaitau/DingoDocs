import { desc, eq } from "drizzle-orm";
import { BookOpen, Plus } from "lucide-react";
import { db } from "@/db";
import { reportTemplates } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { requireOrganisationContext } from "@/lib/permissions/require";

export default async function TemplatesPage() {
  const context = await requireOrganisationContext();
  const rows = await db
    .select()
    .from(reportTemplates)
    .where(eq(reportTemplates.organisationId, context.organisationId))
    .orderBy(desc(reportTemplates.createdAt));
  return (
    <>
      <PageHeader
        title="Templates"
        description="Organisation and client-specific report structures, branding, and reusable sections."
        actions={
          <Button>
            <Plus className="size-4" />
            New template
          </Button>
        }
      />
      <div className="grid gap-4 px-4 py-6 sm:grid-cols-2 sm:px-6 lg:px-8 xl:grid-cols-3">
        {rows.map((template) => (
          <div key={template.id} className="rounded-xl border bg-paper p-5">
            <BookOpen className="size-5 text-[var(--harbour-600)]" />
            <h2 className="mt-4 text-sm font-semibold">{template.name}</h2>
            <p className="mt-1 text-xs text-slate-500">
              Version {template.version} ·{" "}
              {template.clientId ? "Client-specific" : "Organisation"}
            </p>
            <Button variant="secondary" size="sm" className="mt-5">
              Edit template
            </Button>
          </div>
        ))}
        {!rows.length ? (
          <div className="col-span-full rounded-xl border bg-paper p-14 text-center text-sm text-slate-500">
            No report templates yet. Seed data includes starter templates.
          </div>
        ) : null}
      </div>
    </>
  );
}
