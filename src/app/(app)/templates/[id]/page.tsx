import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { reportTemplates } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { ReportLayoutEditor } from "@/components/reports/layout-editor";
import { requirePermission } from "@/lib/permissions/require";
import { reviseReportTemplateAction } from "@/server/actions/reports";

export default async function TemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requirePermission("template:manage");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [template] = await db
    .select()
    .from(reportTemplates)
    .where(
      and(
        eq(reportTemplates.id, id),
        eq(reportTemplates.organisationId, context.organisationId),
      ),
    )
    .limit(1);
  if (!template) notFound();
  return (
    <>
      <PageHeader
        title={template.name}
        description={`Version ${template.version}. Saving creates a new version; existing reports keep their original layout.`}
        breadcrumbs={[
          { label: "Templates", href: "/templates" },
          { label: template.name },
        ]}
      />
      <div className="p-4 sm:p-6">
        {template.supersededAt ? (
          <p>
            This template has a newer version. Open the latest version from
            Templates.
          </p>
        ) : (
          <ReportLayoutEditor
            initialDefinition={template.definition}
            customCss={template.customCss ?? ""}
            action={reviseReportTemplateAction.bind(null, id)}
            submitLabel={`Save version ${template.version + 1}`}
          />
        )}
      </div>
    </>
  );
}
