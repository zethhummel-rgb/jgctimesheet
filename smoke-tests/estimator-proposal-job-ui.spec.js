const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { directoryState, serveDirectory, openDirectoryJob } = require('./fixtures/job-readability-fixture');

function quoteState(description = '') {
  const state = directoryState();
  Object.assign(state.quotes[0], {
    status: 'Draft', project: 'Main Gate Operator Replacement and Access Improvements',
    address: '123 Construction Road, Cornwall, Ontario',
    proposalShowCostBreakdown: true, proposalBreakdownCategories: [], proposalBreakdownLineIds: ['vendor-line'],
  });
  state.vendors = [{ id: 'vendor-ui', name: 'Example Gate Company', trade: 'Gates', contact: '', email: '', phone: '', contacts: [], notes: '' }];
  state.quotes[0].lines = [{ id: 'vendor-line', description, quantity: 1, unit: 'LS', costType: 'Sub / Vendor', vendorId: 'vendor-ui', vendorName: 'Example Gate Company', vendorReference: '', vendorActualCost: 2400, vendorOverrideCost: null, projectCost: 2400, catalogCost: null, included: true, division: 'Div 10 – Specialties', section: 'General', classification: 'Required', confidence: 'Project-specific', liveQuote: true, vendorPricingMode: 'Quoted', priceOverride: null, markupOverride: null }];
  return state;
}

async function openQuote(page, state) {
  const captures = await serveDirectory(page, state);
  await openDirectoryJob(page, '26901');
  await page.getByRole('button', { name: 'Open accepted quote', exact: true }).click();
  return captures;
}

