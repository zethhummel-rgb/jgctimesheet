const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");

function jobCostingState() {
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
    quotes: [{
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
      lines: [],
      acknowledgedWarnings: {},
      revisions: [],
      createdAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-01T12:00:00.000Z",
      sentAt: "2026-09-01T12:00:00.000Z",
      wonAt: "2026-09-01T13:00:00.000Z",
      acceptedBy: "Client",
      customerPo: "",
      lostReason: "",
    }],
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
      approvedRevenueChanges: 0,
      approvedCostChanges: 0,
      estimateToComplete: 3000,
      acceptedAt: "2026-09-01T13:00:00.000Z",
      costs: [{ id: "manual-material", date: "2026-09-02", type: "Material", section: "Materials", vendor: "Supplier", reference: "INV-1", hours: 0, preTaxAmount: 250, hstAmount: 0, paid: true, notes: "" }],
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
  await expect(page.locator(".jobs-table tbody tr")).toContainText("$922.00");
  await expect(page.locator(".jobs-table tbody tr")).toContainText("15");
  await page.locator(".jobs-table tbody tr").click();

  await expect(page.getByRole("heading", { name: "Employee labour" })).toBeVisible();
  await expect(page.locator(".portal-labour-panel")).toContainText("$672.00");
  await expect(page.locator(".portal-labour-panel")).toContainText("employee one");
  await expect(page.locator(".portal-labour-panel")).toContainText("Current · not submitted");
  await expect(page.locator(".portal-labour-panel")).toContainText("3 h missing");
  await expect(page.locator(".job-kpi-grid")).toContainText("$922.00");
  await expect(page.locator(".job-kpi-grid")).toContainText("13 submitted · 2 current");
  await expect(page.getByRole("heading", { name: "Other actual costs" })).toBeVisible();

  await page.getByRole("button", { name: "Refresh labour" }).click();
  await expect.poll(() => costingRequests).toBe(2);

  await page.setViewportSize({ width: 390, height: 844 });
  const labourPanel = page.locator(".portal-labour-panel");
  await expect(labourPanel).toBeVisible();
  expect(await labourPanel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

  await page.getByRole("textbox", { name: "Estimate follow-up notes" }).fill("Updated without persisting payroll snapshots");
  await expect.poll(() => savedStates.length).toBeGreaterThan(0);
  expect(JSON.stringify(savedStates.at(-1))).not.toContain("loadedLabourCost");
  expect(JSON.stringify(savedStates.at(-1))).not.toContain("workerProfileId");
});
