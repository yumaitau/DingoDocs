import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";

const url = process.env.SCREENSHOT_URL ?? "http://127.0.0.1:3000/sign-in";
const output = resolve("docs/screenshots/sign-in.png");

mkdirSync(dirname(output), { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Welcome back" }).waitFor();
    await page.screenshot({ path: output, fullPage: true });
  } finally {
    await browser.close();
  }
}

void main();
