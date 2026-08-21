export type IngestSummaryItem = {
  title: string;
  severity: string;
  action: string;
  assetIdentifier?: string | null;
};

export function summariseScannerIngest(input: {
  adapter: string;
  filename: string;
  items: IngestSummaryItem[];
  appliedCount: number;
}) {
  const created = input.items.filter((item) => item.action === "create");
  const duplicates = input.items.filter((item) => item.action === "duplicate");
  const lines = input.items.slice(0, 50).map((item) => {
    const asset = item.assetIdentifier ? ` on ${item.assetIdentifier}` : "";
    return `- [${item.action}] ${item.title}${asset} (${item.severity})`;
  });
  if (input.items.length > 50)
    lines.push(`- … ${input.items.length - 50} additional records omitted`);
  const note = [
    `Scanner ingest: ${input.adapter}`,
    `Source: ${input.filename}`,
    `Records: ${input.items.length} (${input.appliedCount} new drafts, ${duplicates.length} duplicates skipped)`,
    "Imported findings remain draft. They are not client-visible until they complete review and publication.",
    "",
    ...lines,
  ].join("\n");
  const timeline = `${input.adapter} ingest from ${input.filename} applied ${input.appliedCount} draft finding${input.appliedCount === 1 ? "" : "s"} (${created.length} selected creates, ${duplicates.length} duplicates skipped).`;
  return {
    note,
    timeline,
    created: created.length,
    duplicates: duplicates.length,
  };
}
