import { test } from "@e2e-dev/web";
import { credentials, expect } from "e2e";

test("new signup creates isolated workspace and persists time zone", async ({
  app,
  screen,
  browser,
}) => {
  const marker = crypto.randomUUID();
  const organisation = `Army workspace ${marker}`;
  await app.open("/sign-up");
  await screen.getByLabel("Full name").fill(`Synthetic tester ${marker}`);
  await screen.getByLabel("Work email").fill(`${marker}@testerarmy.invalid`);
  await screen
    .getByLabel("Password", { exact: false })
    .fill(credentials.user("newcomer").password);
  await screen.getByRole("button", "Create account").click();
  await expect(browser).toHaveURL("/onboarding");
  await screen.getByLabel("Organisation name").fill(organisation);
  await screen.getByRole("button", "Create organisation").click();
  await expect(browser).toHaveURL("/dashboard");
  await browser.reload();
  const mobile = await browser.evaluate(() => innerWidth < 1024);
  if (mobile) await screen.getByRole("button", "Open navigation").click();
  await expect(
    screen.getByText(organisation, { exact: true, visible: true }),
  ).toBeVisible();
  if (mobile) await screen.getByRole("button", "Close navigation").click();
  await app.open("/clients");
  await expect(screen.getByRole("link", "Northstar Systems")).toHaveCount(0);
  await app.open("/account/preferences");
  for (const zone of ["Australia/Sydney", "Pacific/Auckland", "UTC"]) {
    await screen.getByLabel("Display time zone").selectOption({ value: zone });
    await screen.getByRole("button", "Save time zone").click();
    await browser.reload();
    await expect(screen.getByLabel("Display time zone")).toHaveValue(zone);
  }
});
