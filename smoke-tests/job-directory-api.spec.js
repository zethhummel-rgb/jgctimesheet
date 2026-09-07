const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { webcrypto } = require("crypto");
const ts = require("../estimating-app/node_modules/typescript");
const { test, expect } = require("@playwright/test");

const root = path.resolve(__dirname, "..");
const clone = (value) => JSON.parse(JSON.stringify(value));

function transpileModule(relative, dependencies = {}, extra = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { module, exports: module.exports, require: (name) => dependencies[name] || {},
    Response, Request, URL, TextEncoder, Uint8Array, crypto: webcrypto, console, ...extra };
  vm.runInNewContext(code, context, { filename: relative });
  return module.exports;
}

function loadApi() {
  const browser = { location: { href: "http://127.0.0.1/estimating/index.html" }, fetch: async () => { throw new Error("Unexpected external request"); } };
  const workbook = transpileModule("estimating-app/lib/job-workbook-import.ts");
  const api = transpileModule("estimating-app/src/portal-api.ts", {
    "../lib/job-workbook-import": workbook,
    "../lib/estimator-data": { normalizeAppState: (state) => state },
  }, { window: browser });
  return { api, browser };
}

function mockClient(tables, options = {}) {
  tables.profiles ??= [{ id: "approved-admin", role: "admin", account_status: "approved" }];
  const calls = [];
  let writeCount = 0;
  const client = { calls, tables, auth: { getUser: async () => ({ data: { user: { id: "approved-admin" } }, error: null }) }, from(table) {
    const filters = [];
    const orders = [];
    let operation = "select", payload, upsertOptions, range = null;
    const chain = {
      select(fields, settings) { calls.push({ table, operation: "select", fields, settings }); return chain; },
      eq(key, value) { filters.push((row) => row[key] === value); return chain; },
      is(key, value) { filters.push((row) => (row[key] ?? null) === value); return chain; },
      gt(key, value) { filters.push((row) => row[key] > value); return chain; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return chain; },
      contains(key, value) { filters.push((row) => Object.entries(value).every(([nested, wanted]) => JSON.stringify(row[key]?.[nested]) === JSON.stringify(wanted))); return chain; },
      order(key, settings = {}) { orders.push([key, settings.ascending !== false]); return chain; },
      range(from, to) { range = [from, to]; return chain; },
      update(value) { operation = "update"; payload = value; return chain; },
      upsert(value, settings) { operation = "upsert"; payload = value; upsertOptions = settings; return chain; },
      async maybeSingle() { const result = await execute(); return { ...result, data: result.data?.[0] || null }; },
      async single() { const result = await execute(); return { ...result, data: result.data?.[0] || null }; },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    async function execute() {
      if (options.denyTable === table) return { data: null, error: { code: "42501", message: "Permission denied" } };
      if (operation === "upsert" || operation === "update") {
        writeCount++;
        calls.push({ table, operation, payload: clone(payload), options: upsertOptions });
        if (options.failWrite) return { data: null, error: { message: "Simulated database rejection" } };
        if (operation === "upsert") {
          for (const record of payload) {
            const existing = tables[table].find((row) => row.job_number === record.job_number);
            if (existing) Object.assign(existing, record);
            else tables[table].push({ id: `new-${record.job_number}`, ...record });
          }
          return { data: null, error: null };
        }
        tables[table].filter((row) => filters.every((filter) => filter(row))).forEach((row) => Object.assign(row, payload));
      }
      let rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
      for (const [key, ascending] of [...orders].reverse()) rows.sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * (ascending ? 1 : -1));
      const count = rows.length;
      if (range) {
        calls.push({ table, operation: "range", range });
        if (options.stopAfterFirstPage && range[0] > 0) rows = [];
        else rows = rows.slice(range[0], Math.min(range[1] + 1, range[0] + (options.serverPageSize || 500)));
      }
      return { data: clone(rows), error: null, count };
    }
    return chain;
  }, get writes() { return writeCount; } };
  return client;
}

