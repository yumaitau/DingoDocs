import { test as base, expect } from "@playwright/test";

type LightpandaFixtures = {
  appURL: (path: string) => string;
};

const endpoint = process.env.LIGHTPANDA_CDP_URL;
if (!endpoint)
  throw new Error(
    "LIGHTPANDA_CDP_URL is required; run tests through pnpm test:e2e:lightpanda",
  );

export const test = base.extend<LightpandaFixtures>({
  appURL: async ({ baseURL }, provide) => {
    if (!baseURL) throw new Error("Playwright baseURL is required");
    await provide((path) => new URL(path, baseURL).toString());
  },
  browser: [
    async ({ playwright }, provide) => {
      const browser = await playwright.chromium.connectOverCDP(endpoint);
      await provide(browser);
      await browser.close();
    },
    { scope: "worker" },
  ],
  context: async ({ browser, baseURL }, provide) => {
    const context = await browser.newContext({ baseURL });
    await provide(context);
    await context.close();
  },
  page: async ({ context }, provide) => {
    const page = await context.newPage();
    await provide(page);
    await page.close();
  },
});

export { expect };
