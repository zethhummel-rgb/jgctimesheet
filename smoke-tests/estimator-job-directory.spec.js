const { test, expect } = require("@playwright/test");

const fixtureDate = "2026-09-07T12:00:00.000Z";
const officialIds = {
  quoted: "11111111-1111-4111-8111-111111111111",
  tm: "22222222-2222-4222-8222-222222222222",
  contract: "33333333-3333-4333-8333-333333333333",
  inactive: "44444444-4444-4444-8444-444444444444",
};

function officialJob(key, overrides = {}) {
  const id = officialIds[key];
  return {
    id: `portal-job-${id}`, portalJobId: id, jobNumber: "26902", quoteId: "", clientId: "",
    project: "Imported Emergency Repairs", portalJobName: "Imported Emergency Repairs",
    portalCustomer: "Canonical Railway Client", portalAddress: "99 Railway Avenue",
    projectManager: "Directory Test Manager", jobType: "T&M", status: "Active", portalActive: true,
    portalLastSyncedAt: fixtureDate, startDate: "2026-09-08", targetEndDate: "2026-09-30",
    documentLinks: [], documentLink: "", documentLinkLabel: "", archivedAt: "",
    acceptedRevenue: 0, originalCostBudget: 0, acceptedQuoteSnapshot: "",
    approvedRevenueChanges: 0, approvedCostChanges: 0, estimateToComplete: 0, acceptedAt: "",
    costs: [], purchaseOrders: [], shopDrawings: [], notes: "", ...overrides,
  };
}

function directoryState(tmType = "T&M") {
  const quote = {
    id: "directory-accepted-quote", number: "JGC-Q-2026-0901", revision: 0, status: "Won",
    clientId: "directory-quote-client", site: "Quoted Work Site", address: "1 Main Street",
    project: "Accepted Canopy Contract", reference: "DIRECTORY-QA", preparedBy: "Quote Estimator",
    ownerUserId: "directory-admin", ownerName: "Quote Estimator", quoteDate: "2026-09-01",
    validUntil: "2026-10-01", quoteType: "Fixed Price", customerQuoteType: "Proposal Quote",
    taxName: "HST", taxRate: 0.13, defaultMarkup: 0.2, targetMargin: 0.15, depositPercent: 0,
    proposalStyle: "jgc-classic", proposalTaxDisplay: "extra", proposalScope: "Accepted scope",
    proposalClosingScopeRemoved: true, proposalNotes: "", proposalAttention: "Test Client",
    proposalAttentionContactId: "", proposalShowCostBreakdown: false, proposalBreakdownCategories: [],
    proposalBreakdownLineIds: [], proposalBreakdownIncludesMarkup: true, scopeSummary: "",
    inclusions: "", exclusions: "", terms: "Proposal terms", internalNotes: "", lines: [],
    acknowledgedWarnings: {}, revisions: [], createdAt: fixtureDate, updatedAt: fixtureDate,
    sentAt: fixtureDate, wonAt: fixtureDate, acceptedBy: "Test Client", customerPo: "",
    lostReason: "", documentKind: "Quote",
  };
  return {
    version: 14,
    settings: {
      companyName: "John Gordon Construction Inc.", appName: "JGC Estimate Desk", defaultMarkup: 0.2,
      targetMargin: 0.15, taxName: "HST", taxRate: 0.13, quotePrefix: "JGC-Q", nextQuoteNumber: 902,
      defaultValidityDays: 30, defaultProposalStyle: "jgc-classic", defaultProposalTaxDisplay: "extra",
      signatoryName: "Directory Test Manager", proposalIntro: "Proposal introduction", proposalTerms: "Proposal terms",
    },
    clients: [{ id: quote.clientId, name: "Quoted Contract Client", contact: "", email: "", phone: "", contacts: [], sites: [], notes: "" }],
    vendors: [], priceBook: [], quotes: [quote], activity: [],
    jobs: [
      officialJob("quoted", {
        id: "existing-estimator-job", jobNumber: "26901", quoteId: quote.id, clientId: quote.clientId,
        project: quote.project, portalJobName: "Official Canopy Contract", portalCustomer: "Quoted Contract Client",
        jobType: "Contract", acceptedRevenue: 12000, originalCostBudget: 10000,
        acceptedQuoteRevision: 0, acceptedQuoteSnapshot: JSON.stringify(quote), estimateToComplete: 10000, acceptedAt: fixtureDate,
      }),
      officialJob("tm", { jobType: tmType }),
      officialJob("contract", {
        jobNumber: "26903", jobType: "Contract", project: "Imported Contract Without Quote",
        portalJobName: "Imported Contract Without Quote", portalCustomer: "Canonical School Client",
      }),
      officialJob("inactive", {
        jobNumber: "25904", jobType: "Time & Materials", project: "Historical Imported Repair",
        portalJobName: "Historical Imported Repair", status: "Archived", portalActive: false, archivedAt: fixtureDate,
      }),
    ],
  };
}

