import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";

// Pull requests sample each distinct control. Pushes to main and manual runs
// set TESTERARMY_EXHAUSTIVE_OPTIONS=1 to walk every option and checkbox.
const exhaustive = process.env.TESTERARMY_EXHAUSTIVE_OPTIONS === "1";

// The saved value plus the first, middle and last options. Native selects
// with server-rendered options behave the same for every entry between.
export function sample(values: readonly string[], original: string) {
  return [
    ...new Set([
      original,
      values[0],
      values[Math.floor(values.length / 2)],
      values.at(-1),
    ]),
  ].filter(
    (value): value is string => value !== undefined && values.includes(value),
  );
}

export async function checkSelectOptions(browser: Browser) {
  // Repeated record editors share one control schema. Opening all of them makes
  // observations enormous without exercising a new option or behavior.
  const disclosures = await browser.evaluate(() => {
    const summaries = Array.from(
      document.querySelectorAll("details > summary"),
    );
    return Array.from(document.querySelectorAll("details")).map((details) => {
      let depth = 0;
      for (
        let parent = details.parentElement;
        parent;
        parent = parent.parentElement
      )
        if (parent.tagName === "DETAILS") depth++;
      const controls = Array.from(
        details.querySelectorAll("select, input[type=checkbox]"),
      );
      return {
        summary: summaries.indexOf(details.querySelector(":scope > summary")!),
        open: details.open,
        schema: JSON.stringify([
          depth,
          controls.map((control) =>
            control instanceof HTMLSelectElement
              ? [
                  control.name,
                  Array.from(control.options).map((option) => option.value),
                ]
              : [
                  (control as HTMLInputElement).name,
                  (control as HTMLInputElement).value,
                ],
          ),
        ]),
        count: controls.length,
      };
    });
  });
  const opened = new Set<string>();
  for (const disclosure of disclosures) {
    if (
      !disclosure.count ||
      disclosure.summary < 0 ||
      opened.has(disclosure.schema)
    )
      continue;
    opened.add(disclosure.schema);
    if (!disclosure.open)
      await browser
        .locator("details > summary")
        .nth(disclosure.summary)
        .click();
  }
  const controls = await browser.evaluate(() =>
    Array.from(document.querySelectorAll("select")).map((select, index) => ({
      index,
      name: select.name,
      values: Array.from(select.options)
        .filter((option) => !option.disabled)
        .map((option) => option.value),
    })),
  );
  const checked = new Set<string>();
  for (const { index, name, values } of controls) {
    const key = JSON.stringify([name, values]);
    if (checked.has(key)) continue;
    const control = browser.locator("select").nth(index);
    if (!(await control.isVisible()) || !(await control.isEnabled())) continue;
    checked.add(key);
    const original = await control.inputValue();
    for (const value of exhaustive ? values : sample(values, original)) {
      await control.selectOption({ value });
      await expect(control).toHaveValue(value);
    }
    if (values.includes(original))
      await control.selectOption({ value: original });
  }
  const checkboxes = await browser.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).map((checkbox, index) => {
      const label =
        checkbox.name ||
        checkbox.getAttribute("aria-label") ||
        checkbox.closest("label")?.textContent;
      return {
        index,
        key: JSON.stringify([label, checkbox.value]),
        group: JSON.stringify([label]),
      };
    }),
  );
  const toggled = new Set<string>();
  for (const { index, key, group } of checkboxes) {
    // Sampled runs toggle one visible member of each same-named group.
    const id = exhaustive ? key : group;
    if (toggled.has(id)) continue;
    const checkbox = browser.locator('input[type="checkbox"]').nth(index);
    if (!(await checkbox.isVisible()) || !(await checkbox.isEnabled()))
      continue;
    toggled.add(id);
    const original = await checkbox.isChecked();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    if (original) await checkbox.check();
  }
}
