import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { engagementId } from "./support/screens";
import { scannerFixtures, scannerTitles } from "./support/scanners";

for (const [adapter, source] of Object.entries(scannerFixtures)) {
  test(
    `scanner ${adapter} uploads and previews normalized records`,
    { session: "admin" },
    async ({ app, screen, browser }) => {
      const directory = await mkdtemp(join(tmpdir(), "dingodocs-scanner-"));
      try {
        const file = join(
          directory,
          `${adapter}.${source.startsWith("<") ? "xml" : adapter === "csv" ? "csv" : "json"}`,
        );
        await writeFile(file, source);
        await app.open("/imports");
        await screen
          .getByLabel("Engagement")
          .selectOption({ value: engagementId });
        await screen
          .getByLabel("Source format")
          .selectOption({ value: adapter });
        await screen.getByLabel("Scanner file").setInputFiles(file);
        await screen.getByRole("button", "Validate and preview").click();
        await expect(browser).toHaveURL(/\/imports\/[a-f0-9-]{36}$/);
        await expect(
          screen.getByRole(
            "heading",
            `Import preview · ${adapter.toUpperCase()}`,
          ),
        ).toBeVisible();
        await expect(
          screen.getByText(scannerTitles[adapter], { exact: false }).first(),
        ).toBeVisible();
        await expect(
          screen.getByRole("button", "Import selected"),
        ).toBeEnabled();
        await expect(browser.locator('input[name="itemIds"]')).not.toHaveCount(
          0,
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}

test(
  "selective import persists chosen finding and prevents duplicate import",
  { session: "admin" },
  async ({ app, screen, browser }) => {
    const directory = await mkdtemp(join(tmpdir(), "dingodocs-selective-"));
    const marker = `Selected ${crypto.randomUUID()}`;
    const excluded = `Excluded ${crypto.randomUUID()}`;
    try {
      const file = join(directory, "findings.json");
      await writeFile(
        file,
        JSON.stringify({
          findings: [
            { title: marker, severity: "high", host: "fixture.invalid" },
            { title: excluded, severity: "low", host: "fixture.invalid" },
          ],
        }),
      );
      await app.open("/imports");
      await screen
        .getByLabel("Engagement")
        .selectOption({ value: engagementId });
      await screen.getByLabel("Source format").selectOption({ value: "json" });
      await screen.getByLabel("Scanner file").setInputFiles(file);
      await screen.getByRole("button", "Validate and preview").click();
      await screen.getByLabel(`Import ${excluded}`).uncheck();
      await screen.getByRole("button", "Import selected").click();
      await app.open(`/engagements/${engagementId}?view=findings`);
      await expect(screen.getByRole("heading", marker)).toBeVisible();
      await expect(screen.getByRole("heading", excluded)).toHaveCount(0);
      await app.open("/imports");
      await screen
        .getByLabel("Engagement")
        .selectOption({ value: engagementId });
      await screen.getByLabel("Source format").selectOption({ value: "json" });
      await screen.getByLabel("Scanner file").setInputFiles(file);
      await screen.getByRole("button", "Validate and preview").click();
      await expect(screen.getByLabel(`Import ${marker}`)).toBeDisabled();
      await expect(
        browser.locator('input[name="itemIds"]:disabled'),
      ).toHaveCount(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

for (const mode of ["data", "migration"]) {
  test(
    `organisation ${mode} export downloads nonempty JSON`,
    { session: "admin" },
    async ({ app, screen, browser }) => {
      await app.open("/imports");
      const download = await browser.waitForDownload(() =>
        screen.getByRole("button", `Download ${mode} export`).click(),
      );
      const bundle = JSON.parse(await readFile(download.absolutePath, "utf8"));
      expect(bundle).toBeTruthy();
      expect(Object.keys(bundle).length).toBeGreaterThan(0);
    },
  );
}
