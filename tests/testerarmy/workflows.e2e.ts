import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { clientId, engagementPath } from "./support/screens";

const unique = (label: string) => `${label} ${crypto.randomUUID()}`;

test(
  "client creation persists full profile and report defaults",
  { session: "admin" },
  async ({ app, screen, browser }) => {
    const name = unique("Army client");
    await app.open("/clients/new");
    await screen.getByLabel("Client name").fill(name);
    await screen.getByLabel("Legal name").fill(`${name} Pty Ltd`);
    await screen.getByLabel("Industry").fill("Synthetic testing");
    await screen.getByRole("button", "Create client").click();
    await expect(browser).toHaveURL(/\/clients\/[a-f0-9-]{36}$/);
    await expect(screen.getByRole("heading", name)).toBeVisible();
    await expect(screen.getByText("Synthetic testing")).toBeVisible();
    await screen
      .getByLabel("Default page size")
      .selectOption({ value: "LETTER" });
    await screen.getByLabel("Redaction terms").fill("Synthetic private phrase");
    for (const field of [
      "Evidence days",
      "Finding days",
      "Report days",
      "Engagement days",
    ])
      await screen.getByLabel(field).fill("365");
    await screen.getByRole("button", "Save defaults").click();
    await browser.reload();
    await expect(screen.getByLabel("Default page size")).toHaveValue("LETTER");
    await expect(screen.getByLabel("Redaction terms")).toHaveValue(
      "Synthetic private phrase",
    );
    await expect(screen.getByLabel("Evidence days")).toHaveValue("365");
  },
);

for (const type of [
  "External Penetration Test",
  "Internal Penetration Test",
  "Web Application Assessment",
  "API Assessment",
  "Mobile Application Assessment",
  "Cloud Security Review",
  "Red Team Exercise",
  "Purple Team Exercise",
  "Vulnerability Assessment",
]) {
  test(
    `engagement creation supports ${type}`,
    { session: "admin" },
    async ({ app, screen, browser }) => {
      const name = unique(type);
      await app.open("/engagements/new");
      await screen.getByLabel("Engagement name").fill(name);
      await screen.getByLabel("Client").selectOption({ value: clientId });
      await screen.getByLabel("Assessment type").selectOption({ label: type });
      await screen.getByLabel("Start date").fill("2026-10-01");
      await screen.getByLabel("End date").fill("2026-10-31");
      await screen.getByRole("button", "Create engagement").click();
      await expect(browser).toHaveURL(/\/engagements\/[a-f0-9-]{36}$/);
      await browser.reload();
      await expect(screen.getByRole("heading", name)).toBeVisible();
      await expect(screen.getByText(type).first()).toBeVisible();
    },
  );
}

for (const stage of ["lead", "scoped", "proposal", "won", "lost"]) {
  test(
    `opportunity persists ${stage} stage and statement of work`,
    { session: "admin" },
    async ({ app, screen, browser }) => {
      const name = unique(`Opportunity ${stage}`);
      await app.open("/opportunities");
      if (!(await screen.getByLabel("Name").isVisible()))
        await browser.locator("summary").first().click();
      await screen.getByLabel("Name").fill(name);
      await screen.getByLabel("Client").selectOption({ value: clientId });
      await screen.getByLabel("Stage").selectOption({ value: stage });
      await screen.getByLabel("Value").fill("45000");
      await screen
        .getByLabel("SoW template")
        .fill("Synthetic authorised assessment scope.");
      await screen.getByRole("button", "Create opportunity").click();
      const row = screen.getByRole("listitem").filter({ hasText: name });
      // Wait for the server action to finish (cold first run) before reloading.
      await expect(row).toBeVisible();
      await browser.reload();
      await expect(row).toContainText(stage);
      await expect(row).toContainText("45000");
      await expect(row).toContainText("Synthetic authorised assessment scope.");
    },
  );
}

