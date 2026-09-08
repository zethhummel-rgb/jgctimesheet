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
    cancelledAt: body.cancelled ? fixtureDate : typeof body.active === "boolean" ? "" : (job.cancelledAt || ""),
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
    if (url.pathname.endsWith("/api/job-accounting-export") && request.method() === "GET") return route.fulfill({ json: { history: [], count: 0 } });
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
  if (!options.overview) {
    if (page.viewportSize()?.width <= 760) await page.locator(".mobile-menu").click();
    await page.getByRole("button", { name: /^Jobs(?:\s|$)/ }).click();
  }
  return captures;
}

async function openDirectoryJob(page, number) {
  await page.getByLabel("Search jobs", { exact: true }).fill(number);
  const row = page.locator(".jobs-table tbody tr").filter({ hasText: number });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page.locator(".job-detail-page")).toContainText(`JOB ${number}`);
}

test("overview finds imported job 26096 without a quote in My estimates", async ({ page }) => {
  const state = directoryState();
  state.jobs[1].jobNumber = "26096";
  state.jobs[1].projectManager = "ZH";
  const captures = await serveDirectory(page, state, { overview: true });
  const search = page.getByRole("searchbox", { name: "Search estimates and jobs" });
  await search.fill("JGC-Q-2026-0901");
  await expect(page.locator(".overview-result-group").getByRole("heading", { name: /^Quotes/ })).toHaveCount(1);
  await expect(page.locator(".overview-result-group").getByRole("button", { name: /26901/ })).toHaveCount(1);
  for (const term of ["26096", "Canonical Railway Client", "99 Railway Avenue", "Zeth Hummel"]) {
    await search.fill(term);
    await expect(page.locator(".overview-result-group").getByRole("button", { name: /26096/ })).toHaveCount(1);
  }
  await expect(page.locator(".overview-search-summary")).toContainText("all jobs");
  await search.fill("25904");
  await expect(page.locator(".overview-result-group").getByRole("button", { name: /25904/ })).toContainText("Inactive");
  await search.fill("26096");
  await page.locator(".overview-result-group").getByRole("button", { name: /26096/ }).click();
  await expect(page.locator(".job-detail-page")).toContainText("JOB 26096");
  await assertSelectedTab(page, "Statistics / Other");
  expect(captures.jobInfo).toEqual([]);
  expect(captures.writes).toEqual([]);
});

test("administrator overview searches every quote and job beyond the first eight matches", async ({ page }) => {
  const state = directoryState();
  state.quotes = Array.from({ length: 10 }, (_, index) => ({ ...state.quotes[0], id: `search-quote-${index}`, number: `JGC-Q-2026-${8000 + index}`, project: "Search regression quote", ownerUserId: "another-estimator" }));
  state.jobs = Array.from({ length: 10 }, (_, index) => officialJob("contract", { id: `search-job-${index}`, portalJobId: `search-portal-${index}`, jobNumber: `${28000 + index}`, portalSiteName: "Search regression site" }));
  await serveDirectory(page, state, { overview: true });
  const search = page.getByRole("searchbox", { name: "Search estimates and jobs" });
  await search.fill("Search regression");
  await expect(page.locator(".overview-result-group > button")).toHaveCount(20);
  await expect(page.locator(".overview-search-summary")).toContainText("all quotes and CCNs");
  await search.fill("JGCQ20268009");
  await expect(page.locator(".overview-result-group > button")).toHaveCount(1);
  await expect(page.locator(".overview-result-group > button")).toContainText("JGC-Q-2026-8009");
});

test("job client and site editing preserves the accepted quote and offers Contract or T&M", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = directoryState();
  const originalQuote = JSON.stringify(state.quotes[0]);
  const captures = await serveDirectory(page, state);
  await openDirectoryJob(page, "26901");
  await page.getByRole("button", { name: "Edit job details", exact: true }).click();
  await expect(page.getByLabel("Site name", { exact: true })).toHaveValue("Quoted Work Site");
  await page.getByLabel("Client", { exact: true }).fill("New job client");
  await page.getByLabel("Site name", { exact: true }).fill("New north site");
  await page.getByRole("combobox", { name: "Job type", exact: true }).selectOption("T&M");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (process.env.JGC_CAPTURE_VISUAL_QA === "1") await page.locator(".job-summary-editor").screenshot({ path: testInfo.outputPath("job-editor-phone.png") });
  await page.getByRole("button", { name: "Save job details", exact: true }).click();
  await expect(page.locator(".job-summary-facts")).toContainText("New north site");
  await expect(page.locator(".job-summary-facts")).toContainText("New job client");
  expect(captures.jobInfo[0].body).toEqual(expect.objectContaining({ portalJobId: officialIds.quoted, siteName: "New north site", customer: "New job client", jobType: "T&M" }));
  await expect.poll(() => captures.writes.length).toBeGreaterThan(0);
  // State loading supplies optional defaults; existing quote fields and its
  // immutable accepted snapshot must remain unchanged by job metadata edits.
  expect(captures.writes.at(-1).quotes[0]).toEqual(expect.objectContaining(JSON.parse(originalQuote)));
  expect(captures.writes.at(-1).jobs.find((job) => job.id === "existing-estimator-job").acceptedQuoteSnapshot).toBe(originalQuote);
  await page.getByRole("button", { name: "← All jobs", exact: true }).click();
  await page.getByLabel("Search jobs", { exact: true }).fill("north 26901");
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(1);
});

