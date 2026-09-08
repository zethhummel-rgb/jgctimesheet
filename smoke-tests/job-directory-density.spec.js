const { test, expect } = require('@playwright/test');
const { directoryState, serveDirectory, fixtureDate } = require('./fixtures/job-readability-fixture');

// Measured against release 864 with the same fixture, import date and viewport.
const previousHeights = { 320: 884.75, 390: 876.890625, 768: 567.375, 1366: 496.59375, 1600: 476.296875 };
for (const width of [320, 390, 768, 1366, 1600]) test(`job directory controls stay compact and readable at ${width}px`, async ({ page }, testInfo) => {
  const state = directoryState();
  state.jobs.forEach(job => { job.lastImportedAt = fixtureDate; });
  const captures = await serveDirectory(page, state);
  await page.setViewportSize({ width, height: 1000 });
  if (width <= 1020) await expect(page.locator('.sidebar')).not.toBeInViewport();
  const size = await page.evaluate(() => {
    const first = document.querySelector('.job-directory-controls') || document.querySelector('.job-directory-page > .job-costing-connection');
    const last = document.querySelector('.job-directory-toolbar');
    return { height: last.getBoundingClientRect().bottom - first.getBoundingClientRect().top, viewport: innerWidth, scroll: document.documentElement.scrollWidth };
  });
  expect(size.scroll).toBeLessThanOrEqual(size.viewport + 1);
  expect(size.height).toBeLessThanOrEqual(previousHeights[width] * 0.5);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.applyJgcTheme(theme), theme);
    const readable = await page.locator('.job-directory-controls').evaluate(root => {
      const luminance = rgb => rgb.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
      const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
      return [...root.querySelectorAll('summary, .job-last-import, .job-kpi-grid span, .job-kpi-grid strong, .job-kpi-grid small, .compact-select span')].filter(el => el.checkVisibility()).map(el => {
        let bg = [255, 255, 255];
        for (let parent = el; parent; parent = parent.parentElement) { const color = rgb(getComputedStyle(parent).backgroundColor); if (color.length === 3 || color[3] > .99) { bg = color; break; } }
        const fg = luminance(rgb(getComputedStyle(el).color)), background = luminance(bg);
        return { contrast: (Math.max(fg, background) + .05) / (Math.min(fg, background) + .05), fontSize: parseFloat(getComputedStyle(el).fontSize) };
      });
    });
    readable.forEach(item => { expect(item.contrast).toBeGreaterThanOrEqual(4.5); expect(item.fontSize).toBeGreaterThanOrEqual(11); });
    if (process.env.JGC_CAPTURE_VISUAL_QA) await page.locator('.job-directory-page').screenshot({ path: testInfo.outputPath(`jobs-${width}-${theme}.png`) });
  }
  const upload = page.locator('.job-import-disclosure'), download = page.locator('.job-accounting-disclosure');
  await expect(upload).not.toHaveAttribute('open'); await expect(download).not.toHaveAttribute('open');
  const boxes = await page.locator('.job-directory-file-tools > details').evaluateAll(items => items.map(el => el.getBoundingClientRect().top));
  expect(boxes[0]).toBe(boxes[1]);
  for (const panel of [upload, download]) {
    await panel.locator(':scope > summary').click();
    expect((await panel.boundingBox()).width).toBeCloseTo((await page.locator('.job-directory-file-tools').boundingBox()).width, 0);
    await expect(panel.locator(panel === upload ? 'input[type="file"]' : '.job-accounting-body')).toBeVisible();
    await panel.locator(':scope > summary').click();
  }
  const about = page.locator('.job-directory-info');
  await about.locator('summary').click(); await expect(about.locator('p')).toContainText('timesheets, POs, Work Orders');
  await about.locator('summary').click();
  if (width <= 760) {
    const targets = await page.locator('.job-directory-controls').evaluate(root => [...root.querySelectorAll('button, input, select, summary')].filter(el => el.checkVisibility()).map(el => el.getBoundingClientRect().height));
    targets.forEach(height => expect(height).toBeGreaterThanOrEqual(44));
  } else {
    const cell = page.locator('.jobs-table tbody tr').first().locator('td').nth(2);
    expect((await cell.boundingBox()).width).toBeGreaterThan(100);
    expect((await page.locator('.jobs-table tbody tr').first().boundingBox()).height).toBeLessThan(150);
  }
  await page.getByLabel('Search jobs', { exact: true }).fill('25904');
  await expect(page.locator('.jobs-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.jobs-table tbody tr')).toContainText('Historical Imported Repair');
  await page.getByLabel('Search jobs', { exact: true }).fill('');
  await expect(page.locator('.jobs-table tbody tr')).toHaveCount(3);
  expect(captures.jobInfo).toEqual([]);
});
