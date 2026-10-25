import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { adminCredentials, signIn } from "./support/auth";

// RFC 4648 base32 decode (no padding) for the authenticator setup key.
function base32Decode(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of value.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`Invalid base32 character ${char}`);
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

// RFC 6238 TOTP (HMAC-SHA1, 30-second step, 6 digits) matching the server.
function totp(secret: string, now = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(secret))
    .update(counter)
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

// Disable MFA again so the shared seeded admin keeps working for other specs.
// Runs in the page so the request carries the app Origin for CSRF checks.
async function disableMfa(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const status = await page.evaluate(async (password) => {
      const response = await fetch("/api/auth/two-factor/disable", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      return response.status;
    }, adminCredentials.password);
    if (status !== 429) return status;
    // Two-factor endpoints allow 3 requests per 10 seconds.
    await page.waitForTimeout(11_000);
  }
  return 429;
}

test("admin enrols TOTP, then signs in through the two-factor challenge", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Mutates the shared seeded admin; run once on desktop only",
  );
  test.setTimeout(120_000);

  await signIn(page);
  let enrolled = false;
  try {
    await page.goto("/account/security");
    await page
      .getByLabel("Current password to enrol MFA")
      .fill(adminCredentials.password);
    await page.getByRole("button", { name: "Enrol MFA" }).click();

    const setupKey = page.getByLabel("Setup key");
    await expect(setupKey).toBeVisible();
    const secret = await setupKey.getAttribute("data-secret");
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    await expect(page.getByLabel("otpauth link")).toHaveValue(
      /^otpauth:\/\/totp\//,
    );
    await expect(
      page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem"),
    ).not.toHaveCount(0);

    await page.getByLabel("Authenticator code").fill(totp(secret!));
    await page.getByRole("button", { name: "Verify and enable" }).click();
    await expect(
      page.getByText("Multi-factor authentication is now enabled."),
    ).toBeVisible();
    enrolled = true;
    await expect(page.getByText("MFA enabled", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /^Sign out/ }).click();
    await page.waitForURL(/\/sign-in/);

    await page.goto("/sign-in?next=%2Fengagements");
    await page.getByLabel("Email").fill(adminCredentials.email);
    await page.getByLabel("Password").fill(adminCredentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/sign-in\/two-factor\?next=%2Fengagements/);

    await page.getByLabel("Authenticator code").fill(totp(secret!));
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await page.waitForURL(/\/engagements(?:[/?#]|$)/);
    await expect(page).not.toHaveURL(/sign-in/);
  } finally {
    if (enrolled) expect.soft(await disableMfa(page)).toBe(200);
  }
});

// The magic-link email is not capturable in e2e (preview delivery logs only
// the recipient domain), so the session block itself is covered by
// src/lib/auth/second-factor-session.integration.test.ts. This checks the
// page the blocked magic link redirects to.
test("sign-in explains when an email link needs the second factor", async ({
  page,
}) => {
  await page.goto("/sign-in?error=two_factor_required");
  await expect(page.getByRole("alert")).toHaveText(
    "This account uses an authenticator app. Sign in with your password and code.",
  );
});
