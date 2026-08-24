const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const portalRoot = path.resolve(__dirname, "..");

test("Accounts uses one token-only visual source", async () => {
  const html = fs.readFileSync(path.join(portalRoot, "accounts.html"), "utf8");
  const css = fs.readFileSync(path.join(portalRoot, "accounts-admin.css"), "utf8");
  const screenMarkup = html.split('<script src="vendor/supabase-js.min.js')[0];
  expect(html).not.toContain("styles.css");
  expect(html).toContain('jgc-design-system.css?v=7');
  expect(html).toContain('accounts-admin.css?v=1');
  expect(html).toMatch(/<body\b[^>]*\bjgc-page\b/i);
  expect(screenMarkup).not.toMatch(/<style\b/i);
  expect(screenMarkup).not.toMatch(/\sstyle\s*=/i);
  expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  expect(css).not.toMatch(/\bcolor:\s*(?:white|black)\b/i);
  expect(css).toContain("var(--jgc-color-");

  const worker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");
  expect(worker).toContain('"./accounts-admin.css?v=1"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`populated Accounts stays usable on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/accounts.html", { waitUntil: "domcontentloaded" });
    await page.locator("#accountsList").evaluate((list) => {
      list.innerHTML = `<div class="table-wrap jgc-table-wrap"><table class="accounts-table jgc-table"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Account Type</th><th>Digital PO</th><th>Created</th><th>Actions</th></tr></thead><tbody><tr><td>Darlene Test</td><td>darlene@example.com</td><td><span class="status approved jgc-badge jgc-badge--success">Approved</span></td><td>Admin</td><td><span class="status po-create-allowed jgc-badge jgc-badge--success">PO Allowed</span></td><td>Aug 24, 2026</td><td><div class="row-actions jgc-table-actions"><button class="secondary jgc-button jgc-button--secondary">Limited Access</button><button class="danger jgc-button jgc-button--danger">Deactivate</button></div></td></tr></tbody></table></div>`;
    });
    const layout = await page.evaluate(() => {
      const shell = document.querySelector(".accounts-shell").getBoundingClientRect();
      const tableWrap = document.querySelector(".table-wrap");
      const tabs = document.querySelector(".tabs");
      const visibleButtons = Array.from(document.querySelectorAll("button")).filter((button) => button.offsetParent !== null);
      return {
        viewport: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        shell: { left: shell.left, right: shell.right },
        tableOverflow: getComputedStyle(tableWrap).overflowX,
        tableScrollable: tableWrap.scrollWidth > tableWrap.clientWidth,
        tabsOverflow: getComputedStyle(tabs).overflowX,
        shortestButton: Math.min(...visibleButtons.map((button) => button.getBoundingClientRect().height)),
        controlsContained: visibleButtons.every((element) => {
          const rect = element.getBoundingClientRect();
          const scrollRegion = element.closest(".table-wrap, .tabs");
          const intentionallyScrollable = scrollRegion && ["auto", "scroll"].includes(getComputedStyle(scrollRegion).overflowX);
          return intentionallyScrollable || (rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1);
        })
      };
    });
    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.shell.left).toBeGreaterThanOrEqual(0);
    expect(layout.shell.right).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.controlsContained).toBe(true);
    expect(layout.shortestButton).toBeGreaterThanOrEqual(44);
    expect(["auto", "scroll"]).toContain(layout.tableOverflow);
    expect(["auto", "scroll"]).toContain(layout.tabsOverflow);
    if (viewport.name === "phone") expect(layout.tableScrollable).toBe(true);
    await context.close();
  });
}
