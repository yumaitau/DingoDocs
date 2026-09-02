import { test, expect } from "./fixture";
import { signInWithoutFormInput } from "../support/auth";

test("renders public authentication and security metadata", async ({
  page,
  appURL,
}) => {
  const response = await page.goto(appURL("/sign-in"), {
    waitUntil: "domcontentloaded",
  });
  expect(response?.ok()).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  expect(response?.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
});

test("redirects protected workspaces to sign-in", async ({ page, appURL }) => {
  await page.goto(appURL("/clients"), { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
});

test("same-origin authentication reaches the tenant dashboard", async ({
  page,
  appURL,
}) => {
  await signInWithoutFormInput(page, appURL("/"));
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("h1")).toContainText("Good morning");
  await expect(page.getByText("Dingo Security", { exact: true })).toBeVisible();
});

test("authenticated browser reaches core engagement records", async ({
  page,
  appURL,
}) => {
  await signInWithoutFormInput(page, appURL("/"));
  await page.goto(appURL("/clients"), { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toHaveText("Clients");
  await expect(
    page.getByText("Northstar Systems", { exact: true }),
  ).toBeVisible();

  await page.goto(appURL("/engagements"), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("h1")).toHaveText("Engagements");
  await expect(
    page.getByText("Northstar customer portal assessment", { exact: true }),
  ).toBeVisible();

  await page.goto(appURL("/analytics"), { waitUntil: "domcontentloaded" });
  await expect(page.locator("h1")).toHaveText("Risk analytics");
  await expect(
    page.getByRole("heading", { name: "Severity distribution" }),
  ).toBeVisible();

  await page.goto(
    appURL("/engagements/0197f30f-122c-7000-8000-000000000004?view=findings"),
    { waitUntil: "domcontentloaded" },
  );
  await expect(
    page.getByRole("heading", { name: "Create engagement finding" }),
  ).toBeVisible();
  await expect(
    page.getByText("Missing object-level authorisation exposes invoices", {
      exact: true,
    }),
  ).toBeVisible();
});

test("browser session authenticates tenant-scoped REST reads", async ({
  page,
  appURL,
}) => {
  await signInWithoutFormInput(page, appURL("/"));
  const results = await page.evaluate(async () => {
    const paths = [
      "/api/v1/clients",
      "/api/v1/engagements",
      "/api/v1/findings",
      "/api/v1/tasks",
    ];
    return Promise.all(
      paths.map(async (path) => {
        const response = await fetch(path);
        return { path, status: response.status };
      }),
    );
  });
  expect(results).toEqual([
    { path: "/api/v1/clients", status: 200 },
    { path: "/api/v1/engagements", status: 200 },
    { path: "/api/v1/findings", status: 200 },
    { path: "/api/v1/tasks", status: 200 },
  ]);
});
