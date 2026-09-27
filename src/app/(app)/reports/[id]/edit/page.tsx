import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { ReportLayoutEditor } from "@/components/reports/layout-editor";
import {
  requireInternalOrganisationContext,
  requirePermission,
} from "@/lib/permissions/require";
import { layoutFromReport } from "@/lib/reports/model-layout";
import { getReportWorkspace } from "@/server/services/reports";
import type { ReportDocumentModel } from "@/server/services/report-renderers";
import { saveReportDraftAction } from "@/server/actions/reports";

export default async function EditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  z.uuid().parse(id);
  const organisation = await requireInternalOrganisationContext();
  const { report, current } = await getReportWorkspace(
    organisation.organisationId,
    id,
  );
  await requirePermission("finding:create", {
    engagementId: report.engagementId,
  });
  const model = current.content as ReportDocumentModel;
  const editable =
    !current.immutable &&
    ["draft", "changes_requested"].includes(current.status);
  return (
    <>
      <PageHeader
        title={`Write ${report.title}`}
        description="Write your report, add screenshots and exact commands, then save and regenerate exports."
        breadcrumbs={[
          { label: "Reports", href: "/reports" },
          { label: report.title, href: `/reports/${id}` },
          { label: "Write report" },
        ]}
      />
      <div className="p-4 sm:p-6">
        {editable ? (
          <ReportLayoutEditor
            initialDefinition={layoutFromReport(model)}
            action={saveReportDraftAction.bind(null, id)}
            submitLabel="Save report draft"
            customCss={model.theme.customCss ?? ""}
          >
            <input type="hidden" name="versionId" value={current.id} />
            <input
              type="hidden"
              name="expectedRevision"
              value={model.editRevision ?? "initial"}
            />
          </ReportLayoutEditor>
        ) : (
          <p>
            This version is in review or published. Request changes or create a
            revision before editing.
          </p>
        )}
      </div>
    </>
  );
}
