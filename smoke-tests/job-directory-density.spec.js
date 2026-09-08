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
  await expect(page.locator('.job-directory-page > .page-heading')).toHaveText('Jobs');
  await expect(page.locator('.job-directory-page .job-kpi-grid > div')).toHaveCount(2);
  await expect(page.locator('.job-directory-page .job-kpi-grid > div > span')).toHaveText(['Active jobs', 'Inactive jobs']);
  const refresh = page.locator('.topbar-actions').getByRole('button', { name: 'Refresh jobs', exact: true });
  await expect(refresh).toBeVisible();
  await expect(page.locator('.portal-return-button + .job-directory-refresh-slot')).toHaveCount(1);
  expect((await refresh.boundingBox()).y).toBeCloseTo((await page.locator('.portal-return-button').boundingBox()).y, 0);
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
    if (process.env.JGC_CAPTURE_VISUAL_QA) {
      await page.locator('.topbar').screenshot({ path: testInfo.outputPath(`topbar-${width}-${theme}.png`) });
      await page.locator('.job-directory-page').screenshot({ path: testInfo.outputPath(`jobs-${width}-${theme}.png`) });
    }
  }
  const upload = page.locator('.job-import-disclosure'), download = page.locator('.job-accounting-disclosure');
  await expect(upload).not.toHaveAttribute('open'); await expect(download).not.toHaveAttribute('open');
  await expect(page.getByTestId('job-last-import')).toBeHidden();
  await expect(upload.getByTestId('job-last-import')).toHaveCount(1);
  const boxes = await page.locator('.job-directory-file-tools > details').evaluateAll(items => items.map(el => el.getBoundingClientRect().top));
  expect(boxes[0]).toBe(boxes[1]);
  for (const panel of [upload, download]) {
    await panel.locator(':scope > summary').click();
    expect((await panel.boundingBox()).width).toBeCloseTo((await page.locator('.job-directory-file-tools').boundingBox()).width, 0);
    await expect(panel.locator(panel === upload ? 'input[type="file"]' : '.job-accounting-body')).toBeVisible();
    if (panel === upload) {
      await expect(upload.getByTestId('job-last-import')).toBeVisible();
      await expect(upload.getByTestId('job-last-import')).toContainText('Last import date:');
      if (process.env.JGC_CAPTURE_VISUAL_QA) await upload.screenshot({ path: testInfo.outputPath(`upload-${width}.png`) });
    }
    await panel.locator(':scope > summary').click();
  }
  await expect(page.locator('.job-directory-info')).toHaveCount(0);
  await expect(page.getByText('One shared job list', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('job-last-import')).toBeHidden();
  await expect(refresh).toBeVisible();
  if (width <= 760) {
    expect((await refresh.boundingBox()).height).toBeGreaterThanOrEqual(44);
    const targets = await page.locator('.job-directory-controls').evaluate(root => [...root.querySelectorAll('button, input, select, summary')].filter(el => el.checkVisibility()).map(el => el.getBoundingClientRect().height));
    targets.forEach(height => expect(height).toBeGreaterThanOrEqual(44));
  } else {
    const cell = page.locator('.jobs-table tbody tr').first().locator('td[data-label="Client / location"]');
    expect((await cell.boundingBox()).width).toBeGreaterThan(100);
    expect((await page.locator('.jobs-table tbody tr').first().boundingBox()).height).toBeLessThan(150);
    for (const row of await page.locator('.jobs-table tbody tr').all()) {
      const client = await row.locator('[data-label="Client / location"]').boundingBox();
      const job = await row.locator('[data-label="Job name"]').boundingBox();
      expect(client.x + client.width).toBeLessThanOrEqual(job.x + 1);
    }
  }
  await page.getByLabel('Search jobs', { exact: true }).fill('25904');
  await expect(page.locator('.jobs-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.jobs-table tbody tr')).toContainText('Historical Imported Repair');
  await page.getByLabel('Search jobs', { exact: true }).fill('');
  await expect(page.locator('.jobs-table tbody tr')).toHaveCount(3);
  expect(captures.jobInfo).toEqual([]);
});

test('header refresh keeps its busy, retry and navigation behaviour without changing pricing', async ({ page }) => {
  const state = directoryState();
  const captures = await serveDirectory(page, state);
  let requests = 0, finishFirstRequest;
  const jobs = state.jobs.map(job => ({
    id: job.portalJobId, jobNumber: job.jobNumber,
    jobName: job.jobNumber === '26903' ? 'Refreshed Contract Job' : job.portalJobName,
    customer: job.portalCustomer, address: job.portalAddress, jobType: job.jobType,
    projectManager: job.projectManager, startDate: job.startDate, targetEndDate: job.targetEndDate,
    active: job.portalActive, lastImportedAt: fixtureDate,
    documentLink: job.documentLink, documentLinkLabel: job.documentLinkLabel,
  }));
  await page.route('**/api/jobs', async route => {
    requests += 1;
    expect(route.request().method()).toBe('GET');
    if (requests === 1) {
      await new Promise(resolve => { finishFirstRequest = resolve; });
      return route.fulfill({ status: 503, json: { error: 'Temporary refresh test error' } });
    }
    return route.fulfill({ json: { jobs } });
  });
  const refresh = page.locator('.job-directory-refresh-button');
  await refresh.click();
  await expect(refresh).toBeDisabled();
  await expect(refresh).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => typeof finishFirstRequest).toBe('function');
  finishFirstRequest();
  await expect(page.getByText('Temporary refresh test error', { exact: true })).toBeVisible();
  await expect(refresh).toBeEnabled();
  expect(captures.jobInfo).toEqual([]);
  await refresh.click();
  await expect(page.getByText('Official jobs refreshed. Quotes, costs and job history have been kept.', { exact: true })).toBeVisible();
  await expect(page.locator('.jobs-table tbody tr')).toHaveCount(3);
  await expect.poll(() => captures.writes.length).toBeGreaterThan(0);
  const saved = captures.writes.at(-1);
  expect(saved.jobs.find(job => job.id === 'existing-estimator-job')).toEqual(expect.objectContaining({ acceptedRevenue: 12000, originalCostBudget: 10000, acceptedQuoteSnapshot: state.jobs[0].acceptedQuoteSnapshot }));
  expect(saved.quotes[0]).toEqual(expect.objectContaining({ id: state.quotes[0].id, number: state.quotes[0].number, status: 'Won' }));
  expect(requests).toBe(2);
  await page.locator('.jobs-table tbody tr').filter({ hasText: 'Refreshed Contract Job' }).click();
  await expect(refresh).toHaveCount(0);
  await page.getByRole('button', { name: '← All jobs', exact: true }).click();
  await expect(refresh).toHaveCount(1);
  await page.locator('.primary-nav').getByRole('button', { name: 'Clients', exact: true }).click();
  await expect(refresh).toHaveCount(0);
});
