import { test } from "@e2e-dev/web";
import { credentials, expect } from "e2e";
import { clientId } from "./support/screens";

for (const severity of ["informational", "low", "medium", "high", "critical"]) {
  test(
    `finding snapshots template and persists ${severity} severity and narrative`,
    { session: "admin", timeout: 360_000 },
    async ({ app, screen, browser }) => {
      const identifier = `ARMY-${crypto.randomUUID()}`;
      const title = `Synthetic ${severity} ${crypto.randomUUID()}`;
      // One engagement per case keeps narrative/review tests independent.
      await app.open("/engagements/new");
      await screen
        .getByLabel("Engagement name")
        .fill(`Army finding ${identifier}`);
      await screen.getByLabel("Client").selectOption({ value: clientId });
      await screen
        .getByLabel("Assessment type")
        .selectOption({ label: "Web Application Assessment" });
      await screen.getByLabel("Start date").fill("2026-10-01");
      await screen.getByLabel("End date").fill("2026-10-31");
      await screen.getByRole("button", "Create engagement").click();
      await expect(browser).toHaveURL(/\/engagements\/[a-f0-9-]{36}$/);
      const engagementPath = new URL(await browser.url()).pathname;
      await app.open(`${engagementPath}?view=findings`);
      const template = await browser.evaluate(
        () =>
          (
            document.querySelector(
              'select[name="templateId"] option:not([disabled])',
            ) as HTMLOptionElement
          )?.value,
      );
      expect(template).toBeTruthy();
      await screen
        .getByLabel("Approved template")
        .selectOption({ value: template! });
      await screen.getByLabel("Finding identifier").fill(identifier);
      await screen
        .getByRole("button", "Create finding", { exact: true })
        .click();
      const record = screen
        .getByRole("article")
        .filter({ hasText: identifier });
      await expect(record).toBeVisible();
      await record.getByLabel("Title").fill(title);
      await record
        .getByLabel("Severity", { exact: true })
        .selectOption({ value: severity });
      await record
        .getByLabel("Lock severity (skip risk-matrix override)")
        .check();
      await record.getByLabel("CWE").fill("CWE-287");
      await record.getByLabel("OWASP").fill("A07:2021");
      await record.getByLabel("ATT&CK techniques").fill("T1190");
      for (const tag of [
        "PCI DSS",
        "ISO 27001",
        "SOC 2",
        "NIST CSF",
        "CMMC",
        "DORA",
        "Essential Eight",
      ])
        await record.getByLabel(tag, { exact: true }).check();
      for (const field of [
        "Executive summary",
        "Reproduction steps",
        "Proof of concept",
        "Business impact",
        "Technical impact",
        "Verification guidance",
      ])
        await record.getByLabel(field).fill(`Synthetic ${field}`);
      await record.getByLabel("Client owner").fill("Synthetic owner");
      await record.getByLabel("Due date").fill("2026-12-01");
      await record
        .getByLabel("Change summary")
        .fill("Synthetic narrative and severity update");
      await record.getByRole("button", "Save new version").click();
      await expect(record.getByRole("heading", title)).toBeVisible();
      await browser.reload();
      await expect(record.getByLabel("Severity", { exact: true })).toHaveValue(
        severity,
      );
      await expect(record.getByLabel("CWE")).toHaveValue("CWE-287");
      await expect(record.getByLabel("Due date")).toHaveValue("2026-12-01");
      for (const tag of [
        "PCI DSS",
        "ISO 27001",
        "SOC 2",
        "NIST CSF",
        "CMMC",
        "DORA",
        "Essential Eight",
      ])
        await expect(record.getByLabel(tag, { exact: true })).toBeChecked();

      if (severity !== "high") return;
      const transition = async (status: string) => {
        if (!(await record.getByLabel("Move to").isVisible()))
          await record
            .getByText("Workflow transition", { exact: true })
            .click();
        await record.getByLabel("Move to").selectOption({ value: status });
        await record
          .getByLabel("Comment", { exact: true })
          .fill(`Synthetic review: ${status}`);
        await record.getByRole("button", "Apply transition").click();
        await expect(
          record
            .getByText(status.replaceAll("_", " "), { exact: true })
            .first(),
        ).toBeVisible();
        await browser.reload();
        await expect(
          record
            .getByText(status.replaceAll("_", " "), { exact: true })
            .first(),
        ).toBeVisible();
      };
      const signIn = async (name: "admin" | "reviewer") => {
        // Clear this context without revoking the shared saved admin session.
        await browser.setCookies(
          (await browser.cookies()).map((cookie) => ({
            ...cookie,
            expires: 1,
          })),
        );
        const account = credentials.user(name);
        await app.open("/sign-in");
        await screen.getByLabel("Email").fill(account.username);
        await screen
          .getByLabel("Password", { exact: false })
          .fill(account.password);
        await screen.getByRole("button", "Sign in").click();
        await expect(browser).toHaveURL("/dashboard");
        await app.open(`${engagementPath}?view=findings`);
      };
      for (const status of [
        "in_progress",
        "ready_for_review",
        "changes_requested",
        "ready_for_review",
      ])
        await transition(status);
      await signIn("reviewer");
      await transition("peer_reviewed");
      await signIn("admin");
      for (const status of [
        "qa_approved",
        "published",
        "remediation_in_progress",
        "ready_for_retest",
        "retested",
        "resolved",
        "ready_for_retest",
        "retested",
        "risk_accepted",
        "closed",
      ])
        await transition(status);
    },
  );
}
