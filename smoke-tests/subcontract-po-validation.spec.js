const { test, expect } = require('@playwright/test');
const { directoryState, serveDirectory, openDirectoryJob } = require('./fixtures/job-readability-fixture');

function blankScopeState() {
  const state = directoryState();
  // A legacy blank scope can predate the canonical Portal vendor directory.
  // Do not supply a local vendor: normalization would use its name as scope.
  state.vendors = [];
  state.quotes[0].lines = [{ id: 'scope-line', description: '', quantity: 1, unit: 'LS', costType: 'Sub / Vendor', vendorId: 'scope-vendor', vendorName: '', vendorReference: '', vendorActualCost: 2400, vendorOverrideCost: null, projectCost: 2400, catalogCost: null, included: true, division: 'Division 10 – Specialties', section: 'General', classification: 'Required', confidence: 'Project-specific', liveQuote: true, vendorPricingMode: 'Quoted', priceOverride: null, markupOverride: null }];
  state.jobs[0].acceptedQuoteSnapshot = JSON.stringify(state.quotes[0]);
  return state;
}

async function openPo(page, state) {
  const captures = await serveDirectory(page, state);
  await openDirectoryJob(page, '26901');
  await page.getByRole('tab', { name: 'Purchase Orders', exact: true }).click();
  await page.locator('.po-source-table').getByRole('button', { name: 'Create PO' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create purchase order' });
  await dialog.getByLabel(/Subcontractor company/).fill('Test Fencing Vendor');
  return { captures, dialog };
}

for (const width of [390, 1366]) test(`missing subcontract scope is explained, focused and creates one PO after correction at ${width}px`, async ({ page }, testInfo) => {
  const state = blankScopeState(), originalSnapshot = state.jobs[0].acceptedQuoteSnapshot;
  const { captures, dialog } = await openPo(page, state);
  await page.setViewportSize({ width, height: 900 });
  await dialog.getByLabel('Vendor quote #', { exact: true }).fill('FENCE-TEST-17');
  await dialog.getByRole('button', { name: 'Create final PO', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('work being authorized');
  await expect(dialog).toBeVisible();
  expect(captures.writes.flatMap(s => s.jobs.flatMap(j => j.purchaseOrders || []))).toHaveLength(0);
  // Previously this left the focus on Create, with an obscure error beside
  // the green Final/locked notice; the missing description was off-screen.
  await expect(dialog.getByLabel('Description', { exact: true })).toBeFocused();
  await expect(dialog).toContainText('Not created yet');
  await expect(dialog).not.toContainText('This PO is locked');
  await expect(dialog.getByLabel('Description', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => window.applyJgcTheme(theme), theme);
    await expect(dialog.getByRole('alert')).toHaveCSS('color', 'rgb(136, 19, 55)');
    await expect(dialog.getByRole('alert')).toHaveCSS('background-color', 'rgb(255, 241, 242)');
    await expect(dialog.getByLabel('Description', { exact: true })).toHaveCSS('border-top-color', 'rgb(190, 18, 60)');
    await page.screenshot({ path: testInfo.outputPath(`validation-${theme}-${width}.png`) });
  }
  await dialog.getByLabel('Description', { exact: true }).fill('Install the specified perimeter fencing.');
  await dialog.getByRole('button', { name: 'Create final PO', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.subcontract-po-panel .po-count-chip')).toHaveText('1 PO');
  await expect(page.locator('.po-source-table')).toContainText('Final');
  await expect.poll(() => captures.writes.some(s => s.jobs[0].purchaseOrders.length === 1)).toBe(true);
  const saved = captures.writes.at(-1), po = saved.jobs[0].purchaseOrders[0];
  expect(po).toMatchObject({ status: 'Issued', number: '26901', vendorName: 'Test Fencing Vendor', vendorQuoteNumber: 'FENCE-TEST-17', revision: 0 });
  expect(po.lines[0]).toMatchObject({ description: 'Install the specified perimeter fencing.', amount: 2400 });
  expect(saved.quotes[0]).toMatchObject({ id: state.quotes[0].id, status: 'Won', revision: 0 });
  expect(saved.quotes[0].lines[0]).toMatchObject({ description: '', vendorReference: '', vendorActualCost: 2400 });
  expect(saved.jobs[0].acceptedQuoteSnapshot).toBe(originalSnapshot);
  expect(saved.jobs[0].portalJobId).toBe(state.jobs[0].portalJobId);
  expect(captures.jobInfo).toEqual([]); expect(captures.unexpectedRequests).toEqual([]);
  await page.locator('.po-source-table').getByRole('button', { name: 'Edit PO', exact: true }).click();
  const edit = page.getByRole('dialog', { name: /Edit PO 26901/ });
  await expect(edit.getByLabel('Description', { exact: true })).toHaveValue('Install the specified perimeter fencing.');
  await expect(edit.getByRole('button', { name: 'No changes to save' })).toBeDisabled();
  await edit.screenshot({ path: testInfo.outputPath(`saved-po-${width}.png`) });
  // Serve the saved server state in a fresh page load, not just local React state.
  await page.route('**/api/state', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { state: saved, updatedAt: new Date().toISOString() } })
    : route.fallback());
  await page.reload();
  if (width < 768) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: /^Jobs(?:\s|$)/ }).click();
  await openDirectoryJob(page, '26901');
  await page.getByRole('tab', { name: 'Purchase Orders', exact: true }).click();
  await expect(page.locator('.subcontract-po-panel .po-count-chip')).toHaveText('1 PO');
  await page.locator('.po-source-table').getByRole('button', { name: 'Edit PO', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Description', { exact: true })).toHaveValue('Install the specified perimeter fencing.');
});

test('whitespace scope and invalid native fields show actionable errors without saving', async ({ page }) => {
  const { captures, dialog } = await openPo(page, blankScopeState());
  await dialog.getByLabel('Description', { exact: true }).fill('   ');
  await dialog.getByRole('button', { name: 'Create final PO', exact: true }).click();
  await expect(dialog.getByLabel('Description', { exact: true })).toBeFocused();
  await dialog.getByLabel('Description', { exact: true }).fill('Install fencing.');
  await dialog.getByLabel('Email', { exact: true }).fill('not-an-email');
  await dialog.getByRole('button', { name: 'Create final PO', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Email');
  await expect(dialog.getByLabel('Email', { exact: true })).toBeFocused();
  await dialog.getByLabel('Email', { exact: true }).fill('');
  await dialog.getByLabel(/^Pre-tax amount/).fill('0');
  await dialog.getByRole('button', { name: 'Create final PO', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('above zero');
  await expect(dialog.getByLabel(/^Pre-tax amount/)).toBeFocused();
  expect(captures.writes.flatMap(s => s.jobs.flatMap(j => j.purchaseOrders || []))).toHaveLength(0);
});
