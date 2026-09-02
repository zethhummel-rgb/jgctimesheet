const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");

function quoteLine(overrides) {
  return {
    id: "line-default",
    section: "General",
    division: "Div 01 – General Requirements",
    divisionManual: false,
    priceBookCode: null,
    description: "Estimate line",
    internalScope: "",
    classification: "Required",
    included: true,
    costType: "Labour",
    quantity: 1,
    unit: "LS",
    catalogCost: null,
    projectCost: 0,
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

function jobCostingState() {
  const acceptedQuote = {
    id: "quote-costing",
    number: "JGC-Q-2026-0099",
    revision: 0,
    status: "Won",
    clientId: "client-costing",
    site: "Costing Site",
    address: "Cornwall, ON",
    project: "Automatic Labour Costing",
    reference: "COST-TEST",
    preparedBy: "Local QA",
    ownerUserId: "local-qa",
    ownerName: "Local QA",
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
    proposalScope: "Complete the work",
    proposalClosingScopeRemoved: false,
    proposalNotes: "",
    proposalAttention: "",
    proposalAttentionContactId: "",
    proposalShowCostBreakdown: false,
    proposalBreakdownCategories: [],
    proposalBreakdownLineIds: [],
    scopeSummary: "",
    inclusions: "",
    exclusions: "",
    terms: "Proposal terms",
    internalNotes: "",
    lines: [
      quoteLine({
        id: "built-up-labour",
        description: "Built-up installation",
        costType: "Labour & Materials",
        quantity: 2,
        projectCost: null,
        costBuildUp: { items: [
          { id: "labour-row", kind: "Labour", description: "Field labour", quantity: 4, unit: "hr", unitCost: 50, source: "Estimate" },
          { id: "material-row", kind: "Material", description: "Material", quantity: 1, unit: "Each", unitCost: 100, source: "Estimate" },
        ] },
      }),
      quoteLine({ id: "hourly-labour", description: "Additional labour", quantity: 3, unit: "hr", projectCost: 60 }),
      quoteLine({ id: "unsplit-mixed", description: "Unsplit labour and material", costType: "Labour & Materials", projectCost: 200 }),
    ],
    acknowledgedWarnings: {},
    revisions: [],
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    sentAt: "2026-09-01T12:00:00.000Z",
    wonAt: "2026-09-01T13:00:00.000Z",
    acceptedBy: "Client",
    customerPo: "",
    lostReason: "",
  };
  return {
    version: 11,
    settings: {
      companyName: "John Gordon Construction Inc.",
      appName: "JGC Estimate Desk",
      defaultMarkup: 0.2,
      targetMargin: 0.15,
      taxName: "HST",
      taxRate: 0.13,
      quotePrefix: "JGC-Q",
      nextQuoteNumber: 2,
      defaultValidityDays: 30,
      defaultProposalStyle: "jgc-classic",
      defaultProposalTaxDisplay: "extra",
      signatoryName: "Zeth Hummel",
      proposalIntro: "Proposal introduction",
      proposalTerms: "Proposal terms",
    },
    clients: [{ id: "client-costing", name: "Costing Client", contact: "", email: "", phone: "", sites: [], notes: "" }],
    vendors: [],
    priceBook: [],
    quotes: [acceptedQuote],
    jobs: [{
      id: "job-costing",
      jobNumber: "26128",
      quoteId: "quote-costing",
      clientId: "client-costing",
      project: "Automatic Labour Costing",
      status: "Active",
      portalJobId: "portal-job-costing",
      portalActive: true,
      portalLastSyncedAt: "2026-09-01T13:00:00.000Z",
      archivedAt: "",
      acceptedRevenue: 10000,
      originalCostBudget: 5000,
      acceptedQuoteRevision: 0,
      acceptedQuoteSnapshot: JSON.stringify(acceptedQuote),
      approvedRevenueChanges: 0,
      approvedCostChanges: 0,
      estimateToComplete: 3000,
      acceptedAt: "2026-09-01T13:00:00.000Z",
      costs: [
        { id: "manual-material", date: "2026-09-02", type: "Material", section: "Materials", vendor: "Supplier", reference: "INV-1", hours: 0, preTaxAmount: 250, hstAmount: 0, paid: true, notes: "" },
        { id: "manual-labour", date: "2026-09-02", type: "Labour", section: "General", vendor: "Adjustment", reference: "LAB-ADJ", hours: 0.5, preTaxAmount: 28, hstAmount: 0, paid: true, notes: "" },
      ],
      purchaseOrders: [],
      notes: "Costing test",
    }],
    activity: [],
  };
}

test("Estimator job costing RPC is admin-only and never returns raw pay rates", () => {
  const migration = fs.readFileSync(path.join(portalRoot, "supabase", "migrations", "20260902111500_estimator_job_labour_actuals_admin_access.sql"), "utf8");
  expect(migration).toContain("security definer");
  expect(migration).toContain("public.is_admin()");
  expect(migration).toContain("revoke all on function public.get_estimator_job_labour_actuals() from public, anon, authenticated");
  expect(migration).toContain("grant execute on function public.get_estimator_job_labour_actuals() to authenticated");
  expect(migration).toContain("* 1.4");
  expect(migration.split("language plpgsql")[0]).not.toContain("regular_rate");
});

test("Portal labour hours and loaded cost appear on the linked Estimator job", async ({ page }) => {
  const savedStates = [];
  let costingRequests = 0;
  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "PUT") {
      savedStates.push(route.request().postDataJSON().state);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ saved: true, updatedAt: new Date().toISOString() }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: jobCostingState(), updatedAt: "2026-09-02T12:00:00.000Z" }) });
  });
  await page.route("**/api/job-costing", async (route) => {
    costingRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      actuals: [
        { portalJobId: "portal-job-costing", jobNumber: "26128", workerProfileId: "worker-one", workerName: "employee one", sourceStatus: "submitted", firstWorkDate: "2026-08-24", lastWorkDate: "2026-08-25", hours: 10, loadedLabourCost: 560, missingRateHours: 0 },
        { portalJobId: "portal-job-costing", jobNumber: "26128", workerProfileId: "worker-one", workerName: "employee one", sourceStatus: "provisional", firstWorkDate: "2026-09-02", lastWorkDate: "2026-09-02", hours: 2, loadedLabourCost: 112, missingRateHours: 0 },
        { portalJobId: "portal-job-costing", jobNumber: "26128", workerProfileId: "worker-two", workerName: "employee without rate", sourceStatus: "submitted", firstWorkDate: "2026-08-26", lastWorkDate: "2026-08-26", hours: 3, loadedLabourCost: 0, missingRateHours: 3 },
      ],
      loadedAt: "2026-09-02T12:00:00.000Z",
    }) });
  });

  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: /Jobs/ }).click();
  await page.getByRole("textbox", { name: "Search jobs" }).fill("26128");
  await expect(page.locator(".jobs-table tbody tr")).toContainText("$950.00");
  await expect(page.locator(".jobs-table tbody tr")).toContainText("15.5");
  await page.locator(".jobs-table tbody tr").click();

  await expect(page.getByRole("heading", { name: "Employee labour" })).toBeVisible();
  await expect(page.locator(".portal-labour-panel")).toContainText("$672.00");
  await expect(page.locator(".portal-labour-panel")).toContainText("employee one");
  await expect(page.locator(".portal-labour-panel")).toContainText("Current · not submitted");
  await expect(page.locator(".portal-labour-panel")).toContainText("3 h missing");
  await expect(page.locator(".job-kpi-grid")).toContainText("$950.00");
  await expect(page.locator(".job-kpi-grid")).toContainText("13 submitted · 2 current · 0.5 adjustment");
  await expect(page.getByRole("heading", { name: "Other actual costs" })).toBeVisible();
  const comparison = page.locator(".labour-comparison-panel");
  await expect(page.getByRole("heading", { name: "Labour budget vs actual" })).toBeVisible();
  await expect(comparison).toContainText("ACCEPTED REV 0");
  await expect(comparison).toContainText("$580.00");
  await expect(comparison).toContainText("$700.00");
  await expect(comparison).toContainText("Over carried labour");
  await expect(comparison).toContainText("$120.00");
  await expect(comparison).toContainText("120.7%");
  await expect(comparison).toContainText("11");
  await expect(comparison).toContainText("15.5");
  await expect(comparison).toContainText("4.5 over");
  await expect(comparison).toContainText("$200.00 across 1 Labour & Materials line is not included");
  await expect(comparison).toContainText("Actual labour cost is incomplete");

  await page.evaluate(() => document.documentElement.setAttribute("data-jgc-theme", "light"));
  await expect(page.locator(".forecast-grand")).toHaveCSS("background-color", "rgb(16, 61, 49)");
  await expect(page.locator(".forecast-grand span")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.locator(".forecast-grand strong")).toHaveCSS("color", "rgb(255, 255, 255)");

  await page.getByRole("button", { name: "Refresh labour" }).click();
  await expect.poll(() => costingRequests).toBe(2);

  await page.setViewportSize({ width: 390, height: 844 });
  const labourPanel = page.locator(".portal-labour-panel");
  await expect(labourPanel).toBeVisible();
  expect(await labourPanel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await comparison.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

  await page.getByRole("textbox", { name: "Estimate follow-up notes" }).fill("Updated without persisting payroll snapshots");
  await expect.poll(() => savedStates.length).toBeGreaterThan(0);
  expect(JSON.stringify(savedStates.at(-1))).not.toContain("loadedLabourCost");
  expect(JSON.stringify(savedStates.at(-1))).not.toContain("workerProfileId");
});
