import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { engagementPath } from "./support/screens";

for (const kind of ["personal", "service"]) {
  test(
    `${kind} credential enforces scopes and revocation`,
    { session: "admin" },
    async ({ app, screen, browser }) => {
      const name = `Army credential ${crypto.randomUUID()}`;
      await app.open("/integrations");
      await screen.getByPlaceholder("Credential name").fill(name);
      await browser
        .locator('select[name="kind"]')
        .selectOption({ value: kind });
      if (kind === "service")
        await screen
          .getByPlaceholder("Service account name (if applicable)")
          .fill(name);
      await screen.getByLabel("clients:read").check();
      await screen.getByRole("button", "Create credential").click();
      await expect(
        screen.getByLabel("One-time secret or untrusted draft"),
      ).toBeVisible();
      // Token stays in browser; only status codes leave it or enter reports.
      const status = await browser.evaluate(async () => {
        const token = (
          document.querySelector(
            '[aria-label="One-time secret or untrusted draft"]',
          ) as HTMLTextAreaElement
        ).value;
        (window as Window & { armyToken?: string }).armyToken = token;
        const headers = { authorization: `Bearer ${token}` };
        return {
          allowed: (await fetch("/api/v1/clients", { headers })).status,
          denied: (await fetch("/api/v1/findings", { headers })).status,
        };
      });
      expect(status).toEqual({ allowed: 200, denied: 403 });
      await screen
        .getByRole("listitem")
        .filter({ hasText: name })
        .getByRole("button", "Revoke")
        .click();
      await expect(
        screen
          .getByRole("listitem")
          .filter({ hasText: name })
          .getByRole("button", "Revoke"),
      ).toHaveCount(0);
      const revoked = await browser.evaluate(async () => {
        const state = window as Window & { armyToken?: string };
        const present = typeof state.armyToken === "string";
        const response = await fetch("/api/v1/clients", {
          headers: { authorization: `Bearer ${state.armyToken}` },
        });
        delete state.armyToken;
        return { present, status: response.status };
      });
      expect(revoked).toEqual({ present: true, status: 401 });
    },
  );
}

for (const classification of ["internal", "restricted", "client_visible"]) {
  test(
    `evidence ${classification} upload persists and downloads original bytes`,
    { session: "admin" },
    async ({ app, screen, browser }) => {
      const directory = await mkdtemp(join(tmpdir(), "dingodocs-evidence-"));
      const filename = `evidence-${crypto.randomUUID()}.json`;
      const source = JSON.stringify({
        synthetic: true,
        marker: crypto.randomUUID(),
      });
      try {
        const file = join(directory, filename);
        await writeFile(file, source);
        await app.open(`${engagementPath}?view=evidence`);
        await screen
          .getByLabel("Classification")
          .selectOption({ value: classification });
        if (classification === "restricted")
          await screen
            .getByLabel("Restriction reason")
            .fill("Synthetic restricted evidence");
        await browser.locator('input[type="file"]').setInputFiles(file);
        await screen.getByRole("button", "Upload 1 file").click();
        await expect(screen.getByText(`${filename} uploaded`)).toBeVisible();
        await browser.reload();
        const record = screen
          .getByRole("article")
          .filter({ hasText: filename });
        await expect(record).toContainText(classification.replaceAll("_", " "));
        const download = await browser.waitForDownload(() =>
          record.getByRole("button", "Download").click(),
        );
        expect(await readFile(download.absolutePath, "utf8")).toBe(source);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
