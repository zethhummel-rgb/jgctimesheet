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
  await firstClient.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, button: 0 });
  await firstClient.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true, button: 0 });
  await expect(clientPicker).toHaveValue(selectedName || "");
  await expect(clientPicker).toHaveAttribute("aria-expanded", "false");
  await expect(results).toHaveCount(0);
});

test("mobile proposal cost-breakdown choices stay readable and contained", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Details/ }).click();
  await page.getByRole("checkbox", { name: /Show cost breakdown on proposal/ }).check();

  await expect(page.getByRole("checkbox", { name: /^Labour/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^Materials/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^Subcontractors/ })).toBeVisible();
  await expect(page.locator(".proposal-breakdown-category-grid input[type='checkbox']")).toHaveCount(3);
  await expect(page.getByRole("checkbox", { name: /^CoordinationMarked-up equipment/ })).toHaveCount(0);
  await expect(page.getByText("Select individual estimate lines to show")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Demo Drywall Vendor — Drywall/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Painting materials allowance/ })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Site setup and miscellaneous materials/ })).toBeVisible();
  await expect(page.locator(".proposal-breakdown-line-choice input[type='checkbox']")).toHaveCount(9);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("estimator autosave queues rapid changes instead of sending overlapping saves", async ({ page }) => {
  let activeSaves = 0;
  let maximumActiveSaves = 0;
  const savedStates = [];

  await page.route("**/api/state", async (route) => {
    if (route.request().method() !== "PUT") {
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Use local QA state" }) });
    }
    activeSaves += 1;
    maximumActiveSaves = Math.max(maximumActiveSaves, activeSaves);
    savedStates.push(route.request().postDataJSON().state);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    activeSaves -= 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ saved: true, updatedAt: new Date().toISOString() }) });
  });

  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Details/ }).click();

  const projectName = page.getByRole("textbox", { name: /Project name/ });
  await projectName.fill("First queued value");
  await expect.poll(() => savedStates.length).toBe(1);
  await projectName.fill("Newest queued value");
  await page.waitForTimeout(900);
  expect(maximumActiveSaves).toBe(1);

  await expect.poll(() => savedStates.length).toBe(2);
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(maximumActiveSaves).toBe(1);
  const finalQuote = savedStates.at(-1).quotes.find((quote) => quote.number === "JGC-Q-2026-0001");
  expect(finalQuote.project).toBe("Newest queued value");
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

test("proposal rich-text editors keep the caret while typing", async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Details/ }).click();

  const scopeItem = page.getByRole("textbox", { name: "Proposal scope item 1" });
  await scopeItem.fill("");
  await scopeItem.pressSequentially("Scope typed forward");
  await expect(scopeItem).toHaveText("Scope typed forward");

  const notesEditor = page.getByRole("textbox", { name: "Proposal Notes" });
  await notesEditor.fill("");
  await notesEditor.pressSequentially("Notes typed forward");
  await expect(notesEditor).toHaveText("Notes typed forward");
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

test("new quotes start with a blank scope item before the deletable closing demobilization item", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "New quote" }).click();

  const editor = page.getByRole("group", { name: /Proposal Scope Lines/ });
  const closingText = "Demobilize and leave site in a clean fashion";
  const scopeItems = editor.getByRole("textbox", { name: /Proposal scope item/ });
  await expect(scopeItems).toHaveCount(2);
  await expect(scopeItems.first()).toHaveText("");
  await expect(scopeItems.first()).toHaveAttribute("aria-readonly", "false");
  await expect(scopeItems.nth(1)).toHaveText(closingText);
  await expect(scopeItems.nth(1)).toHaveAttribute("aria-readonly", "true");

  await scopeItems.first().fill("Supply labour and materials to complete the work");
  await expect(scopeItems.last()).toHaveText(closingText);
  await expect(scopeItems.last()).toHaveAttribute("aria-readonly", "true");

  await editor.getByRole("button", { name: "Add scope item" }).click();
  await expect(scopeItems.last()).toHaveText(closingText);
  await scopeItems.nth((await scopeItems.count()) - 2).fill("Final cleanup inspection");
  await expect(scopeItems.last()).toHaveText(closingText);

  const addedLineNumber = await scopeItems.count() - 1;
  await editor.getByRole("button", { name: `Move proposal scope item ${addedLineNumber}` }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(scopeItems.last()).toHaveText(closingText);

  const closingRow = editor.locator(".numbered-scope-row").filter({ hasText: closingText });
  await closingRow.getByRole("button", { name: /Delete proposal scope item/ }).click();
  await expect(editor.getByText(closingText, { exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: /Review/ }).click();
  await page.getByRole("tab", { name: /Details/ }).click();
  await expect(editor.getByText(closingText, { exact: true })).toHaveCount(0);
});

