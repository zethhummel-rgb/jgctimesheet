const { test, expect } = require("@playwright/test");
const { directoryState, serveDirectory } = require("./fixtures/job-readability-fixture");

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

function pickerState() {
  const state = directoryState();
  const template = state.quotes[0];
  state.clients[0].sites = Array.from({ length: 24 }, (_, index) => ({ id: `site-${index}`, label: `Station ${String(index).padStart(2, "0")}`, address: `${index + 1} Station Road` }));
  state.clients[0].contacts = Array.from({ length: 24 }, (_, index) => ({ id: `contact-${index}`, name: `Contact ${String(index).padStart(2, "0")}`, email: "qa@example.com", phone: "", role: "" }));
  for (let index = 0; index < 24; index++) {
    state.quotes.push({ ...template, id: `picker-quote-${index}`, number: `JGC-Q-2026-${String(1000 + index)}`, status: "Finished", project: `Inspection visit ${index}`, revisions: [] });
    state.clients.push({ ...state.clients[0], id: `picker-client-${index}`, name: `Client ${String(index).padStart(2, "0")}` });
  }
  return state;
}

async function openPreview(page) {
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const captures = await serveDirectory(page, pickerState());
  await page.setViewportSize(viewport);
  await page.getByRole("button", { name: /New job.*Preview/ }).tap();
  await page.locator("#new-job-name").fill("Keep my unsaved task");
  return captures;
}

async function assertBelowInput(page, picker) {
  const input = await picker.boundingBox();
  const results = await page.locator(".saved-data-results").boundingBox();
  expect(results.y).toBeGreaterThanOrEqual(input.y + input.height + 5);
  expect(results.y).toBeLessThanOrEqual(input.y + input.height + 8);
  expect(results.x).toBeGreaterThanOrEqual(0);
  expect(results.x + results.width).toBeLessThanOrEqual(391);
}

async function swipeResults(page) {
  const results = page.locator(".saved-data-results");
  await results.scrollIntoViewIfNeeded();
  const box = await results.boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height - 20 };
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
  for (let step = 1; step <= 8; step++) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x, y: start.y - step * 15, id: 1 }] });
    await page.waitForTimeout(20);
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
  await expect.poll(() => results.evaluate(element => element.scrollTop)).toBeGreaterThan(40);
  // Let native momentum finish before the next intentional tap or typing action.
  let previous = -1, stableSamples = 0;
  await expect.poll(async () => {
    const top = await results.evaluate(element => element.scrollTop);
    stableSamples = Math.abs(top - previous) < .5 ? stableSamples + 1 : 0;
    previous = top;
    return stableSamples;
  }, { intervals: [60] }).toBeGreaterThanOrEqual(3);
}

test("quote list never covers its input as the keyboard viewport or modal scroll changes", async ({ page }, testInfo) => {
  const captures = await openPreview(page);
  const picker = page.getByRole("combobox", { name: "Preview linked quote" });
  await picker.tap();
  await expect(page.locator(".saved-data-results")).toHaveCSS("position", "static");
  await assertBelowInput(page, picker);
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => 320 });
    Object.defineProperty(window.visualViewport, "offsetTop", { configurable: true, get: () => 80 });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator(".saved-data-results")).toHaveCSS("max-height", "128px");
  await page.locator(".job-preview-layer").evaluate(element => { element.scrollTop += 100; });
  await assertBelowInput(page, picker);
  await page.locator(".saved-data-results").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("mobile-picker-keyboard.png") });
  await expect(page.locator("#new-job-name")).toHaveValue("Keep my unsaved task");
  await expect(page.getByRole("button", { name: /Create job/ })).toBeDisabled();
  expect(captures.writes).toEqual([]);
});

test("real touch swipes scroll quotes without selecting; a subsequent tap chooses once", async ({ page }, testInfo) => {
  const captures = await openPreview(page);
  const picker = page.getByRole("combobox", { name: "Preview linked quote" });
  await picker.tap();
  await swipeResults(page);
  await expect(picker).toHaveValue("");
  await expect(picker).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#new-job-name")).toHaveValue("Keep my unsaved task");
  await assertBelowInput(page, picker);
  await page.screenshot({ path: testInfo.outputPath("mobile-picker-after-swipe.png") });
  const option = page.getByRole("option").filter({ hasText: "JGC-Q-2026-1006" });
  await option.scrollIntoViewIfNeeded();
  await option.tap();
  await expect(picker).toHaveValue("JGC-Q-2026-1006");
  await expect(page.locator("#new-job-name")).toHaveValue("Inspection visit 6");
  await expect(page.locator(".saved-data-results")).toHaveCount(0);
  expect(captures.writes).toEqual([]);
  expect(captures.jobInfo).toEqual([]);
  expect(captures.unexpectedRequests).toEqual([]);
});

