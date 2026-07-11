import { expect, test, type Page } from "@playwright/test";

test("sign-in is keyboard accessible", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with a passkey" }),
  ).toBeVisible();
  const response = await page.request.get("/api/health", {
    headers: { "x-request-id": "e2e-correlation-id" },
  });
  expect(response.headers()["x-request-id"]).toBe("e2e-correlation-id");
  expect(response.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("sign-in failures are audited and locked out without account enumeration", async ({
  request,
}) => {
  const email = `lockout-${Date.now()}-${Math.random()}@test.invalid`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await request.post("/api/auth/sign-in/email", {
      data: { email, password: "not-the-password" },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  }
  const locked = await request.post("/api/auth/sign-in/email", {
    data: { email, password: "not-the-password" },
  });
  expect(locked.status()).toBe(429);
  expect(locked.headers()["retry-after"]).toBe("900");
});

test("cross-origin authentication posts are rejected by CSRF origin checks", async ({
  request,
}) => {
  const response = await request.post("/api/auth/sign-in/email", {
    headers: { origin: "https://attacker.invalid" },
    data: {
      email: `csrf-${Date.now()}@test.invalid`,
      password: "not-the-password",
    },
  });
  expect(response.status()).toBeGreaterThanOrEqual(400);
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
  await page
    .getByPlaceholder("Search pages, clients, engagements, or actions")
    .fill("Northstar");
  await expect(
    page.getByRole("option", { name: /Northstar Systems/ }).first(),
  ).toBeVisible();
});

test("scanner exchange workspace exposes staged imports and checksummed exports", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/imports");
  await expect(
    page.getByRole("heading", { name: "Imports and exports" }),
  ).toBeVisible();
  await expect(page.getByLabel("Source format")).toContainText("NMAP");
  await expect(
    page.getByRole("button", { name: "Download migration export" }),
  ).toBeVisible();
});

test("signed-in users can review account devices and administrators can open retention controls", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/account/security");
  await expect(
    page.getByRole("heading", { name: "Account security" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Signed-in devices" }),
  ).toBeVisible();
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Security and operations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Retention preview and purge" }),
  ).toBeVisible();
});

test("administrators create a one-time scoped API key that authenticates REST resources", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/integrations");
  await expect(
    page.getByRole("heading", { name: "Integrations and automation" }),
  ).toBeVisible();
  const name = `Browser API ${testInfo.project.name} ${Date.now()}`;
  await page.getByPlaceholder("Credential name").fill(name);
  await page.getByLabel("clients:read").check();
  await page.getByRole("button", { name: "Create credential" }).click();
  const secret = page.getByLabel("One-time secret or untrusted draft");
  await expect(secret).toBeVisible();
  const token = await secret.inputValue();
  expect(token).toMatch(/^dd_pat_/);
  const clients = await page.request.get("/api/v1/clients", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(clients.ok()).toBe(true);
  const findings = await page.request.get("/api/v1/findings", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(findings.status()).toBe(403);
  const row = page.getByRole("listitem").filter({ hasText: name });
  await row.getByRole("button", { name: "Revoke" }).click();
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

test("evidence and finding workspaces expose their secure core flows", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const engagement = "/engagements/0197f30f-122c-7000-8000-000000000004";
  await page.goto(`${engagement}?view=evidence`);
  await expect(
    page.getByRole("heading", { name: "Upload evidence" }),
  ).toBeVisible();
  const marker = `${testInfo.project.name}-${Date.now()}-${Math.random()}`;
  await page.locator('input[type="file"]').setInputFiles({
    name: `${marker}.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ marker })),
  });
  const uploadResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(
          `/api/v1/engagements/${engagement.split("/").at(-1)}/evidence`,
        ),
  );
  await page.getByRole("button", { name: "Upload 1 file" }).click();
  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.ok()).toBe(true);
  await expect(page.getByText(`${marker}.json uploaded`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(`${marker}.json`, { exact: true })).toBeVisible();

  await page.goto(`${engagement}?view=findings`);
  await expect(
    page.getByRole("heading", { name: "Create engagement finding" }),
  ).toBeVisible();
  const template = page.getByLabel("Approved template");
  await expect(template).toContainText("Missing object-level authorisation");
  await template.focus();
  await expect(template).toBeFocused();
  await expect(
    page.getByRole("heading", {
      name: "Missing object-level authorisation exposes invoices",
    }),
  ).toBeVisible();
});

test("report workspace and live preview share the seeded report model", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  await expect(
    page.getByText("Northstar Customer Portal Assessment", { exact: true }),
  ).toBeVisible();
  const reportPath = await page
    .getByRole("link", { name: "Open" })
    .first()
    .getAttribute("href");
  expect(reportPath).toBeTruthy();
  await page.goto(reportPath!);
  await expect(
    page.getByRole("heading", { name: "Server-side exports" }),
  ).toBeVisible();
  await expect(
    page.getByRole("paragraph").filter({
      hasText: "Version 1 · internal review",
    }),
  ).toBeVisible();
  const preview = page.getByRole("link", { name: "Live preview" });
  const previewPath = await preview.getAttribute("href");
  expect(previewPath).toBeTruthy();
  const response = await page.request.get(previewPath!);
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain("Northstar Customer Portal Assessment");
  expect(html).toContain("Missing object-level authorisation exposes invoices");
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
  const dashboardNavigationPromise = page.waitForURL(/\/dashboard/, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const signInResponse = await signInResponsePromise;
  if (!signInResponse.ok()) {
    throw new Error(
      `Sign-in failed with ${signInResponse.status()}: ${await signInResponse.text()}`,
    );
  }
  await dashboardNavigationPromise;
}
