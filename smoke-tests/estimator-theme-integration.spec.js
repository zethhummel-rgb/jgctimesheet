const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const portalRoot = path.resolve(__dirname, "..");

test("Estimate Desk uses the Portal design system and one token-only theme adapter", async () => {
  const sourceIndex = fs.readFileSync(path.join(portalRoot, "estimating-app/index.html"), "utf8");
  const theme = fs.readFileSync(path.join(portalRoot, "estimator-theme.css"), "utf8");
  const globals = fs.readFileSync(path.join(portalRoot, "estimating-app/app/globals.css"), "utf8");
  const shell = fs.readFileSync(path.join(portalRoot, "estimating-app/src/portal-shell.css"), "utf8");
  const worker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");

  expect(sourceIndex).toContain('href="../jgc-design-system.css?v=7" data-jgc-design-system="7"');
  expect(sourceIndex).toContain('href="../estimator-theme.css?v=1" data-jgc-estimator-theme="1"');
  expect(theme).toContain("--jgc-estimator-green-600: var(--jgc-color-brand-600");
  expect(theme).toContain("--jgc-estimator-red-700: var(--jgc-color-danger");
  expect(theme).toContain("--jgc-estimator-font-family:");
  expect(theme).toContain("--green-600: var(--jgc-estimator-green-600)");
  expect(globals).not.toMatch(/--navy-950\s*:\s*#/);
  expect(globals).not.toMatch(/--green-600\s*:\s*#/);
  expect(globals).toContain("Core colours and shadows come from estimator-theme.css");
  expect(shell).toContain("var(--jgc-estimator-green-700");
  expect(worker).toContain('"./estimator-theme.css?v=1"');
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`Estimate Desk shared theme remains readable and contained on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/estimating/index.html?dev=1");
    await expect(page.locator(".desk-shell")).toBeVisible();

    const themeState = await page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      const primaryButton = document.querySelector(".button.primary");
      const panel = document.querySelector(".panel");
      const sidebar = document.querySelector(".sidebar");
      return {
        brand: rootStyle.getPropertyValue("--green-600").trim(),
        page: rootStyle.getPropertyValue("--jgc-estimator-page").trim(),
        font: rootStyle.getPropertyValue("--jgc-estimator-font-family").trim(),
        bodyBackground: bodyStyle.backgroundColor,
        bodyColor: bodyStyle.color,
        primaryBackground: primaryButton ? getComputedStyle(primaryButton).backgroundColor : "",
        panelBackground: panel ? getComputedStyle(panel).backgroundColor : "",
        sidebarBackground: sidebar ? getComputedStyle(sidebar).backgroundImage : "",
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        stylesheets: Array.from(document.styleSheets).map((sheet) => sheet.href || "")
      };
    });

    expect(themeState.brand).toBe("#13843f");
    expect(themeState.page).toBe("#f7f9fb");
    expect(themeState.font).toContain("Segoe UI");
    expect(themeState.bodyBackground).toBe("rgb(247, 249, 251)");
    expect(themeState.bodyColor).toBe("rgb(24, 33, 43)");
    expect(themeState.primaryBackground).toBe("rgb(19, 132, 63)");
    expect(themeState.panelBackground).toBe("rgb(255, 255, 255)");
    expect(themeState.sidebarBackground).toContain("linear-gradient");
    expect(themeState.overflow).toBeLessThanOrEqual(1);
    expect(themeState.stylesheets.some((href) => /\/estimating\/assets\/index-[^/]+\.css/.test(href))).toBe(true);
    await expect(page.locator('link[data-jgc-design-system="7"][data-jgc-estimator-theme="1"]')).toHaveCount(1);
    const badThemeRequest = await page.evaluate(() => performance.getEntriesByType("resource").some((entry) => entry.name.includes("/estimating/jgc-design-system.css")));
    expect(badThemeRequest).toBe(false);
  });
}
