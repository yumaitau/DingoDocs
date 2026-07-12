import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

const baseUrl = process.env.SCREENSHOT_URL ?? "http://127.0.0.1:3000";
const outputDir = resolve("docs/screenshots");
const engagement = "/engagements/0197f30f-122c-7000-8000-000000000004";

async function capture(page: Page, path: string) {
  await page.screenshot({ path: resolve(outputDir, path), fullPage: true });
}

async function signIn(page: Page) {
  await page.getByLabel("Email").fill("admin@dingodocs.local");
  await page.getByLabel("Password").fill("DingoDocs-Demo-2026!");
  const dashboard = page.waitForURL(/\/dashboard/, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await dashboard;
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

    await page.goto(`${baseUrl}/sign-in`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Welcome back" }).waitFor();
    await capture(page, "sign-in.png");

    await signIn(page);
    await page.getByRole("heading", { name: "Good morning" }).waitFor();
    await capture(page, "dashboard.png");

    await page.goto(`${baseUrl}/engagements`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Engagements" }).waitFor();
    await capture(page, "engagements.png");

    await page.goto(`${baseUrl}${engagement}?view=findings`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Create engagement finding" }).waitFor();
    await capture(page, "findings.png");

    await page.goto(`${baseUrl}/reports`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Reports" }).waitFor();
    await capture(page, "reports.png");

    await page.goto(`${baseUrl}/integrations`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Integrations and automation" }).waitFor();
    await capture(page, "integrations.png");
  } finally {
    await browser.close();
  }
}

void main();
