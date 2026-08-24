const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const portalRoot = path.resolve(__dirname, "..");
const pages = [
  { html: "employee-access-admin.html", css: "employee-access-admin.css", version: "3" },
  { html: "diagnostics-admin.html", css: "diagnostics-admin.css", version: "2" }
];

test("Employee Access and Diagnostics use direct token-only shared styling", async () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(portalRoot, page.html), "utf8");
    const css = fs.readFileSync(path.join(portalRoot, page.css), "utf8");
    expect(html).not.toContain("styles.css");
    expect(html).toContain('jgc-design-system.css?v=8');
    expect(html).toContain(`${page.css}?v=${page.version}`);
    expect(html).toMatch(/<body\b[^>]*\bjgc-page\b/i);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(css).toContain("var(--jgc-color-");
  }

  const worker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");
  expect(worker).toMatch(/const JGC_RELEASE_ID = "\d+"/);
  expect(worker).toContain('"./employee-access-admin.css?v=3"');
  expect(worker).toContain('"./diagnostics-admin.css?v=2"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`Employee Page Access stays contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/employee-access-admin.html", { waitUntil: "domcontentloaded" });
    await page.locator("#employeeAccessRows").evaluate((body) => {
      body.innerHTML = `<tr class="employee-access-row"><td><div class="employee-access-person"><strong>Steven Leduc</strong><small>steven@example.com</small></div></td>${Array.from({ length: 7 }, (_, index) => `<td><input class="employee-access-check" type="checkbox" aria-label="Access ${index + 1}"></td>`).join("")}</tr>`;
    });
    const layout = await page.evaluate(() => {
      const shell = document.querySelector(".jgc-page-shell").getBoundingClientRect();
      const wrap = document.querySelector(".employee-access-table-wrap");
      return {
        viewport: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        shell: { left: shell.left, right: shell.right },
        tableOverflow: getComputedStyle(wrap).overflowX
      };
    });
    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.shell.left).toBeGreaterThanOrEqual(0);
    expect(layout.shell.right).toBeLessThanOrEqual(layout.viewport + 1);
    if (viewport.name === "phone") expect(["auto", "scroll"]).toContain(layout.tableOverflow);
    await context.close();
  });

  test(`Portal Diagnostics stays contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/diagnostics-admin.html", { waitUntil: "domcontentloaded" });
    await page.locator("#diagnosticsSummary").evaluate((summary) => {
      summary.innerHTML = `<article class="diagnostics-metric error"><strong>1</strong><span>Open issue</span></article><article class="diagnostics-metric"><strong>24</strong><span>Recent saves</span></article>`;
    });
    await page.locator("#diagnosticsBody").evaluate((body) => {
      body.innerHTML = `<tr class="is-error"><td data-label="When">Aug 24, 2026</td><td data-label="Category"><span class="diagnostics-category">Admin</span></td><td data-label="Event"><div class="diagnostics-event-title">Admin data could not load: jobs</div><details class="diagnostics-details"><summary>Details</summary><pre>TypeError: Load failed</pre></details></td><td data-label="Employee / Source">Zeth Hummel</td><td data-label="Status"><span class="diagnostics-badge error">Open</span></td><td data-label="Actions"><div class="diagnostics-actions"><button class="jgc-button">Resolve</button></div></td></tr>`;
    });
    const layout = await page.evaluate(() => {
      const shell = document.querySelector(".diagnostics-shell").getBoundingClientRect();
      const row = document.querySelector(".diagnostics-table tbody tr");
      return {
        viewport: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        shell: { left: shell.left, right: shell.right },
        rowDisplay: getComputedStyle(row).display,
        tabsOverflow: getComputedStyle(document.querySelector(".diagnostics-tabs")).overflowX,
        overflowingControls: Array.from(document.querySelectorAll("input, select, button, a")).flatMap((element) => {
          const rect = element.getBoundingClientRect();
          const scrollRegion = element.closest(".diagnostics-tabs");
          const intentionallyScrollable = scrollRegion && ["auto", "scroll"].includes(getComputedStyle(scrollRegion).overflowX);
          return rect.width === 0 || intentionallyScrollable || (rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1)
            ? []
            : [{ tag: element.tagName, id: element.id, className: element.className, left: rect.left, right: rect.right, width: rect.width }];
        })
      };
    });
    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.shell.left).toBeGreaterThanOrEqual(0);
    expect(layout.shell.right).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.overflowingControls).toEqual([]);
    if (viewport.name === "phone") {
      expect(layout.rowDisplay).toBe("block");
      expect(["auto", "scroll"]).toContain(layout.tabsOverflow);
    }
    await context.close();
  });
}
