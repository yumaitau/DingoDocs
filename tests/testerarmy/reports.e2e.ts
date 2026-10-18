import { test } from "@e2e-dev/web";
import { readFile } from "node:fs/promises";
import { expect } from "e2e";
import { engagementId } from "./support/screens";

for (const [starter, count] of [
  ["blank", 1],
  ["osai", 46],
] as const) {
  test(
    `template ${starter} starter persists and opens a copy`,
    { session: "admin" },
    async ({ app, screen, browser }) => {
      const name = `Army ${starter} ${crypto.randomUUID()}`;
      await app.open("/templates/new");
      await screen
        .getByLabel("Start from", { exact: false })
        .selectOption({ value: starter });
      await expect(screen.getByTestId("report-block")).toHaveCount(count);
      await screen.getByLabel("Template name").fill(name);
      if (starter === "osai") {
        await screen.getByLabel("OSID").fill("OS-123456");
        await screen.getByLabel("Candidate name").fill("Synthetic Candidate");
        await screen
          .getByLabel("Candidate email")
          .fill("candidate@example.invalid");
      }
      await screen.getByRole("button", "Save template").click();
      await expect(browser).toHaveURL(/\/templates\/[a-f0-9-]{36}$/);
      const id = (await browser.url()).split("/").at(-1)!;
      await browser.reload();
      await expect(screen.getByTestId("report-block")).toHaveCount(count);
      if (starter === "osai")
        await expect(screen.getByLabel("OSID")).toHaveValue("OS-123456");
      await app.open(`/templates/new?copy=${id}`);
      await expect(screen.getByLabel("Template name")).toHaveValue(
        `${name} copy`,
      );
      await expect(screen.getByTestId("report-block")).toHaveCount(count);
    },
  );
}

test(
  "report editor adds every palette block, edits all types, reorders, duplicates, deletes, undoes and saves",
  { session: "admin", timeout: 180_000 },
  async ({ app, screen, browser }) => {
    await app.open("/templates/new");
    await screen
      .getByLabel("Start from", { exact: false })
      .selectOption({ value: "blank" });
    const name = `Army layout ${crypto.randomUUID()}`;
    await screen.getByLabel("Template name").fill(name);
    const palette = screen.getByRole("complementary", "Report blocks");
    for (const label of [
      "Text",
      "Commands / code",
      "Screenshot",
      "page break",
      "findings",
      "scope",
      "evidence",
      "table of contents",
      "cover",
    ]) {
      await palette.getByRole("button", label).click();
    }
    await expect(screen.getByTestId("report-block")).toHaveCount(10);
    await screen.getByTestId("report-block").first().click();
    const types = [
      "cover",
      "executive_summary",
      "reusable_content",
      "prose",
      "code",
      "image",
      "findings",
      "scope",
      "assets",
      "chart",
      "risk_matrix",
      "evidence",
      "appendix",
      "page_break",
      "table_of_contents",
      "confidentiality",
      "document_control",
      "methodology",
      "severity_ratings",
      "recommendations",
      "glossary",
      "contacts",
    ];
    for (const type of types) {
      await screen.getByLabel("Block type").selectOption({ value: type });
      await expect(screen.getByLabel("Block type")).toHaveValue(type);
      await screen.getByLabel("Block title").fill(`Synthetic ${type}`);
    }
    await screen.getByRole("button", "Duplicate block").click();
    await expect(screen.getByTestId("report-block")).toHaveCount(11);
    await screen.getByRole("button", "Delete block").click();
    await expect(screen.getByTestId("report-block")).toHaveCount(10);
    await screen.getByRole("button", "Undo").click();
    await expect(screen.getByTestId("report-block")).toHaveCount(11);
    await screen.getByRole("button", "Redo").click();
    await expect(screen.getByTestId("report-block")).toHaveCount(10);
    await screen.getByTestId("report-block").last().click();
    await screen.getByLabel("Block title").fill("Moved block");
    await screen.getByRole("button", "Move block up").click();
    await expect(screen.getByTestId("report-block").nth(8)).toHaveAttribute(
      "data-block-title",
      "Moved block",
    );
    await screen.getByRole("button", "Move block down").click();
    await expect(screen.getByTestId("report-block").last()).toHaveAttribute(
      "data-block-title",
      "Moved block",
    );
    await screen.getByRole("button", "Save template").click();
    await expect(browser).toHaveURL(/\/templates\/[a-f0-9-]{36}$/);
    await browser.reload();
    await expect(screen.getByTestId("report-block")).toHaveCount(10);
    await expect(screen.getByTestId("report-block").last()).toHaveAttribute(
      "data-block-title",
      "Moved block",
    );
  },
);