test("proposal text formatting is visible in the editor, preview and PDF", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1365, height: 900 });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Details/ }).click();

  const scopeItem = page.getByRole("textbox", { name: "Proposal scope item 1" });
  await scopeItem.fill("Protect this important highlighted area");
  await expect(scopeItem).toHaveText("Protect this important highlighted area");
  await scopeItem.evaluate((element) => {
    const text = element.firstChild;
    if (!text) throw new Error("Scope text was not created");
    const range = document.createRange();
    range.setStart(text, 13);
    range.setEnd(text, 39);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByRole("group", { name: /Proposal Scope Lines/ }).getByRole("button", { name: "Yellow highlight" }).click();
  await expect(scopeItem.locator("mark.proposal-highlight-yellow")).toHaveText("important highlighted area");

  const notesEditor = page.getByRole("textbox", { name: "Proposal Notes" });
  await notesEditor.evaluate((element) => {
    element.innerHTML = '<div>Regular proposal note</div><div><b><mark class="proposal-highlight-yellow">Work to be Completed in two stages</mark></b></div>';
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  });
  await expect(notesEditor.locator("mark.proposal-highlight-yellow")).toHaveText("Work to be Completed in two stages");

  await page.getByRole("tab", { name: /Proposal/ }).click();
  await expect(page.locator(".hybrid-scope-list mark.proposal-highlight-yellow")).toHaveText("important highlighted area");
  await expect(page.locator(".hybrid-notes-list mark.proposal-highlight-yellow")).toHaveText("Work to be Completed in two stages");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Proposal PDF/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  await download.saveAs(testInfo.outputPath("highlighted-proposal.pdf"));
  const stream = await download.createReadStream();
  let byteCount = 0;
  for await (const chunk of stream) byteCount += chunk.length;
  expect(byteCount).toBeGreaterThan(5_000);

  await page.getByRole("tab", { name: /Review/ }).click();
  const [backupDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download full PDF backup" }).click(),
  ]);
  expect(backupDownload.suggestedFilename()).toMatch(/\.pdf$/i);
  await backupDownload.saveAs(testInfo.outputPath("highlighted-full-quote-backup.pdf"));
  const backupStream = await backupDownload.createReadStream();
  let backupByteCount = 0;
  for await (const chunk of backupStream) backupByteCount += chunk.length;
  expect(backupByteCount).toBeGreaterThan(byteCount);
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
  await unitCost.dispatchEvent("wheel", { deltaY: 180 });
  await expect(unitCost).toHaveValue("120");
  await expect(unitCost).not.toBeFocused();
});

