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

async function extractPdfPageItems(pdfPath, pageNumber = 1) {
  const pdfJsPath = path.resolve(__dirname, "../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjs = await import(pathToFileURL(pdfJsPath).href);
  const document = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), disableWorker: true }).promise;
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((item) => ({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width }));
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

async function finishAndReopenAsRevisionOne(page) {
  await page.getByRole("tab", { name: /Review/ }).click();
  const warningButton = page.locator(".readiness-checks").getByRole("button", { name: /Acknowledge reviewed warnings/ });
  if (await warningButton.count()) await warningButton.click();
  await page.locator(".readiness-checks").getByRole("button", { name: "Finish quote" }).click();
  const finishDialog = page.getByRole("dialog", { name: /Mark .* as Finished/ });
  if (await finishDialog.count()) await finishDialog.getByRole("button", { name: "Finish quote" }).click();
  await expect(page.getByRole("button", { name: "Re-open quote" })).toBeVisible();
  await page.getByRole("button", { name: "Re-open quote" }).click();
  await page.getByRole("dialog", { name: "Re-open as Revision 1?" }).getByRole("button", { name: "Create Revision 1" }).click();
  await expect(page.getByText("JGC-Q-2026-0001 · REV 1")).toBeVisible();
}

test("Purchase Order PDF keeps long names inside their panels and uses a descriptive filename", async ({ page }, testInfo) => {
  const sourceAssets = path.resolve(__dirname, "../estimating/assets");
  const purchaseOrderModule = fs.readdirSync(sourceAssets).find((name) => /^purchase-order-pdf-.*\.js$/.test(name));
  expect(purchaseOrderModule).toBeTruthy();
  const options = {
    state: {
      settings: {
        companyName: "John Gordon Construction Inc.",
        companyPhone: "(613) 932-1293",
        companyFax: "(613) 937-3656",
        companyAddress: "830 Campbell St. Unit 3",
        companyCity: "Cornwall, Ontario",
        companyPostalCode: "K6H 6L7",
        signatoryName: "Zeth Hummel",
      },
      quotes: [{ id: "quote-1", site: "Brockville Station" }],
      clients: [{ id: "client-1", name: "Via Rail Canada" }],
    },
    job: { id: "job-1", jobNumber: "26122", project: "Public Washroom Occupancy Light", quoteId: "quote-1", clientId: "client-1" },
    purchaseOrder: {
      number: "26122",
      vendorName: "Industrial Electric Contractors Brockville Limited",
      vendorContact: "Andrew Jarvo",
      vendorEmail: "ajarvo@iecbl.ca",
      vendorPhone: "6138897236",
      vendorQuoteNumber: "2026-0826-01",
      issueDate: "2026-08-28",
      shipBy: "Your Means",
      shipVia: "Your Means",
      fob: "Job Site",
      shipTo: "Brockville Station",
      authorizedBy: "Zeth Hummel",
      taxRate: 0.13,
      notes: "The purchase order number must appear on all invoices and documents relating to this order.",
      lines: [{ description: "Industrial Electric Contractors Brockville Limited", sourceReference: "2026-0826-01", quantity: 1, unit: "LS", unitCost: 1971, amount: 1971 }],
    },
  };
  await page.goto("/estimating/index.html?dev=1");
  const result = await page.evaluate(async ({ modulePath, pdfOptions }) => {
    const { createPurchaseOrderPdf, purchaseOrderPdfFilename } = await import(modulePath);
    return {
      bytes: Array.from(await createPurchaseOrderPdf(pdfOptions)),
      filename: purchaseOrderPdfFilename(pdfOptions),
    };
  }, { modulePath: `/estimating/assets/${purchaseOrderModule}`, pdfOptions: options });
  const pdfPath = testInfo.outputPath("long-purchase-order.pdf");
  fs.writeFileSync(pdfPath, Buffer.from(result.bytes));
  const items = await extractPdfPageItems(pdfPath);
  const vendorItems = items.filter((item) => item.y >= 550 && item.y <= 575 && /Industrial|Brockville Limited/.test(item.text));
  const jobItems = items.filter((item) => item.y >= 560 && item.y <= 580 && /Public Washroom|Occupancy Light/.test(item.text));
  const dateItem = items.find((item) => item.text === "August 28, 2026");
  expect(vendorItems.map((item) => item.text).join(" ")).toContain("Industrial Electric Contractors Brockville Limited");
  expect(jobItems.map((item) => item.text).join(" ")).toContain("Public Washroom Occupancy Light");
  expect(vendorItems.every((item) => item.x >= 52 && item.x + item.width <= 282)).toBe(true);
  expect(jobItems.every((item) => item.x >= 318 && item.x + item.width <= 560)).toBe(true);
  expect(dateItem).toBeTruthy();
  expect(dateItem.y).toBeGreaterThanOrEqual(504);
  expect(result.filename).toBe("JGC-PO-26122 - Industrial Electric Contractors Brockville Limited - Public Washroom Occupancy Light.pdf");
});

