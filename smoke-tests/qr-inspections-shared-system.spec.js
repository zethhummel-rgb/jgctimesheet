const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const portalRoot = path.resolve(__dirname, "..");
const pages = [
  { file: "equipment-inspection.html", css: "equipment-qr-inspection.css" },
  { file: "vehicle-inspection.html", css: "vehicle-qr-inspection.css" }
];

test("QR inspection screens use centralized token-only styling", async () => {
  const sharedCss = fs.readFileSync(path.join(portalRoot, "qr-inspection-design-system.css"), "utf8");
  expect(sharedCss).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);

  for (const page of pages) {
    const source = fs.readFileSync(path.join(portalRoot, page.file), "utf8");
    const featureCss = fs.readFileSync(path.join(portalRoot, page.css), "utf8");
    const screenMarkup = source.split("<script src=")[0];

    expect(source).toContain('jgc-design-system.css?v=8');
    expect(source).toContain('qr-inspection-design-system.css?v=2');
    expect(source).toContain(`${page.css}?v=1`);
    expect(source).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
    expect(screenMarkup).not.toMatch(/<style\b/i);
    expect(screenMarkup).not.toMatch(/\sstyle\s*=/i);
    expect(featureCss).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(featureCss).toContain("var(--jgc-color-");
  }

  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");
  expect(serviceWorker).toContain('"./qr-inspection-design-system.css?v=2"');
  expect(serviceWorker).toContain('"./equipment-qr-inspection.css?v=1"');
  expect(serviceWorker).toContain('"./vehicle-qr-inspection.css?v=1"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  for (const pageInfo of pages) {
    test(`${pageInfo.file} remains readable and contained on ${viewport.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport, javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(`/${pageInfo.file}`, { waitUntil: "domcontentloaded" });

      await page.locator("[hidden]").evaluateAll((nodes) => nodes.forEach((node) => node.removeAttribute("hidden")));
      await expect(page.locator(".qr-inspection-shell")).toBeVisible();

      const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        shell: (() => {
          const rect = document.querySelector(".qr-inspection-shell").getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width };
        })(),
        fieldsContained: Array.from(document.querySelectorAll("input, select, textarea, button")).every((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1;
        })
      }));

      expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
      expect(layout.shell.left).toBeGreaterThanOrEqual(0);
      expect(layout.shell.right).toBeLessThanOrEqual(layout.viewport + 1);
      expect(layout.fieldsContained).toBe(true);
      await context.close();
    });
  }
}