test("mobile built-up material search selects the tapped saved price", async ({ page }) => {
  const supplierCatalogRequests = [];
  await page.route(/\/api\/supplier-catalog(?:\?|$)/, async (route) => {
    supplierCatalogRequests.push(route.request().url());
    const query = new URL(route.request().url()).searchParams.get("q") || "";
    const material = query.toLowerCase().includes("lumber") ? {
      id: "catalog-lumber-1",
      supplierId: "supplier-bmr",
      supplierName: "BMR",
      supplierSku: "LUMBER-001",
      productName: "2x6x10 PT",
      rawDescription: "2x6x10 PT",
      normalizedName: "2x6x10 pt",
      division: "Div 06 – Wood",
      unit: "Each",
      rawUnit: "Each",
      listPrice: 13.45,
      netCost: 13.45,
      effectiveDate: "2026-08-25",
      validUntil: "2026-09-25",
      latestImportId: "import-lumber-1",
    } : {
      id: "catalog-concrete-1",
      supplierId: "supplier-bmr",
      supplierName: "BMR",
      supplierSku: "CONCRETE-001",
      productName: "Concrete Daubois Pre-mix, 30 kg",
      rawDescription: "Concrete Daubois Pre-mix, 30 kg",
      normalizedName: "concrete daubois pre mix 30 kg",
      division: "Div 03 – Concrete",
      unit: "Each",
      rawUnit: "Each",
      listPrice: 6.03,
      netCost: 6.03,
      effectiveDate: "2026-08-25",
      validUntil: "2026-09-25",
      latestImportId: "import-concrete-1",
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [material],
        total: 1,
        imports: [],
      }),
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
  await page.getByRole("tab", { name: /Estimate/ }).click();
  await page.getByRole("button", { name: "Built-up item" }).click();
  await expect(page.locator(".estimate-table tbody > tr.expanded:not(.line-detail-row) input.description-input")).toBeFocused();

  const materialRows = page.locator(".material-group .build-up-row");
  await expect(materialRows).toHaveCount(1);
  await expect(materialRows.first().getByLabel("Material description")).toHaveValue("");

  const materialSearch = page.getByRole("combobox", { name: "Search saved material prices" });
  await materialSearch.fill("concrete");
  await expect.poll(() => supplierCatalogRequests).toEqual(expect.arrayContaining([expect.stringContaining("q=concrete")]));
  await expect(materialSearch).toHaveValue("concrete");
  await expect(materialSearch).toHaveAttribute("aria-expanded", "true");
  const results = page.locator(".build-up-material-results");
  await expect(results).toBeVisible();
  const firstResult = results.getByRole("option").first();
  await firstResult.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, button: 0 });
  await firstResult.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true, button: 0 });

  await expect(materialRows).toHaveCount(1);
  const selectedMaterial = materialRows.first();
  await expect(selectedMaterial.getByLabel("Material description")).toHaveValue("Concrete Daubois Pre-mix, 30 kg");
  await expect(selectedMaterial.getByLabel(/quantity/)).toHaveValue("1");
  await expect(selectedMaterial.getByLabel(/unit cost/)).toHaveValue("6.03");
  await expect(selectedMaterial).toContainText("BMR · price saved 2026-08-25");
  await expect(selectedMaterial.getByLabel(/quantity/)).toBeFocused();
  await expect(results).toHaveCount(0);

  await materialSearch.fill("lumber");
  await expect.poll(() => supplierCatalogRequests).toEqual(expect.arrayContaining([expect.stringContaining("q=lumber")]));
  const secondResult = page.locator(".build-up-material-results").getByRole("option").first();
  await expect(secondResult).toContainText("2x6x10 PT");
  await secondResult.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, button: 0 });
  await secondResult.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true, button: 0 });

  await expect(materialRows).toHaveCount(2);
  const secondMaterial = materialRows.nth(1);
  await expect(secondMaterial.getByLabel("Material description")).toHaveValue("2x6x10 PT");
  await expect(secondMaterial.getByLabel(/quantity/)).toBeFocused();
  await expect.poll(async () => {
    const box = await secondMaterial.boundingBox();
    return Boolean(box && box.y >= 0 && box.y + box.height <= 844);
  }).toBe(true);
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
  const directUnitCost = mainRow.locator(".direct-unit-cost-cell input");
  await directUnitCost.fill("4600");
  await expect(directUnitCost).toHaveValue("4600");
  await expect(mainRow.locator(".direct-cost-cell")).toContainText("$4,600.00");
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

  await unitCost.click();
  await unitCost.press("Control+A");
  await unitCost.pressSequentially("1478");
  await expect(unitCost).toHaveValue("1478");
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
