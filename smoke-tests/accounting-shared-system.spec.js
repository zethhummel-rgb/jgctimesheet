const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const portalRoot = path.resolve(__dirname, "..");

test("Accounting Admin uses one token-only visual source", async () => {
  const html = fs.readFileSync(path.join(portalRoot, "accounting-admin.html"), "utf8");
  const css = fs.readFileSync(path.join(portalRoot, "accounting-admin.css"), "utf8");
  const script = fs.readFileSync(path.join(portalRoot, "accounting-admin.js"), "utf8");
  const worker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");
  const screenMarkup = html.split('<script src="vendor/supabase-js.min.js')[0];

  expect(html).not.toContain("styles.css");
  expect(html).toContain('jgc-design-system.css?v=8');
  expect(html).toContain('accounting-admin.css?v=6');
  expect(html).toContain('accounting-admin.js?v=10');
  expect(html).toMatch(/<body\b[^>]*\bjgc-page\b[^>]*\bjgc-system-page\b/i);
  expect(html).toMatch(/<h1\b[^>]*\bjgc-page-title\b[^>]*>Accounting<\/h1>/i);
  expect(html).toMatch(/id="accountingCurrentUser"[^>]*\bjgc-page-user\b/i);
  expect(screenMarkup).not.toMatch(/<style\b/i);
  expect(screenMarkup).not.toMatch(/\sstyle\s*=/i);
  expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  expect(css).toContain("var(--jgc-color-");
  expect(script).not.toMatch(/\.style\.(?:background|backgroundColor|color|border|display|padding|margin)/);
  expect(script).toContain('accounting-table-wrap jgc-table-wrap');
  expect(script).toContain('accounting-table jgc-table');
  expect(script).toContain('accounting-empty jgc-empty-state');
  expect(worker).toContain('const JGC_RELEASE_ID = "803"');
  expect(worker).toContain('"./accounting-admin.css?v=6"');
  expect(worker).toContain('"./accounting-admin.js?v=10"');
});

