async function openJob(page) {
  if (!(await page.locator('#poPaperDialog').isVisible())) await page.locator('[data-paper-edit="job"]').first().click();
}
async function manualJob(page, name, number = '') {
  await openJob(page);
  await page.locator('#poPaperManualEntry').click();
  await page.locator('#poPaperManualNumber').fill(number);
  await page.locator('#poPaperManualName').fill(name);
  await page.locator('[data-manual-done]').click();
}
async function to(page, value) {
  await page.locator('[data-paper-edit="to"]').click();
  await page.locator('#poPaperText').fill(value);
  await page.locator('[data-paper-done]').click();
}
async function item(page, quantity, description) {
  await page.locator('#poAddItemButton').click();
  await page.locator('#poPaperQty').fill(String(quantity));
  await page.locator('#poPaperDescription').fill(description);
  await page.locator('[data-paper-done]').click();
}
async function finishJob(page) { await page.locator('[data-paper-done]').click(); }
module.exports = { openJob, manualJob, to, item, finishJob };
