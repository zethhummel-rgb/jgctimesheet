const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const portalRoot = path.resolve(__dirname, "..");
const reportForms = [
  { file: "daily-site-report.html", css: "daily-site-report.css" },
  { file: "jsa.html", css: "jsa-report.css" },
  { file: "toolbox-talks.html", css: "toolbox-talks-report.css" },
  { file: "incident-report.html", css: "incident-report.css" },
  { file: "accident-report.html", css: "accident-report.css" },
  { file: "employee-injury-report.html", css: "employee-injury-report.css" }
];

test("Reports forms and embedded Admin Reports use centralized token-only styling", async () => {
  const sharedCss = fs.readFileSync(path.join(portalRoot, "report-design-system.css"), "utf8");
  expect(sharedCss).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);

  for (const report of reportForms) {
    const source = fs.readFileSync(path.join(portalRoot, report.file), "utf8");
    const screenMarkup = source.split("<script src=")[0];
    const featureCss = fs.readFileSync(path.join(portalRoot, report.css), "utf8");
    expect(source).not.toContain("styles.css");
    expect(source).toContain('jgc-design-system.css?v=7');
    expect(source).toContain('report-design-system.css?v=2');
    expect(source).toContain(`${report.css}?v=1`);
    expect(source).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
    expect(screenMarkup).not.toMatch(/<style\b/i);
    expect(screenMarkup).not.toMatch(/\sstyle\s*=/i);
    expect(featureCss).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(featureCss).toContain("var(--jgc-color-");
  }

  const adminSource = fs.readFileSync(path.join(portalRoot, "admin.html"), "utf8");
  const adminCss = fs.readFileSync(path.join(portalRoot, "admin.css"), "utf8");
  const reportsAdminCss = fs.readFileSync(path.join(portalRoot, "reports-admin.css"), "utf8");
  expect(adminSource).toContain('report-design-system.css?v=2');
  expect(adminSource).toContain('reports-admin.css?v=1');
  expect(adminSource).toContain('admin.css?v=16');
  expect(adminCss).not.toMatch(/\.admin-report|\.admin-jsa-report/);
  expect(reportsAdminCss).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);

  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");
  for (const asset of ["report-design-system.css?v=2", ...reportForms.map((report) => `${report.css}?v=1`), "reports-admin.css?v=1", "admin.css?v=16"]) {
    expect(serviceWorker).toContain(`"./${asset}"`);
  }
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  for (const file of ["reports.html", ...reportForms.map((report) => report.file)]) {
    test(`${file} stays readable and contained on ${viewport.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport, javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(`/${file}`, { waitUntil: "domcontentloaded" });
      const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        shell: (() => {
          const element = document.querySelector(".report-page-shell");
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        })(),
        overflowingControls: Array.from(document.querySelectorAll("input, select, textarea, button, a")).flatMap((element) => {
          const rect = element.getBoundingClientRect();
          const scrollRegion = element.closest(".table-wrap");
          const intentionallyScrollable = scrollRegion && ["auto", "scroll"].includes(getComputedStyle(scrollRegion).overflowX);
          return rect.width === 0 || intentionallyScrollable || (rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1)
            ? []
            : [{ tag: element.tagName, id: element.id, className: element.className, left: rect.left, right: rect.right, width: rect.width }];
        })
      }));
      expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
      expect(layout.shell.left).toBeGreaterThanOrEqual(0);
      expect(layout.shell.right).toBeLessThanOrEqual(layout.viewport + 1);
      expect(layout.overflowingControls).toEqual([]);
      await context.close();
    });
  }
}

test("embedded Admin Reports tabs and JSA details stay usable on phones", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.locator("#reportsSection, #adminReportPanelJsa, #adminJsaReportViewPanel").evaluateAll((nodes) => nodes.forEach((node) => node.removeAttribute("hidden")));
  await page.locator("#adminJsaReportViewPanel").evaluate((node) => {
    node.innerHTML = `<div class="admin-jsa-report-header"><h3>Job Safety Analysis</h3><div class="jgc-actions"><button class="jgc-button">PDF</button></div></div><div class="admin-jsa-report-meta"><div><strong>Job</strong><span>26074 - Shop JGC</span></div><div><strong>Employee</strong><span>Steven Leduc</span></div></div>`;
  });
  const layout = await page.evaluate(() => {
    const tabs = document.querySelector(".admin-report-tabs");
    const report = document.querySelector(".admin-jsa-report-view").getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth,
      bodyWidth: document.body.scrollWidth,
      tabsScrollable: getComputedStyle(tabs).overflowX === "auto",
      report: { left: report.left, right: report.right }
    };
  });
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.tabsScrollable).toBe(true);
  expect(layout.report.left).toBeGreaterThanOrEqual(0);
  expect(layout.report.right).toBeLessThanOrEqual(layout.viewport + 1);
  await context.close();
});