async function pdfItems(file) {
  const pdfjs = await import(pathToFileURL(path.resolve(__dirname, '../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableWorker: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => ({ text: item.str, x: item.transform[4], y: item.transform[5], size: item.height })));
  }
  return pages;
}

async function downloadPdf(page, button, file) {
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  await (await promise).saveAs(file);
  return pdfItems(file);
}

test('description is opt-in on the customer breakdown, persists, and appears in the PDF', async ({ page }, testInfo) => {
  test.setTimeout(45000);
  const description = 'Remove existing operator and install a new controlled access system.';
  const captures = await openQuote(page, quoteState(description));
  await page.getByRole('tab', { name: /Proposal/, exact: false }).click();
  const breakdown = page.locator('.proposal-cost-breakdown');
  await expect(breakdown).not.toContainText(description);
  const offPdf = await downloadPdf(page, 'Proposal PDF', testInfo.outputPath('description-off.pdf'));
  expect(offPdf.flat().map(i => i.text).join(' ')).not.toContain(description);
  await page.getByRole('tab', { name: /Details/ }).click();
  const include = page.getByRole('checkbox', { name: /^Include Quote Description/ });
  await include.check();
  await expect.poll(() => captures.writes.at(-1)?.quotes[0].proposalBreakdownDescriptionLineIds).toEqual(['vendor-line']);
  const saved = captures.writes.at(-1);
  await page.route('**/api/state', route => route.request().method() === 'GET' ? route.fulfill({ json: { state: saved, updatedAt: new Date().toISOString() } }) : route.fallback());
  await page.reload();
  await page.getByRole('button', { name: /^Jobs(?:\s|$)/ }).click();
  await openDirectoryJob(page, '26901');
  await page.getByRole('button', { name: 'Open accepted quote', exact: true }).click();
  await page.getByRole('tab', { name: /Details/ }).click();
  await expect(page.getByRole('checkbox', { name: /^Include Quote Description/ })).toBeChecked();
  await page.getByRole('tab', { name: /Proposal/ }).click();
  await expect(breakdown).toContainText(description);
  await expect(breakdown).toContainText('$2,880.00');
  const pages = await downloadPdf(page, 'Proposal PDF', testInfo.outputPath('description-on.pdf'));
  expect(pages.flat().map(i => i.text).join(' ')).toContain(description);
  const first = pages[0];
  const project = first.find(i => i.text.includes('Main Gate'));
  const date = first.find(i => i.text.includes('Sep') && i.size < 7);
  const client = first.find(i => i.text === 'Quoted Contract Client');
  const address = first.find(i => i.text.includes('123 Construction'));
  expect(project.size).toBeGreaterThan(date.size * 1.5);
  expect(address.y).toBeLessThan(client.y);
  expect(address.x).toBeCloseTo(client.x, 1);
  expect(address.size).toBeLessThan(client.size);
  await page.locator('.hybrid-meta').screenshot({ path: testInfo.outputPath('proposal-header-desktop.png') });
  await page.getByRole('tab', { name: /Estimate/ }).click();
  const estimate = await downloadPdf(page, 'Estimate Only PDF', testInfo.outputPath('estimate-header.pdf'));
  const estimateHeader = estimate[0];
  const estimateProject = estimateHeader.find(i => i.text.includes('Main Gate'));
  const estimateDate = estimateHeader.find(i => i.text.includes('Sep') && i.size < 7);
  expect(estimateProject.size).toBeGreaterThan(estimateDate.size * 1.5);
  expect(estimateHeader.find(i => i.text.includes('123 Construction')).y).toBeLessThan(estimateHeader.find(i => i.text === 'Quoted Contract Client').y);
  expect(captures.unexpectedRequests).toEqual([]);
});

test('Finish Quote and reload preserve a blank Vendor/Sub quote description', async ({ page }) => {
  const captures = await openQuote(page, quoteState());
  await page.getByRole('tab', { name: /Estimate/ }).click();
  await expect(page.getByRole('columnheader', { name: 'Vendor', exact: true })).toBeVisible();
  await expect(page.getByLabel('Subcontractor quote description for line 1')).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Vendor for line 1', exact: true })).toHaveValue('Example Gate Company');
  await page.getByRole('button', { name: 'Finish quote', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: /Mark .* as Finished/ });
  if (await confirmation.count()) await confirmation.getByRole('button', { name: 'Finish quote', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Re-open quote', exact: true })).toBeVisible();
  await expect.poll(() => captures.writes.at(-1)?.quotes[0].status).toBe('Finished');
  const saved = captures.writes.at(-1);
  expect(saved.quotes[0].lines[0].description).toBe('');
  await page.route('**/api/state', route => route.request().method() === 'GET' ? route.fulfill({ json: { state: saved, updatedAt: new Date().toISOString() } }) : route.fallback());
  await page.reload();
  await page.getByRole('button', { name: /^Jobs(?:\s|$)/ }).click();
  await openDirectoryJob(page, '26901');
  await page.getByRole('button', { name: 'Open accepted quote', exact: true }).click();
  await page.getByRole('tab', { name: /Estimate/ }).click();
  await expect(page.getByLabel('Subcontractor quote description for line 1')).toHaveValue('');
});

for (const width of [390, 1366]) test(`job status actions are smaller and below primary actions at ${width}px`, async ({ page }, testInfo) => {
  await serveDirectory(page, directoryState());
  await openDirectoryJob(page, '26901');
  await page.setViewportSize({ width, height: 900 });
  const actions = page.locator('.job-action-stack');
  const primary = actions.locator('.quote-primary-actions');
  const secondary = actions.locator('.job-header-status-actions');
  await expect(primary.getByRole('button')).toHaveCount(2);
  await expect(secondary.getByRole('button')).toHaveCount(3);
  const first = await primary.boundingBox(), second = await secondary.boundingBox();
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  expect((await secondary.getByRole('button').first().boundingBox()).height).toBeLessThan((await primary.getByRole('button').first().boundingBox()).height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await actions.screenshot({ path: testInfo.outputPath(`job-actions-${width}.png`) });
});

test('long selected descriptions paginate and the mobile header emphasizes the project', async ({ page }, testInfo) => {
  test.setTimeout(45000);
  const description = Array.from({ length: 90 }, (_, i) => `Scope item ${i + 1}: Install and test the gate controls, wiring, access readers and safety equipment.`).join('\n');
  const state = quoteState(description);
  state.quotes[0].proposalBreakdownDescriptionLineIds = ['vendor-line'];
  await openQuote(page, state);
  await page.getByRole('tab', { name: /Proposal/ }).click();
  const pages = await downloadPdf(page, 'Proposal PDF', testInfo.outputPath('long-description.pdf'));
  expect(pages.length).toBeGreaterThan(2);
  const text = pages.flat().map(i => i.text).join(' ');
  expect(text).toContain('Scope item 90:');
  expect(text).toContain('COST BREAKDOWN - CONTINUED');
  for (const page of pages) for (const item of page.filter(i => i.text.startsWith('Scope item'))) expect(item.y).toBeGreaterThanOrEqual(34);
  await page.setViewportSize({ width: 390, height: 900 });
  const header = page.locator('.hybrid-meta');
  const projectSize = await header.locator('.document-project strong').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  const dateSize = await header.locator('.document-date strong').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  expect(projectSize).toBeGreaterThan(dateSize * 1.5);
  const client = await header.locator('.document-client strong').boundingBox();
  const address = await header.locator('.document-address').boundingBox();
  expect(address.y).toBeGreaterThan(client.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await header.screenshot({ path: testInfo.outputPath('proposal-header-mobile.png') });
  await page.getByRole('tab', { name: /Details/ }).click();
  await page.locator('.proposal-breakdown-line-choice input').uncheck();
  await expect(page.getByRole('checkbox', { name: 'Include Quote Description', exact: true })).toBeDisabled();
  await page.getByRole('tab', { name: /Proposal/ }).click();
  await expect(page.locator('.proposal-cost-breakdown')).not.toContainText('Scope item');
});
