/** Case-insensitive whole-phrase redaction for report narrative fields. */
export function redactReportText(value: string, terms: string[]): string {
  if (!value || !terms.length) return value;
  let output = value;
  for (const term of terms) {
    const phrase = term.trim();
    if (!phrase) continue;
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<!\\w)${escaped}(?!\\w)`, "gi");
    output = output.replace(pattern, "[REDACTED]");
  }
  return output;
}

export function parseRedactionTerms(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
}