for (const criticality of ["low", "medium", "high", "critical"]) {
  test(
    `asset persists ${criticality} criticality`,
    { session: "admin" },
    async ({ app, screen, browser }) => {
      const name = unique("Asset");
      await app.open(`${engagementPath}?view=assets`);
      await screen.getByLabel("Name").fill(name);
      await screen.getByLabel("Type").fill("API");
      await screen
        .getByLabel("Identifier")
        .fill(`${crypto.randomUUID()}.invalid`);
      await screen.getByLabel("Environment").fill("Test");
      await screen.getByLabel("Owner").fill("Test owner");
      await screen
        .getByLabel("Criticality")
        .selectOption({ value: criticality });
      await screen.getByRole("button", "Add asset").click();
      await browser.reload();
      await expect(screen.getByRole("heading", name)).toBeVisible();
      await expect(
        screen.getByRole("article").filter({ hasText: name }),
      ).toContainText(criticality);
    },
  );
}

for (const kind of ["note", "testing_journal"])
  for (const visibility of ["private", "team", "client"]) {
    test(
      `${kind} persists with ${visibility} visibility`,
      { session: "admin" },
      async ({ app, screen, browser }) => {
        const title = unique(`${kind} ${visibility}`);
        await app.open(`${engagementPath}?view=notes`);
        await screen.getByLabel("Type").selectOption({ value: kind });
        await screen
          .getByLabel("Visibility")
          .selectOption({ value: visibility });
        await screen.getByLabel("Title").fill(title);
        await screen
          .getByLabel("Content")
          .fill("Synthetic entry <script>literal text</script>");
        await screen.getByRole("button", "Save entry").click();
        await browser.reload();
        await expect(screen.getByRole("heading", title)).toBeVisible();
        await expect(
          screen
            .getByText("Synthetic entry <script>literal text</script>")
            .first(),
        ).toBeVisible();
      },
    );
  }

for (const priority of ["low", "normal", "high", "urgent"]) {
  test(
    `task persists ${priority} priority, active workflow states and completion`,
    { session: "admin" },
    async ({ app, screen, browser }) => {
      const title = unique(`Task ${priority}`);
      await app.open(`${engagementPath}?view=tasks`);
      await screen.getByLabel("Title").fill(title);
      await screen.getByLabel("Priority").selectOption({ value: priority });
      await screen
        .getByLabel("Description")
        .fill("Synthetic task for workflow verification");
      await screen.getByRole("button", "Create task").click();
      await expect(screen.getByRole("heading", title)).toBeVisible();
      for (const status of [
        "backlog",
        "todo",
        "in_progress",
        "blocked",
        "done",
      ]) {
        // List intentionally excludes terminal states. Board keeps done but not cancelled.
        await app.open("/tasks");
        const row = screen.getByRole("listitem").filter({ hasText: title });
        await row.getByLabel("Status").selectOption({ value: status });
        // Navigating while the server action is pending aborts it (flaky on
        // mobile), so poll the server-rendered list without navigating until
        // the status has persisted. Terminal "done" leaves the list.
        await expect
          .poll(
            () =>
              browser.evaluate(async (text: string) => {
                const html = await (await fetch("/tasks")).text();
                const doc = new DOMParser().parseFromString(html, "text/html");
                const item = [...doc.querySelectorAll("li")].find((li) =>
                  li.textContent?.includes(text),
                );
                if (!item) return "gone";
                return (
                  item
                    .querySelector("select option[selected]")
                    ?.getAttribute("value") ??
                  item.querySelector("select")?.value ??
                  null
                );
              }, title),
            { timeout: 15000, message: `status ${status} did not persist` },
          )
          .toBe(status === "done" ? "gone" : status);
        await app.open(status === "done" ? "/tasks?view=board" : "/tasks");
        const container =
          status === "done"
            ? browser
                .locator("section")
                .filter({
                  has: screen.getByRole("heading", "Done", { exact: true }),
                })
                .getByRole("article")
                .filter({ hasText: title })
            : screen.getByRole("listitem").filter({ hasText: title });
        await expect(container).toContainText(title);
        if (status !== "done")
          await expect(container.getByLabel("Status")).toHaveValue(status);
      }
    },
  );
}

