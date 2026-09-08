// Synthetic canonical jobs for isolated visual QA; all external services are blocked.
const { expect } = require("@playwright/test");

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
    ...(typeof body.active === "boolean" ? {
      cancelledAt: body.cancelled ? fixtureDate : "",
      invoiceReviewAt: body.invoiceReview ? fixtureDate : "",
    } : { cancelledAt: job.cancelledAt, invoiceReviewAt: job.invoiceReviewAt }),
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


module.exports = { directoryState, statisticsFor, serveDirectory, openDirectoryJob, officialIds, fixtureDate };