function populatedAccountingMarkup() {
  return {
    metrics: `
      <div class="accounting-metric jgc-card"><strong>5</strong><span>Employees Submitted</span></div>
      <div class="accounting-metric jgc-card"><strong>10</strong><span>Weekly Submissions</span></div>
      <div class="accounting-metric jgc-card"><strong>384.50</strong><span>Work Hours</span></div>
      <div class="accounting-metric jgc-card"><strong>3</strong><span>Leave Markers</span></div>
      <div class="accounting-metric jgc-card"><strong>1</strong><span>Job Exceptions</span></div>`,
    validation: `<div class="accounting-validation-card jgc-notice jgc-notice--warning warning"><strong>1 expected submission missing</strong>Review the employee before locking the period.</div>`,
    review: `<details class="accounting-employee-group" open>
      <summary><span>Steven Leduc</span><span class="accounting-employee-summary"><span class="jgc-badge jgc-badge--info">2/2 weeks</span><span class="jgc-badge jgc-badge--success">80.00 hrs</span></span></summary>
      <div class="accounting-employee-content"><div class="accounting-table-wrap jgc-table-wrap"><table class="accounting-table jgc-table"><thead><tr><th>Date</th><th>Job / Leave</th><th>Shift</th><th>Hours</th><th>Match</th></tr></thead><tbody><tr><td>Aug 18, 2026<br><small>Tuesday</small></td><td>26074 - Shop JGC</td><td>Day</td><td class="accounting-number">8.00</td><td>Exact</td></tr></tbody></table></div></div>
    </details>`,
    jobs: `<div class="accounting-table-wrap jgc-table-wrap"><table class="accounting-table jgc-table"><thead><tr><th>Employee</th><th>Date</th><th>Submitted Job</th><th>Hours</th><th>Accounting Match</th></tr></thead><tbody><tr><td>Steven Leduc</td><td>Aug 18, 2026</td><td>Shop JGC</td><td class="accounting-number">8.00</td><td><div class="accounting-job-controls"><input class="jgc-input" value="26074 - Shop JGC"><button class="jgc-button" type="button">Apply</button></div></td></tr></tbody></table></div>`,
    rates: `<div class="accounting-table-wrap jgc-table-wrap"><div class="accounting-rate-form"><div class="accounting-rate-name"><strong>Steven Leduc</strong><small>Worker · Current $27.00</small></div><div class="jgc-field"><label class="jgc-label">Pay Type</label><select class="jgc-select"><option>Hourly</option></select></div><div class="jgc-field"><label class="jgc-label">Regular Rate</label><input class="jgc-input" value="27.00"></div><div class="jgc-field"><label class="jgc-label">OT Multiplier</label><input class="jgc-input" value="1.5"></div><div class="jgc-field"><label class="jgc-label">Effective Date</label><input class="jgc-input" type="date" value="2026-07-19"></div><div class="jgc-actions"><button class="jgc-button" type="button">Add Rate</button></div></div></div>`,
    history: `<div class="accounting-table-wrap jgc-table-wrap"><table class="accounting-table jgc-table"><thead><tr><th>Activity</th><th>Type</th><th>File</th><th>Checksum</th><th>Action</th></tr></thead><tbody><tr><td><strong>Generated</strong><br>Aug 20, 2026</td><td><span class="jgc-badge jgc-badge--info">Draft</span></td><td>JGC Payroll.xlsx</td><td><code>abcdef123456...</code></td><td><button class="jgc-button jgc-button--secondary" type="button">Download Exact File</button></td></tr></tbody></table></div>`
  };
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`populated Accounting Admin stays readable on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/accounting-admin.html", { waitUntil: "domcontentloaded" });
    const markup = populatedAccountingMarkup();
    await page.evaluate((content) => {
      document.body.classList.add("jgc-app", "jgc-admin-page");
      document.querySelector("#accountingPage").hidden = false;
      document.querySelector("#accountingMetrics").innerHTML = content.metrics;
      document.querySelector("#accountingValidation").innerHTML = content.validation;
      document.querySelector("#accountingEmployeeReview").innerHTML = content.review;
      document.querySelector("#accountingJobExceptions").innerHTML = content.jobs;
      document.querySelector("#accountingRatesPanel").open = true;
      document.querySelector("#accountingRates").innerHTML = content.rates;
      document.querySelector("#accountingTemplateStatus").innerHTML = "<strong>Approved template ready</strong><br>JGC Payroll Template.xlsx";
      document.querySelector("#accountingExportHistory").innerHTML = content.history;
    }, markup);

    const layout = await page.evaluate(() => {
      function rgb(value) {
        const match = String(value).match(/[\d.]+/g) || [];
        return match.slice(0, 3).map(Number);
      }
      function luminance(value) {
        return rgb(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
        }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      }
      function contrast(element) {
        const style = getComputedStyle(element);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      }
      const shell = document.querySelector(".accounting-shell").getBoundingClientRect();
      const panel = document.querySelector(".accounting-panel");
      const table = document.querySelector(".accounting-table");
      const tableWrap = document.querySelector(".accounting-table-wrap");
      const tableHeader = table.querySelector("th");
      const tableCell = table.querySelector("td");
      const primaryButton = document.querySelector(".jgc-button:not(.jgc-button--secondary)");
      const warning = document.querySelector(".accounting-validation-card.warning");
      return {
        viewport: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        shellLeft: shell.left,
        shellRight: shell.right,
        panelBackground: getComputedStyle(panel).backgroundColor,
        panelContrast: contrast(panel),
        tableOverflow: tableWrap.scrollWidth > tableWrap.clientWidth,
        tableHeaderContrast: contrast(tableHeader),
        tableCellContrast: contrast(tableCell),
        buttonContrast: contrast(primaryButton),
        warningContrast: contrast(warning),
        inputFontSize: parseFloat(getComputedStyle(document.querySelector(".jgc-input")).fontSize)
      };
    });

    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.shellLeft).toBeGreaterThanOrEqual(0);
    expect(layout.shellRight).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.panelBackground).not.toBe("rgb(255, 255, 255)");
    expect(layout.panelContrast).toBeGreaterThanOrEqual(4.5);
    expect(layout.tableHeaderContrast).toBeGreaterThanOrEqual(4.5);
    expect(layout.tableCellContrast).toBeGreaterThanOrEqual(4.5);
    expect(layout.buttonContrast).toBeGreaterThanOrEqual(4.5);
    expect(layout.warningContrast).toBeGreaterThanOrEqual(4.5);
    if (viewport.name === "phone") {
      expect(layout.tableOverflow).toBe(true);
      expect(layout.inputFontSize).toBeGreaterThanOrEqual(16);
    }
    await context.close();
  });
}
