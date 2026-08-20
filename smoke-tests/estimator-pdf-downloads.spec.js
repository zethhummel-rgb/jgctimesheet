const { test, expect } = require("@playwright/test");

async function openDemoQuote(page) {
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: "Company-wide" }).click();
  await page.getByRole("searchbox", { name: "Search estimates and jobs" }).fill("Lancaster");
  await page.locator(".overview-result-group > button").filter({ hasText: "JGC-Q-2026-0001" }).click();
}

test("Estimate and Breakdown buttons download separate internal PDFs", async ({ page }, testInfo) => {
  await openDemoQuote(page);
  await page.getByRole("tab", { name: /Estimate/ }).click();
  await page.getByRole("button", { name: "Built-up item" }).click();

  const description = page.locator("input.description-input").last();
  await description.fill("Stairwell framing");
  const labour = page.locator(".labour-group .build-up-row").last();
  await labour.getByLabel("Labour description").fill("Four-person framing crew");
  await labour.getByLabel(/quantity/).fill("80");
  await labour.getByLabel(/unit cost/).fill("120");

  await page.getByRole("button", { name: "Manual material" }).click();
  const material = page.locator(".material-group .build-up-row").last();
  await material.getByLabel("Material description").fill("2x12x16 SPF");
  await material.getByLabel(/quantity/).fill("50");
  await material.getByLabel(/unit cost/).fill("38.45");

  const [estimateDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Estimate Only PDF" }).click(),
  ]);
  expect(estimateDownload.suggestedFilename()).toMatch(/ - Estimate\.pdf$/);
  await estimateDownload.saveAs(testInfo.outputPath("estimate-only.pdf"));

  await page.getByRole("tab", { name: /Breakdown/ }).click();
  const [breakdownDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Breakdown PDF" }).click(),
  ]);
  expect(breakdownDownload.suggestedFilename()).toMatch(/ - Breakdown\.pdf$/);
  await breakdownDownload.saveAs(testInfo.outputPath("breakdown.pdf"));

  const packageDownloads = [];
  page.on("download", (download) => packageDownloads.push(download.suggestedFilename()));
  await page.getByRole("button", { name: "Download Proposal, Estimate, Breakdown" }).click();
  await expect.poll(() => packageDownloads.length).toBe(3);
  expect(packageDownloads.some((name) => name.endsWith(" - Estimate.pdf"))).toBe(true);
  expect(packageDownloads.some((name) => name.endsWith(" - Breakdown.pdf"))).toBe(true);
  expect(packageDownloads.some((name) => !name.includes(" - Estimate") && !name.includes(" - Breakdown"))).toBe(true);
});

test("quote package omits an empty Breakdown PDF", async ({ page }) => {
  await openDemoQuote(page);
  const downloads = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await page.getByRole("button", { name: "Download Proposal, Estimate, Breakdown" }).click();
  await expect.poll(() => downloads.length).toBe(2);
  await page.waitForTimeout(400);
  expect(downloads).toHaveLength(2);
  expect(downloads.some((name) => name.endsWith(" - Breakdown.pdf"))).toBe(false);
});
