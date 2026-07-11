import { mkdir, writeFile } from "node:fs/promises";

async function main() {
  const [{ db, sqlClient }, { reportVersions }, { eq }, { renderReport }] =
    await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("drizzle-orm"),
      import("@/server/services/report-renderers"),
    ]);

  const reportVersionId =
    process.env.REPORT_VERSION_ID ?? "0197f30f-122c-7000-8000-000000000013";
  const [version] = await db
    .select()
    .from(reportVersions)
    .where(eq(reportVersions.id, reportVersionId))
    .limit(1);
  if (!version)
    throw new Error(`Report version ${reportVersionId} was not found`);

  const output = process.env.REPORT_FIXTURE_OUTPUT ?? "tmp/report-qa";
  await mkdir(output, { recursive: true });
  for (const format of ["pdf", "docx", "html", "markdown", "json"] as const) {
    const bytes = await renderReport(
      version.content as Parameters<typeof renderReport>[0],
      format,
    );
    const extension = format === "markdown" ? "md" : format;
    await writeFile(`${output}/starter-report.${extension}`, bytes);
  }
  await sqlClient.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
