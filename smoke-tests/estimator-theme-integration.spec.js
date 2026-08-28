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

  expect(sourceIndex).toContain('href="../jgc-design-system.css?v=8" data-jgc-design-system="8"');
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

test("Estimator builds retain the previous release runtime for already-open tabs", async () => {
  const estimatorRoot = path.resolve(__dirname, "../estimating");
  const assetsRoot = path.join(estimatorRoot, "assets");
  const html = fs.readFileSync(path.join(estimatorRoot, "index.html"), "utf8");
  const currentMain = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1];
  expect(currentMain).toBeTruthy();

  const previousMainFiles = fs.readdirSync(assetsRoot)
    .filter((name) => /^index-[A-Za-z0-9_-]+\.js$/.test(name) && name !== currentMain);
  expect(previousMainFiles.length).toBeGreaterThan(0);

  for (const previousMain of previousMainFiles) {
    const source = fs.readFileSync(path.join(assetsRoot, previousMain), "utf8");
    const dependencies = [...source.matchAll(/["']\.\/([^"']+\.js)["']/g)].map((match) => match[1]);
    expect(dependencies.length).toBeGreaterThan(0);
    for (const dependency of dependencies) {
      expect(fs.existsSync(path.join(assetsRoot, dependency)), `${previousMain} requires ${dependency}`).toBe(true);
    }
  }
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
      const welcomeHeading = document.querySelector(".welcome-panel h1");
      const welcomeCopy = document.querySelector(".welcome-panel p");
      const welcomeEyebrow = document.querySelector(".welcome-panel .eyebrow.inverse");
      return {
        brand: rootStyle.getPropertyValue("--green-600").trim(),
        page: rootStyle.getPropertyValue("--jgc-estimator-page").trim(),
        font: rootStyle.getPropertyValue("--jgc-estimator-font-family").trim(),
        bodyBackground: bodyStyle.backgroundColor,
        bodyColor: bodyStyle.color,
        primaryBackground: primaryButton ? getComputedStyle(primaryButton).backgroundColor : "",
        panelBackground: panel ? getComputedStyle(panel).backgroundColor : "",
        sidebarBackground: sidebar ? getComputedStyle(sidebar).backgroundImage : "",
        welcomeHeadingColor: welcomeHeading ? getComputedStyle(welcomeHeading).color : "",
        welcomeCopyColor: welcomeCopy ? getComputedStyle(welcomeCopy).color : "",
        welcomeEyebrowColor: welcomeEyebrow ? getComputedStyle(welcomeEyebrow).color : "",
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
    expect(themeState.welcomeHeadingColor).toBe("rgb(255, 255, 255)");
    expect(themeState.welcomeCopyColor).toBe("rgb(230, 243, 237)");
    expect(themeState.welcomeEyebrowColor).toBe("rgb(185, 243, 215)");
    expect(themeState.overflow).toBeLessThanOrEqual(1);
    expect(themeState.stylesheets.some((href) => /\/estimating\/assets\/index-[^/]+\.css/.test(href))).toBe(true);
    await expect(page.locator('link[data-jgc-design-system="8"][data-jgc-estimator-theme="1"]')).toHaveCount(1);
    const badThemeRequest = await page.evaluate(() => performance.getEntriesByType("resource").some((entry) => entry.name.includes("/estimating/jgc-design-system.css")));
    expect(badThemeRequest).toBe(false);
  });
}
