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

test("personal overview orders compact greeting, search and recent work before company-only statistics", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/estimating/index.html?dev=1");

  const scopeSwitch = page.locator(".dashboard-scope-switch");
  const greeting = page.locator(".welcome-panel.compact");
  const search = page.locator(".overview-search");
  const recentWork = page.locator(".recent-work-panel");
  await expect(greeting).toBeVisible();
  await expect(recentWork).toBeVisible();
  await expect(page.locator(".metric-grid")).toHaveCount(0);
  await expect(page.locator(".pipeline-panel")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const selector = document.querySelector(".dashboard-scope-switch");
    const greetingPanel = document.querySelector(".welcome-panel.compact");
    const searchPanel = document.querySelector(".overview-search");
    const recent = document.querySelector(".recent-work-panel");
    const follows = (first, second) => !!first && !!second && Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    return follows(selector, greetingPanel) && follows(greetingPanel, searchPanel) && follows(searchPanel, recent);
  })).toBe(true);
  await expect.poll(async () => Math.round((await greeting.boundingBox())?.height ?? 999)).toBeLessThanOrEqual(125);
  await expect(scopeSwitch).toBeVisible();
  await expect(search).toBeVisible();

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

test("pricing controls accept whole-number typed percentages and stay synchronized with sliders", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Details/ }).click();

  const markupInput = page.getByRole("spinbutton", { name: "Project markup percentage" });
  const markupSlider = page.getByRole("slider", { name: "Project markup slider" });
  const marginInput = page.getByRole("spinbutton", { name: "Target margin percentage" });
  const marginSlider = page.getByRole("slider", { name: "Target margin slider" });

  await markupInput.fill("32.4");
  await marginInput.fill("18.7");
  await expect(markupInput).toHaveValue("32");
  await expect(markupSlider).toHaveValue("32");
  await expect(marginInput).toHaveValue("19");
  await expect(marginSlider).toHaveValue("19");

  await markupInput.focus();
  await page.keyboard.press("ArrowUp");
  await expect(markupInput).toHaveValue("32");
});

test("proposal scope editor visibly numbers every scope item", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Details/ }).click();

  const scopeEditor = page.getByRole("group", { name: /Proposal Scope Lines/ });
  const initialItemCount = await scopeEditor.locator(".numbered-scope-number").count();
  const firstItem = page.getByRole("textbox", { name: "Proposal scope item 1" });
  await firstItem.fill("Supply and install the new work");
  await firstItem.press("Control+End");
  await firstItem.press("Enter");
  const secondItem = page.getByRole("textbox", { name: "Proposal scope item 2" });
  await expect(secondItem).toBeFocused();
  await secondItem.fill("Demobilize and leave the site clean");

  await expect(scopeEditor.locator(".numbered-scope-number")).toHaveText(Array.from({ length: initialItemCount + 1 }, (_, index) => `${index + 1}.`));
  await expect(firstItem).toHaveText("Supply and install the new work");
  await expect(secondItem).toHaveText("Demobilize and leave the site clean");
});

test("proposal scope items can be reordered and deleted", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Details/ }).click();

  const editor = page.getByRole("group", { name: /Proposal Scope Lines/ });
  const deleteButtons = editor.getByRole("button", { name: /Delete proposal scope item/ });
  while (await deleteButtons.count() > 1) await deleteButtons.last().click();
  const firstItem = page.getByRole("textbox", { name: "Proposal scope item 1" });
  await firstItem.fill("First item");
  await firstItem.press("Control+End");
  await firstItem.press("Enter");
  await page.getByRole("textbox", { name: "Proposal scope item 2" }).fill("Second item");

  const firstHandle = page.getByRole("button", { name: "Move proposal scope item 1" });
  const handleBox = await firstHandle.boundingBox();
  const secondBox = await page.getByRole("textbox", { name: "Proposal scope item 2" }).boundingBox();
  if (!handleBox || !secondBox) throw new Error("Scope drag controls were not visible");
  const pointerId = 7;
  await firstHandle.dispatchEvent("pointerdown", { pointerId, pointerType: "touch", clientX: handleBox.x + handleBox.width / 2, clientY: handleBox.y + handleBox.height / 2 });
  await page.evaluate(({ pointerId: activePointerId, x, y }) => window.dispatchEvent(new PointerEvent("pointermove", { pointerId: activePointerId, pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true })), { pointerId, x: secondBox.x + secondBox.width / 2, y: secondBox.y + secondBox.height / 2 });
  await page.evaluate((activePointerId) => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: activePointerId, pointerType: "touch", bubbles: true, cancelable: true })), pointerId);
  await expect(page.getByRole("textbox", { name: "Proposal scope item 1" })).toHaveText("Second item");
  await expect(page.getByRole("textbox", { name: "Proposal scope item 2" })).toHaveText("First item");

  await page.getByRole("button", { name: "Delete proposal scope item 1" }).click();
  await expect(editor.locator(".numbered-scope-number")).toHaveText(["1."]);
  await expect(page.getByRole("textbox", { name: "Proposal scope item 1" })).toHaveText("First item");
});