function statisticsFor(job) {
  return {
    portalJobId: job.portalJobId, jobNumber: job.jobNumber, generatedAt: fixtureDate,
    totalHours: 16, timesheetHours: 16, workOrderOnlyHours: 2, employeeCount: 1, digitalPoCount: 1, manualPoCount: 1, dailyReportCount: 1, inspectionCount: 1,
    workOrderCount: 1, equipmentCount: 1,
    hoursByWeek: [{ startDate: "2026-08-30", label: "Week of Aug 30", hours: 16 }],
    hoursByEmployee: [{ label: "Directory Employee", hours: 16 }],
    hoursByJobType: [{ label: job.jobType, hours: 16 }],
    monthLabel: "September 2026", topEmployeesThisMonth: [{ label: "Directory Employee", hours: 16 }],
    workOrderOnlyLabour: [{ id: "directory-manual-labour", workOrderId: "directory-wo", workOrderNumber: "WO-1902", worker: "Historical Manual Worker", date: "2026-09-01", hours: 2, matchedTimesheetEntryId: "", url: "../work-orders.html?wo=directory-wo" }],
    onsiteByDay: [{ date: "2026-09-01", employees: 1, hours: 16 }],
    digitalPurchaseOrders: [{ id: "directory-po", number: "PO-30902", supplier: "Test Supply", date: "2026-09-01", status: "Submitted", url: "../purchase-orders-admin.html?po=directory-po" }],
    manualPurchaseOrders: [{ id: "directory-manual-po", number: "PAPER-902", supplier: "Paper PO Supply", date: "2026-09-01", status: "Manual / Submitted", source: "work-order", workOrderId: "directory-wo", workOrderNumber: "WO-1902", notes: "Historical PO on existing work order", url: "../work-orders.html?wo=directory-wo" }],
    dailyReports: [{ id: "directory-report", date: "2026-09-01", worker: "Directory Employee", url: "../daily-site-report.html?reportId=directory-report&mode=view&return=admin" }],
    inspections: [{ id: "directory-inspection", type: "Aerial Lift", title: "Directory lift inspection", date: "2026-09-01", worker: "Directory Employee" }],
    workOrders: [{ id: "directory-wo", number: "WO-1902", date: "2026-09-01", status: "Submitted", url: "../work-orders.html?wo=directory-wo" }],
    equipment: [{ id: "directory-equipment", name: "Directory Scissor Lift", identifier: "LIFT-902", kind: "Equipment", workOrderNumber: "WO-1902" }],
    schedule: [],
  };
}

function jobInfoResponse(job, body) {
  return {
    id: job.portalJobId, jobNumber: job.jobNumber, jobName: job.portalJobName,
    customer: job.portalCustomer, address: job.portalAddress, jobType: job.jobType,
    projectManager: job.projectManager, startDate: job.startDate, targetEndDate: job.targetEndDate,
    active: job.portalActive, documentLink: job.documentLink, documentLinkLabel: job.documentLinkLabel,
    ...body,
  };
}

