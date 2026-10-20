const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const ts = require('../estimating-app/node_modules/typescript');
const { directoryState, serveDirectory, openDirectoryJob, fixtureDate } = require('./fixtures/job-readability-fixture');

const address = '123 Synthetic Company Street, Suite 200, Cornwall, Ontario K6H 0A1';
function fixture() {
  const state = directoryState();
  state.vendors = [{ id: 'bergeron', portalRecordId: 'company-id', name: 'Bergeron Electric', address, trade: 'Electrical', category: 'Subcontractor', contact: 'Carter', phone: '6136201169', email: '', status: 'Active', contacts: [], notes: '' }];
  state.quotes[0].lines = [{ id: 'vendor-line', description: 'Electrical installation', quantity: 1, unit: 'LS', costType: 'Sub / Vendor', vendorId: 'bergeron', vendorName: 'Bergeron Electric', vendorReference: 'SYNTHETIC-QUOTE', vendorActualCost: 500, vendorOverrideCost: null, projectCost: 500, catalogCost: null, included: true, division: 'Electrical', section: 'General', classification: 'Required', confidence: 'Project-specific', liveQuote: true, vendorPricingMode: 'Quoted', priceOverride: null, markupOverride: null }];
  state.jobs[0].acceptedQuoteSnapshot = JSON.stringify(state.quotes[0]);
  return state;
}
async function pdfText(download, file) {
  await download.saveAs(file);
  const pdfjs = await import(pathToFileURL(path.resolve(__dirname, '../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableWorker: true }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) pages.push((await (await doc.getPage(n)).getTextContent()).items.map(item => item.str).join(' '));
  return pages.join(' ');
}

for (const direct of [false, true]) for (const width of [390, 1440]) test(`${direct ? 'direct' : 'quote'} PO uses company address and only manual contact details at ${width}px`, async ({ page }, info) => {
  test.setTimeout(45000);
  const state = fixture(), number = direct ? '26902' : '26901';
  const captures = await serveDirectory(page, state);
  await openDirectoryJob(page, number);
  await page.setViewportSize({ width, height: 900 });
  await page.getByRole('tab', { name: 'Purchase Orders', exact: true }).click();
  if (direct) await page.getByRole('button', { name: 'Make a PO', exact: true }).click();
  else await page.locator('.po-source-table').getByRole('button', { name: 'Create PO' }).click();
  let dialog = page.getByRole('dialog');
  if (direct) {
    await dialog.getByLabel('Saved supplier / subcontractor', { exact: false }).selectOption('bergeron');
    await dialog.getByLabel('Description', { exact: true }).fill('Electrical installation');
    await dialog.getByLabel('PO amount (before tax)').fill('500');
  }
  await expect(dialog.getByLabel('Contact', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Phone', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('textbox', { name: 'Subcontractor address', exact: true })).toHaveValue(address);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => window.applyJgcTheme(t), theme);
    await dialog.screenshot({ path: info.outputPath(`company-${theme}-${width}.png`) });
  }
  await dialog.getByRole('button', { name: 'Create final PO', exact: true }).click();
  const table = page.locator(direct ? '.job-direct-po-table' : '.po-source-table');
  await expect.poll(() => captures.writes.at(-1)?.jobs.find(j => j.jobNumber === number).purchaseOrders[0]?.vendorAddress).toBe(address);
  const saved = captures.writes.at(-1);
  const po = saved.jobs.find(j => j.jobNumber === number).purchaseOrders[0];
  expect(po).toMatchObject({ vendorContact: '', vendorPhone: '', vendorAddress: address });
  const pdf = page.waitForEvent('download');
  await table.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const text = await pdfText(await pdf, info.outputPath('company-address.pdf'));
  expect(text).toContain('Bergeron Electric');
  expect(text).toContain('123 Synthetic Company Street');
  expect(text).not.toContain('Carter');
  expect(text).not.toContain('6136201169');
  // Directory changes must not rewrite an already saved PO's address.
  saved.vendors[0].address = '999 New Directory Address';
  await page.route('**/api/state', r => r.request().method() === 'GET' ? r.fulfill({ json: { state: saved, updatedAt: fixtureDate } }) : r.fallback());
  await page.reload();
  if (width < 768) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: /^Jobs(?:\s|$)/ }).click();
  await openDirectoryJob(page, number);
  await page.getByRole('tab', { name: 'Purchase Orders', exact: true }).click();
  await table.getByRole('button', { name: 'Edit PO', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: 'Subcontractor address', exact: true })).toHaveValue(address);
  await expect(dialog.getByRole('button', { name: 'No changes to save' })).toBeDisabled();
  await dialog.getByLabel('Contact', { exact: true }).fill('Manually Entered Contact');
  await dialog.getByLabel('Phone', { exact: true }).fill('6135550180');
  await dialog.getByRole('textbox', { name: 'Subcontractor address', exact: true }).fill('');
  await dialog.getByRole('button', { name: 'Save as Revision 1', exact: true }).click();
  const revisedPdf = page.waitForEvent('download');
  await table.getByRole('button', { name: 'Download & finalize', exact: true }).click();
  const revisedText = await pdfText(await revisedPdf, info.outputPath('manual-contact.pdf'));
  expect(revisedText).toContain('Manually Entered Contact');
  expect(revisedText).not.toContain('999 New Directory Address');
  expect(revisedText).not.toContain('123 Synthetic Company Street');
  await table.getByRole('button', { name: 'Edit PO', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Contact', { exact: true })).toHaveValue('Manually Entered Contact');
  await expect(page.getByRole('dialog').getByLabel('Phone', { exact: true })).not.toHaveValue('');
  expect(captures.unexpectedRequests).toEqual([]);
});

test('legacy address fallback is exact, unambiguous, and respects intentional blanks', () => {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../estimating-app/lib/purchase-order-vendor.ts'), 'utf8');
  Function('exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(module.exports);
  const resolve = module.exports.purchaseOrderVendorAddress, vendors = fixture().vendors;
  expect(resolve(vendors, { vendorId: 'bergeron', vendorName: 'Bergeron Electric' })).toBe(address);
  expect(resolve(vendors, { vendorId: 'bergeron', vendorName: 'Other Company' })).toBe('');
  expect(resolve([...vendors, { ...vendors[0], id: 'duplicate', address: 'Other Address' }], { vendorId: null, vendorName: 'Bergeron Electric' })).toBe('');
  expect(resolve(vendors, { vendorId: 'bergeron', vendorName: 'Bergeron Electric', vendorAddress: '' })).toBe('');
  expect(resolve(vendors, { vendorId: 'bergeron', vendorName: 'Bergeron Electric', vendorAddress: 'Frozen Address' })).toBe('Frozen Address');
});

test('legacy saved PO contact remains unchanged and opening it creates no revision', async ({ page }) => {
  const state = fixture();
  state.jobs[0].purchaseOrders = [{ id: 'old-po', number: '26901', revision: 0, status: 'Issued', sourceQuoteId: state.quotes[0].id, vendorId: 'bergeron', vendorName: 'Bergeron Electric', vendorContact: 'Explicit Saved Contact', vendorPhone: '6135550101', vendorEmail: '', vendorQuoteNumber: 'OLD', issueDate: '2026-10-20', shipBy: '', shipVia: '', shipTo: '', fob: '', authorizedBy: 'Saved Author', taxRate: 0.13, notes: '', lines: [{ id: 'old-line', quoteLineId: 'vendor-line', description: 'Electrical installation', quantity: 1, unit: 'LS', unitCost: 500, amount: 500, sourceReference: '' }], revisions: [], createdAt: fixtureDate, updatedAt: fixtureDate, finalizedAt: fixtureDate }];
  const captures = await serveDirectory(page, state);
  await openDirectoryJob(page, '26901');
  await page.getByRole('tab', { name: 'Purchase Orders', exact: true }).click();
  await page.getByRole('button', { name: 'Edit PO', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Contact', { exact: true })).toHaveValue('Explicit Saved Contact');
  await expect(dialog.getByRole('textbox', { name: 'Subcontractor address', exact: true })).toHaveValue(address);
  await expect(dialog.getByRole('button', { name: 'No changes to save' })).toBeDisabled();
  expect(captures.writes.every(s => s.jobs[0].purchaseOrders[0].revision === 0)).toBe(true);
});

test('company address can be saved from Vendors without changing the main contact', async ({ page }) => {
  const state = fixture(), requests = [];
  await serveDirectory(page, state);
  await page.route('**/api/vendors', async r => {
    const body = r.request().postDataJSON();
    requests.push(body);
    return r.fulfill({ json: { vendors: [{ ...state.vendors[0], ...body }] } });
  });
  await page.getByRole('button', { name: /^Vendors(?:\s|$)/ }).click();
  await page.getByRole('button', { name: 'Edit company & contacts', exact: true }).click();
  await page.getByRole('textbox', { name: 'Company address', exact: true }).fill('456 New Address, Cornwall');
  await page.getByRole('button', { name: 'Save company to Portal', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ address: '456 New Address, Cornwall', contact: 'Carter', phone: '6136201169' });
  await expect(page.getByRole('textbox', { name: 'Company address', exact: true })).toHaveValue('456 New Address, Cornwall');
});
