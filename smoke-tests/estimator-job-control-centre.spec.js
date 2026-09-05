const { test, expect } = require("@playwright/test");

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

function acceptedQuote() {
  return {
    id: "quote-job-control",
    number: "JGC-Q-2026-0144",
    revision: 0,
    status: "Won",
    clientId: "client-job-control",
    site: "Brockville Station",
    address: "1 Station Street, Brockville, Ontario",
    project: "Platform Canopy Upgrade",
    reference: "VIA-CANOPY-26",
    preparedBy: "Zeth Hummel",
    ownerUserId: "zeth",
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
    proposalScope: "Complete the platform canopy upgrade.",
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
    lines: [
      estimateLine(),
      estimateLine({
        id: "line-subcontract",
        description: "Supply structural steel",
        costType: "Sub / Vendor",
        projectCost: 3000,
        vendorId: "vendor-steel",
        vendorName: "Eastern Welding",
        vendorReference: "EW-4421",
        vendorActualCost: 3000,
      }),
    ],
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

function jobControlState() {
  const quote = acceptedQuote();
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
      nextQuoteNumber: 145,
      defaultValidityDays: 30,
      defaultProposalStyle: "jgc-classic",
      defaultProposalTaxDisplay: "extra",
      signatoryName: "Zeth Hummel",
      proposalIntro: "Proposal introduction",
      proposalTerms: "Proposal terms",
    },
    clients: [{
      id: "client-job-control",
      name: "Via Rail Canada",
      contact: "Pat Client",
      email: "pat@example.com",
      phone: "",
      contacts: [],
      sites: [{ id: "site-brockville", label: "Brockville Station", address: "1 Station Street, Brockville, Ontario" }],
      notes: "",
    }],
    vendors: [{
      id: "vendor-steel",
      name: "Eastern Welding",
      trade: "Structural steel",
      category: "Subcontractor",
      contact: "",
      email: "",
      phone: "",
      status: "Active",
      notes: "",
    }],
    priceBook: [],
    quotes: [quote],
    jobs: [{
      id: "job-control",
      jobNumber: "26144",
      quoteId: quote.id,
      clientId: quote.clientId,
      project: quote.project,
      status: "Active",
      portalJobId: "portal-job-control",
      portalActive: true,
      portalLastSyncedAt: "2026-09-05T12:00:00.000Z",
      portalJobName: "Brockville Canopy Renewal Contract",
      portalCustomer: "Via Rail Canada",
      portalAddress: "1 Station Street, Brockville, Ontario",
      projectManager: "Jeff Vandrish",
      startDate: "2026-09-14",
      targetEndDate: "2026-11-20",
      documentLink: "",
      documentLinkLabel: "",
      documentLinks: [],
      archivedAt: "",
      acceptedRevenue: 10000,
      originalCostBudget: 8000,
      acceptedQuoteRevision: 0,
      acceptedQuoteSnapshot: JSON.stringify(quote),
      approvedRevenueChanges: 0,
      approvedCostChanges: 0,
      estimateToComplete: 8000,
      acceptedAt: "2026-09-01T13:00:00.000Z",
      costs: [],
      purchaseOrders: [],
      notes: "",
    }],
    activity: [],
  };
}