async function serveDirectory(page, state, options = {}) {
  const captures = { writes: [], statistics: [], jobInfo: [], unexpectedRequests: [] };
  // Keep this fixture completely isolated from Supabase, email and other live services.
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      captures.unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort("blockedbyclient");
    }
    if (url.pathname.endsWith("/api/state")) {
      if (request.method() === "PUT") {
        captures.writes.push(request.postDataJSON().state);
        return route.fulfill({ json: { saved: true, updatedAt: fixtureDate } });
      }
      return route.fulfill({ json: { state, updatedAt: fixtureDate } });
    }
    if (url.pathname.endsWith("/api/job-costing")) {
      return route.fulfill({ json: { actuals: [{
        portalJobId: officialIds.tm, jobNumber: "26902", workerProfileId: "directory-worker",
        workerName: "Directory Employee", sourceStatus: "submitted", firstWorkDate: "2026-09-01",
        lastWorkDate: "2026-09-01", hours: 16, loadedLabourCost: 672, missingRateHours: 0,
      }] } });
    }
    if (url.pathname.endsWith("/api/job-statistics")) {
      const id = url.searchParams.get("portalJobId");
      captures.statistics.push(id);
      const job = state.jobs.find((item) => item.portalJobId === id);
      if (!job) return route.fulfill({ status: 404, json: { error: "Unknown official job ID" } });
      return route.fulfill({ json: statisticsFor(job) });
    }
    if (url.pathname.endsWith("/api/job-info")) {
      const body = request.postDataJSON();
      captures.jobInfo.push({ method: request.method(), body });
      if (options.failJobInfo) return route.fulfill({ status: 500, json: { error: "Canonical job update rejected for this test" } });
      const job = state.jobs.find((item) => item.portalJobId === body.portalJobId);
      if (!job) return route.fulfill({ status: 404, json: { error: "Unknown official job ID" } });
      return route.fulfill({ json: { saved: true, job: jobInfoResponse(job, body) } });
    }
    if (url.pathname.includes("/api/")) {
      captures.unexpectedRequests.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 404, json: { error: "Unmocked test API" } });
    }
    return route.continue();
  });
  await page.goto("/estimating/index.html?dev=1");
  await page.getByRole("button", { name: /^Jobs(?:\s|$)/ }).click();
  return captures;
}

async function openDirectoryJob(page, number) {
  await page.getByLabel("Search jobs", { exact: true }).fill(number);
  const row = page.locator(".jobs-table tbody tr").filter({ hasText: number });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page.locator(".job-detail-page")).toContainText(`JOB ${number}`);
}

async function assertSelectedTab(page, name) {
  await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name, exact: true })).toBeVisible();
}

async function captureVisual(page, testInfo, name) {
  if (process.env.JGC_DIRECTORY_VISUAL_QA !== "1") return;
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test("canonical job directory includes quoted, imported and inactive jobs without fabricated quote values", async ({ page }, testInfo) => {
  const captures = await serveDirectory(page, directoryState());
  await page.getByLabel("Search jobs", { exact: true }).fill("269");
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(3);
  const imported = page.locator(".jobs-table tbody tr").filter({ hasText: "26902" });
  await expect(imported).toContainText("Canonical Railway Client");
  await expect(imported).toContainText("Imported Emergency Repairs");
  await expect(imported).toContainText("$672.00");
  await expect(imported).not.toContainText(/Quote unavailable|Unassigned|NaN|Infinity/);
  for (const label of ["Accepted price", "Estimate cost", "Forecast margin"]) {
    await expect(imported.locator(`[data-label="${label}"]`)).not.toContainText(/\$0\.00|0\.0%/);
  }
  await expect(page.locator(".jobs-table tbody tr").filter({ hasText: "26901" })).toContainText("JGC-Q-2026-0901");
  await page.getByLabel("Search jobs", { exact: true }).fill("Canonical Railway Client");
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".jobs-table tbody tr")).toContainText("26902");
  await page.getByLabel("Search jobs", { exact: true }).fill("Directory Test Manager");
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(3);
  await captureVisual(page, testInfo, "directory-desktop");
  await page.getByRole("group", { name: "Filter jobs by status" }).getByRole("button", { name: /Inactive|Archived/ }).click();
  await page.getByLabel("Search jobs", { exact: true }).fill("25904");
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(1);
  await openDirectoryJob(page, "25904");
  await assertSelectedTab(page, "Statistics / Other");
  await expect.poll(() => captures.statistics).toContain(officialIds.inactive);
  expect(captures.jobInfo).toEqual([]);
  expect(captures.writes).toEqual([]);
});

