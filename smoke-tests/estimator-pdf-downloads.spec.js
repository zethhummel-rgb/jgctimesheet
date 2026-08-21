const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function extractPdfText(pdfPath) {
  const pdfJsPath = path.resolve(__dirname, "../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjs = await import(pathToFileURL(pdfJsPath).href);
  const document = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), disableWorker: true }).promise;
  const pages = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return pages.join("\n");
}

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

  const expandedLine = page.locator(".estimate-table tbody > tr.expanded:not(.line-detail-row)");
  const description = expandedLine.locator("input.description-input");
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

  const directUnitCostCell = expandedLine.locator("td.direct-unit-cost-cell");
  await expect(directUnitCostCell).toHaveCSS("background-color", "rgb(220, 241, 231)");
  await expect(directUnitCostCell.locator("input")).toHaveCSS("font-weight", "800");

  const [estimateDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Estimate Only PDF" }).click(),
  ]);
  expect(estimateDownload.suggestedFilename()).toMatch(/ - Estimate\.pdf$/);
  const estimatePath = testInfo.outputPath("estimate-only.pdf");
  await estimateDownload.saveAs(estimatePath);
  const estimateText = await extractPdfText(estimatePath);
  for (const heading of ["DIVISION", "DESCRIPTION / VENDOR", "QTY / UNIT", "LABOUR", "MATERIALS", "DIRECT COST"]) {
    expect(estimateText).toContain(heading);
  }
  expect(estimateText).toContain("Stairwell framing");
  expect(estimateText).toContain("$9,600.00");
  expect(estimateText).toContain("$1,922.50");
  expect(estimateText).toMatch(/Stairwell framing.*\$9,600\.00.*\$1,922\.50.*\$11,523\.00/);
  expect(estimateText).toContain("Included direct cost");
  expect(estimateText).toContain("Markup %");
  expect(estimateText).toContain("Markup amount");
  expect(estimateText).toContain("Total");
  for (const removedLabel of ["UNIT COST", "CLASS", "Gross profit", "Pre-tax quote", "HST 13%", "Customer total"]) {
    expect(estimateText).not.toContain(removedLabel);
  }

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