function jobStatistics() {
  return {
    portalJobId: "portal-job-control",
    jobNumber: "26144",
    generatedAt: "2026-09-05T12:00:00.000Z",
    totalHours: 27,
    employeeCount: 2,
    digitalPoCount: 2,
    dailyReportCount: 2,
    inspectionCount: 1,
    equipmentCount: 2,
    workOrderCount: 2,
    onsiteByDay: [
      { date: "2026-08-31", employees: 2, hours: 16 },
      { date: "2026-09-01", employees: 1, hours: 4 },
      { date: "2026-09-07", employees: 1, hours: 7 },
    ],
    hoursByWeek: [
      { startDate: "2026-08-30", label: "Week of Aug 30", hours: 20 },
      { startDate: "2026-09-06", label: "Week of Sep 6", hours: 7 },
    ],
    hoursByEmployee: [
      { label: "Alice Martin", hours: 14 },
      { label: "Bob Singh", hours: 13 },
    ],
    digitalPurchaseOrders: [
      { id: "digital-po-1", number: "PO-30530", date: "2026-09-01", status: "Submitted", supplier: "Steel Supply" },
      { id: "digital-po-2", number: "PO-30531", date: "2026-09-02", status: "Draft", supplier: "Lift Rental" },
    ],
    dailyReports: [
      { id: "daily-1", date: "2026-09-01", worker: "Alice Martin" },
      { id: "daily-2", date: "2026-09-02", worker: "Bob Singh" },
    ],
    inspections: [
      { id: "inspection-1", type: "Aerial Lift", title: "Daily aerial lift inspection", date: "2026-09-01", worker: "Alice Martin" },
    ],
    equipment: [
      { id: "equipment-1", name: "Skyjack SJIII", identifier: "SJ-14", kind: "Equipment", workOrderNumber: "WO-1042" },
      { id: "equipment-2", name: "Ford F-550", identifier: "TRK-08", kind: "Vehicle", workOrderNumber: "WO-1048" },
    ],
    workOrders: [
      { id: "work-order-1", number: "WO-1042", date: "2026-09-01", status: "Submitted" },
      { id: "work-order-2", number: "WO-1048", date: "2026-09-03", status: "Draft" },
    ],
    schedule: [
      { id: "schedule-1", date: "2026-09-14", title: "Canopy work starts", type: "Work" },
    ],
  };
}

async function serveJobControl(page, state, captures) {
  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "PUT") {
      captures.savedStates.push(route.request().postDataJSON().state);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ saved: true, updatedAt: new Date().toISOString() }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state, updatedAt: "2026-09-05T12:00:00.000Z" }) });
  });
  await page.route("**/api/job-costing", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ actuals: [] }),
  }));
  await page.route("**/api/job-statistics**", (route) => {
    captures.statisticsRequests.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(jobStatistics()),
    });
  });
  await page.route("**/api/job-documents", async (route) => {
    const update = route.request().postDataJSON();
    captures.portalDocumentUpdates.push(update);
    const documentLink = String(update.documentLink || "").trim();
    const documentLinkLabel = documentLink
      ? String(update.documentLinkLabel || "").trim() || "Open Documents"
      : "";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        saved: true,
        portalJobId: update.portalJobId,
        documentLink,
        documentLinkLabel,
      }),
    });
  });
}

async function openJob(page) {
  await page.getByRole("button", { name: /Jobs/ }).click();
  await page.getByLabel("Search jobs").fill("26144");
  await page.locator(".jobs-table tbody tr").click();
  await expect(page.locator(".job-detail-page")).toContainText("JOB 26144");
}

function jobTab(page, name) {
  return page.getByRole("tab", { name, exact: true });
}

function jobPanel(page, name) {
  return page.getByRole("tabpanel", { name, exact: true });
}

async function addDocumentLink(summary, label, href) {
  const addButton = summary.getByRole("button", { name: /Add (?:document|folder) link/i });
  if (await addButton.isVisible().catch(() => false)) await addButton.click();
  await summary.getByLabel(/Link name|Button name/i).fill(label);
  await summary.getByLabel(/OneDrive|Document link|Folder link/i).fill(href);
  await summary.getByRole("button", { name: /Save (?:document |folder )?link/i }).click();
  await expect(summary.getByRole("link", { name: new RegExp(label, "i") })).toHaveAttribute("href", href);
}