for (const jobType of ["T&M", "Time & Materials", "Time and Materials", "time-and-materials", " t & m "]) {
  test(`T&M type ${JSON.stringify(jobType)} opens Statistics and respects explicit tab selection`, async ({ page }) => {
    const captures = await serveDirectory(page, directoryState(jobType));
    await openDirectoryJob(page, "26902");
    await assertSelectedTab(page, "Statistics / Other");
    await expect(page.getByRole("tabpanel")).toContainText("PO-30902");
    await expect(page.getByRole("tabpanel")).toContainText("WO-1902");
    expect(captures.statistics).toContain(officialIds.tm);
    await page.getByRole("tab", { name: "Summary", exact: true }).click();
    await assertSelectedTab(page, "Summary");
    await page.getByRole("button", { name: /Refresh labour/ }).click();
    await assertSelectedTab(page, "Summary");
    await page.getByRole("button", { name: "← All jobs", exact: true }).click();
    await openDirectoryJob(page, "26901");
    await assertSelectedTab(page, "Summary");
    await page.getByRole("tab", { name: "Purchase Orders", exact: true }).click();
    await page.getByRole("button", { name: "← All jobs", exact: true }).click();
    await openDirectoryJob(page, "26902");
    await assertSelectedTab(page, "Statistics / Other");
  });
}

test("unquoted contract jobs have useful official details but no invented contract or quote", async ({ page }) => {
  await serveDirectory(page, directoryState());
  await openDirectoryJob(page, "26903");
  await assertSelectedTab(page, "Summary");
  const details = page.locator(".job-detail-page");
  await expect(details).toContainText("Canonical School Client");
  await expect(details).toContainText("Imported Contract Without Quote");
  await expect(details).toContainText("Directory Test Manager");
  await expect(details.getByRole("button", { name: "Open accepted quote" })).toHaveCount(0);
  await expect(details).not.toContainText(/Quote unavailable|Created by Unassigned|NaN|Infinity/);
  await expect(details.locator(".job-kpi-grid")).not.toContainText(/0\.0%/);
  await expect(details.getByRole("heading", { name: "Labour budget vs actual" })).toHaveCount(0);
  await page.getByRole("tab", { name: "CCNs / Change Orders", exact: true }).click();
  await expect(page.getByRole("tabpanel")).not.toContainText(/Original contract\s*\$0\.00/i);
});

test("editing an unquoted official job immediately updates its heading and directory without changing its ID", async ({ page }) => {
  const captures = await serveDirectory(page, directoryState());
  await openDirectoryJob(page, "26903");
  await page.getByRole("button", { name: "Edit job details", exact: true }).click();
  await page.getByLabel("Job name", { exact: true }).fill("Updated official contract job");
  await page.getByRole("button", { name: "Save job details", exact: true }).click();
  await expect(page.locator(".job-topline h1")).toHaveText("Updated official contract job");
  expect(captures.jobInfo[0].body.portalJobId).toBe(officialIds.contract);
  await page.getByRole("button", { name: "← All jobs", exact: true }).click();
  await page.getByLabel("Search jobs", { exact: true }).fill("Updated official contract job");
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".jobs-table tbody tr")).toContainText("26903");
});

test("canonical status changes preserve the official ID and change no quote or operational record", async ({ page }) => {
  const state = directoryState();
  const captures = await serveDirectory(page, state);
  await openDirectoryJob(page, "26902");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Move to (?:archive|inactive)|Mark inactive/ }).click();
  await expect.poll(() => captures.jobInfo.length).toBe(1);
  expect(captures.jobInfo[0]).toEqual({ method: "PATCH", body: { portalJobId: officialIds.tm, active: false } });
  await expect(page.locator(".job-topline")).toContainText(/Inactive|Archived/);
  await expect.poll(() => captures.writes.length).toBeGreaterThan(0);
  const saved = captures.writes.at(-1);
  const job = saved.jobs.find((item) => item.portalJobId === officialIds.tm);
  expect(job.id).toBe(`portal-job-${officialIds.tm}`);
  expect(job.jobNumber).toBe("26902");
  expect(job.portalActive).toBe(false);
  expect(job.status).toBe("Archived");
  expect(job.quoteId).toBe("");
  expect(saved.quotes.map((item) => item.id)).toEqual(["directory-accepted-quote"]);
  expect(saved.jobs.map((item) => item.portalJobId)).toEqual(state.jobs.map((item) => item.portalJobId));
  await page.getByRole("button", { name: /Restore active job|Mark active|Make active/ }).click();
  await expect.poll(() => captures.jobInfo.length).toBe(2);
  expect(captures.jobInfo[1].body).toEqual({ portalJobId: officialIds.tm, active: true });
  await expect(page.locator(".job-topline")).not.toContainText(/Inactive|Archived/);
  expect(captures.unexpectedRequests).toEqual([]);
});

