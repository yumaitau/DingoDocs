import { expect, test } from "@playwright/test";
import { signIn } from "./support/auth";

const productRoutes = [
  ["/clients", "Clients"],
  ["/engagements", "Engagements"],
  ["/findings-library", "Findings Library"],
  ["/reports", "Reports"],
  ["/tasks", "Tasks"],
  ["/templates", "Templates"],
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

test("owner can reach every primary and administration workspace", async ({
  page,
}) => {
  await signIn(page);
  for (const [path, heading] of productRoutes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.locator("nav[aria-label='Primary']")).toHaveCount(1);
  }
});

test("seeded client and engagement remain connected across workspaces", async ({
  page,
}) => {
  await signIn(page);
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
