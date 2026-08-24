const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const portalRoot = path.resolve(__dirname, "..");

test("Limited Access uses one token-only visual source", async () => {
  const html = fs.readFileSync(path.join(portalRoot, "limited-access.html"), "utf8");
  const css = fs.readFileSync(path.join(portalRoot, "limited-access.css"), "utf8");
  const screenMarkup = html.split('<script src="vendor/supabase-js.min.js')[0];
  expect(html).not.toContain("styles.css");
  expect(html).toContain('jgc-design-system.css?v=8');
  expect(html).toContain('limited-access.css?v=1');
  expect(html).toMatch(/<body\b[^>]*\bjgc-page\b/i);
  expect(screenMarkup).not.toMatch(/<style\b/i);
  expect(screenMarkup).not.toMatch(/\sstyle\s*=/i);
  expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  expect(css).toContain("var(--jgc-color-");

  const worker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");
  expect(worker).toMatch(/const JGC_RELEASE_ID = "\d+"/);
  expect(worker).toContain('"./limited-access.css?v=1"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`populated Limited Access stays readable and contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/limited-access.html", { waitUntil: "domcontentloaded" });
    await page.locator("#certificatesPanel").evaluate((panel) => panel.classList.add("active"));
    await page.locator("#certificatesContent").evaluate((content) => {
      content.className = "limited-list";
      content.innerHTML = `<article class="limited-record"><div class="limited-record-head"><h3>Working at Heights</h3><span class="limited-badge">Valid</span></div><div class="limited-record-meta"><div class="limited-meta-item"><strong>Expiry</strong>Mar 16, 2029</div><div class="limited-meta-item"><strong>File</strong>certificate.pdf</div><div class="limited-meta-item"><strong>Notes</strong>Current training record</div></div><div class="limited-actions"><button class="limited-button jgc-button">Open Certificate</button></div></article>`;
    });
    const layout = await page.evaluate(() => {
      const shell = document.querySelector(".limited-shell").getBoundingClientRect();
      return {
        viewport: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        shell: { left: shell.left, right: shell.right },
        controlsContained: Array.from(document.querySelectorAll("button, a")).every((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width === 0 || (rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1);
        })
      };
    });
    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.shell.left).toBeGreaterThanOrEqual(0);
    expect(layout.shell.right).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.controlsContained).toBe(true);
    await context.close();
  });
}

test("Limited Access details modal remains contained on phones", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/limited-access.html", { waitUntil: "domcontentloaded" });
  await page.locator("#limitedModal").evaluate((modal) => modal.removeAttribute("hidden"));
  await page.locator("#limitedModalContent").evaluate((list) => {
    list.innerHTML = `<div><dt>Report</dt><dd>A detailed record with a long project description that must wrap safely on a phone.</dd></div><div><dt>Date</dt><dd>Aug 24, 2026</dd></div>`;
  });
  const rect = await page.locator(".limited-modal-card").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { viewport: document.documentElement.clientWidth, left: box.left, right: box.right };
  });
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.right).toBeLessThanOrEqual(rect.viewport + 1);
  await context.close();
});