test("last import date uses recorded imports, never ordinary job edits", async ({ page }) => {
  const state = directoryState();
  state.jobs[1].lastImportedAt = "2026-09-02T14:30:00Z";
  state.jobs[2].portalLastSyncedAt = fixtureDate;
  await serveDirectory(page, state);
  await expect(page.getByTestId("job-last-import")).toContainText(/2026-09-02|9\/2\/2026/);
  await openDirectoryJob(page, "26903");
  await page.getByRole("button", { name: "Edit job details", exact: true }).click();
  await page.getByLabel("Job name", { exact: true }).fill("Ordinary edit");
  await page.getByRole("button", { name: "Save job details", exact: true }).click();
  await expect(page.locator(".job-topline h1")).toHaveText("Ordinary edit");
  await page.getByRole("button", { name: "← All jobs", exact: true }).click();
  await expect(page.getByTestId("job-last-import")).toContainText(/2026-09-02|9\/2\/2026/);
});

test("legacy jobs show unknown import date rather than an invented date", async ({ page }) => {
  await serveDirectory(page, directoryState());
  await expect(page.getByTestId("job-last-import")).toContainText("Not recorded");
});

test("job List and Tiles views keep filters and remember the device preference", async ({ page }) => {
  const captures = await serveDirectory(page, directoryState());
  const layout = page.getByRole("group", { name: "Job layout" });
  await expect(layout.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Search jobs", { exact: true }).fill("26902");
  await layout.getByRole("button", { name: "Tiles", exact: true }).click();
  await expect(page.locator(".job-tile")).toHaveCount(1);
  await expect(page.locator(".job-tile")).toContainText("Canonical Railway Client");
  await page.reload();
  await page.getByRole("button", { name: /^Jobs(?:\s|$)/ }).click();
  await expect(layout.getByRole("button", { name: "Tiles", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".job-tile")).toHaveCount(3);
  await page.getByRole("group", { name: "Filter jobs by status" }).getByRole("button", { name: "Inactive" }).click();
  await expect(page.locator(".job-tile")).toHaveCount(1);
  await page.locator(".job-tile-open").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".job-detail-page")).toContainText("JOB 25904");
  expect(captures.jobInfo).toEqual([]);
  expect(captures.writes).toEqual([]);
});

