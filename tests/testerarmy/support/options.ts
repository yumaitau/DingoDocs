import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";

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
    for (const value of values) {
      await control.selectOption({ value });
      await expect(control).toHaveValue(value);
    }
    if (values.includes(original))
      await control.selectOption({ value: original });
  }
  const checkboxes = await browser.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ).map((checkbox, index) => ({
      index,
      key: JSON.stringify([
        checkbox.name ||
          checkbox.getAttribute("aria-label") ||
          checkbox.closest("label")?.textContent,
        checkbox.value,
      ]),
    })),
  );
  const toggled = new Set<string>();
  for (const { index, key } of checkboxes) {
    if (toggled.has(key)) continue;
    const checkbox = browser.locator('input[type="checkbox"]').nth(index);
    if (!(await checkbox.isVisible()) || !(await checkbox.isEnabled()))
      continue;
    toggled.add(key);
    const original = await checkbox.isChecked();
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
    if (original) await checkbox.check();
  }
}
