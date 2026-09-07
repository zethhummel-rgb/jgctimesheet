const { test, expect } = require("@playwright/test");

async function openEstimateWithPausedClock(page) {
  await page.clock.install({ time: new Date("2026-09-07T12:00:00Z") });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Estimate/ }).click();
  const addButton = page.getByRole("button", { name: "Built-up item" });
  await addButton.focus();
  await page.clock.pauseAt(new Date("2026-09-07T12:05:00Z"));
  return addButton;
}

test("new-line delayed focus cannot redirect typing after the user selects a labour field", async ({ page }) => {
  const addButton = await openEstimateWithPausedClock(page);
  await addButton.press("Enter");
  const line = page.locator(".estimate-table tbody > tr.expanded:not(.line-detail-row)");
  const labour = page.locator(".labour-group .build-up-row").last();
  const quantity = labour.getByLabel(/quantity/);
  await quantity.fill("");
  await expect(quantity).toBeFocused();

  // Advance through both reveal timers deterministically, after the user's
  // focus choice, rather than waiting for the delayed focus before editing.
  await page.clock.runFor(350);
  await page.keyboard.insertText("1");
  await expect(quantity).toHaveValue("1");
  await expect(quantity).toBeFocused();
  await expect(line.locator("input.description-input")).toHaveValue("");
  await labour.getByLabel(/unit cost/).fill("100");
  await expect(labour.getByText("$100.00")).toBeVisible();
});

test("new-line delayed focus still opens the description when the user has not moved focus", async ({ page }) => {
  const addButton = await openEstimateWithPausedClock(page);
  await addButton.press("Enter");
  await page.clock.runFor(350);
  const description = page.locator(".estimate-table tbody > tr.expanded:not(.line-detail-row) input.description-input");
  await expect(description).toBeFocused();
  await page.keyboard.insertText("New framing item");
  await expect(description).toHaveValue("New framing item");
});
