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

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("admin@dingodocs.local");
  await page.getByLabel("Password").fill("DingoDocs-Demo-2026!");
  const signInResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/auth/sign-in/email"),
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const signInResponse = await signInResponsePromise;
  if (!signInResponse.ok()) {
    throw new Error(
      `Sign-in failed with ${signInResponse.status()}: ${await signInResponse.text()}`,
    );
  }
}