for (const layout of ["List", "Tiles"]) {
  for (const width of [390, 1366]) {
    test(`${layout} job search includes both statuses and restores the selected tab at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const state = directoryState();
      state.jobs[3].projectManager = "Archive Manager";
      const captures = await serveDirectory(page, state);
      const layouts = page.getByRole("group", { name: "Job layout" });
      await layouts.getByRole("button", { name: layout, exact: true }).click();
      const entries = page.locator(layout === "List" ? ".jobs-table tbody tr" : ".job-tile");
      const search = page.getByLabel("Search jobs", { exact: true });
      const filters = page.getByRole("group", { name: "Filter jobs by status" });
      const active = filters.getByRole("button", { name: "Active", exact: true });
      const inactive = filters.getByRole("button", { name: "Inactive", exact: true });
      const manager = page.getByRole("combobox", { name: "Filter jobs by project manager" });
      await expect(entries).toHaveCount(3);
      await expect(active).toHaveAttribute("aria-pressed", "true");
      for (const query of ["25904", "2590", "historical imported", "  HISTORICAL  "]) {
        await search.fill(query);
        await expect(entries).toHaveCount(1);
        await expect(entries).toContainText("25904");
        await expect(entries).toContainText("Inactive");
        await expect(page.locator("#job-search-scope")).toHaveText("Searching active and inactive jobs");
        await expect(active).toBeDisabled();
        await expect(inactive).toBeDisabled();
        await expect(active).toHaveAttribute("aria-pressed", "false");
        await expect(inactive).toHaveAttribute("aria-pressed", "false");
      }
      await search.fill("repair");
      await expect(entries).toHaveCount(2);
      await expect(entries.filter({ hasText: "26902" })).toContainText("Active");
      await expect(entries.filter({ hasText: "25904" })).toContainText("Inactive");
      await expect(page.locator(".table-summary strong")).toHaveText("2 matching jobs");
      if (process.env.JGC_CAPTURE_VISUAL_QA === "1") await page.locator(".job-directory-page").screenshot({ path: testInfo.outputPath(`both-statuses-${layout}-${width}.png`) });
      await manager.selectOption({ label: "Archive Manager" });
      await expect(entries).toHaveCount(1);
      await expect(entries).toContainText("25904");
      await manager.selectOption({ label: "Directory Test Manager" });
      await expect(entries).toHaveCount(1);
      await expect(entries).toContainText("26902");
      await manager.selectOption("");
      await layouts.getByRole("button", { name: layout === "List" ? "Tiles" : "List", exact: true }).click();
      await expect(page.locator(layout === "List" ? ".job-tile" : ".jobs-table tbody tr")).toHaveCount(2);
      await layouts.getByRole("button", { name: layout, exact: true }).click();
      await expect(search).toHaveValue("repair");
      await search.fill("   ");
      await expect(entries).toHaveCount(3);
      await expect(active).toBeEnabled();
      await expect(active).toHaveAttribute("aria-pressed", "true");
      await inactive.click();
      await expect(entries).toHaveCount(1);
      for (const query of ["26902", "emergency repairs"]) {
        await search.fill(query);
        await expect(entries).toHaveCount(1);
        await expect(entries).toContainText("26902");
        await expect(entries).toContainText("Active");
      }
      await search.fill("no matching test project");
      await expect(page.getByRole("heading", { name: "No matching jobs found" })).toBeVisible();
      await expect(page.locator("#job-search-scope")).toHaveText("Searching active and inactive jobs");
      await search.fill("25904");
      if (layout === "Tiles") await entries.locator(".job-tile-open").click();
      else await entries.click();
      await expect(page.locator(".job-detail-page")).toContainText("JOB 25904");
      await page.getByRole("button", { name: "← All jobs", exact: true }).click();
      await expect(search).toHaveValue("25904");
      await search.fill("");
      await expect(inactive).toHaveAttribute("aria-pressed", "true");
      await expect(entries).toHaveCount(1);
      await expect(entries).toContainText("25904");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
      expect(captures.jobInfo).toEqual([]);
      expect(captures.writes).toEqual([]);
      expect(captures.unexpectedRequests).toEqual([]);
    });
  }
}

test("job-number years use the number prefix and leave unnumbered jobs unassigned", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const ts = require("../estimating-app/node_modules/typescript");
  const source = fs.readFileSync(path.join(__dirname, "../estimating-app/lib/job-number-year.ts"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports });
  const { jobNumberYear } = module.exports;
  for (const [number, year] of [["26128", 2026], ["25001", 2025], ["24999", 2024], ["05901", 2005], ["  26901  ", 2026], ["27901", 2027], ["26128-A", 2026], ["", null], ["Pending", null], ["JOB-26128", null], ["26", null]]) {
    expect(jobNumberYear(number), number).toBe(year);
  }
});

for (const layout of ["List", "Tiles"]) {
  for (const width of [390, 1366]) {
    test(`${layout} inactive jobs are grouped by number year with cross-year search at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const state = directoryState();
      const previous = state.jobs[3];
      for (const [number, manager] of [["26912", "Directory Test Manager"], ["26910", "Directory Test Manager"], ["24911", "Old Manager"], ["05901", "Directory Test Manager"], ["Pending", "Directory Test Manager"]]) {
        state.jobs.push({ ...previous, id: `year-job-${number}`, portalJobId: `year-portal-${number}`, jobNumber: number,
          project: `Archive Repairs ${number}`, portalJobName: `Archive Repairs ${number}`, projectManager: manager,
          // All records closed in 2026: grouping must use job number, not closure/import dates.
          archivedAt: fixtureDate, lastImportedAt: fixtureDate, cancelledAt: number === "26910" ? fixtureDate : "" });
      }
      const captures = await serveDirectory(page, state);
      const layouts = page.getByRole("group", { name: "Job layout" });
      await layouts.getByRole("button", { name: layout, exact: true }).click();
      const filters = page.getByRole("group", { name: "Filter jobs by status" });
      await expect(page.locator(".job-year-group")).toHaveCount(0);
      await filters.getByRole("button", { name: "Inactive", exact: true }).click();
      const groups = page.locator(".job-year-group");
      const group = label => groups.filter({ has: page.locator("summary > strong", { hasText: new RegExp(`^${label}$`) }) });
      const entries = scope => scope.locator(layout === "List" ? ".jobs-table tbody tr" : ".job-tile");
      await expect(groups.locator("summary > strong")).toHaveText(["2026", "2025", "2024", "2005", "Year not set"]);
      await expect(page.locator(".job-year-groups > .table-summary strong")).toHaveText("6 inactive jobs");
      await expect(page.locator("#job-search-scope")).toHaveCount(1);
      await expect(group("2026")).toHaveAttribute("open", "");
      await expect(entries(group("2026"))).toHaveCount(2);
      await expect(entries(group("2026")).first()).toContainText("26912");
      await expect(entries(group("2026")).last()).toContainText("Cancelled");
      await expect(entries(group("2025"))).not.toBeVisible();
      await group("2025").locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(entries(group("2025"))).toBeVisible();
      await expect(entries(group("2025"))).toContainText("25904");

      for (const theme of ["light", "dark"]) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.body.dataset.theme = theme; }, theme);
        const ratios = await groups.first().locator("summary").evaluate(element => {
          const luminance = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
          const bg = luminance(getComputedStyle(element).backgroundColor);
          return [...element.children].map(child => { const fg = luminance(getComputedStyle(child).color); return (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05); });
        });
        ratios.forEach(ratio => expect(ratio).toBeGreaterThanOrEqual(4.5));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
        if (process.env.JGC_CAPTURE_VISUAL_QA === "1") await page.locator(".job-year-groups").screenshot({ path: testInfo.outputPath(`inactive-years-${layout}-${width}-${theme}.png`) });
      }

      const manager = page.getByRole("combobox", { name: "Filter jobs by project manager" });
      await manager.selectOption({ label: "Old Manager" });
      await expect(groups).toHaveCount(1);
      await expect(group("2024")).toHaveAttribute("open", "");
      await expect(entries(group("2024"))).toContainText("24911");
      await manager.selectOption("");
      const search = page.getByLabel("Search jobs", { exact: true });
      for (const number of ["05901", "24911", "26902"]) {
        await search.fill(number);
        await expect(groups).toHaveCount(0);
        await expect(entries(page)).toHaveCount(1);
        await expect(entries(page)).toBeVisible();
        await expect(entries(page)).toContainText(number);
        await expect(page.locator("#job-search-scope")).toHaveText("Searching active and inactive jobs");
      }
      await search.fill("Pending");
      await expect(entries(page)).toContainText("Pending");
      await search.fill("");
      await expect(groups).toHaveCount(5);
      await layouts.getByRole("button", { name: layout === "List" ? "Tiles" : "List", exact: true }).click();
      await expect(groups.locator("summary > strong")).toHaveText(["2026", "2025", "2024", "2005", "Year not set"]);
      await filters.getByRole("button", { name: "Active", exact: true }).click();
      await expect(groups).toHaveCount(0);
      expect(captures.jobInfo).toEqual([]);
      expect(captures.writes).toEqual([]);
      expect(captures.unexpectedRequests).toEqual([]);
    });
  }
}