function job(id, number, extra = {}) {
  return { id, job_number: number, job_name: `Job ${number}`, active: true, job_type: "T&M", project_manager: "ZH", updated_at: "2026-09-01T12:00:00Z", ...extra };
}

function importRow(number, extra = {}) { return { jobNumber: number, jobName: `Updated ${number}`, projectManager: "PM", jobType: "Contract", active: true, ...extra }; }
function workspace(jobs = []) { return [{ id: "main", payload: { jobs } }]; }

async function request(browser, endpoint, body, method = "POST") {
  const response = await browser.fetch(`http://127.0.0.1/estimating/api/${endpoint}`, {
    method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

test("official job directory paginates beyond 1000 rows even with a lower server cap", async () => {
  const { api, browser } = loadApi();
  const client = mockClient({ jobs: Array.from({ length: 1205 }, (_, index) => job(`id-${index}`, String(index).padStart(5, "0"))) }, { serverPageSize: 125 });
  api.installEstimatorApiBridge(client);
  const result = await request(browser, "jobs", undefined, "GET");
  expect(result.status).toBe(200);
  expect(result.body.jobs).toHaveLength(1205);
  expect(result.body.jobs.some((row) => row.jobNumber === "00001")).toBe(true);
  expect(client.calls.filter((call) => call.operation === "range")).toHaveLength(10);
  expect(client.writes).toBe(0);
});

test("directory fails closed instead of returning a truncated job list", async () => {
  const { api, browser } = loadApi();
  api.installEstimatorApiBridge(mockClient({ jobs: Array.from({ length: 501 }, (_, index) => job(`id-${index}`, String(index))) }, { stopAfterFirstPage: true }));
  const result = await request(browser, "jobs", undefined, "GET");
  expect(result.status).toBe(500);
  expect(result.body.jobs).toBeUndefined();
  expect(result.body.error).toContain("full list");
});

test("canonical synchronization adds unquoted jobs and retains existing local IDs, quotes and costs", () => {
  const { api } = loadApi();
  const local = { id: "existing-estimator-id", portalJobId: "quoted", jobNumber: "001", quoteId: "quote-a", project: "Accepted project", costs: [{ id: "unsaved-cost", preTaxAmount: 123 }], notes: "Unsaved notes", documentLinks: [{ id: "internal", label: "Internal", url: "https://example.com/private" }] };
  const state = { vendors: [], quotes: [{ id: "quote-a", project: "Unsaved quote edit" }], jobs: [local] };
  const canonical = [job("quoted", "001"), job("unquoted", "002", { active: false })].map((row) => ({ id: row.id, jobNumber: row.job_number, jobName: row.job_name, active: row.active, jobType: row.job_type, customer: "Client", address: "Site", projectManager: "ZH", startDate: "", targetEndDate: "" }));
  const merged = api.synchronizePortalJobs(state, canonical);
  expect(merged.quotes).toBe(state.quotes);
  expect(merged.jobs[0].id).toBe("existing-estimator-id");
  expect(merged.jobs[0].costs).toBe(local.costs);
  expect(merged.jobs[0].notes).toBe("Unsaved notes");
  expect(merged.jobs[0].project).toBe("Accepted project");
  expect(merged.jobs[0].documentLinks).toEqual(local.documentLinks);
  expect(merged.jobs[1]).toEqual(expect.objectContaining({ id: "portal-job-unquoted", portalJobId: "unquoted", quoteId: "", clientId: "", acceptedRevenue: 0, acceptedAt: "", status: "Archived" }));
  expect(api.synchronizePortalJobs(merged, canonical).jobs).toHaveLength(2);
  expect(state.jobs).toHaveLength(1);
  const stale = api.synchronizePortalJobs({ ...state, jobs: [{ ...local, portalJobId: "old-deleted-id" }] }, canonical);
  expect(stale.jobs[0].portalJobId).toBe("old-deleted-id");
  expect(stale.jobs.find((row) => row.id === "portal-job-quoted").portalJobId).toBe("quoted");
});

test("active changes preserve the canonical ID and reject malformed statuses and number changes", async () => {
  const { api, browser } = loadApi();
  const client = mockClient({ jobs: [job("unchanged-id", "0007", { document_link: "https://example.com/drawings" })] });
  api.installEstimatorApiBridge(client);
  expect((await request(browser, "job-info", { portalJobId: "unchanged-id", active: "false" }, "PATCH")).status).toBe(400);
  expect((await request(browser, "job-info", { portalJobId: "unchanged-id", jobNumber: "999" }, "PATCH")).status).toBe(400);
  expect(client.writes).toBe(0);
  const inactive = await request(browser, "job-info", { portalJobId: "unchanged-id", active: false }, "PATCH");
  expect(inactive.body.job).toEqual(expect.objectContaining({ id: "unchanged-id", jobNumber: "0007", active: false }));
  expect(client.tables.jobs[0].removed_from_import_at).toBeTruthy();
  expect(client.tables.jobs[0].document_link).toBe("https://example.com/drawings");
  await request(browser, "job-info", { portalJobId: "unchanged-id", active: true }, "PATCH");
  expect(client.tables.jobs[0].removed_from_import_at).toBeNull();
  expect(client.tables.jobs[0].archive_until).toBeNull();
});

test("editing a project manager preserves the full imported 300-character job name", async () => {
  const { api, browser } = loadApi();
  const jobName = "Imported job - ".padEnd(300, "x");
  const client = mockClient({ jobs: [job("keep-long-name", "001")], estimator_workspaces: workspace() });
  api.installEstimatorApiBridge(client);
  const records = [importRow("001", { jobName })];
  const preview = (await request(browser, "job-import", { action: "preview", records })).body.preview;
  const imported = await request(browser, "job-import", { action: "apply", records, expectedSnapshot: preview.snapshot, deactivateMissingJobIds: [] });
  expect(imported.status).toBe(200);
  expect(client.tables.jobs[0].job_name).toBe(jobName);

  // The job-info form resubmits the current name even when only the PM changes.
  const edited = await request(browser, "job-info", { portalJobId: "keep-long-name", jobName, projectManager: "New PM" }, "PATCH");
  expect(edited.status).toBe(200);
  expect(edited.body.job).toEqual(expect.objectContaining({ id: "keep-long-name", jobNumber: "001", jobName, projectManager: "New PM" }));
  expect(client.tables.jobs[0].job_name).toBe(jobName);
  expect(client.tables.jobs[0].project_manager).toBe("New PM");
  expect(client.calls.find((call) => call.operation === "update").payload.job_name).toBe(jobName);
  expect(client.writes).toBe(2);
});

test("job information rejects invalid and overlength names without silently truncating or writing", async () => {
  const { api, browser } = loadApi();
  const client = mockClient({ jobs: [job("keep", "001")] });
  api.installEstimatorApiBridge(client);
  for (const jobName of [null, 42, {}, [], "", "   ", "x".repeat(301)]) {
    const rejected = await request(browser, "job-info", { portalJobId: "keep", jobName, projectManager: "Must not save" }, "PATCH");
    expect(rejected.status).toBe(400);
    expect(rejected.body.saved).toBeUndefined();
  }
  expect(client.writes).toBe(0);
  expect(client.tables.jobs[0]).toEqual(expect.objectContaining({ job_name: "Job 001", project_manager: "ZH" }));
});

test("import preview writes nothing and apply uses one statement without altering identities or metadata", async () => {
  const { api, browser } = loadApi();
  const tables = { jobs: [job("keep", "001", { customer: "Keep client", document_link: "https://example.com/drawings", start_date: "2026-10-01" }), job("missing", "002"), job("protected", "003")], estimator_workspaces: workspace([{ quoteId: "q", portalJobId: "protected", jobNumber: "003" }]) };
  const client = mockClient(tables);
  api.installEstimatorApiBridge(client);
  const records = [importRow("001", { id: "malicious-id", document_link: "https://example.com/changed" }), importRow("004")];
  const preview = (await request(browser, "job-import", { action: "preview", records })).body.preview;
  expect(client.writes).toBe(0);
  expect(preview).toEqual(expect.objectContaining({ insertCount: 1, updateCount: 1, activeCount: 2, inactiveCount: 0 }));
  expect(preview.missingJobs.map((row) => row.id)).toEqual(["missing"]);
  expect(preview.protectedMissingJobs.map((row) => row.id)).toEqual(["protected"]);
  const result = await request(browser, "job-import", { action: "apply", records, expectedSnapshot: preview.snapshot, deactivateMissingJobIds: ["missing"] });
  expect(result.status).toBe(200);
  expect(result.body.saved).toBe(true);
  expect(client.writes).toBe(1);
  const mutation = client.calls.find((call) => call.operation === "upsert");
  expect(mutation.options).toEqual({ onConflict: "job_number", defaultToNull: false });
  expect(mutation.payload).toHaveLength(3);
  for (const row of mutation.payload) {
    expect(row.id).toBeUndefined();
    expect(row.document_link).toBeUndefined();
    expect(row.customer).toBeUndefined();
    expect(row.start_date).toBeUndefined();
  }
  expect(tables.jobs.find((row) => row.id === "keep")).toEqual(expect.objectContaining({ job_number: "001", customer: "Keep client", document_link: "https://example.com/drawings", start_date: "2026-10-01" }));
  expect(tables.jobs.find((row) => row.id === "missing").active).toBe(false);
  expect(tables.jobs.find((row) => row.id === "protected").active).toBe(true);
});

test("import rejects stale previews, protected IDs, malformed rows, duplicate numbers and denied permissions without writes", async () => {
  const { api, browser } = loadApi();
  const client = mockClient({ jobs: [job("keep", "001"), job("protected", "003")], estimator_workspaces: workspace([{ quoteId: "q", portalJobId: "protected" }]) });
  api.installEstimatorApiBridge(client);
  for (const records of [undefined, {}, [null], [importRow("001"), importRow("001")], [importRow("001", { jobName: 42 })]]) {
    expect((await request(browser, "job-import", { action: "preview", records })).status).toBe(400);
  }
  const records = [importRow("001")];
  const preview = (await request(browser, "job-import", { action: "preview", records })).body.preview;
  expect((await request(browser, "job-import", { action: "apply", records, expectedSnapshot: preview.snapshot, deactivateMissingJobIds: ["protected"] })).status).toBe(400);
  client.tables.jobs[0].updated_at = "2026-09-07T20:00:00Z";
  expect((await request(browser, "job-import", { action: "apply", records, expectedSnapshot: preview.snapshot, deactivateMissingJobIds: [] })).status).toBe(409);
  expect(client.writes).toBe(0);
  const denied = loadApi();
  const deniedClient = mockClient({ jobs: [], estimator_workspaces: [] }, { denyTable: "estimator_workspaces" });
  denied.api.installEstimatorApiBridge(deniedClient);
  expect((await request(denied.browser, "job-import", { action: "preview", records })).status).toBe(500);
  expect(deniedClient.writes).toBe(0);
});

test("failed import does not report success or mutate the in-memory source list", async () => {
  const { api, browser } = loadApi();
  const client = mockClient({ jobs: [job("keep", "001")], estimator_workspaces: workspace() }, { failWrite: true });
  api.installEstimatorApiBridge(client);
  const records = [importRow("001")];
  const preview = (await request(browser, "job-import", { action: "preview", records })).body.preview;
  const result = await request(browser, "job-import", { action: "apply", records, expectedSnapshot: preview.snapshot, deactivateMissingJobIds: [] });
  expect(result.status).toBe(500);
  expect(result.body.saved).toBeUndefined();
  expect(client.tables.jobs[0].job_name).toBe("Job 001");
});

test("job-management endpoints reject ordinary and deactivated administrators before reading or changing jobs", async () => {
  for (const profile of [{ role: "employee", account_status: "approved" }, { role: "admin", account_status: "inactive" }]) {
    const { api, browser } = loadApi();
    const client = mockClient({ jobs: [job("keep", "001")], profiles: [{ id: "approved-admin", ...profile }] });
    api.installEstimatorApiBridge(client);
    expect((await request(browser, "jobs", undefined, "GET")).status).toBe(403);
    expect((await request(browser, "job-info", { portalJobId: "keep", active: false }, "PATCH")).status).toBe(403);
    expect((await request(browser, "job-import", { action: "preview", records: [importRow("001")] })).status).toBe(403);
    expect((await request(browser, "job-statistics?portalJobId=keep", undefined, "GET")).status).toBe(403);
    expect(client.calls.some((call) => call.table === "jobs")).toBe(false);
    expect(client.writes).toBe(0);
  }
});

test("statistics separate WO-only labour, include manual POs and never mix matching names from different jobs", async () => {
  const { api, browser } = loadApi();
  const client = mockClient({
    jobs: [job("job-one", "001", { job_name: "Shared site" })],
    accounting_time_entries: [{ id: "captured", job_id: "job-one", source_entry_key: "live-captured", profile_id: "employee", worker_name: "Employee", work_date: "2026-09-01", payable_hours: 8, is_current: true, entry_type: "work" }],
    timesheet_entries: [{ id: "live-captured", job_number: "001", profile_id: "employee", worker_name: "Employee", week_start: "2026-08-30", day_of_week: "Tuesday", hours: 8, entry_type: "work" }, { id: "live-new", job_number: "001", profile_id: "employee", worker_name: "Employee", week_start: "2026-08-30", day_of_week: "Wednesday", hours: 2, entry_type: "work" }, { id: "other-job", job_number: "1001", worker_name: "Other", hours: 20, entry_type: "work" }],
    digital_purchase_orders: [{ id: "digital", job_id: "job-one", po_number: 30001, order_date: "2026-09-01" }, { id: "manual-digital", job_id: null, job_number: "001", po_number: 30002 }, { id: "wrong-digital", job_id: null, job_number: "1001", job_name: "Shared site", po_number: 30003 }],
    work_orders: [{ id: "wo", job_id: "job-one", wo_number: "WO-1", work_order_date: "2026-09-01", status: "submitted" }],
    work_order_labour: [{ id: "wo-only", work_order_id: "wo", employee_name: "Employee", worker_key: "manual-person", hours: 8 }, { id: "already-matched", work_order_id: "wo", employee_name: "Employee", worker_key: "manual-person", hours: 8, matched_timesheet_entry_id: "live-captured" }],
    work_order_purchase_orders: [{ id: "paper", work_order_id: "wo", po_number: "12345", company_name: "Supplier", notes: "Paper PO" }],
    daily_site_reports: [{ id: "report", project: "001 - Shared site", report_date: "2026-09-01" }, { id: "wrong-report", project: "Shared site", report_date: "2026-09-01" }],
  });
  api.installEstimatorApiBridge(client);
  const result = await request(browser, "job-statistics?portalJobId=job-one", undefined, "GET");
  expect(result.status).toBe(200);
  expect(result.body.totalHours).toBe(10);
  expect(result.body.timesheetHours).toBe(10);
  expect(result.body.workOrderOnlyHours).toBe(8);
  expect(result.body.workOrderOnlyLabour).toHaveLength(1);
  expect(result.body.digitalPoCount).toBe(2);
  expect(result.body.manualPoCount).toBe(1);
  expect(result.body.manualPurchaseOrders[0]).toEqual(expect.objectContaining({ number: "12345", source: "work-order", workOrderId: "wo", workOrderNumber: "WO-1", url: "../work-orders.html?wo=wo" }));
  expect(result.body.manualPurchaseOrders[0].amount).toBeUndefined();
  expect(result.body.dailyReportCount).toBe(1);
  expect(result.body.hoursByJobType).toEqual([{ label: "T&M", hours: 10 }]);
  expect(client.writes).toBe(0);
});
