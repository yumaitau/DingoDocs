import type { ReportTemplateDefinition } from "@/db/schema";

export function positiveDays(value: unknown): number | undefined {
  const days = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(days) || days <= 0 || days > 36_500) return undefined;
  return Math.floor(days);
}

export function retainUntilFromDays(
  days: number | undefined,
  from = new Date(),
) {
  if (days === undefined) return undefined;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Client report preferences fill gaps. An explicit template value wins. */
export function applyClientReportPreferences<
  T extends { definition: ReportTemplateDefinition },
>(template: T, preferences: Record<string, unknown> | null | undefined): T {
  if (!preferences) return template;
  const pageSize =
    preferences.pageSize === "A4" || preferences.pageSize === "LETTER"
      ? preferences.pageSize
      : undefined;
  const redactionTerms =
    typeof preferences.redactionTerms === "string"
      ? preferences.redactionTerms.trim()
      : "";
  const definition = template.definition;
  const nextPageSize = definition.typography.pageSize ?? pageSize;
  const nextTerms = definition.variables?.redactionTerms || redactionTerms;
  if (
    nextPageSize === definition.typography.pageSize &&
    (definition.variables?.redactionTerms || "") === (nextTerms || "")
  ) {
    return template;
  }
  return {
    ...template,
    definition: {
      ...definition,
      typography: { ...definition.typography, pageSize: nextPageSize },
      variables: {
        ...definition.variables,
        ...(nextTerms ? { redactionTerms: nextTerms } : {}),
      },
    },
  };
}