test("failed canonical status change leaves job active and does not save a false local archive", async ({ page }) => {
  const captures = await serveDirectory(page, directoryState(), { failJobInfo: true });
  await openDirectoryJob(page, "26902");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Move to (?:archive|inactive)|Mark inactive/ }).click();
  await expect.poll(() => captures.jobInfo.length).toBe(1);
  await expect(page.locator(".job-detail-page")).toContainText("Canonical job update rejected for this test");
  await expect(page.getByRole("button", { name: /Move to (?:archive|inactive)|Mark inactive/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Restore active job|Mark active|Make active/ })).toHaveCount(0);
  expect(captures.writes).toEqual([]);
  await page.getByRole("button", { name: "← All jobs", exact: true }).click();
  await openDirectoryJob(page, "26902");
  await assertSelectedTab(page, "Statistics / Other");
});

test("Statistics keeps manual WO labour, paper POs and record navigation alongside digital records", async ({ page }) => {
  const captures = await serveDirectory(page, directoryState());
  await openDirectoryJob(page, "26902");
  const statistics = page.getByRole("tabpanel", { name: "Statistics / Other", exact: true });
  for (const text of ["Hours by job type", "Top employees this month", "Historical Manual Worker", "PAPER-902", "PO-30902", "Directory lift inspection"]) {
    await expect(statistics).toContainText(text, { ignoreCase: true });
  }
  const destinations = [
    "../purchase-orders-admin.html?po=directory-po",
    "../work-orders.html?wo=directory-wo",
    "../daily-site-report.html?reportId=directory-report&mode=view&return=admin",
  ];
  for (const href of destinations) {
    await expect(statistics.locator(`a[href="${href}"]`).first()).toBeVisible();
  }
  const workOrderLink = statistics.locator('a[href="../work-orders.html?wo=directory-wo"]').first();
  // Intercept the destination as well: clicking a record must never reach a live editor or write data.
  const recordResponse = (route) => route.fulfill({ contentType: "text/html", body: "<h1>Existing work order directory-wo</h1>" });
  await page.context().route("**/work-orders.html?wo=directory-wo", recordResponse);
  await page.route("**/work-orders.html?wo=directory-wo", recordResponse);
  if (await workOrderLink.getAttribute("target") === "_blank") {
    const popup = page.waitForEvent("popup");
    await workOrderLink.click();
    const recordPage = await popup;
    await expect(recordPage).toHaveURL(/\/work-orders\.html\?wo=directory-wo$/);
    await expect(recordPage.getByRole("heading")).toHaveText("Existing work order directory-wo");
    await recordPage.close();
  } else {
    await workOrderLink.click();
    await expect(page).toHaveURL(/\/work-orders\.html\?wo=directory-wo$/);
    await expect(page.getByRole("heading")).toHaveText("Existing work order directory-wo");
  }
  expect(captures.jobInfo).toEqual([]);
  expect(captures.writes).toEqual([]);
});

test("all canonical job tabs fit a 390px phone without page overflow", async ({ page }, testInfo) => {
  await serveDirectory(page, directoryState());
  await openDirectoryJob(page, "26902");
  await expect(page.getByRole("tabpanel")).toContainText("PO-30902");
  await captureVisual(page, testInfo, "tm-statistics-desktop");
  await page.getByRole("tab", { name: "Summary", exact: true }).click();
  await captureVisual(page, testInfo, "tm-summary-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const tab of ["Statistics / Other", "Summary", "Purchase Orders", "CCNs / Change Orders", "Shop Drawings"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await assertSelectedTab(page, tab);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if (["Statistics / Other", "Summary"].includes(tab)) await captureVisual(page, testInfo, tab === "Summary" ? "tm-summary-phone" : "tm-statistics-phone");
  }
  await page.getByRole("button", { name: "← All jobs", exact: true }).click();
  await expect(page.getByLabel("Search jobs", { exact: true })).toBeVisible();
  await page.getByLabel("Search jobs", { exact: true }).fill("269");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await captureVisual(page, testInfo, "directory-phone");
});