test("finger drift, cancelled gestures and compatibility clicks cannot select or add", async ({ page }) => {
  await openPreview(page);
  const picker = page.getByRole("combobox", { name: "New job client" });
  await picker.tap();
  const option = page.getByRole("option").first();
  await option.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 9, clientX: 100, clientY: 200 });
  await option.dispatchEvent("pointermove", { pointerType: "touch", pointerId: 9, clientX: 100, clientY: 160 });
  await option.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 9, clientX: 100, clientY: 160 });
  await option.dispatchEvent("click", { detail: 1 });
  await expect(picker).toHaveValue("");
  await expect(picker).toHaveAttribute("aria-expanded", "true");
  await picker.fill("New preview client");
  const add = page.getByRole("button", { name: /Add new client: New preview client/ });
  await add.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 10 });
  await add.dispatchEvent("pointercancel", { pointerType: "touch", pointerId: 10 });
  await add.dispatchEvent("click", { detail: 1 });
  await expect(page.getByRole("dialog", { name: "Add new client", exact: true })).toHaveCount(0);
  await add.tap();
  await expect(page.getByRole("dialog", { name: "Add new client", exact: true })).toBeVisible();
});

test("client, site and attention lists also allow touch scrolling without changing details", async ({ page }) => {
  const captures = await openPreview(page);
  const client = page.getByRole("combobox", { name: "New job client" });
  await client.tap();
  await swipeResults(page);
  await expect(client).toHaveValue("");
  await client.fill("Quoted Contract Client");
  await page.getByRole("option").filter({ hasText: "Quoted Contract Client" }).tap();
  for (const name of ["New job site", "New job attention"]) {
    const picker = page.getByRole("combobox", { name });
    await picker.tap();
    await swipeResults(page);
    await expect(picker).toHaveValue("");
    await expect(page.getByLabel("Site address", { exact: true })).toHaveValue("");
    await picker.fill(name === "New job site" ? "Station 06" : "Contact 06");
    await page.locator(".saved-data-results").getByRole("option").tap();
    if (name === "New job site") await expect(page.getByLabel("Site address", { exact: true })).toHaveValue("7 Station Road");
    // Clear only the manual address so the next swipe can prove it leaves it untouched.
    await page.getByLabel("Site address", { exact: true }).fill("");
  }
  expect(captures.writes).toEqual([]);
});

test("a pending scroll event cannot suppress a stationary deliberate tap", async ({ page }) => {
  await openPreview(page);
  const picker = page.getByRole("combobox", { name: "Preview linked quote" });
  await picker.tap();
  const option = page.locator(".saved-data-results").getByRole("option").first();
  await option.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 12, clientX: 100, clientY: 200 });
  await page.locator(".saved-data-results").dispatchEvent("scroll");
  await option.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 12, clientX: 100, clientY: 200 });
  await option.dispatchEvent("click", { detail: 1 });
  await expect(picker).toHaveValue("JGC-Q-2026-1000");
});

test("desktop mouse and keyboard selection still work and Escape leaves the job preview open", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openPreview(page);
  const picker = page.getByRole("combobox", { name: "Preview linked quote" });
  await picker.fill("JGC-Q-2026-1004");
  await expect(page.locator(".saved-data-results")).toHaveCSS("position", "absolute");
  await picker.press("Enter");
  await expect(picker).toHaveValue("JGC-Q-2026-1004");
  await picker.fill("JGC-Q-2026-1008");
  await page.locator(".saved-data-results").getByRole("option").click();
  await expect(picker).toHaveValue("JGC-Q-2026-1008");
  await picker.click();
  await picker.press("Escape");
  await expect(page.getByRole("dialog", { name: "New job", exact: true })).toBeVisible();
});

test("a stationary touch selects even without a browser compatibility click", async ({ page }) => {
  const captures = await openPreview(page);
  const picker = page.getByRole("combobox", { name: "Preview linked quote" });
  await picker.tap();
  const option = page.locator(".saved-data-results").getByRole("option").first();
  await option.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 15, clientX: 100, clientY: 200 });
  await option.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 15, clientX: 100, clientY: 200 });
  await expect(picker).toHaveValue("");
  await option.dispatchEvent("touchend", { cancelable: true });
  await expect(picker).toHaveValue("JGC-Q-2026-1000");
  await expect(page.locator(".saved-data-results")).toHaveCount(0);
  expect(captures.writes).toEqual([]);
});

test("scrolling underneath a stationary finger does not turn touchend into a selection", async ({ page }) => {
  await openPreview(page);
  const picker = page.getByRole("combobox", { name: "Preview linked quote" });
  await picker.tap();
  const option = page.locator(".saved-data-results").getByRole("option").first();
  await option.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 16, clientX: 100, clientY: 200 });
  await page.locator(".saved-data-results").evaluate(element => { element.scrollTop += 60; });
  await option.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 16, clientX: 100, clientY: 200 });
  await option.dispatchEvent("touchend", { cancelable: true });
  await option.dispatchEvent("click");
  await expect(picker).toHaveValue("");
  await expect(picker).toHaveAttribute("aria-expanded", "true");
});