test("Estimate and Breakdown buttons download separate internal PDFs", async ({ page }, testInfo) => {
  await openDemoQuote(page);
  await page.getByRole("tab", { name: /Estimate/ }).click();
  await page.getByRole("button", { name: "Built-up item" }).click();

  const expandedLine = page.locator(".estimate-table tbody > tr.expanded:not(.line-detail-row)");
  const description = expandedLine.locator("input.description-input");
  await description.fill("Stairwell framing");
  await expandedLine.locator("select.division-input").selectOption({ label: "Division 03 – Concrete" });
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
  await typedVendorLine.locator("select.division-input").selectOption({ label: "Division 03 – Concrete" });
  await page.waitForTimeout(50);
  await typedVendorLine.locator(".direct-unit-cost-cell input").fill("2580");
  await typedVendorLine.getByLabel(/Subcontractor quote #/).fill("AG-2026-15");
  await page.waitForTimeout(50);

  await page.locator(".subcontractor-add-button").click();
  const divisionOneVendorLine = page.locator(".estimate-table tbody > tr.expanded:not(.line-detail-row)");
  await divisionOneVendorLine.getByRole("combobox", { name: /Vendor for line/ }).fill("Division One Mechanical");
  await divisionOneVendorLine.locator("select.division-input").selectOption({ label: "Div 01 – General Requirements" });
  await divisionOneVendorLine.locator(".direct-unit-cost-cell input").fill("600");
  await page.waitForTimeout(50);

  await page.getByRole("button", { name: /Custom line/ }).click();
  const divisionOneGeneralLine = page.locator(".estimate-table tbody > tr.expanded:not(.line-detail-row)");
  await divisionOneGeneralLine.locator("input.description-input").fill("Division one site setup");
  await divisionOneGeneralLine.locator("select.division-input").selectOption({ label: "Div 01 – General Requirements" });
  await divisionOneGeneralLine.locator(".direct-unit-cost-cell input").fill("350");
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
  const divisionOneVendorIndex = estimateText.indexOf("Division One Mechanical");
  const divisionThreeVendorIndex = estimateText.indexOf("Agway Metals Inc.");
  const divisionOneGeneralIndex = estimateText.indexOf("Division one site setup");
  const divisionThreeGeneralIndex = estimateText.indexOf("Stairwell framing");
  expect(divisionOneVendorIndex).toBeGreaterThan(-1);
  expect(divisionOneVendorIndex).toBeLessThan(divisionThreeVendorIndex);
  expect(divisionThreeVendorIndex).toBeLessThan(divisionOneGeneralIndex);
  expect(divisionOneGeneralIndex).toBeLessThan(divisionThreeGeneralIndex);
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

  await page.getByRole("button", { name: "Download PDFs" }).click();
  const menu = page.getByRole("dialog", { name: "Download PDFs" });
  await expect(menu).toBeVisible();
  await expect(menu.getByLabel("Proposal PDF filename")).toHaveValue(/^JGC-Q-2026-0001 - .+\.pdf$/);
  await expect(menu.getByLabel("Estimate PDF filename")).toHaveValue(/^Estimate - JGC-Q-2026-0001 - .+\.pdf$/);
  await expect(menu.getByLabel("Breakdown PDF filename")).toHaveValue(/^Breakdown - JGC-Q-2026-0001 - .+\.pdf$/);

  await menu.getByLabel("Proposal PDF filename").fill("Lancaster customer proposal");
  const [menuProposalDownload] = await Promise.all([
    page.waitForEvent("download"),
    menu.getByRole("button", { name: "Download Proposal" }).click(),
  ]);
  expect(menuProposalDownload.suggestedFilename()).toBe("Lancaster customer proposal.pdf");

  const [menuEstimateDownload] = await Promise.all([
    page.waitForEvent("download"),
    menu.getByRole("button", { name: "Download Estimate" }).click(),
  ]);
  expect(menuEstimateDownload.suggestedFilename()).toMatch(/^Estimate - JGC-Q-2026-0001 - .+\.pdf$/);

  const [menuBreakdownDownload] = await Promise.all([
    page.waitForEvent("download"),
    menu.getByRole("button", { name: "Download Breakdown" }).click(),
  ]);
  expect(menuBreakdownDownload.suggestedFilename()).toMatch(/^Breakdown - JGC-Q-2026-0001 - .+\.pdf$/);
  await menu.getByRole("button", { name: "Done" }).click();
  await expect(menu).toBeHidden();
});

test("reopened quote PDFs all carry the editable revision number", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await openDemoQuote(page);
  await page.getByRole("tab", { name: /Estimate/ }).click();
  await page.getByRole("button", { name: "Built-up item" }).click();
  const builtUpLine = page.locator(".estimate-table tbody > tr.expanded:not(.line-detail-row)");
  await builtUpLine.locator("input.description-input").fill("Revision test built-up work");
  const builtUpLabour = page.locator(".labour-group .build-up-row").last();
  await builtUpLabour.getByLabel("Labour description").fill("Revision test crew");
  await builtUpLabour.getByLabel(/quantity/).fill("8");
  await builtUpLabour.getByLabel(/unit cost/).fill("60");
  await finishAndReopenAsRevisionOne(page);
  await page.getByRole("button", { name: "Download PDFs" }).click();
  const menu = page.getByRole("dialog", { name: "Download PDFs" });

  const downloaded = {};
  for (const [kind, buttonName] of [
    ["proposal", "Download Proposal"],
    ["estimate", "Download Estimate"],
    ["breakdown", "Download Breakdown"],
  ]) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      menu.getByRole("button", { name: buttonName }).click(),
    ]);
    expect(download.suggestedFilename()).toContain("Rev 1");
    const output = testInfo.outputPath(`revision-one-${kind}.pdf`);
    await download.saveAs(output);
    downloaded[kind] = await extractPdfText(output);
  }

  expect(downloaded.proposal).toContain("Revision 1");
  expect(downloaded.estimate).toContain("Revision 1");
  expect(downloaded.breakdown).toContain("Revision 1");

  await menu.getByRole("button", { name: "Done" }).click();
  await page.getByRole("tab", { name: /History/ }).click();
  await page.getByRole("button", { name: /Original finished quote/ }).click();
  const savedRevision = page.getByRole("dialog", { name: /Revision 0/ });
  await savedRevision.getByRole("button", { name: "Download saved PDFs" }).click();
  const savedMenu = page.getByRole("dialog", { name: "Download PDFs" });

  for (const [kind, buttonName] of [
    ["proposal", "Download Proposal"],
    ["estimate", "Download Estimate"],
    ["breakdown", "Download Breakdown"],
  ]) {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      savedMenu.getByRole("button", { name: buttonName }).click(),
    ]);
    expect(download.suggestedFilename()).toContain("Rev 0");
    const output = testInfo.outputPath(`saved-original-${kind}.pdf`);
    await download.saveAs(output);
    expect(await extractPdfText(output)).toContain("Revision 0");
  }
});

