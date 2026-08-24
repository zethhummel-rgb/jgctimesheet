const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const portalRoot = path.resolve(__dirname, "..");

test("Notification Settings uses one token-only visual source", async () => {
  const html = fs.readFileSync(path.join(portalRoot, "notification-settings.html"), "utf8");
  const css = fs.readFileSync(path.join(portalRoot, "notification-settings-design-system.css"), "utf8");
  const screenMarkup = html.split('<script src="vendor/supabase-js.min.js')[0];
  expect(html).not.toContain("styles.css");
  expect(html).toContain('jgc-design-system.css?v=7');
  expect(html).toContain('notification-settings-design-system.css?v=2');
  expect(html).toMatch(/<body\b[^>]*\bjgc-page\b/i);
  expect(screenMarkup).not.toMatch(/<style\b/i);
  expect(screenMarkup).not.toMatch(/\sstyle\s*=/i);
  expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  expect(css).toContain("var(--jgc-color-");

  const worker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");
  expect(worker).toContain('"./notification-settings-design-system.css?v=2"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`populated Notification Settings stays usable on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/notification-settings.html", { waitUntil: "domcontentloaded" });
    await page.locator("#settingsList").evaluate((list) => {
      list.innerHTML = `<div class="table-wrap jgc-table-wrap"><table class="jgc-table"><thead><tr><th>Notification</th><th>Description</th><th>Employees</th><th>Supervisors</th><th>Admins</th></tr></thead><tbody><tr><td><strong>Timesheet submitted</strong><br><span class="small">timesheet_submitted</span></td><td>Created when an employee submits a weekly timesheet.</td><td class="switch-cell"><input type="checkbox" checked aria-label="Employees receive timesheet submitted"></td><td class="switch-cell"><input type="checkbox" checked aria-label="Supervisors receive timesheet submitted"></td><td class="switch-cell"><input type="checkbox" checked aria-label="Admins receive timesheet submitted"></td></tr></tbody></table></div>`;
    });
    const layout = await page.evaluate(() => {
      const shell = document.querySelector(".notification-settings-shell").getBoundingClientRect();
      const tableWrap = document.querySelector(".table-wrap");
      const tabs = document.querySelector(".tabs");
      return {
        viewport: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        shell: { left: shell.left, right: shell.right },
        tableOverflow: getComputedStyle(tableWrap).overflowX,
        tableScrollable: tableWrap.scrollWidth > tableWrap.clientWidth,
        tabsOverflow: getComputedStyle(tabs).overflowX,
        controlsContained: Array.from(document.querySelectorAll("input, textarea, button, a")).every((element) => {
          const rect = element.getBoundingClientRect();
          const scrollRegion = element.closest(".table-wrap, .tabs");
          const intentionallyScrollable = scrollRegion && ["auto", "scroll"].includes(getComputedStyle(scrollRegion).overflowX);
          return rect.width === 0 || intentionallyScrollable || (rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1);
        })
      };
    });
    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.shell.left).toBeGreaterThanOrEqual(0);
    expect(layout.shell.right).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.controlsContained).toBe(true);
    expect(["auto", "scroll"]).toContain(layout.tableOverflow);
    expect(["auto", "scroll"]).toContain(layout.tabsOverflow);
    if (viewport.name === "phone") expect(layout.tableScrollable).toBe(true);
    await context.close();
  });
}