test("a delayed Statistics response cannot replace the next job's records", async ({ page }) => {
  const state = directoryState();
  await serveDirectory(page, state);
  let delayedRoute;
  await page.route("**/api/job-statistics**", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("portalJobId");
    if (id === officialIds.tm) {
      delayedRoute = route;
      return;
    }
    const job = state.jobs.find((item) => item.portalJobId === id);
    const statistics = statisticsFor(job);
    statistics.digitalPurchaseOrders[0].number = "PO-CORRECT-26903";
    return route.fulfill({ json: statistics });
  });
  await openDirectoryJob(page, "26902");
  await expect.poll(() => Boolean(delayedRoute)).toBe(true);
  await page.getByRole("button", { name: "← All jobs", exact: true }).click();
  await openDirectoryJob(page, "26903");
  await page.getByRole("tab", { name: "Statistics / Other", exact: true }).click();
  const statistics = page.getByRole("tabpanel", { name: "Statistics / Other", exact: true });
  await expect(statistics).toContainText("PO-CORRECT-26903");
  const oldStatistics = statisticsFor(state.jobs.find((item) => item.portalJobId === officialIds.tm));
  oldStatistics.digitalPurchaseOrders[0].number = "PO-STALE-26902";
  await delayedRoute.fulfill({ json: oldStatistics });
  // Let the old request settle and React flush its update; aborted requests are valid too.
  await page.waitForTimeout(150);
  await expect(statistics).toContainText("PO-CORRECT-26903");
  await expect(statistics).not.toContainText("PO-STALE-26902");
  await expect(page.locator(".job-topline")).toContainText("26903");
});