test("phone job List rows are compact without shrinking readable text", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await serveDirectory(page, directoryState());
  const row = page.locator(".jobs-table tbody tr").filter({ hasText: "26902" });
  const measurements = await row.evaluate(element => ({
    height: element.getBoundingClientRect().height,
    font: parseFloat(getComputedStyle(element.querySelector('td[data-label="Job name"] strong')).fontSize),
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  await row.scrollIntoViewIfNeeded();
  await row.screenshot({ path: testInfo.outputPath('compact-row.png') });
  expect(measurements.height, JSON.stringify(measurements)).toBeLessThanOrEqual(110);
  expect(measurements.font).toBeGreaterThanOrEqual(13);
  expect(measurements.overflow).toBe(false);
  const oldHeight = await row.evaluate(element => {
    const directory = element.closest('.job-directory-page');
    directory.classList.remove('job-view-list');
    const height = element.getBoundingClientRect().height;
    directory.classList.add('job-view-list');
    return height;
  });
  await testInfo.attach('mobile-row-dimensions', { body: JSON.stringify({ oldHeight, newHeight: measurements.height, reduction: 1 - measurements.height / oldHeight }), contentType: 'application/json' });
  expect(measurements.height / oldHeight).toBeLessThanOrEqual(0.35);
  await captureVisual(page, testInfo, "compact-phone-list");
  await page.getByRole("group", { name: "Job layout" }).getByRole("button", { name: "Tiles" }).click();
  await expect(page.locator(".job-tile")).toHaveCount(3);
  await captureVisual(page, testInfo, "compact-phone-tiles");
});

for (const width of [390, 1366]) {
  test(`Recent Work shares the List and Tiles preference at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const state = directoryState();
    state.quotes.push({ ...state.quotes[0], id: "overview-draft", number: "JGC-Q-2026-0999", status: "Draft" });
    const captures = await serveDirectory(page, state, { overview: true });
    await page.getByRole("button", { name: "Company-wide", exact: true }).click();
    const layout = page.getByRole("group", { name: "Recent work layout" });
    await expect(layout.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".recent-quotes-panel .recent-work-row")).toHaveCount(1);
    await expect(page.locator(".recent-jobs-panel .recent-work-row")).toHaveCount(1);
    await captureVisual(page, testInfo, `recent-list-${width}`);
    await layout.getByRole("button", { name: "Tiles" }).click();
    await expect(page.locator(".recent-work-grid")).toHaveClass(/recent-work-layout-tiles/);
    await captureVisual(page, testInfo, `recent-tiles-${width}`);
    if (width <= 760) await page.locator(".mobile-menu").click();
    await page.getByRole("button", { name: /^Jobs(?:\s|$)/ }).click();
    await expect(page.getByRole("group", { name: "Job layout" }).getByRole("button", { name: "Tiles" })).toHaveAttribute("aria-pressed", "true");
    expect(captures.writes).toEqual([]);
    expect(captures.jobInfo).toEqual([]);
  });
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
  await expect(page.getByLabel("Search jobs", { exact: true })).toHaveValue("");
  await expect(page.locator(".library-folder")).toHaveCount(0);
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(3);
  await expect(page.locator(".jobs-table thead th")).toHaveText(["Job # / quote", "Client / location", "Job name", "Project manager", "Type", "Status", "Change status"]);
  await expect(page.locator('.jobs-table td[data-label="Job / quote"] button')).toHaveText(["26903", "26902", "26901"]);
  const imported = page.locator(".jobs-table tbody tr").filter({ hasText: "26902" });
  await expect(imported).toContainText("Canonical Railway Client");
  await expect(imported).toContainText("Imported Emergency Repairs");
  await expect(imported.locator('td').nth(1)).toContainText("Canonical Railway Client");
  await expect(imported.locator('td').nth(2)).toContainText("Imported Emergency Repairs");
  await expect(imported.locator('[data-label="Project manager"]')).toHaveText("Directory Test Manager");
  await expect(imported.locator('[data-label="Type"]')).toHaveText("T&M");
  await expect(imported).not.toContainText(/Quote unavailable|Unassigned|NaN|Infinity/);
  for (const label of ["Accepted price", "Estimate cost", "Forecast margin"]) {
    await expect(imported.locator(`[data-label="${label}"]`)).toHaveCount(0);
  }
  await expect(page.locator(".jobs-table tbody tr").filter({ hasText: "26901" })).toContainText("JGC-Q-2026-0901");
  await page.getByLabel("Search jobs", { exact: true }).fill("Canonical Railway Client");
  // All query words can match across client and location, just like Overview.
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(3);
  await page.getByLabel("Search jobs", { exact: true }).fill("CanonicalRailwayClient");
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(2);
  await expect(page.locator(".jobs-table tbody tr").filter({ hasText: "25904" })).toContainText("Inactive");
  await page.getByLabel("Search jobs", { exact: true }).fill("Directory Test Manager");
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(4);
  await captureVisual(page, testInfo, "directory-desktop");
  await page.getByLabel("Search jobs", { exact: true }).fill("");
  await page.getByRole("group", { name: "Filter jobs by status" }).getByRole("button", { name: /Inactive|Archived/ }).click();
  await expect(page.getByRole("table", { name: "2025 inactive jobs" }).locator("thead th")).toHaveText(["Job # / quote", "Client / location", "Job name", "Project manager", "Type", "Status", "Change status"]);
  await expect(page.getByRole("table", { name: "2025 inactive jobs" }).locator("tbody td").nth(1)).toContainText("Canonical Railway Client");
  await expect(page.getByRole("table", { name: "2025 inactive jobs" }).locator("tbody td").nth(2)).toContainText("Historical Imported Repair");
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

for (const width of [320, 390, 1366]) {
  test(`job header offers distinct cancel and close actions beside the quote at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const captures = await serveDirectory(page, directoryState());
    await openDirectoryJob(page, "26901");
    const buttons = page.locator(".job-topline .quote-primary-actions button");
    await expect(buttons).toHaveText(["Open accepted quote", "Cancel Job", "Close Project", "＋ Add actual"]);
    const cancel = page.getByRole("button", { name: "Cancel Job — job 26901", exact: true });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.body.dataset.theme = theme; }, theme);
      const contrast = await cancel.evaluate(element => {
        const style = getComputedStyle(element);
        const luminance = value => {
          const channels = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
          return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
        };
        const a = luminance(style.color), b = luminance(style.backgroundColor);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
      if (process.env.JGC_CAPTURE_VISUAL_QA === "1") await page.locator(".job-topline").screenshot({ path: testInfo.outputPath(`job-actions-${width}-${theme}.png`) });
    }
    page.once("dialog", dialog => dialog.dismiss());
    await cancel.click();
    expect(captures.jobInfo).toEqual([]);
    page.once("dialog", dialog => dialog.accept());
    await cancel.click();
    await expect(page.locator(".job-topline .status-pill")).toHaveText("Cancelled");
    await expect(page.getByRole("button", { name: "Make active — job 26901", exact: true })).toBeVisible();
    expect(captures.jobInfo[0].body).toEqual({ portalJobId: officialIds.quoted, active: false, cancelled: true });
    await expect.poll(() => captures.writes.length).toBeGreaterThan(0);
    const saved = captures.writes.at(-1);
    expect(saved.jobs[0]).toEqual(expect.objectContaining({ cancelledAt: fixtureDate, status: "Archived", portalActive: false }));
    // Load the saved state again: cancellation is not just an ephemeral label.
    await serveDirectory(page, saved);
    await openDirectoryJob(page, "26901");
    await expect(page.locator(".job-topline .status-pill")).toHaveText("Cancelled");
  });
}

