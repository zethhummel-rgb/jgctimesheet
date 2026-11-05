const { test, expect } = require('@playwright/test');
const { directoryState, serveDirectory, openDirectoryJob, officialIds } = require('./fixtures/job-readability-fixture');

async function extrasFixture(page, options = {}) {
  const state = directoryState();
  if (options.costs) state.jobs.find((job) => job.jobNumber === "26902").costs = options.costs;
  expect(state.jobs.find((job) => job.jobNumber === '26902').quoteId).toBe('');
  const captures = await serveDirectory(page, state);
  const store = {
    byJob: {
      '26901': [{
        id: 'a0000000-0000-4000-8000-000000000001', code: 'X1',
        description: 'Chip up flooring tiles', active: true, hours: 7.5, submitted_hours: 5,
        work_orders: [
          { id: 'extra-wo-1', wo_number: 'WO26901-020', work_order_date: '2026-11-04', status: 'submitted', hours: 5, created_by_name: 'Synthetic Worker' },
          { id: 'extra-wo-2', wo_number: 'WO26901-021', work_order_date: '2026-11-05', status: 'draft', hours: 2.5, created_by_name: 'Synthetic Foreman' },
        ],
      }],
      '26902': [],
    },
    costingByJob: {
      '26901': { original: { hours: 0, loaded_cost: 0, missing_rate_hours: 0 }, extras: [], unallocated: { hours: 0, loaded_cost: 0, missing_rate_hours: 0 }, total: { hours: 0, loaded_cost: 0, missing_rate_hours: 0 }, unpriced_manual_wo_hours: 0 },
      '26902': { original: { hours: 16, loaded_cost: 672, missing_rate_hours: 0 }, extras: [], unallocated: { hours: 0, loaded_cost: 0, missing_rate_hours: 0 }, total: { hours: 16, loaded_cost: 672, missing_rate_hours: 0 }, unpriced_manual_wo_hours: 0 },
    },
    failLoad: false,
    gets: [],
    posts: [],
    failSave: false,
  };
  await page.route('**/api/job-tm-extras**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      const number = url.searchParams.get('jobNumber');
      store.gets.push(number);
      if (store.failLoad) return route.fulfill({ status: 500, json: { error: 'Labour breakdown could not be refreshed.' } });
      return route.fulfill({ json: { job_id: number === '26901' ? officialIds.quoted : officialIds.tm, extras: store.byJob[number] || [], costing: store.costingByJob[number] } });
    }
    const body = request.postDataJSON();
    store.posts.push(body);
    if (store.failSave) return route.fulfill({ status: 403, json: { error: 'This extra could not be saved. Try again.' } });
    const rows = store.byJob[body.jobNumber] ||= [];
    let extra = rows.find((item) => item.id === body.extraId);
    if (extra) {
      extra.description = body.description;
      extra.active = body.active;
    } else {
      extra = {
        id: 'a0000000-0000-4000-8000-' + String(rows.length + 2).padStart(12, '0'),
        code: 'X' + (rows.length + 1), description: body.description, active: true,
        hours: 0, submitted_hours: 0, work_orders: [],
      };
      rows.push(extra);
    }
    return route.fulfill({ json: extra });
  });
  return { store, captures };
}

