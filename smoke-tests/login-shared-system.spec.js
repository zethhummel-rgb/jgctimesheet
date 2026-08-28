const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const portalRoot = path.resolve(__dirname, "..");

test("Login uses one token-only visual source", async () => {
  const html = fs.readFileSync(path.join(portalRoot, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(portalRoot, "login-design-system.css"), "utf8");
  const screenMarkup = html.split('<script src="vendor/supabase-js.min.js')[0];

  expect(html).not.toContain("styles.css");
  expect(html).toContain('jgc-design-system.css?v=8');
  expect(html).toContain('login-design-system.css?v=2');
  expect(html).toMatch(/<body\b[^>]*\bjgc-page\b/i);
  expect(screenMarkup).not.toMatch(/<style\b/i);
  expect(screenMarkup).not.toMatch(/\sstyle\s*=/i);
  expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  expect(css).not.toMatch(/\bcolor:\s*(?:white|black)\b/i);
  expect(css).toContain("var(--jgc-color-");

  const worker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");
  expect(worker).toContain('const JGC_RELEASE_ID = "801"');
  expect(worker).toContain('"./login-design-system.css?v=2"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`Login stays readable and contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    const layout = await page.evaluate(() => {
      const shell = document.querySelector(".login-shell").getBoundingClientRect();
      const card = document.querySelector(".login-card").getBoundingClientRect();
      const controls = Array.from(document.querySelectorAll(".login-card input:not([type='checkbox']), .login-card button"))
        .filter((element) => element.offsetParent !== null);
      return {
        viewport: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        shell: { left: shell.left, right: shell.right },
        card: { left: card.left, right: card.right },
        shortestControl: Math.min(...controls.map((element) => element.getBoundingClientRect().height)),
        controlsContained: controls.every((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1;
        }),
        brandVisible: document.querySelector(".brand-panel").offsetParent !== null
      };
    });

    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.shell.left).toBeGreaterThanOrEqual(0);
    expect(layout.shell.right).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.card.left).toBeGreaterThanOrEqual(0);
    expect(layout.card.right).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.controlsContained).toBe(true);
    expect(layout.shortestControl).toBeGreaterThanOrEqual(44);
    expect(layout.brandVisible).toBe(viewport.name === "desktop");
    await context.close();
  });
}

for (const overlayId of ["loginNotesOverlay", "subcontractorAccessOverlay"]) {
  test(`${overlayId} remains contained and scrollable on phones`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.locator(`#${overlayId}`).evaluate((overlay) => overlay.removeAttribute("hidden"));

    const layout = await page.locator(`#${overlayId} .jgc-modal__dialog`).evaluate((dialog) => {
      const overlay = dialog.closest(".jgc-modal");
      const rect = dialog.getBoundingClientRect();
      const dialogStyle = getComputedStyle(dialog);
      return {
        viewport: document.documentElement.clientWidth,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom,
        viewportHeight: window.innerHeight,
        dialogOverflowY: dialogStyle.overflowY
      };
    });

    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(layout.viewport + 1);
    expect(["auto", "scroll"]).toContain(layout.dialogOverflowY);
    expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
    await context.close();
  });
}