test("proposal text formatting is visible in the editor and preview", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Details/ }).click();

  const scopeItem = page.getByRole("textbox", { name: "Proposal scope item 1" });
  await scopeItem.fill("Protect this important area");
  await scopeItem.evaluate((element) => {
    const text = element.firstChild;
    if (!text) throw new Error("Scope text was not created");
    const range = document.createRange();
    range.setStart(text, 13);
    range.setEnd(text, 22);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByRole("group", { name: /Proposal Scope Lines/ }).getByRole("button", { name: "Yellow highlight" }).click();
  await expect(scopeItem.locator("mark.proposal-highlight-yellow")).toHaveText("important");

  await page.getByRole("tab", { name: /Proposal/ }).click();
  await expect(page.locator(".hybrid-scope-list mark.proposal-highlight-yellow")).toHaveText("important");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Proposal PDF/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  const stream = await download.createReadStream();
  let byteCount = 0;
  for await (const chunk of stream) byteCount += chunk.length;
  expect(byteCount).toBeGreaterThan(5_000);
});

test("missing exclusions remain recommended without blocking Finish quote", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Details/ }).click();
  await page.getByRole("textbox", { name: "Exclusions" }).fill("");
  await page.getByRole("tab", { name: /Review/ }).click();

  const reviewPanel = page.locator(".readiness-checks");
  await expect(page.locator(".review-hero")).toContainText("Ready with warnings");
  await expect(reviewPanel.locator(".recommendations")).toContainText("Does not block finishing");
  await expect(reviewPanel.locator(".recommendations")).toContainText("Add exclusions or state that there are none.");
  await expect(reviewPanel.locator(".warnings")).not.toContainText("Add exclusions or state that there are none.");

  const finishQuote = reviewPanel.getByRole("button", { name: "Finish quote" });
  await expect(finishQuote).toBeEnabled();
  await finishQuote.click();
  await page.getByRole("dialog", { name: /Mark .* as Finished/ }).getByRole("button", { name: "Finish quote" }).click();
  await expect(page.locator(".identity-badges")).toContainText("Finished");
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

  const mainRow = page.locator(".estimate-table tbody > tr.expanded:not(.line-detail-row)");
  await expect(page.locator(".estimate-table thead")).not.toContainText("Markup");
  await expect(page.locator(".estimate-table thead")).not.toContainText("Sell price");
  await expect(page.locator(".estimate-table thead")).toContainText("Direct cost");
  await expect(mainRow.locator(".direct-cost-cell")).toContainText("$960.00");

  const detailPricing = page.locator(".line-detail-panel .line-detail-pricing");
  await expect(detailPricing.getByLabel(/Markup for/)).toHaveValue("20");
  await expect(detailPricing).toContainText("Sell price");
  await expect(detailPricing).toContainText("$1,152.00");

  const internalDetails = page.getByLabel("Internal scope, assumptions and notes Hidden from customer");
  await expect(internalDetails).toHaveCount(1);
  await expect(page.getByLabel("Internal note Hidden from customer")).toHaveCount(0);
  await internalDetails.fill("Confirm access and working hours before pricing.");
  await expect(internalDetails).toHaveValue("Confirm access and working hours before pricing.");

  await page.setViewportSize({ width: 390, height: 844 });
  await mainRow.scrollIntoViewIfNeeded();
  await expect(mainRow.locator(".direct-cost-cell")).toBeVisible();
  await expect.poll(async () => {
    const bounds = await detailPricing.boundingBox();
    return bounds ? bounds.x >= 0 && bounds.x + bounds.width <= 390 : false;
  }).toBe(true);
});

