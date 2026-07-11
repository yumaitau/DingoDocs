import { expect, test, type Page } from "@playwright/test";

test("sign-in is keyboard accessible", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
});

test("demo user reaches the tenant-scoped dashboard and command palette", async ({
  page,
}) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(
    page.getByRole("heading", { name: "Good morning" }),
  ).toBeVisible();
  await expect(
    page.locator('[data-command-palette-ready="true"]'),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toBeVisible();
});

test("engagement workspace tabs remain keyboard accessible", async ({
  page,
}) => {
  await signIn(page);
  await page.goto(
    "/engagements/0197f30f-122c-7000-8000-000000000004?view=scope",
  );
  await expect(page.getByRole("heading", { name: "Scope" })).toBeVisible();
  const assetsTab = page.getByRole("link", { name: "Assets", exact: true });
  await assetsTab.focus();
  await expect(assetsTab).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/view=assets/);
  await expect(page.getByRole("heading", { name: "Assets" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add asset" })).toBeVisible();
});

test("evidence and finding workspaces expose their secure core flows", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const engagement = "/engagements/0197f30f-122c-7000-8000-000000000004";
  await page.goto(`${engagement}?view=evidence`);
  await expect(
    page.getByRole("heading", { name: "Upload evidence" }),
  ).toBeVisible();
  const marker = `${testInfo.project.name}-${Date.now()}-${Math.random()}`;
  await page.locator('input[type="file"]').setInputFiles({
    name: `${marker}.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ marker })),
  });
  await page.getByRole("button", { name: "Upload 1 file" }).click();
  await expect(page.getByText(`${marker}.json uploaded`)).toBeVisible();
  await expect(page.getByText(`${marker}.json`, { exact: true })).toBeVisible();

  await page.goto(`${engagement}?view=findings`);
  await expect(
    page.getByRole("heading", { name: "Create engagement finding" }),
  ).toBeVisible();
  const template = page.getByLabel("Approved template");
  await expect(template).toContainText("Missing object-level authorisation");
  await template.focus();
  await expect(template).toBeFocused();
  await expect(
    page.getByRole("heading", {
      name: "Missing object-level authorisation exposes invoices",
    }),
  ).toBeVisible();
});

test("report workspace and live preview share the seeded report model", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(
    page.getByText("Northstar Customer Portal Assessment", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Server-side exports" }),
  ).toBeVisible();
  await expect(
    page.getByRole("paragraph").filter({
      hasText: "Version 1 · internal review",
    }),
  ).toBeVisible();
  const preview = page.getByRole("link", { name: "Live preview" });
  const previewPath = await preview.getAttribute("href");
  expect(previewPath).toBeTruthy();
  const response = await page.request.get(previewPath!);
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain("Northstar Customer Portal Assessment");
  expect(html).toContain("Missing object-level authorisation exposes invoices");
});

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("admin@dingodocs.local");
  await page.getByLabel("Password").fill("DingoDocs-Demo-2026!");
  const signInResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/auth/sign-in/email"),
  );
  const dashboardNavigationPromise = page.waitForURL(/\/dashboard/, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const signInResponse = await signInResponsePromise;
  if (!signInResponse.ok()) {
    throw new Error(
      `Sign-in failed with ${signInResponse.status()}: ${await signInResponse.text()}`,
    );
  }
  await dashboardNavigationPromise;
}
