import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";

const database = new URL(
  process.env.TEST_DATABASE_URL ?? "postgres://invalid/invalid",
);
if (
  !database.pathname.endsWith("_e2e") ||
  !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) ||
  process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
) {
  throw new Error(
    "Run pnpm test:e2e:army with a disposable loopback TEST_DATABASE_URL ending in _e2e",
  );
}

const port = process.env.TESTERARMY_PORT ?? "3107";
if (!/^\d+$/.test(port)) throw new Error("TESTERARMY_PORT must be numeric");
const url = `http://127.0.0.1:${port}`;
const app = {
  url,
  environment: "test" as const,
  readyUrl: `${url}/api/ready`,
  command: {
    executable: process.execPath,
    env: {
      EMAIL_PROVIDER: "none",
      REQUIRE_EMAIL_VERIFICATION: "false",
      SMTP_HOST: "",
    },
    inheritEnv: [
      "DATABASE_URL",
      "BETTER_AUTH_URL",
      "NEXT_PUBLIC_BETTER_AUTH_URL",
      "APP_URL",
      "BETTER_AUTH_SECRET",
      "INTEGRATION_ENCRYPTION_KEY",
      "LOCAL_STORAGE_ROOT",
      "STORAGE_PROVIDER",
      "AI_ENABLED",
    ],
    args: [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      port,
    ],
    startupTimeout: 180_000,
    log: ".e2e/logs/app.log",
    reuseExisting: false,
  },
};

export default {
  tests: "tests/testerarmy/**/*.e2e.ts",
  targets: [
    {
      name: "desktop",
      engine: web({ viewport: { width: 1440, height: 1000 } }),
      app,
    },
    {
      name: "mobile",
      engine: web({
        viewport: { width: 390, height: 844 },
        userAgent:
          "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      }),
      app,
    },
  ],
  workers: 2,
  retries: 0,
  timeout: 120_000,
  launchTimeout: 180_000,
  assertionTimeout: 15_000,
  reporters: ["list", "junit", "markdown"],
  credentials: {
    admin: {
      username: "admin@dingodocs.local",
      password: () => process.env.E2E_ADMIN_PASSWORD ?? "DingoDocs-Demo-2026!",
    },
    portal: {
      username: "portal@testerarmy.invalid",
      password: () => process.env.TESTERARMY_PASSWORD ?? "",
    },
    newcomer: {
      username: "newcomer@testerarmy.invalid",
      password: () => process.env.TESTERARMY_PASSWORD ?? "",
    },
    reviewer: {
      username: "reviewer@testerarmy.invalid",
      password: () => process.env.TESTERARMY_PASSWORD ?? "",
    },
    qa: {
      username: "qa@testerarmy.invalid",
      password: () => process.env.TESTERARMY_PASSWORD ?? "",
    },
  },
} satisfies E2EConfig;