test("PDF download menu disables an empty Breakdown PDF", async ({ page }) => {
  await openDemoQuote(page);
  await page.getByRole("button", { name: "Download PDFs" }).click();
  const menu = page.getByRole("dialog", { name: "Download PDFs" });
  await expect(menu.getByRole("button", { name: "Download Proposal" })).toBeEnabled();
  await expect(menu.getByRole("button", { name: "Download Estimate" })).toBeEnabled();
  await expect(menu.getByRole("button", { name: "Download Breakdown" })).toBeDisabled();
  await expect(menu).toContainText("Add a built-up estimate item to create this PDF");
});

test("PDF download menu keeps editable filenames on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemoQuote(page);
  await page.getByRole("button", { name: "Download PDFs" }).click();
  const menu = page.getByRole("dialog", { name: "Download PDFs" });
  await expect(menu).toBeVisible();
  await expect(menu.getByLabel("Proposal PDF filename")).toBeVisible();
  await expect(menu.getByLabel("Estimate PDF filename")).toBeVisible();
  await expect(menu.getByLabel("Breakdown PDF filename")).toBeVisible();
  await menu.getByLabel("Estimate PDF filename").fill("Mobile internal estimate.pdf");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    menu.getByRole("button", { name: "Download Estimate" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("Mobile internal estimate.pdf");
  await expect(menu.getByRole("status")).toContainText("Estimate PDF download started");
});

test("Proposal PDF has fillable acceptance and date fields", async ({ page }, testInfo) => {
  await openDemoQuote(page);
  await page.getByRole("tab", { name: /Proposal/ }).click();
  await expect(page.locator(".hybrid-lump-sum")).toHaveCSS("background-color", "rgb(239, 248, 242)");
  await expect(page.locator(".hybrid-lump-sum")).toHaveCSS("color", "rgb(16, 61, 49)");
  const signoffSpacer = page.locator(".hybrid-signoff > div").first();
  await expect(signoffSpacer).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(signoffSpacer).toHaveCSS("border-left-width", "0px");

  const [proposalDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Proposal PDF" }).click(),
  ]);
  const proposalPath = testInfo.outputPath("fillable-proposal.pdf");
  await proposalDownload.saveAs(proposalPath);
  const proposalText = await extractPdfText(proposalPath);
  for (const heading of ["GENERAL CONTRACTOR", "QUOTATION", "QUOTE NUMBER", "PREPARED FOR", "PROJECT SCOPE", "Scope of Work", "ASSUMPTIONS & CLARIFICATIONS", "LUMP SUM PROPOSAL", "Terms", "ACCEPTANCE"]) {
    expect(proposalText).toContain(heading);
  }

  const { PDFDocument } = require("../estimating-app/node_modules/pdf-lib/cjs/index.js");
  const proposalDocument = await PDFDocument.load(fs.readFileSync(proposalPath));
  const fields = proposalDocument.getForm().getFields();
  const signatureField = fields.find((field) => field.getName().startsWith("jgc_acceptance_signature_"));
  const printNameField = fields.find((field) => field.getName().startsWith("jgc_acceptance_print_name_"));
  const dateField = fields.find((field) => field.getName().startsWith("jgc_acceptance_date_"));

  expect(signatureField).toBeTruthy();
  expect(printNameField).toBeTruthy();
  expect(dateField).toBeTruthy();
  expect(signatureField.needsAppearancesUpdate()).toBe(false);
  expect(printNameField.needsAppearancesUpdate()).toBe(false);
  expect(dateField.needsAppearancesUpdate()).toBe(false);

  signatureField.setText("Accepted");
  printNameField.setText("Test Customer");
  dateField.setText("August 21, 2026");
  const filledDocument = await PDFDocument.load(await proposalDocument.save());
  expect(filledDocument.getForm().getTextField(signatureField.getName()).getText()).toBe("Accepted");
  expect(filledDocument.getForm().getTextField(printNameField.getName()).getText()).toBe("Test Customer");
  expect(filledDocument.getForm().getTextField(dateField.getName()).getText()).toBe("August 21, 2026");
});

