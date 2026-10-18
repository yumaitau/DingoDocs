import { test } from "@e2e-dev/web";
import { credentials, expect } from "e2e";

for (const [name, destination] of [
  ["admin", "/dashboard"],
  ["portal", "/portal"],
  ["newcomer", "/onboarding"],
] as const) {
  test.setup(
    `sign in as ${name}`,
    { sessions: [name] },
    async ({ app, screen, browser, session }) => {
      const account = credentials.user(name);
      await app.open("/sign-in");
      await screen.getByLabel("Email").fill(account.username);
      await screen
        .getByLabel("Password", { exact: false })
        .fill(account.password);
      await screen.getByRole("button", "Sign in").click();
      await expect(browser).toHaveURL(destination, { timeout: 60_000 });
      await session.save(name);
    },
  );
}