test("accepting a quote upgrades the existing canonical job without losing costs, documents, POs, drawings or CCN references", async ({ page }) => {
  const state = directoryState();
  const placeholder = state.jobs.find((job) => job.portalJobId === officialIds.tm);
  const document = { id: "retained-document", label: "Existing Site Documents", url: "https://example.com/jobs/26902", createdAt: fixtureDate };
  placeholder.documentLinks = [document];
  placeholder.documentLink = document.url;
  placeholder.documentLinkLabel = document.label;
  placeholder.costs = [{ id: "retained-actual", date: "2026-09-01", type: "Material", section: "General", vendor: "Existing Supplier", reference: "EXISTING-INV", hours: 0, preTaxAmount: 50, hstAmount: 6.5, paid: true, notes: "Retain actual cost" }];
  placeholder.notes = "Existing project notes must remain";
  placeholder.shopDrawings = [{
    id: "retained-drawing", number: "SD-001", revision: 1, title: "Existing approved drawing", division: "Division 05 – Metals",
    vendorId: null, vendorName: "Existing Fabricator", consultant: "Existing Consultant", status: "Approved", responsibility: "Complete",
    requestedDate: "2026-08-01", receivedDate: "2026-08-03", submittedDate: "2026-08-04", dueDate: "2026-08-10",
    returnedDate: "2026-08-09", requiredOnsiteDate: "2026-09-01", oneDriveUrl: "https://example.com/jobs/26902/sd-001-r1.pdf",
    notes: "Original drawing record", sharedWithEmployees: false,
    revisions: [{ id: "retained-drawing-r0", revision: 0, savedAt: fixtureDate, snapshot: "{\"title\":\"Original drawing\"}" }],
    createdAt: fixtureDate, updatedAt: fixtureDate,
  }];
  placeholder.purchaseOrders = [{
    id: "retained-estimate-po", number: "26902-1", revision: 0, status: "Issued", sourceQuoteId: "", vendorId: null,
    vendorName: "Existing Fabricator", vendorContact: "", vendorEmail: "", vendorPhone: "", vendorQuoteNumber: "EXISTING-SUB-1",
    issueDate: "2026-09-01", shipBy: "", shipVia: "", fob: "", shipTo: "99 Railway Avenue", authorizedBy: "Existing Manager",
    taxRate: 0.13, notes: "Existing issued commitment", lines: [{ id: "retained-po-line", quoteLineId: "", description: "Existing work", quantity: 1, unit: "LS", unitCost: 100, amount: 100, sourceReference: "EXISTING-SUB-1" }],
    revisions: [], finalizedAt: fixtureDate, createdAt: fixtureDate, updatedAt: fixtureDate,
  }];
  const quote = {
    ...state.quotes[0], id: "quote-to-link", number: "JGC-Q-2026-0902", status: "Finished", project: "Newly Accepted Repair Scope", wonAt: "", acceptedBy: "",
    lines: [{
      id: "new-accepted-line", section: "General", division: "Div 01 – General Requirements", divisionManual: false,
      priceBookCode: null, description: "Repair work", internalScope: "", classification: "Required", included: true,
      costType: "Labour", quantity: 1, unit: "LS", catalogCost: null, projectCost: 1000, markupOverride: null,
      priceOverride: null, vendorId: null, vendorName: "", vendorReference: "", vendorQuoteDate: "", vendorQuoteExpiry: "",
      vendorPricingMode: "Quoted", vendorActualCost: null, vendorOverrideCost: null, liveQuote: false, confidence: "Project-specific",
      low: null, high: null, sourceNote: "", customerNote: "", internalNote: "",
    }],
  };
  state.quotes.push(quote, {
    ...quote, id: "existing-ccn-reference", number: "26902-CCN-001", documentKind: "Change Notice", status: "Draft",
    jobId: placeholder.id, changeSequence: 1, changeTitle: "Existing change reference", changeStatus: "Draft",
    changeRequestedBy: "Existing Consultant", changeRequestedDate: "2026-09-01", changeDueDate: "", changeOrder: null, changeOrderHistory: [],
  });
  await page.addInitScript((jobs) => { window.JGC_ESTIMATOR_PORTAL_JOBS = jobs; }, state.jobs.map((job) => jobInfoResponse(job, {})));
  const captures = await serveDirectory(page, state);
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name: /^Quotes/ }).click();
  await page.getByLabel("Search quotes", { exact: true }).fill(quote.number);
  await page.locator(".quotes-table tbody tr").filter({ hasText: quote.number }).click();
  await page.getByRole("button", { name: "Make into job", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Make into job" });
  await dialog.getByRole("combobox", { name: "Portal job" }).fill("26902");
  await dialog.getByRole("option", { name: /26902.*Imported Emergency Repairs/ }).click();
  await dialog.getByRole("button", { name: "Make into job", exact: true }).click();
  await expect(page.locator(".job-detail-page")).toContainText("JOB 26902");
  await assertSelectedTab(page, "Statistics / Other");
  await expect.poll(() => captures.writes.length).toBeGreaterThan(0);
  const saved = captures.writes.at(-1);
  expect(saved.jobs).toHaveLength(state.jobs.length);
  expect(saved.jobs.filter((job) => job.portalJobId === officialIds.tm)).toHaveLength(1);
  const linked = saved.jobs.find((job) => job.portalJobId === officialIds.tm);
  expect(linked.id).toBe(placeholder.id);
  expect(linked.quoteId).toBe(quote.id);
  expect(linked.jobNumber).toBe("26902");
  expect(linked.costs).toEqual(placeholder.costs);
  expect(linked.documentLinks).toEqual(placeholder.documentLinks);
  expect(linked.documentLink).toBe(document.url);
  expect(linked.purchaseOrders).toEqual(placeholder.purchaseOrders);
  expect(linked.shopDrawings).toEqual(placeholder.shopDrawings);
  expect(linked.notes).toContain(placeholder.notes);
  expect(linked.acceptedRevenue).toBe(1200);
  expect(linked.originalCostBudget).toBe(1000);
  expect(saved.quotes.find((item) => item.id === quote.id).status).toBe("Won");
  expect(saved.quotes.find((item) => item.id === "existing-ccn-reference").jobId).toBe(placeholder.id);
  expect(captures.jobInfo).toEqual([]);
  expect(captures.unexpectedRequests).toEqual([]);
  await page.getByRole("tab", { name: "Summary", exact: true }).click();
  await expect(page.getByRole("link", { name: /Existing Site Documents/ })).toBeVisible();
  await page.getByRole("tab", { name: "Shop Drawings", exact: true }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Existing approved drawing");
  await page.getByRole("tab", { name: "CCNs / Change Orders", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("26902-CCN-001");
});