test("Proposal PDF safely exports pasted inclusion and exclusion characters", async ({ page }, testInfo) => {
  await openDemoQuote(page);
  await page.getByRole("tab", { name: /Details/ }).click();
  await page.getByRole("textbox", { name: "Inclusions" }).fill("Owner’s café fixtures • supplied separately ✅");
  await page.getByRole("textbox", { name: "Exclusions" }).fill("Asbestos — lead… “unknown” 🚫");
  await page.getByRole("tab", { name: /Proposal/ }).click();

  const [proposalDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Proposal PDF" }).click(),
  ]);
  const proposalPath = testInfo.outputPath("safe-inclusions-exclusions.pdf");
  await proposalDownload.saveAs(proposalPath);
  const proposalText = await extractPdfText(proposalPath);
  expect(proposalText).toContain("Owner's cafe fixtures - supplied separately");
  expect(proposalText).toContain('Asbestos - lead... "unknown"');
});

test("Proposal preview and PDF always round the final quote upward to a whole dollar", async ({ page }, testInfo) => {
  await openDemoQuote(page);
  await page.getByRole("tab", { name: /Estimate/ }).click();
  const firstEstimateLine = page.locator(".estimate-table tbody > tr:not(.line-detail-row)").first();
  await firstEstimateLine.locator(".direct-unit-cost-cell input").fill("15000.01");
  await expect(page.locator(".sticky-quote-summary")).toContainText("$27,482.00");

  await page.getByRole("tab", { name: /Proposal/ }).click();
  await expect(page.locator(".hybrid-lump-sum")).toContainText("$27,482.00");
  const [proposalDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Proposal PDF" }).click(),
  ]);
  const proposalPath = testInfo.outputPath("whole-dollar-proposal.pdf");
  await proposalDownload.saveAs(proposalPath);
  const proposalText = await extractPdfText(proposalPath);
  expect(proposalText).toContain("$27,482.00");
  expect(proposalText).not.toContain("$27,481.01");
});

