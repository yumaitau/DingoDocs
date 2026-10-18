import { test, type Browser } from "@e2e-dev/web";
import { credentials, expect, type Screen } from "e2e";

const destinations = [
  ["Dashboard", "/dashboard"],
  ["Analytics", "/analytics"],
  ["Clients", "/clients"],
  ["Engagements", "/engagements"],
  ["Schedule", "/schedule"],
  ["Programs", "/programs"],
  ["Opportunities", "/opportunities"],
  ["Findings Library", "/findings-library"],
  ["Reports", "/reports"],
  ["Tasks", "/tasks"],
  ["Runbooks", "/runbooks"],
  ["Templates", "/templates"],
  ["Imports & Exports", "/imports"],
  ["Preferences", "/account/preferences"],
  ["Team", "/team"],
  ["Audit Log", "/audit"],
  ["Integrations", "/integrations"],
  ["Settings", "/settings"],
] as const;

async function openNavigation(browser: Browser, screen: Screen) {
  if (await browser.evaluate(() => innerWidth < 1024))
    await screen.getByRole("button", "Open navigation").click();
}

async function openPalette(browser: Browser, screen: Screen) {
  const mobile = await browser.evaluate(() => innerWidth < 1024);
  await screen
    .getByRole("button", mobile ? "Open command palette" : /^Search or jump to/)
    .click();
  await expect(screen.getByRole("dialog", "Command palette")).toBeVisible();
}

test(
  "all primary and administration links navigate and mark active destination",
  { session: "admin" },
  async ({ app, screen, browser }) => {
    await app.open("/dashboard");
    const mobile = await browser.evaluate(() => innerWidth < 1024);
    await openNavigation(browser, screen);
    await expect(
      screen
        .getByRole("navigation", "Primary", { visible: true })
        .getByRole("link"),
    ).toHaveCount(13);
    await expect(
      screen
        .getByRole("navigation", "Administration", { visible: true })
        .getByRole("link"),
    ).toHaveCount(5);
    if (mobile) await screen.getByRole("button", "Close navigation").click();
    for (const [label, path] of destinations) {
      await openNavigation(browser, screen);
      await screen
        .getByRole("link", label, { exact: true, visible: true })
        .click();
      await expect(browser).toHaveURL(path);
      if (mobile)
        await expect(screen.getByRole("dialog", "Navigation")).toHaveCount(0);
      await openNavigation(browser, screen);
      await expect(
        screen.getByRole("link", label, { exact: true, visible: true }),
      ).toHaveAttribute("aria-current", "page");
      if (mobile) await screen.getByRole("button", "Close navigation").click();
    }
  },
);

test(
  "command palette navigates every destination, quick action, search result and empty state",
  { session: "admin", timeout: 180_000 },
  async ({ app, screen, browser }) => {
    await app.open("/dashboard");
    for (const [label, path] of [
      ...destinations,
      ["Create engagement", "/engagements/new"],
    ] as const) {
      await openPalette(browser, screen);
      await screen.getByRole("option", label, { exact: true }).click();
      await expect(browser).toHaveURL(path);
      await expect(screen.getByRole("dialog", "Command palette")).toHaveCount(
        0,
      );
    }
    await openPalette(browser, screen);
    const input = screen.getByPlaceholder(
      "Search pages, clients, engagements, or actions",
    );
    await input.fill("Northstar Systems");
    await screen
      .getByRole("option", /Northstar Systems/)
      .first()
      .click();
    await expect(browser).toHaveURL(
      "/clients/0197f30f-122c-7000-8000-000000000003",
    );
    await openPalette(browser, screen);
    await input.fill(`no-match-${crypto.randomUUID()}`);
    await expect(
      screen.getByText("No matching commands", { exact: true }),
    ).toBeVisible();
    await browser.keyboard.press("Escape");
    await expect(screen.getByRole("dialog", "Command palette")).toHaveCount(0);
    await browser.keyboard.press("Control+k");
    await expect(screen.getByRole("dialog", "Command palette")).toBeVisible();
    await browser.keyboard.press("Escape");
  },
);

