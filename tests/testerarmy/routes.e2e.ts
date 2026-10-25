import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { test, expect } from "e2e";
import { screens } from "./support/screens";

test("every page route belongs to browser coverage inventory", async () => {
  async function pages(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const results = await Promise.all(
      entries.map(async (entry) =>
        entry.isDirectory()
          ? pages(join(directory, entry.name))
          : entry.name === "page.tsx"
            ? [join(directory, entry.name)]
            : [],
      ),
    );
    return results.flat();
  }
  const normalize = (route: string) =>
    route.replace(/[a-f0-9]{8}-[a-f0-9-]{27}/g, "[id]").split("?")[0];
  const covered = new Set([
    ...screens.map(([path]) => normalize(path)),
    "/",
    "/sign-in",
    // Covered by tests/e2e/mfa.spec.ts (needs an enrolled TOTP factor).
    "/sign-in/two-factor",
    "/sign-up",
    "/forgot-password",
    "/reset-password",
    "/onboarding",
    "/invite/[token]",
    "/imports/[id]",
    "/portal",
    "/portal/security",
    "/portal/engagements/[id]",
  ]);
  const discovered = (await pages("src/app")).map(
    (file) =>
      `/${file
        .split("/")
        .slice(2, -1)
        .filter((part) => !part.startsWith("("))
        .join("/")}`,
  );
  expect(discovered.filter((route) => !covered.has(route))).toEqual([]);
  expect(discovered.length).toBeGreaterThan(30);
});
