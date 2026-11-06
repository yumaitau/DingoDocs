import { expect, test, type Page } from "@playwright/test";
import { adminCredentials, signIn } from "./support/auth";

// Runs in the page so the request carries the app Origin for CSRF checks.
async function changePasswordBack(page: Page, currentPassword: string) {
  return page.evaluate(
    async ({ currentPassword, newPassword }) => {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      return response.status;
    },
    { currentPassword, newPassword: adminCredentials.password },
  );
}

test("signed-in user changes their password from account security", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Mutates the shared seeded admin; run once on desktop only",
  );
  await signIn(page);
  await page.goto("/account/security");
  const newPassword = `E2e-Rotated-${Date.now()}-Pw!`;

  await page.getByLabel("Current password", { exact: true }).fill("wrong");
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill(`${newPassword}x`);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "do not match" }),
  ).toHaveText("The new passwords do not match.");

  await page
    .getByLabel("Current password", { exact: true })
    .fill(adminCredentials.password);
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByLabel("Sign out my other devices").uncheck();
  await page.getByRole("button", { name: "Change password" }).click();
  try {
    await expect(
      page.getByRole("status").filter({ hasText: "Password changed." }),
    ).toBeVisible();
  } finally {
    expect(await changePasswordBack(page, newPassword)).toBeLessThan(500);
  }
});

test("revoking a device asks for confirmation first", async ({
  page,
  request,
  baseURL,
}) => {
  const userAgent = `e2e-confirm-${Date.now()}`;
  const other = await request.post("/api/auth/sign-in/email", {
    headers: { origin: baseURL ?? "", "user-agent": userAgent },
    data: adminCredentials,
  });
  expect(other.ok()).toBe(true);

  await signIn(page);
  await page.goto("/account/security");
  const row = page.getByRole("listitem").filter({ hasText: userAgent });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Revoke" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign out this device?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "Revoke" }).click();
  await dialog.getByRole("button", { name: "Sign out device" }).click();
  await expect(row).toBeHidden();
  await expect(page).toHaveURL(/\/account\/security/);
});