test("Job Control Centre exposes accessible tabs and a complete Summary", async ({ page }) => {
  const state = jobControlState();
  const captures = { savedStates: [], portalDocumentUpdates: [], statisticsRequests: [] };
  await serveJobControl(page, state, captures);
  await page.goto("/estimating/index.html?dev=1");
  await openJob(page);

  const tabList = page.getByRole("tablist", { name: /job/i });
  await expect(tabList).toBeVisible();
  for (const label of ["Summary", "Purchase Orders", "CCNs / Change Orders", "Shop Drawings", "Statistics / Other"]) {
    await expect(jobTab(page, label)).toBeVisible();
  }
  await expect(jobTab(page, "Summary")).toHaveAttribute("aria-selected", "true");
  await expect(jobTab(page, "Summary")).toHaveAttribute("tabindex", "0");
  await expect(jobTab(page, "Purchase Orders")).toHaveAttribute("tabindex", "-1");

  const summary = jobPanel(page, "Summary");
  await expect(summary).toBeVisible();
  const summaryTabId = await jobTab(page, "Summary").getAttribute("id");
  const jobPanelId = await jobTab(page, "Summary").getAttribute("aria-controls");
  expect(summaryTabId).toBeTruthy();
  expect(jobPanelId).toBeTruthy();
  await expect(summary).toHaveAttribute("id", jobPanelId);
  await expect(summary).toHaveAttribute("aria-labelledby", summaryTabId);
  const costingConnection = summary.locator(".job-costing-connection");
  const projectDetails = summary.locator(".job-summary-panel");
  await expect(costingConnection).toContainText("Portal costing connected");
  const [costingBox, projectDetailsBox] = await Promise.all([
    costingConnection.boundingBox(),
    projectDetails.boundingBox(),
  ]);
  expect(costingBox).not.toBeNull();
  expect(projectDetailsBox).not.toBeNull();
  expect(costingBox.y + costingBox.height).toBeLessThanOrEqual(projectDetailsBox.y);
  await page.setViewportSize({ width: 390, height: 844 });
  const [mobileCostingBox, mobileProjectDetailsBox] = await Promise.all([
    costingConnection.boundingBox(),
    projectDetails.boundingBox(),
  ]);
  expect(mobileCostingBox).not.toBeNull();
  expect(mobileProjectDetailsBox).not.toBeNull();
  expect(mobileCostingBox.y + mobileCostingBox.height).toBeLessThanOrEqual(mobileProjectDetailsBox.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const fact of [
    "26144",
    "Via Rail Canada",
    "Brockville Canopy Renewal Contract",
    "Platform Canopy Upgrade",
    "Brockville Station",
    "1 Station Street, Brockville, Ontario",
    "Jeff Vandrish",
  ]) {
    await expect(summary).toContainText(fact);
  }
  await expect(summary).toContainText(/Sep(?:tember)? 14, 2026/i);
  await expect(summary).toContainText(/Nov(?:ember)? 20, 2026/i);
  await expect(summary).toContainText(/Costing|Cost outlook/i);
  await expect(summary).toContainText(/Calendar|Schedule/i);

  await summary.getByRole("button", { name: "Edit job details" }).click();
  await summary.getByLabel("Job name").fill("Canceled job name");
  await summary.getByRole("button", { name: "Cancel" }).click();
  await summary.getByRole("button", { name: "Edit job details" }).click();
  await expect(summary.getByLabel("Job name")).toHaveValue("Brockville Canopy Renewal Contract");
  await summary.getByRole("button", { name: "Cancel" }).click();

  await jobTab(page, "Summary").focus();
  await jobTab(page, "Summary").press("ArrowRight");
  await expect(jobTab(page, "Purchase Orders")).toBeFocused();
  await expect(jobTab(page, "Purchase Orders")).toHaveAttribute("aria-selected", "true");
  await expect(jobTab(page, "Purchase Orders")).toHaveAttribute("tabindex", "0");
  await expect(jobTab(page, "Summary")).toHaveAttribute("tabindex", "-1");
  await jobTab(page, "Purchase Orders").press("End");
  await expect(jobTab(page, "Statistics / Other")).toBeFocused();
  await jobTab(page, "Statistics / Other").press("Home");
  await expect(jobTab(page, "Summary")).toBeFocused();
  await jobTab(page, "Summary").press("ArrowLeft");
  await expect(jobTab(page, "Statistics / Other")).toBeFocused();
  await jobTab(page, "Statistics / Other").press("Home");

  await jobTab(page, "Shop Drawings").click();
  await expect(jobTab(page, "Shop Drawings")).toHaveAttribute("aria-selected", "true");
  const shopDrawings = jobPanel(page, "Shop Drawings");
  await expect(shopDrawings).toBeVisible();
  await expect(shopDrawings).toContainText(/Shop Drawing/i);
  await expect(shopDrawings).toContainText(/Future|Coming soon/i);
});

