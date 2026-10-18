import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { clientId, engagementPath } from "./support/screens";

test(
  "program creation and engagement assignment persist",
  { session: "admin" },
  async ({ app, screen, browser }) => {
    const name = `Army program ${crypto.randomUUID()}`;
    await app.open("/programs");
    if (!(await screen.getByLabel("Name").isVisible()))
      await browser.locator("summary").first().click();
    await screen.getByLabel("Client").selectOption({ value: clientId });
    await screen.getByLabel("Name").fill(name);
    await screen.getByLabel("Year").fill("2026");
    await screen.getByRole("button", "Create program").click();
    await expect(screen.getByText(name)).toBeVisible();
    const assignment = screen
      .getByRole("listitem")
      .filter({ hasText: "Northstar customer portal assessment" });
    await assignment
      .getByLabel("Program")
      .selectOption({ label: `${name} (2026)` });
    await assignment.getByRole("button", "Save").click();
    await browser.reload();
    await expect(assignment.getByLabel("Program")).toHaveValue(/.+/);
    await expect(
      screen.getByRole("listitem").filter({ hasText: name }).first(),
    ).toContainText("1 engagements");
  },
);

test(
  "runbook draft publishes, applies snapshot, and persists every execution state",
  { session: "admin" },
  async ({ app, screen, browser }) => {
    const name = `Army runbook ${crypto.randomUUID()}`;
    await app.open("/runbooks");
    if (!(await screen.getByLabel("Name").isVisible()))
      await screen.getByText("Create runbook template").click();
    await screen.getByLabel("Name").fill(name);
    await screen.getByLabel("Assessment types").fill("Web application");
    await screen.getByLabel("Step 1 title").fill("Verify synthetic boundary");
    await screen
      .getByLabel("Step 1 procedure")
      .fill("Perform authorised synthetic check.");
    await screen
      .getByLabel("Step 1 expected evidence")
      .fill("Synthetic request and response");
    await screen.getByRole("button", "Save draft runbook").click();
    const article = screen.getByRole("article").filter({ hasText: name });
    await expect(article).toContainText("draft");
    await article.getByRole("button", "Publish").click();
    await expect(article).toContainText("published");
    await app.open(`${engagementPath}?view=methodology`);
    if (!(await screen.getByLabel("Runbook").isVisible()))
      await screen.getByText("Apply published runbook").click();
    await screen
      .getByLabel("Runbook")
      .selectOption({ label: `${name} · v1 · 1 steps` });
    await screen.getByRole("button", "Apply snapshot").click();
    const section = browser.locator("section").filter({ hasText: name }).last();
    for (const status of [
      "not_started",
      "in_progress",
      "blocked",
      "not_applicable",
      "completed",
    ]) {
      if (!(await section.getByLabel("Execution status").isVisible()))
        await section.getByText("Update execution record").click();
      await section
        .getByLabel("Execution status")
        .selectOption({ value: status });
      await section
        .getByLabel("Testing notes")
        .fill(`Synthetic ${status} result`);
      await section.getByRole("button", "Save execution record").click();
      await browser.reload();
      await section.getByText("Update execution record").click();
      await expect(section.getByLabel("Execution status")).toHaveValue(status);
    }
    await expect(section).toContainText("100%");
  },
);

for (const role of [
  "engagement_manager",
  "lead_consultant",
  "consultant",
  "reviewer",
  "read_only",
]) {
  test(
    `engagement team persists ${role} role`,
    { session: "admin" },
    async ({ app, screen, browser }) => {
      await app.open(`${engagementPath}?view=team`);
      await screen
        .getByLabel("Organisation member")
        .selectOption({ value: "0197f30f-122c-7000-8000-000000000001" });
      await screen.getByLabel("Engagement role").selectOption({ value: role });
      await screen.getByRole("button", "Assign member").click();
      await browser.reload();
      await expect(
        screen.getByRole("article").filter({ hasText: "Alex Morgan" }),
      ).toContainText(role.replaceAll("_", " "));
    },
  );
}

test(
  "rules draft stores testing restrictions and approval",
  { session: "admin" },
  async ({ app, screen, browser }) => {
    await app.open(`${engagementPath}?view=rules-of-engagement`);
    if (!(await screen.getByLabel("Permitted test times").isVisible()))
      await screen.getByText("Create new version").click();
    await screen
      .getByLabel("Permitted test times")
      .fill("Synthetic window 09:00-17:00");
    await screen.getByLabel("Source IP addresses").fill("192.0.2.10");
    await screen.getByLabel("Approved tooling").fill("Synthetic browser");
    await screen
      .getByLabel("Prohibited techniques")
      .fill("Destructive testing");
    await screen.getByLabel("Stop-testing procedure").fill("Stop when asked");
    await screen.getByLabel("Escalation procedure").fill("Contact test owner");
    await screen
      .getByLabel("Evidence handling")
      .fill("Keep synthetic files local");
    await screen
      .getByLabel("Data destruction")
      .fill("Discard disposable test database");
    await screen.getByRole("button", "Save draft version").click();
    await browser.reload();
    await expect(
      screen.getByText("Synthetic window 09:00-17:00"),
    ).toBeVisible();
    await screen.getByRole("button", "Approve rules").click();
    await expect(screen.getByRole("button", "Approve rules")).toHaveCount(0);
  },
);
