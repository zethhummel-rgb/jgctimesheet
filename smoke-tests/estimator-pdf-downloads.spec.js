const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function extractPdfPagesText(pdfPath) {
  const pdfJsPath = path.resolve(__dirname, "../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjs = await import(pathToFileURL(pdfJsPath).href);
  const document = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), disableWorker: true }).promise;
  const pages = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return pages;
}

async function extractPdfText(pdfPath) {
  return (await extractPdfPagesText(pdfPath)).join("\n");
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
  await page.waitForTimeout(50);
  const labour = page.locator(".labour-group .build-up-row").last();
  await labour.getByLabel("Labour description").fill("Four-person framing crew");
  await page.waitForTimeout(50);
  await labour.getByLabel(/quantity/).fill("80");
  await page.waitForTimeout(50);
  await labour.getByLabel(/unit cost/).fill("120");
  await expect(labour.getByText("$9,600.00")).toBeVisible();

  await page.getByRole("button", { name: "Manual material" }).click();
  const material = page.locator(".material-group .build-up-row").last();
  await material.getByLabel("Material description").fill("2x12x16 SPF");
  await page.waitForTimeout(50);
  await material.getByLabel(/quantity/).fill("50");
  await page.waitForTimeout(50);
  await material.getByLabel(/unit cost/).fill("38.45");
  await expect(material.getByText("$1,922.50")).toBeVisible();

  const directUnitCostCell = expandedLine.locator("td.direct-unit-cost-cell");
  await expect(directUnitCostCell).toHaveCSS("background-color", "rgb(220, 241, 231)");
  await expect(directUnitCostCell.locator("input")).toHaveCSS("font-weight", "800");

  await page.locator(".subcontractor-add-button").click();
  const typedVendorLine = page.locator(".estimate-table tbody > tr.expanded:not(.line-detail-row)");
  await typedVendorLine.getByRole("combobox", { name: /Vendor for line/ }).fill("Agway Metals Inc.");
  await page.waitForTimeout(50);
  await typedVendorLine.locator(".direct-unit-cost-cell input").fill("2580");
  await page.locator(".line-detail-panel").getByLabel(/Subcontractor quote #/).fill("AG-2026-15");
  await page.waitForTimeout(50);

  const [estimateDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Estimate Only PDF" }).click(),
  ]);
  expect(estimateDownload.suggestedFilename()).toMatch(/^Estimate - JGC-Q-2026-0001 - .+\.pdf$/);
  const estimatePath = testInfo.outputPath("estimate-only.pdf");
  await estimateDownload.saveAs(estimatePath);
  const estimateText = await extractPdfText(estimatePath);
  for (const heading of ["DIVISION", "DESCRIPTION / VENDOR", "QTY / UNIT", "LABOUR", "MATERIALS", "DIRECT COST"]) {
    expect(estimateText).toContain(heading);
  }
  expect(estimateText).toContain("Stairwell framing");
  expect(estimateText.match(/Agway Metals Inc\./g)).toHaveLength(1);
  expect(estimateText).toContain("AG-2026-15");
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

  await page.getByRole("button", { name: "Built-up item" }).click();
  const wholeCostLine = page.locator(".estimate-table tbody > tr.expanded:not(.line-detail-row)");
  await wholeCostLine.locator("input.description-input").fill("Whole-number built-up item");
  await page.waitForTimeout(50);
  const wholeCostLabour = page.locator(".labour-group .build-up-row").last();
  await wholeCostLabour.getByLabel("Labour description").fill("Small crew");
  await page.waitForTimeout(50);
  await wholeCostLabour.getByLabel(/quantity/).fill("1");
  await page.waitForTimeout(50);
  await wholeCostLabour.getByLabel(/unit cost/).fill("100");
  await expect(wholeCostLabour.getByText("$100.00")).toBeVisible();

  await page.getByRole("tab", { name: /Breakdown/ }).click();
  const [breakdownDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Breakdown PDF" }).click(),
  ]);
  expect(breakdownDownload.suggestedFilename()).toMatch(/^Breakdown - JGC-Q-2026-0001 - .+\.pdf$/);
  const breakdownPath = testInfo.outputPath("breakdown.pdf");
  await breakdownDownload.saveAs(breakdownPath);
  const breakdownPages = await extractPdfPagesText(breakdownPath);
  expect(breakdownPages.length).toBeGreaterThan(0);
  breakdownPages.forEach((pageText) => expect(pageText).toContain("BREAKDOWN"));
  const stairwellPage = breakdownPages.find((pageText) => pageText.includes("Stairwell framing"));
  const wholeCostPage = breakdownPages.find((pageText) => pageText.includes("Whole-number built-up item"));
  expect(stairwellPage).toContain("Built-up unit cost");
  expect(wholeCostPage).toContain("Direct cost");
  expect(wholeCostPage).not.toContain("Built-up unit cost");
  breakdownPages.forEach((pageText) => {
    expect(pageText).not.toContain("Markup");
    expect(pageText).not.toContain("Final selling price");
  });

  const packageDownloads = [];
  page.on("download", (download) => packageDownloads.push(download.suggestedFilename()));
  await page.getByRole("button", { name: "Download Proposal, Estimate, Breakdown" }).click();
  await expect.poll(() => packageDownloads.length).toBe(3);
  expect(packageDownloads.some((name) => name.startsWith("Estimate - "))).toBe(true);
  expect(packageDownloads.some((name) => name.startsWith("Breakdown - "))).toBe(true);
  expect(packageDownloads.some((name) => !name.startsWith("Estimate - ") && !name.startsWith("Breakdown - "))).toBe(true);
});

test("quote package omits an empty Breakdown PDF", async ({ page }) => {
  await openDemoQuote(page);
  const downloads = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await page.getByRole("button", { name: "Download Proposal, Estimate, Breakdown" }).click();
  await expect.poll(() => downloads.length).toBe(2);
  await page.waitForTimeout(400);
  expect(downloads).toHaveLength(2);
  expect(downloads.some((name) => name.startsWith("Breakdown - "))).toBe(false);
});