test(
  "cancelled task persists on engagement and leaves active task views",
  { session: "admin" },
  async ({ app, screen, browser }) => {
    const title = unique("Cancelled task");
    await app.open(`${engagementPath}?view=tasks`);
    await screen.getByLabel("Title").fill(title);
    await screen.getByRole("button", "Create task").click();
    await expect(screen.getByRole("heading", title)).toBeVisible();
    await app.open("/tasks");
    const row = screen.getByRole("listitem").filter({ hasText: title });
    await row.getByLabel("Status").selectOption({ value: "cancelled" });
    await expect(row).toHaveCount(0);
    await browser.reload();
    await expect(row).toHaveCount(0);
    await app.open("/tasks?view=board");
    await expect(
      screen.getByRole("article").filter({ hasText: title }),
    ).toHaveCount(0);
    await app.open(`${engagementPath}?view=tasks`);
    await expect(screen.getByRole("heading", title)).toBeVisible();
    await expect(
      screen.getByRole("article").filter({ hasText: title }),
    ).toContainText("cancelled");
  },
);

test(
  "timeline and time log persist detailed entries",
  { session: "admin" },
  async ({ app, screen, browser }) => {
    const phase = unique("Timeline phase");
    await app.open(`${engagementPath}?view=timeline`);
    await screen.getByLabel("Occurred at").fill("2026-10-18T09:00");
    await screen.getByLabel("Phase").fill(phase);
    await screen.getByLabel("Description").fill("Synthetic timeline event");
    await screen.getByLabel("Commands").fill("printf 'fixture'");
    await screen.getByLabel("ATT&CK IDs").fill("T1190");
    await screen.getByRole("button", "Add event").click();
    await browser.reload();
    await expect(screen.getByRole("heading", phase)).toBeVisible();
    await app.open(`${engagementPath}?view=time-tracking`);
    const category = unique("Testing");
    await screen.getByLabel("Category").fill(category);
    await screen.getByLabel("Hours").fill("1.5");
    await screen.getByLabel("Started at").fill("2026-10-18T09:00");
    await screen.getByLabel("Description").fill("Synthetic time entry");
    await screen.getByRole("button", "Log time").click();
    await expect(screen.getByRole("heading", category)).toBeVisible();
    await browser.reload();
    await expect(screen.getByRole("heading", category)).toBeVisible();
  },
);

test(
  "task board saved view restores board navigation",
  { session: "admin" },
  async ({ app, screen, browser }) => {
    const name = unique("Saved board");
    await app.open("/tasks?view=board");
    await screen.getByPlaceholder("View name").fill(name);
    await screen.getByRole("button", "Save view").click();
    await app.open("/tasks");
    await screen.getByRole("link", name).click();
    await expect(browser).toHaveURL("/tasks?view=board");
  },
);

test(
  "schedule previous next and today navigate correct months",
  { session: "admin" },
  async ({ app, screen, browser }) => {
    await app.open("/schedule?month=2026-01");
    await expect(screen.getByRole("heading", "January 2026")).toBeVisible();
    await screen.getByRole("link", "Previous").click();
    await expect(browser).toHaveURL("/schedule?month=2025-12");
    await expect(screen.getByRole("heading", "December 2025")).toBeVisible();
    await screen.getByRole("link", "Next").click();
    await expect(browser).toHaveURL("/schedule?month=2026-01");
    await screen.getByRole("link", "Today").click();
    await expect(browser).toHaveURL("/schedule");
  },
);

test(
  "audit filtering exports exactly filtered events",
  { session: "admin" },
  async ({ app, screen, browser }) => {
    await app.open("/audit");
    const form = screen.getByRole("form", "Audit filters");
    await form.getByLabel("Search").fill("testerarmy-never-matches");
    await form.getByLabel("Action").fill("not.a.real.action");
    await form.getByLabel("Target type").fill("synthetic");
    await form.getByRole("button", "Apply").click();
    await expect(browser).toHaveURL(/q=testerarmy-never-matches/);
    await expect(
      screen.getByText("No audit events recorded yet."),
    ).toBeVisible();
    await expect(screen.getByRole("link", "Export CSV")).toHaveAttribute(
      "href",
      /action=not.a.real.action/,
    );
  },
);
