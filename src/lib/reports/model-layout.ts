import type { ReportTemplateDefinition } from "@/db/schema";
import type { ReportDocumentModel } from "@/server/services/report-renderers";

export function layoutFromReport(
  model: ReportDocumentModel,
): ReportTemplateDefinition {
  return {
    exam: model.exam,
    sections: model.sections.map((section) => ({
      ...section.definition,
      content: section.content,
    })),
    branding: {
      organisationName: model.organisationName,
      primaryColour: model.theme.primaryColour,
      accentColour: model.theme.accentColour,
      whiteLabel: model.whiteLabel,
      tagline: model.tagline,
      logoUrl: model.logoDataUri,
      clientLogoUrl: model.clientLogoDataUri,
    },
    typography: {
      bodyFont: model.theme.bodyFont,
      headingFont: model.theme.headingFont,
      bodySize: model.theme.bodySize,
    },
    header: { left: model.theme.headerLeft, right: model.theme.headerRight },
    footer: {
      left: model.theme.footerLeft,
      showPageNumbers: model.theme.showPageNumbers,
    },
    watermark: model.theme.watermark,
    classification: model.classification,
    signatures: model.signatures,
  };
}
