const { test, expect } = require('@playwright/test');
const { directoryState, serveDirectory } = require('./fixtures/job-readability-fixture');

// Release 870 measured 85px at 1600px and 87.390625px at 768/1366px
// with this same fixture. Narrower columns may still grow to fit wrapped text.
for (const width of [768, 1366, 1600]) test(`desktop job rows preserve readable text and compact actions at ${width}px`, async ({ page }, testInfo) => {
  const captures = await serveDirectory(page, directoryState());
  await page.setViewportSize({ width, height: 1000 });
  const rows = page.locator('.jobs-table tbody tr');
  await expect(rows).toHaveCount(3);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.applyJgcTheme(theme), theme);
    for (const row of await rows.all()) {
      const height = (await row.boundingBox()).height;
      expect(height).toBeLessThanOrEqual(width >= 1600 ? 51 : 60);
      expect(height).toBeGreaterThanOrEqual(51);
      const actions = row.locator('.job-status-action');
      await expect(actions).toHaveText(['Close Project', 'Cancel Job']);
      const boxes = await actions.evaluateAll(items => items.map(el => ({top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, height: el.getBoundingClientRect().height})));
      expect(boxes[0].height).toBe(24);
      expect(boxes[1].height).toBe(24);
      expect(boxes[1].top - boxes[0].bottom).toBe(2);
      const text = await row.locator('strong, small, button').evaluateAll(items => items.filter(el => el.checkVisibility()).map(el => ({
        size: parseFloat(getComputedStyle(el).fontSize), expectedSize: el.matches('small, .job-status-action') ? 12 : 14,
        top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom,
        rowTop: el.closest('tr').getBoundingClientRect().top, rowBottom: el.closest('tr').getBoundingClientRect().bottom,
        clipped: el.scrollHeight > el.clientHeight + 1,
      })));
      for (const item of text) {
        expect(item.size).toBe(item.expectedSize);
        expect(item.top).toBeGreaterThanOrEqual(item.rowTop);
        expect(item.bottom).toBeLessThanOrEqual(item.rowBottom);
        expect(item.clipped).toBe(false);
      }
    }
    if (process.env.JGC_CAPTURE_VISUAL_QA) await page.locator('.jobs-table').screenshot({ path: testInfo.outputPath(`rows-${width}-${theme}.png`) });
  }
  await page.getByLabel('Search jobs', { exact: true }).fill('25904');
  await expect(rows).toHaveCount(1);
  expect((await rows.first().boundingBox()).height).toBeGreaterThanOrEqual(51);
  await expect(rows.locator('.job-status-action')).toHaveText(['Make active', 'Cancel Job']);
  const open = rows.getByRole('button', { name: '25904', exact: true });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.job-detail-page')).toContainText('JOB 25904');
  expect(captures.jobInfo).toEqual([]);
});

test('compact job rows grow for long names without clipping content', async ({ page }, testInfo) => {
  const state = directoryState();
  const job = state.jobs.find(item => item.jobNumber === '26903');
  job.portalCustomer = 'Synthetic Regional Property Management and Building Maintenance Client';
  job.portalJobName = 'Synthetic multi-phase building envelope rehabilitation including entrance accessibility upgrades and mechanical room improvements';
  job.project = 'Accepted project description kept visible below the official job name';
  await serveDirectory(page, state);
  await page.setViewportSize({ width: 1024, height: 1000 });
  const row = page.locator('.jobs-table tbody tr').filter({ hasText: '26903' });
  expect((await row.boundingBox()).height).toBeGreaterThan(51);
  const text = row.locator('[data-label="Job name"] strong');
  await expect(text).toHaveText(job.portalJobName);
  expect(await text.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  const details = await row.locator('td > strong, td > small, .job-status-action').evaluateAll(items => items.map(el => ({top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, rowTop: el.closest('tr').getBoundingClientRect().top, rowBottom: el.closest('tr').getBoundingClientRect().bottom})));
  for (const item of details) {
    expect(item.top).toBeGreaterThanOrEqual(item.rowTop);
    expect(item.bottom).toBeLessThanOrEqual(item.rowBottom);
  }
  if (process.env.JGC_CAPTURE_VISUAL_QA) await page.locator('.jobs-table').screenshot({ path: testInfo.outputPath('wrapped-job-rows.png') });
});

test('desktop density does not shrink mobile job rows or job-opening targets', async ({ page }) => {
  await serveDirectory(page, directoryState());
  await page.setViewportSize({ width: 390, height: 1000 });
  for (const row of await page.locator('.jobs-table tbody tr').all()) {
    // Same 390px fixture measured before the desktop-only spacing change.
    expect((await row.boundingBox()).height).toBeCloseTo(101.203125, 1);
    expect((await row.locator('.back-button').boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await row.locator('.job-status-actions').evaluate(el => getComputedStyle(el).gap)).toBe('8px');
  }
});