test("proposal cost breakdown combines categories and supports marked-up estimate lines", async ({ page }, testInfo) => {
  await openDemoQuote(page);
  await page.getByRole("tab", { name: /Details/ }).click();

  await page.getByRole("checkbox", { name: /Show cost breakdown on proposal/ }).check();
  await expect(page.locator(".proposal-breakdown-options")).toBeVisible();
  await expect(page.getByText("Selected individual lines are removed from these totals so nothing is counted twice.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /^Subcontractors/ })).toBeChecked();

  await page.getByRole("checkbox", { name: /^Labour/ }).uncheck();
  await page.getByRole("checkbox", { name: /^Materials/ }).uncheck();
  await page.getByRole("tab", { name: /Proposal/ }).click();
  await expect(page.locator(".proposal-cost-breakdown")).toContainText("Subcontractors$20,640.00");
  await page.getByRole("tab", { name: /Details/ }).click();
  await page.getByRole("checkbox", { name: /^Subcontractors/ }).uncheck();
  await page.getByRole("checkbox", { name: /Demo Drywall Vendor — Drywall/ }).check();
  await page.getByRole("checkbox", { name: /Demo Electrical Vendor — Electrical/ }).check();
  await page.getByRole("checkbox", { name: /Demo Painting Vendor — Painting/ }).check();

  await page.getByRole("tab", { name: /Proposal/ }).click();
  const breakdown = page.locator(".proposal-cost-breakdown");
  await expect(breakdown).not.toContainText("Markup included");
  await expect(breakdown).toContainText("Demo Drywall Vendor — Drywall");
  await expect(breakdown).toContainText("Demo Electrical Vendor — Electrical");
  await expect(breakdown).toContainText("Demo Painting Vendor — Painting");
  await expect(breakdown).toContainText("General Conditions/Coordination and Markup");
  await expect(breakdown).toContainText("$1,680.00");
  await expect(breakdown).toContainText("$960.00");
  await expect(breakdown).toContainText("$18,000.00");
  await expect(breakdown.locator(":scope > div")).toHaveCount(4);

  const displayedAmounts = await breakdown.locator(":scope > div strong").allTextContents();
  const proposalTotalText = await breakdown.locator("footer strong").innerText();
  const currencyValue = (value) => Number(value.replace(/[^0-9.-]/g, ""));
  const displayedTotalCents = displayedAmounts.reduce((sum, value) => sum + Math.round(currencyValue(value) * 100), 0);
  expect(displayedTotalCents).toBe(Math.round(currencyValue(proposalTotalText) * 100));

  const [proposalDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Proposal PDF" }).click(),
  ]);
  const proposalPath = testInfo.outputPath("selected-cost-breakdown-proposal.pdf");
  await proposalDownload.saveAs(proposalPath);
  const proposalText = await extractPdfText(proposalPath);
  expect(proposalText).not.toContain("Amounts include markup");
  expect(proposalText).toContain("General Conditions/Coordination and Markup");
  expect(proposalText).toContain("Demo Drywall Vendor");
  expect(proposalText).toContain("Demo Electrical Vendor");
  expect(proposalText).toContain("Demo Painting Vendor");
  expect(proposalText).toContain("$1,680.00");
  expect(proposalText).toContain("$960.00");
  expect(proposalText).toContain("$18,000.00");
});
