const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const portalRoot = path.resolve(__dirname, "..");
const historyPages = [
  { file: "todays-inspections.html", css: "inspection-history-today.css" },
  { file: "previous-inspections.html", css: "inspection-history-previous.css" }
];

test("inspection records screens and Admin Safety Records use token-only visual sources", async () => {
  for (const page of historyPages) {
    const source = fs.readFileSync(path.join(portalRoot, page.file), "utf8");
    const screenMarkup = source.split("<script src=")[0];
    const css = fs.readFileSync(path.join(portalRoot, page.css), "utf8");

    expect(source).not.toContain("styles.css");
    expect(source).toContain('jgc-design-system.css?v=8');
    expect(source).toContain(`${page.css}?v=1`);
    expect(source).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
    expect(screenMarkup).not.toMatch(/<style\b/i);
    expect(screenMarkup).not.toMatch(/\sstyle\s*=/i);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(css).toContain("var(--jgc-color-");
  }

  const adminSource = fs.readFileSync(path.join(portalRoot, "admin.html"), "utf8");
  const adminCss = fs.readFileSync(path.join(portalRoot, "admin.css"), "utf8");
  const safetyCss = fs.readFileSync(path.join(portalRoot, "safety-records-admin.css"), "utf8");
  expect(adminSource).toContain('admin.css?v=16');
  expect(adminSource).toContain('safety-records-admin.css?v=2');
  expect(adminCss).not.toMatch(/\.admin-safety-record-tile|\.inspection-sheet/);
  expect(safetyCss).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  expect(safetyCss).toContain("var(--jgc-color-");

  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");
  for (const asset of ["inspection-history-today.css?v=1", "inspection-history-previous.css?v=1", "safety-records-admin.css?v=2", "admin.css?v=16"]) {
    expect(serviceWorker).toContain(`"./${asset}"`);
  }
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  for (const pageInfo of historyPages) {
    test(`${pageInfo.file} inspection table stays contained on ${viewport.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport, javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(`/${pageInfo.file}`, { waitUntil: "domcontentloaded" });
      await page.locator("#inspectionList").evaluate((node) => {
        node.className = "table-wrap jgc-table-wrap";
        node.innerHTML = `<table class="jgc-table"><thead><tr><th>Employee</th><th>Type</th><th>Date</th><th>Job</th><th>Actions</th></tr></thead><tbody><tr><td>Steven Leduc</td><td>Vehicle / Trailer Inspection</td><td>Aug 24, 2026</td><td>26074 - Shop JGC</td><td><button class="jgc-button">View</button></td></tr></tbody></table>`;
      });

      const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        container: (() => {
          const rect = document.querySelector(".container").getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        })(),
        tableScrollable: (() => {
          const wrap = document.querySelector(".table-wrap");
          return wrap.scrollWidth >= wrap.clientWidth && getComputedStyle(wrap).overflowX === "auto";
        })()
      }));

      expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
      expect(layout.container.left).toBeGreaterThanOrEqual(0);
      expect(layout.container.right).toBeLessThanOrEqual(layout.viewport + 1);
      expect(layout.tableScrollable).toBe(true);
      await context.close();
    });
  }
}

test("Admin Safety Records tiles and inspection sheet stay contained on phones", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.locator("#safetyRecordsSection, #inspectionsSection").evaluateAll((nodes) => nodes.forEach((node) => node.removeAttribute("hidden")));
  await page.locator("#adminInspectionViewPanel").evaluate((node) => {
    node.removeAttribute("hidden");
    node.innerHTML = `<article class="inspection-sheet"><h2 class="inspection-sheet-title">Vehicle Inspection</h2><div class="inspection-sheet-meta"><div><strong>Employee</strong><span>Steven Leduc</span></div><div><strong>Date</strong><span>Aug 24, 2026</span></div></div><div class="inspection-sheet-table-wrap"><table><thead><tr><th>Item</th><th>Result</th></tr></thead><tbody><tr><td>Brakes and controls</td><td><span class="inspection-result-pill pass">Pass</span></td></tr></tbody></table></div></article>`;
  });

  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    bodyWidth: document.body.scrollWidth,
    tiles: Array.from(document.querySelectorAll(".admin-safety-record-tile")).every((tile) => tile.getBoundingClientRect().right <= document.documentElement.clientWidth + 1),
    sheet: (() => {
      const rect = document.querySelector(".inspection-sheet").getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    })()
  }));
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.tiles).toBe(true);
  expect(layout.sheet.left).toBeGreaterThanOrEqual(0);
  expect(layout.sheet.right).toBeLessThanOrEqual(layout.viewport + 1);
  await context.close();
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`Admin Safety Records tiles meet light-theme contrast on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
    await page.locator("html").evaluate((node) => node.setAttribute("data-jgc-theme", "light"));
    await page.locator("#safetyRecordsSection").evaluate((node) => node.removeAttribute("hidden"));

    const ratios = await page.locator(".admin-safety-record-tile").evaluateAll((tiles) => {
      function parseRgb(value) {
        return (String(value).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      }
      function luminance(rgb) {
        const values = rgb.map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
        });
        return (0.2126 * values[0]) + (0.7152 * values[1]) + (0.0722 * values[2]);
      }
      return tiles.flatMap((tile) => {
        const background = luminance(parseRgb(getComputedStyle(tile).backgroundColor));
        return Array.from(tile.querySelectorAll("strong, span")).map((label) => {
          const foreground = luminance(parseRgb(getComputedStyle(label).color));
          return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        });
      });
    });

    expect(ratios).toHaveLength(6);
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
    await context.close();
  });
}
