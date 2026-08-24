const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const portalRoot = path.resolve(__dirname, "..");

test("Safety Acknowledgement uses one token-only visual source", async () => {
  const html = fs.readFileSync(path.join(portalRoot, "acknowledge.html"), "utf8");
  const css = fs.readFileSync(path.join(portalRoot, "acknowledgement-design-system.css"), "utf8");
  const screenMarkup = html.split('<script src="vendor/supabase-js.min.js')[0];
  expect(html).not.toContain("styles.css");
  expect(html).toContain('jgc-design-system.css?v=8');
  expect(html).toContain('acknowledgement-design-system.css?v=2');
  expect(html).toMatch(/<body\b[^>]*\bjgc-page\b/i);
  expect(screenMarkup).not.toMatch(/<style\b/i);
  expect(screenMarkup).not.toMatch(/\sstyle\s*=/i);
  expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  expect(css).not.toMatch(/\bcolor:\s*(?:white|black)\b/i);
  expect(css).toContain("var(--jgc-color-");

  const worker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");
  expect(worker).toContain('"./acknowledgement-design-system.css?v=2"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`populated Safety Acknowledgement stays usable on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/acknowledge.html", { waitUntil: "domcontentloaded" });
    await page.locator("#ackForm").evaluate((form) => form.classList.remove("hidden"));
    await page.locator("#recordMeta").evaluate((meta) => {
      meta.innerHTML = `<div class="meta-item jgc-card"><span class="meta-label">Record</span><span class="meta-value">JSA</span></div><div class="meta-item jgc-card"><span class="meta-label">Title</span><span class="meta-value">Shop equipment operation</span></div><div class="meta-item jgc-card"><span class="meta-label">Date</span><span class="meta-value">Aug 24, 2026</span></div><div class="meta-item jgc-card"><span class="meta-label">Project</span><span class="meta-value">26074 - Shop JGC</span></div>`;
    });
    await page.locator("#attendeeSelect").evaluate((select) => {
      select.innerHTML = '<option>Steven Leduc</option><option>I am not listed</option>';
    });
    const layout = await page.evaluate(() => {
      const shell = document.querySelector(".acknowledgement-shell").getBoundingClientRect();
      const controls = Array.from(document.querySelectorAll("input, select, textarea, button")).filter((element) => element.offsetParent !== null);
      return {
        viewport: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        shell: { left: shell.left, right: shell.right },
        controlsContained: controls.every((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= shell.left - 1 && rect.right <= shell.right + 1;
        }),
        submitHeight: document.querySelector("#submitButton").getBoundingClientRect().height,
        inputColor: getComputedStyle(document.querySelector("#companyName")).color,
        inputBackground: getComputedStyle(document.querySelector("#companyName")).backgroundColor
      };
    });
    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.shell.left).toBeGreaterThanOrEqual(0);
    expect(layout.shell.right).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.controlsContained).toBe(true);
    expect(layout.submitHeight).toBeGreaterThanOrEqual(44);
    expect(layout.inputColor).toBe("rgb(16, 32, 24)");
    expect(layout.inputBackground).toBe("rgb(247, 250, 246)");
    await context.close();
  });
}
