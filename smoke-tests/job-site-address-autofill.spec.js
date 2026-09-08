const { test, expect } = require('@playwright/test');
const { directoryState, serveDirectory, openDirectoryJob } = require('./fixtures/job-readability-fixture');

function addressState() {
  const state = directoryState();
  state.clients[0].sites = [
    { id: 'north', label: 'North Yard', address: ' 120 Example Road ' },
    { id: 'south', label: 'South Yard', address: '240 Example Avenue' },
    { id: 'quoted', label: 'Quoted Work Site', address: '360 Example Street' },
    { id: 'pending', label: 'Address pending', address: '' },
  ];
  state.clients.push({ ...state.clients[0], id: 'other-client', name: 'Other Synthetic Client', sites: [
    { id: 'other-north', label: 'North Yard', address: '480 Other Road' },
    { id: 'other-only', label: 'Other client only', address: '600 Other Road' },
  ] });
  state.jobs.forEach(job => { job.portalCustomer = state.clients[0].name; });
  return state;
}

async function editJob(page, state, number = '26903', width = 1366, options = {}) {
  const captures = await serveDirectory(page, state, options);
  await openDirectoryJob(page, number);
  await page.setViewportSize({ width, height: 1000 });
  await page.getByRole('tab', { name: 'Summary', exact: true }).click();
  await page.getByRole('button', { name: 'Edit job details', exact: true }).click();
  return captures;
}