test(
  "every language changes navigation and survives reload",
  { session: "admin" },
  async ({ app, screen, browser }) => {
    await app.open("/dashboard");
    const mobile = await browser.evaluate(() => innerWidth < 1024);
    for (const [value, label, dashboard] of [
      ["de", "Sprache", "Übersicht"],
      ["fr", "Langue", "Tableau de bord"],
      ["es", "Idioma", "Panel"],
      ["en", "Language", "Dashboard"],
    ]) {
      await openNavigation(browser, screen);
      const language = screen.getByLabel(/^(Language|Sprache|Langue|Idioma)$/, {
        visible: true,
      });
      await language.selectOption({ value });
      await expect(screen.getByLabel(label, { visible: true })).toHaveValue(
        value,
      );
      await expect(
        screen.getByRole("link", dashboard, { exact: true, visible: true }),
      ).toBeVisible();
      if (mobile) await screen.getByRole("button", "Close navigation").click();
      await browser.reload();
      await openNavigation(browser, screen);
      await expect(screen.getByLabel(label, { visible: true })).toHaveValue(
        value,
      );
      await expect(
        screen.getByRole("link", dashboard, { exact: true, visible: true }),
      ).toBeVisible();
      if (mobile) await screen.getByRole("button", "Close navigation").click();
    }
  },
);

test(
  "notifications navigate and persist individual and bulk read state",
  { session: "admin" },
  async ({ app, screen, browser }) => {
    await app.open("/dashboard");
    await screen
      .getByRole("button", /^Notifications/, { visible: true })
      .click();
    await screen.getByRole("button", "Army navigation notification").click();
    await expect(browser).toHaveURL("/clients");
    async function readStates() {
      return browser.evaluate(async () => {
        const response = await fetch("/api/notifications");
        if (!response.ok)
          throw new Error(`Notifications returned ${response.status}`);
        const body = (await response.json()) as {
          notifications: Array<{ title: string; readAt: string | null }>;
        };
        return ["Army navigation notification", "Army bulk notification"].map(
          (title) =>
            Boolean(
              body.notifications.find((item) => item.title === title)?.readAt,
            ),
        );
      });
    }
    await expect.poll(async () => (await readStates())[0]).toBe(true);
    await browser.reload();
    await screen
      .getByRole("button", /^Notifications/, { visible: true })
      .click();
    await screen.getByRole("button", "Mark all read").click();
    await expect.poll(readStates).toEqual([true, true]);
    await browser.reload();
    expect(await readStates()).toEqual([true, true]);
  },
);

test(
  "portal navigation opens preferences, security and engagements",
  { session: "portal" },
  async ({ app, screen, browser }) => {
    await app.open("/portal");
    for (const [label, path, heading] of [
      ["Preferences", "/account/preferences", "Personal preferences"],
      ["Security", "/portal/security", "Account security"],
      ["Engagements", "/portal", "Your engagements"],
    ]) {
      await screen
        .getByRole("navigation", "Client portal")
        .getByRole("link", label)
        .click();
      await expect(browser).toHaveURL(path);
      await expect(screen.getByRole("heading", heading)).toBeVisible();
    }
  },
);

test("portal sign-out revokes its own fresh session", async ({
  app,
  screen,
  browser,
}) => {
  await app.open("/sign-in");
  const account = credentials.user("portal");
  await screen.getByLabel("Email").fill(account.username);
  await screen.getByLabel("Password", { exact: false }).fill(account.password);
  await screen.getByRole("button", "Sign in").click();
  await expect(browser).toHaveURL("/portal");
  await screen.getByRole("button", /^Sign out/).click();
  await expect(browser).toHaveURL("/sign-in");
  await app.open("/portal");
  await expect(browser).toHaveURL(/\/sign-in(?:\?|$)/);
});
