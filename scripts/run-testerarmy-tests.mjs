import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

// These tests create and change records. Never point them at a deployed tenant.
const database = process.env.TEST_DATABASE_URL;
if (!database)
  throw new Error(
    "Set TEST_DATABASE_URL to a disposable local PostgreSQL database ending in _e2e",
  );
const parsed = new URL(database);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) ||
  !parsed.pathname.endsWith("_e2e")
) {
  throw new Error(
    "Tester Army requires a loopback TEST_DATABASE_URL ending in _e2e",
  );
}
const port = process.env.TESTERARMY_PORT ?? "3107";
if (!/^\d+$/.test(port)) throw new Error("TESTERARMY_PORT must be numeric");
const url = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  DATABASE_URL: database,
  TEST_DATABASE_URL: database,
  BETTER_AUTH_URL: url,
  NEXT_PUBLIC_BETTER_AUTH_URL: url,
  APP_URL: url,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  TESTERARMY_PASSWORD: randomBytes(24).toString("base64url"),
  LOCAL_STORAGE_ROOT: ".e2e/storage",
  STORAGE_PROVIDER: "local",
  AI_ENABLED: "false",
  E2E_TELEMETRY_DISABLED: "1",
  SMTP_HOST: "",
  EMAIL_PROVIDER: "none",
  REQUIRE_EMAIL_VERIFICATION: "false",
};

async function run(args) {
  const child = spawn(process.execPath, args, { env, stdio: "inherit" });
  const forward = (signal) => child.kill(signal);
  const interrupt = () => forward("SIGINT");
  const terminate = () => forward("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
    if (code !== 0) process.exit(code);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}

await run(["node_modules/drizzle-kit/bin.cjs", "migrate"]);
await run(["node_modules/tsx/dist/cli.mjs", "src/db/seeds/index.ts"]);
await run([
  "node_modules/tsx/dist/cli.mjs",
  "tests/testerarmy/support/seed.ts",
]);
const args = process.argv.slice(2);
if (!args.includes("--reuse-build"))
  await run(["node_modules/next/dist/bin/next", "build"]);
await run([
  "node_modules/e2e/dist/cli/bin.js",
  "run",
  ...args.filter((arg) => arg !== "--reuse-build"),
]);
