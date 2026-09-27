import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { clients, reportTemplates } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { ReportLayoutEditor } from "@/components/reports/layout-editor";
import { requirePermission } from "@/lib/permissions/require";
import { professionalPentestTemplate } from "@/lib/reports/professional-template";
import { createReportTemplateAction } from "@/server/actions/reports";

export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams: Promise<{ copy?: string }>;
}) {
  const context = await requirePermission("template:manage");
  const { copy } = await searchParams;
  const rows = await db
    .select({ id: clients.id, name: clients.name })
    .from(clients)
    .where(
      and(
        eq(clients.organisationId, context.organisationId),
        isNull(clients.deletedAt),
      ),
    )
    .orderBy(clients.name);
  const source =
    copy && z.uuid().safeParse(copy).success
      ? (
          await db
            .select()
            .from(reportTemplates)
            .where(
              and(
                eq(reportTemplates.id, copy),
                eq(reportTemplates.organisationId, context.organisationId),
              ),
            )
            .limit(1)
        )[0]
      : undefined;
  if (copy && !source) notFound();
  return (
    <>
      <PageHeader
        title="Create report template"
        description="Build once, reuse across reports. Drag blocks onto the page and edit their content."
        breadcrumbs={[
          { label: "Templates", href: "/templates" },
          { label: "New template" },
        ]}
      />
      <div className="p-4 sm:p-6">
        <ReportLayoutEditor
          initialDefinition={
            source?.definition ?? professionalPentestTemplate()
          }
          action={createReportTemplateAction}
          submitLabel="Save template"
          allowStarters
          customCss={source?.customCss ?? ""}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Template name
              <input
                name="name"
                required
                minLength={2}
                maxLength={200}
                defaultValue={source ? `${source.name} copy` : ""}
                className="mt-1 block w-full rounded border bg-paper p-3"
              />
            </label>
            <label className="text-sm font-medium">
              Client scope
              <select
                name="clientId"
                defaultValue={source?.clientId ?? ""}
                className="mt-1 block w-full rounded border bg-paper p-3"
              >
                <option value="">Organisation-wide</option>
                {rows.map((client) => (
                  <option value={client.id} key={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </ReportLayoutEditor>
      </div>
    </>
  );
}
