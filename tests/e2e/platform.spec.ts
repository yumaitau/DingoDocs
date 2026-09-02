import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";

const productRoutes = [
  ["/clients", "Clients"],
  ["/analytics", "Risk analytics"],
  ["/engagements", "Engagements"],
  ["/findings-library", "Findings Library"],
  ["/reports", "Reports"],
  ["/tasks", "Tasks"],
  ["/templates", "Templates"],
  ["/runbooks", "Runbooks"],
  ["/imports", "Imports and exports"],
  ["/team", "Team"],
  ["/audit", "Audit Log"],
  ["/integrations", "Integrations and automation"],
  ["/settings", "Security and operations"],
] as const;

test("deployment health, readiness, and API documentation stay public", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "API contract runs once");
  const health = await request.get("/api/health", {
    headers: { "x-request-id": "deployment-e2e" },
  });
  expect(health.ok()).toBe(true);
  expect(health.headers()["x-request-id"]).toBe("deployment-e2e");

  const readiness = await request.get("/api/ready");
  expect(readiness.ok()).toBe(true);

  const openapi = await request.get("/api/openapi");
  expect(openapi.ok()).toBe(true);
  expect(await openapi.json()).toMatchObject({
    openapi: expect.stringMatching(/^3\./),
    info: { title: expect.stringContaining("DingoDocs") },
  });
});

test("tenant resources reject unauthenticated browser clients", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "API contract runs once");
  for (const path of [
    "/api/v1/clients",
    "/api/v1/engagements",
    "/api/v1/findings",
    "/api/v1/tasks",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
  }
});

test("owner can reach every workspace and follow seeded assessment records", async ({
  page,
}) => {
  await signIn(page);
  for (const [path, heading] of productRoutes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.locator("nav[aria-label='Primary']")).toHaveCount(1);
  }

  await page.goto("/analytics");
  await expect(
    page.getByRole("heading", { name: "Severity distribution" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Client risk comparison" }),
  ).toBeVisible();
  await page.getByLabel("Severity").selectOption("high");
  await page.getByLabel("Workflow").selectOption("all");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/\/analytics\?.*severity=high/);
  const findingLink = page.getByRole("table").last().getByRole("link").first();
  await expect(findingLink).toBeVisible();
  await findingLink.click();
  await expect(
    page.getByRole("heading", { name: "Create engagement finding" }),
  ).toBeVisible();

  await page.goto("/clients");
  await page.getByRole("link", { name: /Northstar Systems/ }).click();
  await expect(
    page.getByRole("heading", { name: "Northstar Systems" }),
  ).toBeVisible();
  await expect(
    page.getByText("Financial services", { exact: true }),
  ).toBeVisible();

  await page.goto("/engagements");
  await page
    .getByRole("link", { name: "Northstar customer portal assessment" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Northstar customer portal assessment",
    }),
  ).toBeVisible();
  await expect(page.getByText("ENG-2026-001", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Scope" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Findings", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Evidence" })).toBeVisible();
});

test("user time zone preference persists", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Mutable preference runs once",
  );
  await signIn(page);
  await page.goto("/account/preferences");
  await expect(
    page.getByRole("heading", { name: "Personal preferences" }),
  ).toBeVisible();

  const timeZone = page.getByLabel("Display time zone");
  const save = async (value: string) => {
    await timeZone.selectOption(value);
    const response = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        new URL(candidate.url()).pathname === "/account/preferences",
    );
    await page.getByRole("button", { name: "Save time zone" }).click();
    expect((await response).ok()).toBe(true);
    await page.reload();
    await expect(timeZone).toHaveValue(value);
  };

  await save("Australia/Sydney");
  await save("Pacific/Auckland");
  await save("Australia/Sydney");
});

test("owner can publish and execute a reusable assessment runbook", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Mutable workflow runs once");
  const name = `E2E access-control methodology ${Date.now()}`;

  await signIn(page);
  await page.goto("/runbooks");
  const nameField = page.getByLabel("Name");
  if (!(await nameField.isVisible())) {
    await page.getByText("Create runbook template", { exact: true }).click();
  }
  await nameField.fill(name);
  await page.getByLabel("Assessment types").fill("Web application");
  await page.getByLabel("Step 1 title").fill("Validate tenant boundaries");
  await page
    .getByLabel("Step 1 procedure")
    .fill("Attempt authorised and cross-tenant access to protected resources.");
  await page
    .getByLabel("Step 1 expected evidence")
    .fill("Request and response records");
  await page.getByRole("button", { name: "Save draft runbook" }).click();

  const template = page.locator("article").filter({ hasText: name });
  await expect(template).toContainText("draft");
  await template.getByRole("button", { name: "Publish" }).click();
  await expect(template).toContainText("published");

  await page.goto("/engagements");
  await page
    .getByRole("link", { name: "Northstar customer portal assessment" })
    .click();
  await page.getByRole("link", { name: "Methodology", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Methodology runbooks" }),
  ).toBeVisible();
  const runbookSelect = page.getByLabel("Runbook");
  if (!(await runbookSelect.isVisible())) {
    await page.getByText("Apply published runbook", { exact: true }).click();
  }
  await runbookSelect.selectOption({ label: `${name} · v1 · 1 steps` });
  await page.getByRole("button", { name: "Apply snapshot" }).click();

  const execution = page.locator("section").filter({ hasText: name }).last();
  await expect(execution).toContainText("Validate tenant boundaries");
  await execution.getByText("Update execution record").click();
  await execution.getByLabel("Execution status").selectOption("completed");
  await execution
    .getByLabel("Testing notes")
    .fill("Tenant isolation checks completed and reviewed.");
  await execution.getByLabel("Linked finding").selectOption({ index: 1 });
  await execution.getByLabel("Linked task").selectOption({ index: 1 });
  await execution
    .getByRole("button", { name: "Save execution record" })
    .click();
  await expect(execution).toContainText("100%");
  await expect(execution.getByText("complete", { exact: true })).toBeVisible();
});