for (const layout of ["List", "Tiles"]) for (const width of [390, 1366]) {
  test(`${layout} cancellation is stacked, confirmed and reversible at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = directoryState();
    const captures = await serveDirectory(page, state);
    await page.getByLabel("Search jobs", { exact: true }).fill("26901");
    await page.getByRole("group", { name: "Job layout" }).getByRole("button", { name: layout, exact: true }).click();
    const close = page.getByRole("button", { name: "Close Project — job 26901", exact: true });
    const cancel = page.getByRole("button", { name: "Cancel Job — job 26901", exact: true });
    const closeBox = await close.boundingBox(), cancelBox = await cancel.boundingBox();
    expect(cancelBox.height).toBe(24);
    expect(cancelBox.y).toBeGreaterThanOrEqual(closeBox.y + closeBox.height + 8);
    if (process.env.JGC_CAPTURE_VISUAL_QA === "1") await page.locator(layout === "List" ? ".jobs-table" : ".job-tiles").screenshot({ path: testInfo.outputPath(`cancel-${layout}-${width}.png`) });
    page.once("dialog", async dialog => { expect(dialog.message()).toContain("Cancel job 26901"); expect(dialog.message()).toContain("history are kept"); await dialog.dismiss(); });
    await cancel.click();
    expect(captures.jobInfo).toEqual([]);
    page.once("dialog", dialog => dialog.accept());
    await cancel.click();
    await expect(page.locator(".job-directory-page")).toContainText("Job 26901 is now cancelled");
    await expect(page.locator(".job-directory-page .status-pill")).toHaveText("Cancelled");
    await expect(page.locator(".job-detail-page")).toHaveCount(0);
    await expect.poll(() => captures.writes.length).toBeGreaterThan(0);
    const saved = captures.writes.at(-1).jobs[0];
    for (const key of ["id", "portalJobId", "jobNumber", "quoteId", "acceptedQuoteSnapshot", "costs", "purchaseOrders", "documentLinks"]) expect(saved[key]).toEqual(state.jobs[0][key]);
    await page.getByLabel("Search jobs", { exact: true }).fill("");
    await page.getByRole("group", { name: "Filter jobs by status" }).getByRole("button", { name: "Inactive", exact: true }).click();
    await expect(page.getByRole("button", { name: "Make active — job 26901", exact: true })).toBeVisible();
    await page.locator(".job-year-group").filter({ has: page.locator("summary > strong", { hasText: /^2025$/ }) }).locator("summary").click();
    await expect(page.getByRole("button", { name: "Make active — job 25904", exact: true })).toBeVisible();
    await page.getByLabel("Search jobs", { exact: true }).fill("26901");
    await page.getByRole("button", { name: "Make active — job 26901", exact: true }).click();
    await expect(cancel).toBeVisible();
    await expect(close).toBeVisible();
    await expect(page.locator(".job-directory-page .status-pill")).toHaveText("Active");
    expect(captures.jobInfo).toHaveLength(2);
    expect(captures.unexpectedRequests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
  });
}

test("failed cancellation leaves the original status and both actions available", async ({ page }) => {
  const captures = await serveDirectory(page, directoryState(), { failJobInfo: true });
  await openDirectoryJob(page, "26901");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Cancel Job — job 26901", exact: true }).click();
  await expect(page.locator(".job-detail-page")).toContainText("Canonical job update rejected");
  await expect(page.locator(".job-topline .status-pill")).toHaveText("Active");
  await expect(page.getByRole("button", { name: "Cancel Job — job 26901", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Close Project — job 26901", exact: true })).toBeEnabled();
  expect(captures.writes).toEqual([]);
});

test("canonical status changes preserve the official ID and change no quote or operational record", async ({ page }) => {
  const state = directoryState();
  const captures = await serveDirectory(page, state);
  await openDirectoryJob(page, "26902");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /Close Project/ }).click();
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
  await page.getByRole("button", { name: /Close Project/ }).click();
  await expect.poll(() => captures.jobInfo.length).toBe(1);
  await expect(page.locator(".job-detail-page")).toContainText("Canonical job update rejected for this test");
  await expect(page.getByRole("button", { name: /Close Project/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Restore active job|Mark active|Make active/ })).toHaveCount(0);
  expect(captures.writes).toEqual([]);
  await page.getByRole("button", { name: "← All jobs", exact: true }).click();
  await openDirectoryJob(page, "26902");
  await assertSelectedTab(page, "Statistics / Other");
});

for (const layout of ["List", "Tiles"]) {
  for (const width of [390, 1366]) {
    test(`${layout} directory changes Active and Inactive jobs safely at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const state = directoryState();
      state.jobs[0].notes = "Keep the accepted job notes";
      const captures = await serveDirectory(page, state);
      await page.getByLabel("Search jobs", { exact: true }).fill("26901");
      await page.getByRole("group", { name: "Job layout" }).getByRole("button", { name: layout, exact: true }).click();
      const action = page.getByRole("button", { name: "Close Project — job 26901", exact: true });
      await expect(action).toBeVisible();
      await expect(action).toHaveText("Close Project");
      const size = await action.boundingBox();
      expect(size.height).toBe(24);
      expect(size.width).toBeGreaterThan(70);
      expect(size.width).toBeLessThan(110);
      expect(await action.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
      if (process.env.JGC_CAPTURE_VISUAL_QA === "1") await page.locator(layout === "List" ? ".jobs-table" : ".job-tiles").screenshot({ path: testInfo.outputPath(`close-project-${layout}-${width}.png`) });
      page.once("dialog", async dialog => {
        expect(dialog.message()).toContain("Close project");
        expect(dialog.message()).toContain("26901");
        expect(dialog.message()).toContain("history are kept");
        await dialog.dismiss();
      });
      await action.click();
      await expect(action).toBeEnabled();
      expect(captures.jobInfo).toEqual([]);
      expect(captures.writes).toEqual([]);
      page.once("dialog", dialog => dialog.accept());
      await action.click();
      await expect.poll(() => captures.jobInfo.length).toBe(1);
      expect(captures.jobInfo[0]).toEqual({ method: "PATCH", body: { portalJobId: officialIds.quoted, active: false } });
      await expect(page.locator(".job-directory-page")).toContainText("Job 26901 is now inactive");
      await expect(page.locator(".job-detail-page")).toHaveCount(0);
      await expect(action).toHaveCount(0);
      const filters = page.getByRole("group", { name: "Filter jobs by status" });
      await expect(filters.getByRole("button", { name: "Inactive", exact: true })).toBeDisabled();
      const restore = page.getByRole("button", { name: "Make active — job 26901", exact: true });
      await expect(restore).toBeVisible();
      await expect(page.getByLabel("Search jobs", { exact: true })).toHaveValue("26901");
      await expect.poll(() => captures.writes.length).toBeGreaterThan(0);
      const saved = captures.writes.at(-1);
      const inactive = saved.jobs.find(job => job.portalJobId === officialIds.quoted);
      expect(inactive).toEqual(expect.objectContaining({ id: "existing-estimator-job", jobNumber: "26901", status: "Archived", portalActive: false, notes: "Keep the accepted job notes", acceptedRevenue: 12000, acceptedQuoteSnapshot: state.jobs[0].acceptedQuoteSnapshot }));
      expect(saved.jobs.map(job => job.id)).toEqual(state.jobs.map(job => job.id));
      expect(saved.quotes.map(quote => quote.id)).toEqual(state.quotes.map(quote => quote.id));
      expect(inactive.costs).toEqual(state.jobs[0].costs);
      expect(inactive.purchaseOrders).toEqual(state.jobs[0].purchaseOrders);
      if (process.env.JGC_CAPTURE_VISUAL_QA === "1") await page.locator(".job-directory-page").screenshot({ path: testInfo.outputPath(`inactive-${layout}-${width}.png`) });
      await restore.click();
      await expect.poll(() => captures.jobInfo.length).toBe(2);
      expect(captures.jobInfo[1]).toEqual({ method: "PATCH", body: { portalJobId: officialIds.quoted, active: true } });
      await expect(page.locator(".job-directory-page")).toContainText("Job 26901 is now active");
      await expect(restore).toHaveCount(0);
      await expect(action).toBeVisible();
      await page.getByLabel("Search jobs", { exact: true }).fill("");
      await expect(filters.getByRole("button", { name: "Active", exact: true })).toHaveAttribute("aria-pressed", "true");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
      expect(captures.unexpectedRequests).toEqual([]);
    });
  }
  test(`${layout} directory keeps failed status changes and unlinked jobs safe`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const state = directoryState();
    state.jobs[2].portalJobId = null;
    const captures = await serveDirectory(page, state, { failJobInfo: true });
    await page.getByRole("group", { name: "Job layout" }).getByRole("button", { name: layout, exact: true }).click();
    await expect(page.getByRole("button", { name: "Close Project — job 26903", exact: true })).toBeDisabled();
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Close Project — job 26902", exact: true }).click();
    await expect(page.locator(".job-directory-page")).toContainText("Canonical job update rejected for this test");
    await expect(page.getByRole("button", { name: "Close Project — job 26902", exact: true })).toBeEnabled();
    await expect(page.locator(".job-detail-page")).toHaveCount(0);
    expect(captures.jobInfo).toHaveLength(1);
    expect(captures.writes).toEqual([]);
    expect(captures.unexpectedRequests).toEqual([]);
  });
}

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

