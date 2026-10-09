import type { RiskMatrixDefinition } from "@/db/schema/findings";

export type MatrixSeverity =
  RiskMatrixDefinition["ratings"][number]["severity"];

export function severityFromMatrix(
  definition: RiskMatrixDefinition,
  likelihood: string,
  impact: string,
): MatrixSeverity | null {
  const likelihoodKey = likelihood.trim();
  const impactKey = impact.trim();
  if (!likelihoodKey || !impactKey) return null;
  const match = definition.ratings.find(
    (rating) =>
      rating.likelihood === likelihoodKey && rating.impact === impactKey,
  );
  return match?.severity ?? null;
}
