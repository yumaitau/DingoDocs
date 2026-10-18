import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { checkSelectOptions } from "./support/options";
import {
  engagementPath,
  engagementTabs,
  screens,
  slug,
} from "./support/screens";

for (const [path, heading] of screens) {
  test(
    `workspace screen ${path}`,
    { session: "admin", timeout: 600_000 },
    async ({ app, screen, browser }) => {
      await app.open(path);
      await expect(screen.getByRole("heading", heading).first()).toBeVisible();
      await expect(browser.locator("nav[aria-label='Primary']")).toHaveCount(1);
      await expect(
        screen.getByText("Application error", { exact: false }),
      ).toHaveCount(0);
      // Task status saves immediately and is covered by task workflows.
      if (path !== "/tasks") await checkSelectOptions(browser);
    },
  );
}

for (const tab of engagementTabs) {
  test(
    `engagement tab ${tab}`,
    { session: "admin", timeout: tab === "Findings" ? 900_000 : 600_000 },
    async ({ app, screen, browser }) => {
      await app.open(engagementPath);
      const link = screen
        .getByRole("navigation", "Engagement sections")
        .getByRole("link", tab);
      await link.click();
      await expect(browser).toHaveURL(`${engagementPath}?view=${slug(tab)}`);
      await expect(link).toHaveAttribute("aria-current", "page");
      const title =
        (
          {
            Overview: "Engagement brief",
            Methodology: "Methodology runbooks",
            Findings: "Create engagement finding",
            Evidence: "Upload evidence",
            Team: "Team assignments",
            Notes: "Notes and testing journal",
            Timeline: "Attack timeline",
            "Time Tracking": "Time tracking",
            "Client Portal": "Client portal",
          } as Record<string, string>
        )[tab] ?? tab;
      await expect(screen.getByRole("heading", title).first()).toBeVisible();
      await checkSelectOptions(browser);
    },
  );
}

for (const [path, title] of [
  ["/", "Defensible pentests."],
  ["/sign-in", "Welcome back"],
  ["/sign-up", "Create your account"],
  ["/forgot-password", "Reset your password"],
  ["/reset-password", "Choose a new password"],
]) {
  test(`public screen ${path}`, async ({ app, screen }) => {
    await app.open(path);
    await expect(screen.getByRole("heading", title)).toBeVisible();
  });
}

for (const path of [
  "/dashboard",
  "/clients/new",
  "/settings",
  "/account/security",
  "/account/preferences",
  "/onboarding",
  "/portal",
  "/portal/security",
  `${engagementPath}`,
  "/portal/engagements/0197f30f-122c-7000-8000-000000000004",
]) {
  test(`signed-out route guard ${path}`, async ({ app, browser }) => {
    await app.open(path);
    await expect(browser).toHaveURL(/\/sign-in(?:\?|$)/);
  });
}

test("invitation preserves sign-in return path", async ({ app, browser }) => {
  await app.open("/invite/testerarmy-invalid-token");
  await expect(browser).toHaveURL(
    /\/sign-in\?next=%2Finvite%2Ftesterarmy-invalid-token/,
  );
});

test(
  "invitation screen presents current identity",
  { session: "admin" },
  async ({ app, screen }) => {
    await app.open("/invite/testerarmy-invalid-token");
    await expect(
      screen.getByRole("heading", "Organisation invitation"),
    ).toBeVisible();
    await expect(screen.getByRole("button", "Accept invitation")).toBeEnabled();
  },
);

test(
  "new account reaches onboarding",
  { session: "newcomer" },
  async ({ app, screen }) => {
    await app.open("/onboarding");
    await expect(screen.getByRole("heading")).toContainText(/organisation/i);
    await expect(screen.getByRole("button", /Create/)).toBeVisible();
  },
);

for (const [path, title] of [
  ["/portal", "Your engagements"],
  ["/portal/security", "Account security"],
  [
    "/portal/engagements/0197f30f-122c-7000-8000-000000000004",
    "Northstar customer portal assessment",
  ],
]) {
  test(
    `client portal screen ${path}`,
    { session: "portal" },
    async ({ app, screen }) => {
      await app.open(path);
      await expect(screen.getByRole("heading", title)).toBeVisible();
    },
  );
}

for (const path of [
  "/clients",
  "/settings",
  "/integrations",
  "/imports",
  "/programs",
  "/opportunities",
]) {
  test(
    `client cannot open internal screen ${path}`,
    { session: "portal" },
    async ({ app, browser, screen }) => {
      await app.open(path);
      await expect(browser).toHaveURL("/portal");
      await expect(
        screen.getByRole("heading", "Your engagements"),
      ).toBeVisible();
    },
  );
}