for (const width of [390, 1440]) {
  test('T&M Extras tracks linked WOs and keeps each job separate at ' + width, async ({ page }, testInfo) => {
    const { store, captures } = await extrasFixture(page);
    await page.setViewportSize({ width, height: 950 });
    await openDirectoryJob(page, '26901');
    await page.getByRole('tab', { name: 'T&M Extras', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'T&M Extras', exact: true });
    const extra = panel.getByRole('row').filter({ hasText: 'Chip up flooring tiles' });
    await expect(extra).toContainText('X1');
    await expect(extra).toContainText('7.50');
    await expect(extra).toContainText('5.00');
    await extra.getByRole('button', { name: '2 WOs', exact: true }).click();
    await expect(panel).toContainText('WO26901-020');
    await expect(panel).toContainText('WO26901-021');
    await expect(panel).toContainText('Synthetic Worker');
    await expect(panel.getByRole('link', { name: 'WO26901-020', exact: true })).toHaveAttribute('href', /work-orders\.html\?wo=extra-wo-1/);

    // Re-reading the authoritative totals replaces the displayed hours.
    store.byJob['26901'][0].hours = 9;
    store.byJob['26901'][0].work_orders[1].hours = 4;
    await panel.getByRole('button', { name: /Refresh/ }).click();
    await expect(extra).toContainText('9.00');
    await expect(extra).not.toContainText('16.50');

    await panel.getByRole('button', { name: 'Add extra', exact: true }).click();
    await panel.getByLabel('Description', { exact: true }).fill('Remove damaged drywall');
    await panel.getByRole('button', { name: 'Save extra', exact: true }).click();
    const added = panel.getByRole('row').filter({ hasText: 'Remove damaged drywall' });
    await expect(added).toContainText('X2');
    expect(store.posts).toHaveLength(1);
    expect(store.posts[0]).toMatchObject({ jobNumber: '26901', description: 'Remove damaged drywall' });

    await page.screenshot({ path: testInfo.outputPath('tm-extras-' + width + '.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await page.getByRole('button', { name: /All jobs/ }).click();
    await openDirectoryJob(page, '26902');
    await page.getByRole('tab', { name: 'Summary', exact: true }).click();
    await page.getByRole('tab', { name: 'T&M Extras', exact: true }).click();
    await expect(panel).not.toContainText('Chip up flooring tiles');
    await expect(panel).not.toContainText('Remove damaged drywall');
    await panel.getByRole('button', { name: 'Add extra', exact: true }).click();
    await panel.getByLabel('Description', { exact: true }).fill('Repair loading dock');
    await panel.getByRole('button', { name: 'Save extra', exact: true }).click();
    await expect(panel.getByRole('row').filter({ hasText: 'Repair loading dock' })).toContainText('X1');
    expect(store.gets).toContain('26902');
    expect(store.posts.at(-1)).toMatchObject({ jobNumber: '26902', description: 'Repair loading dock' });
    expect(captures.unexpectedRequests).toEqual([]);
  });
}

test('T&M Extras keeps unsaved input after a rejected save and supports closing an existing extra', async ({ page }) => {
  const { store } = await extrasFixture(page);
  await openDirectoryJob(page, '26901');
  await page.getByRole('tab', { name: 'T&M Extras', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'T&M Extras', exact: true });
  await panel.getByRole('button', { name: 'Add extra', exact: true }).click();
  await panel.getByLabel('Description', { exact: true }).fill('Additional ceiling repair');
  store.failSave = true;
  await panel.getByRole('button', { name: 'Save extra', exact: true }).click();
  await expect(panel).toContainText('This extra could not be saved');
  await expect(panel.getByLabel('Description', { exact: true })).toHaveValue('Additional ceiling repair');
  store.failSave = false;
  await panel.getByRole('button', { name: 'Save extra', exact: true }).click();
  const added = panel.getByRole('row').filter({ hasText: 'Additional ceiling repair' });
  await expect(added).toContainText('X2');
  await added.getByRole('button', { name: 'Close extra', exact: true }).click();
  await expect(added).toContainText('Closed');
  expect(store.posts.at(-1)).toMatchObject({ extraId: store.byJob['26901'][1].id, active: false });
  await added.getByRole('button', { name: 'Reopen extra', exact: true }).click();
  await expect(added).toContainText('Open');
  expect(store.posts.at(-1)).toMatchObject({ extraId: store.byJob['26901'][1].id, active: true });
});

// Cost allocation is supplied by the same server report as the register. These
// browser checks exercise presentation and replacement of those authoritative
// totals; payroll-source deduplication and permissions are checked in SQL.
async function summaryFixture(page, options = {}) {
  const fixture = await extrasFixture(page, options);
  const { store } = fixture;
  store.byJob['26902'] = [{
    id: 'b0000000-0000-4000-8000-000000000001', code: 'X1',
    description: 'Chip up flooring tiles', active: true, hours: 2, submitted_hours: 2, work_orders: [],
  }];
  store.costingByJob['26902'] = {
    original: { hours: 8, loaded_cost: 280, missing_rate_hours: 0 },
    extras: [{ id: store.byJob['26902'][0].id, hours: 2, loaded_cost: 70, missing_rate_hours: 0 }],
    unallocated: { hours: 0, loaded_cost: 0, missing_rate_hours: 0 },
    total: { hours: 10, loaded_cost: 350, missing_rate_hours: 0 },
    unpriced_manual_wo_hours: 0,
  };
  await page.route('**/api/job-costing', async (route) => {
    const total = store.costingByJob['26902']?.total || { hours: 10, loaded_cost: 350, missing_rate_hours: 0 };
    return route.fulfill({ json: { actuals: [{
      portalJobId: officialIds.tm, jobNumber: '26902', workerProfileId: 'directory-worker',
      workerName: 'Directory Employee', sourceStatus: 'submitted', firstWorkDate: '2026-11-04',
      lastWorkDate: '2026-11-04', hours: total.hours, loadedLabourCost: total.loaded_cost, missingRateHours: total.missing_rate_hours,
    }] } });
  });
  return fixture;
}

function costRow(panel, label) {
  return panel.getByRole('row').filter({ has: panel.page().getByRole('rowheader', { name: label, exact: true }) });
}

for (const width of [390, 1440]) {
  test('Job Summary separates and refreshes regular plus extra labour on a job without a quote at ' + width, async ({ page }, testInfo) => {
    const { store, captures } = await summaryFixture(page);
    await page.setViewportSize({ width, height: 950 });
    await openDirectoryJob(page, '26902');
    await page.getByRole('tab', { name: 'Summary', exact: true }).click();
    const panel = page.getByRole('region', { name: 'Labour cost breakdown', exact: true });
    await expect(page.getByRole('tabpanel', { name: 'Summary', exact: true })).toContainText('No accepted quote linked');
    await page.getByRole('button', { name: /Refresh labour/ }).click();
    await expect(costRow(panel, 'Regular job labour').getByRole('cell')).toHaveText(['8.00', '$280.00']);
    await expect(costRow(panel, 'X1 — Chip up flooring tiles').getByRole('cell')).toHaveText(['2.00', '$70.00']);
    await expect(costRow(panel, 'Total labour including extras').getByRole('cell')).toHaveText(['10.00', '$350.00']);
    await expect(costRow(panel, 'Total actual cost including extras').getByRole('cell')).toHaveText(['—', '$350.00']);
    await expect(panel.getByRole('rowheader', { name: 'Needs allocation', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('rowheader', { name: 'Entered labour adjustments', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('rowheader', { name: 'Other entered costs', exact: true })).toHaveCount(0);

    // Updated payroll must replace the old amount, never be added on top of it.
    store.costingByJob['26902'].original = { hours: 9, loaded_cost: 315, missing_rate_hours: 0 };
    store.costingByJob['26902'].total = { hours: 11, loaded_cost: 385, missing_rate_hours: 0 };
    await panel.getByRole('button', { name: 'Refresh breakdown', exact: true }).click();
    await expect(costRow(panel, 'Regular job labour').getByRole('cell')).toHaveText(['9.00', '$315.00']);
    await expect(costRow(panel, 'Total labour including extras').getByRole('cell')).toHaveText(['11.00', '$385.00']);
    await expect(costRow(panel, 'Total actual cost including extras').getByRole('cell')).toHaveText(['—', '$385.00']);
    await expect(panel).not.toContainText('$735.00');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: testInfo.outputPath('tm-labour-breakdown-' + width + '.png') });
    expect(captures.unexpectedRequests).toEqual([]);
  });
}

test('Job Summary preserves unallocated and missing-rate labour, adjustments and unpriced manual hours', async ({ page }) => {
  const { store } = await summaryFixture(page, { costs: [
    { id: 'adjustment-labour', type: 'Labour', date: '2026-11-04', description: 'Entered labour adjustment', preTaxAmount: 75, hours: 1.5 },
    { id: 'actual-material', type: 'Material', date: '2026-11-04', description: 'Entered material cost', preTaxAmount: 125 },
    { id: 'commitment-only', type: 'Commitment', date: '2026-11-04', description: 'Unspent commitment', preTaxAmount: 1000 },
  ] });
  store.costingByJob['26902'].unallocated = { hours: 2, loaded_cost: 35, missing_rate_hours: 1 };
  store.costingByJob['26902'].total = { hours: 12, loaded_cost: 385, missing_rate_hours: 1 };
  store.costingByJob['26902'].unpriced_manual_wo_hours = 4;
  await openDirectoryJob(page, '26902');
    await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Labour cost breakdown', exact: true });
  await expect(costRow(panel, 'Needs allocation').getByRole('cell')).toHaveText(['2.00', '$35.00']);
  await expect(costRow(panel, 'Entered labour adjustments').getByRole('cell')).toHaveText(['1.50', '$75.00']);
  await expect(costRow(panel, 'Total labour including extras').getByRole('cell')).toHaveText(['13.50', '$460.00']);
  await expect(costRow(panel, 'Other entered costs').getByRole('cell')).toHaveText(['—', '$125.00']);
  await expect(costRow(panel, 'Total actual cost including extras').getByRole('cell')).toHaveText(['—', '$585.00']);
  await expect(panel).toContainText('1.00 h have no payroll rate');
  await expect(panel).toContainText('Costs shown are incomplete');
  await expect(panel).toContainText('4.00 manual WO hours');
  await expect(panel).toContainText('They are not added to this cost breakdown');
  await expect(panel).not.toContainText('$1,585.00');
});

test('Job Summary shows unavailable for missing or failed costing and recovers without stale totals', async ({ page }) => {
  const { store } = await summaryFixture(page);
  const available = store.costingByJob['26902'];
  delete store.costingByJob['26902'];
  await openDirectoryJob(page, '26902');
    await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Labour cost breakdown', exact: true });
  await expect(panel.getByRole('alert')).toContainText('Unavailable');
  await expect(panel.getByRole('table')).toHaveCount(0);
  store.costingByJob['26902'] = available;
  await panel.getByRole('button', { name: 'Refresh breakdown', exact: true }).click();
  await expect(costRow(panel, 'Total actual cost including extras').getByRole('cell')).toHaveText(['—', '$350.00']);
  store.failLoad = true;
  await panel.getByRole('button', { name: 'Refresh breakdown', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Unavailable');
  await expect(panel.getByRole('table')).toHaveCount(0);
  await expect(panel).not.toContainText('$350.00');
});
