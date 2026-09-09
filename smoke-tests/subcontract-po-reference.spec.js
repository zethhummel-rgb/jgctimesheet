const { test, expect } = require('@playwright/test');
const { directoryState, serveDirectory, openDirectoryJob, fixtureDate } = require('./fixtures/job-readability-fixture');

function referenceState(references = ['']) {
  const state = directoryState();
  state.vendors = [{ id: 'reference-vendor', name: 'Test Reference Vendor', trade: 'Fencing', contact: '', email: '', phone: '', status: 'Active', contacts: [], notes: '' }];
  state.quotes[0].lines = references.map((reference, index) => ({
    id: `reference-line-${index}`, description: `Authorized fencing work ${index + 1}`, quantity: 1, unit: 'LS',
    costType: 'Sub / Vendor', vendorId: 'reference-vendor', vendorName: 'Test Reference Vendor', vendorReference: reference,
    vendorActualCost: 2400, vendorOverrideCost: null, projectCost: 2400, catalogCost: null, included: true,
    division: 'Division 10 – Specialties', section: 'General', classification: 'Required', confidence: 'Project-specific',
    liveQuote: true, vendorPricingMode: 'Quoted', priceOverride: null, markupOverride: null,
  }));
  state.jobs[0].acceptedQuoteSnapshot = JSON.stringify(state.quotes[0]);
  return state;
}

function addSavedPo(state, reference, status = 'Issued') {
  state.jobs[0].purchaseOrders = [{
    id: 'reference-po', number: '26901', revision: 0, status, sourceQuoteId: state.quotes[0].id,
    vendorId: 'reference-vendor', vendorName: 'Test Reference Vendor', vendorContact: '', vendorEmail: '', vendorPhone: '',
    vendorQuoteNumber: reference, issueDate: '2026-09-09', shipBy: '', shipVia: '', fob: '', shipTo: '', authorizedBy: 'Test Manager',
    taxRate: 0.13, notes: '', lines: state.quotes[0].lines.map(line => ({
      id: `po-${line.id}`, quoteLineId: line.id, description: line.description, quantity: 1, unit: 'LS', unitCost: 2400, amount: 2400, sourceReference: line.vendorReference,
    })), revisions: [], finalizedAt: status === 'Issued' ? fixtureDate : '', createdAt: fixtureDate, updatedAt: fixtureDate,
  }];
}

async function openPurchases(page, state) {
  const captures = await serveDirectory(page, state);
  await openDirectoryJob(page, '26901');
  await page.getByRole('tab', { name: 'Purchase Orders', exact: true }).click();
  return captures;
}

for (const width of [390, 1366]) test(`create and revise PO reference updates the job table and survives reload at ${width}px`, async ({ page }, testInfo) => {
  const state = referenceState(), originalSnapshot = state.jobs[0].acceptedQuoteSnapshot;
  const captures = await openPurchases(page, state);
  await page.setViewportSize({ width, height: 900 });
  const table = page.locator('.po-source-table');
  const reference = table.locator('tbody td[data-label="Vendor quote #"]');
  await expect(reference).toHaveText('Not entered');
  await table.getByRole('button', { name: 'Create PO' }).click();
  let dialog = page.getByRole('dialog', { name: 'Create purchase order' });
  await dialog.getByLabel('Vendor quote #', { exact: true }).fill('REF-1007');
  await dialog.getByRole('button', { name: 'Create final PO', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(reference).toHaveText('REF-1007');
  await expect.poll(() => captures.writes.some(s => s.jobs[0].purchaseOrders.length === 1)).toBe(true);
  await page.route('**/api/state', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { state: captures.writes.at(-1), updatedAt: new Date().toISOString() } })
    : route.fallback());
  await page.reload();
  if (width < 768) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: /^Jobs(?:\s|$)/ }).click();
  await openDirectoryJob(page, '26901');
  await page.getByRole('tab', { name: 'Purchase Orders', exact: true }).click();
  await expect(reference).toHaveText('REF-1007');
  await table.getByRole('button', { name: 'Edit PO', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Vendor quote #', { exact: true })).toHaveValue('REF-1007');
  await dialog.getByLabel('Vendor quote #', { exact: true }).fill('REF-1007-R1');
  await dialog.getByRole('button', { name: 'Save as Revision 1', exact: true }).click();
  await expect(reference).toHaveText('REF-1007-R1');
  await expect.poll(() => captures.writes.at(-1)?.jobs[0].purchaseOrders[0]?.vendorQuoteNumber).toBe('REF-1007-R1');
  const saved = captures.writes.at(-1), po = saved.jobs[0].purchaseOrders[0];
  expect(po).toMatchObject({ revision: 1, status: 'Draft', vendorQuoteNumber: 'REF-1007-R1' });
  expect(JSON.parse(po.revisions[0].snapshot).vendorQuoteNumber).toBe('REF-1007');
  expect(po.lines[0]).toMatchObject({ amount: 2400, sourceReference: '' });
  expect(saved.quotes[0].lines[0].vendorReference).toBe('');
  expect(saved.jobs[0].acceptedQuoteSnapshot).toBe(originalSnapshot);
  expect(captures.jobInfo).toEqual([]);
  expect(captures.unexpectedRequests).toEqual([]);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.applyJgcTheme(theme), theme);
    await reference.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`reference-${theme}-${width}.png`) });
  }
});

for (const status of ['Issued', 'Draft']) test(`existing ${status} combined PO uses its saved reference without rewriting estimate lines`, async ({ page }) => {
  const state = referenceState(['EST-OLD-A', 'EST-OLD-B']);
  addSavedPo(state, 'PO-REF-A, PO-REF-B', status);
  const captures = await openPurchases(page, state);
  const cells = page.locator('.po-source-table tbody td[data-label="Vendor quote #"]');
  await expect(cells).toHaveText(['PO-REF-A, PO-REF-B', 'PO-REF-A, PO-REF-B']);
  expect(captures.writes.flatMap(s => s.quotes[0].lines).every(line => line.vendorReference.startsWith('EST-OLD-'))).toBe(true);
  expect(captures.jobInfo).toEqual([]);
});

test('a blank saved PO reference does not resurrect the estimate reference; void PO uses the estimate', async ({ page }) => {
  const state = referenceState(['EST-ORIGINAL']);
  addSavedPo(state, '   ');
  await openPurchases(page, state);
  await expect(page.locator('.po-source-table tbody td[data-label="Vendor quote #"]')).toHaveText('Not entered');
  state.jobs[0].purchaseOrders[0].status = 'Void';
  await page.reload();
  await page.getByRole('button', { name: /^Jobs(?:\s|$)/ }).click();
  await openDirectoryJob(page, '26901');
  await page.getByRole('tab', { name: 'Purchase Orders', exact: true }).click();
  await expect(page.locator('.po-source-table tbody td[data-label="Vendor quote #"]')).toHaveText('EST-ORIGINAL');
  await expect(page.locator('.po-source-table').getByRole('button', { name: 'Create PO' })).toBeVisible();
});
