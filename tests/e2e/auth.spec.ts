import { expect, test } from "@playwright/test";

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
  expect(
    signInResponse.ok(),
    `Sign-in failed with ${signInResponse.status()}: ${await signInResponse.text()}`,
  ).toBe(true);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(
    page.getByRole("heading", { name: "Good morning" }),
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toBeVisible();
});