test("document links stay internal until explicitly shared and a shared link can be replaced or deleted", async ({ page }) => {
  const state = jobControlState();
  const captures = { savedStates: [], portalDocumentUpdates: [], statisticsRequests: [] };
  page.on("dialog", (dialog) => dialog.accept());
  await serveJobControl(page, state, captures);
  await page.goto("/estimating/index.html?dev=1");
  await openJob(page);

  const summary = jobPanel(page, "Summary");
  const drawingsHref = "https://jgc.sharepoint.com/sites/projects/Shared%20Documents/26144/Drawings";
  await addDocumentLink(summary, "Project Drawings", drawingsHref);
  await expect.poll(() => captures.savedStates.length).toBeGreaterThan(0);
  expect(captures.portalDocumentUpdates).toEqual([]);

  const firstCard = summary.locator(".job-document-link-card, .job-document-item").filter({ hasText: "Project Drawings" });
  await expect(firstCard).toHaveCount(1);
  const savedStateCount = captures.savedStates.length;
  await summary.getByLabel(/Link name|Button name/i).fill("Duplicate Drawings");
  await summary.getByLabel(/OneDrive|Document link|Folder link/i).fill("HTTPS://JGC.SHAREPOINT.COM/sites/projects/Shared%20Documents/26144/Drawings/#duplicate");
  await summary.getByRole("button", { name: /Save (?:document |folder )?link/i }).click();
  await expect(summary.getByRole("status")).toContainText(/already saved/i);
  await expect(summary.locator(".job-document-link-card, .job-document-item").filter({ hasText: "Duplicate Drawings" })).toHaveCount(0);
  expect(captures.savedStates).toHaveLength(savedStateCount);
  await firstCard.getByRole("button", { name: "Share to employee job list" }).click();
  await expect.poll(() => captures.portalDocumentUpdates.length).toBe(1);
  expect(captures.portalDocumentUpdates[0]).toEqual(expect.objectContaining({
    portalJobId: "portal-job-control",
    documentLink: drawingsHref,
    documentLinkLabel: "Project Drawings",
  }));
  await expect(firstCard).toContainText(/Shared.*employee job list/i);
  await expect(summary.locator(".job-document-link-card.is-shared, .job-document-item.is-shared")).toHaveCount(1);

  const quotesHref = "https://jgc.sharepoint.com/sites/projects/Shared%20Documents/26144/Subcontractor%20Quotes";
  await addDocumentLink(summary, "Subcontractor Quotes", quotesHref);
  expect(captures.portalDocumentUpdates).toHaveLength(1);
  const secondCard = summary.locator(".job-document-link-card, .job-document-item").filter({ hasText: "Subcontractor Quotes" });
  await secondCard.getByRole("button", { name: "Share to employee job list" }).click();
  await expect.poll(() => captures.portalDocumentUpdates.length).toBe(2);
  expect(captures.portalDocumentUpdates[1]).toEqual(expect.objectContaining({
    portalJobId: "portal-job-control",
    documentLink: quotesHref,
    documentLinkLabel: "Subcontractor Quotes",
  }));
  await expect(secondCard).toContainText(/Shared.*employee job list/i);
  await expect(firstCard).not.toHaveClass(/is-shared/);
  await expect(firstCard).toContainText("Estimator only");
  await expect(firstCard.getByRole("button", { name: "Share to employee job list" })).toBeVisible();

  await secondCard.getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(() => captures.portalDocumentUpdates.length).toBe(3);
  expect(captures.portalDocumentUpdates[2]).toEqual(expect.objectContaining({
    portalJobId: "portal-job-control",
    documentLink: "",
    documentLinkLabel: "",
  }));
  await expect(secondCard).toHaveCount(0);
  await expect(firstCard).toHaveCount(1);
});

