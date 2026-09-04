const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { test, expect } = require("@playwright/test");

async function extractPdfText(pdfPath) {
  const pdfJsPath = path.resolve(__dirname, "../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjs = await import(pathToFileURL(pdfJsPath).href);
  const document = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), disableWorker: true }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return pages.join("\n");
}

function estimateLine(overrides = {}) {
  return {
    id: "line-base",
    section: "General",
    division: "Division 09 – Finishes",
    divisionManual: false,
    priceBookCode: null,
    description: "Base contract work",
    internalScope: "",
    classification: "Required",
    included: true,
    costType: "Labour",
    quantity: 1,
    unit: "LS",
    catalogCost: null,
    projectCost: 5000,
    markupOverride: null,
    priceOverride: null,
    vendorId: null,
    vendorName: "",
    vendorReference: "",
    vendorQuoteDate: "",
    vendorQuoteExpiry: "",
    vendorPricingMode: "Quoted",
    vendorActualCost: null,
    vendorOverrideCost: null,
    liveQuote: false,
    confidence: "Project-specific",
    low: null,
    high: null,
    sourceNote: "",
    customerNote: "",
    internalNote: "",
    ...overrides,
  };
}

function baseQuote() {
  return {
    id: "quote-base",
    number: "JGC-Q-2026-0025",
    revision: 0,
    status: "Won",
    clientId: "client-1",
    site: "Brockville Station",
    address: "1 Station Street, Brockville",
    project: "Vacant Lot Clean up",
    reference: "BASE-25",
    preparedBy: "Zeth Hummel",
    ownerUserId: "local-dev",
    ownerName: "Zeth Hummel",
    quoteDate: "2026-09-01",
    validUntil: "2026-10-01",
    quoteType: "Fixed Price",
    customerQuoteType: "Proposal Quote",
    taxName: "HST",
    taxRate: 0.13,
    defaultMarkup: 0.2,
    targetMargin: 0.15,
    depositPercent: 0,
    proposalStyle: "jgc-classic",
    proposalTaxDisplay: "extra",
    proposalScope: "Complete the base contract work.",
    proposalClosingScopeRemoved: true,
    proposalNotes: "",
    proposalAttention: "Pat Client",
    proposalAttentionContactId: "",
    proposalShowCostBreakdown: false,
    proposalBreakdownCategories: [],
    proposalBreakdownLineIds: [],
    proposalBreakdownIncludesMarkup: true,
    scopeSummary: "",
    inclusions: "",
    exclusions: "",
    terms: "Proposal terms",
    internalNotes: "",
    lines: [estimateLine()],
    acknowledgedWarnings: {},
    revisions: [],
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    sentAt: "2026-09-01T12:00:00.000Z",
    wonAt: "2026-09-01T13:00:00.000Z",
    acceptedBy: "Pat Client",
    customerPo: "",
    lostReason: "",
    documentKind: "Quote",
  };
}

function changeNotice() {
  return {
    ...baseQuote(),
    id: "change-1",
    number: "26128-CCN-001",
    revision: 0,
    status: "Finished",
    reference: "RFP-17",
    projectCost: undefined,
    preparedBy: "Jeff Vandrish",
    ownerUserId: "jeff",
    ownerName: "Jeff Vandrish",
    quoteDate: "2026-09-03",
    validUntil: "2026-10-03",
    proposalScope: "Supply and install the additional door.",
    scopeSummary: "Additional door",
    lines: [estimateLine({
      id: "change-sub-line",
      description: "Additional hollow metal door",
      costType: "Sub / Vendor",
      projectCost: 2000,
      vendorId: "vendor-1",
      vendorName: "Ottawa Door Corp",
      vendorReference: "OD-442",
      vendorActualCost: 2000,
    })],
    sentAt: "2026-09-03T14:00:00.000Z",
    wonAt: "",
    acceptedBy: "",
    documentKind: "Change Notice",
    jobId: "job-1",
    changeSequence: 1,
    changeTitle: "Additional hollow metal door",
    changeStatus: "Ready",
    changeRequestedBy: "Consultant",
    changeRequestedDate: "2026-09-02",
    changeDueDate: "2026-09-09",
    changeOrder: null,
    changeOrderHistory: [],
  };
}

function workspaceState({ withChange = false } = {}) {
  const quote = baseQuote();
  return {
    version: 13,
    settings: {
      companyName: "John Gordon Construction Inc.",
      appName: "JGC Estimate Desk",
      defaultMarkup: 0.2,
      targetMargin: 0.15,
      taxName: "HST",
      taxRate: 0.13,
      quotePrefix: "JGC-Q",
      nextQuoteNumber: 100,
      defaultValidityDays: 30,
      defaultProposalStyle: "jgc-classic",
      defaultProposalTaxDisplay: "extra",
      companyPhone: "(613) 932-1293",
      companyFax: "(613) 937-3656",
      companyAddress: "830 Campbell St. Unit 3",
      companyCity: "Cornwall, Ontario",
      companyPostalCode: "K6H 6L7",
      signatoryName: "Zeth Hummel",
      proposalIntro: "Proposal introduction",
      proposalTerms: "Proposal terms",
    },
    clients: [{ id: "client-1", name: "Via Rail Canada", contact: "Pat Client", email: "pat@example.com", phone: "", contacts: [], sites: [{ id: "site-1", label: "Brockville Station", address: "1 Station Street, Brockville" }], notes: "" }],
    vendors: [{ id: "vendor-1", name: "Ottawa Door Corp", trade: "Doors", category: "Subcontractor", contact: "Door Contact", email: "door@example.com", phone: "613-555-0100", status: "Active", notes: "" }],
    priceBook: [],
    quotes: withChange ? [changeNotice(), quote] : [quote],
    jobs: [{
      id: "job-1",
      jobNumber: "26128",
      quoteId: quote.id,
      clientId: quote.clientId,
      project: quote.project,
      status: "Active",
      portalJobId: "portal-job-1",
      portalActive: true,
      portalLastSyncedAt: "2026-09-01T13:00:00.000Z",
      archivedAt: "",
      acceptedRevenue: 6000,
      originalCostBudget: 5000,
      acceptedQuoteRevision: 0,
      acceptedQuoteSnapshot: JSON.stringify(quote),
      approvedRevenueChanges: 0,
      approvedCostChanges: 0,
      estimateToComplete: 5000,
      acceptedAt: "2026-09-01T13:00:00.000Z",
      costs: [],
      purchaseOrders: [],
      notes: "",
    }],
    activity: [],
  };
}

