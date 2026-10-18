import { test } from "@e2e-dev/web";
import { expect } from "e2e";

for (const [label, key, values] of [
  ["Period", "period", ["30", "90", "180", "365", "all"]],
  [
    "Severity",
    "severity",
    ["all", "informational", "low", "medium", "high", "critical"],
  ],
  ["Workflow", "status", ["open", "remediated", "risk_accepted", "all"]],
] as const) {
  for (const value of values) {
    test(
      `analytics applies ${label} ${value}`,
      { session: "admin" },
      async ({ app, screen, browser }) => {
        await app.open("/analytics");
        const form = screen.getByRole("form", "Analytics filters");
        await form.getByLabel(label).selectOption({ value });
        await form.getByRole("button", "Apply filters").click();
        await expect(form.getByLabel(label)).toHaveValue(value);
        const url = new URL(await browser.url());
        expect(url.searchParams.get(key)).toBe(value);
        await expect(
          screen.getByRole("heading", "Client risk comparison"),
        ).toBeVisible();
      },
    );
  }
}

test("reset link without token gives useful error", async ({ app, screen }) => {
  await app.open("/reset-password");
  await screen
    .getByPlaceholder("New password (14+ characters)")
    .fill("Synthetic-reset-password-2026!");
  await screen.getByRole("button", "Change password").click();
  await expect(screen.getByRole("status")).toContainText(
    "invalid or incomplete",
  );
});

test("password recovery does not reveal unknown account", async ({
  app,
  screen,
}) => {
  await app.open("/forgot-password");
  await screen
    .getByPlaceholder("Email address")
    .fill(`missing-${crypto.randomUUID()}@example.invalid`);
  await screen.getByRole("button", "Send reset link").click();
  await expect(screen.getByRole("status")).toContainText(
    "If that account exists",
  );
  await screen.getByRole("link", "Return to sign in").click();
  await expect(screen.getByRole("heading", "Welcome back")).toBeVisible();
});

test("empty sign-in and malformed email stay on form", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/sign-in");
  await screen.getByRole("button", "Sign in").click();
  await expect(browser).toHaveURL("/sign-in");
  await screen.getByLabel("Email").fill("invalid-email");
  await screen.getByRole("button", "Sign in").click();
  expect(
    await browser.evaluate(
      () =>
        (document.querySelector('input[type="email"]') as HTMLInputElement)
          .validity.typeMismatch,
    ),
  ).toBe(true);
});

test(
  "portal search finds shared engagement and handles no matches",
  { session: "portal" },
  async ({ app, screen, browser }) => {
    await app.open("/portal");
    await screen.getByLabel("Search shared records").fill("Northstar");
    await screen.getByRole("button", "Search").click();
    await expect(browser).toHaveURL(/q=Northstar/);
    await expect(screen.getByRole("heading", "Search results")).toBeVisible();
    await screen
      .getByLabel("Search shared records")
      .fill(`no-match-${crypto.randomUUID()}`);
    await screen.getByRole("button", "Search").click();
    await expect(
      screen.getByText("No shared records match", { exact: false }),
    ).toBeVisible();
  },
);
