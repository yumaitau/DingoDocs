import { test, type Page } from "@playwright/test";
import { approvedE2EBaseURL } from "../../../src/test/e2e-origin";

export const adminCredentials = {
  email: process.env.E2E_ADMIN_EMAIL ?? "admin@dingodocs.local",
  password: process.env.E2E_ADMIN_PASSWORD ?? "DingoDocs-Demo-2026!",
};

export async function signIn(page: Page) {
  await page.goto("/sign-in");
  approvedE2EBaseURL(page.url());
  await page.getByLabel("Email").fill(adminCredentials.email);
  await page.getByLabel("Password").fill(adminCredentials.password);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/auth/sign-in/email"),
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const response = await responsePromise;
    const retryAfter = Number(response.headers()["retry-after"]);
    // Full browser suites can exceed the real IP rate limit. Respect its
    // advertised cooldown once; never bypass it or retry account lockouts.
    if (
      attempt === 0 &&
      response.status() === 429 &&
      retryAfter > 0 &&
      retryAfter <= 60
    ) {
      test.setTimeout(test.info().timeout + (retryAfter + 5) * 1_000);
      await page.waitForTimeout((retryAfter + 1) * 1_000);
      continue;
    }
    if (!response.ok())
      throw new Error(
        `Sign-in failed with ${response.status()}: ${await response.text()}`,
      );
    await page.waitForURL(/\/dashboard/, { waitUntil: "domcontentloaded" });
    return;
  }
}

export async function signInWithoutFormInput(page: Page, baseURL: string) {
  const approvedBaseURL = approvedE2EBaseURL(baseURL);
  if (!approvedBaseURL) throw new Error("E2E base URL is required");
  await page.goto(new URL("/sign-in", approvedBaseURL).toString(), {
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
  await page.goto(new URL("/dashboard", approvedBaseURL).toString(), {
    waitUntil: "domcontentloaded",
  });
}
