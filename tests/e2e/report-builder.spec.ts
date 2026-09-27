import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";

test("visual templates persist reordered code and screenshots and can be reused in a report", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(15_000);
  if (testInfo.project.name === "chromium")
    await page.setViewportSize({ width: 1600, height: 1200 });
  const fixture = await context.newPage();
  await fixture.setViewportSize({ width: 900, height: 350 });
  await fixture.setContent(
    '<body style="margin:0;padding:36px;background:#142432;color:#e5f1ff;font:20px monospace"><h2>REPORT EXPORT TEST FIXTURE</h2><pre>$ printf "evidence-test\\n"\nevidence-test\n$ whoami\nexam-demo-user</pre><p>Fictional evidence for automated testing only</p></body>',
  );
  const screenshot = await fixture.screenshot();
  await fixture.close();
  await signIn(page);
  await page.goto("/templates/new");
  await page.getByLabel("Start from").selectOption("blank");
  const name = `OSAI builder ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel("Template name", { exact: true }).fill(name);
  await page.getByTestId("report-block").first().click();
  await page
    .getByLabel("Block title", { exact: true })
    .fill("Assessment overview");
  await page
    .getByLabel("Block content", { exact: true })
    .fill("Fictional assessment prepared to verify reusable report layouts.");
  await page
    .getByRole("button", { name: "Commands / code", exact: true })
    .click();
  await page.getByTestId("report-block").last().click();
  await page
    .getByLabel("Block title", { exact: true })
    .fill("Exact reproduction commands");
  await page
    .getByLabel("Block content", { exact: true })
    .fill(
      'printf "evidence-test\\n"\n  echo "<script> must remain text"\n  echo "Δοκιμή Пример"',
    );
  await page.getByRole("button", { name: "Screenshot", exact: true }).click();
  await page.getByTestId("report-block").last().click();
  await page
    .getByLabel("Block title", { exact: true })
    .fill("Proof screenshot");
  await page
    .getByLabel("Screenshot caption")
    .fill("Fictional terminal evidence for export verification.");
  await page.getByLabel("Upload screenshot").setInputFiles({
    name: "terminal.png",
    mimeType: "image/png",
    buffer: screenshot,
  });
  await expect(
    page.getByTestId("report-block").last().getByRole("img"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Move block up", exact: true })
    .click();
  await expect(page.getByTestId("report-block").nth(1)).toHaveAttribute(
    "data-block-title",
    "Proof screenshot",
  );
  // Exercise Craft's actual drag connector as well as its keyboard-friendly controls.
  if (testInfo.project.name === "chromium") {
    await page
      .getByRole("button", {
        name: "Drag Exact reproduction commands",
        exact: true,
      })
      .dragTo(page.getByTestId("report-block").first(), {
        targetPosition: { x: 80, y: 10 },
      });
  } else {
    await page.getByTestId("report-block").last().click();
    await page
      .getByRole("button", { name: "Move block up", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Move block up", exact: true })
      .click();
  }
  await expect(page.getByTestId("report-block").first()).toHaveAttribute(
    "data-block-title",
    "Exact reproduction commands",
  );
  const order = await page
    .getByTestId("report-block")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-block-title")),
    );
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page).toHaveURL(/\/templates\/[a-f0-9-]{36}$/);
  const templateId = page.url().split("/").at(-1)!;
  await page.reload();
  await expect(page.getByTestId("report-block")).toHaveCount(3);
  expect(
    await page
      .getByTestId("report-block")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-block-title")),
      ),
  ).toEqual(order);
  await expect(
    page.getByRole("img", {
      name: "Fictional terminal evidence for export verification.",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/reports");
  await page.locator("select[name=engagementId]").selectOption({ index: 1 });
  await page.locator("select[name=templateId]").selectOption(templateId);
  await page.getByLabel("Report title", { exact: true }).fill(name);
  await page.getByRole("button", { name: /Create report/i }).click();
  await page
    .getByText(name, { exact: true })
    .locator("../../..")
    .getByRole("link", { name: "Open", exact: true })
    .click();
  await page.getByRole("link", { name: "Write report", exact: true }).click();
  await expect(page.getByTestId("report-block")).toHaveCount(3);
  await page
    .getByTestId("report-block")
    .filter({
      has: page.getByRole("heading", {
        name: "Assessment overview",
        exact: true,
      }),
    })
    .click();
  await page
    .getByLabel("Block content", { exact: true })
    .fill(
      "This is report-specific content, independent of the reusable template.",
    );
  await page
    .getByRole("button", { name: "Save report draft", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Saved successfully");
  await page.reload();
  await expect(
    page.getByText(
      "This is report-specific content, independent of the reusable template.",
      { exact: true },
    ),
  ).toBeVisible();
  const reportId = page.url().split("/").at(-2)!;
  const preview = await page.request.get(`/api/v1/reports/${reportId}/preview`);
  expect(preview.ok()).toBe(true);
  const html = await preview.text();
  expect(html).toContain("&lt;script&gt; must remain text");
  expect(html).toContain("data:image/png;base64,");
  await page.screenshot({
    path: testInfo.outputPath("report-editor.png"),
    fullPage: true,
  });
  await page.goto(`/reports/${reportId}`);
  await page
    .getByRole("button", { name: "Queue generation", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByRole("button", { name: "PDF", exact: true }).count();
      },
      { timeout: 60_000, intervals: [1000, 2000, 3000] },
    )
    .toBe(1);
  const pdf = await page.request.post(
    `/api/v1/reports/${reportId}/exports/pdf`,
  );
  expect(pdf.ok()).toBe(true);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  await writeFile(testInfo.outputPath("evidence-report.pdf"), await pdf.body());
  await page.goto(`/templates/${templateId}`);
  await expect(
    page.getByText(
      "Fictional assessment prepared to verify reusable report layouts.",
      { exact: true },
    ),
  ).toBeVisible();
});

test("OSAI starter supplies target structure and candidate identity", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto("/templates/new");
  await page.getByLabel("Start from").selectOption("osai");
  await expect(page.getByTestId("report-block")).toHaveCount(46);
  await page.getByLabel("OSID", { exact: true }).fill("OS-123456");
  await page.getByLabel("Candidate name", { exact: true }).fill("Exam Demo");
  await page
    .getByLabel("Candidate email", { exact: true })
    .fill("demo@example.test");
  await expect(
    page.getByText("8 screenshot blocks need evidence images.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Template name", { exact: true })
    .fill(`OSAI preset ${Date.now()}`);
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page).toHaveURL(/\/templates\/[a-f0-9-]{36}$/);
  await page.reload();
  await expect(page.getByLabel("OSID", { exact: true })).toHaveValue(
    "OS-123456",
  );
  const templateId = page.url().split("/").at(-1)!;
  await expect(
    page.getByRole("button", { name: /^Drag / }).first(),
  ).toHaveAttribute("draggable", "true");
  await page.screenshot({
    path: testInfo.outputPath("osai-template.png"),
    fullPage: true,
  });
  await page.goto("/reports");
  await page.locator("select[name=engagementId]").selectOption({ index: 1 });
  await page.locator("select[name=templateId]").selectOption(templateId);
  const reportName = `OSAI export ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel("Report title", { exact: true }).fill(reportName);
  await page
    .getByRole("button", { name: "Create report", exact: true })
    .click();
  await page
    .getByText(reportName, { exact: true })
    .locator("../../..")
    .getByRole("link", { name: "Open", exact: true })
    .click();
  await expect(page).toHaveURL(/\/reports\/[a-f0-9-]{36}$/);
  const reportId = page.url().split("/").at(-1)!;
  await page
    .getByRole("button", { name: "Queue generation", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByRole("button", { name: "PDF", exact: true }).count();
      },
      { timeout: 60_000, intervals: [1000, 2000, 3000] },
    )
    .toBe(1);
  const pdf = await page.request.post(
    `/api/v1/reports/${reportId}/exports/pdf`,
  );
  expect(pdf.status(), pdf.ok() ? undefined : await pdf.text()).toBe(200);
  expect(pdf.headers()["content-disposition"]).toBe(
    'attachment; filename="OSAI-OS-123456-Exam-Report.pdf"',
  );
  await writeFile(
    testInfo.outputPath("OSAI-OS-123456-Exam-Report.pdf"),
    await pdf.body(),
  );
});