test("a shared Portal document link can be removed from the employee job list without deleting it from the Estimator", async ({ page }) => {
  const state = jobControlState();
  const documentHref = "https://jgc.sharepoint.com/sites/projects/Shared%20Documents/26144";
  const portalDocumentLinkId = `portal-job-link-${state.jobs[0].id}`;
  state.jobs[0].documentLink = documentHref;
  state.jobs[0].documentLinkLabel = "Project Documents";
  state.jobs[0].documentLinks = [{
    id: portalDocumentLinkId,
    label: "Project Documents",
    url: documentHref,
    createdAt: "2026-09-05T12:00:00.000Z",
  }];
  const captures = { savedStates: [], portalDocumentUpdates: [], statisticsRequests: [] };
  page.on("dialog", (dialog) => dialog.accept());
  await serveJobControl(page, state, captures);
  await page.goto("/estimating/index.html?dev=1");
  await openJob(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const summary = jobPanel(page, "Summary");
  const card = summary.locator(".job-document-link-card, .job-document-item").filter({ hasText: "Project Documents" });
  await expect(card).toHaveClass(/is-shared/);
  await card.getByRole("button", { name: "Remove from employee job list", exact: true }).click();

  await expect.poll(() => captures.portalDocumentUpdates.length).toBe(1);
  expect(captures.portalDocumentUpdates[0]).toEqual(expect.objectContaining({
    portalJobId: "portal-job-control",
    documentLink: "",
    documentLinkLabel: "",
  }));
  await expect(card).toHaveCount(1);
  await expect(card).not.toHaveClass(/is-shared/);
  await expect(card).toContainText("Estimator only");
  await expect(card.getByRole("button", { name: "Share to employee job list", exact: true })).toBeVisible();
  await expect(summary.getByRole("status")).toContainText(/still saved here/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await expect.poll(() => captures.savedStates.length).toBeGreaterThan(0);
  const savedJob = captures.savedStates.at(-1).jobs.find((job) => job.id === "job-control");
  expect(savedJob.documentLink).toBe("");
  expect(savedJob.documentLinkLabel).toBe("");
  expect(savedJob.documentLinks).toEqual([expect.objectContaining({
    label: "Project Documents",
    url: documentHref,
  })]);
  expect(savedJob.documentLinks[0].id).not.toBe(portalDocumentLinkId);

  await card.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(captures.portalDocumentUpdates).toHaveLength(1);
});

test("Statistics / Other fetches and renders the connected Portal job records without mobile overflow", async ({ page }) => {
  const state = jobControlState();
  const captures = { savedStates: [], portalDocumentUpdates: [], statisticsRequests: [] };
  await serveJobControl(page, state, captures);
  await page.goto("/estimating/index.html?dev=1");
  await openJob(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await jobTab(page, "Statistics / Other").click();
  await expect.poll(() => captures.statisticsRequests.length).toBe(1);
  expect(captures.statisticsRequests[0]).toMatch(/portalJobId=portal-job-control|jobNumber=26144/);

  const statistics = jobPanel(page, "Statistics / Other");
  await expect(statistics).toBeVisible();
  await expect(statistics).toContainText("27");
  for (const text of [
    "Total hours",
    "Employees onsite",
    "Digital POs",
    "Daily reports",
    "Inspections",
    "Equipment used",
    "Hours by week",
    "Hours by employee",
    "Alice Martin",
    "Bob Singh",
    "WO-1042",
    "WO-1048",
  ]) {
    await expect(statistics).toContainText(text, { ignoreCase: true });
  }
  await expect(statistics).toContainText(/Week of Aug(?:ust)? 30/i);
  await expect(statistics).toContainText(/Week of Sep(?:tember)? 6/i);
  const workOrders = statistics.locator(".statistics-work-orders-card");
  await expect(workOrders.getByRole("table")).toBeVisible();
  for (const heading of ["WO #", "Date", "Status"]) {
    await expect(workOrders.getByRole("columnheader", { name: heading, exact: true })).toHaveCount(1);
  }
  await expect(workOrders.getByRole("row").filter({ hasText: "WO-1042" })).toContainText(/Submitted/i);
  await expect(workOrders.getByRole("row").filter({ hasText: "WO-1048" })).toContainText(/Draft/i);

  const compactText = await statistics.evaluate((panel) => {
    const labels = [panel.querySelector(".statistics-kpi-grid span"), panel.querySelector(".statistics-kpi-grid small")];
    return labels.map((element) => element ? ({ fontSize: Number.parseFloat(getComputedStyle(element).fontSize), color: getComputedStyle(element).color }) : null);
  });
  expect(compactText).not.toContain(null);
  for (const style of compactText) {
    expect(style.fontSize).toBeGreaterThanOrEqual(11);
    expect(style.color).toBe("rgb(95, 113, 131)");
  }

  for (const label of ["Summary", "Purchase Orders", "CCNs / Change Orders", "Shop Drawings", "Statistics / Other"]) {
    await jobTab(page, label).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
  await jobTab(page, "Statistics / Other").click();
  await page.evaluate(() => window.scrollTo(0, Math.min(1000, document.documentElement.scrollHeight - window.innerHeight)));
  await page.waitForTimeout(100);
  const stickyPositions = await page.evaluate(() => {
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    const tabs = document.querySelector(".job-tabs").getBoundingClientRect();
    return { topbarBottom: topbar.bottom, tabsTop: tabs.top };
  });
  expect(stickyPositions.tabsTop).toBeGreaterThanOrEqual(stickyPositions.topbarBottom - 1);
});
