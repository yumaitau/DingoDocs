export type SlaPolicyRow = {
  severity: string;
  days: number;
  clientId: string | null;
};

/** Client policy wins over the org-wide row for the same severity. */
export function dueAtFromSla(input: {
  severity: string;
  clientId: string;
  policies: SlaPolicyRow[];
  from?: Date;
}): Date | undefined {
  const match =
    input.policies.find(
      (policy) =>
        policy.clientId === input.clientId &&
        policy.severity === input.severity,
    ) ??
    input.policies.find(
      (policy) => policy.clientId == null && policy.severity === input.severity,
    );
  if (!match || !Number.isFinite(match.days) || match.days <= 0)
    return undefined;
  const from = input.from ?? new Date();
  return new Date(from.getTime() + match.days * 24 * 60 * 60 * 1000);
}
