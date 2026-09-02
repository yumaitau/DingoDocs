import { defineConfig } from "@playwright/test";
import { approvedE2EBaseURL } from "./src/test/e2e-origin";

const port = process.env.PLAYWRIGHT_PORT ?? "3000";
const externalBaseURL = approvedE2EBaseURL(process.env.PLAYWRIGHT_BASE_URL);
const baseURL = externalBaseURL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e/lightpanda",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "off" },
  projects: [{ name: "lightpanda" }],
  webServer: externalBaseURL
    ? undefined
    : {
        command: `pnpm dev --hostname 127.0.0.1 --port ${port}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
