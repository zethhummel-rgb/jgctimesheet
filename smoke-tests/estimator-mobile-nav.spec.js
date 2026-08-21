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

test("personal overview leads with recent work and keeps company statistics company-wide", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/estimating/index.html?dev=1");

  const recentWork = page.locator(".recent-work-panel");
  await expect(recentWork).toBeVisible();
  await expect(page.locator(".metric-grid")).toHaveCount(0);
  await expect(page.locator(".pipeline-panel")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const recent = document.querySelector(".recent-work-panel");
    const search = document.querySelector(".overview-search");
    return !!recent && !!search && Boolean(recent.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);

  await page.getByRole("button", { name: "Company-wide" }).click();
  await expect(page.locator(".metric-grid")).toBeVisible();
  await expect(page.locator(".pipeline-panel")).toBeVisible();
  await expect(recentWork).toBeVisible();
});

test("mobile client picker stays inside the visible viewport and selects immediately", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Details/ }).click();

  const clientPicker = page.getByRole("combobox", { name: "Client" });
  await clientPicker.scrollIntoViewIfNeeded();
  await clientPicker.fill("");
  await page.setViewportSize({ width: 390, height: 520 });
  const results = page.locator(".saved-data-results");
  await expect(results).toBeVisible();
  await expect.poll(async () => {
    const bounds = await results.boundingBox();
    return bounds ? bounds.y >= 0 && bounds.y + bounds.height <= 520 : false;
  }).toBe(true);

  const firstClient = results.getByRole("option").first();
  const selectedName = (await firstClient.locator("strong").textContent())?.trim();
  await firstClient.click();
  await expect(clientPicker).toHaveValue(selectedName || "");
  await expect(clientPicker).toHaveAttribute("aria-expanded", "false");
  await expect(results).toHaveCount(0);
});

test("estimate search shows up to ten products before scrolling internally", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Estimate/ }).click();

  const search = page.getByRole("combobox", { name: "Search products and services" });
  const results = page.locator(".catalog-search-results");
  await search.fill("allowance");
  await expect(results).toBeVisible();
  const optionCount = await results.getByRole("option").count();
  expect(optionCount).toBeGreaterThan(0);
  expect(optionCount).toBeLessThanOrEqual(10);
  await expect.poll(() => results.evaluate((element) => element.scrollHeight === element.clientHeight)).toBe(true);

  await search.fill("");
  await expect(results.getByRole("option")).toHaveCount(12);
  await expect.poll(() => results.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect(results).toHaveCSS("overscroll-behavior-y", "contain");
  await expect(page.locator(".estimate-panel")).toHaveCSS("overflow", "visible");

  await page.setViewportSize({ width: 1223, height: 565 });
  await search.evaluate((element) => window.scrollBy(0, element.getBoundingClientRect().top - 110));
  await expect.poll(async () => {
    const bounds = await results.boundingBox();
    return bounds ? bounds.y + bounds.height <= 565 : false;
  }).toBe(true);
  await expect.poll(() => results.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  await results.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(results.getByRole("option").last()).toBeVisible();
  await results.hover();
  const pageScrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 900);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);
});

test("numeric inputs ignore mouse-wheel and arrow-key stepping", async ({ page }) => {
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Estimate/ }).click();
  await page.getByRole("button", { name: "Built-up item" }).click();

  const labour = page.locator(".labour-group .build-up-row").last();
  const quantity = labour.getByLabel(/quantity/);
  const unitCost = labour.getByLabel(/unit cost/);
  await quantity.fill("8");
  await quantity.press("ArrowUp");
  await expect(quantity).toHaveValue("8");
  await quantity.press("ArrowDown");
  await expect(quantity).toHaveValue("8");

  await unitCost.fill("120");
  await unitCost.hover();
  await page.mouse.wheel(0, 180);
  await expect(unitCost).toHaveValue("120");
  await expect(unitCost).not.toBeFocused();
});

test("expanded estimate lines keep pricing controls in the detail header", async ({ page }) => {
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Estimate/ }).click();
  await page.getByRole("button", { name: "Built-up item" }).click();

  const labour = page.locator(".labour-group .build-up-row").last();
  await labour.getByLabel(/quantity/).fill("8");
  await labour.getByLabel(/unit cost/).fill("120");

  const mainRow = page.locator(".estimate-table tbody > tr:not(.line-detail-row)").last();
  await expect(page.locator(".estimate-table thead")).not.toContainText("Markup");
  await expect(page.locator(".estimate-table thead")).not.toContainText("Sell price");
  await expect(page.locator(".estimate-table thead")).toContainText("Direct cost");
  await expect(mainRow.locator(".direct-cost-cell")).toContainText("$960.00");

  const detailPricing = page.locator(".line-detail-panel .line-detail-pricing");
  await expect(detailPricing.getByLabel(/Markup for/)).toHaveValue("20");
  await expect(detailPricing).toContainText("Sell price");
  await expect(detailPricing).toContainText("$1,152.00");

  await page.setViewportSize({ width: 390, height: 844 });
  await mainRow.scrollIntoViewIfNeeded();
  await expect(mainRow.locator(".direct-cost-cell")).toBeVisible();
  await expect.poll(async () => {
    const bounds = await detailPricing.boundingBox();
    return bounds ? bounds.x >= 0 && bounds.x + bounds.width <= 390 : false;
  }).toBe(true);
});

test("quote PDF actions are separated by workflow page", async ({ page }) => {
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();

  await expect(page.getByRole("button", { name: "Download Proposal, Estimate, Breakdown" })).toBeVisible();
  await expect(page.locator(".quote-primary-actions").getByRole("button", { name: /Duplicate/ })).toHaveCount(0);
  await expect(page.locator(".quote-primary-actions").getByRole("button", { name: /PDF backup/ })).toHaveCount(0);

  await page.getByRole("tab", { name: /Estimate/ }).click();
  await expect(page.getByRole("button", { name: "Estimate Only PDF" })).toBeVisible();

  await page.getByRole("tab", { name: /Breakdown/ }).click();
  await expect(page.getByRole("button", { name: "Download Breakdown PDF" })).toBeVisible();

  await page.getByRole("tab", { name: /Review/ }).click();
  await expect(page.getByRole("button", { name: "Duplicate quote" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download full PDF backup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Built-up items/ })).toHaveCount(0);

  await page.getByRole("tab", { name: /Proposal/ }).click();
  await expect(page.getByRole("button", { name: "Proposal PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Full quote backup/ })).toHaveCount(0);
});

test("material price book offers direct manual entry without replacing import", async ({ page }) => {
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: /Price Book/ }).click();
  await page.getByRole("tab", { name: /Material Prices/ }).click();
  await expect(page.getByRole("button", { name: "Add material manually" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import or update prices" })).toBeVisible();
  await page.getByRole("button", { name: "Add material manually" }).click();
  await expect(page.getByRole("heading", { name: "Add a material directly" })).toBeVisible();
  await expect(page.getByLabel("Material name")).toBeVisible();
  await expect(page.getByLabel(/Supplier \/ source/)).toBeVisible();
  await expect(page.getByLabel("Cost")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save material" })).toBeDisabled();
});