test("subcontractor lines allow an optional quote number and separate added costs", async ({ page }) => {
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Estimate/ }).click();
  await page.locator(".subcontractor-add-button").click();

  const mainRow = page.locator(".estimate-table tbody > tr.expanded:not(.line-detail-row)");
  const vendor = mainRow.getByRole("combobox", { name: /Vendor for line/ });
  await vendor.fill("Demo Painting");
  await page.getByRole("option", { name: /Demo Painting Vendor/ }).click();
  await mainRow.locator(".direct-unit-cost-cell input").fill("4600");
  await expect(mainRow).toContainText("Quote # optional");

  const detail = page.locator(".line-detail-panel");
  const quoteNumber = detail.getByLabel(/Subcontractor quote #/);
  await expect(quoteNumber).toBeEnabled();
  await expect(quoteNumber).toHaveAttribute("placeholder", "Enter only when the subcontractor provides one");
  await detail.getByRole("button", { name: "Add quote cost breakdown" }).click();

  const worksheet = page.locator(".build-up-worksheet");
  await expect(worksheet).toContainText("SUBCONTRACTOR COST BREAKDOWN");
  const vendorPrice = worksheet.locator(".subcontractor-group .build-up-row").first();
  await expect(vendorPrice.locator(".build-up-money-input input")).toHaveValue("4600");

  const shipping = worksheet.locator(".other-group .build-up-row").first();
  await shipping.getByLabel("Other description").fill("Shipping");
  await shipping.locator(".build-up-money-input input").fill("250");
  await worksheet.getByRole("button", { name: "Other cost row" }).click();
  const perforation = worksheet.locator(".other-group .build-up-row").last();
  await perforation.getByLabel("Other description").fill("Perforation");
  await perforation.locator('input[type="number"]').first().fill("1");
  await perforation.locator(".build-up-money-input input").fill("400");

  await expect(mainRow.locator(".direct-unit-cost-cell input")).toHaveValue("5250");
  await expect(mainRow.locator(".direct-cost-cell")).toContainText("$5,250.00");
  await expect(worksheet.locator(".subcontractor-build-up-summary")).toContainText("$4,600.00");
  await expect(worksheet.locator(".subcontractor-build-up-summary")).toContainText("$650.00");
  await expect(worksheet.locator(".subcontractor-build-up-summary")).toContainText("$5,250.00");

  await page.getByRole("tab", { name: /Review/ }).click();
  await expect(page.getByText(/needs the subcontractor quote number/i)).toHaveCount(0);
  const reviewCard = page.locator(".review-subcontractor-card").last();
  await expect(reviewCard).toContainText("Includes added costs");
  await expect(reviewCard).toContainText("$5,250.00");
});

test("typed subcontractor names automatically become the line description", async ({ page }) => {
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Estimate/ }).click();
  await page.locator(".subcontractor-add-button").click();

  const mainRow = page.locator(".estimate-table tbody > tr.expanded:not(.line-detail-row)");
  await mainRow.getByRole("combobox", { name: /Vendor for line/ }).fill("Agway Metals");
  await mainRow.locator(".direct-unit-cost-cell input").fill("100");
  await expect(page.locator(".line-detail-panel h3")).toHaveText("Agway Metals");

  await page.getByRole("tab", { name: /Review/ }).click();
  await expect(page.getByText(/needs a description/i)).toHaveCount(0);
  await expect(page.locator(".review-subcontractor-card").last()).toContainText("Agway Metals");
});

test("estimate direct costs always round up to whole dollars", async ({ page }) => {
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Estimate/ }).click();
  await page.getByRole("button", { name: /Custom line/ }).click();

  const mainRow = page.locator(".estimate-table tbody > tr.expanded:not(.line-detail-row)");
  await mainRow.locator(".description-input").fill("Rounded direct cost");
  const unitCost = mainRow.locator(".direct-unit-cost-cell input");
  await unitCost.fill("1478.55");
  await expect(unitCost).toHaveValue("1478.55");
  await expect(mainRow.locator(".direct-cost-cell")).toContainText("$1,479.00");
  await expect(page.locator(".line-detail-pricing")).toContainText("$1,774.80");

  await unitCost.fill("1478");
  await expect(mainRow.locator(".direct-cost-cell")).toContainText("$1,478.00");
});

test("estimate lines stay grouped by cost type with subcontractors first", async ({ page }) => {
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Estimate/ }).click();
  await page.getByRole("button", { name: /Custom line/ }).click();
  await page.locator(".subcontractor-add-button").click();

  const types = await page.locator('.estimate-table tbody > tr:not(.line-detail-row) td[data-label="Cost type"]').evaluateAll((cells) => cells.map((cell) => cell.querySelector("select")?.value ?? cell.textContent?.trim() ?? ""));
  const order = ["Sub / Vendor", "Labour & Materials", "Labour", "Material", "Equipment / Other"];
  const ranks = types.map((type) => order.indexOf(type));
  await expect(types[0]).toBe("Sub / Vendor");
  await expect(ranks).toEqual([...ranks].sort((left, right) => left - right));
  const firstNonSubcontractor = types.findIndex((type) => type !== "Sub / Vendor");
  await expect(types.slice(0, firstNonSubcontractor).every((type) => type === "Sub / Vendor")).toBe(true);
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
