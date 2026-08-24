const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");

test("Field Calculator uses one token-only feature stylesheet", async () => {
  const pageSource = fs.readFileSync(path.join(portalRoot, "field-calculator.html"), "utf8");
  const featureCss = fs.readFileSync(path.join(portalRoot, "field-calculator.css"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");

  expect(pageSource).not.toMatch(/<style\b/i);
  expect(pageSource).not.toMatch(/\sstyle\s*=/i);
  expect(pageSource).toContain('jgc-design-system.css?v=7');
  expect(pageSource).toContain('field-calculator.css?v=15');
  expect(pageSource).not.toContain("field-calculator-design-system.css");
  expect(featureCss, "calculator-specific CSS must inherit centralized theme tokens").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);

  const releaseId = Number(serviceWorker.match(/JGC_RELEASE_ID = "(\d+)"/)?.[1] || 0);
  expect(releaseId).toBeGreaterThanOrEqual(764);
  expect(serviceWorker).toContain('"./field-calculator.css?v=15"');
  expect(serviceWorker).not.toContain("field-calculator-design-system.css");
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "compact landscape", width: 844, height: 390 }
]) {
  test(`Field Calculator remains contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/field-calculator.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mainCalculatorPanel")).toBeVisible();
    await expect(page.locator(".calc-key").first()).toBeVisible();

    const dimensions = await page.evaluate(() => {
      const workbench = document.querySelector(".calculator-workbench").getBoundingClientRect();
      return {
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
        workbenchLeft: workbench.left,
        workbenchRight: workbench.right,
        workbenchTop: workbench.top,
        workbenchBottom: workbench.bottom,
        pageColor: getComputedStyle(document.body).color,
        pageBackground: getComputedStyle(document.documentElement).backgroundColor
      };
    });

    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.workbenchLeft).toBeGreaterThanOrEqual(0);
    expect(dimensions.workbenchRight).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.workbenchTop).toBeGreaterThanOrEqual(0);
    expect(dimensions.workbenchBottom).toBeLessThanOrEqual(dimensions.viewportHeight + 1);
    expect(dimensions.pageColor).toBe("rgb(255, 255, 255)");
    expect(dimensions.pageBackground).toBe("rgb(2, 11, 8)");
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("Field Calculator keypad and overlays remain interactive", async ({ page }) => {
  await page.goto("/field-calculator.html", { waitUntil: "domcontentloaded" });
  await page.locator('[data-action="digit:2"]').click();
  await page.locator('[data-action="op:+"]').click();
  await page.locator('[data-action="digit:3"]').click();
  await page.locator('[data-action="equals"]').click();
  await expect(page.locator("#calcMainValue")).toContainText("5");

  await page.getByRole("button", { name: "Open calculator pocket guide" }).click();
  await expect(page.locator("#calcOverlay")).toHaveClass(/open/);
  await expect(page.locator("#calcOverlayTitle")).toContainText("Guide");
  await page.locator("#calcOverlay .calc-overlay-header button").click();
  await expect(page.locator("#calcOverlay")).not.toHaveClass(/open/);
});

test("Field Calculator quick calculations remain available", async ({ page }) => {
  await page.goto("/field-calculator.html", { waitUntil: "domcontentloaded" });
  await page.locator('[data-quick-calc="sonotube"]').first().click();
  await expect(page.locator("#quickCalcPanel")).toBeVisible();
  await expect(page.locator("#sonotubeResults")).not.toBeEmpty();
  await page.locator('[data-quick-calc="stairs"]').first().click();
  await expect(page.locator("#stairsCalcForm")).toBeVisible();
  await expect(page.locator("#stairsResults")).not.toBeEmpty();
});