function managerAliasDirectoryState() {
  const state = directoryState();
  const managers = ["ZH", "Zeth Hummel", "  zH  ", " zEtH   HUMMEL ", "JV", "Jeff Vandrish", "  jV  ", " jEfF   VANDRISH ", "Alex Site Manager"];
  state.jobs = [
    { ...state.jobs[0], projectManager: "Independent Job Manager" },
    ...managers.map((projectManager, index) => {
      const portalJobId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`;
      return officialJob("contract", {
        id: `portal-job-${portalJobId}`, portalJobId, jobNumber: String(26902 + index),
        project: `Manager alias fixture ${index + 1}`, portalJobName: `Manager alias fixture ${index + 1}`,
        projectManager, jobType: "Contract", portalCustomer: "Alias Fixture Client", portalAddress: "Alias Job Site", acceptedAt: fixtureDate,
      });
    }),
  ];
  return state;
}

test("Jobs list combines manager, status and search filters and opens directly with the keyboard", async ({ page }) => {
  const state = managerAliasDirectoryState();
  const archivedJob = state.jobs[2];
  archivedJob.status = "Archived";
  archivedJob.portalActive = false;
  const captures = await serveDirectory(page, state);
  const managerFilter = page.getByRole("combobox", { name: "Filter jobs by project manager" });
  const search = page.getByLabel("Search jobs", { exact: true });
  await managerFilter.selectOption({ label: "Zeth Hummel" });
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(3);
  await page.getByRole("group", { name: "Filter jobs by status" }).getByRole("button", { name: "Inactive", exact: true }).click();
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(1);
  await search.fill("not a real job");
  await expect(page.getByRole("heading", { name: "No matching jobs found" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(managerFilter).toHaveValue("");
  await expect(search).toHaveValue("");
  const open = page.locator(".jobs-table").getByRole("button", { name: archivedJob.jobNumber, exact: true });
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".job-detail-page")).toContainText(`JOB ${archivedJob.jobNumber}`);
  await page.getByRole("button", { name: "← All jobs", exact: true }).click();
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Inactive", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(captures.writes).toEqual([]);
  expect(captures.jobInfo).toEqual([]);
});

test("manager aliases merge initials and full names into one project manager filter option", async ({ page }, testInfo) => {
  const captures = await serveDirectory(page, managerAliasDirectoryState());
  const managerFilter = page.getByRole("combobox", { name: "Filter jobs by project manager" });
  await expect(managerFilter.locator("option")).toHaveText(["All managers", "Alex Site Manager", "Independent Job Manager", "Jeff Vandrish", "Zeth Hummel"]);
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(10);
  await expect(page.locator(".library-folder")).toHaveCount(0);
  if (process.env.JGC_DIRECTORY_VISUAL_QA === "1") {
    const originalViewport = page.viewportSize();
    await captureVisual(page, testInfo, "jobs-list-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("#estimate-navigation")).not.toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const aligned = await page.locator('.jobs-table tbody tr').evaluateAll((rows) => rows.every((row) => {
      const number = row.querySelector('[data-label="Job / quote"]').getBoundingClientRect(), name = row.querySelector('[data-label="Job name"]').getBoundingClientRect(), status = row.querySelector('[data-label="Status"]').getBoundingClientRect();
      return number.right <= name.left && name.right <= status.left;
    }));
    expect(aligned, "Compact mobile job identity and status columns must not overlap").toBe(true);
    await captureVisual(page, testInfo, "jobs-list-phone");
    await page.locator(".jobs-table tbody tr").first().screenshot({ path: testInfo.outputPath("jobs-list-phone-row.png") });
    if (originalViewport) await page.setViewportSize(originalViewport);
  }
  for (const [name, expectedNumbers] of [
    ["Zeth Hummel", ["26902", "26903", "26904", "26905"]],
    ["Jeff Vandrish", ["26906", "26907", "26908", "26909"]],
  ]) {
    await managerFilter.selectOption({ label: name });
    await expect(page.locator(".jobs-table tbody tr")).toHaveCount(4);
    expect((await page.locator('.jobs-table td[data-label="Job / quote"] .back-button').allTextContents()).sort()).toEqual(expectedNumbers);
    await managerFilter.selectOption("");
  }
  expect(captures.writes).toEqual([]);
  expect(captures.jobInfo).toEqual([]);
  expect(captures.unexpectedRequests).toEqual([]);
});

test("manager alias searches find the same jobs using initials or full names", async ({ page }) => {
  const captures = await serveDirectory(page, managerAliasDirectoryState());
  const search = page.getByLabel("Search jobs", { exact: true });
  for (const [queries, name, expectedNumbers] of [
    [["ZH", "zh", " Zeth   Hummel "], "Zeth Hummel", ["26902", "26903", "26904", "26905"]],
    [["JV", "jv", " Jeff   Vandrish "], "Jeff Vandrish", ["26906", "26907", "26908", "26909"]],
  ]) {
    for (const query of queries) {
      await search.fill(query);
      await expect(page.locator(".jobs-table tbody tr")).toHaveCount(4);
      expect((await page.locator('.jobs-table td[data-label="Job / quote"] .back-button').allTextContents()).sort()).toEqual(expectedNumbers);
      for (const row of await page.locator(".jobs-table tbody tr").all()) await expect(row.locator('td[data-label="Project manager"]')).toHaveText(name);
    }
  }
  expect(captures.writes).toEqual([]);
  expect(captures.jobInfo).toEqual([]);
  expect(captures.unexpectedRequests).toEqual([]);
});

test("manager aliases leave unknown names and similar but unconfirmed names unchanged", async ({ page }) => {
  const state = managerAliasDirectoryState();
  const names = ["Alex Site Manager", "Zeth Hummel Jr.", "Jeff Vandrish Consulting", "JH", "Z.H."];
  state.jobs = state.jobs.slice(1, names.length + 1).map((job, index) => ({ ...job, projectManager: names[index] }));
  const captures = await serveDirectory(page, state);
  const managerFilter = page.getByRole("combobox", { name: "Filter jobs by project manager" });
  await expect(managerFilter.locator("option")).toHaveCount(names.length + 1);
  for (const name of names) await expect(managerFilter.getByRole("option", { name, exact: true })).toHaveCount(1);
  await expect(managerFilter.getByRole("option", { name: "Zeth Hummel", exact: true })).toHaveCount(0);
  await expect(managerFilter.getByRole("option", { name: "Jeff Vandrish", exact: true })).toHaveCount(0);
  for (const [index, name] of names.entries()) {
    await page.getByLabel("Search jobs", { exact: true }).fill(name);
    await expect(page.locator(".jobs-table tbody tr")).toHaveCount(1);
    await expect(page.locator('.jobs-table td[data-label="Project manager"]')).toHaveText(name);
    await expect(page.locator('.jobs-table td[data-label="Job / quote"] .back-button')).toHaveText(state.jobs[index].jobNumber);
  }
  await openDirectoryJob(page, state.jobs[0].jobNumber);
  await expect(page.locator(".job-summary-facts > div").filter({ has: page.getByText("Project manager", { exact: true }) }).locator("strong")).toHaveText(names[0]);
  await page.getByRole("button", { name: "Edit job details", exact: true }).click();
  await expect(page.getByLabel("Project manager", { exact: true })).toHaveValue(names[0]);
  await page.locator(".job-summary-editor-actions").getByRole("button", { name: "Cancel", exact: true }).click();
  expect(captures.writes).toEqual([]);
  expect(captures.jobInfo).toEqual([]);
  expect(captures.unexpectedRequests).toEqual([]);
});

test("manager aliases filter by job responsibility without rewriting raw assignments, quote owners or official IDs", async ({ page }) => {
  const state = managerAliasDirectoryState();
  const quotedJob = state.jobs[0];
  const quote = state.quotes[0];
  quotedJob.projectManager = "  ZH  ";
  quote.preparedBy = "JV";
  quote.ownerUserId = "unchanged-quote-owner-account";
  quote.ownerName = "Original Account Display";
  quotedJob.acceptedQuoteSnapshot = JSON.stringify(quote);
  const captures = await serveDirectory(page, state);
  const managerFilter = page.getByRole("combobox", { name: "Filter jobs by project manager" });
  await managerFilter.selectOption({ label: "Jeff Vandrish" });
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(4);
  await managerFilter.selectOption({ label: "Zeth Hummel" });
  await expect(page.locator(".jobs-table tbody tr")).toHaveCount(5);
  await expect(managerFilter.getByRole("option", { name: "Original Account Display", exact: true })).toHaveCount(0);
  await openDirectoryJob(page, quotedJob.jobNumber);
  await expect(page.locator(".job-topline .quote-identity p")).toContainText("PM Zeth Hummel");
  await expect(page.locator(".job-summary-facts > div").filter({ has: page.getByText("Project manager", { exact: true }) }).locator("strong")).toHaveText("Zeth Hummel");
  await page.getByRole("button", { name: "Edit job details", exact: true }).click();
  await expect(page.getByLabel("Project manager", { exact: true })).toHaveValue("  ZH  ");
  await page.locator(".job-summary-editor-actions").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("tab", { name: "Statistics / Other", exact: true }).click();
  await expect.poll(() => captures.statistics).toContain(quotedJob.portalJobId);
  await page.getByRole("button", { name: "Open accepted quote", exact: true }).click();
  await expect(page.locator(".quote-workspace .quote-identity")).toContainText(quote.number);
  await page.getByRole("tab", { name: /Details/ }).click();
  await expect(page.getByLabel("Prepared by", { exact: true })).toHaveValue("JV");
  await expect(page.getByLabel("Prepared by", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Return to job", exact: true }).click();
  await expect(page.locator(".job-detail-page")).toContainText(`JOB ${quotedJob.jobNumber}`);
  expect([...new Set(captures.statistics)]).toEqual([officialIds.quoted]);
  expect(captures.writes).toEqual([]);
  expect(captures.jobInfo).toEqual([]);
  expect(captures.unexpectedRequests).toEqual([]);
});