test(
  "template becomes independent report draft and generates all seven download formats",
  { session: "admin", timeout: 480_000 },
  async ({ app, screen, browser }) => {
    const name = `Army report ${crypto.randomUUID()}`;
    await app.open("/templates/new");
    await screen
      .getByLabel("Start from", { exact: false })
      .selectOption({ value: "blank" });
    await screen.getByLabel("Template name").fill(name);
    await screen.getByTestId("report-block").first().click();
    await screen.getByLabel("Block content").fill("Reusable template content");
    await screen.getByRole("button", "Save template").click();
    await expect(browser).toHaveURL(/\/templates\/[a-f0-9-]{36}$/);
    const templateId = (await browser.url()).split("/").at(-1)!;
    await app.open("/reports");
    await browser
      .locator('select[name="engagementId"]')
      .selectOption({ value: engagementId });
    await browser
      .locator('select[name="templateId"]')
      .selectOption({ value: templateId });
    await screen.getByLabel("Report title").fill(name);
    await screen.getByRole("button", "Create report").click();
    // Report cards are sections in the list; scope from the unique title's parent.
    const title = screen.getByText(name);
    await expect(title).toBeVisible();
    const href = await browser.evaluate((text: string) => {
      const card = Array.from(document.querySelectorAll("a")).find(
        (a) =>
          a.textContent?.trim() === "Open" &&
          a.parentElement?.textContent?.includes(text),
      );
      return card?.getAttribute("href") ?? null;
    }, name);
    expect(href).toBeTruthy();
    await app.open(href!);
    await screen.getByRole("link", "Write report").click();
    await screen.getByTestId("report-block").first().click();
    await screen
      .getByLabel("Block content")
      .fill("Report-specific content <script>literal only</script>");
    await screen.getByRole("button", "Save report draft").click();
    await expect(screen.getByRole("status")).toContainText(
      "Saved successfully",
    );
    await browser.reload();
    await expect(
      screen.getByText("Report-specific content <script>literal only</script>"),
    ).toBeVisible();
    const id = (await browser.url()).split("/").at(-2)!;
    await app.open(`/reports/${id}`);
    await screen.getByRole("button", "Queue generation").click();
    // Scanner uploads share the real worker: five jobs every 30 seconds.
    // Both viewport targets can enqueue a backlog before report generation.
    await expect
      .poll(
        async () => {
          await browser.reload();
          return screen.getByRole("button", "PDF").count();
        },
        { timeout: 360_000, interval: 1500 },
      )
      .toBe(1);
    for (const format of [
      "PDF",
      "DOCX",
      "HTML",
      "MARKDOWN",
      "JSON",
      "XLSX",
      "PPTX",
    ]) {
      const download = await browser.waitForDownload(() =>
        screen.getByRole("button", format, { exact: true }).click(),
      );
      const bytes = await readFile(download.absolutePath);
      expect(bytes.length).toBeGreaterThan(20);
      if (format === "PDF")
        expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
      else if (["DOCX", "XLSX", "PPTX"].includes(format)) {
        expect(bytes.subarray(0, 2).toString()).toBe("PK");
        const entry = (
          {
            DOCX: "word/document.xml",
            XLSX: "xl/workbook.xml",
            PPTX: "ppt/presentation.xml",
          } as Record<string, string>
        )[format];
        expect(bytes.includes(Buffer.from(entry))).toBe(true);
      } else if (format === "JSON") {
        expect(JSON.parse(bytes.toString())).toBeTruthy();
        expect(bytes.toString()).toContain("Report-specific content");
      } else expect(bytes.toString()).toContain("Report-specific content");
    }
    await app.open(`/templates/${templateId}`);
    await expect(screen.getByText("Reusable template content")).toBeVisible();
  },
);