async function openJob(page) {
  await page.getByRole("button", { name: /Jobs/ }).click();
  await page.getByLabel("Search jobs").fill("26128");
  await page.locator(".jobs-table tbody tr").click();
  await expect(page.locator(".job-detail-page")).toContainText("JOB 26128");
}

async function serveState(page, state, savedStates) {
  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "PUT") {
      savedStates.push(route.request().postDataJSON().state);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ saved: true, updatedAt: new Date().toISOString() }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state, updatedAt: "2026-09-04T12:00:00.000Z" }) });
  });
  await page.route("**/api/job-costing", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ actuals: [] }) }));
}

test("a job can create a numbered CCN without adding it to the regular quote list", async ({ page }) => {
  const savedStates = [];
  await serveState(page, workspaceState(), savedStates);
  await page.goto("/estimating/index.html?dev=1");
  await openJob(page);

  await page.getByRole("button", { name: /New CCN/ }).click();
  const dialog = page.getByRole("dialog", { name: "New Change Notice" });
  await dialog.getByLabel(/Change title/).fill("Additional hollow metal door");
  await dialog.getByLabel("Requested by").fill("Consultant");
  await dialog.getByLabel("Customer / RFP reference").fill("RFP-17");
  await dialog.getByRole("button", { name: "Create CCN" }).click();

  await expect(page.locator(".quote-workspace")).toContainText("26128-CCN-001");
  await expect(page.locator(".quote-workspace")).toContainText("Additional hollow metal door");
  await expect(page.locator(".change-status-pill")).toHaveText(/Pricing/);
  await page.getByRole("button", { name: "Job changes" }).click();
  await expect(page.locator(".change-register-panel")).toContainText("26128-CCN-001");
  await expect(page.locator(".change-register-panel")).toContainText("$0.00");

  await page.getByRole("button", { name: /Quotes/ }).click();
  await expect(page.locator("body")).not.toContainText("26128-CCN-001");
  await expect.poll(() => savedStates.length).toBeGreaterThan(0);
  expect(savedStates.some((saved) => saved.quotes.some((item) => item.number === "26128-CCN-001" && item.documentKind === "Change Notice"))).toBeTruthy();
});

test("approving a CCN creates a tracked CO, updates job totals and exposes its subcontractor line for a PO", async ({ page }, testInfo) => {
  const savedStates = [];
  await serveState(page, workspaceState({ withChange: true }), savedStates);
  await page.goto("/estimating/index.html?dev=1");
  await openJob(page);
  await page.getByRole("button", { name: "Open CCN" }).click();

  await page.getByRole("button", { name: "Mark submitted" }).click();
  await expect(page.locator(".change-status-pill")).toHaveText(/Submitted/);
  await page.getByRole("button", { name: "Approve & create CO" }).click();
  const approval = page.getByRole("dialog", { name: "Approve and create Change Order" });
  await expect(approval.getByLabel(/JGC Change Order number/)).toHaveValue("26128-CO-001");
  await approval.getByLabel(/Approved by/).fill("Pat Client");
  await approval.getByLabel("Customer approval reference").fill("EMAIL-778");
  await approval.getByRole("button", { name: "Approve & create CO" }).click();
  await expect(page.locator(".change-status-pill")).toHaveText(/Approved/);

  await page.getByRole("tab", { name: /Change proposal/ }).click();
  await expect(page.locator(".proposal-paper")).toContainText("Change Order");
  await expect(page.locator(".proposal-paper")).toContainText("26128-CO-001");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Change Proposal PDF" }).click(),
  ]);
  const pdfPath = testInfo.outputPath("approved-change-order.pdf");
  await download.saveAs(pdfPath);
  const pdfText = await extractPdfText(pdfPath);
  expect(pdfText).toContain("Change Order");
  expect(pdfText).toContain("26128-CO-001");
  expect(pdfText).toContain("Additional hollow metal door");

  await page.getByRole("button", { name: "Job changes" }).click();
  const register = page.locator(".change-register-panel");
  await expect(register).toContainText("26128-CO-001");
  await expect(register).toContainText("$2,400.00");
  await expect(register).toContainText("$8,400.00");
  const poPanel = page.locator(".subcontract-po-panel");
  await expect(poPanel).toContainText("26128-CCN-001");
  await expect(poPanel).toContainText("Ottawa Door Corp");
  await expect(poPanel.getByRole("button", { name: "Create PO" })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(register.getByRole("button", { name: "New CCN" })).toBeVisible();
  await expect(register).toContainText("26128-CO-001");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("job-change-register-mobile.png"), fullPage: true });

  await expect.poll(() => savedStates.length).toBeGreaterThan(0);
  const approvedState = savedStates.at(-1);
  expect(approvedState.jobs[0].approvedRevenueChanges).toBe(2400);
  expect(approvedState.jobs[0].approvedCostChanges).toBe(2000);
  expect(approvedState.quotes.find((item) => item.id === "change-1").changeOrder.coNumber).toBe("26128-CO-001");
});
