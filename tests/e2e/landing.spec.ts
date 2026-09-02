import { expect, test } from "@playwright/test";

test("landing page presents the product and primary journeys", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Defensible pentests." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Start free" })).toHaveAttribute(
    "href",
    "/sign-up",
  );
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/sign-in",
  );
  await expect(
    page.getByAltText(
      "Dingo wearing sunglasses with evidence files against a red-earth Australian landscape",
    ),
  ).toBeVisible();
  await expect(page.getByText("Evidence-first", { exact: true })).toBeVisible();
});
