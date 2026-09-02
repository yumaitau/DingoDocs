import type { Page } from "@playwright/test";

export const adminCredentials = {
  email: process.env.E2E_ADMIN_EMAIL ?? "admin@dingodocs.local",
  password: process.env.E2E_ADMIN_PASSWORD ?? "DingoDocs-Demo-2026!",
};

export async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(adminCredentials.email);
  await page.getByLabel("Password").fill(adminCredentials.password);
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
  if (!signInResponse.ok())
    throw new Error(
      `Sign-in failed with ${signInResponse.status()}: ${await signInResponse.text()}`,
    );
  await dashboardNavigationPromise;
}

export async function signInWithoutFormInput(page: Page, baseURL: string) {
  await page.goto(new URL("/sign-in", baseURL).toString(), {
    waitUntil: "domcontentloaded",
  });
  const result = await page.evaluate(async (credentials) => {
    const response = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });
    return { status: response.status, body: await response.text() };
  }, adminCredentials);
  if (result.status < 200 || result.status >= 300)
    throw new Error(`Sign-in failed with ${result.status}: ${result.body}`);
  await page.goto(new URL("/dashboard", baseURL).toString(), {
    waitUntil: "domcontentloaded",
  });
}
