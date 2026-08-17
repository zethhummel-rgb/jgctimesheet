const { test, expect } = require("@playwright/test");

test("estimator mobile navigation stays pinned to the viewport at every scroll position", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/estimating/index.html?dev=1");
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();

  const sidebar = page.locator("#estimate-navigation");

  for (const position of [0, 0.5, 1]) {
    const expectedScroll = await page.evaluate((ratio) => {
      const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(0, Math.round(maximum * ratio));
      return window.scrollY;
    }, position);

    await page.evaluate(() => document.querySelector(".mobile-menu").click());
    await expect(sidebar).toHaveClass(/is-open/);
    await expect.poll(async () => {
      const bounds = await sidebar.boundingBox();
      return bounds ? Math.round(bounds.y) : null;
    }).toBe(0);
    await expect.poll(async () => {
      const bounds = await sidebar.boundingBox();
      return bounds ? Math.round(bounds.height) : null;
    }).toBe(844);
    await expect(page.locator("body")).toHaveCSS("position", "fixed");

    if (position === 0.5) {
      await page.setViewportSize({ width: 390, height: 700 });
      await expect.poll(async () => {
        const bounds = await sidebar.boundingBox();
        return bounds ? [Math.round(bounds.y), Math.round(bounds.height)] : null;
      }).toEqual([0, 700]);
      await page.setViewportSize({ width: 390, height: 844 });
    }

    await page.evaluate(() => document.querySelector(".sidebar-close").click());
    await expect(sidebar).not.toHaveClass(/is-open/);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(Math.round(expectedScroll));
  }
});

test("overview search finds and opens quotes by client, site, project or reference", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();

  const search = page.getByRole("searchbox", { name: "Search estimates and jobs" });
  await expect(search).toHaveAttribute("autocomplete", "off");
  await search.fill("Lancaster");
  await expect(page.locator(".overview-search-summary")).toContainText("1 result");
  await expect(page.locator(".overview-result-group")).toContainText("JGC-Q-2026-0001");
  await expect(page.locator(".overview-result-group")).toContainText("BGIS — demo only");

  await search.fill("IONP005920");
  const quoteResult = page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" });
  await expect(quoteResult).toBeVisible();
  await quoteResult.click();
  await expect(page.getByText("JGC-Q-2026-0001 · REV 0")).toBeVisible();
});
