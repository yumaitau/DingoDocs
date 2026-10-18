import { readFile } from "node:fs/promises";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { engagementId } from "./support/screens";

for (const status of [
  "in_progress",
  "remediated",
  "partially_remediated",
  "not_remediated",
  "risk_accepted",
  "open",
]) {
  test(
    `portal remediation persists ${status} update`,
    { session: "portal" },
    async ({ app, screen, browser }) => {
      const note = `Synthetic ${status} ${crypto.randomUUID()}`;
      await app.open(`/portal/engagements/${engagementId}`);
      const finding = screen
        .getByRole("article")
        .filter({ hasText: "Synthetic published portal finding" });
      await finding.getByLabel("Status").selectOption({ value: status });
      await finding.getByLabel("Owner").fill("Synthetic remediation owner");
      await finding.getByLabel("Update note").fill(note);
      await finding.getByRole("button", "Save update").click();
      const update = finding.getByRole("listitem").filter({ hasText: note });
      await expect(update).toBeVisible();
      await browser.reload();
      await expect(
        update.getByText(status.replaceAll("_", " "), { exact: true }),
      ).toBeVisible();
      await expect(update).toContainText("Synthetic remediation owner");
    },
  );
}

for (const format of ["CSV", "XLSX"]) {
  test(
    `portal exports shared findings as ${format}`,
    { session: "portal" },
    async ({ app, screen, browser }) => {
      await app.open(`/portal/engagements/${engagementId}`);
      const download = await browser.waitForDownload(() =>
        screen.getByRole("link", `Download ${format}`).click(),
      );
      const contents = await readFile(download.absolutePath);
      if (format === "CSV")
        expect(contents.toString("utf8")).toContain(
          "Synthetic published portal finding",
        );
      else expect(contents.subarray(0, 2).toString()).toBe("PK");
    },
  );
}