for (const [number, width] of [['26903', 1366], ['26903', 390], ['26901', 1366], ['25904', 1366]]) {
  test(`saved site address fills and saves on job ${number} at ${width}px without changing quotes or client sites`, async ({ page }, testInfo) => {
    const state = addressState();
    const originalJob = state.jobs.find(job => job.jobNumber === number);
    const captures = await editJob(page, state, number, width);
    const address = page.getByLabel('Address', { exact: true });
    await expect(address).toHaveValue(originalJob.portalAddress);
    await page.getByLabel('Site name', { exact: true }).fill('North Yard');
    await expect(address).toHaveValue('120 Example Road');
    expect(captures.jobInfo).toEqual([]);
    expect(captures.writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (process.env.JGC_CAPTURE_VISUAL_QA) await page.locator('.job-summary-editor').screenshot({ path: testInfo.outputPath(`site-address-${number}-${width}.png`) });
    await page.getByRole('button', { name: 'Save job details', exact: true }).click();
    await expect(page.locator('.job-summary-facts')).toContainText('120 Example Road');
    expect(captures.jobInfo).toHaveLength(1);
    expect(captures.jobInfo[0]).toEqual({ method: 'PATCH', body: expect.objectContaining({ portalJobId: originalJob.portalJobId, siteName: 'North Yard', address: '120 Example Road' }) });
    await expect.poll(() => captures.writes.length).toBeGreaterThan(0);
    const saved = captures.writes.at(-1);
    expect(saved.quotes[0]).toEqual(expect.objectContaining(state.quotes[0]));
    expect(saved.clients).toEqual(state.clients.map(client => expect.objectContaining(client)));
    const job = saved.jobs.find(item => item.id === originalJob.id);
    expect(job).toEqual(expect.objectContaining({ portalAddress: '120 Example Road', acceptedQuoteSnapshot: originalJob.acceptedQuoteSnapshot, acceptedRevenue: originalJob.acceptedRevenue, costs: originalJob.costs, purchaseOrders: originalJob.purchaseOrders, documentLinks: originalJob.documentLinks, portalActive: originalJob.portalActive }));
    await page.getByRole('button', { name: 'Edit job details', exact: true }).click();
    await expect(address).toHaveValue('120 Example Road');
  });
}

test('matching is client-scoped, case-insensitive and works when the client is chosen after the site', async ({ page }) => {
  const state = addressState();
  await editJob(page, state);
  const site = page.getByLabel('Site name', { exact: true });
  const address = page.getByLabel('Address', { exact: true });
  await site.fill(' north yard ');
  await expect(address).toHaveValue('120 Example Road');
  await page.getByLabel('Client', { exact: true }).fill(' other synthetic CLIENT ');
  await expect(address).toHaveValue('480 Other Road');
  await site.fill('Other client only');
  await expect(address).toHaveValue('600 Other Road');
  await page.getByLabel('Client', { exact: true }).fill(state.clients[0].name);
  await address.fill('Manual address');
  await site.fill('North');
  await expect(address).toHaveValue('Manual address');
  await site.fill('Other client only');
  await expect(address).toHaveValue('Manual address');
  await site.fill('Address pending');
  await expect(address).toHaveValue('Manual address');
  await site.fill('South Yard');
  await expect(address).toHaveValue('240 Example Avenue');
});

test('manual overrides stay editable and cancel restores the original job details', async ({ page }) => {
  const state = addressState();
  const captures = await editJob(page, state);
  const address = page.getByLabel('Address', { exact: true });
  await page.getByLabel('Site name', { exact: true }).fill('North Yard');
  await address.fill('120 Example Road, service entrance');
  await page.getByLabel('Project manager', { exact: true }).fill('Updated Test Manager');
  await expect(address).toHaveValue('120 Example Road, service entrance');
  await page.locator('.job-summary-editor-actions').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(captures.jobInfo).toEqual([]);
  expect(captures.writes).toEqual([]);
  await page.getByRole('button', { name: 'Edit job details', exact: true }).click();
  await expect(address).toHaveValue('99 Railway Avenue');
  await page.getByLabel('Site name', { exact: true }).fill('North Yard');
  await address.fill('120 Example Road, service entrance');
  await page.getByRole('button', { name: 'Save job details', exact: true }).click();
  await expect(page.locator('.job-summary-facts')).toContainText('120 Example Road, service entrance');
  await page.getByRole('button', { name: 'Edit job details', exact: true }).click();
  await expect(address).toHaveValue('120 Example Road, service entrance');
  await address.fill('');
  await page.getByLabel('Project manager', { exact: true }).fill('Another Test Manager');
  await expect(address).toHaveValue('');
});

test('opening a blank address fills a matching site in the draft only, including accepted-quote site fallback', async ({ page }) => {
  const state = addressState();
  state.jobs[0].portalAddress = '';
  const captures = await editJob(page, state, '26901');
  await expect(page.getByLabel('Site name', { exact: true })).toHaveValue('Quoted Work Site');
  await expect(page.getByLabel('Address', { exact: true })).toHaveValue('360 Example Street');
  expect(captures.jobInfo).toEqual([]);
  expect(captures.writes).toEqual([]);
  await page.locator('.job-summary-editor-actions').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.job-summary-facts')).not.toContainText('360 Example Street');
});

for (const duplicate of ['client', 'site']) test(`ambiguous ${duplicate} names do not guess an address`, async ({ page }) => {
  const state = addressState();
  if (duplicate === 'client') state.clients.push({ ...state.clients[0], id: 'duplicate-client' });
  else state.clients[0].sites.push({ id: 'duplicate-north', label: ' north yard ', address: 'Conflicting site address' });
  await editJob(page, state);
  await page.getByLabel('Site name', { exact: true }).fill('North Yard');
  await expect(page.getByLabel('Address', { exact: true })).toHaveValue('99 Railway Avenue');
});

test('a failed save keeps the autofilled draft for retry without reporting a saved address', async ({ page }) => {
  const captures = await editJob(page, addressState(), '26903', 1366, { failJobInfo: true });
  await page.getByLabel('Site name', { exact: true }).fill('North Yard');
  await page.getByRole('button', { name: 'Save job details', exact: true }).click();
  await expect(page.getByText('Canonical job update rejected for this test', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Address', { exact: true })).toHaveValue('120 Example Road');
  expect(captures.writes).toEqual([]);
});
