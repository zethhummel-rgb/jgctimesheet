const { test, expect } = require('@playwright/test');
const { directoryState, serveDirectory, openDirectoryJob } = require('./fixtures/job-readability-fixture');

for (const [number, width] of [['26902', 390], ['26901', 1366]]) {
  test(`direct PO with any amount on job ${number} saves, reloads, revises and downloads at ${width}px`, async ({ page }, testInfo) => {
    const state = directoryState();
    const captures = await serveDirectory(page, state);
    await openDirectoryJob(page, number);
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('tab', { name: 'Purchase Orders', exact: true }).click();
    await page.getByRole('button', { name: 'Make a PO', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Create purchase order' });
    await expect(dialog).toContainText('DIRECT JOB PO');
    await expect(dialog.getByLabel(/JGC PO number/)).toHaveValue(number);
    await dialog.getByRole('button', { name: 'Create final PO', exact: true }).click();
    await expect(dialog.getByLabel(/Subcontractor company/)).toBeFocused();
    await dialog.getByLabel(/Subcontractor company/).fill('Budget Test Supply');
    await dialog.getByRole('button', { name: 'Create final PO', exact: true }).click();
    await expect(dialog.getByLabel('Description', { exact: true })).toBeFocused();
    await dialog.getByLabel('Description', { exact: true }).fill('Subcontract installation work our crew cannot get to');
    await dialog.getByRole('button', { name: 'Create final PO', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('above zero');
    await dialog.getByLabel('PO amount (before tax)').fill('3500');
    await dialog.screenshot({ path: testInfo.outputPath(`direct-po-${width}.png`) });
    await dialog.getByRole('button', { name: 'Create final PO', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const table = page.locator('.job-direct-po-table');
    await expect(table).toContainText('$3,500.00');
    await expect(table).toContainText('Final');
    await expect.poll(() => captures.writes.some(s => s.jobs.find(j => j.jobNumber === number).purchaseOrders.length === 1)).toBe(true);
    const saved = captures.writes.at(-1);
    const po = saved.jobs.find(j => j.jobNumber === number).purchaseOrders[0];
    expect(po).toMatchObject({ sourceQuoteId: '', number, status: 'Issued', vendorQuoteNumber: '', revision: 0 });
    expect(po.lines[0]).toMatchObject({ quoteLineId: '', amount: 3500, sourceReference: '' });
    expect(saved.jobs[0].acceptedQuoteSnapshot).toBe(state.jobs[0].acceptedQuoteSnapshot);
    expect(saved.jobs.find(j => j.jobNumber === number).costs).toEqual([]);
    await page.route('**/api/state', route => route.request().method() === 'GET'
      ? route.fulfill({ json: { state: saved, updatedAt: new Date().toISOString() } }) : route.fallback());
    await page.reload();
    if (width < 768) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('button', { name: /^Jobs(?:\s|$)/ }).click();
    await openDirectoryJob(page, number);
    await page.getByRole('tab', { name: 'Purchase Orders', exact: true }).click();
    await expect(table).toContainText('$3,500.00');
    await table.getByRole('button', { name: 'Edit PO', exact: true }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('PO amount (before tax)')).toHaveValue('3500');
    await expect(dialog.getByRole('button', { name: 'No changes to save' })).toBeDisabled();
    await dialog.getByLabel('PO amount (before tax)').fill('3750');
    await dialog.getByRole('button', { name: 'Save as Revision 1', exact: true }).click();
    await expect(table).toContainText('Revision 1 in progress');
    const downloadPromise = page.waitForEvent('download');
    await table.getByRole('button', { name: 'Download & finalize', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain(number);
    await download.saveAs(testInfo.outputPath(`direct-po-${number}.pdf`));
    await expect(table).toContainText('Final');
    await expect.poll(() => { const po = captures.writes.at(-1)?.jobs.find(j => j.jobNumber === number).purchaseOrders[0]; return po ? `${po.revision}:${po.status}` : ''; }).toBe('1:Issued');
    const revised = captures.writes.at(-1).jobs.find(j => j.jobNumber === number).purchaseOrders[0];
    expect(revised).toMatchObject({ sourceQuoteId: '', revision: 1 });
    expect(revised.lines[0].amount).toBe(3750);
    expect(JSON.parse(revised.revisions[0].snapshot).lines[0].amount).toBe(3500);
    expect(captures.jobInfo).toEqual([]);
    expect(captures.unexpectedRequests).toEqual([]);
    await table.screenshot({ path: testInfo.outputPath(`saved-direct-po-${width}.png`) });
  });
}

test('cancelling a direct job PO leaves no commitment', async ({ page }) => {
  const captures = await serveDirectory(page, directoryState());
  await openDirectoryJob(page, '26903');
  await page.getByRole('tab', { name: 'Purchase Orders', exact: true }).click();
  await page.getByRole('button', { name: 'Make a PO', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.subcontract-po-panel .po-count-chip')).toHaveText('0 POs');
  expect(captures.writes.flatMap(s => s.jobs.flatMap(j => j.purchaseOrders))).toEqual([]);
});
