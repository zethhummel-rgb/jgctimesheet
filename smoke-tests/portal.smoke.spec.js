const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");

for (const [pageName, selector, value] of [
  ['timesheet.html', '#jobName', '26998 - Shared employee project'],
  ['work-orders.html', '#woJobSearch', '26998 - Shared employee project'],
  ['purchase-orders.html', '#poJobSearch', '26998 - Shared employee project'],
  ['jsa.html', '[data-jgc-project-job]', '26998 - Shared employee project'],
  ['schedule.html', '#jobSelect', 'employee-details-job'],
  ['home.html', '#homeScheduleJob', 'employee-details-job'],
  ['tasks.html', '#taskJobNumber', '26998'],
  ['job-lists.html', '#jobListJob', 'employee-details-job'],
]) {
  test(`employee job details show the five safe fields on ${pageName}`, async ({ page }) => {
    await installAuthenticatedPortalState(page);
    await mockPortalServices(page);
    await page.route(`${supabaseOrigin}/rest/v1/jobs*`, route => {
      expect(new URL(route.request().url()).searchParams.get('select')).not.toMatch(/cost|revenue|budget/);
      return route.fulfill({ json: [{ id: 'employee-details-job', job_number: '26998', job_name: 'Shared employee project', customer: 'Example Client', job_type: 'Contract', active: true, document_link: 'https://example.com/project-documents', document_link_label: 'Project documents' }] });
    });
    await page.goto('/' + pageName);
    if (pageName === 'tasks.html') await page.locator('#taskFormDetails > summary').click();
    if (pageName === 'jsa.html') {
      await expect(page.locator('.jgc-project-job-select option').filter({ hasText: 'Example Client' }))
        .toHaveText('26998 - Example Client - Shared employee project - Contract');
    }
    await expect(page.locator(selector)).toHaveCount(1);
    // Existing-record editors set values programmatically, as well as by user input.
    await page.locator(selector).evaluate((field, value) => {
      if (field.tagName === 'SELECT' && !Array.from(field.options).some(o => o.value === value)) field.add(new Option('Shared employee project', value));
      field.value = value;
    }, value);
    const card = page.locator('.jgc-employee-job-details').filter({ hasText: 'Example Client' });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Shared employee project');
    await expect(card).toContainText('26998');
    await expect(card).toContainText('Contract');
    await expect(card.getByRole('link', { name: 'Project documents', includeHidden: true })).toHaveAttribute('href', 'https://example.com/project-documents');
    await expect(card).not.toContainText(/quoted|budget|revenue|\$/i);
    expect(await page.locator(selector).inputValue()).toBe(value);
  });
}

test('employee job lookup includes client search and all five fields on a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/jobs*`, route => route.fulfill({ json: [{ id: 'j1', customer: 'Trans Northern Pipeline', job_number: '26130', job_name: 'TNPI - Ingleside Gate Replacement', job_type: 'Contract', active: true, document_link: 'https://example.com/documents', document_link_label: 'Project documents' }] }));
  await page.goto('/jobs.html');
  await page.locator('#jobSearch').fill('Trans Northern');
  await expect(page.locator('.jobs-table tbody tr')).toHaveCount(1);
  await expect(page.locator('[data-label="Client"]')).toHaveText('Trans Northern Pipeline');
  await expect(page.locator('.jobs-table tbody td')).toHaveCount(5);
  await expect(page.getByRole('link', { name: 'Project documents' })).toHaveAttribute('href', 'https://example.com/documents');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('employee-job-five-fields.png'), fullPage: true });
});

for (const pageName of ['jobs.html', 'timesheet.html', 'work-orders.html']) {
  test(`shared import refresh updates ${pageName} without changing draft input`, async ({ page, context }) => {
    await installAuthenticatedPortalState(page);
    await mockPortalServices(page);
    let rows = [{ id: 'sync-job', job_number: '26998', job_name: 'Before import', active: true, job_type: 'Contract' }];
    let reads = 0;
    await page.route(`${supabaseOrigin}/rest/v1/jobs*`, (route) => {
      reads++;
      expect(route.request().method()).toBe('GET');
      expect(new URL(route.request().url()).searchParams.get('select')).not.toMatch(/cost|revenue|budget/);
      return route.fulfill({ json: rows });
    });
    await page.clock.install();
    await page.goto('/' + pageName);
    await expect.poll(() => reads).toBeGreaterThan(0);
    const input = pageName === 'timesheet.html' ? '#jobName' : pageName === 'work-orders.html' ? '#woJobSearch' : null;
    if (input) await page.locator(input).fill('Unsaved custom job');
    const sender = await context.newPage();
    await sender.route('**/sync-sender.html', route => route.fulfill({ contentType: 'text/html', body: '<script src="/job-list-sync.js?v=1"></script>' }));
    await sender.goto('/sync-sender.html');
    rows = [{ id: 'sync-job', job_number: '26998', job_name: 'After import', active: true, job_type: 'T&M' }, { id: 'new-sync-job', job_number: '26999', job_name: 'New imported job', active: true }];
    await page.bringToFront();
    await page.waitForTimeout(1100);
    const before = reads;
    await sender.evaluate(() => window.dispatchEvent(new Event('jgc-jobs-saved')));
    await expect.poll(() => reads).toBeGreaterThan(before);
    await expect.poll(() => page.evaluate((name) => (name === 'timesheet.html' ? activeJobs : jobs).map(j => j.job_name), pageName)).toEqual(['After import', 'New imported job']);
    if (input) await expect(page.locator(input)).toHaveValue('Unsaved custom job');
    rows = [rows[1]]; // Another device closed the first job.
    await page.clock.fastForward(61000);
    await expect.poll(() => page.evaluate((name) => (name === 'timesheet.html' ? activeJobs : jobs).map(j => j.job_name), pageName)).toEqual(['New imported job']);
    if (input) await expect(page.locator(input)).toHaveValue('Unsaved custom job');
    await sender.close();
  });
}
const projectRef = "xnrljkkszoimegfivlya";
const supabaseOrigin = `https://${projectRef}.supabase.co`;
const fakeUser = {
  id: "00000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "smoke-test@johngordonconstruction.com",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: { display_name: "Portal Smoke Test" },
  created_at: "2026-01-01T00:00:00.000Z"
};
const fakeProfile = {
  id: fakeUser.id,
  email: fakeUser.email,
  display_name: "Portal Smoke Test",
  worker_key: "portal smoke test",
  role: "admin",
  account_status: "approved"
};
const fakeWorkerIds = [
  "00000000-0000-4000-8000-000000000010",
  "00000000-0000-4000-8000-000000000011"
];
const fakeManualWorkerId = "00000000-0000-4000-8000-000000000012";
const employeeFeatureKeys = [
  "work_orders",
  "schedule",
  "jsa",
  "toolbox_talks",
  "job_notes",
  "tasks",
  "accounting"
];

async function captureJobListScreenshot(page, fileName) {
  const directory = process.env.JGC_JOB_LIST_SCREENSHOT_DIR;
  if (!directory) {
    return;
  }
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, fileName), fullPage: true });
}

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createFakeSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const accessToken = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({
      aud: "authenticated",
      exp: expiresAt,
      iat: Math.floor(Date.now() / 1000),
      role: "authenticated",
      sub: fakeUser.id,
      email: fakeUser.email
    }),
    "smoke-test-signature"
  ].join(".");

  return {
    access_token: accessToken,
    refresh_token: "smoke-test-refresh-token",
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: "bearer",
    user: fakeUser
  };
}

function readAppShell() {
  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");
  const shellMatch = serviceWorker.match(/const\s+JGC_APP_SHELL\s*=\s*\[([\s\S]*?)\];/);
  if (!shellMatch) {
    throw new Error("JGC_APP_SHELL could not be read from service-worker.js");
  }

  return Array.from(shellMatch[1].matchAll(/["']([^"']+)["']/g), (match) => match[1]);
}

const appShell = readAppShell();
const portalPages = Array.from(new Set(appShell
  .map((entry) => entry.split(/[?#]/, 1)[0].replace(/^\.\//, ""))
  .filter((entry) => entry.endsWith(".html"))))
  .sort();
const authenticatedPages = portalPages.filter((name) => !["index.html", "reset-password.html"].includes(name));
const authenticatedPageGroups = [];
for (let index = 0; index < authenticatedPages.length; index += 8) {
  authenticatedPageGroups.push(authenticatedPages.slice(index, index + 8));
}

async function installAuthenticatedPortalState(page, profile = fakeProfile) {
  const session = createFakeSession();
  await page.addInitScript(({ authSession, profile, ref }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(authSession));
    localStorage.setItem("currentWorker", profile.worker_key);
    localStorage.setItem("currentWorkerDisplay", profile.display_name);
    localStorage.setItem("currentUserEmail", profile.email);
    localStorage.setItem("currentUserRole", profile.role);
    localStorage.setItem("currentAccountStatus", profile.account_status);
    localStorage.setItem("jgcStayLoggedIn", "true");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { authSession: session, profile, ref: projectRef });
}

async function mockPortalServices(page, profile = fakeProfile, options = {}) {
  const session = createFakeSession();
  const accountingEnabled = options.accountingEnabled !== false;

  await page.route(`${supabaseOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const accept = String(request.headers().accept || "");
    let body = "[]";

    if (url.pathname.startsWith("/auth/v1/user")) {
      body = JSON.stringify(fakeUser);
    } else if (url.pathname.startsWith("/auth/v1/token")) {
      body = JSON.stringify(session);
    } else if (url.pathname.includes("/rest/v1/portal_user_preferences")) {
      const preferenceState = options.themePreferenceState || { theme: "dark", writes: [] };
      if (["POST", "PATCH"].includes(request.method())) {
        const payload = JSON.parse(request.postData() || "{}");
        preferenceState.theme = payload.theme || preferenceState.theme;
        preferenceState.writes = preferenceState.writes || [];
        preferenceState.writes.push(payload);
        body = "[]";
      } else {
        body = JSON.stringify({ theme: preferenceState.theme || "dark" });
      }
    } else if (url.pathname.includes("/rest/v1/accounting_employee_settings")) {
      body = JSON.stringify([
        { profile_id: fakeProfile.id, include_in_payroll: false },
        { profile_id: "00000000-0000-4000-8000-000000000002", include_in_payroll: true }
      ]);
    } else if (url.pathname.includes("/rest/v1/accounting_employee_rates")) {
      body = JSON.stringify([{
        id: "00000000-0000-4000-8000-000000000020",
        profile_id: "00000000-0000-4000-8000-000000000002",
        pay_type: "hourly",
        regular_rate: 30,
        overtime_multiplier: 1.5,
        night_premium: 3,
        effective_from: "2026-07-01"
      }]);
    } else if (url.pathname.includes("/rest/v1/accounting_timesheet_submissions")) {
      const accountingSubmissions = [
        { id: "00000000-0000-4000-8000-000000000031", source_week_id: "00000000-0000-4000-8000-000000000041", profile_id: "00000000-0000-4000-8000-000000000002", worker_name: "Steven Leduc", week_start: "2026-08-02", submitted_at: "2026-08-10T12:00:00Z", source_revision: 1, source_total_hours: 8, normalized_work_hours: 8 },
      ];
      if (!options.missingAccountingSecondWeek) {
        accountingSubmissions.push({ id: "00000000-0000-4000-8000-000000000032", source_week_id: "00000000-0000-4000-8000-000000000042", profile_id: "00000000-0000-4000-8000-000000000002", worker_name: "Steven Leduc", week_start: "2026-08-09", submitted_at: "2026-08-17T12:00:00Z", source_revision: 1, source_total_hours: 8.01, normalized_work_hours: 8 });
      }
      if (options.includeExcludedAccountingSubmission) {
        accountingSubmissions.push({ id: "00000000-0000-4000-8000-000000000033", source_week_id: "00000000-0000-4000-8000-000000000043", profile_id: profile.id, worker_name: profile.display_name, week_start: "2026-08-02", submitted_at: "2026-08-10T13:00:00Z", source_revision: 1, source_total_hours: 7, normalized_work_hours: 7 });
      }
      body = JSON.stringify(accountingSubmissions);
    } else if (url.pathname.includes("/rest/v1/accounting_time_entries")) {
      const accountingEntries = [
        { id: "00000000-0000-4000-8000-000000000051", submission_id: "00000000-0000-4000-8000-000000000031", profile_id: "00000000-0000-4000-8000-000000000002", worker_name: "Steven Leduc", work_date: "2026-08-04", day_of_week: "Tuesday", entry_type: "work", source_job_number: "25169", source_job_name: "McKay Office Addition", job_id: "00000000-0000-4000-8000-000000000061", job_match_status: "exact", shift_type: "day", payable_hours: 8, original_hours: 8, is_current: true },
        { id: "00000000-0000-4000-8000-000000000052", submission_id: "00000000-0000-4000-8000-000000000032", profile_id: "00000000-0000-4000-8000-000000000002", worker_name: "Steven Leduc", work_date: "2026-08-11", day_of_week: "Tuesday", entry_type: "work", source_job_number: "25169", source_job_name: "McKay Office Addition", job_id: "00000000-0000-4000-8000-000000000061", job_match_status: "exact", shift_type: "day", payable_hours: 8, original_hours: 8, is_current: true },
        { id: "00000000-0000-4000-8000-000000000053", submission_id: "00000000-0000-4000-8000-000000000032", profile_id: "00000000-0000-4000-8000-000000000002", worker_name: "Steven Leduc", work_date: "2026-08-12", day_of_week: "Wednesday", entry_type: "vacation", leave_type: "paid", leave_note: "Vacation", source_job_number: "Vacation", source_job_name: "Vacation", job_id: null, job_match_status: "not_applicable", shift_type: "day", payable_hours: 0, original_hours: 0.01, is_current: true }
      ];
      if (options.accountingLongEntry) {
        accountingEntries[0].payable_hours = 13;
        accountingEntries[0].original_hours = 13;
      }
      if (options.includeExcludedAccountingSubmission) {
        accountingEntries.push({ id: "00000000-0000-4000-8000-000000000054", submission_id: "00000000-0000-4000-8000-000000000033", profile_id: profile.id, worker_name: profile.display_name, work_date: "2026-08-05", day_of_week: "Wednesday", entry_type: "work", source_job_number: "25169", source_job_name: "McKay Office Addition", job_id: "00000000-0000-4000-8000-000000000061", job_match_status: "exact", shift_type: "day", payable_hours: 7, original_hours: 7, is_current: true });
      }
      if (options.accountingUnmatchedEntry) {
        accountingEntries.push({ id: "00000000-0000-4000-8000-000000000055", submission_id: "00000000-0000-4000-8000-000000000031", profile_id: "00000000-0000-4000-8000-000000000002", worker_name: "Steven Leduc", work_date: "2026-08-06", day_of_week: "Thursday", entry_type: "work", source_job_number: "", source_job_name: "BGIS Ottawa Courthouse", job_id: null, job_match_status: "unmatched", shift_type: "day", payable_hours: 8, original_hours: 8, is_current: true });
      }
      if (request.method() === "PATCH") {
        const payload = JSON.parse(request.postData() || "{}");
        body = JSON.stringify(Object.assign({}, accountingEntries.find((entry) => entry.id === "00000000-0000-4000-8000-000000000055") || accountingEntries[0], payload));
      } else {
        body = JSON.stringify(accountingEntries);
      }
    } else if (url.pathname.includes("/rest/v1/timesheet_entries") && page.url().includes("accounting-admin.html")) {
      body = JSON.stringify(options.accountingLiveEntries || []);
    } else if (url.pathname.includes("/rest/v1/accounting_pay_periods")) {
      body = JSON.stringify(options.accountingPeriod || null);
    } else if (url.pathname.includes("/rest/v1/accounting_workbook_templates")) {
      body = JSON.stringify({
        id: "biweekly-v1",
        file_name: "Copy of Aug 20 Simple - Biweekly.xlsx",
        file_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        is_active: true,
        uploaded_by: fakeProfile.id,
        created_at: "2026-08-11T12:00:00Z",
        updated_at: "2026-08-11T12:00:00Z"
      });
    } else if (url.pathname.includes("/rest/v1/accounting_export_downloads")) {
      if (request.method() === "POST") {
        const payload = JSON.parse(request.postData() || "{}");
        body = JSON.stringify(Object.assign({
          id: "00000000-0000-4000-8000-000000000073",
          downloaded_at: "2026-08-20T15:00:00Z"
        }, payload));
      } else {
        body = JSON.stringify(options.accountingExportDownloads || []);
      }
    } else if (url.pathname.includes("/rest/v1/accounting_exports")) {
      const exports = options.accountingExports || [];
      body = accept.includes("application/vnd.pgrst.object")
        ? JSON.stringify(Object.assign({ file_base64: "dGVzdA==" }, exports[0] || {}))
        : JSON.stringify(exports);
    } else if (url.pathname.includes("/rest/v1/accounting_period_employee_inputs")) {
      body = "[]";
    } else if (url.pathname.includes("/rest/v1/jobs") && page.url().includes("accounting-admin.html")) {
      body = JSON.stringify([{
        id: "00000000-0000-4000-8000-000000000061",
        job_number: "25169",
        job_name: "McKay Office Addition",
        active: true
      }]);
    } else if (url.pathname.includes("/rest/v1/profiles")) {
      body = accept.includes("application/vnd.pgrst.object")
        ? JSON.stringify(profile)
        : JSON.stringify([
          profile,
          {
            id: "00000000-0000-4000-8000-000000000002",
            email: "steven@example.com",
            display_name: "Steven Leduc",
            worker_key: "steven leduc",
            hire_date: options.employeeHireDate || null,
            role: "employee",
            account_status: "approved"
          }
        ].concat(options.additionalProfiles || []));
    } else if (url.pathname.includes("/rest/v1/work_order_labour_workers")) {
      const workers = [
        {
          id: fakeWorkerIds[0],
          profile_id: profile.id,
          display_name: profile.display_name,
          worker_key: profile.worker_key,
          approved: true
        },
        {
          id: fakeWorkerIds[1],
          profile_id: "00000000-0000-4000-8000-000000000002",
          display_name: "Steven Leduc",
          worker_key: "steven leduc",
          approved: true
        }
      ];
      if (page.url().includes("employee-access-admin.html")) {
        workers.push({
          id: fakeManualWorkerId,
          profile_id: null,
          display_name: "Temporary Worker",
          worker_key: "temporary worker",
          approved: true
        });
      }
      body = url.searchParams.has("profile_id") || accept.includes("application/vnd.pgrst.object")
        ? JSON.stringify(workers[0] || null)
        : JSON.stringify(workers);
    } else if (url.pathname.includes("/rest/v1/employee_feature_access")) {
      const accessWorkerIds = page.url().includes("employee-access-admin.html")
        ? fakeWorkerIds.concat(fakeManualWorkerId)
        : fakeWorkerIds;
      const accessRows = accessWorkerIds.flatMap((workerId) =>
        employeeFeatureKeys.map((featureKey) => ({
          worker_id: workerId,
          feature_key: featureKey,
          enabled: featureKey !== "accounting" || workerId !== fakeWorkerIds[0] || accountingEnabled,
          updated_at: "2026-07-30T12:00:00.000Z"
        }))
      );
      const requestedFeature = decodeURIComponent(url.searchParams.get("feature_key") || "");
      const requestedWorker = decodeURIComponent(url.searchParams.get("worker_id") || "");
      const matchingAccess = accessRows.find((row) =>
        (!requestedFeature || requestedFeature.includes(row.feature_key))
        && (!requestedWorker || requestedWorker.includes(row.worker_id))
      );
      body = (requestedFeature && requestedWorker) || accept.includes("application/vnd.pgrst.object")
        ? JSON.stringify(matchingAccess || null)
        : JSON.stringify(accessRows);
    } else if (url.pathname.includes("/rest/v1/rpc/accounting_autofill_leave_timesheet")) {
      body = JSON.stringify({
        source_week_id: "00000000-0000-4000-8000-000000000099",
        profile_id: "00000000-0000-4000-8000-000000000002",
        worker_name: "Steven Leduc",
        week_start: "2026-08-09"
      });
    } else if (url.pathname.startsWith("/rest/v1/rpc/")) {
      body = accept.includes("application/vnd.pgrst.object") ? "{}" : "[]";
    } else if (url.pathname.startsWith("/functions/v1/")) {
      body = JSON.stringify({ ok: true });
    } else if (url.pathname.startsWith("/storage/v1/object/sign/")) {
      body = JSON.stringify({ signedURL: "/smoke-test.pdf" });
    } else if (accept.includes("application/vnd.pgrst.object")) {
      body = "{}";
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Range": "0-0/0"
      },
      body: request.method() === "HEAD" ? "" : body
    });
  });

  await page.route("https://script.google.com/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "{}"
  }));
}

function watchRuntimeErrors(page, dialogAction = "dismiss") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /(?:Uncaught|ReferenceError|TypeError|SyntaxError)/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on("dialog", (dialog) => dialogAction === "accept" ? dialog.accept() : dialog.dismiss());
  return errors;
}

async function expectNoRuntimeErrors(errors, label) {
  await expect.poll(() => errors, { message: `${label} produced JavaScript errors` }).toEqual([]);
}

test("all public cached pages open without a JavaScript crash", async ({ context }) => {
  for (const pageName of ["index.html", "reset-password.html"]) {
    await test.step(pageName, async () => {
      const page = await context.newPage();
      const errors = watchRuntimeErrors(page);
      await mockPortalServices(page);
      const response = await page.goto(`/${pageName}`, { waitUntil: "domcontentloaded" });
      expect(response, `${pageName} did not return an HTTP response`).not.toBeNull();
      expect(response.status(), `${pageName} returned HTTP ${response.status()}`).toBeLessThan(400);
      await expect(page.locator("body")).toBeVisible();
      await expect(page).toHaveTitle(/\S+/);
      await page.waitForTimeout(150);
      expect(errors, `${pageName} produced JavaScript errors`).toEqual([]);
      await page.close();
    });
  }
});

test("password recovery email uses a scanner-safe numeric code", () => {
  const template = fs.readFileSync(path.join(portalRoot, "supabase", "templates", "password-recovery.html"), "utf8");
  expect(template).toContain("{{ .Token }}");
  expect(template).toContain("{{ .RedirectTo }}");
  expect(template).not.toContain("{{ .ConfirmationURL }}");
});

test("forgot password requests a code and opens the reset form", async ({ page }) => {
  let recoveryRequest = null;
  const errors = watchRuntimeErrors(page);

  await page.route(`${supabaseOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/auth/v1/recover") {
      recoveryRequest = {
        url,
        payload: JSON.parse(request.postData() || "{}")
      };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill("Employee@JohnGordonConstruction.com");
  await page.getByRole("button", { name: "Forgot Password" }).click();

  await expect.poll(() => recoveryRequest).not.toBeNull();
  expect(recoveryRequest.payload.email).toBe("employee@johngordonconstruction.com");
  const redirectTarget = recoveryRequest.url.searchParams.get("redirect_to") || recoveryRequest.payload.redirect_to;
  expect(redirectTarget).toMatch(/\/reset-password\.html$/);
  await expect(page).toHaveURL(/\/reset-password\.html$/);
  await expect(page.locator("#resetEmail")).toHaveValue("employee@johngordonconstruction.com");
  await expectNoRuntimeErrors(errors, "password reset request");
});

test("password reset verifies the recovery code before updating the password", async ({ page }) => {
  const authRequests = [];
  const session = createFakeSession();
  const errors = watchRuntimeErrors(page);

  await page.addInitScript(() => {
    sessionStorage.setItem("jgcPasswordResetEmail", "employee@johngordonconstruction.com");
  });

  await page.route(`${supabaseOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const payload = JSON.parse(request.postData() || "{}");
    let status = 200;
    let body = "{}";

    if (url.pathname === "/auth/v1/verify") {
      authRequests.push({ kind: "verify", payload });
      body = JSON.stringify(session);
    } else if (url.pathname === "/auth/v1/user" && request.method() === "PUT") {
      authRequests.push({ kind: "update", payload });
      body = JSON.stringify(fakeUser);
    } else if (url.pathname === "/auth/v1/user") {
      body = JSON.stringify(fakeUser);
    } else if (url.pathname === "/auth/v1/logout") {
      status = 204;
      body = "";
    }

    await route.fulfill({ status, contentType: "application/json", body });
  });

  await page.goto("/reset-password.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#resetEmail")).toHaveValue("employee@johngordonconstruction.com");
  await page.locator("#resetCode").fill("04904794");
  await page.locator("#newPassword").fill("new-secure-password");
  await page.locator("#confirmPassword").fill("new-secure-password");
  await page.getByRole("button", { name: "Verify Code & Update Password" }).click();

  await expect(page.locator("#status")).toContainText("Password updated successfully");
  await expect.poll(() => authRequests.length).toBe(2);
  expect(authRequests[0]).toEqual({
    kind: "verify",
    payload: expect.objectContaining({
      email: "employee@johngordonconstruction.com",
      token: "04904794",
      type: "recovery"
    })
  });
  expect(authRequests[1]).toEqual({
    kind: "update",
    payload: expect.objectContaining({ password: "new-secure-password" })
  });
  await expectNoRuntimeErrors(errors, "password reset code verification");
});

authenticatedPageGroups.forEach((pageGroup, groupIndex) => {
  test(`authenticated cached pages group ${groupIndex + 1} opens without a JavaScript crash`, async ({ context }) => {
    test.setTimeout(30_000);
    for (const pageName of pageGroup) {
      await test.step(pageName, async () => {
        const page = await context.newPage();
        const errors = watchRuntimeErrors(page);
        await mockPortalServices(page);
        await installAuthenticatedPortalState(page);
        const response = await page.goto(`/${pageName}`, { waitUntil: "domcontentloaded" });
        expect(response, `${pageName} did not return an HTTP response`).not.toBeNull();
        expect(response.status(), `${pageName} returned HTTP ${response.status()}`).toBeLessThan(400);
        await expect(page.locator("body")).toBeVisible();
        await expect(page).toHaveTitle(/\S+/);
        await page.waitForTimeout(150);
        expect(errors, `${pageName} produced JavaScript errors`).toEqual([]);
        await page.close();
      });
    }
  });
});

test("every required app-shell asset exists", async ({ request }) => {
  for (const asset of appShell) {
    const response = await request.get(`/${asset.replace(/^\.\//, "")}`);
    expect(response.status(), `Missing required asset: ${asset}`).toBe(200);
  }
});

test("shared phone header is opaque above Admin", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPortalServices(page);
  await installAuthenticatedPortalState(page);
  await page.goto("/admin.html?tab=summary", { waitUntil: "domcontentloaded" });

  const header = page.locator("#jgcGlobalTopNav");
  await expect(header).toBeVisible();
  const styles = await header.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage,
      backdropFilter: computed.backdropFilter
    };
  });

  expect(styles.backgroundColor).toBe("rgb(7, 55, 28)");
  expect(styles.backgroundImage).toContain("rgb(7, 55, 28)");
  expect(styles.backgroundImage).toContain("rgb(11, 94, 59)");
  expect(styles.backgroundImage).not.toContain("rgba(");
  expect(styles.backdropFilter).toBe("none");
});

for (const width of [1440, 1024, 390, 360]) {
  test(`compact logo sits beside Home and replaces the page-top logo at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mockPortalServices(page);
    await installAuthenticatedPortalState(page);
    for (const path of ["/timesheet.html", "/inspections.html", "/admin.html?tab=timesheets", "/accounting-admin.html", "/purchase-orders.html", "/policies-announcements.html", "/schedule.html"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const nav = page.locator("#jgcGlobalTopNav");
      const brand = nav.getByRole("button", { name: "John Gordon Construction - Home", exact: true });
      await expect(brand, path).toBeVisible();
      await expect(brand.locator("img")).toHaveJSProperty("complete", true);
      const layout = await nav.evaluate((element) => {
        const box = (el) => el && el.getBoundingClientRect();
        const home = box(element.querySelector(".jgc-nav-home")), logo = box(element.querySelector(".jgc-nav-brand"));
        const links = [...element.querySelectorAll(".jgc-nav-center a")].filter((a) => a.getClientRects().length);
        const firstLink = links.map(box).find((r) => r.width > 0);
        const center = box(element.querySelector(".jgc-nav-center"));
        const rightItems = [...document.querySelectorAll("button, a")].filter((el) => !element.querySelector(".jgc-nav-start").contains(el) && !element.querySelector(".jgc-nav-center").contains(el) && el.getClientRects().length).map(box).filter((r) => r.top < 56 && r.bottom > 0 && r.left > logo.right - 1);
        return {
          logoAfterHome: logo.left >= home.right,
          logoHeight: logo.height,
          logoInsideNav: logo.top >= 0 && logo.bottom <= box(element).bottom,
          centerClear: !center.width || center.left >= logo.right,
          firstLinkClear: !firstLink || firstLink.left >= logo.right,
          nearestRight: rightItems.length ? Math.min(...rightItems.map((r) => r.left)) : Infinity,
          centerRight: center.width ? center.right : 0,
          logoRight: logo.right,
          logoWidth: logo.width,
          logoNatural: 1310 / 423, // visible artwork inside logo.webp
          overflow: document.documentElement.scrollWidth > innerWidth + 1
        };
      });
      expect(layout.logoAfterHome, path).toBe(true);
      expect(layout.logoInsideNav, path).toBe(true);
      expect(layout.logoHeight, path).toBeGreaterThanOrEqual(18);
      expect(layout.centerClear && layout.firstLinkClear, path).toBe(true);
      expect(layout.nearestRight, path).toBeGreaterThanOrEqual(layout.logoRight);
      expect(layout.centerRight, path + " tabs clear of the header icons").toBeLessThanOrEqual(layout.nearestRight + 1);
      expect(Math.abs(layout.logoWidth / layout.logoHeight - layout.logoNatural), path + " logo keeps its proportions").toBeLessThan(0.05);
      expect(layout.overflow, path).toBe(false);
      const pageLogos = page.locator('body > :not(#jgcGlobalTopNav) img[src^="logo"]:visible');
      await expect(pageLogos, path + " page-top logo hidden on screen").toHaveCount(0);
    }
    await page.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
    await page.emulateMedia({ media: "print" });
    await expect(page.locator('.logo-wrap img[src^="logo"]')).toBeVisible();
    await page.emulateMedia({ media: "screen" });
    // Admin Summary keeps its own large logo in the greeting row.
    await page.goto("/admin.html?tab=summary", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#summarySection .dashboard-brand")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("summary.png") });
    await page.locator("#timesheetsTab").click();
    await expect(page.locator('.logo-wrap img[src^="logo"]')).toBeHidden();
    await expect(page.locator("#timesheetsSection")).toBeVisible();
    await page.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
    await page.screenshot({ path: testInfo.outputPath("timesheet.png") });
  });
}

// Headless Chromium reports "denied"; these tests simulate a device that has not decided yet.
async function stubUndecidedPushPermission(page, answer = "denied", initial = "default") {
  await page.addInitScript(({ answer, initial }) => {
    let permission = initial;
    window.__jgcPushPermissionRequests = 0;
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => permission });
    Notification.requestPermission = async () => { window.__jgcPushPermissionRequests += 1; permission = answer; return permission; };
  }, { answer, initial });
}

const pushPrompt = (page) => page.getByRole("dialog", { name: "Get JGC alerts on this device" });

for (const theme of ["light", "dark"]) for (const width of [390, 1440]) {
  test(`push onboarding explains the bell and asks permission only after Enable ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await stubUndecidedPushPermission(page);
    await mockPortalServices(page, fakeProfile, { themePreferenceState: { theme } });
    await installAuthenticatedPortalState(page);
    await page.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
    const prompt = pushPrompt(page);
    await expect(prompt).toBeVisible({ timeout: 10000 });
    await expect(prompt).toContainText("Notification Centre");
    await expect(prompt).toContainText("bell");
    await expect(prompt.getByRole("button", { name: "Enable Push Notifications", exact: true })).toBeFocused();
    expect(await page.evaluate(() => window.__jgcPushPermissionRequests)).toBe(0);
    await expectReadableText(prompt.locator("h2, p, button"), "Push onboarding " + theme);
    const box = await prompt.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: testInfo.outputPath("push-onboarding.png") });

    await prompt.getByRole("button", { name: "Enable Push Notifications", exact: true }).click();
    await expect(prompt.getByRole("status")).toContainText("blocked in this browser");
    expect(await page.evaluate(() => window.__jgcPushPermissionRequests)).toBe(1);
    await prompt.getByRole("button", { name: "Done", exact: true }).click();
    await expect(prompt).toBeHidden();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    await expect(prompt).toHaveCount(0);
    expect(await page.evaluate(() => window.__jgcPushPermissionRequests)).toBe(0);
  });
}

test("push onboarding Not now and Escape are remembered, and the bell keeps Enable Push", async ({ page }) => {
  await stubUndecidedPushPermission(page);
  await mockPortalServices(page);
  await installAuthenticatedPortalState(page);
  await page.goto("/inspections.html", { waitUntil: "domcontentloaded" });
  const prompt = pushPrompt(page);
  await expect(prompt).toBeVisible({ timeout: 10000 });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(prompt.locator("button:focus")).toHaveCount(1);
  await prompt.getByRole("button", { name: "Not now", exact: true }).click();
  await expect(prompt).toBeHidden();
  expect(await page.evaluate(() => window.__jgcPushPermissionRequests)).toBe(0);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).choice, "jgcPushOnboarding:v1:" + fakeProfile.worker_key)).toBe("dismissed");

  await page.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await expect(prompt).toHaveCount(0);
  await page.locator("#jgcNotificationButton").click();
  await expect(page.locator("#jgcPushToggleButton")).toBeVisible();

  await page.evaluate((key) => localStorage.removeItem(key), "jgcPushOnboarding:v1:" + fakeProfile.worker_key);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(prompt).toBeVisible({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await expect(prompt).toBeHidden();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).choice, "jgcPushOnboarding:v1:" + fakeProfile.worker_key)).toBe("dismissed");
});

for (const decided of ["granted", "denied"]) {
  test(`push onboarding stays hidden when this device already chose ${decided}`, async ({ page }) => {
    await stubUndecidedPushPermission(page, decided, decided);
    await mockPortalServices(page);
    await installAuthenticatedPortalState(page);
    await page.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    await expect(pushPrompt(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__jgcPushPermissionRequests)).toBe(0);
  });
}

test("service worker installs and controls the portal", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  try {
    const page = await context.newPage();
    await installAuthenticatedPortalState(page);
    await mockPortalServices(page);
    const errors = watchRuntimeErrors(page);

    await page.goto("/home.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error("Service worker registration timed out")), 10_000))
      ]);
    });
    const controlledPage = await context.newPage();
    const controlledErrors = watchRuntimeErrors(controlledPage);
    await mockPortalServices(controlledPage);
    await controlledPage.goto("/home.html?smoke-controlled=1", { waitUntil: "domcontentloaded" });
    await expect.poll(() => controlledPage.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await controlledPage.close();
    await expectNoRuntimeErrors(errors, "service-worker registration");
    await expectNoRuntimeErrors(controlledErrors, "service-worker controlled page");
  } finally {
    await context.close();
  }
});

test("notification push control stays in the lower-right action row", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await mockPortalServices(page);
  await installAuthenticatedPortalState(page);
  await page.goto("/home.html", { waitUntil: "domcontentloaded" });

  const bell = page.locator("#jgcNotificationButton");
  await expect(bell).toBeVisible();
  await bell.click();

  const footer = page.locator(".jgc-notification-panel-footer");
  const actions = footer.locator(".jgc-notification-footer-actions");
  const clearButton = actions.locator("[data-notification-clear-all]");
  const pushButton = actions.locator("#jgcPushToggleButton");
  await expect(actions).toBeVisible();
  await expect(clearButton).toBeVisible();
  await expect(pushButton).toBeVisible();

  await pushButton.evaluate((button) => {
    button.dataset.pushEnabled = "false";
    button.textContent = "Enable Push";
    button.disabled = false;
  });
  const enableBox = await pushButton.boundingBox();

  await pushButton.evaluate((button) => {
    button.dataset.pushEnabled = "true";
    button.textContent = "Disable Push";
  });
  const disableBox = await pushButton.boundingBox();
  const actionPositions = await actions.evaluate((row) => {
    const clear = row.querySelector("[data-notification-clear-all]").getBoundingClientRect();
    const push = row.querySelector("#jgcPushToggleButton").getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    return {
      clearLeft: clear.left,
      pushLeft: push.left,
      pushRight: push.right,
      rowRight: bounds.right
    };
  });

  expect(enableBox).not.toBeNull();
  expect(disableBox).not.toBeNull();
  expect(disableBox.width).toBeLessThan(enableBox.width);
  expect(disableBox.height).toBeLessThan(enableBox.height);
  expect(actionPositions.pushLeft).toBeGreaterThan(actionPositions.clearLeft);
  expect(Math.abs(actionPositions.rowRight - actionPositions.pushRight)).toBeLessThanOrEqual(1);
  await expectNoRuntimeErrors(errors, "notification footer actions");
});

test("installed employee home keeps its exposed top margin dark", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.addInitScript(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (query !== "(display-mode: standalone)") {
        return nativeMatchMedia(query);
      }

      return {
        matches: true,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return false; }
      };
    };
  });
  await mockPortalServices(page);
  await installAuthenticatedPortalState(page);
  await page.goto("/home.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("body")).toHaveClass(/jgc-standalone-pwa/);
  const canvas = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell").getBoundingClientRect();
    return {
      rootBackground: getComputedStyle(document.documentElement).backgroundColor,
      shellTop: shell.top
    };
  });

  expect(canvas.shellTop).toBeGreaterThan(0);
  expect(canvas.rootBackground).toBe("rgb(7, 16, 15)");
  await expectNoRuntimeErrors(errors, "installed employee home top margin");
});

test("signed storage links preserve nested object paths", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await mockPortalServices(page);
  await installAuthenticatedPortalState(page);
  await page.goto("/toolbox-talks.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.JGCUploads));

  await page.evaluate((origin) => {
    const anchor = document.createElement("a");
    anchor.id = "nested-storage-smoke-link";
    anchor.href = `${origin}/storage/v1/object/sign/toolbox-talks/toolbox-talks/test-file.pdf?token=old-token`;
    anchor.target = "_blank";
    anchor.textContent = "Open nested storage object";
    document.body.appendChild(anchor);
  }, supabaseOrigin);

  const signedRequest = page.waitForRequest((request) =>
    request.url().includes("/storage/v1/object/sign/toolbox-talks/toolbox-talks/test-file.pdf")
  );
  await page.locator("#nested-storage-smoke-link").click();
  await signedRequest;
  await expectNoRuntimeErrors(errors, "nested signed storage path");
});

test("toolbox talk report starts with one talk selector and its PDF action", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  let savedSafetyRows = [];
  let automaticEmailRequests = 0;
  const talk = {
    id: "00000000-0000-4000-8000-000000000119",
    title: "Manual Material Handling",
    description: "Review safe lifting practices and material handling.",
    file_path: "toolbox-talks/manual-material-handling.pdf",
    file_name: "manual-material-handling.pdf",
    is_active: true,
    created_at: "2026-07-20T12:00:00.000Z"
  };

  await mockPortalServices(page);
  await page.route("https://script.google.com/**", (route) => {
    automaticEmailRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route(`${supabaseOrigin}/rest/v1/toolbox_talks**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/1" },
    body: JSON.stringify([talk])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/safety_acknowledgements**`, async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON();
      savedSafetyRows = Array.isArray(payload) ? payload : [payload];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*", "Content-Range": `0-${Math.max(0, savedSafetyRows.length - 1)}/${savedSafetyRows.length}` },
        body: JSON.stringify(savedSafetyRows)
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/0" },
      body: "[]"
    });
  });
  await installAuthenticatedPortalState(page);
  await page.goto("/toolbox-talks.html", { waitUntil: "domcontentloaded" });

  const reportSection = page.locator("#toolboxTalkReportSection");
  const librarySection = page.locator("#toolboxTalkLibrarySection");
  const talkSelect = page.locator("#toolboxTalkSelect");
  const pdfButton = page.locator("#selectedTalkPdfButton");
  const crewList = page.locator("#crewList");

  await expect(talkSelect).toBeEnabled();
  await expect(talkSelect.locator("option")).toHaveCount(2);
  await expect(crewList.locator(".crew-checkbox")).toHaveCount(2);
  await expect(crewList).toContainText(fakeProfile.display_name);
  await expect(crewList).toContainText("Steven Leduc");
  await expect(pdfButton).toBeHidden();
  expect(await page.evaluate(() => {
    const report = document.getElementById("toolboxTalkReportSection");
    const library = document.getElementById("toolboxTalkLibrarySection");
    return Boolean(report.compareDocumentPosition(library) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);

  await talkSelect.selectOption(talk.id);
  await expect(pdfButton).toBeVisible();
  await expect(pdfButton).toHaveAttribute("href", /smoke-test\.pdf/);
  await expect(page.locator("#discussionNotes")).toHaveValue(new RegExp(talk.title));
  await expect(reportSection).toContainText("Open Talk PDF");
  await expect(librarySection).not.toContainText("Use This Talk");

  await page.evaluate(() => {
    document.getElementById("projectName").value = "26040 - Smoke Test Project";
    const presenter = document.getElementById("presenterName");
    if (!presenter.value && presenter.options.length > 1) presenter.selectedIndex = 1;
    const crew = document.querySelector(".crew-checkbox");
    if (crew) crew.checked = true;
  });
  await page.getByRole("button", { name: "Submit Report" }).click();

  const qrDialog = page.locator(".toolbox-qr-backdrop");
  await expect(qrDialog).toBeVisible();
  await expect(qrDialog).toContainText("Crew Signatures");
  await expect(qrDialog.getByRole("button", { name: "Sign" })).toBeVisible();
  await qrDialog.getByText("Sign on another phone").click();
  await expect(qrDialog.locator('canvas[aria-label="Acknowledgement QR code"]')).toBeVisible();
  await expect(qrDialog.getByRole("button", { name: "Close QR code" })).toBeVisible();
  expect(savedSafetyRows.length).toBeGreaterThan(0);
  expect(savedSafetyRows[0].qr_token).toBeTruthy();
  expect(automaticEmailRequests).toBe(0);
  await qrDialog.getByRole("button", { name: "Close QR code" }).click();
  await expect(qrDialog).toHaveCount(0);
  await expectNoRuntimeErrors(errors, "toolbox talk report selector");
});

test("toolbox talk duplicate submissions are blocked before a second save", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const talk = {
    id: "00000000-0000-4000-8000-000000000129",
    title: "Manual Material Handling",
    description: "Review safe lifting practices and material handling.",
    file_path: "toolbox-talks/manual-material-handling.pdf",
    file_name: "manual-material-handling.pdf",
    is_active: true,
    created_at: "2026-07-20T12:00:00.000Z"
  };
  let insertCount = 0;

  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/toolbox_talks**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/1" },
    body: JSON.stringify([talk])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/toolbox_talk_reports**`, (route) => {
    if (route.request().method() === "POST") insertCount += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/1" },
      body: JSON.stringify([{
        id: "00000000-0000-4000-8000-000000000130",
        talk_id: talk.id,
        report_date: new Date().toISOString().slice(0, 10),
        project: "26040 - Smoke Test Project",
        presenter_name: fakeProfile.display_name,
        is_duplicate: false
      }])
    });
  });
  await installAuthenticatedPortalState(page);
  await page.goto("/toolbox-talks.html", { waitUntil: "domcontentloaded" });

  await page.locator("#toolboxTalkSelect").selectOption(talk.id);
  await page.evaluate(() => {
    document.getElementById("projectName").value = "  26040 - Smoke   Test Project  ";
    const presenter = document.getElementById("presenterName");
    if (!presenter.value && presenter.options.length > 1) presenter.selectedIndex = 1;
    const crew = document.querySelector(".crew-checkbox");
    if (crew) crew.checked = true;
  });
  await page.getByRole("button", { name: "Submit Report" }).click();

  await expect(page.locator("#reportStatus")).toContainText("already submitted");
  await expect(page.locator("#reportStatus")).toHaveClass(/error/);
  await expect(page.locator(".toolbox-qr-backdrop")).toHaveCount(0);
  expect(insertCount).toBe(0);
  await expectNoRuntimeErrors(errors, "toolbox duplicate submission guard");
});

test("report and JSA job fields use a visible dropdown with manual entry", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/jobs**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Range": "0-1/2"
    },
    body: JSON.stringify([
      { job_number: "25058", job_name: "Amazon Drain Issue # 2", active: true },
      { job_number: "25141", job_name: "Cornwall Electric Lynwood", active: true }
    ])
  }));
  await installAuthenticatedPortalState(page);

  for (const pageName of ["daily-site-report.html", "jsa.html"]) {
    await page.goto(`/${pageName}`, { waitUntil: "domcontentloaded" });
    const picker = page.locator(".jgc-project-job-picker").first();
    const select = picker.locator("select");
    const manualInput = picker.locator("[data-jgc-project-job]");

    await expect(select).toBeVisible();
    await expect(select).toContainText("25058 - Amazon Drain Issue # 2");
    await select.selectOption("25058 - Amazon Drain Issue # 2");
    await expect(manualInput).toHaveValue("25058 - Amazon Drain Issue # 2");
    await expect(manualInput).toBeHidden();

    await select.selectOption("__manual__");
    await expect(manualInput).toBeVisible();
    await manualInput.fill("Manual Job 99999");
    await expect(manualInput).toHaveValue("Manual Job 99999");

    if (pageName === "jsa.html") {
      await expect(page.locator(".grid > .field > label").filter({ hasText: /^Page$/ })).toHaveCount(0);
      await expect(page.locator(".grid > .field > label").filter({ hasText: /^Of$/ })).toHaveCount(0);
    }
  }

  await expectNoRuntimeErrors(errors, "project and job dropdowns");
});

test("JSA approved employee selection immediately adds the crew member", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/work_order_labour_workers**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-1/2" },
    body: JSON.stringify([
      { id: "1", display_name: "Andre Labrosse", worker_key: "andre labrosse", approved: true },
      { id: "2", display_name: "Steven Leduc", worker_key: "steven leduc", approved: true }
    ])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/employee_feature_access**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-1/2" },
    body: JSON.stringify([
      { worker_id: "1", feature_key: "jsa", enabled: true },
      { worker_id: "2", feature_key: "jsa", enabled: true }
    ])
  }));
  await installAuthenticatedPortalState(page);
  await page.goto("/jsa.html", { waitUntil: "domcontentloaded" });

  const approvedPicker = page.locator("#approvedCrewPicker");
  const select = page.locator("#approvedCrewSelect");
  const selectedCrew = page.locator("#selectedCrewList");
  const initialRowCount = await page.locator("#tableBody > tr").count();

  await expect(select.locator("option")).toHaveCount(3);
  await expect(approvedPicker.getByRole("button", { name: "Add Employee" })).toHaveCount(0);
  await expect(page.locator(".jsa-row-actions").getByRole("button", { name: "Add Row" })).toBeVisible();
  await expect(page.locator("#jsaSignoffChoiceSection").getByRole("button", { name: /QR Code/ })).toBeVisible();
  await expect(page.locator("#jsaSignoffChoiceSection").getByRole("button", { name: /Employee Signature/ })).toBeVisible();
  await expect(page.locator("#jsaSignoffChoiceSection").getByRole("button", { name: /Creator Sign Off/ })).toBeVisible();
  const submitButton = page.locator("#jsaSubmitButton");
  await expect(submitButton).toBeHidden();
  await page.evaluate(() => {
    window.saveInspection = async () => {};
  });
  await page.locator("#jsaSignoffChoiceSection").getByRole("button", { name: /Employee Signature/ }).click();
  await expect(page.locator("#jsaChoiceEmployees")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#jsaAcknowledgementChoiceStatus")).not.toHaveClass(/is-error/);
  await expect(submitButton).toBeHidden();
  await page.evaluate(() => {
    window.unlockJsaFinalSubmit("Sign-off complete. Review the JSA, then press Submit.");
  });
  await expect(submitButton).toBeVisible();
  await expect(submitButton).toBeEnabled();
  await expect(page.locator(".jsa-submit-actions").getByRole("button", { name: "Reports", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  const rowActionsBox = await page.locator(".jsa-row-actions").boundingBox();
  const submitActionsBox = await page.locator(".jsa-submit-actions").boundingBox();
  expect(rowActionsBox).not.toBeNull();
  expect(submitActionsBox).not.toBeNull();
  expect(submitActionsBox.y - (rowActionsBox.y + rowActionsBox.height)).toBeGreaterThanOrEqual(28);
  await page.locator(".jsa-row-actions").getByRole("button", { name: "Add Row" }).click();
  await expect(page.locator("#tableBody > tr")).toHaveCount(initialRowCount + 1);
  await select.selectOption("andre labrosse");
  await expect(selectedCrew).toContainText("Andre Labrosse");
  await expect(page.locator("#crewSignOffCombined")).toHaveValue("Andre Labrosse");
  await expect(select.locator('option[value="andre labrosse"]')).toHaveCount(0);

  await selectedCrew.getByRole("button", { name: "Remove Andre Labrosse" }).click();
  await expect(selectedCrew).toContainText("No approved employees selected yet.");
  await expect(select.locator('option[value="andre labrosse"]')).toHaveCount(1);
  await expectNoRuntimeErrors(errors, "JSA automatic approved crew selection");
});

test("vacation request date is locked to today's Toronto date", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await mockPortalServices(page);
  await installAuthenticatedPortalState(page);
  await page.goto("/vacation-request.html", { waitUntil: "domcontentloaded" });

  const summaryCounts = page.locator("#vacationSummary .summary-box strong");
  await expect(summaryCounts).toHaveCount(3);
  await expect(summaryCounts.first()).toHaveCSS("color", "rgb(82, 220, 99)");

  const expectedDate = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = {};
    parts.forEach((part) => { values[part.type] = part.value; });
    return values.year + "-" + values.month + "-" + values.day;
  });
  const requestDate = page.locator("#requestDate");

  await expect(page.locator('label[for="requestDate"]')).toHaveText("Today's Date");
  await expect(requestDate).toHaveAttribute("readonly", "");
  await expect(requestDate).toHaveValue(expectedDate);

  await page.evaluate(() => {
    document.getElementById("requestDate").value = "2000-01-01";
  });
  await page.locator("#startDate").fill(expectedDate);
  await page.locator("#endDate").fill(expectedDate);
  await page.locator("#totalDays").fill("1");

  const saveRequestPromise = page.waitForRequest((request) =>
    request.method() === "POST" && request.url().includes("/rest/v1/vacation_requests")
  );
  const notificationPromise = page.waitForRequest((request) =>
    request.method() === "POST" && request.url().includes("/rest/v1/notifications")
  );
  await page.getByRole("button", { name: "Submit Vacation Request" }).click();
  const saveRequest = await saveRequestPromise;
  const notificationRequest = await notificationPromise;
  const payload = saveRequest.postDataJSON();
  const savedRow = Array.isArray(payload) ? payload[0] : payload;
  const notificationPayload = notificationRequest.postDataJSON();
  const notificationRows = Array.isArray(notificationPayload) ? notificationPayload : [notificationPayload];
  const adminNotification = notificationRows.find((row) => row.target_profile_id === fakeProfile.id);

  expect(savedRow.request_date).toBe(expectedDate);
  expect(adminNotification).toBeTruthy();
  expect(adminNotification.target_role).toBe("admin");
  expect(adminNotification.target_worker_email).toBe(fakeProfile.email);
  expect(adminNotification.notification_type).toBe("vacation_request");
  expect(adminNotification.link_url).toBe("admin.html?tab=vacation");
  await expect(requestDate).toHaveValue(expectedDate);
  await expectNoRuntimeErrors(errors, "locked vacation request date");
});

test("employee can open an approved vacation request for date correction", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const workerProfile = {
    ...fakeProfile,
    display_name: "Steven Leduc",
    worker_key: "steven leduc",
    role: "worker"
  };
  const approvedRequest = {
    id: "00000000-0000-4000-8000-000000000304",
    worker_name: "steven leduc",
    worker_display_name: "Steven Leduc",
    request_date: "2026-08-01",
    start_date: "2026-08-13",
    end_date: "2026-08-17",
    return_date: "2026-08-18",
    total_days: 3,
    request_type: "Vacation",
    reason: "Vacation",
    employee_signature: "Steven Leduc",
    form_data: {},
    status: "approved"
  };

  await installAuthenticatedPortalState(page, workerProfile);
  await mockPortalServices(page, workerProfile);
  await page.route(`${supabaseOrigin}/rest/v1/vacation_requests**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([approvedRequest])
  }));
  await page.goto("/vacation-request.html", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Edit Approved Dates" }).click();
  await expect(page.locator("#startDate")).toHaveValue("2026-08-13");
  await expect(page.locator("#endDate")).toHaveValue("2026-08-17");
  await expect(page.locator("#returnDate")).toHaveValue("2026-08-18");
  await expect(page.locator("#vacationSubmitButton")).toHaveText("Save Approved Vacation Changes");
  await expect(page.locator("#requestType")).toBeDisabled();
  await expect(page.locator("#reason")).toBeDisabled();
  await expect(page.locator("#vacationCancelEditButton")).toBeVisible();
  await expectNoRuntimeErrors(errors, "employee approved vacation date editor");
});

test("timesheet PDF treats full-day leave placeholders as non-hour Off markers", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page, fakeProfile);
  await mockPortalServices(page, fakeProfile);
  await page.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#submitStatus")).toContainText("Loaded", { timeout: 10000 });

  const pdfCheck = await page.evaluate(() => {
    const html = buildTimesheetPdfHtml([
      { day: "Thursday", weekStartValue: "2026-08-09", jobName: "Shop JGC", jobNumber: "26074", hours: 8, entryType: "work", nightWork: false },
      { day: "Thursday", weekStartValue: "2026-08-09", jobName: "Vacation Day - Paid", jobNumber: "Vacation", hours: 0.01, entryType: "vacation", leaveType: "paid", nightWork: false },
      { day: "Friday", weekStartValue: "2026-08-09", jobName: "Vacation Day - Paid", jobNumber: "Vacation", hours: 0.01, entryType: "vacation", leaveType: "paid", nightWork: false }
    ], "Aug 9, 2026 to Aug 15, 2026", 8, "Vacation");

    return {
      dayTotalIsEight: html.includes("Day Hours<strong>8.00</strong>"),
      hasOffMarker: html.includes(">Off<"),
      containsPlaceholderTotal: html.includes("8.02") || html.includes("0.02")
    };
  });

  expect(pdfCheck.dayTotalIsEight).toBe(true);
  expect(pdfCheck.hasOffMarker).toBe(true);
  expect(pdfCheck.containsPlaceholderTotal).toBe(false);
  await expectNoRuntimeErrors(errors, "timesheet PDF leave placeholder totals");
});

test("admin timesheets do not auto-add approved vacation", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  let vacationRequestReads = 0;
  let timesheetEntryWrites = 0;

  page.on("request", (request) => {
    if (request.url().includes("/rest/v1/vacation_requests") && request.method() === "GET") {
      vacationRequestReads += 1;
    }
    if (request.url().includes("/rest/v1/timesheet_entries") && request.method() === "POST") {
      timesheetEntryWrites += 1;
    }
  });

  await installAuthenticatedPortalState(page, fakeProfile);
  await mockPortalServices(page, fakeProfile);
  await page.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#submitStatus")).toContainText("Loaded", { timeout: 10000 });

  await expect.poll(() => page.evaluate(() => shouldAutoAddApprovedVacationToTimesheet())).toBe(false);
  await expect.poll(() => vacationRequestReads).toBe(0);
  expect(timesheetEntryWrites).toBe(0);
  await expectNoRuntimeErrors(errors, "admin vacation timesheet exclusion");
});

test("test account stays isolated from Zeth timesheets and vacation requests", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const testProfile = {
    ...fakeProfile,
    email: "zethhummel@gmail.com",
    display_name: "Test Account",
    worker_key: "test account",
    role: "worker"
  };
  let timesheetEntryWrites = 0;
  const weekStart = (() => {
    const date = new Date();
    date.setDate(date.getDate() - date.getDay());
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  })();

  await installAuthenticatedPortalState(page, testProfile);
  await mockPortalServices(page, testProfile);
  await page.route(`${supabaseOrigin}/rest/v1/timesheet_entries**`, async (route) => {
    if (route.request().method() === "POST") {
      timesheetEntryWrites += 1;
      await route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "00000000-0000-4000-8000-000000000301",
          worker_name: "test account",
          week_start: weekStart,
          week_end: weekStart,
          job_name: "Test Job",
          job_number: "TEST-1",
          day_of_week: "Monday",
          time_in: "07:00:00",
          time_out: "15:30:00",
          hours: 8,
          took_lunch: true,
          night_work: false,
          entry_type: "work",
          leave_type: "",
          leave_note: ""
        },
        {
          id: "00000000-0000-4000-8000-000000000302",
          worker_name: "zeth hummel",
          week_start: weekStart,
          week_end: weekStart,
          job_name: "Vacation",
          job_number: "Vacation",
          day_of_week: "Tuesday",
          time_in: "00:00:00",
          time_out: "00:00:00",
          hours: 0.01,
          took_lunch: false,
          night_work: false,
          entry_type: "vacation",
          leave_type: "paid",
          leave_note: "Vacation"
        }
      ])
    });
  });
  await page.route(`${supabaseOrigin}/rest/v1/vacation_requests**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      id: "00000000-0000-4000-8000-000000000303",
      worker_name: "zeth hummel",
      worker_display_name: "Zeth Hummel",
      start_date: "2026-08-04",
      end_date: "2026-08-07",
      total_days: 4,
      request_type: "Vacation",
      form_data: {},
      status: "approved"
    }])
  }));

  await page.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#submitStatus")).toContainText("Loaded", { timeout: 10000 });

  const identity = await page.evaluate(() => ({
    timesheetAliases: getCurrentUserAliases().map(normalizeWorkerName),
    sharedAliases: getJgcWorkerAliases(getCurrentWorkerRecord()),
    visibleWorkers: loadTimesheets().map((entry) => normalizeWorkerName(entry.user)),
    matchesZethVacation: isVacationRequestForCurrentUser({
      worker_name: "zeth hummel",
      worker_display_name: "Zeth Hummel"
    })
  }));

  expect(identity.timesheetAliases).toContain("test account");
  expect(identity.timesheetAliases).toContain("zethhummel@gmail.com");
  expect(identity.timesheetAliases).not.toContain("zeth hummel");
  expect(identity.sharedAliases).not.toContain("zeth hummel");
  expect(identity.visibleWorkers).toEqual(["test account"]);
  expect(identity.matchesZethVacation).toBe(false);
  expect(timesheetEntryWrites).toBe(0);
  await expectNoRuntimeErrors(errors, "test account timesheet isolation");
});

test("timesheet job numbers accept digits only while Shop can stay blank", async ({ page }) => {
  const errors = watchRuntimeErrors(page);

  await installAuthenticatedPortalState(page, fakeProfile);
  await mockPortalServices(page, fakeProfile);
  await page.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#submitStatus")).toContainText("Loaded", { timeout: 10000 });

  await page.locator("#entryType").selectOption("work");
  await page.locator("#jobNumber").fill("Water trees 26074");
  await expect(page.locator("#jobNumber")).toHaveValue("26074");
  expect(await page.evaluate(() => isValidWorkJobNumber(""))).toBe(true);
  expect(await page.evaluate(() => isValidWorkJobNumber("Repair counter top"))).toBe(false);

  await page.locator("#entryType").selectOption("sick");
  await page.locator("#jobNumber").fill("Doctor appointment");
  await expect(page.locator("#jobNumber")).toHaveValue("Doctor appointment");

  await page.goto("/admin.html?tab=timesheets", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#timesheetsSection")).toBeVisible({ timeout: 10000 });
  const adminResult = await page.evaluate(() => {
    const input = document.getElementById("adminTimeEntryJobNumber");
    input.value = "Repair counter top 26040";
    sanitizeAdminTimesheetJobNumberInput(input, "adminTimeEntryType");
    return {
      value: input.value,
      blankAllowed: isValidAdminTimesheetWorkJobNumber(""),
      wordsAllowed: isValidAdminTimesheetWorkJobNumber("Water trees")
    };
  });

  expect(adminResult).toEqual({ value: "26040", blankAllowed: true, wordsAllowed: false });
  await expectNoRuntimeErrors(errors, "numeric timesheet job numbers");
});

test("employee and admin timesheet submissions confirm days over 14 hours", async ({ page }) => {
  const employeeSource = fs.readFileSync(path.join(portalRoot, "timesheet.html"), "utf8");
  const adminSource = fs.readFileSync(path.join(portalRoot, "admin-timesheets.js"), "utf8");
  expect(employeeSource).toContain("if (!confirmTimesheetLongDays(entries))");
  expect(adminSource).toContain("if (!confirmAdminTimesheetLongDays(liveEntries, worker))");

  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page, fakeProfile);
  await mockPortalServices(page, fakeProfile);
  await page.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof confirmTimesheetLongDays === "function");

  const employeeWarning = await page.evaluate(() => {
    let message = "";
    window.confirm = (value) => {
      message = value;
      return false;
    };
    const confirmed = confirmTimesheetLongDays([
      { day: "Monday", entryType: "work", hours: 8 },
      { day: "Monday", entryType: "work", hours: 8.25 },
      { day: "Tuesday", entryType: "work", hours: 14 },
      { day: "Thursday", entryType: "work", hours: 12 },
      { day: "Thursday", entryType: "vacation", leaveType: "half_day", hours: 3 },
      { day: "Wednesday", entryType: "vacation", leaveType: "paid", hours: 0.01 }
    ]);
    return { confirmed, message };
  });

  expect(employeeWarning.confirmed).toBe(false);
  expect(employeeWarning.message).toContain("Monday: 16.25 hours");
  expect(employeeWarning.message).toContain("Thursday: 15.00 hours");
  expect(employeeWarning.message).not.toContain("Tuesday:");
  expect(employeeWarning.message).not.toContain("Wednesday:");

  await page.goto("/admin.html?tab=timesheets", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof confirmAdminTimesheetLongDays === "function");
  const adminWarning = await page.evaluate(() => {
    let message = "";
    window.confirm = (value) => {
      message = value;
      return true;
    };
    const confirmed = confirmAdminTimesheetLongDays([
      { day_of_week: "Friday", entry_type: "work", hours: 9 },
      { day_of_week: "Friday", entry_type: "work", hours: 7 },
      { day_of_week: "Thursday", entry_type: "work", hours: 14 },
      { day_of_week: "Tuesday", entry_type: "work", hours: 12 },
      { day_of_week: "Tuesday", entry_type: "vacation", leave_type: "half_day", hours: 3 },
      { day_of_week: "Wednesday", entry_type: "sick", hours: 0.01 }
    ], "Steven Leduc");
    return { confirmed, message };
  });

  expect(adminWarning.confirmed).toBe(true);
  expect(adminWarning.message).toContain("Steven Leduc");
  expect(adminWarning.message).toContain("Friday: 16.00 hours");
  expect(adminWarning.message).toContain("Tuesday: 15.00 hours");
  expect(adminWarning.message).not.toContain("Thursday:");
  expect(adminWarning.message).not.toContain("Wednesday:");
  await expectNoRuntimeErrors(errors, "long timesheet day confirmation");
});

test("admin can submit a complete employee timesheet week", async ({ page }) => {
  const errors = watchRuntimeErrors(page, "accept");
  const now = new Date();
  const weekStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekStartDate.getDate() + 6);
  const dateValue = (date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
  const weekStart = dateValue(weekStartDate);
  const weekEnd = weekEndDate.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  let liveRows = weekdays.map((day, index) => ({
    id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
    worker_name: "Steven Leduc",
    week_start: weekStart,
    week_end: weekEnd,
    job_name: "Smoke Test Job",
    job_number: "26001",
    day_of_week: day,
    time_in: "07:00:00",
    time_out: "15:30:00",
    hours: 8,
    took_lunch: true,
    night_work: false,
    entry_type: "work",
    leave_type: "",
    leave_note: "",
    created_at: new Date().toISOString()
  }));
  liveRows.push(...weekdays.slice(0, 4).map((day, index) => ({
    ...liveRows[index],
    id: `00000000-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`,
    worker_name: fakeProfile.display_name
  })));
  let archivePayload = null;
  let deletedLiveWeek = false;
  let emailPayload = null;

  await installAuthenticatedPortalState(page, fakeProfile);
  await mockPortalServices(page, fakeProfile);
  await page.route(`${supabaseOrigin}/rest/v1/timesheet_entries**`, async (route) => {
    if (route.request().method() === "DELETE") {
      deletedLiveWeek = true;
      liveRows = liveRows.filter((row) => row.worker_name !== "Steven Leduc");
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*", "Content-Range": `0-${Math.max(0, liveRows.length - 1)}/${liveRows.length}` },
      body: JSON.stringify(liveRows)
    });
  });
  await page.route(`${supabaseOrigin}/rest/v1/previous_timesheet_weeks**`, async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON();
      archivePayload = Array.isArray(payload) ? payload[0] : payload;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/1" },
        body: JSON.stringify({
          id: "00000000-0000-4000-8000-000000000300",
          submitted_at: new Date().toISOString(),
          ...archivePayload
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/0" },
      body: "[]"
    });
  });
  await page.route("https://script.google.com/**", async (route) => {
    emailPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/admin.html?tab=timesheets", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#timesheetsSection")).toBeVisible({ timeout: 10000 });
  await page.locator("#timesheetWorkerFilter").fill("Steven");
  const submitButton = page.locator('button[data-worker="Steven Leduc"][data-week-start="' + weekStart + '"]');
  await expect(submitButton).toBeVisible();
  await expect(page.locator('button[data-worker="' + fakeProfile.display_name + '"]')).toHaveCount(0);

  await submitButton.click();
  await expect.poll(() => archivePayload).not.toBeNull();
  await expect.poll(() => deletedLiveWeek).toBe(true);
  await expect.poll(() => emailPayload).not.toBeNull();

  expect(archivePayload.worker_name).toBe("Steven Leduc");
  expect(archivePayload.entries).toHaveLength(5);
  expect(archivePayload.entries.map((entry) => entry.day)).toEqual(weekdays);
  expect(archivePayload.total_hours).toBe(40);
  expect(emailPayload.source).toBe("admin_submit");
  expect(emailPayload.to).toContain("steven@example.com");
  await expect(submitButton).toHaveCount(0);
  await expectNoRuntimeErrors(errors, "admin complete timesheet submission");
});

test("employee and admin timesheet PDFs use the readable portrait layout", async ({ page }) => {
  const employeeSource = fs.readFileSync(path.join(portalRoot, "timesheet.html"), "utf8");
  const adminSource = fs.readFileSync(path.join(portalRoot, "admin-timesheets.js"), "utf8");
  const expectedLayoutRules = [
    "@page { size: Letter portrait; margin: 0.45in; }",
    "h1, .employee-name",
    "font-size: 26px",
    ".job-number-col { width: 8.8%; }",
    "grid-template-columns: repeat(3, minmax(0, 1fr))",
    '<col class="job-number-col">'
  ];

  for (const source of [employeeSource, adminSource]) {
    for (const expectedRule of expectedLayoutRules) {
      expect(source).toContain(expectedRule);
    }
  }

  await installAuthenticatedPortalState(page, fakeProfile);
  await mockPortalServices(page, fakeProfile);
  await page.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => typeof buildTimesheetPdfHtml)).toBe("function");

  const employeePdf = await page.evaluate(() => {
    const html = buildTimesheetPdfHtml([
      {
        jobName: "Sunday Shop Work",
        jobNumber: "26074",
        day: "Sunday",
        weekStartValue: "2026-08-02",
        hours: 2,
        nightWork: false
      },
    {
      jobName: "McKay Office Addition",
      jobNumber: "25169",
      day: "Monday",
      weekStartValue: "2026-08-02",
      hours: 8,
      nightWork: false
    },
    {
      jobName: "Whip JGC",
      jobNumber: "26074",
      day: "Friday",
      weekStartValue: "2026-08-02",
      hours: 8.5,
      nightWork: false
    }
    ], "Aug 2, 2026 to Aug 8, 2026", 18.5, "Portrait layout smoke test");
    const document = new DOMParser().parseFromString(html, "text/html");
    const headers = Array.from(document.querySelectorAll("thead th"), (cell) =>
      String(cell.firstChild ? cell.firstChild.textContent : cell.textContent).trim()
    );
    const sundayRow = Array.from(document.querySelectorAll("tbody tr")).find((row) =>
      row.textContent.includes("Sunday Shop Work")
    );
    return {
      html,
      headers,
      sundayHours: Array.from(sundayRow.querySelectorAll("td.hours-cell"), (cell) => cell.textContent.trim())
    };
  });

  expect(employeePdf.html).toContain("Letter portrait");
  expect(employeePdf.html).toContain('<div class="employee-name">Portal Smoke Test</div>');
  expect(employeePdf.html).toContain('<col class="job-number-col">');
  expect(employeePdf.html).toContain("McKay Office Addition");
  expect(employeePdf.html).toContain("18.50");
  expect(employeePdf.headers).toEqual(["Job Name", "Job #", "Shift", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Total"]);
  expect(employeePdf.sundayHours).toEqual(["2.00", "", "", "", "", "", "", "2.00"]);

  if (process.env.JGC_TIMESHEET_PDF_OUTPUT) {
    fs.mkdirSync(path.dirname(process.env.JGC_TIMESHEET_PDF_OUTPUT), { recursive: true });
    await page.setContent(employeePdf.html, { waitUntil: "load" });
    await page.pdf({
      path: process.env.JGC_TIMESHEET_PDF_OUTPUT,
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true
    });
  }

  await page.goto("/admin.html?tab=timesheets", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => typeof buildAdminTimesheetPdfHtml)).toBe("function");
  const adminPdf = await page.evaluate(() => {
    const html = buildAdminTimesheetPdfHtml({
      worker_name: "Steven Leduc",
      week_label: "Aug 2, 2026 to Aug 8, 2026",
      note: "Portrait layout smoke test",
      entries: [
        { job_name: "Sunday Shop Work", job_number: "26074", week_start: "2026-08-02", day_of_week: "Sunday", entry_type: "work", hours: 2, night_work: false },
        { job_name: "McKay Office Addition", job_number: "25169", week_start: "2026-08-02", day_of_week: "Monday", entry_type: "work", hours: 8, night_work: false },
        { job_name: "Whip JGC", job_number: "26074", week_start: "2026-08-02", day_of_week: "Friday", entry_type: "work", hours: 8.5, night_work: false }
      ]
    }, 18.5);
    const document = new DOMParser().parseFromString(html, "text/html");
    const headers = Array.from(document.querySelectorAll("thead th"), (cell) =>
      String(cell.firstChild ? cell.firstChild.textContent : cell.textContent).trim()
    );
    const sundayRow = Array.from(document.querySelectorAll("tbody tr")).find((row) =>
      row.textContent.includes("Sunday Shop Work")
    );
    return {
      headers,
      sundayHours: Array.from(sundayRow.querySelectorAll("td.hours-cell"), (cell) => cell.textContent.trim())
    };
  });

  expect(adminPdf.headers).toEqual(["Job Name", "Job #", "Shift", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Total"]);
  expect(adminPdf.sundayHours).toEqual(["2.00", "", "", "", "", "", "", "2.00"]);
});

test("employees can lazy-load, view, and edit their own daily reports", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const reportId = "00000000-0000-4000-8000-000000000099";
  const report = {
    id: reportId,
    worker_name: fakeProfile.worker_key,
    worker_display_name: fakeProfile.display_name,
    report_date: "2026-07-20",
    project: "26040 - Williamstown Fairboard Entrance Sign",
    weather: "Sunny",
    crew: "Andre and Test Account",
    work_completed: "Installed entrance sign.",
    deliveries: "None",
    visitors: "Inspector",
    delays: "None",
    photos: [],
    created_at: "2026-07-20T12:00:00.000Z"
  };
  let updatePayload = null;

  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/daily_site_reports**`, async (route) => {
    const request = route.request();
    const accept = String(request.headers().accept || "");

    if (request.method() === "PATCH") {
      updatePayload = request.postDataJSON();
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Range": "0-0/1"
      },
      body: accept.includes("application/vnd.pgrst.object") ? JSON.stringify(report) : JSON.stringify([report])
    });
  });
  await installAuthenticatedPortalState(page);

  await page.goto("/reports.html", { waitUntil: "domcontentloaded" });
  await page.locator("#myDailyReportsSection > summary").click();
  await expect(page.locator("#myDailyReportsList")).toContainText(report.project);
  await expect(page.getByRole("button", { name: "View", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();

  await page.goto(`/daily-site-report.html?reportId=${reportId}&mode=edit&return=reports`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Edit Daily Site Report" })).toBeVisible();
  await expect(page.locator("#workCompleted")).toHaveValue(report.work_completed);
  await page.locator("#workCompleted").fill("Installed and inspected entrance sign.");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect.poll(() => updatePayload && updatePayload.work_completed).toBe("Installed and inspected entrance sign.");
  await expect(page.locator("#reportStatus")).toContainText("changes saved");

  await page.goto("/admin.html?tab=reports", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#dailySiteReportsList").getByRole("button", { name: "View", exact: true })).toBeVisible();
  await expect(page.locator("#dailySiteReportsList").getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expectNoRuntimeErrors(errors, "daily report history and editing");
});

test("admins can open the complete saved JSA from Reports", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const reportId = "00000000-0000-4000-8000-000000000110";
  const report = {
    id: reportId,
    worker_name: "andre labrosse",
    worker_display_name: "Andre Labrosse",
    inspection_type: "JSA",
    inspection_date: "2026-07-20",
    title: "JSA - 2026-07-20",
    form_data: {
      fields: [
        { label: "Project / Job", value: "26040 - Williamstown Fairboard Entrance Sign" },
        { label: "Location", value: "Williamstown" },
        { label: "Contractor Supervisor", value: "Andre Labrosse" },
        { label: "Crew Sign Off (Print Names)", value: "Andre Labrosse\nSteven Leduc" }
      ],
      rows: [{
        cells: ["Strip forms", "Exposed screws", "Remove screws completely"],
        table: 1
      }]
    },
    created_at: "2026-07-20T13:46:20.000Z"
  };
  const acknowledgement = {
    id: "00000000-0000-4000-8000-000000000111",
    record_type: "jsa",
    record_id: reportId,
    attendee_name: "Steven Leduc",
    attendee_company: "John Gordon Construction",
    acknowledgement_status: "acknowledged",
    acknowledgement_method: "employee_account",
    acknowledged_at: "2026-07-20T13:48:00.000Z",
    removed_at: null,
    created_at: "2026-07-20T13:47:00.000Z"
  };

  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/inspection_records**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/1" },
    body: JSON.stringify([report])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/safety_acknowledgements**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/1" },
    body: JSON.stringify([acknowledgement])
  }));
  await installAuthenticatedPortalState(page);

  await page.goto("/admin.html?tab=reports", { waitUntil: "domcontentloaded" });
  const jsaTab = page.locator('[data-report-tab="jsa"]');
  await expect(jsaTab.locator(".admin-report-count")).toHaveText("1");
  await jsaTab.click();
  await page.locator("#jsaReportsList").getByRole("button", { name: "View", exact: true }).click();

  const viewer = page.locator("#adminJsaReportViewPanel");
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText(report.form_data.fields[0].value);
  await expect(viewer).toContainText("Strip forms");
  await expect(viewer).toContainText("Exposed screws");
  await expect(viewer).toContainText("Remove screws completely");
  await expect(viewer).toContainText("Steven Leduc");
  const pdfButton = viewer.getByRole("button", { name: "Print / Save PDF" });
  await expect(pdfButton).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    pdfButton.click()
  ]);
  expect(download.suggestedFilename()).toBe("jsa-2026-07-20.pdf");
  await viewer.getByRole("button", { name: "Close" }).click();
  await expect(viewer).toBeHidden();
  await expectNoRuntimeErrors(errors, "admin JSA viewer");
});

test("admin toolbox talks show completed report history and attendance", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const talkId = "00000000-0000-4000-8000-000000000120";
  const reportId = "00000000-0000-4000-8000-000000000121";
  const report = {
    id: reportId,
    talk_id: talkId,
    talk_title: "Manual Material Handling",
    talk_file_path: "toolbox-talks/manual-material-handling.pdf",
    report_date: "2026-07-20",
    project: "26040 - Williamstown Fairboard Entrance Sign",
    location: "Williamstown",
    presenter_name: "Andre Labrosse",
    submitted_by_worker: "andre labrosse",
    submitted_by_name: "Andre Labrosse",
    discussion_notes: "Reviewed safe lifting practices.",
    hazards_discussed: "Heavy and awkward materials.",
    corrective_actions: "Use team lifts and carts.",
    crew: [{ workerName: "andre labrosse", displayName: "Andre Labrosse", company: "John Gordon Construction" }],
    created_at: "2026-07-20T13:54:01.000Z"
  };
  const attendance = {
    id: "00000000-0000-4000-8000-000000000122",
    report_id: reportId,
    talk_id: talkId,
    worker_name: "andre labrosse",
    worker_display_name: "Andre Labrosse",
    acknowledged_at: null,
    acknowledgement_name: "",
    created_at: "2026-07-20T13:54:02.000Z"
  };

  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/toolbox_talks**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/1" },
    body: JSON.stringify([{
      id: talkId,
      title: report.talk_title,
      file_path: report.talk_file_path,
      file_name: "manual-material-handling.pdf",
      is_active: true,
      created_at: report.created_at
    }])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/toolbox_talk_reports**`, (route) => {
    const wantsObject = String(route.request().headers().accept || "").includes("application/vnd.pgrst.object");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/1" },
      body: JSON.stringify(wantsObject ? report : [report])
    });
  });
  await page.route(`${supabaseOrigin}/rest/v1/toolbox_talk_attendance**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/1" },
    body: JSON.stringify([attendance])
  }));
  await installAuthenticatedPortalState(page);

  await page.goto("/admin.html?tab=reports", { waitUntil: "domcontentloaded" });
  const toolboxTab = page.locator('[data-report-tab="toolbox"]');
  await expect(toolboxTab.locator(".admin-report-count")).toHaveText("1");
  await toolboxTab.click();

  const history = page.locator("#toolboxTalkHistoryList");
  await expect(history).toContainText(report.talk_title);
  await expect(history).toContainText(report.project);
  await expect(history).toContainText("1 attendee");
  await expect(history).toContainText(report.presenter_name);
  await expect(history.locator("table")).toBeVisible();
  await expect(history.getByRole("button", { name: "Open PDF", exact: true })).toBeVisible();
  await expect(history.getByRole("button", { name: "Download", exact: true })).toBeVisible();
  await expect(history.getByRole("button", { name: "View", exact: true })).toBeVisible();
  await expect(history.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(history.getByRole("button", { name: "Report PDF", exact: true })).toBeVisible();
  await expect(history.getByRole("button", { name: "Email", exact: true })).toBeVisible();

  const signedTalkPdfRequest = page.waitForRequest((request) =>
    request.url().includes("/storage/v1/object/sign/toolbox-talks/manual-material-handling.pdf")
  );
  const talkPdfPopup = page.waitForEvent("popup");
  await history.getByRole("button", { name: "Open PDF", exact: true }).click();
  await signedTalkPdfRequest;
  (await talkPdfPopup).close();

  await history.getByRole("button", { name: "View", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`toolbox-talks\\.html\\?reportId=${reportId}.*mode=view`));
  await expect(page.locator("#toolboxTalkReportSection h2")).toHaveText("View Tool Box Talk Report");
  await expect(page.locator("#projectName")).toHaveValue(report.project);
  await expect(page.locator("#projectName")).toBeDisabled();
  await expect(page.locator("#editToolboxReportButton")).toBeVisible();
  await expectNoRuntimeErrors(errors, "admin toolbox talk history");
});

test("today's toolbox talk reports expose their report actions", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const now = new Date();
  const report = {
    id: "00000000-0000-4000-8000-000000000123",
    talk_id: "00000000-0000-4000-8000-000000000124",
    talk_title: "Head Protection",
    talk_file_path: "toolbox-talks/head-protection.pdf",
    report_date: now.toISOString().slice(0, 10),
    project: "26040 - Smoke Test Project",
    location: "Smoke Test Site",
    presenter_name: fakeProfile.display_name,
    submitted_by_worker: fakeProfile.worker_key,
    submitted_by_name: fakeProfile.display_name,
    discussion_notes: "Reviewed head protection requirements.",
    hazards_discussed: "Falling objects.",
    corrective_actions: "Wear approved hard hats.",
    crew: [],
    created_at: now.toISOString()
  };

  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/toolbox_talk_reports**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/1" },
    body: JSON.stringify([report])
  }));
  await installAuthenticatedPortalState(page);
  await page.goto("/todays-inspections.html?recordType=reports", { waitUntil: "domcontentloaded" });

  const row = page.locator("tbody tr").filter({ hasText: "Toolbox Talk" });
  await expect(row).toContainText(report.talk_title);
  await expect(row.getByRole("button", { name: "View", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Save PDF", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Email", exact: true })).toBeVisible();
  await expectNoRuntimeErrors(errors, "today toolbox report actions");
});

test("today's inspection management actions are limited to creators and admins", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const employeeProfile = {
    ...fakeProfile,
    display_name: "Portal Employee",
    worker_key: "portal employee",
    role: "employee"
  };

  await mockPortalServices(page, employeeProfile);
  await installAuthenticatedPortalState(page, employeeProfile);
  await page.goto("/todays-inspections.html", { waitUntil: "domcontentloaded" });

  const otherWorkerActions = await page.evaluate(() => {
    const record = {
      id: "inspection-other-worker",
      inspection_type: "Aerial Lifts",
      worker_name: "other worker",
      worker_display_name: "Other Worker"
    };
    return {
      canManage: currentWorkerCanManageInspection(record),
      view: renderInspectionViewCell(record),
      edit: renderInspectionEditCell(record),
      pdf: renderInspectionPdfCell(record),
      email: renderInspectionEmailCell(record),
      remove: renderInspectionDeleteCell(record)
    };
  });

  expect(otherWorkerActions.canManage).toBe(false);
  expect(otherWorkerActions.view).toContain(">View<");
  expect(otherWorkerActions.pdf).toContain("Save PDF");
  expect(otherWorkerActions.email).toContain(">Email<");
  expect(otherWorkerActions.edit).toBe("-");
  expect(otherWorkerActions.remove).toBe("-");

  const creatorActions = await page.evaluate(() => {
    const record = {
      id: "inspection-current-worker",
      inspection_type: "Aerial Lifts",
      worker_name: "portal employee",
      worker_display_name: "Portal Employee"
    };
    return {
      canManage: currentWorkerCanManageInspection(record),
      edit: renderInspectionEditCell(record),
      remove: renderInspectionDeleteCell(record)
    };
  });

  expect(creatorActions.canManage).toBe(true);
  expect(creatorActions.edit).toContain(">Edit<");
  expect(creatorActions.remove).toContain(">Delete<");

  const adminActions = await page.evaluate(() => {
    localStorage.setItem("currentUserRole", "admin");
    const record = {
      id: "inspection-admin-managed",
      inspection_type: "Aerial Lifts",
      worker_name: "other worker",
      worker_display_name: "Other Worker"
    };
    return {
      canManage: currentWorkerCanManageInspection(record),
      edit: renderInspectionEditCell(record),
      remove: renderInspectionDeleteCell(record)
    };
  });

  expect(adminActions.canManage).toBe(true);
  expect(adminActions.edit).toContain(">Edit<");
  expect(adminActions.remove).toContain(">Delete<");
  await expectNoRuntimeErrors(errors, "today inspection action permissions");
});

test("approved employees can add themselves to an existing JSA", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const now = new Date();
  const reportId = "00000000-0000-4000-8000-000000000125";
  const acknowledgementId = "00000000-0000-4000-8000-000000000126";
  const report = {
    id: reportId,
    worker_name: "andre labrosse",
    worker_display_name: "Andre Labrosse",
    inspection_type: "JSA",
    inspection_date: now.toISOString().slice(0, 10),
    title: "JSA - Late arrival smoke test",
    form_data: {
      fields: [
        { label: "Project / Job", value: "26040 - Smoke Test Project" },
        { label: "Location", value: "Smoke Test Site" },
        { label: "Contractor Supervisor", value: "Andre Labrosse" },
        { label: "Crew Sign Off (Print Names)", value: "Andre Labrosse" }
      ],
      rows: [{ cells: ["Review site", "Moving equipment", "Maintain awareness"], table: 1 }]
    },
    created_at: now.toISOString()
  };
  let acknowledgementRows = [];
  let acknowledgementPayload = null;

  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/inspection_records**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/1" },
    body: JSON.stringify([report])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/safety_acknowledgements**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Content-Range": `0-${Math.max(0, acknowledgementRows.length - 1)}/${acknowledgementRows.length}` },
    body: JSON.stringify(acknowledgementRows)
  }));
  await page.route(`${supabaseOrigin}/rest/v1/rpc/submit_current_user_safety_acknowledgement`, async (route) => {
    acknowledgementPayload = route.request().postDataJSON();
    acknowledgementRows = [{
      id: acknowledgementId,
      record_type: "jsa",
      record_id: reportId,
      attendee_name: fakeProfile.display_name,
      attendee_key: fakeProfile.worker_key,
      attendee_type: "employee",
      matched_employee_id: fakeProfile.id,
      matched_employee_email: fakeProfile.email,
      acknowledgement_status: "late_acknowledgement",
      acknowledgement_method: "late_user_portal",
      acknowledged_at: now.toISOString(),
      is_late: true,
      removed_at: null
    }];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify([{
        success: true,
        message: "Acknowledgement saved.",
        acknowledgement_id: acknowledgementId,
        already_acknowledged: false
      }])
    });
  });
  await installAuthenticatedPortalState(page);
  await page.goto("/todays-inspections.html?recordType=reports", { waitUntil: "domcontentloaded" });

  const row = page.locator("tbody tr").filter({ hasText: "JSA" });
  await row.getByRole("button", { name: "View", exact: true }).click();
  const panel = page.locator("#editPanel");
  await expect(panel.locator(".jsa-report-view")).toBeVisible();
  await expect(panel.locator(".jsa-report-header")).toContainText("Job Safety Analysis");
  await expect(panel.locator(".jsa-report-table")).toContainText("Review site");
  await expect(panel.locator('.jsa-report-view input:disabled')).toHaveCount(0);
  await expect(panel).not.toContainText("textarea");
  await expect(panel).toContainText("You were not on the original crew list");
  await expect(panel.getByRole("button", { name: "Acknowledge with Account", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Sign on This Device", exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "Acknowledge with Account", exact: true }).click();
  await expect.poll(() => acknowledgementPayload).not.toBeNull();
  expect(acknowledgementPayload).toMatchObject({
    p_record_type: "jsa",
    p_record_id: reportId,
    p_mode: "account"
  });
  await expect(panel).toContainText("You are already signed onto this safety record.");
  await expect(panel).toContainText(fakeProfile.display_name);
  await expectNoRuntimeErrors(errors, "late employee JSA acknowledgement");
});

test("login controls work without throwing", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await mockPortalServices(page);
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Notes" }).click();
  await expect(page.locator("#loginNotesOverlay")).toBeVisible();
  await page.locator("#loginMeasurementNotes").fill("Smoke test note");
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#loginNotesOverlay")).toBeHidden();

  await page.locator("#createAccountToggle").click();
  await expect(page.locator("#createAccountPanel")).toBeVisible();
  await expectNoRuntimeErrors(errors, "login controls");
});

test("limited accounts stay inside their read-only personal records hub", async ({ page }) => {
  const limitedProfile = {
    ...fakeProfile,
    role: "worker",
    account_status: "limited"
  };
  const errors = watchRuntimeErrors(page);
  await mockPortalServices(page, limitedProfile);
  await installAuthenticatedPortalState(page, limitedProfile);

  await page.goto("/home.html", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/limited-access\.html/);
  await expect(page.getByRole("heading", { name: "Limited Access" })).toBeVisible();

  for (const section of ["Certificates", "Timesheets", "Inspections", "Reports"]) {
    await page.getByRole("button", { name: section, exact: true }).first().click();
    await expect(page.locator(`.limited-panel[data-panel="${section.toLowerCase()}"]`)).toHaveClass(/active/);
  }

  await expectNoRuntimeErrors(errors, "limited access hub");
});

test("admin tabs switch to their matching sections", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.showTab === "function");

  const tabs = ["summary", "timesheets", "safetyRecords", "vacation", "tasks", "workOrders", "adminTools"];
  for (const tab of tabs) {
    await page.locator(`#${tab}Tab`).click();
    await expect(page.locator(`#${tab}Section`)).toBeVisible();
    await expect(page.locator(`#${tab}Tab`)).toHaveClass(/active/);
  }
  await expectNoRuntimeErrors(errors, "admin tabs");
});

test("summary search categories start collapsed and open one at a time", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/jobs**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ id: "summary-search-job", job_number: "205", job_name: "North Warehouse", active: true }])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/timesheet_entries**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      id: "summary-search-time",
      worker_name: fakeProfile.worker_key,
      week_start: "2026-08-02",
      day_of_week: "Monday",
      job_number: "205",
      job_name: "North Warehouse",
      hours: 8
    }])
  }));
  await page.goto("/admin.html?tab=summary", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.searchAdminEverything === "function");

  await page.locator("#adminGlobalSearchInput").fill("warehouse");
  await page.locator("#adminGlobalSearchButton").click();
  await expect(page.locator("#adminGlobalSearchStatus")).toContainText("2 relevant results");

  const summaryGroups = page.locator("#adminGlobalSearchResults .admin-global-search-group");
  await expect(summaryGroups).toHaveCount(2);
  await expect(summaryGroups.locator(".admin-global-search-group-results:visible")).toHaveCount(0);
  const summaryTimeGroup = summaryGroups.filter({ hasText: "Time & Attendance" });
  const summaryJobsGroup = summaryGroups.filter({ hasText: "Jobs & Work Orders" });
  const openSummaryGroup = async (group) => {
    await expect(async () => {
      const results = group.locator(".admin-global-search-group-results");
      if (await results.isHidden()) await group.locator(".admin-global-search-group-header").click();
      await expect(results).toBeVisible();
    }).toPass({ timeout: 10_000 });
  };
  await openSummaryGroup(summaryTimeGroup);
  await expect(summaryJobsGroup.locator(".admin-global-search-group-results")).toBeHidden();
  await openSummaryGroup(summaryJobsGroup);
  await expect(summaryTimeGroup.locator(".admin-global-search-group-results")).toBeHidden();
  await expectNoRuntimeErrors(errors, "summary search category accordions");
});

for (const tab of ["jobs", "jobDashboard"]) test(`legacy admin ${tab} route redirects to Estimator Jobs`, async ({page}) => {
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto(`/admin.html?tab=${tab}&job=26901`);
  await expect(page).toHaveURL(/estimating\/\?view=jobs&job=26901/);
});

test("admin spyglass searches lazy portal data from any page", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const requestedTables = new Set();

  page.on("request", (request) => {
    const match = request.url().match(/\/rest\/v1\/([^?]+)/);
    if (match) requestedTables.add(match[1]);
  });

  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/jobs**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { id: "global-job-one", job_number: "101", job_name: "Main Street Office", active: true },
      { id: "global-job-two", job_number: "205", job_name: "North Warehouse", active: true }
    ])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/timesheet_entries**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{
      id: "global-search-time",
      worker_name: fakeProfile.worker_key,
      week_start: "2026-08-02",
      day_of_week: "Monday",
      job_number: "205",
      job_name: "North Warehouse",
      hours: 8
    }])
  }));

  await page.goto("/home.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.JGCAdminGlobalSearch && document.getElementById("jgcAdminGlobalSearchButton"));
  await page.locator("#jgcAdminGlobalSearchButton").click();
  await expect(page.locator("#jgcAdminGlobalSearchPanel")).toBeVisible();
  await page.waitForTimeout(200);
  requestedTables.clear();
  await page.locator("#jgcAdminGlobalSearchInput").fill("warehouse");
  await page.locator("#jgcAdminGlobalSearchSubmit").click();

  await expect(page.locator("#jgcAdminGlobalSearchStatus")).toContainText("Choose a category");
  await expect(page.locator("#jgcAdminGlobalSearchResults")).not.toContainText("205 - North Warehouse");
  const spyglassGroups = page.locator("#jgcAdminGlobalSearchResults .jgc-admin-search-group");
  await expect(spyglassGroups).toHaveCount(10);
  await expect(spyglassGroups.locator(".jgc-admin-search-group-results:visible")).toHaveCount(0);
  expect(requestedTables.size).toBe(0);
  const spyglassTimeGroup = spyglassGroups.filter({ hasText: "Time & Attendance" });
  const spyglassJobsGroup = spyglassGroups.filter({ hasText: "Jobs & Work Orders" });
  await spyglassTimeGroup.locator(".jgc-admin-search-group-header").click();
  await expect(spyglassTimeGroup.locator(".jgc-admin-search-group-results")).toBeVisible();
  await expect(spyglassTimeGroup).toContainText("North Warehouse");
  await expect.poll(() => requestedTables.has("timesheet_entries")).toBe(true);
  expect(requestedTables).not.toContain("jobs");
  expect(requestedTables).not.toContain("daily_site_reports");
  expect(requestedTables).not.toContain("subcontractors_suppliers");
  expect(requestedTables).not.toContain("tasks");
  await expect(spyglassJobsGroup.locator(".jgc-admin-search-group-results")).toBeHidden();
  await spyglassJobsGroup.locator(".jgc-admin-search-group-header").click();
  await expect(spyglassTimeGroup.locator(".jgc-admin-search-group-results")).toBeHidden();
  await expect(spyglassJobsGroup.locator(".jgc-admin-search-group-results")).toBeVisible();
  await expect(spyglassJobsGroup).toContainText("205 - North Warehouse");
  await expect.poll(() => requestedTables.has("jobs")).toBe(true);
  await expect.poll(() => requestedTables.has("work_orders")).toBe(true);
  expect(requestedTables).not.toContain("daily_site_reports");
  expect(requestedTables).not.toContain("subcontractors_suppliers");
  expect(requestedTables).not.toContain("tasks");

  await spyglassJobsGroup.locator("[data-jgc-admin-search-result]").click();
  await expect(page).toHaveURL(/estimating\/\?view=jobs&job=205/);
  await expectNoRuntimeErrors(errors, "admin global spyglass search");
});

test("employee spyglass searches navigation, jobs, and only the employee's records", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const requestedTables = new Set();
  const employeeProfile = {
    ...fakeProfile,
    email: "employee-search-smoke@example.com",
    display_name: "Employee Search Smoke",
    worker_key: "employee search smoke",
    role: "worker"
  };

  page.on("request", (request) => {
    const match = request.url().match(/\/rest\/v1\/([^?]+)/);
    if (match) requestedTables.add(match[1]);
  });

  await installAuthenticatedPortalState(page, employeeProfile);
  await mockPortalServices(page, employeeProfile);
  await page.route(`${supabaseOrigin}/rest/v1/jobs**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      { id: "employee-job-one", job_number: "205", job_name: "North Warehouse", active: true }
    ])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/timesheet_entries**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      {
        id: "employee-own-entry",
        worker_name: employeeProfile.worker_key,
        week_start: "2026-08-02",
        day_of_week: "Monday",
        job_number: "205",
        job_name: "North Warehouse",
        leave_note: "Private scaffold note"
      },
      {
        id: "other-employee-entry",
        worker_name: "another employee",
        week_start: "2026-08-02",
        day_of_week: "Tuesday",
        job_number: "999",
        job_name: "Other employee secret project",
        leave_note: "Other employee secret note"
      }
    ])
  }));
  await page.goto("/home.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.JGCAdminGlobalSearch && document.getElementById("jgcAdminGlobalSearchButton"));

  await page.locator("#jgcAdminGlobalSearchButton").click();
  await expect(page.locator("#jgcAdminGlobalSearchPanel")).toBeVisible();
  await expect(page.locator("#jgcAdminGlobalSearchTitle")).toHaveText("Find Pages, Jobs, and Your Records");
  await page.waitForTimeout(200);
  requestedTables.clear();

  await page.locator("#jgcAdminGlobalSearchInput").fill("warehouse");
  await page.locator("#jgcAdminGlobalSearchSubmit").click();
  await expect(page.locator("#jgcAdminGlobalSearchStatus")).toContainText("Choose a category");
  await expect(page.locator("#jgcAdminGlobalSearchResults")).not.toContainText("205 - North Warehouse");
  const employeeGroups = page.locator("#jgcAdminGlobalSearchResults .jgc-admin-search-group");
  await expect(employeeGroups).toHaveCount(9);
  await expect(employeeGroups.locator(".jgc-admin-search-group-results:visible")).toHaveCount(0);
  expect(requestedTables.size).toBe(0);
  const employeeTimeGroup = employeeGroups.filter({ hasText: "Time & Attendance" });
  const employeeJobsGroup = employeeGroups.filter({ hasText: "Jobs & Work Orders" });
  await employeeTimeGroup.locator(".jgc-admin-search-group-header").click();
  await expect(employeeTimeGroup.locator(".jgc-admin-search-group-results")).toBeVisible();
  await expect(employeeTimeGroup).toContainText("North Warehouse");
  await expect.poll(() => requestedTables.has("timesheet_entries")).toBe(true);
  expect(requestedTables).not.toContain("jobs");
  await employeeJobsGroup.locator(".jgc-admin-search-group-header").click();
  await expect(employeeTimeGroup.locator(".jgc-admin-search-group-results")).toBeHidden();
  await expect(employeeJobsGroup.locator(".jgc-admin-search-group-results")).toBeVisible();
  await expect(employeeJobsGroup).toContainText("205 - North Warehouse");
  await expect.poll(() => requestedTables.has("jobs")).toBe(true);
  expect(requestedTables).not.toContain("daily_site_reports");
  expect(requestedTables).not.toContain("employee_injury_reports");

  await page.locator("#jgcAdminGlobalSearchInput").fill("private scaffold");
  await page.locator("#jgcAdminGlobalSearchSubmit").click();
  const privateTimeGroup = page.locator("#jgcAdminGlobalSearchResults .jgc-admin-search-group").filter({ hasText: "Time & Attendance" });
  await privateTimeGroup.locator(".jgc-admin-search-group-header").click();
  await expect(privateTimeGroup).toContainText("North Warehouse");

  await page.locator("#jgcAdminGlobalSearchInput").fill("other employee secret");
  await page.locator("#jgcAdminGlobalSearchSubmit").click();
  const privateCheckGroup = page.locator("#jgcAdminGlobalSearchResults .jgc-admin-search-group").filter({ hasText: "Time & Attendance" });
  await privateCheckGroup.locator(".jgc-admin-search-group-header").click();
  await expect(page.locator("#jgcAdminGlobalSearchStatus")).toContainText("No matching records");

  await page.locator("#jgcAdminGlobalSearchInput").fill("forklift");
  await page.locator("#jgcAdminGlobalSearchSubmit").click();
  const navigationGroup = page.locator("#jgcAdminGlobalSearchResults .jgc-admin-search-group").filter({ hasText: "Portal Navigation" });
  await navigationGroup.locator(".jgc-admin-search-group-header").click();
  await expect(navigationGroup).toContainText("Forklift Inspection");

  await page.locator("#jgcAdminGlobalSearchInput").fill("warehouse");
  await page.locator("#jgcAdminGlobalSearchSubmit").click();
  const finalJobsGroup = page.locator("#jgcAdminGlobalSearchResults .jgc-admin-search-group").filter({ hasText: "Jobs & Work Orders" });
  await finalJobsGroup.locator(".jgc-admin-search-group-header").click();
  await finalJobsGroup.locator(".jgc-admin-search-result").filter({ hasText: "205 - North Warehouse" }).getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/jobs\.html\?search=205/);
  await expect(page.locator("#jobSearch")).toHaveValue("205");

  expect(requestedTables).not.toContain("estimator_workspaces");
  await expectNoRuntimeErrors(errors, "employee global spyglass search");
});

test("admin calendar loads approved employees on summary startup", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const tableRequests = [];
  page.on("request", (request) => {
    const match = request.url().match(/\/rest\/v1\/([^?]+)/);
    if (match) {
      tableRequests.push(match[1]);
    }
  });

  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto("/admin.html?tab=summary", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => adminDataLoaded === true);
  await page.evaluate(() => openAdminScheduleModal("2026-08-10"));

  expect(tableRequests).toContain("work_order_labour_workers");
  expect(tableRequests).toContain("employee_feature_access");
  await expect(page.locator("#adminScheduleEmployees")).toContainText(fakeProfile.display_name);
  await expect(page.locator("#adminScheduleEmployees")).toContainText("Steven Leduc");
  await expectNoRuntimeErrors(errors, "admin calendar employee loading");
});

test("admin tools stay lazy while the job search list preloads", async ({ page }) => {
  test.setTimeout(45_000);
  const errors = watchRuntimeErrors(page);
  const tableRequests = [];
  page.on("request", (request) => {
    const match = request.url().match(/\/rest\/v1\/([^?]+)/);
    if (match) {
      tableRequests.push(match[1]);
    }
  });

  const tools = [
    ["employeeProfile", "previous_timesheet_weeks"],
    ["certificates", "certificates"],
    ["equipment", "equipment_vehicles"],
    ["contacts", "contacts"],
    ["subcontractorsSuppliers", "subcontractors_suppliers"],
    ["noticePolicy", "announcements"]
  ];

  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);

  await page.goto("/admin.html?tab=adminTools", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => adminDataLoaded === true);
  expect(tableRequests, "job list was not preloaded").toContain("jobs");
  expect(tableRequests, "job details loaded before a job was selected").not.toContain("work_orders");

  for (const [tab, table] of tools) {
    tableRequests.length = 0;
    await page.goto("/admin.html?tab=adminTools", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => adminDataLoaded === true);
    await expect(page.locator("#adminToolsSection")).toBeVisible();
    expect(tableRequests, `${table} was requested before ${tab} opened`).not.toContain(table);

    await page.evaluate((toolTab) => openAdminTool(toolTab), tab);
    await page.waitForFunction((toolTab) => adminTabDataLoaded.has(toolTab), tab);
    expect(tableRequests, `${table} was not requested after ${tab} opened`).toContain(table);

    const requestCount = tableRequests.filter((name) => name === table).length;
    await page.evaluate(() => showTab("adminTools"));
    await page.evaluate((toolTab) => openAdminTool(toolTab), tab);
    await page.waitForTimeout(100);
    expect(
      tableRequests.filter((name) => name === table).length,
      `${table} was requested again when ${tab} reopened`
    ).toBe(requestCount);
  }

  await expectNoRuntimeErrors(errors, "admin tool lazy loading");
});

test("admin inspection categories build their tables only when opened", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.renderInspections === "function");
  await page.locator("#safetyRecordsTab").click();
  await expect(page.locator("#safetyRecordsSection")).toBeVisible();
  await expect(page.locator("#inspectionsSection")).toBeVisible();
  const safetyRecordTiles = page.locator("#safetyRecordsSection .admin-safety-record-tile");
  await expect(safetyRecordTiles).toHaveCount(3);
  await expect(safetyRecordTiles.nth(0)).toContainText("Review employee and equipment inspection records");
  await expect(safetyRecordTiles.nth(1)).toContainText("Review site, safety, incident, and toolbox reports");
  await expect(safetyRecordTiles.nth(2)).toContainText("Review completed safety permits");
  await expect(safetyRecordTiles.nth(0)).toHaveAttribute("aria-selected", "true");
  const safetyTileAppearance = await page.evaluate(() => {
    const grid = document.querySelector(".admin-safety-record-tiles");
    const tile = document.querySelector(".admin-safety-record-tile");
    return {
      gridDisplay: getComputedStyle(grid).display,
      minHeight: getComputedStyle(tile).minHeight,
      boxShadow: getComputedStyle(tile).boxShadow
    };
  });
  expect(safetyTileAppearance.gridDisplay).toBe("grid");
  expect(safetyTileAppearance.minHeight).toBe("96px");
  expect(safetyTileAppearance.boxShadow).toContain("inset");
  await page.waitForFunction(() => adminTabDataLoaded.has("safetyRecords"));

  await page.evaluate(() => {
    adminTabDataLoading.safetyRecords = false;
    adminTabDataLoaded.add("safetyRecords");
    safetyRecordsSubtabDataLoaded.add("inspections");
    safetyRecordsSubtabDataLoaded.add("permits");
    inspections = [
      {
        id: "smoke-aerial",
        inspection_date: "2026-07-18",
        inspection_type: "Aerial Lifts",
        worker_display_name: "Smoke Inspector",
        equipment_name: "Lift 1",
        created_at: "2026-07-18T12:00:00Z"
      },
      {
        id: "smoke-harness",
        inspection_date: "2026-07-18",
        inspection_type: "Harness",
        worker_display_name: "Smoke Inspector",
        equipment_name: "Harness 1",
        created_at: "2026-07-18T12:01:00Z"
      },
      {
        id: "smoke-jsa",
        inspection_date: "2026-07-18",
        inspection_type: "JSA",
        worker_display_name: "Smoke Inspector",
        created_at: "2026-07-18T12:01:30Z"
      },
      {
        id: "smoke-permit",
        inspection_date: "2026-07-18",
        inspection_type: "Hot Work Permit",
        worker_display_name: "Smoke Inspector",
        created_at: "2026-07-18T12:01:45Z"
      }
    ];
    vehicleInspections = [{
      id: "smoke-vehicle",
      inspection_date: "2026-07-18",
      inspection_type: "Pre Inspection",
      driver_name: "Smoke Driver",
      vehicle_license_plate: "TEST123",
      created_at: "2026-07-18T12:02:00Z"
    }];
    renderInspections("inspections");
  });

  const categories = page.locator("#inspectionsList > .jgc-archive-list > details[data-inspection-category]");
  await expect(categories).toHaveCount(3);
  await expect(page.locator("#inspectionsList table")).toHaveCount(0);

  const vehicleCategory = categories.filter({ hasText: "Vehicle / Trailer" });
  await vehicleCategory.locator("summary").click();
  await expect(vehicleCategory.locator("[data-inspection-lazy-body]")).toHaveAttribute("data-loaded", "true");
  await expect(vehicleCategory.locator("table")).toHaveCount(1);
  await expect(page.locator("#inspectionsList table")).toHaveCount(1);

  await page.evaluate(() => switchSafetyRecordsSubtab("permits"));
  await expect(page.locator("#adminInspectionSectionTitle")).toHaveText("Safety Permits");
  const permitCategories = page.locator("#inspectionsList > .jgc-archive-list > details[data-inspection-category]");
  await expect(permitCategories).toHaveCount(1);
  await expect(permitCategories.first()).toContainText("Hot Work Permits");
  await expect(page.locator("#inspectionsList")).not.toContainText("JSA");
  await expectNoRuntimeErrors(errors, "admin inspection categories");
});

test("legacy admin inspection and report links open Safety Records", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);

  await page.goto("/admin.html?tab=inspections", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#safetyRecordsTab")).toHaveClass(/active/);
  await expect(page.locator("#inspectionsSection")).toBeVisible();
  await expect(page.locator('[data-safety-record-tab="inspections"]')).toHaveClass(/active/);

  await page.goto("/admin.html?tab=reports", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#safetyRecordsTab")).toHaveClass(/active/);
  await expect(page.locator("#reportsSection")).toBeVisible();
  await expect(page.locator('[data-safety-record-tab="reports"]')).toHaveClass(/active/);
  await expectNoRuntimeErrors(errors, "legacy Safety Records links");
});

test("Safety Records loads report tables only when Reports is opened", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const tableRequests = [];
  page.on("request", (request) => {
    const match = request.url().match(/\/rest\/v1\/([^?]+)/);
    if (match) {
      tableRequests.push(match[1]);
    }
  });
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto("/admin.html?tab=summary", { waitUntil: "domcontentloaded" });

  await page.locator("#safetyRecordsTab").click();
  await page.waitForFunction(() => adminTabDataLoaded.has("safetyRecords"));
  expect(tableRequests).toContain("inspection_records");
  expect(tableRequests).not.toContain("daily_site_reports");
  expect(tableRequests).not.toContain("toolbox_talk_reports");

  await page.locator('[data-safety-record-tab="reports"]').click();
  await page.waitForFunction(() => safetyRecordsSubtabDataLoaded.has("reports"));
  expect(tableRequests).toContain("daily_site_reports");
  expect(tableRequests).toContain("toolbox_talk_reports");
  await expectNoRuntimeErrors(errors, "Safety Records lazy report loading");
});

test("admin vacation requests build each employee table only when opened", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.renderVacationRequests === "function");
  await page.locator("#vacationTab").click();
  await expect(page.locator("#vacationSection")).toBeVisible();

  await page.evaluate(() => {
    vacationRequests = [
      {
        id: "smoke-vacation-one",
        worker_name: "smoke worker one",
        worker_display_name: "Smoke Worker One",
        start_date: "2026-07-20",
        end_date: "2026-07-21",
        return_date: "2026-07-22",
        total_days: 2,
        request_type: "paid",
        status: "pending",
        reason: "Smoke test"
      },
      {
        id: "smoke-vacation-two",
        worker_name: "smoke worker two",
        worker_display_name: "Smoke Worker Two",
        start_date: "2026-07-23",
        end_date: "2026-07-23",
        return_date: "2026-07-24",
        total_days: 1,
        request_type: "unpaid",
        status: "approved",
        reason: "Smoke test"
      }
    ];
    renderVacationRequests();
  });

  const groups = page.locator("#vacationList > .jgc-archive-list > details[data-vacation-worker]");
  await expect(groups).toHaveCount(2);
  await expect(page.locator("#vacationList table")).toHaveCount(0);

  const firstWorker = groups.filter({ hasText: "Smoke Worker One" });
  await firstWorker.locator("summary").click();
  await expect(firstWorker.locator("[data-vacation-lazy-body]")).toHaveAttribute("data-loaded", "true");
  await expect(firstWorker.locator("table")).toHaveCount(1);
  await expect(page.locator("#vacationList table")).toHaveCount(1);

  const secondWorker = groups.filter({ hasText: "Smoke Worker Two" });
  await secondWorker.locator("summary").click();
  await secondWorker.getByRole("button", { name: "Edit Approved Dates" }).click();
  await expect(page.locator("#adminVacationStart-smoke-vacation-two")).toHaveValue("2026-07-23");
  await expect(page.getByRole("button", { name: "Save Dates" })).toBeVisible();
  await expectNoRuntimeErrors(errors, "admin vacation employee groups");
});

test("employee directories defer Supabase data until their sections are opened", async ({ page }) => {
  test.setTimeout(45_000);
  const errors = watchRuntimeErrors(page);
  const tableRequests = [];
  page.on("request", (request) => {
    const match = request.url().match(/\/rest\/v1\/([^?]+)/);
    if (match) tableRequests.push(match[1]);
  });

  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);

  const directories = [
    ["equipment-vehicles.html", "#equipmentDirectoryDetails", "equipment_vehicles"],
    ["contacts.html", "#contactsDirectoryDetails", "contacts"],
    ["subcontractors-suppliers.html", "#supplierDirectoryDetails", "subcontractors_suppliers"]
  ];

  for (const [pageName, detailsSelector, table] of directories) {
    tableRequests.length = 0;
    await page.goto(`/${pageName}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(150);
    expect(tableRequests, `${table} was requested before its directory opened`).not.toContain(table);

    await page.locator(`${detailsSelector} > summary`).click();
    await expect.poll(() => tableRequests.includes(table), {
      message: `${table} was not requested after its directory opened`
    }).toBe(true);
  }

  tableRequests.length = 0;
  await page.goto("/policies-announcements.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(150);
  expect(tableRequests).not.toContain("policies");
  expect(tableRequests).not.toContain("announcements");

  await page.locator("#policiesDetails > summary").click();
  await expect.poll(() => tableRequests.includes("policies")).toBe(true);
  expect(tableRequests).not.toContain("announcements");

  await page.locator("#announcementsDetails > summary").click();
  await expect.poll(() => tableRequests.includes("announcements")).toBe(true);

  tableRequests.length = 0;
  await page.goto("/tasks.html", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(150);
  expect(tableRequests).not.toContain("tasks");
  expect(tableRequests).not.toContain("jobs");
  expect(tableRequests).not.toContain("work_order_labour_workers");

  await page.locator("#taskListDetails > summary").click();
  await expect.poll(() => tableRequests.includes("tasks")).toBe(true);
  expect(tableRequests).not.toContain("jobs");
  expect(tableRequests).not.toContain("work_order_labour_workers");

  await page.locator("#taskFormDetails > summary").click();
  await expect.poll(() => tableRequests.includes("jobs")).toBe(true);
  await expect.poll(() => tableRequests.includes("work_order_labour_workers")).toBe(true);
  await expect.poll(() => tableRequests.includes("employee_feature_access")).toBe(true);
  await expectNoRuntimeErrors(errors, "employee directory lazy loading");
});

test("embedded admin tasks hide the duplicate portal spyglass", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);

  await page.goto("/tasks.html?embedded=1&admin=1", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#jgcAdminGlobalSearch", { state: "attached" });

  await expect(page.locator("#taskFormDetails > summary")).toBeVisible();
  await expect(page.locator("#jgcAdminGlobalSearch")).toBeHidden();
  await expectNoRuntimeErrors(errors, "embedded admin tasks portal search");
});

test("purchase order pages keep the portal spyglass circular", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);

  for (const path of ["/purchase-orders.html", "/purchase-orders-admin.html"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.JGCAdminGlobalSearch && document.getElementById("jgcAdminGlobalSearchButton"));

    const shape = await page.locator("#jgcAdminGlobalSearchButton").evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      return {
        width: bounds.width,
        height: bounds.height,
        radius: Number.parseFloat(getComputedStyle(button).borderTopLeftRadius)
      };
    });

    expect(Math.abs(shape.width - shape.height)).toBeLessThanOrEqual(1);
    expect(shape.radius).toBeGreaterThanOrEqual((Math.min(shape.width, shape.height) / 2) - 1);
  }

  await expectNoRuntimeErrors(errors, "purchase order portal search button shape");
});

test("Accounting is a standalone admin page with captured biweekly review", async ({ page }) => {
  const accountingSource = fs.readFileSync(path.join(portalRoot, "accounting-admin.js"), "utf8");
  const accountingInclusionMigration = fs.readFileSync(
    path.join(portalRoot, "supabase", "migrations", "20260811144734_use_accounting_access_for_employee_inclusion.sql"),
    "utf8"
  );
  const shopMigration = fs.readFileSync(
    path.join(portalRoot, "supabase", "migrations", "20260811143339_approve_shop_accounting_entries.sql"),
    "utf8"
  );
  const autoFillMigration = fs.readFileSync(
    path.join(portalRoot, "supabase", "migrations", "20260811160404_accounting_autofill_leave_timesheets.sql"),
    "utf8"
  );
  const autoFillRlsMigration = fs.readFileSync(
    path.join(portalRoot, "supabase", "migrations", "20260811161307_enforce_accounting_autofill_rls.sql"),
    "utf8"
  );
  expect(accountingSource).not.toContain("accounting_period_employee_inputs");
  expect(accountingSource).not.toContain("accounting_employee_settings");
  expect(accountingSource).not.toContain("data-save-setting");
  expect(accountingSource).toContain("inputs: {}");
  expect(accountingInclusionMigration).toContain("coalesce(setting.include_in_payroll, false)");
  expect(accountingInclusionMigration).toContain("profile.role = 'admin'");
  expect(accountingInclusionMigration).toContain("profile.account_status = 'approved'");
  expect(accountingInclusionMigration).toContain("(new.id, 'accounting', false)");
  expect(shopMigration).toContain("accounting_time_entries_approve_shop");
  expect(shopMigration).toContain("Automatically approved: Shop");
  expect(shopMigration).toContain("'^shop([[:space:]]|$)'");
  expect(autoFillMigration).toContain("security definer");
  expect(autoFillMigration).toContain("private.jgc_has_accounting_access()");
  expect(autoFillMigration).toContain("revoke all on function public.accounting_autofill_leave_timesheet");
  expect(autoFillMigration).toContain("The week is still missing");
  expect(autoFillRlsMigration).toContain("security invoker");
  expect(autoFillRlsMigration).toContain("existing RLS policies");
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile, { accountingEnabled: false });

  await page.goto("/admin.html?tab=timesheets", { waitUntil: "domcontentloaded" });
  const accountingLink = page.locator("[data-jgc-admin-nav] a", { hasText: "Accounting" }).first();
  await expect(accountingLink).toHaveAttribute("href", "accounting-admin.html");

  await accountingLink.click();
  await expect(page).toHaveURL(/accounting-admin\.html/);
  await expect(page.locator("#accountingCurrentUser")).toContainText("Portal Smoke Test");
  await expect(page.locator("#accountingRefresh")).toBeEnabled();
  await page.locator("#accountingPayDate").evaluate((input) => {
    input.value = "2026-08-20";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("[data-jgc-admin-section='accounting']")).toHaveClass(/active/);
  await expect(page.locator("#accountingPeriodDates")).toContainText("Aug 2, 2026");
  await expect(page.locator("#accountingMetrics")).toContainText("16.00");
  await expect(page.locator("#accountingValidation")).toContainText("Final export checks passed");
  await expect(page.locator("#accountingValidation")).toContainText("Vacation: 1");
  await expect(page.locator("#accountingValidation")).not.toContainText("stored-total difference");
  await expect(page.locator("#accountingEmployeeReview details")).toHaveCount(1);
  await expect(page.locator("#accountingEmployeeReview details")).not.toHaveAttribute("open", "");
  await expect(page.locator("#accountingJobExceptions")).toContainText("All work entries are matched");
  await expect(page.locator("#accountingRatesPanel")).not.toHaveAttribute("open", "");
  await expect(page.locator("#accountingRates")).not.toBeVisible();
  await page.locator("#accountingRatesPanel > summary").click();
  await expect(page.locator("#accountingRatesPanel")).toHaveAttribute("open", "");
  await expect(page.locator("#accountingRates")).toBeVisible();
  await expect(page.locator("#accountingRates")).toContainText("Steven Leduc");
  await expect(page.locator("#accountingRates")).not.toContainText("Portal Smoke Test");
  await expect(page.locator("#accountingRates [data-payroll-included]")).toHaveCount(0);
  await expect(page.locator("#accountingRates [data-save-setting]")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Accounting Inputs" })).toHaveCount(0);
  await expect(page.locator("#accountingSaveInputs")).toHaveCount(0);
  await expect(page.locator(".accounting-export-help")).toContainText("completed in Excel after download");
  await expect(page.locator("#accountingTemplateStatus")).toContainText("Approved template ready");
  await expect(page.locator("#accountingDownloadFinal")).toBeEnabled();
  await expectNoRuntimeErrors(errors, "Accounting admin workflow");
});

test("Accounting Export Ledger records exact-file re-downloads", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const periodId = "00000000-0000-4000-8000-000000000070";
  const exportId = "00000000-0000-4000-8000-000000000071";
  const darleneId = "00000000-0000-4000-8000-000000000072";
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile, {
    accountingEnabled: false,
    accountingPeriod: {
      id: periodId,
      pay_date: "2026-08-20",
      week_one_start: "2026-08-02",
      week_one_end: "2026-08-08",
      week_two_start: "2026-08-09",
      week_two_end: "2026-08-15",
      status: "draft"
    },
    accountingExports: [{
      id: exportId,
      pay_period_id: periodId,
      file_name: "JGC Payroll - Aug 2, 2026 to Aug 15, 2026.xlsx",
      file_sha256: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      is_final: false,
      exported_by: fakeProfile.id,
      exported_at: "2026-08-18T14:00:00Z"
    }],
    accountingExportDownloads: [{
      id: "00000000-0000-4000-8000-000000000074",
      export_id: exportId,
      downloaded_by: darleneId,
      downloaded_at: "2026-08-19T15:30:00Z"
    }],
    additionalProfiles: [{
      id: darleneId,
      email: "darlene@example.com",
      display_name: "Darlene Donaher",
      worker_key: "darlene donaher",
      role: "admin",
      account_status: "approved"
    }]
  });

  await page.goto("/accounting-admin.html", { waitUntil: "domcontentloaded" });
  const ledger = page.locator("#accountingExportHistory");
  await expect(ledger.locator("thead")).toContainText("Activity");
  await expect(ledger.locator("tbody tr")).toHaveCount(2);
  await expect(ledger).toContainText("Generated");
  await expect(ledger).toContainText("Portal Smoke Test");
  await expect(ledger).toContainText("Re-downloaded");
  await expect(ledger).toContainText("Darlene Donaher");

  const ledgerRequest = page.waitForRequest((request) =>
    request.method() === "POST" && request.url().includes("/rest/v1/accounting_export_downloads")
  );
  const downloadEvent = page.waitForEvent("download");
  await ledger.locator("[data-redownload-export]").first().click();
  const [request] = await Promise.all([ledgerRequest, downloadEvent]);
  expect(request.postDataJSON()).toEqual({
    export_id: exportId,
    downloaded_by: fakeUser.id
  });
  await expect(page.locator("#accountingNotice")).toContainText("recorded in the Export Ledger");
  await expect(ledger.locator("tbody tr")).toHaveCount(3);
  await expectNoRuntimeErrors(errors, "Accounting Export Ledger re-download tracking");
});

test("Accounting workbook uses the requested sheets, Summary columns, and last-name order", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile, { accountingEnabled: false });
  await page.goto("/accounting-admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.JgcAccountingWorkbook && window.ExcelJS);

  const workbookLayout = await page.evaluate(async () => {
    const template = new ExcelJS.Workbook();
    ["Aug 8", "Jobs Week 1", "Aug 15", "Jobs Week 2", "Summary", "Pay Period"]
      .forEach((name) => template.addWorksheet(name));
    const templateBuffer = await template.xlsx.writeBuffer();
    let binary = "";
    new Uint8Array(templateBuffer).forEach((byte) => { binary += String.fromCharCode(byte); });

    const exportResult = await JgcAccountingWorkbook.build({
      templateBase64: btoa(binary),
      exportedBy: "Portal Smoke Test",
      data: {
        payDate: "2026-08-20",
        weekOneStart: "2026-08-02",
        weekOneEnd: "2026-08-08",
        weekTwoStart: "2026-08-09",
        weekTwoEnd: "2026-08-15",
        employees: [
          { profileId: "employee-one", name: "Stewart Thompson" },
          { profileId: "employee-two", name: "Leo Dorie" }
        ],
        entries: [
          { profileId: "employee-one", workerName: "Stewart Thompson", workDate: "2026-08-03", dayOfWeek: "Monday", entryType: "work", sourceJobNumber: "", sourceJobName: "Shop - tree watering", jobId: null, shiftType: "day", hours: 2 },
          { profileId: "employee-one", workerName: "Stewart Thompson", workDate: "2026-08-04", dayOfWeek: "Tuesday", entryType: "work", sourceJobNumber: "", sourceJobName: "Shop - clean up", jobId: null, shiftType: "day", hours: 3 },
          { profileId: "employee-two", workerName: "Leo Dorie", workDate: "2026-08-05", dayOfWeek: "Wednesday", entryType: "work", sourceJobNumber: "", sourceJobName: "Jeff Shop", jobId: null, shiftType: "day", hours: 4 },
          { profileId: "employee-one", workerName: "Stewart Thompson", workDate: "2026-08-06", dayOfWeek: "Thursday", entryType: "work", sourceJobNumber: "26074", sourceJobName: "Shop JGC", jobId: "job-26074", shiftType: "day", hours: 5 }
        ],
        jobs: [{ id: "job-26074", job_number: "26074", job_name: "Shop JGC", active: true }],
        rates: [
          { id: "rate-one", profile_id: "employee-one", regular_rate: 28, overtime_multiplier: 1.5, night_premium: 3, effective_from: "2026-07-30" },
          { id: "rate-two", profile_id: "employee-two", regular_rate: 27, overtime_multiplier: 1.5, night_premium: 3, effective_from: "2026-07-30" }
        ],
        inputs: {},
        submissions: []
      }
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportResult.buffer);
    const employeeNames = ["Leo Dorie", "Stewart Thompson"];
    const namesInColumn = (sheetName) => workbook.getWorksheet(sheetName).getColumn(1).values
      .filter((value) => employeeNames.includes(value));
    const summarySheet = workbook.getWorksheet("Summary");
    const describeFormula = (address) => {
      const value = summarySheet.getCell(address).value;
      return value && typeof value === "object" ? value.formula : "";
    };
    return {
      sheetNames: workbook.worksheets.map((sheet) => sheet.name),
      jobHeaders: workbook.getWorksheet("Jobs Week 1").getColumn(1).values
        .filter((value) => typeof value === "string"),
      weekOneEmployees: namesInColumn("Aug 8"),
      weekTwoEmployees: namesInColumn("Aug 15"),
      jobEmployees: namesInColumn("Jobs Week 1"),
      summaryEmployees: namesInColumn("Summary").filter((value, index, values) => index === 0 || value !== values[index - 1]),
      summaryHeaders: summarySheet.getRow(4).values.slice(1, 14),
      summaryAdjustmentWidth: summarySheet.getColumn(11).width,
      summaryExtraHeader: summarySheet.getCell("N4").value,
      summaryGrossFormula: describeFormula("J5"),
      summaryBalanceFormula: describeFormula("M5")
    };
  });

  expect(workbookLayout.sheetNames).toEqual(["Aug 8", "Jobs Week 1", "Aug 15", "Jobs Week 2", "Summary", "Pay Period"]);
  expect(workbookLayout.jobHeaders.filter((value) => value === "Shop")).toHaveLength(1);
  expect(workbookLayout.jobHeaders.filter((value) => value === "Shop JGC 26074")).toHaveLength(1);
  expect(workbookLayout.jobHeaders).not.toContain("Shop - tree watering");
  expect(workbookLayout.jobHeaders).not.toContain("Shop - clean up");
  expect(workbookLayout.jobHeaders).not.toContain("Jeff Shop");
  expect(workbookLayout.jobHeaders).not.toContain("Overtime hours to be allocated to a job");
  expect(workbookLayout.weekOneEmployees).toEqual(["Leo Dorie", "Stewart Thompson"]);
  expect(workbookLayout.weekTwoEmployees).toEqual(["Leo Dorie", "Stewart Thompson"]);
  expect(workbookLayout.jobEmployees).toEqual(["Leo Dorie", "Stewart Thompson", "Stewart Thompson"]);
  expect(workbookLayout.summaryEmployees).toEqual(["Leo Dorie", "Stewart Thompson"]);
  expect(workbookLayout.summaryHeaders).toEqual([
    "Employee", "Type", "Total Hrs", "Week 1 Hrs", "Rate", "Week 1 Gross", "Week 2 Hrs",
    "Week 2 Gross", "Stat Pay", "Gross", "Adjustment", "VP", "To Balance"
  ]);
  expect(workbookLayout.summaryAdjustmentWidth).toBeLessThanOrEqual(10);
  expect(workbookLayout.summaryExtraHeader).toBeNull();
  expect(workbookLayout.summaryGrossFormula).toBe("F5+H5+I5");
  expect(workbookLayout.summaryBalanceFormula).toBe("J5+K5+L5");
  await expectNoRuntimeErrors(errors, "Accounting workbook layout and sorting");
});

test("Accounting night premiums do not inflate worked-hour totals", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile, { accountingEnabled: false });
  await page.goto("/accounting-admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.JgcAccountingWorkbook && window.ExcelJS);

  const workbookNightHours = await page.evaluate(async () => {
    const template = new ExcelJS.Workbook();
    ["Aug 8", "Jobs Week 1", "Aug 15", "Jobs Week 2", "Summary", "Pay Period"]
      .forEach((name) => template.addWorksheet(name));
    const templateBuffer = await template.xlsx.writeBuffer();
    let binary = "";
    new Uint8Array(templateBuffer).forEach((byte) => { binary += String.fromCharCode(byte); });

    const exportResult = await JgcAccountingWorkbook.build({
      templateBase64: btoa(binary),
      exportedBy: "Portal Smoke Test",
      data: {
        payDate: "2026-08-20",
        weekOneStart: "2026-08-02",
        weekOneEnd: "2026-08-08",
        weekTwoStart: "2026-08-09",
        weekTwoEnd: "2026-08-15",
        employees: [{ profileId: "employee-one", name: "Steven Leduc" }],
        entries: [{
          profileId: "employee-one",
          workerName: "Steven Leduc",
          workDate: "2026-08-04",
          dayOfWeek: "Tuesday",
          entryType: "work",
          sourceJobNumber: "26090",
          sourceJobName: "Cornwall Courthouse - Access Panel Install",
          jobId: "job-26090",
          shiftType: "night",
          hours: 8
        }],
        jobs: [{ id: "job-26090", job_number: "26090", job_name: "Cornwall Courthouse - Access Panel Install", active: true }],
        rates: [{ id: "rate-one", profile_id: "employee-one", regular_rate: 30, overtime_multiplier: 1.5, night_premium: 3, effective_from: "2026-07-30" }],
        inputs: {},
        submissions: []
      }
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportResult.buffer);
    const summary = workbook.getWorksheet("Summary");
    const weekOne = workbook.getWorksheet("Aug 8");
    const jobsWeekOne = workbook.getWorksheet("Jobs Week 1");
    const describe = (cell) => ({
      value: cell.value,
      formula: cell.value && typeof cell.value === "object" ? cell.value.formula : "",
      result: cell.value && typeof cell.value === "object" ? cell.value.result : cell.value
    });
    return {
      bytes: Array.from(new Uint8Array(exportResult.buffer)),
      snapshotWorkedHours: exportResult.snapshot.totals.hours,
      regularTotalHours: describe(summary.getCell("C5")),
      nightPremiumTotalHours: describe(summary.getCell("C7")),
      nightPremiumWeekOneHours: describe(summary.getCell("D7")),
      summaryWorkedHours: describe(summary.getCell("C9")),
      summaryWeekOneWorkedHours: describe(summary.getCell("D9")),
      summaryGross: describe(summary.getCell("J9")),
      weekRegularHours: describe(weekOne.getCell("J6")),
      weekNightPremiumTuesday: describe(weekOne.getCell("E9")),
      weekNightPremiumHours: describe(weekOne.getCell("J9")),
      weekEmployeeTotal: describe(weekOne.getCell("M9")),
      weekNightJobLabel: weekOne.getCell("A5").value,
      jobNightEmployeeLabel: jobsWeekOne.getCell("A3").value,
      jobNightHours: describe(jobsWeekOne.getCell("D3")),
      jobNightTotalHours: describe(jobsWeekOne.getCell("I3")),
      jobRegularRate: describe(jobsWeekOne.getCell("J3")),
      jobRegularGross: describe(jobsWeekOne.getCell("K3")),
      jobRegularBurden: describe(jobsWeekOne.getCell("L3")),
      jobPremiumLabel: describe(jobsWeekOne.getCell("A4")),
      jobPremiumTotalHours: describe(jobsWeekOne.getCell("I4")),
      jobPremiumRate: describe(jobsWeekOne.getCell("J4")),
      jobPremiumGross: describe(jobsWeekOne.getCell("K4")),
      jobPremiumBurden: describe(jobsWeekOne.getCell("L4")),
      jobGrossTotal: describe(jobsWeekOne.getCell("K5")),
      jobBurdenTotal: describe(jobsWeekOne.getCell("L5")),
      jobWorkbookTotal: describe(jobsWeekOne.getCell("M8"))
    };
  });

  if (process.env.JGC_ACCOUNTING_NIGHT_HOURS_OUTPUT) {
    fs.mkdirSync(path.dirname(process.env.JGC_ACCOUNTING_NIGHT_HOURS_OUTPUT), { recursive: true });
    fs.writeFileSync(process.env.JGC_ACCOUNTING_NIGHT_HOURS_OUTPUT, Buffer.from(workbookNightHours.bytes));
  }

  expect(workbookNightHours.snapshotWorkedHours).toBe(8);
  expect(workbookNightHours.regularTotalHours.formula).toBe("D5+G5");
  expect(workbookNightHours.regularTotalHours.result).toBe(8);
  expect(workbookNightHours.nightPremiumTotalHours.value).toBeNull();
  expect(workbookNightHours.nightPremiumWeekOneHours.formula).toBe("'Aug 8'!J9");
  expect(workbookNightHours.nightPremiumWeekOneHours.result).toBe(8);
  expect(workbookNightHours.summaryWorkedHours.formula).toBe('SUMIF($B$5:$B$7,"Regular",C5:C7)');
  expect(workbookNightHours.summaryWorkedHours.result).toBe(8);
  expect(workbookNightHours.summaryWeekOneWorkedHours.formula).toBe('SUMIF($B$5:$B$7,"Regular",D5:D7)');
  expect(workbookNightHours.summaryWeekOneWorkedHours.result).toBe(8);
  expect(workbookNightHours.weekRegularHours.result).toBe(8);
  expect(workbookNightHours.weekNightPremiumTuesday.formula).toBe("SUM(E5)");
  expect(workbookNightHours.weekNightPremiumTuesday.result).toBe(8);
  expect(workbookNightHours.weekNightPremiumHours.result).toBe(8);
  expect(workbookNightHours.weekEmployeeTotal.result).toBe(264);
  expect(workbookNightHours.summaryGross.result).toBe(264);
  expect(workbookNightHours.weekNightJobLabel).toBe("Cornwall Courthouse - Access Panel Install 26090 - Night");
  expect(workbookNightHours.jobNightEmployeeLabel).toBe("Steven Leduc - Night");
  expect(workbookNightHours.jobNightHours.formula).toBe("'Aug 8'!E5");
  expect(workbookNightHours.jobNightHours.result).toBe(8);
  expect(workbookNightHours.jobNightTotalHours.result).toBe(8);
  expect(workbookNightHours.jobRegularRate.result).toBe(30);
  expect(workbookNightHours.jobRegularGross.result).toBe(240);
  expect(workbookNightHours.jobRegularBurden.result).toBe(336);
  expect(workbookNightHours.jobPremiumLabel.formula).toContain("Night Premium");
  expect(workbookNightHours.jobPremiumLabel.result).toBe("Steven Leduc - Night Premium (8.00 hrs)");
  expect(workbookNightHours.jobPremiumTotalHours.value).toBeNull();
  expect(workbookNightHours.jobPremiumRate.formula).toBe("'Aug 8'!K9");
  expect(workbookNightHours.jobPremiumRate.result).toBe(3);
  expect(workbookNightHours.jobPremiumGross.formula).toBe("'Aug 8'!J5*J4");
  expect(workbookNightHours.jobPremiumGross.result).toBe(24);
  expect(workbookNightHours.jobPremiumBurden.result).toBeCloseTo(33.6, 6);
  expect(workbookNightHours.jobGrossTotal.formula).toBe("SUM(K3:K4)");
  expect(workbookNightHours.jobGrossTotal.result).toBe(264);
  expect(workbookNightHours.jobBurdenTotal.result).toBeCloseTo(369.6, 6);
  expect(workbookNightHours.jobWorkbookTotal.result).toBe(264);
  await expectNoRuntimeErrors(errors, "Accounting night premium hours");
});

test("Accounting overtime premiums reconcile across payroll, job allocation, and Summary, and both weeks", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile, { accountingEnabled: false });
  await page.goto("/accounting-admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.JgcAccountingWorkbook && window.ExcelJS);

  const workbookAudit = await page.evaluate(async () => {
    const template = new ExcelJS.Workbook();
    ["Aug 8", "Jobs Week 1", "Aug 15", "Jobs Week 2", "Summary", "Pay Period"]
      .forEach((name) => template.addWorksheet(name));
    const templateBuffer = await template.xlsx.writeBuffer();
    let binary = "";
    new Uint8Array(templateBuffer).forEach((byte) => { binary += String.fromCharCode(byte); });

    const entry = (workDate, dayOfWeek, hours, shiftType = "day") => ({
      profileId: "employee-one",
      workerName: "Andre Labrosse",
      workDate,
      dayOfWeek,
      entryType: "work",
      sourceJobNumber: "26074",
      sourceJobName: "Shop JGC",
      jobId: "job-26074",
      shiftType,
      hours
    });
    const exportResult = await JgcAccountingWorkbook.build({
      templateBase64: btoa(binary),
      exportedBy: "Portal Smoke Test",
      data: {
        payDate: "2026-09-03",
        weekOneStart: "2026-08-16",
        weekOneEnd: "2026-08-22",
        weekTwoStart: "2026-08-23",
        weekTwoEnd: "2026-08-29",
        employees: [{ profileId: "employee-one", name: "Andre Labrosse" }],
        entries: [
          entry("2026-08-16", "Sunday", 8),
          entry("2026-08-17", "Monday", 8),
          entry("2026-08-18", "Tuesday", 10, "night"),
          entry("2026-08-19", "Wednesday", 8, "night"),
          entry("2026-08-20", "Thursday", 8),
          entry("2026-08-21", "Friday", 8),
          entry("2026-08-22", "Saturday", 8),
          entry("2026-08-23", "Sunday", 8),
          entry("2026-08-24", "Monday", 8),
          entry("2026-08-25", "Tuesday", 8),
          entry("2026-08-26", "Wednesday", 8),
          entry("2026-08-27", "Thursday", 8),
          entry("2026-08-28", "Friday", 8)
        ],
        jobs: [{ id: "job-26074", job_number: "26074", job_name: "Shop JGC", active: true }],
        rates: [{ id: "rate-one", profile_id: "employee-one", regular_rate: 32, overtime_multiplier: 1.5, night_premium: 3, effective_from: "2026-08-01" }],
        inputs: {},
        submissions: []
      }
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportResult.buffer);
    const describe = (cell) => ({
      value: cell.value,
      formula: cell.value && typeof cell.value === "object" ? cell.value.formula : "",
      result: cell.value && typeof cell.value === "object" ? cell.value.result : cell.value,
      fill: cell.fill && cell.fill.fgColor ? cell.fill.fgColor.argb : "",
      fontColor: cell.font && cell.font.color ? cell.font.color.argb : ""
    });
    const findRow = (sheet, label) => {
      for (let row = 1; row <= sheet.rowCount; row += 1) {
        if (sheet.getCell(row, 1).value === label) return row;
      }
      return 0;
    };
    const lastFormulaCell = (sheet, column) => {
      for (let row = sheet.rowCount; row >= 1; row -= 1) {
        const value = sheet.getCell(row, column).value;
        if (value && typeof value === "object" && value.formula) return sheet.getCell(row, column);
      }
      return sheet.getCell(1, column);
    };

    const weekOne = workbook.getWorksheet("Aug 22");
    const weekTwo = workbook.getWorksheet("Aug 29");
    const jobsWeekOne = workbook.getWorksheet("Jobs Week 1");
    const jobsWeekTwo = workbook.getWorksheet("Jobs Week 2");
    const summary = workbook.getWorksheet("Summary");
    const payPeriod = workbook.getWorksheet("Pay Period");
    const weekOneOvertimeRow = findRow(weekOne, "Overtime - Hours over 44");
    const weekTwoOvertimeRow = findRow(weekTwo, "Overtime - Hours over 44");
    const jobsWeekOneOvertimeRow = findRow(jobsWeekOne, "Overtime hours to be allocated to a job");
    const jobsWeekTwoOvertimeRow = findRow(jobsWeekTwo, "Overtime hours to be allocated to a job");
    const jobsWeekOneOvertimeTotalRow = findRow(jobsWeekOne, "Overtime premium total");
    const jobsWeekTwoOvertimeTotalRow = findRow(jobsWeekTwo, "Overtime premium total");

    const formulaProblems = [];
    const circularReferences = [];
    const mockupCells = [];
    let formulaCount = 0;
    const columnNumber = (letters) => String(letters).split("").reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          const value = cell.value;
          const formula = value && typeof value === "object" ? String(value.formula || "") : "";
          const result = value && typeof value === "object" ? value.result : value;
          if (formula.includes("#REF!") || ["#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A"].includes(String(result))) {
            formulaProblems.push(`${sheet.name}!${cell.address}`);
          }
          if (formula) {
            formulaCount += 1;
            const ownMatch = cell.address.match(/^([A-Z]+)(\d+)$/);
            const ownColumn = columnNumber(ownMatch[1]);
            const ownRow = Number(ownMatch[2]);
            let localFormula = formula.replace(/'(?:[^']|'')+'!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g, "");
            let isCircular = false;
            localFormula = localFormula.replace(/\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)/g, (match, firstColumn, firstRow, lastColumn, lastRow) => {
              const left = Math.min(columnNumber(firstColumn), columnNumber(lastColumn));
              const right = Math.max(columnNumber(firstColumn), columnNumber(lastColumn));
              const top = Math.min(Number(firstRow), Number(lastRow));
              const bottom = Math.max(Number(firstRow), Number(lastRow));
              if (ownColumn >= left && ownColumn <= right && ownRow >= top && ownRow <= bottom) isCircular = true;
              return "";
            });
            for (const match of localFormula.matchAll(/\$?([A-Z]{1,3})\$?(\d+)/g)) {
              if (columnNumber(match[1]) === ownColumn && Number(match[2]) === ownRow) isCircular = true;
            }
            if (isCircular) circularReferences.push(`${sheet.name}!${cell.address}`);
          }
          const visible = value && typeof value === "object" ? `${value.formula || ""} ${value.result || ""}` : String(value || "");
          if (/mockup/i.test(visible)) mockupCells.push(`${sheet.name}!${cell.address}`);
        });
      });
    });

    return {
      bytes: Array.from(new Uint8Array(exportResult.buffer)),
      fileName: exportResult.fileName,
      mockupCells,
      formulaProblems,
      circularReferences,
      formulaCount,
      snapshot: exportResult.snapshot,
      weekOneOvertimeHours: describe(weekOne.getCell(weekOneOvertimeRow, 10)),
      weekOneOvertimeRate: describe(weekOne.getCell(weekOneOvertimeRow, 11)),
      weekOneOvertimeGross: describe(weekOne.getCell(weekOneOvertimeRow, 12)),
      weekOneTotal: describe(lastFormulaCell(weekOne, 13)),
      weekTwoOvertimeHours: describe(weekTwo.getCell(weekTwoOvertimeRow, 10)),
      weekTwoOvertimeRate: describe(weekTwo.getCell(weekTwoOvertimeRow, 11)),
      weekTwoOvertimeGross: describe(weekTwo.getCell(weekTwoOvertimeRow, 12)),
      weekTwoTotal: describe(lastFormulaCell(weekTwo, 13)),
      jobsWeekOneOvertimeTitle: describe(jobsWeekOne.getCell(jobsWeekOneOvertimeRow, 1)),
      jobsWeekOneOvertimeGross: describe(jobsWeekOne.getCell(jobsWeekOneOvertimeTotalRow, 11)),
      jobsWeekOneTotal: describe(lastFormulaCell(jobsWeekOne, 13)),
      jobsWeekTwoOvertimeTitle: describe(jobsWeekTwo.getCell(jobsWeekTwoOvertimeRow, 1)),
      jobsWeekTwoOvertimeGross: describe(jobsWeekTwo.getCell(jobsWeekTwoOvertimeTotalRow, 11)),
      jobsWeekTwoTotal: describe(lastFormulaCell(jobsWeekTwo, 13)),
      summaryRegularHours: describe(summary.getCell("C5")),
      summaryOvertimeHours: describe(summary.getCell("C6")),
      summaryNightHours: describe(summary.getCell("C7")),
      summaryWeekOneOvertimeHours: describe(summary.getCell("D6")),
      summaryWeekOneOvertimeGross: describe(summary.getCell("F6")),
      summaryWeekTwoOvertimeHours: describe(summary.getCell("G6")),
      summaryWeekTwoOvertimeGross: describe(summary.getCell("H6")),
      summaryTotalHours: describe(summary.getCell("C9")),
      summaryWeekOneGross: describe(summary.getCell("F9")),
      summaryWeekTwoGross: describe(summary.getCell("H9")),
      summaryGross: describe(summary.getCell("J9")),
      payPeriodWeekOneEnd: describe(payPeriod.getCell("B5")),
      payPeriodWeekTwoEnd: describe(payPeriod.getCell("B6")),
      payPeriodNextPayDate: describe(payPeriod.getCell("B8")),
      burdenFormula: describe(jobsWeekOne.getCell(3, 12))
    };
  });

  if (process.env.JGC_ACCOUNTING_OVERTIME_OUTPUT) {
    fs.mkdirSync(path.dirname(process.env.JGC_ACCOUNTING_OVERTIME_OUTPUT), { recursive: true });
    fs.writeFileSync(process.env.JGC_ACCOUNTING_OVERTIME_OUTPUT, Buffer.from(workbookAudit.bytes));
  }

  expect(workbookAudit.fileName).toBe("JGC Payroll - Aug 16, 2026 to Aug 29, 2026.xlsx");
  expect(workbookAudit.fileName).not.toMatch(/mockup/i);
  expect(workbookAudit.mockupCells).toEqual([]);
  expect(workbookAudit.formulaProblems).toEqual([]);
  expect(workbookAudit.circularReferences).toEqual([]);
  expect(workbookAudit.formulaCount).toBeGreaterThan(40);
  expect(workbookAudit.snapshot.version).toBe(2);
  expect(workbookAudit.snapshot.totals.hours).toBe(106);
  expect(workbookAudit.snapshot.totals.gross).toBe(3734);

  expect(workbookAudit.weekOneOvertimeHours.formula).toContain("MAX(0,");
  expect(workbookAudit.weekOneOvertimeHours.result).toBe(14);
  expect(workbookAudit.weekOneOvertimeRate.result).toBe(16);
  expect(workbookAudit.weekOneOvertimeRate.fill).toMatch(/FFF2CC$/);
  expect(workbookAudit.weekOneOvertimeRate.fontColor).not.toMatch(/0000FF$/);
  expect(workbookAudit.weekOneOvertimeGross.result).toBe(224);
  expect(workbookAudit.weekOneTotal.result).toBe(2134);
  expect(workbookAudit.weekTwoOvertimeHours.result).toBe(4);
  expect(workbookAudit.weekTwoOvertimeRate.result).toBe(16);
  expect(workbookAudit.weekTwoOvertimeGross.result).toBe(64);
  expect(workbookAudit.weekTwoTotal.result).toBe(1600);

  expect(workbookAudit.jobsWeekOneOvertimeTitle.fill).toMatch(/9C0006$/);
  expect(workbookAudit.jobsWeekOneOvertimeGross.result).toBe(224);
  expect(workbookAudit.jobsWeekOneTotal.result).toBe(workbookAudit.weekOneTotal.result);
  expect(workbookAudit.jobsWeekTwoOvertimeTitle.fill).toMatch(/9C0006$/);
  expect(workbookAudit.jobsWeekTwoOvertimeGross.result).toBe(64);
  expect(workbookAudit.jobsWeekTwoTotal.result).toBe(workbookAudit.weekTwoTotal.result);

  expect(workbookAudit.summaryRegularHours.result).toBe(106);
  expect(workbookAudit.summaryOvertimeHours.value).toBeNull();
  expect(workbookAudit.summaryNightHours.value).toBeNull();
  expect(workbookAudit.summaryWeekOneOvertimeHours.result).toBe(14);
  expect(workbookAudit.summaryWeekOneOvertimeGross.result).toBe(224);
  expect(workbookAudit.summaryWeekTwoOvertimeHours.result).toBe(4);
  expect(workbookAudit.summaryWeekTwoOvertimeGross.result).toBe(64);
  expect(workbookAudit.summaryTotalHours.formula).toContain('"Regular"');
  expect(workbookAudit.summaryTotalHours.result).toBe(106);
  expect(workbookAudit.summaryWeekOneGross.result).toBe(2134);
  expect(workbookAudit.summaryWeekTwoGross.result).toBe(1600);
  expect(workbookAudit.summaryGross.result).toBe(3734);

  expect(workbookAudit.payPeriodWeekOneEnd.formula).toBe("B3-12");
  expect(workbookAudit.payPeriodWeekTwoEnd.formula).toBe("B3-5");
  expect(workbookAudit.payPeriodNextPayDate.formula).toBe("B3+14");
  expect(workbookAudit.burdenFormula.formula).toContain("'Pay Period'!$B$17");
  await expectNoRuntimeErrors(errors, "Accounting overtime workbook reconciliation");
});

test("Accounting highlights a single timesheet entry over 12 hours", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile, {
    accountingEnabled: false,
    accountingLongEntry: true
  });

  await page.goto("/accounting-admin.html", { waitUntil: "domcontentloaded" });
  const warningCell = page.locator("#accountingEmployeeReview td.accounting-hours-warning");
  await expect(warningCell).toHaveCount(1);
  await expect(warningCell).toHaveText("13.00");
  await expect(warningCell).toHaveAttribute("title", /more than 12 hours/i);
  const warningStyle = await warningCell.evaluate((cell) => ({
    background: getComputedStyle(cell).backgroundColor,
    color: getComputedStyle(cell).color,
    weight: getComputedStyle(cell).fontWeight,
    dangerToken: (() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--jgc-color-danger-dark)";
      document.body.appendChild(probe);
      const resolved = getComputedStyle(probe).color;
      probe.remove();
      return resolved;
    })()
  }));
  expect(warningStyle.background).toBe(warningStyle.dangerToken);
  expect(warningStyle.color).toBe("rgb(255, 255, 255)");
  expect(Number(warningStyle.weight)).toBeGreaterThanOrEqual(700);

  await page.waitForFunction(() => window.JgcAccountingWorkbook && window.ExcelJS);
  const workbookWarnings = await page.evaluate(async () => {
    const template = new ExcelJS.Workbook();
    ["Aug 8", "Jobs Week 1", "Aug 15", "Jobs Week 2", "Summary", "Pay Period"]
      .forEach((name) => template.addWorksheet(name));
    const templateBuffer = await template.xlsx.writeBuffer();
    let binary = "";
    new Uint8Array(templateBuffer).forEach((byte) => { binary += String.fromCharCode(byte); });

    const exportResult = await JgcAccountingWorkbook.build({
      templateBase64: btoa(binary),
      exportedBy: "Portal Smoke Test",
      data: {
        payDate: "2026-08-20",
        weekOneStart: "2026-08-02",
        weekOneEnd: "2026-08-08",
        weekTwoStart: "2026-08-09",
        weekTwoEnd: "2026-08-15",
        employees: [{ profileId: "employee-one", name: "Steven Leduc" }],
        entries: [
          { profileId: "employee-one", workerName: "Steven Leduc", workDate: "2026-08-04", dayOfWeek: "Tuesday", entryType: "work", sourceJobNumber: "25169", sourceJobName: "McKay Mechanical Long Office Addition and Interior Renovation Project", jobId: "job-25169", shiftType: "day", hours: 13 },
          { profileId: "employee-one", workerName: "Steven Leduc", workDate: "2026-08-05", dayOfWeek: "Wednesday", entryType: "work", sourceJobNumber: "25169", sourceJobName: "McKay Mechanical Long Office Addition and Interior Renovation Project", jobId: "job-25169", shiftType: "day", hours: 8 },
          { profileId: "employee-one", workerName: "Steven Leduc", workDate: "2026-08-11", dayOfWeek: "Tuesday", entryType: "work", sourceJobNumber: "25169", sourceJobName: "McKay Mechanical Long Office Addition and Interior Renovation Project", jobId: "job-25169", shiftType: "day", hours: 7 }
        ],
        jobs: [{ id: "job-25169", job_number: "25169", job_name: "McKay Mechanical Long Office Addition and Interior Renovation Project", active: true }],
        rates: [{ id: "rate-one", profile_id: "employee-one", regular_rate: 30, overtime_multiplier: 1.5, night_premium: 3, effective_from: "2026-07-30" }],
        inputs: {},
        submissions: []
      }
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportResult.buffer);
    const describe = (cell) => ({
      value: cell.value,
      formula: cell.value && typeof cell.value === "object" ? cell.value.formula : "",
      result: cell.value && typeof cell.value === "object" ? cell.value.result : cell.value,
      fill: cell.fill && cell.fill.fgColor ? cell.fill.fgColor.argb : "",
      fontColor: cell.font && cell.font.color ? cell.font.color.argb : "",
      bold: Boolean(cell.font && cell.font.bold)
    });
    return {
      employeeDay: describe(workbook.getWorksheet("Aug 8").getCell("E5")),
      employeeNormalDay: describe(workbook.getWorksheet("Aug 8").getCell("F5")),
      jobDay: describe(workbook.getWorksheet("Jobs Week 1").getCell("D3")),
      jobRate: describe(workbook.getWorksheet("Jobs Week 1").getCell("J3")),
      secondWeekJobDay: describe(workbook.getWorksheet("Jobs Week 2").getCell("D3")),
      summaryWeekOneHours: describe(workbook.getWorksheet("Summary").getCell("D5")),
      summaryWeekTwoHours: describe(workbook.getWorksheet("Summary").getCell("G5")),
      summaryGross: describe(workbook.getWorksheet("Summary").getCell("J5")),
      summarySettings: workbook.getWorksheet("Summary").getCell("H13").value,
      summarySettingsWidth: workbook.getWorksheet("Summary").getColumn(8).width,
      weekJobColumnWidth: workbook.getWorksheet("Aug 8").getColumn(1).width,
      weekJobWrap: Boolean(workbook.getWorksheet("Aug 8").getCell("A5").alignment.wrapText),
      weekJobRowHeight: workbook.getWorksheet("Aug 8").getRow(5).height
    };
  });

  expect(workbookWarnings.employeeDay.value).toBe(13);
  expect(workbookWarnings.employeeDay.fill).toMatch(/8F1D1D$/);
  expect(workbookWarnings.employeeDay.fontColor).toMatch(/FFFFFF$/);
  expect(workbookWarnings.employeeDay.bold).toBe(true);
  expect(workbookWarnings.jobDay.formula).toBe("'Aug 8'!E5");
  expect(workbookWarnings.jobDay.result).toBe(13);
  expect(workbookWarnings.jobDay.fill).toMatch(/8F1D1D$/);
  expect(workbookWarnings.jobDay.fontColor).toMatch(/FFFFFF$/);
  expect(workbookWarnings.jobDay.bold).toBe(true);
  expect(workbookWarnings.jobRate.formula).toBe("'Aug 8'!K5");
  expect(workbookWarnings.jobRate.result).toBe(30);
  expect(workbookWarnings.secondWeekJobDay.formula).toBe("'Aug 15'!E5");
  expect(workbookWarnings.secondWeekJobDay.result).toBe(7);
  expect(workbookWarnings.summaryWeekOneHours.formula).toBe("'Aug 8'!J6");
  expect(workbookWarnings.summaryWeekTwoHours.formula).toBe("'Aug 15'!J6");
  expect(workbookWarnings.summaryGross.formula).toBe("F5+H5+I5");
  expect(workbookWarnings.summarySettings).toBe("Simple Settings");
  expect(workbookWarnings.summarySettingsWidth).toBeGreaterThanOrEqual(18);
  expect(workbookWarnings.weekJobColumnWidth).toBeGreaterThanOrEqual(42);
  expect(workbookWarnings.weekJobWrap).toBe(true);
  expect(workbookWarnings.weekJobRowHeight).toBeGreaterThan(18);
  expect(workbookWarnings.employeeNormalDay.value).toBe(8);
  expect(workbookWarnings.employeeNormalDay.fill).not.toMatch(/8F1D1D$/);
  await expectNoRuntimeErrors(errors, "Accounting long entry warning");
});

test("Accounting blocks final lock and can fill a missing employee week", async ({ page }) => {
  const errors = watchRuntimeErrors(page, "accept");
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile, {
    accountingEnabled: false,
    missingAccountingSecondWeek: true,
    accountingLiveEntries: [{
      id: "00000000-0000-4000-8000-000000000081",
      profile_id: "00000000-0000-4000-8000-000000000002",
      worker_name: "Steven Leduc",
      week_start: "2026-08-09",
      day_of_week: "Monday",
      entry_type: "work",
      hours: 8
    }]
  });

  await page.goto("/accounting-admin.html", { waitUntil: "domcontentloaded" });
  await page.locator("#accountingPayDate").evaluate((input) => {
    input.value = "2026-08-20";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("#accountingDownloadFinal")).toBeDisabled();
  await expect(page.locator("#accountingValidation")).toContainText("1 expected submission missing");
  await page.locator("[data-open-missing-submissions]").click();
  await expect(page.locator("#accountingMissingPanel")).toHaveAttribute("open", "");
  await expect(page.locator("#accountingMissingList")).toContainText("Steven Leduc");
  await expect(page.locator("#accountingMissingList .accounting-weekday.is-complete")).toHaveCount(1);
  await expect(page.locator("#accountingMissingList [data-fill-day]")).toHaveCount(4);
  await page.locator("#accountingMissingList [data-leave-mode]").selectOption("civic_holiday");
  await page.locator("#accountingMissingList [data-leave-note]").fill("Christmas shutdown");

  const requestPromise = page.waitForRequest((request) => request.url().includes("/rest/v1/rpc/accounting_autofill_leave_timesheet"));
  await page.locator("#accountingMissingList [data-submit-missing-timesheet]").click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toMatchObject({
    p_profile_id: "00000000-0000-4000-8000-000000000002",
    p_week_start: "2026-08-09",
    p_days: ["Tuesday", "Wednesday", "Thursday", "Friday"],
    p_entry_type: "civic_holiday",
    p_leave_type: "",
    p_note: "Christmas shutdown"
  });
  await expect(page.locator("#accountingNotice")).toContainText("submitted to timesheet history and Accounting");
  await expectNoRuntimeErrors(errors, "Accounting missing timesheet auto-fill");
});

test("Accounting job exceptions use a typable job picker", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile, {
    accountingEnabled: false,
    accountingUnmatchedEntry: true
  });

  await page.goto("/accounting-admin.html", { waitUntil: "domcontentloaded" });
  const jobInput = page.locator("#accountingJobExceptions [data-entry-job-input]");
  await expect(jobInput).toHaveCount(1);
  await expect(jobInput).toHaveAttribute("list", "accountingJobChoices");
  await expect(page.locator("#accountingJobChoices option").nth(1)).toHaveAttribute("value", "25169 - McKay Office Addition");
  await jobInput.fill("McKay");
  await expect(jobInput).toHaveValue("McKay");
  await jobInput.fill("25169");

  const requestPromise = page.waitForRequest((request) => request.method() === "PATCH" && request.url().includes("/rest/v1/accounting_time_entries"));
  await page.locator("#accountingJobExceptions [data-match-entry]").click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toMatchObject({
    job_id: "00000000-0000-4000-8000-000000000061",
    job_match_status: "manual"
  });
  await expectNoRuntimeErrors(errors, "Accounting typable job picker");
});

test("Accounting loads every job beyond the API page cap and matches an inactive job by number", async ({ page }) => {
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile, { accountingUnmatchedEntry: true });
  const jobs = Array.from({ length: 1102 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, "0")}`,
    job_number: String(25000 + index),
    customer: index === 1101 ? "McKay Mechanical" : "Test client",
    job_name: index === 1101 ? "Ingleside Development" : `Job ${index}`,
    active: index < 600
  }));
  const offsets = [];
  await page.route("**/rest/v1/jobs?**", async route => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get("offset") || 0);
    offsets.push(offset);
    // Simulate a server cap smaller than the requested page size.
    const rows = jobs.slice(offset, offset + 100);
    await route.fulfill({ status: 200, contentType: "application/json",
      headers: { "access-control-expose-headers": "content-range", "content-range": `${offset}-${offset + rows.length - 1}/${jobs.length}` }, body: JSON.stringify(rows) });
  });
  await page.goto("/accounting-admin.html");
  await expect(page.locator("#accountingJobChoices option")).toHaveCount(1103);
  await expect(page.locator("#accountingJobListStatus")).toContainText("1102 jobs available for matching (600 active, 502 inactive)");
  await expect(page.locator("#accountingJobChoices option").last()).toHaveAttribute("value", "26101 - McKay Mechanical - Ingleside Development");
  await expect(page.locator("#accountingJobChoices option").last()).toHaveAttribute("label", "Inactive job");
  expect(offsets).toContain(1100);
  await page.locator("[data-entry-job-input]").fill("26101");
  const saved = page.waitForRequest(request => request.method() === "PATCH" && request.url().includes("/accounting_time_entries"));
  await page.locator("[data-match-entry]").click();
  expect((await saved).postDataJSON()).toMatchObject({ job_id: jobs[1101].id, job_match_status: "manual" });
});

test("Accounting refreshes job choices after a saved job without clearing work in progress", async ({ page }) => {
  await page.clock.install();
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile, { accountingUnmatchedEntry: true });
  const jobs = [{ id: "00000000-0000-4000-8000-000000000061", job_number: "26109", customer: "McKay Mechanical", job_name: "Snye Seniors", active: false }];
  let fail = false;
  await page.route("**/rest/v1/jobs?**", route => route.fulfill(fail
    ? { status: 400, contentType: "application/json", body: JSON.stringify({ message: "Job-list request failed" }) }
    : { status: 200, contentType: "application/json", headers: { "access-control-expose-headers": "content-range", "content-range": `0-${jobs.length - 1}/${jobs.length}` }, body: JSON.stringify(jobs) }));
  await page.goto("/accounting-admin.html");
  const input = page.locator("[data-entry-job-input]");
  await expect(input).toBeVisible();
  await input.fill("McKay");
  jobs.push({ id: "00000000-0000-4000-8000-000000000062", job_number: "26132", customer: "McKay Mechanical", job_name: "Ingleside Development", active: true });
  await page.evaluate(() => window.dispatchEvent(new Event("jgc-jobs-saved")));
  await expect(page.locator("#accountingJobChoices option")).toHaveCount(3);
  await expect(input).toHaveValue("McKay");
  await expect(page.locator("#accountingJobListStatus")).toContainText("2 jobs available");
  await input.fill("26132 - McKay Mechanical - Ingleside Development");
  const saved = page.waitForRequest(request => request.method() === "PATCH" && request.url().includes("/accounting_time_entries"));
  await page.locator("[data-match-entry]").click();
  expect((await saved).postDataJSON()).toMatchObject({ job_id: jobs[1].id, job_match_status: "manual" });
  await expect(input).toHaveValue("");
  await expect(page.locator("#accountingNotice")).toBeHidden();
  fail = true;
  // Advance past the shared watcher's duplicate-event throttle.
  await page.clock.fastForward(61000);
  await expect(page.locator("#accountingJobListStatus")).toContainText("could not be refreshed");
  await expect(page.locator("#accountingJobChoices option")).toHaveCount(3);
});

test("Accounting employee inclusion does not remove approved admin page access", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile, {
    accountingEnabled: false,
    includeExcludedAccountingSubmission: true
  });

  await page.goto("/admin.html?tab=summary", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-jgc-accounting-access", "enabled");
  await expect(page.locator("[data-jgc-admin-section='accounting']")).toHaveCount(1);

  await page.goto("/accounting-admin.html", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/accounting-admin\.html/);
  await expect(page.locator("#accountingCurrentUser")).toContainText("Portal Smoke Test");
  await expect(page.locator("#accountingMetrics")).toContainText("16.00");
  await expect(page.locator("#accountingEmployeeReview")).not.toContainText("Portal Smoke Test");
  await expectNoRuntimeErrors(errors, "Accounting inclusion independent from admin access");
});

test("work order auto-submit recovers stale claims and bounds email delivery", async () => {
  const source = fs.readFileSync(
    path.join(portalRoot, "supabase", "functions", "auto-submit-work-orders", "index.ts"),
    "utf8"
  );
  const workOrderPage = fs.readFileSync(path.join(portalRoot, "work-orders.html"), "utf8");

  expect(source).toContain("AbortSignal.timeout(WORK_ORDER_EMAIL_TIMEOUT_MS)");
  expect(source).toContain("recoverStaleWorkOrderClaims");
  expect(source).toContain('requestBody?.work_order_id');
  expect(source).toContain('workOrderQuery.eq("id", targetWorkOrderId)');
  expect(source).toContain('.eq("locked", true)');
  expect(source).toContain('.is("submitted_at", null)');
  expect(source).toContain("jgc-work-order-submit-${bundle.wo.id}");
  expect(source).toContain("deferred_for_next_run");
  expect(source).toContain('.in("status", ["draft", "ready_for_submission"])');
  expect(source).toContain('from("digital_po_work_order_links")');
  expect(source).toContain('from("digital_purchase_orders")');
  expect(source).toContain('from("digital_po_items")');
  expect(source).toContain('buildOptionalPdfSection("Digital Purchase Orders", digitalPos');
  expect(workOrderPage).toContain("signal: AbortSignal.timeout(60_000)");
  expect(workOrderPage).toContain('idempotencyKey: "jgc-work-order-submit-" + id');
  expect(workOrderPage).toContain('rpc("digital_po_work_order_options"');
  expect(workOrderPage).toContain('await loadDigitalPoPdfRowsForWorkOrder(bundle.wo)');
  expect(workOrderPage).toContain('buildOptionalPdfSection("Digital Purchase Orders", digitalPos');
});

test("work order PDF includes only the digital POs linked to that work order", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const workOrderId = "00000000-0000-4000-8000-000000000410";
  const jobId = "00000000-0000-4000-8000-000000000411";
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/rpc/digital_po_work_order_options`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([
      {
        id: "00000000-0000-4000-8000-000000000412",
        po_number: 31013,
        supplier_name: "Emard",
        order_date: "2026-08-06",
        material_count: 3,
        workflow_status: "submitted",
        linked_work_order_id: workOrderId
      },
      {
        id: "00000000-0000-4000-8000-000000000413",
        po_number: 31014,
        supplier_name: "Not Linked Supplier",
        order_date: "2026-08-06",
        material_count: 1,
        workflow_status: "submitted",
        linked_work_order_id: null
      }
    ])
  }));

  await page.goto("/work-orders.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.loadDigitalPoPdfRowsForWorkOrder === "function");
  const pdfHtml = await page.evaluate(async ({ workOrderId, jobId }) => {
    workOrders = [{
      id: workOrderId,
      wo_number: "WO25169-018",
      work_order_date: "2026-08-06",
      job_id: jobId,
      job_number: "25169",
      job_name: "McKay Office Addition",
      description_of_work: "Smoke test"
    }];
    await loadDigitalPoPdfRowsForWorkOrder(workOrders[0]);
    return buildWorkOrderPdfHtml(workOrderId);
  }, { workOrderId, jobId });

  expect(pdfHtml).toContain("Digital Purchase Orders");
  expect(pdfHtml).toContain("PO-31013");
  expect(pdfHtml).toContain("Emard");
  expect(pdfHtml).toContain(">3<");
  expect(pdfHtml).not.toContain("PO-31014");
  expect(pdfHtml).not.toContain("Not Linked Supplier");
  await expectNoRuntimeErrors(errors, "linked digital PO PDF output");
});

test("employee page access is a standalone admin tool with all selector permissions", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto("/employee-access-admin.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("h1")).toHaveText("Employee Page Access");
  await expect(page.locator("#employeeAccessRows tr")).toHaveCount(3);
  await expect(page.locator("#employeeAccessHeader th")).toHaveCount(8);
  await expect(page.locator("#employeeAccessRows input[data-worker-feature]")).toHaveCount(21);
  await expect(page.locator("#employeeAccessRows input[data-worker-active]")).toHaveCount(0);
  await expect(page.locator("#employeeAccessRows")).toContainText(fakeProfile.display_name);
  await expect(page.locator("#employeeAccessRows")).toContainText("Steven Leduc");
  const manualRow = page.locator("#employeeAccessRows tr", { hasText: "Temporary Worker" });
  const manualWorkOrders = manualRow.locator('[data-feature-key="work_orders"]');
  await expect(manualWorkOrders).toBeDisabled();
  await expect(manualWorkOrders).not.toBeChecked();
  await expect(manualRow).toContainText("Account required");
  await expect(manualRow.locator('[data-feature-key="schedule"]')).toBeEnabled();
  await expect(manualRow.locator('[data-feature-key="accounting"]')).toBeDisabled();
  const adminRow = page.locator("#employeeAccessRows tr", { hasText: fakeProfile.display_name });
  await expect(adminRow.locator('[data-feature-key="accounting"]')).toBeEnabled();
  await expect(adminRow.locator('[data-feature-key="accounting"]')).toBeChecked();
  const employeeRow = page.locator("#employeeAccessRows tr", { hasText: "Steven Leduc" });
  await expect(employeeRow.locator('[data-feature-key="accounting"]')).toBeEnabled();
  await expect(employeeRow.locator('[data-feature-key="accounting"]')).toBeChecked();
  await expect(employeeRow).not.toContainText("Admin account required");
  await expectNoRuntimeErrors(errors, "employee page access admin tool");
});

test("employee submitted work orders load only after their tab is clicked", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const workOrderRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/rest/v1/work_orders")) {
      workOrderRequests.push(decodeURIComponent(request.url()));
    }
  });
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto("/work-orders.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() =>
    typeof window.loadSubmittedWorkOrders === "function" &&
    document.getElementById("woListStatus")?.textContent.includes("active work order")
  );
  await page.waitForTimeout(250);

  expect(await page.evaluate(() => submittedWorkOrdersLoaded)).toBe(false);
  expect(workOrderRequests.some((url) => url.includes("status.eq.submitted"))).toBe(false);

  await page.locator("#workOrderManagementCard .collapse-header").click();
  await expect(page.locator("#managementBody")).toBeVisible();
  await page.locator("#woSubmittedTabButton").click();
  await page.waitForFunction(() => submittedWorkOrdersLoaded && !submittedWorkOrdersLoading);

  expect(workOrderRequests.some((url) => url.includes("status.eq.submitted"))).toBe(true);
  await expect(page.locator("#woSubmittedTabButton")).toHaveClass(/active/);
  await expectNoRuntimeErrors(errors, "employee submitted work order lazy loading");
});

test("appearance settings persist per account and remain usable on mobile", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const themePreferenceState = { theme: "dark", writes: [] };
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile, { themePreferenceState });

  await page.goto("/home.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#jgcAppearanceSettingsButton")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", "dark");

  await page.locator("#jgcAppearanceSettingsButton").click();
  await expect(page.locator("#jgcAppearanceSettingsPanel")).toBeVisible();
  await page.locator('[data-jgc-theme-choice="light"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", "light");
  await expect(page.locator('[data-jgc-theme-choice="light"]')).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => themePreferenceState.theme).toBe("light");
  expect(themePreferenceState.writes.at(-1)).toEqual(expect.objectContaining({
    user_id: fakeUser.id,
    theme: "light"
  }));

  const lightTokens = await page.evaluate(() => {
    const tokens = getComputedStyle(document.documentElement);
    return {
      page: tokens.getPropertyValue("--jgc-color-page").trim(),
      surface: tokens.getPropertyValue("--jgc-color-surface").trim(),
      text: tokens.getPropertyValue("--jgc-color-text").trim()
    };
  });
  expect(lightTokens).toEqual({ page: "#e7ece8", surface: "#f7f9f7", text: "#17251d" });

  await page.evaluate(({ userId }) => {
    localStorage.removeItem("jgcPortalTheme");
    localStorage.removeItem("jgcPortalTheme:" + userId);
  }, { userId: fakeUser.id });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", "light");

  await page.evaluate(({ userId }) => {
    localStorage.setItem("jgcPortalThemePending:" + userId, "dark");
  }, { userId: fakeUser.id });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", "dark");
  await expect.poll(() => themePreferenceState.theme).toBe("dark");
  expect(await page.evaluate(({ userId }) => (
    localStorage.getItem("jgcPortalThemePending:" + userId)
  ), { userId: fakeUser.id })).toBeNull();

  await page.locator("#jgcAppearanceSettingsButton").click();
  await page.locator('[data-jgc-theme-choice="light"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", "light");
  await expect.poll(() => themePreferenceState.theme).toBe("light");

  await page.setViewportSize({ width: 390, height: 844 });
  const mobilePanel = await page.locator("#jgcAppearanceSettingsPanel").boundingBox();
  const mobileButton = await page.locator("#jgcAppearanceSettingsButton").boundingBox();
  expect(mobilePanel.width).toBeLessThanOrEqual(370);
  expect(mobilePanel.x).toBeGreaterThanOrEqual(9);
  expect(mobileButton.width).toBe(38);
  expect(mobileButton.height).toBe(38);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", "light");
  await expect(page.locator("#jgcAppearanceSettingsButton")).toBeVisible();
  await expectNoRuntimeErrors(errors, "appearance settings");
});

test("purchase order list tabs and key controls respond", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto("/purchase-orders.html", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/purchase-orders\.html/);

  for (const tab of ["drafts", "pending", "submitted", "cancelled"]) {
    const button = page.locator(`[data-po-list-tab="${tab}"]`);
    await button.click();
    await expect(button).toHaveClass(/active/);
  }
  await page.locator("#poOpenPendingButton").click();
  await expect(page.locator("#poLookupPanel")).toBeVisible();
  await expectNoRuntimeErrors(errors, "purchase order controls");
});

test("employee homepage exposes Job Notes on desktop and mobile", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto("/home.html", { waitUntil: "domcontentloaded" });

  const quickAccess = page.locator('.feature-card[onclick*="job-lists.html"]');
  await expect(quickAccess).toBeVisible();
  await expect(quickAccess).toContainText("Job Notes");
  await expect(page.locator('.side-link[onclick*="job-lists.html"]')).toContainText("Job Notes");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#jgcMobileMoreButton").click();
  await expect(page.locator('#jgcMobileMoreSheet a[href="job-lists.html"]')).toBeVisible();
  await expect(page.locator('#jgcMobileMoreSheet a[href="job-lists.html"]')).toContainText("Job Notes");
  await expectNoRuntimeErrors(errors, "employee homepage Job Notes navigation");
});

test("employee home sidebar does not include an Admin shortcut", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page, fakeProfile);
  await mockPortalServices(page, fakeProfile);

  await page.goto("/home.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".sidebar .side-nav")).toBeVisible();
  await expect(page.locator("#sideAdminButton")).toHaveCount(0);
  await expect(page.locator(".sidebar").getByRole("button", { name: "Admin", exact: true })).toHaveCount(0);
  await expectNoRuntimeErrors(errors, "employee home admin shortcut removal");
});

test("employee certificates page omits the obsolete bottom action panel", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);

  await page.goto("/certificates.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("main > section.card")).toHaveCount(2);
  await expect(page.locator("#toggleUpload")).toBeVisible();
  await expect(page.locator(".certificate-page-actions")).toHaveCount(0);
  await expectNoRuntimeErrors(errors, "employee certificates obsolete action panel");
});

test("purchase order job picker searches by job name and number", async ({ page }) => {
  const poProfile = Object.assign({}, fakeProfile, { can_create_digital_pos: true });
  const errors = watchRuntimeErrors(page);
  const jobs = [
    {
      id: "00000000-0000-4000-8000-000000000201",
      job_number: "25058",
      job_name: "Amazon Drain Issue #2",
      active: true
    },
    {
      id: "00000000-0000-4000-8000-000000000202",
      job_number: "26040",
      job_name: "Williamstown Fairboard Entrance Sign",
      active: true
    }
  ];

  await page.setViewportSize({ width: 390, height: 844 });
  await installAuthenticatedPortalState(page, poProfile);
  await mockPortalServices(page, poProfile);
  await page.route(`${supabaseOrigin}/rest/v1/jobs**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(jobs)
  }));
  await page.route(`${supabaseOrigin}/rest/v1/rpc/digital_po_get_device_context`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      registered: true,
      device_id: "00000000-0000-4000-8000-000000000203",
      device_status: "active",
      lease_expires_at: "2027-07-21T12:00:00.000Z",
      blocks: [{
        id: "00000000-0000-4000-8000-000000000204",
        range_start: 39100,
        range_end: 39109,
        next_number: 39100,
        status: "active"
      }]
    })
  }));

  await page.goto("/purchase-orders.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#poNewButton")).toBeEnabled();
  await page.locator("#poNewButton").click();
  await expect(page.locator("#poFormView")).toBeVisible();

  const search = page.locator("#poJobSearch");
  const options = page.locator("#poJobOptions");
  await search.fill("Amazon");
  await expect(options).toBeVisible();
  await expect(options.locator("[data-po-job-id]")).toHaveCount(1);
  await expect(options).toContainText("25058 - Amazon Drain Issue #2");
  await options.locator("[data-po-job-id]").click();
  await expect(page.locator("#poJob")).toHaveValue(jobs[0].id);
  await expect(search).toHaveValue("25058 - Amazon Drain Issue #2");

  await search.fill("26040");
  await expect(options.locator("[data-po-job-id]")).toHaveCount(1);
  await expect(options).toContainText("26040 - Williamstown Fairboard Entrance Sign");
  await options.locator("[data-po-job-id]").click();
  await expect(page.locator("#poJob")).toHaveValue(jobs[1].id);
  await expect(search).toHaveValue("26040 - Williamstown Fairboard Entrance Sign");
  await expectNoRuntimeErrors(errors, "purchase order searchable job picker");
});

test("purchase order Job Notes transfer material and equipment items one at a time", async ({ page }) => {
  const poProfile = Object.assign({}, fakeProfile, { can_create_digital_pos: true });
  const errors = watchRuntimeErrors(page);
  const job = {
    id: "00000000-0000-4000-8000-000000000211",
    job_number: "25148",
    job_name: "St Marys Centre Wall Panels",
    active: true
  };
  const jobList = {
    id: "00000000-0000-4000-8000-000000000212",
    job_id: job.id,
    job_number: job.job_number,
    job_name: job.job_name,
    title: "Counter pickup",
    status: "open",
    updated_at: "2026-07-23T13:00:00.000Z"
  };
  const noteItems = [
    {
      id: "00000000-0000-4000-8000-000000000213",
      list_id: jobList.id,
      item_text: "Twelve sheets of drywall",
      quantity: 45,
      position: 0,
      completed: false,
      updated_at: "2026-07-23T13:01:00.000Z"
    },
    {
      id: "00000000-0000-4000-8000-000000000214",
      list_id: jobList.id,
      item_text: "Scissor lift",
      position: 1,
      completed: false,
      updated_at: "2026-07-23T13:02:00.000Z"
    }
  ];
  const jobNoteMethods = [];

  await page.setViewportSize({ width: 390, height: 844 });
  await installAuthenticatedPortalState(page, poProfile);
  await mockPortalServices(page, poProfile);
  await page.route(`${supabaseOrigin}/rest/v1/jobs**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([job])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/job_lists**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([jobList])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/job_list_items**`, (route) => {
    jobNoteMethods.push(route.request().method());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(noteItems)
    });
  });
  await page.route(`${supabaseOrigin}/rest/v1/rpc/digital_po_get_device_context`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      registered: true,
      device_id: "00000000-0000-4000-8000-000000000215",
      device_status: "active",
      lease_expires_at: "2027-07-23T12:00:00.000Z",
      blocks: [{
        id: "00000000-0000-4000-8000-000000000216",
        range_start: 39200,
        range_end: 39209,
        next_number: 39200,
        status: "active"
      }]
    })
  }));

  await page.goto("/purchase-orders.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#poNewButton")).toBeEnabled();
  await page.locator("#poNewButton").click();
  await page.locator("#poJobSearch").fill("25148");
  await page.locator("#poJobOptions [data-po-job-id]").click();

  await expect(page.locator("#poJobNotesPanel")).toBeVisible();
  await expect(page.locator("#poJobNotesSummary")).toContainText("1 open note");
  await expect(page.locator("#poJobNotesSummary")).toContainText("2 unchecked items");
  await page.locator("#poJobNotesToggle").click();
  await expect(page.locator("#poJobNotesBody")).toBeVisible();
  await expect(page.locator(".po-job-note-item")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /add all/i })).toHaveCount(0);

  const drywallItem = page.locator(".po-job-note-item").filter({ hasText: "Twelve sheets of drywall" });
  const equipmentItem = page.locator(".po-job-note-item").filter({ hasText: "Scissor lift" });
  await drywallItem.getByRole("button", { name: "Add to PO" }).click();
  await expect(page.locator('[data-item-field="description"]').first()).toHaveValue("Twelve sheets of drywall");
  await expect(page.locator('[data-item-field="quantity_ordered"]').first()).toHaveValue("45");
  await expect(drywallItem.getByRole("button", { name: "On PO" })).toBeDisabled();

  await equipmentItem.getByRole("button", { name: "Add to PO" }).click();
  await expect(page.locator(".po-material-tile")).toHaveCount(2);
  await expect(page.locator('[data-item-field="description"]').nth(1)).toHaveValue("Scissor lift");
  await expect(equipmentItem.getByRole("button", { name: "On PO" })).toBeDisabled();

  await page.locator(".po-material-tile").first().locator("[data-remove-item]").click();
  await expect(drywallItem.getByRole("button", { name: "Add to PO" })).toBeEnabled();
  await expect(equipmentItem.getByRole("button", { name: "On PO" })).toBeDisabled();
  expect(jobNoteMethods.every((method) => method === "GET" || method === "HEAD")).toBe(true);
  await expectNoRuntimeErrors(errors, "purchase order Job Notes transfer");
});

test("purchase order submit feedback closes success and emphasizes failure", async ({ page }) => {
  const poProfile = Object.assign({}, fakeProfile, { can_create_digital_pos: true });
  const errors = watchRuntimeErrors(page, "accept");
  await installAuthenticatedPortalState(page, poProfile);
  await mockPortalServices(page, poProfile);

  let savedOrder = null;
  await page.route(`${supabaseOrigin}/rest/v1/rpc/digital_po_get_device_context`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      registered: true,
      device_id: "00000000-0000-4000-8000-000000000101",
      device_status: "active",
      lease_expires_at: "2027-07-20T12:00:00.000Z",
      blocks: [{
        id: "00000000-0000-4000-8000-000000000102",
        range_start: 39000,
        range_end: 39009,
        next_number: 39000,
        status: "active"
      }]
    })
  }));
  await page.route(`${supabaseOrigin}/rest/v1/rpc/digital_po_save_manual`, async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.p_order.job_number).toBe("");
    expect(payload.p_order.job_name).toBe("Smoke Test Project");
    savedOrder = Object.assign({}, payload.p_order, { revision: 1 });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(savedOrder) });
  });
  await page.route(`${supabaseOrigin}/rest/v1/rpc/digital_po_submit`, async (route) => {
    savedOrder = Object.assign({}, savedOrder, {
      workflow_status: "submitted",
      email_status: "pending",
      revision: 2
    });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(savedOrder) });
  });

  await page.goto("/purchase-orders.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    window.uploadJgcFile = async (options) => ({
      data: { path: options.path, fullPath: `${options.bucket}/${options.path}` },
      error: null
    });
  });
  await expect(page.locator("#poNewButton")).toBeEnabled();
  await page.locator("#poNewButton").click();
  await expect(page.locator("#poFormView")).toBeVisible();

  await page.locator("#poSubmitButton").click();
  await expect(page.locator("#poNotice")).toContainText("PO SUBMISSION FAILED");
  await expect(page.locator("#poNotice")).toHaveClass(/po-submit-error/);
  await expect(page.locator("#poNotice")).toHaveAttribute("role", "alert");

  await page.locator("#poManualJobName").fill("Smoke Test Project");
  await page.locator("#poSupplierName").fill("Smoke Test Supplier");
  await page.locator('[data-item-field="quantity_ordered"]').fill("1");
  await page.locator('[data-item-field="description"]').fill("Smoke test material");
  await page.locator("#poSubmitButton").click();

  await expect(page.locator("#poFormView")).toBeHidden();
  await expect(page.locator("#poListView")).toBeVisible();
  await expect(page.locator('[data-po-list-tab="pending"]')).toHaveClass(/active/);
  await expect(page.locator("#poNotice")).toContainText("submitted");
  await expect(page.locator("#poList")).toContainText("PO-39000");
  await expectNoRuntimeErrors(errors, "purchase order submission feedback");
});

test("purchase order sync reconciles a stale local draft with a submitted server record", async ({ page }) => {
  const poProfile = Object.assign({}, fakeProfile, { can_create_digital_pos: true });
  const errors = watchRuntimeErrors(page);
  const poId = "00000000-0000-4000-8000-000000000310";
  const serverOrder = {
    id: poId,
    po_number: 31000,
    creator_profile_id: fakeUser.id,
    creator_name: "Andre Labrosse",
    workflow_status: "submitted",
    email_status: "emailed",
    revision: 3,
    order_date: "2026-07-14",
    job_number: "25169",
    job_name: "McKay Office Addition",
    supplier_name: "Emard",
    receipt_status: "none",
    receipt_attached: false,
    created_at: "2026-07-14T12:00:00.000Z",
    updated_at: "2026-07-15T12:00:00.000Z",
    submitted_at: "2026-07-14T12:05:00.000Z",
    email_sent_at: "2026-07-15T12:00:00.000Z"
  };
  const staleDraft = {
    id: poId,
    po: Object.assign({}, serverOrder, {
      workflow_status: "draft",
      email_status: "not_ready",
      revision: 1,
      submitted_at: null,
      email_sent_at: null
    }),
    items: [{
      id: "00000000-0000-4000-8000-000000000311",
      po_id: poId,
      quantity_ordered: 4,
      description: "Smoke test material",
      sort_order: 0
    }],
    dirty: true,
    assignment_dirty: false,
    pending_submit: true,
    pending_cancel: false,
    updated_local_at: "2026-07-14T12:04:00.000Z"
  };
  let saveAttempts = 0;

  await installAuthenticatedPortalState(page, poProfile);
  await mockPortalServices(page, poProfile);
  await page.route(`${supabaseOrigin}/rest/v1/rpc/digital_po_get_device_context`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      registered: true,
      device_id: "00000000-0000-4000-8000-000000000312",
      device_status: "active",
      lease_expires_at: "2027-07-23T12:00:00.000Z",
      blocks: [{
        id: "00000000-0000-4000-8000-000000000313",
        range_start: 31000,
        range_end: 31499,
        next_number: 31007,
        status: "active"
      }]
    })
  }));
  await page.route(`${supabaseOrigin}/rest/v1/digital_purchase_orders**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([serverOrder])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/digital_po_items**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(staleDraft.items)
  }));
  await page.route(`${supabaseOrigin}/rest/v1/rpc/digital_po_save`, (route) => {
    saveAttempts += 1;
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ message: "This PO is locked. An admin must reopen it before changes can be made." })
    });
  });

  await page.goto("/reset-password.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(async (draft) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("jgc-digital-purchase-orders", 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
        if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "id" });
        if (!db.objectStoreNames.contains("receipts")) db.createObjectStore("receipts", { keyPath: "po_id" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("drafts", "readwrite");
        transaction.objectStore("drafts").put(draft);
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, staleDraft);

  await page.goto("/purchase-orders.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#poSyncBadge")).toContainText("Synced");
  await page.locator('[data-po-list-tab="submitted"]').click();
  await expect(page.locator("#poList")).toContainText("PO-31000");
  await expect(page.locator("#poList")).toContainText("Emailed");
  await expect.poll(() => saveAttempts).toBe(0);
  await expect.poll(() => page.evaluate(async (id) => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("jgc-digital-purchase-orders", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("drafts", "readonly");
        const getRequest = transaction.objectStore("drafts").get(id);
        getRequest.onsuccess = () => {
          db.close();
          resolve(Boolean(getRequest.result));
        };
        getRequest.onerror = () => reject(getRequest.error);
      };
    });
  }, poId)).toBe(false);
  await expectNoRuntimeErrors(errors, "purchase order stale draft reconciliation");
});

test("purchase order admin tabs respond", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto("/purchase-orders-admin.html", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/purchase-orders-admin\.html/);

  for (const tab of ["devices", "drafts", "pending", "submitted", "cancelled"]) {
    const button = page.locator(`[data-admin-tab="${tab}"]`);
    await button.click();
    await expect(button).toHaveClass(/active/);
  }
  await expectNoRuntimeErrors(errors, "purchase order admin tabs");
});

test("mobile More menu opens and closes", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto("/home.html", { waitUntil: "domcontentloaded" });

  const moreButton = page.locator("#jgcMobileMoreButton");
  await expect(moreButton).toBeVisible();
  await moreButton.click();
  await expect(page.locator("#jgcMobileMoreSheet")).toHaveClass(/open/);
  await page.locator("#jgcMobileMoreBackdrop").click({ position: { x: 5, y: 5 } });
  await expect(page.locator("#jgcMobileMoreSheet")).not.toHaveClass(/open/);
  await expectNoRuntimeErrors(errors, "mobile More menu");
});

for (const theme of ["light", "dark"]) {
  for (const portalPage of ["admin.html?tab=summary", "home.html", "jobs.html"]) {
    test(`mobile More menu contrast on ${portalPage} in ${theme} theme`, async ({ page }, testInfo) => {
      const errors = watchRuntimeErrors(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await installAuthenticatedPortalState(page);
      await mockPortalServices(page, fakeProfile, { themePreferenceState: { theme, writes: [] } });
      await page.addInitScript((value) => localStorage.setItem("jgcPortalTheme", value), theme);
      await page.goto(`/${portalPage}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", theme);
      const button = page.locator("#jgcMobileMoreButton");
      const sheet = page.locator("#jgcMobileMoreSheet");
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(sheet).toHaveCSS("opacity", "1");
      await expect(sheet.locator("a")).toHaveCount(14);

      async function checkMenuContrast() {
        const samples = await sheet.evaluate((element) => {
          const parse = (color) => {
            const channels = color.match(/[\d.]+/g).map(Number);
            return [...channels.slice(0, 3), channels[3] ?? 1];
          };
          const composite = (front, back) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3]));
          const backgroundOf = (node) => {
            if (!node) return [255, 255, 255];
            const color = parse(getComputedStyle(node).backgroundColor);
            return composite(color, color[3] === 1 ? [0, 0, 0] : backgroundOf(node.parentElement));
          };
          const luminance = (color) => color.map((channel) => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
          }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
          return [...element.querySelectorAll(".jgc-mobile-more-title, a span, a svg")].map((node) => {
            const background = backgroundOf(node);
            const style = getComputedStyle(node);
            const foreground = composite(parse(node.tagName.toLowerCase() === "svg" ? style.stroke : style.color), background);
            const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
            return { label: node.closest("a")?.textContent || node.textContent, kind: node.tagName, ratio: (values[1] + 0.05) / (values[0] + 0.05) };
          });
        });
        for (const sample of samples) {
          expect(sample.ratio, `${theme} ${sample.label} ${sample.kind} contrast`).toBeGreaterThanOrEqual(4.5);
        }
      }

      await checkMenuContrast();
      if (portalPage === "jobs.html") await expect(sheet.locator('a[href="jobs.html"]')).toHaveClass(/active/);
      const jobsLink = sheet.locator('a[href="jobs.html"]');
      await jobsLink.hover();
      await checkMenuContrast();
      await jobsLink.focus();
      await checkMenuContrast();
      await page.screenshot({ path: testInfo.outputPath(`mobile-more-${theme}.png`) });
      await page.locator("#jgcMobileMoreBackdrop").click({ position: { x: 5, y: 5 } });
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(sheet).not.toHaveClass(/open/);
      await button.click();
      await jobsLink.click();
      await expect(page).toHaveURL(/\/jobs\.html$/);
      await expect(page.locator("#jgcMobileMoreSheet")).not.toHaveClass(/open/);
      await expectNoRuntimeErrors(errors, "mobile More menu contrast and navigation");
    });
  }
}

test("job notes employee page opens its standalone editor", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto("/job-lists.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#jobListsNewButton")).toBeVisible();
  await page.locator("#jobListsNewButton").click();
  await expect(page.locator("#jobListsModal")).toBeVisible();
  await expect(page.locator("#jobListModalClose")).toContainText("Notes");
  await expect(page.locator("#jobListComplete")).toBeHidden();
  await expect(page.locator("#jobListDelete")).toBeHidden();
  await expect(page.locator("#jobListMembers")).toContainText("Portal Smoke Test");
  await expect(page.locator("#jobListMembers")).toContainText("Steven Leduc");
  await expect(page.locator("#jobListItemEditor [data-job-list-item-input]")).toHaveCount(1);
  const editorBox = await page.locator(".job-list-note-editor").boundingBox();
  expect(editorBox.height).toBeGreaterThanOrEqual(840);
  const firstLine = page.locator('[data-job-list-item-input="0"]');
  await firstLine.fill("2x4 lumber");
  await firstLine.press("Enter");
  await expect(page.locator("#jobListItemEditor [data-job-list-item-input]")).toHaveCount(2);
  await expect(page.locator('[data-job-list-item-input="1"]')).toBeFocused();
  await page.locator('[data-job-list-edit-toggle="0"]').click();
  await expect(page.locator(".job-list-item-edit-row").first()).toHaveClass(/is-complete/);
  await expect(firstLine).toHaveCSS("text-decoration-line", "line-through");
  const reminderInput = page.locator("#jobListReminder");
  await page.locator("#jobListOptions > summary").click();
  await reminderInput.fill("2030-07-24T06:45");
  await reminderInput.dispatchEvent("change");
  await expect(page.locator("[data-job-list-reminder-chip]")).toHaveCount(1);
  await expect(reminderInput).toHaveValue("");
  await reminderInput.fill("2030-07-24T15:30");
  await reminderInput.dispatchEvent("change");
  await expect(page.locator("[data-job-list-reminder-chip]")).toHaveCount(2);
  await expect(page.locator("#jobListSave")).toBeVisible();
  await page.locator("#jobListSave").scrollIntoViewIfNeeded();
  await expect(page.locator("#jobListSave")).toBeInViewport();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  await captureJobListScreenshot(page, "job-lists-mobile.png");
  await expectNoRuntimeErrors(errors, "job notes employee page");
});

test("job notes desktop editor remains a full-page writing workspace", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto("/job-lists.html", { waitUntil: "domcontentloaded" });

  await page.locator("#jobListsNewButton").click();
  const editor = page.locator(".job-list-note-editor");
  await expect(editor).toBeVisible();
  const box = await editor.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(1439);
  expect(box.height).toBeGreaterThanOrEqual(899);
  await expect(page.locator(".job-list-note-page")).toBeVisible();
  await expect(page.locator("#jobListTitle")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator('[data-job-list-item-input="0"]')).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator('[data-job-list-edit-toggle="0"]')).toHaveAttribute("aria-pressed", "false");
  await captureJobListScreenshot(page, "job-lists-editor-desktop.png");
  await expectNoRuntimeErrors(errors, "job notes desktop editor");
});

test("job note checkpoints autosave once and Save & Close returns to the notes list", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const job = {
    id: "00000000-0000-4000-8000-000000000351",
    job_number: "26040",
    job_name: "Williamstown Fairboard Entrance Sign",
    active: true
  };
  const listId = "00000000-0000-4000-8000-000000000352";
  const savedLists = [];
  const savedMembers = [];
  const savedItems = [];
  let listCreateCount = 0;
  let listUpdateCount = 0;

  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/jobs**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([job])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/job_lists**`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      listCreateCount += 1;
      const payload = request.postDataJSON();
      const saved = Object.assign({}, payload, {
        id: listId,
        status: "open",
        created_by_name: fakeProfile.display_name,
        last_edited_by_name: fakeProfile.display_name,
        reminder_at: null,
        updated_at: "2026-07-23T12:00:00.000Z",
        deleted_at: null
      });
      savedLists.splice(0, savedLists.length, saved);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(saved) });
      return;
    }
    if (request.method() === "PATCH") {
      listUpdateCount += 1;
      Object.assign(savedLists[0], request.postDataJSON(), {
        updated_at: "2026-07-23T12:05:00.000Z"
      });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(savedLists[0]) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(savedLists) });
  });
  await page.route(`${supabaseOrigin}/rest/v1/job_list_members**`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const payload = request.postDataJSON();
      const rows = (Array.isArray(payload) ? payload : [payload]).map((member, index) => Object.assign({}, member, {
        id: `00000000-0000-4000-8000-00000000036${index}`,
        display_name: member.profile_id === fakeUser.id ? fakeProfile.display_name : "Steven Leduc"
      }));
      savedMembers.splice(0, savedMembers.length, ...rows);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(savedMembers) });
  });
  await page.route(`${supabaseOrigin}/rest/v1/job_list_items**`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const payload = request.postDataJSON();
      const rows = (Array.isArray(payload) ? payload : [payload]).map((item, index) => Object.assign({}, item, {
        id: `00000000-0000-4000-8000-00000000037${index}`,
        completed: false,
        created_at: "2026-07-23T12:01:00.000Z"
      }));
      savedItems.splice(0, savedItems.length, ...rows);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
      return;
    }
    if (request.method() === "PATCH") {
      Object.assign(savedItems[0], request.postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([savedItems[0]]) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(savedItems) });
  });
  await page.route(`${supabaseOrigin}/rest/v1/job_list_reminders**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "[]"
  }));
  await page.route(`${supabaseOrigin}/rest/v1/job_list_activity**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "[]"
  }));

  await page.goto("/job-lists.html", { waitUntil: "domcontentloaded" });
  await page.locator("#jobListsNewButton").click();
  await page.locator("#jobListTitle").fill("Jobsite materials");
  await page.locator("#jobListJob").selectOption(job.id);
  await expect(page.locator("#jobListAutosaveStatus")).toHaveText("Saved");
  expect(listCreateCount).toBe(1);

  await page.locator('[data-job-list-item-input="0"]').fill("Plywood");
  await page.locator("#jobListAddItem").click();
  await expect(page.locator("#jobListAutosaveStatus")).toHaveText("Saved");
  expect(listCreateCount).toBe(1);
  expect(savedItems).toHaveLength(1);

  await page.locator("#jobListSave").click();
  await expect(page.locator("#jobListsModal")).toBeHidden();
  await expect(page.locator("#jobListsNotice")).toContainText("Job note updated.");
  await expect(page.locator("[data-job-list-job-group]")).toContainText(job.job_name);
  await expect(page.locator("[data-job-list-job-group]")).toContainText("Jobsite materials");
  expect(listCreateCount).toBe(1);
  expect(listUpdateCount).toBeGreaterThan(0);
  await expectNoRuntimeErrors(errors, "job note checkpoint autosave");
});

test("job notes use compact Jobs folders and note rows", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const jobs = [
    {
      id: "00000000-0000-4000-8000-000000000301",
      job_number: "25058",
      job_name: "Amazon Drain Issue #2",
      active: true
    },
    {
      id: "00000000-0000-4000-8000-000000000302",
      job_number: "26040",
      job_name: "Williamstown Fairboard Entrance Sign",
      active: true
    }
  ];
  const lists = [
    {
      id: "00000000-0000-4000-8000-000000000311",
      job_id: jobs[0].id,
      job_number: jobs[0].job_number,
      job_name: jobs[0].job_name,
      title: "BMR pickup",
      status: "open",
      created_by: fakeUser.id,
      created_by_name: fakeProfile.display_name,
      last_edited_by_name: fakeProfile.display_name,
      created_at: "2026-07-23T12:00:00.000Z",
      reminder_at: "2026-07-24T10:45:00.000Z",
      updated_at: "2026-07-23T12:00:00.000Z",
      deleted_at: null
    },
    {
      id: "00000000-0000-4000-8000-000000000312",
      job_id: jobs[0].id,
      job_number: jobs[0].job_number,
      job_name: jobs[0].job_name,
      title: "Return rental tools",
      status: "open",
      created_by: fakeUser.id,
      created_by_name: fakeProfile.display_name,
      last_edited_by_name: fakeProfile.display_name,
      created_at: "2026-07-23T11:00:00.000Z",
      reminder_at: null,
      updated_at: "2026-07-23T11:00:00.000Z",
      deleted_at: null
    },
    {
      id: "00000000-0000-4000-8000-000000000313",
      job_id: jobs[1].id,
      job_number: jobs[1].job_number,
      job_name: jobs[1].job_name,
      title: "Sign materials",
      status: "open",
      created_by: fakeUser.id,
      created_by_name: fakeProfile.display_name,
      last_edited_by_name: fakeProfile.display_name,
      created_at: "2026-07-23T10:00:00.000Z",
      reminder_at: null,
      updated_at: "2026-07-23T10:00:00.000Z",
      deleted_at: null
    }
  ];
  const members = lists.map((list, index) => ({
    id: `00000000-0000-4000-8000-00000000032${index}`,
    list_id: list.id,
    profile_id: fakeUser.id,
    display_name: fakeProfile.display_name
  }));
  const items = lists.map((list, index) => ({
    id: `00000000-0000-4000-8000-00000000033${index}`,
    list_id: list.id,
    item_text: `Item ${index + 1}`,
    position: 0,
    completed: false,
    created_at: "2026-07-23T09:00:00.000Z"
  }));
  const reminders = [
    {
      id: "00000000-0000-4000-8000-000000000341",
      list_id: lists[0].id,
      reminder_at: "2030-07-24T10:45:00.000Z",
      sent_at: null
    },
    {
      id: "00000000-0000-4000-8000-000000000342",
      list_id: lists[0].id,
      reminder_at: "2020-07-24T10:45:00.000Z",
      sent_at: "2020-07-24T10:45:05.000Z"
    }
  ];

  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/jobs**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(jobs)
  }));
  await page.route(`${supabaseOrigin}/rest/v1/job_lists**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(lists)
  }));
  await page.route(`${supabaseOrigin}/rest/v1/job_list_members**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(members)
  }));
  await page.route(`${supabaseOrigin}/rest/v1/job_list_items**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(items)
  }));
  await page.route(`${supabaseOrigin}/rest/v1/job_list_reminders**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(reminders)
  }));
  await page.goto("/job-lists.html", { waitUntil: "domcontentloaded" });

  const groups = page.locator("[data-job-list-job-group]");
  await expect(groups).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();
  const amazonGroup = groups.filter({ hasText: jobs[0].job_name });
  await expect(amazonGroup.locator("summary")).toContainText("2 notes");
  await expect(amazonGroup).not.toHaveAttribute("open", "");
  await expect(amazonGroup.getByRole("button", { name: "Open note: BMR pickup" })).not.toBeVisible();

  await amazonGroup.locator("summary").click();
  await expect(amazonGroup).toHaveAttribute("open", "");
  await expect(amazonGroup.locator(".job-list-note-row")).toHaveCount(2);
  const bmrRow = amazonGroup.locator(".job-list-note-row").filter({ hasText: "BMR pickup" });
  await expect(bmrRow).toContainText("Item 1");
  await expect(bmrRow.getByRole("button", { name: "Open note: BMR pickup" })).toHaveText("Open");
  await expect(amazonGroup).toContainText("Created by Portal Smoke Test");
  await expect(amazonGroup.getByRole("button", { name: "Delete note: BMR pickup" })).toBeVisible();
  await expect(amazonGroup).not.toContainText("Updated");
  await expect(amazonGroup.locator(".job-list-progress")).toHaveCount(0);
  const summaryBox = await amazonGroup.locator("summary").boundingBox();
  const noteRowBox = await amazonGroup.locator(".job-list-note-row").first().boundingBox();
  expect(summaryBox.height).toBeLessThanOrEqual(70);
  expect(noteRowBox.height).toBeLessThanOrEqual(100);
  await amazonGroup.getByRole("button", { name: "Open note: BMR pickup" }).click();
  await expect(page.locator("#jobListsModal")).toBeVisible();
  await expect(page.locator("#jobListModalTitle")).toHaveText("BMR pickup");
  await expect(page.locator("#jobListItemEditor")).toContainText("Item 1");
  await page.locator("#jobListModalClose").click();
  await expect(groups.nth(1).locator("summary")).toContainText(jobs[1].job_name);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  await captureJobListScreenshot(page, "job-lists-compact-browser.png");
  await expectNoRuntimeErrors(errors, "compact grouped job notes");
});

test("job note completes when every item is checked and reopens when one is unchecked", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const job = {
    id: "00000000-0000-4000-8000-000000000401",
    job_number: "26040",
    job_name: "Williamstown Fairboard Entrance Sign",
    active: true
  };
  const list = {
    id: "00000000-0000-4000-8000-000000000402",
    job_id: job.id,
    job_number: job.job_number,
    job_name: job.job_name,
    title: "Pickup materials",
    status: "open",
    created_by: fakeUser.id,
    created_by_name: fakeProfile.display_name,
    last_edited_by_name: fakeProfile.display_name,
    created_at: "2026-07-29T10:00:00.000Z",
    updated_at: "2026-07-29T10:00:00.000Z",
    deleted_at: null
  };
  const members = [{
    id: "00000000-0000-4000-8000-000000000403",
    list_id: list.id,
    profile_id: fakeUser.id,
    display_name: fakeProfile.display_name
  }];
  const items = [
    {
      id: "00000000-0000-4000-8000-000000000404",
      list_id: list.id,
      item_text: "Plywood",
      position: 0,
      completed: true,
      created_at: "2026-07-29T10:01:00.000Z"
    },
    {
      id: "00000000-0000-4000-8000-000000000405",
      list_id: list.id,
      item_text: "Fasteners",
      position: 1,
      completed: false,
      created_at: "2026-07-29T10:02:00.000Z"
    }
  ];

  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/jobs**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([job])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/job_lists**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([list])
  }));
  await page.route(`${supabaseOrigin}/rest/v1/job_list_members**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(members)
  }));
  await page.route(`${supabaseOrigin}/rest/v1/job_list_items**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(items)
  }));
  await page.route(`${supabaseOrigin}/rest/v1/job_list_reminders**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "[]"
  }));
  await page.route(`${supabaseOrigin}/rest/v1/job_list_activity**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "[]"
  }));
  await page.route(`${supabaseOrigin}/rest/v1/rpc/toggle_job_list_item`, async (route) => {
    const payload = route.request().postDataJSON();
    const item = items.find((entry) => entry.id === payload.p_item_id);
    item.completed = Boolean(payload.p_completed);
    list.status = items.length && items.every((entry) => entry.completed) ? "completed" : "open";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(item)
    });
  });

  await page.goto("/job-lists.html", { waitUntil: "domcontentloaded" });
  const openGroup = page.locator("[data-job-list-job-group]");
  await openGroup.locator("summary").click();
  await openGroup.getByRole("button", { name: "Open note: Pickup materials" }).click();
  await page.getByRole("button", { name: "Mark line complete" }).click();
  await expect(page.locator("#jobListsModal")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark line incomplete" })).toHaveCount(2);
  await page.locator("#jobListModalClose").click();
  await expect(page.locator("#jobListsModal")).toBeHidden();
  await expect(page.locator("#jobListsNotice")).toContainText("Job note completed.");
  await expect(page.locator("#jobListsCards")).toContainText("No open job notes found.");

  await page.locator('[data-job-list-tab="completed"]').click();
  const completedGroup = page.locator("[data-job-list-job-group]");
  if (!(await completedGroup.evaluate((group) => group.open))) {
    await completedGroup.locator("summary").click();
  }
  await completedGroup.getByRole("button", { name: "Open note: Pickup materials" }).click();
  await page.getByRole("button", { name: "Mark line incomplete" }).first().click();
  await expect(page.locator("#jobListsModal")).toBeHidden();
  await expect(page.locator("#jobListsNotice")).toContainText("Job note reopened.");

  await page.locator('[data-job-list-tab="open"]').click();
  await expect(page.locator("[data-job-list-job-group]")).toContainText("Pickup materials");
  await expectNoRuntimeErrors(errors, "automatic job note completion");
});

test("job notes admin page keeps management separate", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.goto("/job-lists-admin.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator("#jobListsAdminRefresh")).toBeVisible();
  await expect(page.locator("#jobListsAdminRows")).toContainText("No matching job notes found");
  for (const tab of ["open", "completed", "deleted"]) {
    const button = page.locator(`[data-job-list-admin-tab="${tab}"]`);
    await button.click();
    await expect(button).toHaveClass(/active/);
  }
  await expect(page.getByRole("main").getByRole("link", { name: "Admin Tools" })).toBeVisible();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await captureJobListScreenshot(page, "job-lists-admin-mobile.png");
  await expectNoRuntimeErrors(errors, "job notes admin page");
});


for (const [start, missingDays] of [[null, 5], ["2026-08-17", 0], ["2026-08-12", 3], ["2026-08-14", 1], ["2026-08-15", 0], ["2026-08-09", 5], ["2026-08-10", 5]]) {
  test(`Employment start ${start || "unknown"} gives correct Accounting requirements`, async ({ page }) => {
    await installAuthenticatedPortalState(page);
    await mockPortalServices(page, fakeProfile, { accountingEnabled: false, missingAccountingSecondWeek: true, employeeHireDate: start });
    await page.goto("/accounting-admin.html");
    await page.locator("#accountingPayDate").fill("2026-08-20");
    await page.locator("#accountingPayDate").dispatchEvent("change");
    await expect(page.locator("#accountingNotice")).not.toContainText("Loading");
    if (!missingDays) {
      await expect(page.locator("#accountingDownloadFinal")).toBeEnabled();
      await expect(page.locator("[data-open-missing-submissions]")).toHaveCount(0);
    } else {
      await expect(page.locator("#accountingDownloadFinal")).toBeDisabled();
      await expect(page.locator("#accountingValidation")).toContainText("1 expected submission missing");
      await page.locator("[data-open-missing-submissions]").click();
      await expect(page.locator("[data-fill-day]")).toHaveCount(missingDays);
      await expect(page.locator(".accounting-weekday small").filter({ hasText: "Before start" })).toHaveCount(5 - missingDays);
      if (start === "2026-08-12") {
        page.once("dialog", dialog => dialog.accept());
        const request = page.waitForRequest(r => r.url().includes("/rpc/accounting_autofill_leave_timesheet"));
        await page.locator("[data-submit-missing-timesheet]").click();
        expect((await request).postDataJSON().p_days).toEqual(["Wednesday", "Thursday", "Friday"]);
      }
    }
  });
}

for (const width of [390, 1280]) test(`Employment Start Date saves and reloads in Accounts at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  const employee = { ...fakeProfile, id: "00000000-0000-4000-8000-000000000002", display_name: "Start Date Employee", email: "start@example.com", role: "worker", hire_date: null };
  const writes = [];
  await page.route(`${supabaseOrigin}/rest/v1/profiles*`, async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === "PATCH") { writes.push(request.postDataJSON()); Object.assign(employee, request.postDataJSON()); return route.fulfill({ json: employee }); }
    return route.fulfill({ json: request.headers().accept.includes("pgrst.object") ? (url.searchParams.get("id") === "eq." + employee.id ? employee : fakeProfile) : [fakeProfile, employee] });
  });
  await page.goto("/accounts.html");
  const input = page.getByLabel("Employment Start Date for Start Date Employee", { exact: true });
  await input.fill("2026-08-12");
  await input.locator("..").getByRole("button", { name: "Save start date" }).click();
  await expect(input.locator("..").getByRole("status")).toHaveText("Saved");
  expect(writes).toEqual([{ hire_date: "2026-08-12" }]);
  await page.reload();
  await expect(input).toHaveValue("2026-08-12");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await input.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath(`employment-start-${width}.png`), fullPage: true });
});

test("Employment start lets employees submit a partial first week without pre-start holiday autofill", async ({ page }) => {
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, { ...fakeProfile, hire_date: "2026-08-05" });
  await page.goto("/timesheet.html");
  await page.waitForFunction(() => currentEmploymentStartDate === "2026-08-05");
  const result = await page.evaluate(() => {
    document.getElementById("weekStart").value = "2026-08-02";
    return {
      missing: getMissingMandatoryWeekdays(["Wednesday", "Thursday", "Friday"].map(day => ({ day }))),
      incomplete: getMissingMandatoryWeekdays([{ day: "Wednesday" }]),
      holidays: getOntarioHolidayEntriesForWeek(makeLocalDate("2026-08-02"), makeLocalDate("2026-08-07")).length
    };
  });
  expect(result).toEqual({ missing: [], incomplete: ["Thursday", "Friday"], holidays: 0 });
});

test("Employment start applies to the administrator partial-week submission check", async ({ page }) => {
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile, { employeeHireDate: "2026-08-12" });
  await page.goto("/admin.html?tab=timesheets");
  await page.waitForFunction(() => accounts.some(p => p.hire_date === "2026-08-12"));
  expect(await page.evaluate(() => getAdminLiveTimesheetMissingWeekdays(["Wednesday", "Thursday", "Friday"].map(day => ({ profile_id: "00000000-0000-4000-8000-000000000002", worker_name: "Steven Leduc", week_start: "2026-08-09", day_of_week: day }))))).toEqual([]);
});

async function signSafetyReport(page, selector) {
  await page.locator(selector).getByRole('button', { name: 'Add signature', exact: true }).click();
  await page.locator('#safetySignaturePrintedName').fill('Synthetic Signer');
  const canvas = page.locator('.safety-signature-pad');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 50);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 75, { steps: 10 });
  await page.mouse.move(box.x + 200, box.y + 40, { steps: 10 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Confirm signature', exact: true }).click();
  await expect(page.locator(selector).locator('img')).toBeVisible();
}

async function fillManualInjury(page) {
  await page.locator('#employeeWorker').selectOption('__manual__');
  await page.locator('#employeeWorkerName').fill('Synthetic Subcontractor');
  await page.locator('#employeeWorkerCompany').fill('Example Trade Company');
  await page.locator('#accidentLocation').evaluate(el => { el.value = '26999 - Synthetic job'; });
  await page.locator('#accidentDescription').fill('Synthetic incident used only for local testing.');
}

test('injury redesign saves structured manual people and touch sign-offs once and reopens PDF', async ({ page }, testInfo) => {
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile, { themePreferenceState: { theme: 'light' } });
  const records = [], emails = [], acknowledgements = [];
  await page.route(`${supabaseOrigin}/rest/v1/employee_injury_reports*`, async route => {
    if (route.request().method() === 'POST') { records.push(route.request().postDataJSON()); await new Promise(r => setTimeout(r, 200)); return route.fulfill({ status: 201, json: [] }); }
    return route.fulfill({ json: records[0] });
  });
  await page.route(`${supabaseOrigin}/rest/v1/employee_injury_acknowledgements*`, route => { acknowledgements.push(route.request().postDataJSON()); return route.fulfill({ json: [] }); });
  await page.route('https://script.google.com/**', route => { emails.push(route.request().postDataJSON()); return route.fulfill({ body: 'ok' }); });
  await page.goto('/employee-injury-report.html');
  await fillManualInjury(page);
  await page.locator('#witnessRows [data-key="name"]').fill('Example Witness');
  await page.locator('#witnessRows [data-key="company"]').fill('Example Trade Company');
  await page.locator('#sequenceOfEvents').fill('The crew inspected the synthetic work area.');
  await page.locator('#actionRows [data-key="action"]').fill('Install a protective barrier.');
  await page.locator('#actionRows [data-key="assignedTo"]').fill('Example Foreman');
  await page.locator('[name="occurrence"][value="Minor injury"]').check();
  await page.locator('[name="injury"][value="Minor cut / abrasion"]').check();
  await signSafetyReport(page, '#signoff0');
  await page.locator('#signoffTitle0').fill('Installer');
  await page.evaluate(() => { document.querySelector('#injuryForm').requestSubmit(); document.querySelector('#injuryForm').requestSubmit(); });
  await expect(page.locator('#saveStatus')).toContainText('Report saved. Email request sent');
  expect(records).toHaveLength(1);
  expect(acknowledgements).toHaveLength(0);
  expect(records[0].employee_worker).toMatch(/^manual:/);
  expect(records[0].report_details.employee.company).toBe('Example Trade Company');
  expect(records[0].report_details.witnesses[0].name).toBe('Example Witness');
  expect(records[0].report_details.actions[0].action).toBe('Install a protective barrier.');
  expect(records[0].report_details.signatures[0].strokes.length).toBeGreaterThan(0);
  expect(emails[0].pdfHtml).toContain('data:image/png;base64,');
  expect(emails[0].pdfHtml).toContain('Example Witness');
  await page.goto('/employee-injury-report.html?reportId=' + records[0].id);
  await expect(page.locator('#downloadSavedReport')).toBeVisible();
  await expect(page.frameLocator('iframe').getByText('Example Witness')).toBeVisible();
  await expect(page.frameLocator('iframe').getByAltText('Signature')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.locator('#downloadSavedReport').click();
  await (await download).saveAs(testInfo.outputPath('jgc-injury-report.pdf'));
  await page.screenshot({ path: testInfo.outputPath('saved-injury.png'), fullPage: true });
  const emailPreview = await page.context().newPage();
  await emailPreview.setContent(emails[0].pdfHtml);
  await emailPreview.evaluate(() => Promise.all(Array.from(document.images, img => img.decode())));
  await emailPreview.pdf({ path: testInfo.outputPath('jgc-injury-email.pdf'), format: 'Letter', printBackground: true, preferCSSPageSize: true });
  await emailPreview.close();

});

test('injury redesign required fields, save retry and portal acknowledgement failure do not duplicate records', async ({ page }) => {
  await installAuthenticatedPortalState(page); await mockPortalServices(page);
  let attempts = 0, ackAttempts = 0;
  await page.route(`${supabaseOrigin}/rest/v1/employee_injury_reports*`, route => { attempts++; return attempts === 1 ? route.fulfill({ status: 503, json: { message: 'Unavailable' } }) : route.fulfill({ status: 201, json: [] }); });
  await page.route(`${supabaseOrigin}/rest/v1/employee_injury_acknowledgements*`, route => { ackAttempts++; return route.fulfill({ status: 503, json: { message: 'Unavailable' } }); });
  await page.route('https://script.google.com/**', route => route.abort());
  await page.goto('/employee-injury-report.html');
  await page.locator('#saveReport').click();
  await expect(page.locator('#saveStatus')).toContainText('required');
  expect(attempts).toBe(0);
  await page.locator('#accidentLocation').evaluate(el => { el.value = 'Synthetic job'; });
  await page.locator('#accidentDescription').fill('Test incident');
  await page.locator('#saveReport').click();
  await expect(page.locator('#saveStatus')).toContainText('could not be saved');
  await expect(page.locator('#accidentDescription')).toHaveValue('Test incident');
  await page.locator('#saveReport').click();
  await expect(page.locator('#saveStatus')).toContainText('Report saved, but the email request failed');
  await expect(page.locator('#saveStatus')).toContainText('acknowledgement');
  expect(attempts).toBe(2); expect(ackAttempts).toBe(1);
  await expect(page.locator('#saveReport')).toBeDisabled();
});

test('supervisor report manual names, signature and email PDF preserve the entered person', async ({ page }, testInfo) => {
  await installAuthenticatedPortalState(page); await mockPortalServices(page, fakeProfile, { themePreferenceState: { theme: 'light' } });
  let saved, ackCount = 0;
  await page.route(`${supabaseOrigin}/rest/v1/accident_reports*`, route => { saved = route.request().postDataJSON(); return route.fulfill({ status: 201, json: [] }); });
  await page.route(`${supabaseOrigin}/rest/v1/accident_report_acknowledgements*`, route => { ackCount++; return route.fulfill({ json: [] }); });
  await page.route('https://script.google.com/**', route => route.fulfill({ body: 'ok' }));
  await page.goto('/accident-report.html');
  await page.locator('#injuredEmployee').selectOption('__manual__');
  await page.locator('#injuredEmployeeName').fill('Synthetic Trade Worker');
  await page.locator('#injuredEmployeeCompany').fill('Example Subcontractor');
  await page.locator('#reportMaker').selectOption('__manual__');
  await page.locator('#reportMakerName').fill('Synthetic Foreman');
  await page.locator('#siteLocation').evaluate(el => { el.value = 'Synthetic site'; });
  await page.locator('#incidentDescription').fill('Synthetic incident description.');
  await signSafetyReport(page, '#supervisorSignatureBox');
  await page.locator('#saveAccidentReport').click();
  await expect(page.locator('#saveStatus')).toContainText('Report saved.');
  expect(saved.injured_worker_display).toBe('Synthetic Trade Worker');
  expect(saved.report_details.signatures).toHaveLength(1); expect(ackCount).toBe(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  await (await download).saveAs(testInfo.outputPath('jgc-supervisor-report.pdf'));
});

for (const pageName of ['accident-report.html', 'employee-injury-report.html']) {
  for (const theme of ['light', 'dark']) {
    test(`injury redesign readable ${pageName} ${theme} on phone`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await installAuthenticatedPortalState(page); await mockPortalServices(page, fakeProfile, { themePreferenceState: { theme } });
      await page.goto('/' + pageName);
      await expect(page.locator('html')).toHaveAttribute('data-jgc-theme', theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const contrast = await page.locator('.checks label').first().evaluate(el => {
        const rgb = c => c.match(/[\d.]+/g).slice(0,3).map(Number).map(n => n/255).map(n => n <= .04045 ? n/12.92 : ((n+.055)/1.055)**2.4);
        const lum = c => { const x=rgb(c); return .2126*x[0]+.7152*x[1]+.0722*x[2]; };
        const text=lum(getComputedStyle(el).color); let parent=el;
        while (getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent=parent.parentElement;
        const bg=lum(getComputedStyle(parent).backgroundColor); return (Math.max(text,bg)+.05)/(Math.min(text,bg)+.05);
      });
      expect(contrast).toBeGreaterThan(4.5);
      await page.screenshot({ path: testInfo.outputPath(pageName + '-' + theme + '.png'), fullPage: true });
    });
  }
}

test('injury redesign legacy report PDF and denied read are handled', async ({ page }) => {
  await installAuthenticatedPortalState(page); await mockPortalServices(page);
  let denied = false;
  await page.route(`${supabaseOrigin}/rest/v1/employee_injury_reports*`, route => denied ? route.fulfill({ status: 406, json: { message: 'No row' } }) : route.fulfill({ json: { id: 'legacy-test', employee_name: 'Legacy Synthetic', accident_date: '2026-09-18', accident_description: 'Legacy narrative', witnesses: 'Legacy Witness', employee_signature: 'Legacy typed signature', signature_date: '2026-09-18' } }));
  await page.goto('/employee-injury-report.html?reportId=legacy-test');
  await expect(page.frameLocator('iframe').getByText('Legacy Witness')).toBeVisible();
  await expect(page.frameLocator('iframe').getByText('Legacy typed signature', { exact: false })).toBeVisible();
  denied = true;
  await page.reload();
  await expect(page.locator('#saveStatus')).toContainText('Report unavailable');
  await expect(page.locator('#injuryForm')).toBeHidden();
});

test('injury redesign long narratives generate complete paginated PDF', async ({ page }, testInfo) => {
  await installAuthenticatedPortalState(page); await mockPortalServices(page);
  await page.goto('/employee-injury-report.html');
  await fillManualInjury(page);
  await page.locator('#accidentDescription').fill(('Synthetic investigation detail. ').repeat(130) + ' FINAL NARRATIVE MARKER');
  await page.locator('#preventionRecommendation').fill('FINAL PREVENTION MARKER');
  const download = page.waitForEvent('download');
  await page.locator('#downloadReport').click();
  await (await download).saveAs(testInfo.outputPath('jgc-injury-long.pdf'));
  // Dismiss only this synthetic unsaved draft.
  page.on('dialog', dialog => dialog.accept());
});

test('injury redesign touch signature survives resize and can be cleared', async ({ page, context }) => {
  await installAuthenticatedPortalState(page); await mockPortalServices(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/employee-injury-report.html');
  await page.locator('#signoff1').getByRole('button', { name: 'Add signature', exact: true }).click();
  await page.locator('#safetySignaturePrintedName').fill('Synthetic Touch Signer');
  const box = await page.locator('.safety-signature-pad').boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 20, y: box.y + 40 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 80, y: box.y + 70 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 140, y: box.y + 30 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.setViewportSize({ width: 640, height: 700 });
  await page.getByRole('button', { name: 'Confirm signature', exact: true }).click();
  await expect(page.locator('#signoff1 img')).toBeVisible();
  expect(await page.evaluate(() => JGCSafetyReport.signature('signoff1').strokes[0].length)).toBe(3);
  await page.locator('#signoff1').getByRole('button', { name: 'Clear signature' }).click();
  await expect(page.locator('#signoff1 img')).toHaveCount(0);
});

async function expectReadableText(locator, label) {
  const samples = await locator.evaluateAll(elements => {
    // Browser color resolution handles rgb(), color(srgb ...) and color-mix consistently.
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const c=ctx.getImageData(0,0,1,1).data;return [c[0],c[1],c[2],c[3]/255];};
    const over = (a,b) => [0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3])).concat(1);
    const lum = c => { const x=c.slice(0,3).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return .2126*x[0]+.7152*x[1]+.0722*x[2]; };
    return elements.filter(el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden' && (el.textContent.trim()||el.value)).map(el=>{
      const chain=[];for(let p=el;p;p=p.parentElement)chain.unshift(p);
      let bg=[255,255,255,1];for(const p of chain)bg=over(rgba(getComputedStyle(p).backgroundColor),bg);
      const css=getComputedStyle(el);const fg=over(rgba(css.webkitTextFillColor||css.color),bg);
      return {text:(el.textContent||el.value).trim().slice(0,65),ratio:(Math.max(lum(fg),lum(bg))+.05)/(Math.min(lum(fg),lum(bg))+.05)};
    });
  });
  expect(samples.length, label+' has visible content').toBeGreaterThan(0);
  for (const sample of samples) expect(sample.ratio, label+': '+sample.text).toBeGreaterThanOrEqual(4.5);
}

for (const theme of ['light','dark']) {
  for (const width of [390,1280]) {
    for (const name of ['jsa.html','daily-site-report.html','toolbox-talks.html','incident-report.html']) {
      test(`UI readability ${name} ${theme} ${width}`, async ({ page }, testInfo) => {
        await page.setViewportSize({width,height:900});
        await installAuthenticatedPortalState(page);await mockPortalServices(page,fakeProfile,{themePreferenceState:{theme}});
        await page.goto('/'+name);
        await expect(page.locator('html')).toHaveAttribute('data-jgc-theme',theme);
        await expectReadableText(page.locator('.container label, .container h1, .container h2, .container .small, .container .subtitle, .container th, .container button:not(:disabled)'),name);
        await page.screenshot({path:testInfo.outputPath('report.png'),fullPage:true});
      });
    }
    test(`UI readability Accounts and Admin Tools ${theme} ${width}`,async({page},testInfo)=>{
      await page.setViewportSize({width,height:900});
      await installAuthenticatedPortalState(page);await mockPortalServices(page,fakeProfile,{themePreferenceState:{theme}});
      await page.goto('/accounts.html');
      const button=page.getByRole('button',{name:'Save start date',exact:true}).first();
      await expect(button).toBeVisible();
      await expectReadableText(page.locator('.panel button.secondary:not(:disabled), .status.po-create-allowed, .status.po-create-blocked'),'Account actions and permission badges');
      expect(await button.evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
      await button.focus();await expect(button).toBeFocused();
      expect(await button.evaluate(el=>parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThanOrEqual(2);
      await button.evaluate(el=>el.disabled=true);
      expect(Number(await button.evaluate(el=>getComputedStyle(el).opacity))).toBeLessThan(.7);
      await page.screenshot({path:testInfo.outputPath('accounts.png'),fullPage:true});
      await page.goto('/admin.html?tab=adminTools');
      await expect(page.locator('#adminToolsSection')).toBeVisible();
      await expectReadableText(page.locator('#adminToolsSection .admin-tool-card strong, #adminToolsSection .admin-tool-card span'),'Admin Tools');
      await page.screenshot({path:testInfo.outputPath('admin-tools.png'),fullPage:true});
    });
    test(`UI readability Accounting period navigation ${theme} ${width}`,async({page},testInfo)=>{
      await page.setViewportSize({width,height:900});
      await installAuthenticatedPortalState(page);await mockPortalServices(page,fakeProfile,{themePreferenceState:{theme}});
      await page.goto('/accounting-admin.html');
      const previous=page.locator('#accountingPreviousPeriod'),next=page.locator('#accountingNextPeriod');
      await expect(previous).toBeEnabled();await expect(next).toBeEnabled();
      await expectReadableText(previous,'Previous period');await expectReadableText(next,'Next period');await expectReadableText(page.locator('#accountingCurrentPeriod'),'Current period');
      expect(await previous.evaluate(el=>getComputedStyle(el).opacity)).toBe('1');
      await previous.hover();await expectReadableText(previous,'Hovered previous period');
      await previous.evaluate(el=>el.disabled=true);
      expect(Number(await previous.evaluate(el=>getComputedStyle(el).opacity))).toBeLessThan(.7);
      await page.screenshot({path:testInfo.outputPath('accounting.png'),fullPage:true});
    });
    test(`UI readability notification details ${theme} ${width}`,async({page},testInfo)=>{
      await page.setViewportSize({width,height:900});
      await installAuthenticatedPortalState(page);await mockPortalServices(page,fakeProfile,{themePreferenceState:{theme}});
      await page.goto('/home.html');
      await page.locator('#jgcNotificationButton').click();
      await page.evaluate(async()=>{await loadJgcNotifications();jgcNotificationRecords=[{id:'contrast-test',title:'Example notification',message:'The job details are ready to review.',created_at:new Date().toISOString()}];renderJgcNotificationPanel();});
      const content=page.locator('.jgc-notification-item-title,.jgc-notification-item-message,.jgc-notification-time');
      await expectReadableText(content,'Notification');
      await page.locator('.jgc-notification-item').first().hover();await expectReadableText(content,'Hovered notification');
      await page.screenshot({path:testInfo.outputPath('notification.png')});
    });
    test(`UI readability PO job autocomplete ${theme} ${width}`,async({page},testInfo)=>{
      await page.setViewportSize({width,height:900});
      const profile={...fakeProfile,can_create_digital_pos:true};
      await installAuthenticatedPortalState(page,profile);await mockPortalServices(page,profile,{themePreferenceState:{theme}});
      await page.route(`${supabaseOrigin}/rest/v1/jobs**`,route=>route.fulfill({json:[{id:'00000000-0000-4000-8000-000000000201',job_number:'26999',job_name:'Readable job results',customer:'Example Client',active:true}]}));
      await page.route(`${supabaseOrigin}/rest/v1/rpc/digital_po_get_device_context`,route=>route.fulfill({json:{registered:true,device_id:'00000000-0000-4000-8000-000000000203',device_status:'active',lease_expires_at:'2027-07-21T12:00:00.000Z',blocks:[{id:'00000000-0000-4000-8000-000000000204',range_start:39100,range_end:39109,next_number:39100,status:'active'}]}}));
      await page.goto('/purchase-orders.html');
      await expect(page.locator('#poNewButton')).toBeEnabled();await page.locator('#poNewButton').click();
      await page.locator('#poJobSearch').fill('26999');
      const result=page.locator('#poJobOptions [data-po-job-id]');
      await expect(result).toContainText('Readable job results');
      await page.mouse.move(0,0);await expectReadableText(result,'PO result');
      await result.hover();await expectReadableText(result,'PO hovered result');
      await result.focus();await expectReadableText(result,'PO keyboard result');
      await page.screenshot({path:testInfo.outputPath('po.png')});
      await result.click();await expect(page.locator('#poJob')).toHaveValue('00000000-0000-4000-8000-000000000201');
    });
  }
}

for (const theme of ['light','dark']) test(`UI readability saved report tables ${theme}`, async({page},testInfo)=>{
  await installAuthenticatedPortalState(page);await mockPortalServices(page,fakeProfile,{themePreferenceState:{theme}});
  const sample={id:'synthetic-report',report_date:'2026-09-19',inspection_date:'2026-09-19',created_at:'2026-09-19T12:00:00Z',project:'26999 - Example job',location:'Example location',prepared_by:'Example preparer',reported_by_name:'Example reporter',incident_type:'Near miss',severity:'Low',worker_name:'Example worker',inspection_type:'JSA',talk_title:'Example toolbox talk',presenter_name:'Example presenter',attendees:[]};
  for(const table of ['daily_site_reports','incident_reports','toolbox_talk_reports','inspection_records']) await page.route(`${supabaseOrigin}/rest/v1/${table}*`,route=>route.fulfill({json:[sample]}));
  await page.goto('/admin.html?tab=reports');
  await expect(page.locator('#reportsSection')).toBeVisible();
  for(const name of ['Daily','Jsa','NearMiss','Toolbox']){
    await page.locator('#adminReportTab'+name).click();
    await expectReadableText(page.locator('#adminReportPanel'+name+' th, #adminReportPanel'+name+' td, #adminReportPanel'+name+' td .jgc-button'),'Saved '+name+' reports');
    await page.screenshot({path:testInfo.outputPath(name+'.png'),fullPage:true});
  }
});

test('readability stylesheet resolves from nested Estimate Desk pages', async ({ page }) => {
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page, fakeProfile);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/portal-readability.css');
  await page.goto('/estimating/index.html');
  expect((await response).status()).toBe(200);
  await expect(page.locator('link[data-jgc-readability]')).toHaveAttribute('href', /\/portal-readability\.css\?v=1$/);
  expect(await page.locator('link[data-jgc-readability]').getAttribute('href')).not.toContain('/estimating/');
});

for (const mode of ['summary', 'spyglass']) test(`${mode} searches Estimator and routes converted quotes to official jobs`, async ({page}) => {
 await installAuthenticatedPortalState(page); await mockPortalServices(page);
 await page.route(`${supabaseOrigin}/rest/v1/estimator_workspaces**`, route => route.fulfill({json:{payload:{
 clients:[{id:'client-search',name:'Search Test Customer'}],
 jobs:[{id:'job-search',jobNumber:'26999',project:'Search Test Project',clientId:'client-search',quoteId:'quote-search'}],
 quotes:[{id:'quote-search',number:'JGC-Q-2026-0999',project:'Unique conversion reference',clientId:'client-search'}]
 }}}));
 await page.goto('/admin.html?tab=summary');
 if(mode === 'spyglass') { await page.locator('#jgcAdminGlobalSearchButton').click(); await page.locator('#jgcAdminGlobalSearchInput').fill('0999'); await page.locator('#jgcAdminGlobalSearchSubmit').click();
 const group=page.locator('.jgc-admin-search-group').filter({hasText:'Estimator'});await group.locator('.jgc-admin-search-group-header').click();await expect(group).toContainText('Unique conversion reference');await group.locator('[data-jgc-admin-search-result]').click();
 } else {await page.locator('#adminGlobalSearchInput').fill('0999');await page.locator('#adminGlobalSearchButton').click();const group=page.locator('.admin-global-search-group').filter({hasText:'Estimator'});await group.locator('.admin-global-search-group-header').click();await expect(group).toContainText('Unique conversion reference');
 // The pending 350ms type-ahead search must not collapse the opened result group.
 await page.waitForTimeout(450);await expect(group.locator('.admin-global-search-result button')).toBeVisible();await group.locator('.admin-global-search-result button').click();}
 await expect(page).toHaveURL(/estimating\/\?view=jobs&job=26999/);
});
async function installPreparedJsaMock(page, isAdmin = true) {
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  const state = { draft: null, record: null, acknowledgements: [], saves: 0, activations: 0, earlyWrites: [] };
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    if (/notifications/.test(request.url())) {
      const payload=request.postDataJSON();
      if ([payload].flat().some(n=>n.notification_type==='jsa_acknowledgement')) state.earlyWrites.push(request.url());
    } else if (/safety_acknowledgements|functions\/v1|script.google.com/.test(request.url())) state.earlyWrites.push(request.url());
  });
  await page.route(`${supabaseOrigin}/rest/v1/rpc/is_admin`, route => route.fulfill({json:isAdmin}));
  await page.route(`${supabaseOrigin}/rest/v1/rpc/save_prepared_jsa`, async route => {
    const p=route.request().postDataJSON(); state.saves++;
    state.draft={id:p.p_id,revision:state.saves,payload:p.p_payload,created_at:'2026-09-23T00:00:00Z',updated_at:'2026-09-23T00:00:00Z',activated_at:null};
    await route.fulfill({json:state.draft});
  });
  await page.route(`${supabaseOrigin}/rest/v1/jsa_preparations*`, route => route.fulfill({json:route.request().headers().accept?.includes('object') ? state.draft : [state.draft].filter(Boolean)}));
  await page.route(`${supabaseOrigin}/rest/v1/rpc/activate_prepared_jsa`, async route => {
    const p=route.request().postDataJSON(); state.activations++;
    state.draft={...state.draft,activated_at:'2026-09-23T01:00:00Z',record_id:state.draft.id,acknowledgement_mode:p.p_mode};
    state.record={...state.draft.payload.record,id:state.draft.id};
    state.acknowledgements=p.p_attendees.map((a,i)=>({...a,id:`00000000-0000-4000-8000-00000000010${i}`,record_id:state.draft.id,record_type:'jsa',qr_token:'synthetic-qr-token-1234567890',acknowledgement_status:'pending'}));
    await route.fulfill({json:{draft:state.draft,record:state.record,acknowledgements:state.acknowledgements}});
  });
  await page.route(`${supabaseOrigin}/rest/v1/inspection_records*`, route => route.fulfill({json:state.record || []}));
  await page.route(`${supabaseOrigin}/rest/v1/safety_acknowledgements*`, route => route.fulfill({json:state.acknowledgements}));
  return state;
}

async function fillPreparedJsa(page) {
  await page.goto('/jsa.html?prepared=new');
  await expect(page.locator('#jsaSaveDraft')).toBeEnabled();
  const select=page.locator('.jgc-project-job-select');
  await select.selectOption('__manual__');
  await page.locator('#jsaField1').fill('26999 - Synthetic construction project');
  await page.locator('#jsaField2').fill('Synthetic site - Cornwall');
  await page.locator('#jsaField3').fill('2026-11-01');
  await page.locator('#manualCrewInput').fill('Synthetic trade worker - Example subcontractor');
  await page.getByRole('button',{name:'Add Employee',exact:true}).click();
  await page.locator('#jsaLibrary summary').click();
  await page.locator('#jsaPresetSearch').fill('ladder');
  await page.locator('[data-preset]').filter({hasText:'Ladders'}).click();
  await page.locator('#jsaInsertPreset').click();
}

for (const theme of ['light','dark']) test(`JSA editable presets and stacked task cards work on phones in ${theme}`,async({page},testInfo)=>{
  await installPreparedJsaMock(page);
  await page.setViewportSize({width:390,height:844});
  await fillPreparedJsa(page);
  await page.evaluate(theme=>document.documentElement.setAttribute('data-jgc-theme',theme),theme);
  const row=page.locator('#tableBody tr').first();
  await expect(row.getByLabel('Task / job step')).toHaveValue('Ladders');
  await expect(row.getByLabel('Hazards')).toHaveValue(/Falls\nunstable footing\ndropped tools/);
  await row.getByLabel('Controls / PPE').fill('Custom site controls\nAdditional PPE');
  await expect(row.getByLabel('Controls / PPE')).toHaveValue('Custom site controls\nAdditional PPE');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const boxes=await row.locator('textarea').evaluateAll(fields=>fields.map(f=>{const r=f.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,width:r.width};}));
  expect(boxes.every(b=>b.width>250&&b.right<=390)).toBe(true);
  expect(boxes[1].y).toBeGreaterThan(boxes[0].y);
  await page.screenshot({path:testInfo.outputPath(`jsa-phone-${theme}.png`),fullPage:true});
});

test('JSA library presets are complete, categorised, unique and keep the original 20 unchanged',async()=>{
  const fs=require('fs'),vm=require('vm'),path=require('path');
  const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../jsa-presets.js'),'utf8'),sandbox);
  const presets=sandbox.window.JgcJsaPresets,categories=sandbox.window.JgcJsaPresetCategories;
  expect(presets.length).toBeGreaterThanOrEqual(90);
  expect(categories.length).toBeGreaterThanOrEqual(20);
  const norm=t=>t.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  expect(new Set(presets.map(p=>norm(p.task))).size).toBe(presets.length);
  expect(new Set(presets.map(p=>p.id)).size).toBe(presets.length);
  for(const p of presets){
    expect(categories).toContain(p.category);
    expect(p.hazards.length,p.task).toBeGreaterThan(0);
    expect(p.controls.length,p.task).toBeGreaterThan(1);
    for(const c of p.controls)expect(c.length,p.task+': '+c).toBeGreaterThan(14);
  }
  // The original library entries keep their exact wording.
  const original={Ladders:'Falls; unstable footing; dropped tools',Grinding:'Wheel failure; sparks; dust; noise; entanglement','Confined spaces':'Oxygen deficiency; toxic/flammable atmosphere; engulfment; restricted rescue','Weather and outdoor work':'Heat/cold stress; lightning; wind; ice; reduced visibility'};
  for(const [task,hazards] of Object.entries(original))expect(presets.find(p=>p.task===task).hazards.join('; ')).toBe(hazards);
  for(const task of ['Ladders','Working at heights','Power tools','Cutting and sawing','Grinding','Silica-producing work','Demolition','Manual lifting and handling','Scaffolding','Electrical work / isolation','Hot work','Excavation','Mobile equipment','Concrete placement and finishing','Chemicals / coatings','Confined spaces','Rigging and hoisting','Occupied areas / public protection','Housekeeping and access','Weather and outdoor work'])expect(presets.map(p=>p.task),task).toContain(task);
  // Every topic on the requested list has at least one task.
  const text=presets.map(p=>[p.category,p.task].join(' ').toLowerCase()).join('\n');
  for(const topic of ['ladder','scaffold','height','hand tools','power tools','knives','saw','grinding','silica','demolition','lifting','overhead','extension cords','hot work','trench','confined','concrete','whmis','vehicle','traffic','housekeeping','heat','cold','noise','spill','lockout','first aid','eyewash'])expect(text,topic).toContain(topic);
});

test('JSA library filters by category, merges admin custom tasks and inserts editable copies',async({page},testInfo)=>{
  await installPreparedJsaMock(page);
  const custom={id:'11111111-2222-4333-8444-555555555555',category:'General building trades',task:'Installing washroom partitions',hazards:['Heavy panels','Pinch points'],controls:['Two-person lift for panels','Keep fingers clear of hinge side when fastening']};
  await page.route(`${supabaseOrigin}/rest/v1/jsa_library_items*`,route=>route.fulfill({json:[custom]}));
  await page.goto('/jsa.html?prepared=new');
  await expect(page.locator('#jsaSaveDraft')).toBeEnabled();
  await page.locator('#jsaLibrary summary').click();
  await expect(page.locator('#jsaLibraryManage')).toBeVisible();
  await page.locator('#jsaPresetCategory').selectOption('Excavation & trenching');
  const groups=page.locator('.jsa-preset-group');
  await expect(groups).toHaveCount(1);
  await expect(groups.first().locator('h3')).toHaveText('Excavation & trenching');
  await expect(groups.first().locator('[data-preset]')).toContainText(['Excavation','Trenching and shoring']);
  await page.locator('#jsaPresetCategory').selectOption('');
  await page.locator('#jsaPresetSearch').fill('partitions');
  const customButton=page.locator('[data-preset="custom:'+custom.id+'"]');
  await expect(customButton).toContainText('JGC custom');
  await customButton.click();
  await page.locator('[data-preset-part="hazards"]').nth(1).uncheck();
  await page.locator('#jsaInsertPreset').click();
  const row=page.locator('#tableBody tr').first();
  await expect(row.getByLabel('Task / job step')).toHaveValue('Installing washroom partitions');
  await expect(row.getByLabel('Hazards')).toHaveValue('Heavy panels');
  await expect(row.getByLabel('Controls / PPE')).toHaveValue('Two-person lift for panels\nKeep fingers clear of hinge side when fastening');
  await row.getByLabel('Hazards').fill('Heavy panels\nSite-specific: wet floor');
  await page.locator('#jsaLibrary summary').click();
  await page.locator('#jsaPresetSearch').fill('trench');
  await page.locator('[data-preset]').filter({hasText:'Trenching and shoring'}).click();
  await expect(page.locator('#jsaPresetDetail')).toContainText('Trenches deeper than 1.2 m need sloping, shoring or a trench box');
  await page.locator('#jsaLibrary').screenshot({path:testInfo.outputPath('jsa-library-panel.png')});
  await page.locator('#jsaInsertPreset').click();
  await expect(page.locator('#tableBody tr').nth(1).getByLabel('Task / job step')).toHaveValue('Trenching and shoring');
  await page.locator('#jsaLibrary summary').click();
  await page.locator('#jsaPresetSearch').fill('partitions');
  await page.locator('[data-preset="custom:'+custom.id+'"]').click();
  await expect(page.locator('#jsaPresetDetail')).not.toContainText('wet floor');
  await expect(page.locator('#jsaPresetDetail label')).toHaveCount(4);
});

test('JSA draft saves and reopens planned crew without assignment, then activates through existing signatures',async({page})=>{
  const state=await installPreparedJsaMock(page); await fillPreparedJsa(page);
  await expect(page.locator('#jsaSignoffChoiceSection')).toBeHidden();
  await page.locator('#jsaSaveDraft').click();
  await expect(page.locator('#jsaDraftStatus')).toContainText('Draft saved');
  expect(state.earlyWrites).toEqual([]);expect(state.activations).toBe(0);
  expect(state.draft.payload.record.form_data.fields.find(f=>f.label==='Project / Job').value).toContain('26999');
  await page.goto('/prepared-jsas.html');
  await expect(page.locator('.prepared-jsa-card')).toHaveCount(1);
  await page.locator('#preparedSearch').fill('26999');
  await page.locator('.prepared-jsa-card a').click();
  await expect(page.locator('#jsaSaveDraft')).toBeEnabled();
  await expect(page.locator('#crewSignOffCombined')).toHaveValue(/Synthetic trade worker/);
  await expect(page.locator('#tableBody textarea').first()).toHaveValue('Ladders');
  await expect(page.locator('#jsaField1')).toHaveValue(/26999/);
  await page.locator('#jsaActivate').click();
  await page.locator('#jsaChoiceEmployees').click();
  await expect(page.locator('#jsaPreparationTitle')).toHaveText('Active / Assigned');
  await expect(page.locator('#jsaPostSaveQrPanel')).toContainText('Employee');
  await expect(page.locator('#jsaSubmitButton')).toBeHidden();
  expect(state.activations).toBe(1);expect(state.earlyWrites).toEqual([]);
  await page.reload();await expect(page.locator('#jsaPreparationTitle')).toHaveText('Active / Assigned');
  await expect(page.locator('#jsaSaveDraft')).toBeDisabled();
  expect(state.activations).toBe(1);expect(state.earlyWrites).toEqual([]);
});

test('JSA preparation requires admin and incomplete activation highlights required fields',async({page})=>{
  await installPreparedJsaMock(page);await page.goto('/jsa.html?prepared=new');
  await expect(page.locator('#jsaActivate')).toBeEnabled();await page.locator('#jsaActivate').click();
  await expect(page.locator('#jsaDraftStatus')).toContainText('required');
  await expect(page.locator('#jsaField1')).toHaveAttribute('aria-invalid','true');
  await expect(page.locator('#jsaSignoffChoiceSection')).toBeHidden();
  await page.route(`${supabaseOrigin}/rest/v1/rpc/is_admin`,route=>route.fulfill({json:false}));
  await page.reload();await expect(page.locator('.container')).toContainText('approved administrators only');
  await expect(page.locator('#jsaSaveDraft')).toHaveCount(0);
});

test('JSA PDF preserves long controls and existing signatures and clearly marks prepared copies',async({page},testInfo)=>{
  await installPreparedJsaMock(page);await fillPreparedJsa(page);
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#jsaDraftPdf').click();
  const download=await downloadPromise;
  await download.saveAs(testInfo.outputPath('jsa-prepared-short.pdf'));
  await expect(page.locator('#jsaDraftStatus')).toContainText('No crew assigned');
  const outputs=await page.evaluate(async()=>{
    const {record}=await buildInspectionRecord('JSA',getCurrentWorker());
    record.form_data.rows[0].cells[2]=Array.from({length:65},(_,i)=>`Control ${i+1}: Confirm the synthetic work area is controlled and review this instruction with the crew.`).join('\n');
    const ack={attendee_name:'Synthetic Signed Worker',attendee_company:'JGC',acknowledged_at:'2026-09-23T01:00:00Z',signature_strokes:[[[.1,.2],[.5,.8],[.9,.2]]],signature_width:400,signature_height:180,matched_employee_email:'synthetic@example.com'};
    const prepared=await JgcJsaPdf.create(record,{prepared:true,acknowledgements:[ack]});
    const active=await JgcJsaPdf.create(record,{acknowledgements:[ack]});
    return {prepared:prepared.output('datauristring').split(',')[1],active:active.output('datauristring').split(',')[1]};
  });
  const pdfjs=await import(require('node:url').pathToFileURL(path.resolve(process.env.JGC_PDFJS_MODULE || 'C:/Users/Zeth/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  for(const [kind,base64] of Object.entries(outputs)){
    const bytes=Buffer.from(base64,'base64');
    fs.writeFileSync(testInfo.outputPath(`jsa-${kind}.pdf`),Buffer.from(bytes));
    const doc=await pdfjs.getDocument({data:new Uint8Array(bytes),disableWorker:true}).promise;
    let text='';for(let n=1;n<=doc.numPages;n++){const p=await doc.getPage(n);text+=(await p.getTextContent()).items.map(i=>i.str).join(' ');}
    expect(text).toContain('Control 65:');expect(doc.numPages).toBeGreaterThan(1);
    if(kind==='prepared'){expect(text).toContain('PREPARED / DRAFT');expect(text).not.toContain('Synthetic Signed Worker');}
    else {expect(text).toContain('DIGITAL JSA ACKNOWLEDGMENTS');expect(text).toContain('Synthetic Signed Worker');}
  }
});

async function mockDashboard(page, options={}) {
  await installAuthenticatedPortalState(page);
  await mockPortalServices(page,fakeProfile,{themePreferenceState:{theme:options.theme||'light'}});
  const state={layout:options.layout||null,writes:[],failSave:false};
  await page.route(`${supabaseOrigin}/rest/v1/rpc/is_admin`,route=>route.fulfill({json:options.admin!==false}));
  await page.route(`${supabaseOrigin}/rest/v1/portal_dashboard_layouts*`,async route=>{
    if(route.request().method()==='POST'){
      if(state.failSave)return route.fulfill({status:400,json:{message:'Synthetic offline sync'}});
      const body=route.request().postDataJSON();state.layout=body.layout;state.writes.push(body);return route.fulfill({json:[]});
    }
    return route.fulfill({json:state.layout?{layout:state.layout}:null});
  });
  await page.route(`${supabaseOrigin}/rest/v1/estimator_workspaces*`,route=>route.fulfill({json:{payload:{clients:[{id:'c',name:'Synthetic Client'}],jobs:[{id:'j',quoteId:'converted',jobNumber:'26999'}],quotes:[{id:'converted',number:'Q-OLD',project:'Already converted',jobId:'j'}, {id:'q',number:'Q-NEW',clientId:'c',project:'Dashboard test project',status:'Draft',updatedAt:'2026-09-22T12:00:00Z'}],activity:[{id:'a',quoteId:'q',title:'Quote updated',detail:'Synthetic activity',createdAt:'2026-09-22T12:00:00Z'}]}}}));
  await page.route(`${supabaseOrigin}/rest/v1/jobs*`,route=>route.fulfill({json:[{id:'j',job_number:'26999',job_name:'Dashboard project',customer:'Synthetic Client',active:true,job_type:'Contract'}]}));
  await page.route(`${supabaseOrigin}/rest/v1/work_orders*`,route=>route.fulfill({headers:{'content-range':'0-0/6','access-control-expose-headers':'content-range'},json:[{id:'wo',wo_number:'WO-TEST',customer:'Synthetic Client',job_name:'Dashboard project',status:'draft'}]}));
  await page.route(`${supabaseOrigin}/rest/v1/digital_purchase_orders*`,route=>route.fulfill({headers:{'content-range':'0-0/14','access-control-expose-headers':'content-range'},json:[{id:'po',po_number:39999,supplier_name:'Synthetic Supplier',job_number:'26999',workflow_status:'draft'}]}));
  await page.route(`${supabaseOrigin}/rest/v1/tasks*`,route=>route.fulfill({json:[{id:'t',title:'Order synthetic material',status:'open',priority:'high',due_date:'2026-09-23'}]}));
  await page.route(`${supabaseOrigin}/rest/v1/announcements*`,route=>route.fulfill({json:[{id:'a',title:'Synthetic safety notice',body:'Review site conditions',is_active:true,created_at:'2026-09-22T12:00:00Z'}]}));
  await page.route(`${supabaseOrigin}/rest/v1/vacation_requests*`,route=>route.fulfill({json:options.vacations||[]}));
  await page.route(`${supabaseOrigin}/rest/v1/equipment_vehicles*`,route=>route.fulfill({json:options.equipment||[]}));
  // Missing-timesheet inputs are only overridden when a test supplies them; profiles only for the dashboard's hire-date query.
  const accounting=options.accounting;
  if(accounting)for(const [table,rows] of Object.entries({profiles:accounting.profiles,work_order_labour_workers:accounting.workers,employee_feature_access:accounting.access,accounting_timesheet_submissions:accounting.submissions,timesheet_entries:accounting.live}))
   await page.route(`${supabaseOrigin}/rest/v1/${table}*`,route=>{const u=decodeURIComponent(route.request().url());return route.request().method()==='GET'&&(table!=='profiles'||u.includes('hire_date'))?route.fulfill({json:rows||[]}):route.fallback();});
  return state;
}

async function toggleDashboardEditing(page) {
 if(await page.locator('#dashboardDoneEditing').isVisible()){await page.locator('#dashboardDoneEditing').click();return;}
 if(!await page.locator('#jgcAppearanceSettingsPanel').isVisible())await page.locator('#jgcAppearanceSettingsButton').click();
 await page.locator('#dashboardEdit').click();
}
async function openDashboardWidgetMenu(page) {
 if(!await page.locator('#jgcAppearanceSettingsPanel').isVisible())await page.locator('#jgcAppearanceSettingsButton').click();
 if(!await page.locator('#dashboardMenu').isVisible())await page.locator('#dashboardMenuToggle').click();
}

for(const theme of ['light','dark'])for(const width of [390,1440])test(`Dashboard gear settings contain layout and widget controls ${theme} ${width}`,async({page},testInfo)=>{
 const state=await mockDashboard(page,{theme});await page.setViewportSize({width,height:1000});await page.goto('/admin.html?tab=summary');await expect(page.locator('#dashboardEdit')).toBeEnabled();
 await expect(page.locator('#dashboardEdit')).toBeHidden();await expect(page.locator('#dashboardMenuToggle')).toBeHidden();await expect(page.locator('.dashboard-heading')).not.toContainText('Edit layout');await expect(page.locator('#dashboardRefresh')).toBeVisible();
 await page.getByRole('button',{name:'Open appearance settings',exact:true}).click();
 await expect(page.locator('#jgcAppearanceSettingsPanel #dashboardEdit')).toBeVisible();await expect(page.locator('[data-jgc-theme-choice="light"]')).toBeVisible();
 await page.locator('#dashboardEdit').click();await expect(page.locator('#jgcAppearanceSettingsPanel')).toBeHidden();await expect(page.locator('#dashboardDoneEditing')).toBeFocused();
 await page.locator('#dashboardDoneEditing').click();await expect(page.locator('#dashboardDoneEditing')).toBeHidden();await expect(page.locator('#jgcAppearanceSettingsButton')).toBeFocused();
 await openDashboardWidgetMenu(page);await page.locator('#dashboardWidgetChoices input[value="tasks"]').uncheck();await expect(page.locator('[data-widget="tasks"]')).toBeHidden();await expect.poll(()=>state.layout?.widgets.find(w=>w.id==='tasks').visible).toBe(false);
 await page.locator('#dashboardWidgetChoices input[value="tasks"]').check();await expect(page.locator('[data-widget="tasks"]')).toBeVisible();
 await expectReadableText(page.locator('#dashboardSettings h3, #dashboardSettings button, #dashboardSettings label'),'Gear settings '+theme);
 const box=await page.locator('#jgcAppearanceSettingsPanel').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);expect(box.y+box.height).toBeLessThanOrEqual(1001);
 await page.screenshot({path:testInfo.outputPath('gear-settings.png')});
 await page.keyboard.press('Escape');await expect(page.locator('#jgcAppearanceSettingsPanel')).toBeHidden();
 await page.locator('#timesheetsTab').click();await page.locator('#jgcAppearanceSettingsButton').click();await expect(page.locator('#dashboardSettings')).toBeHidden();
});

test('Dashboard saves layout, hides/restores widgets, resets, and preserves the shared calendar',async({page})=>{
 const state=await mockDashboard(page);await page.goto('/admin.html?tab=summary');
 await expect(page.locator('#dashboardEdit')).toBeEnabled();
 await expect(page.locator('[data-widget="active-jobs"]')).toContainText('26999');
 await expect(page.locator('[data-widget="quotes"] .dashboard-metric strong')).toHaveText('1');
 await expect(page.locator('[data-widget="work-orders"] .dashboard-metric strong')).toHaveText('6');
 await expect(page.locator('[data-widget="purchase-orders"] .dashboard-metric strong')).toHaveText('14');
 await expect(page.locator('[data-widget="calendar"] #adminScheduleCalendar')).toBeVisible();
 await toggleDashboardEditing(page);
 const card=page.locator('[data-widget="tasks"]');await card.getByRole('button',{name:'Customize Tasks / Follow-Ups'}).click();await page.getByLabel('Tasks / Follow-Ups width',{exact:true}).selectOption('6');
 await page.getByLabel('Move Tasks / Follow-Ups earlier',{exact:true}).click();
 await page.getByLabel('Hide Tasks / Follow-Ups',{exact:true}).click();
 await expect(card).toBeHidden();await expect.poll(()=>state.writes.length).toBeGreaterThan(0);
 await expect(page.locator('#dashboardLayoutStatus')).toHaveText('Layout saved to your account.');
 expect(state.layout.widgets.find(w=>w.id==='tasks')).toMatchObject({width:6,visible:false});
 await page.reload();await expect(page.locator('#dashboardEdit')).toBeEnabled();await expect(card).toBeHidden();
 await openDashboardWidgetMenu(page);await page.locator('#dashboardWidgetChoices input[value="tasks"]').check();await expect(card).toBeVisible();
 await page.locator('#dashboardReset').click();await expect.poll(()=>state.layout.widgets.find(w=>w.id==='tasks').width).toBe(4);
 await page.keyboard.press('Control+k');await expect(page.locator('#adminGlobalSearchInput')).toBeFocused();
 await expect(page.getByRole('link',{name:'Start New Quote',exact:true})).toHaveAttribute('href','estimating/?newQuote=1');
});

test('Dashboard approved default layout applies to new accounts and Reset while preserving personal layouts',async({page})=>{
 const state=await mockDashboard(page);await page.setViewportSize({width:1440,height:1100});await page.goto('/admin.html?tab=summary');await expect(page.locator('#dashboardEdit')).toBeEnabled();
 const expected=[['jobs-stat',3,63,0,0],['quotes',3,61,3,0],['work-orders',3,62,6,0],['purchase-orders',3,62,9,0],['vacation',4,62,0,77],['equipment-expiry',4,62,4,77],['missing-timesheets',4,62,8,77],['calendar',7,636,0,154],['recent',5,299,7,156],['active-jobs',5,311,7,476],['subcontractors',4,280,0,804],['tasks',4,280,4,804],['announcements',4,280,8,804]];
 const read=()=>page.locator('.dashboard-widget').evaluateAll(els=>els.map(e=>[e.dataset.widget,Number(e.style.getPropertyValue('--widget-width')),parseInt(e.style.getPropertyValue('--widget-height')),Number(e.style.getPropertyValue('--widget-x'))-1,Number(e.style.getPropertyValue('--widget-y'))-1]));
 expect(await read()).toEqual(expected);expect(state.writes).toHaveLength(0);
 await page.locator('[data-widget="recent"] .dashboard-widget-options').click();await page.getByLabel('Recent Work width',{exact:true}).selectOption('4');
 await expect(page.locator('#dashboardLayoutStatus')).toHaveText('Layout saved to your account.');const personal=await read();
 await page.reload();await expect(page.locator('#dashboardEdit')).toBeEnabled();expect(await read()).toEqual(personal);
 await openDashboardWidgetMenu(page);await page.locator('#dashboardReset').click();
 await expect(page.locator('#dashboardLayoutStatus')).toHaveText('Layout saved to your account.');expect(await read()).toEqual(expected);
 await page.reload();await expect(page.locator('#dashboardEdit')).toBeEnabled();expect(await read()).toEqual(expected);
});

test('Dashboard counters show pending vacation, 30-day expiries and last pay period missing timesheets',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-09-25T16:00:00Z'));
 await mockDashboard(page,{
  vacations:[{id:'v1',worker_display_name:'Synthetic Painter',start_date:'2026-10-05',end_date:'2026-10-09',request_type:'vacation_paid',status:'pending'},{id:'v2',worker_name:'Synthetic Labourer',start_date:'2026-10-14',end_date:'2026-10-14',status:null}],
  equipment:[{id:'e1',name:'Synthetic Scissor Lift',unit_number:'SL-7',yearly_inspection_expiry:'2026-10-03'},{id:'e2',name:'Synthetic Truck',yearly_inspection_expiry:'2026-09-01'},{id:'e3',name:'Synthetic Trailer',yearly_inspection_expiry:'2026-09-20'}],
  accounting:{
   profiles:[{id:'p-a',display_name:'Synthetic Framer',hire_date:null},{id:'p-b',display_name:'Synthetic New Hire',hire_date:'2026-09-14'},{id:'p-c',display_name:'Synthetic Office',hire_date:null}],
   workers:[{id:'w-a',profile_id:'p-a',approved:true},{id:'w-b',profile_id:'p-b',approved:true},{id:'w-c',profile_id:'p-c',approved:true}],
   access:[{worker_id:'w-a',feature_key:'accounting',enabled:true},{worker_id:'w-b',feature_key:'accounting',enabled:true}],
   submissions:[{profile_id:'p-a',week_start:'2026-08-30'}],live:[]
  }
 });
 await page.goto('/admin.html?tab=summary');await expect(page.locator('#dashboardEdit')).toBeEnabled();
 const vacation=page.locator('[data-widget="vacation"]');
 await expect(vacation.locator('.dashboard-metric strong')).toHaveText('2');
 await expect(vacation.locator('a.dashboard-metric')).toHaveAttribute('href','admin.html?tab=vacation');
 const expiry=page.locator('[data-widget="equipment-expiry"]');
 await expect(expiry.locator('.dashboard-metric strong')).toHaveText('1');
 await expect(expiry.locator('.dashboard-metric-alert')).toHaveText('2 expired');
 await expect(expiry.locator('.dashboard-metric-alert')).toBeVisible();await expectReadableText(expiry.locator('.dashboard-metric-alert'),'Expired equipment note');
 await expect(expiry.locator('a.dashboard-metric')).toHaveAttribute('href','admin.html?tab=equipment');
 // Sep 25 is inside the pay period ending Sep 26, so the last completed one is Aug 30 – Sep 12 (paid Sep 17).
 // Framer submitted week 1 only; New Hire started after that period; Office has no accounting access.
 const missing=page.locator('[data-widget="missing-timesheets"]');
 await expect(missing.locator('.dashboard-metric strong')).toHaveText('1');
 await expect(missing.locator('a.dashboard-metric')).toHaveAttribute('href','accounting-admin.html?payDate=2026-09-17');
 await missing.locator('.dashboard-widget-options').click();await page.getByLabel('Missing Timesheets height',{exact:true}).selectOption('280');
 await expect(missing.locator('.dashboard-list')).toContainText('Synthetic Framer');await expect(missing.locator('.dashboard-list')).toContainText('Week of Sep 6');
 await expect(missing.locator('.dashboard-list')).not.toContainText('Synthetic New Hire');
});

for(const theme of ['light','dark'])test(`Dashboard calendar keeps two items per day and reveals the rest from +N ${theme}`,async({page},testInfo)=>{
 await mockDashboard(page,{theme});await page.setViewportSize({width:1440,height:1100});await page.goto('/admin.html?tab=summary');await expect(page.locator('#dashboardEdit')).toBeEnabled();
 const card=page.locator('[data-widget="calendar"]');
 await page.evaluate(()=>{adminScheduleMonth=new Date(2026,7,1);scheduleEvents=['Pour footings','Crane lift','Inspection walk','Deliver rebar','Safety meeting'].map((title,i)=>({id:'busy-'+i,event_date:'2026-08-18',event_type:'work',title,start_time:'0'+(7+i)+':00'})).concat([{id:'quiet',event_date:'2026-08-19',event_type:'work',title:'Single item',start_time:'08:00'}]);renderAdminScheduleCalendar();});
 const busy=card.getByRole('button',{name:/^Tuesday, August 18, 2026/}),quiet=card.getByRole('button',{name:/^Wednesday, August 19, 2026/});
 await expect(busy.locator('.admin-schedule-day-list .admin-schedule-item')).toHaveCount(2);
 const more=busy.getByRole('button',{name:'Show 3 more on Tuesday, August 18, 2026'});await expect(more).toHaveText('+3');
 await expectReadableText(more,'Calendar +N '+theme);
 const heights=await Promise.all([busy,quiet].map(d=>d.evaluate(el=>el.getBoundingClientRect().height)));expect(Math.abs(heights[0]-heights[1])).toBeLessThan(1);
 for(const item of await busy.locator('.admin-schedule-day-list .admin-schedule-item').all()){const box=await item.boundingBox(),day=await busy.boundingBox();expect(box.height).toBeGreaterThan(6);expect(box.y+box.height).toBeLessThanOrEqual(day.y+day.height+0.5);}
 await card.scrollIntoViewIfNeeded();await more.click();
 const list=page.getByRole('dialog',{name:'All items on Tuesday, August 18, 2026'});
 await expect(list).toBeVisible();await expect(list.locator('.admin-schedule-item')).toHaveCount(5);await expect(list).toContainText('Safety meeting');
 await expect(page.locator('#adminScheduleModal')).not.toHaveClass(/open/);await expect(more).toHaveAttribute('aria-expanded','true');
 // A viewport screenshot keeps the page still; scrolling closes the pinned list by design.
 await expectReadableText(list.locator('strong, .admin-schedule-overflow-open'),'Calendar overflow list '+theme);
 await page.screenshot({path:testInfo.outputPath('calendar-overflow-page.png')});await expect(list).toBeVisible();
 await page.keyboard.press('Escape');await expect(list).toBeHidden();await expect(more).toBeFocused();
 await more.click();await list.getByRole('button',{name:/Safety meeting/}).click();await expect(list).toBeHidden();await expect(page.locator('#adminScheduleModal')).toHaveClass(/open/);
});

for(const theme of ['light','dark'])for(const width of [390,1440])test(`Accounting search bar opens the shared Portal search ${theme} ${width}`,async({page},testInfo)=>{
 await installAuthenticatedPortalState(page);await mockPortalServices(page,fakeProfile,{themePreferenceState:{theme}});
 await page.setViewportSize({width,height:900});await page.goto('/accounting-admin.html',{waitUntil:'domcontentloaded'});
 const bar=page.getByRole('search');const input=page.getByRole('searchbox',{name:'Search the Portal and Estimate Desk'});
 await expect(input).toBeVisible();
 const box=await bar.boundingBox();expect(box.height).toBeLessThanOrEqual(52);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await expectReadableText(page.locator('#accountingSearchButton'),'Accounting search button '+theme);
 await input.fill('a');await input.press('Enter');await expect(page.locator('#accountingSearchStatus')).toHaveText('Enter at least 2 characters.');
 await expect(page.locator('#jgcAdminGlobalSearchInput')).toBeAttached();
 await input.fill('26090');await page.getByRole('button',{name:'Search',exact:true}).first().click();
 const panel=page.locator('#jgcAdminGlobalSearchPanel');await expect(panel).toBeVisible();
 await expect(page.locator('#jgcAdminGlobalSearchInput')).toHaveValue('26090');
 await expect(page.locator('#jgcAdminGlobalSearchStatus')).toContainText('26090');
 await expect(page.locator('#accountingSearchStatus')).toBeHidden();
 await page.screenshot({path:testInfo.outputPath('accounting-search.png')});
});

test('Accounting opens the pay period requested by the Summary link and ignores invalid dates',async({page})=>{
 await installAuthenticatedPortalState(page);await mockPortalServices(page,fakeProfile);
 await page.goto('/accounting-admin.html?payDate=2026-09-03',{waitUntil:'domcontentloaded'});await expect(page.locator('#accountingPayDate')).toHaveValue('2026-09-03');
 await page.goto('/accounting-admin.html?payDate=2026-09-04',{waitUntil:'domcontentloaded'});await expect(page.locator('#accountingPayDate')).not.toHaveValue('2026-09-04');
});

for(const theme of ['light','dark'])test(`Equipment entry panel heading and labels are readable ${theme}`,async({page})=>{
 await installAuthenticatedPortalState(page);await mockPortalServices(page,fakeProfile,{themePreferenceState:{theme}});
 await page.setViewportSize({width:1440,height:1000});await page.goto('/admin.html?tab=equipment');
 const panel=page.locator('#equipmentEntryPanel');await expect(panel).toBeVisible({timeout:10000});
 await expectReadableText(panel.locator(':scope > summary'),'Equipment entry heading '+theme);
 await panel.locator(':scope > summary').click();await expect(panel).toHaveAttribute('open','');
 await expectReadableText(panel.locator('label:visible'),'Equipment entry labels '+theme);
});

test('Dashboard pointer drag and resize persist without changing business records',async({page})=>{
 const state=await mockDashboard(page);await page.setViewportSize({width:1440,height:1100});await page.goto('/admin.html?tab=summary');await expect(page.locator('#dashboardEdit')).toBeEnabled();await toggleDashboardEditing(page);
 const card=page.locator('[data-widget="recent"]');await card.scrollIntoViewIfNeeded();
 const header=await card.locator('.dashboard-widget-header').boundingBox();
 await page.mouse.move(header.x+70,header.y+20);await page.mouse.down();await page.mouse.move(header.x+70,header.y+100,{steps:10});
 await expect(page.locator('.dashboard-drop-preview')).toBeVisible();await page.mouse.up();
 await expect.poll(()=>state.layout?.widgets.find(w=>w.id==='recent').y).toBeGreaterThan(58);
 const handle=card.locator('.dashboard-resize');await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();
 const before=state.layout.widgets.find(w=>w.id==='recent').height;
 await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();await page.mouse.move(box.x+10,box.y-70,{steps:10});await page.mouse.up();
 await expect.poll(()=>state.layout?.widgets.find(w=>w.id==='recent').height).toBeLessThan(before);
 expect(state.writes.every(w=>w.user_id===fakeUser.id)).toBe(true);
 const saved=structuredClone(state.layout);await page.reload();await expect(page.locator('#dashboardEdit')).toBeEnabled();
 expect(await card.evaluate(el=>Number(el.style.getPropertyValue('--widget-y')))).toBe(saved.widgets.find(w=>w.id==='recent').y+1);
});

test('Dashboard failed preference save stays pending and retries; widget failure is not zero',async({page})=>{
 const state=await mockDashboard(page);state.failSave=true;
 await page.route(`${supabaseOrigin}/rest/v1/digital_purchase_orders*`,r=>r.fulfill({status:400,json:{message:'synthetic failure'}}));
 await page.goto('/admin.html?tab=summary');await expect(page.locator('#dashboardEdit')).toBeEnabled();
 await expect(page.locator('[data-widget="purchase-orders"]')).toContainText('Could not load this widget');
 await openDashboardWidgetMenu(page);await page.locator('#dashboardWidgetChoices input[value="tasks"]').uncheck();
 await expect(page.locator('#dashboardRetrySave')).toBeVisible();
 expect(await page.evaluate(id=>JSON.parse(localStorage.getItem('jgcDashboardLayout:v1:'+id)).pending,fakeUser.id)).toBe(true);
 state.failSave=false;await page.locator('#dashboardRetrySave').click();await expect(page.locator('#dashboardLayoutStatus')).toHaveText('Layout saved to your account.');
});

test('Dashboard ignores another user cache and denies employee customization',async({page})=>{
 await mockDashboard(page,{admin:false});await page.addInitScript(()=>localStorage.setItem('jgcDashboardLayout:v1:other-user',JSON.stringify({layout:{widgets:[{id:'calendar',visible:false}]},pending:true})));
 await page.goto('/admin.html?tab=summary');await expect(page.locator('#dashboardLayoutStatus')).toContainText('approved admins');await expect(page.locator('#dashboardEdit')).toBeDisabled();
 await expect(page.locator('[data-widget="calendar"]')).toBeVisible();
});

for(const theme of ['light','dark']) for(const width of [390,1440])test(`Dashboard layout readable ${theme} ${width}`,async({page},testInfo)=>{
 await mockDashboard(page,{theme});await mockDashboardVisualRecords(page);await page.setViewportSize({width,height:1100});await page.goto('/admin.html?tab=summary');await expect(page.locator('#dashboardEdit')).toBeEnabled();await expect(page.locator('[data-widget="tasks"]')).toContainText('Order synthetic material');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const jobList=page.getByRole('link',{name:'Open Job List',exact:true});
 await expect(jobList).toHaveAttribute('href','estimating/?view=jobs');
 const buttonStyle=await jobList.evaluate(el=>{const s=getComputedStyle(el);return {border:parseFloat(s.borderTopWidth),radius:parseFloat(s.borderRadius),background:s.backgroundColor,height:el.getBoundingClientRect().height};});
 expect(buttonStyle.border).toBeGreaterThanOrEqual(1);expect(buttonStyle.radius).toBeGreaterThan(0);expect(buttonStyle.background).not.toBe('rgba(0, 0, 0, 0)');
 expect(Math.abs(buttonStyle.height-(await page.getByRole('link',{name:'Add Job',exact:true}).boundingBox()).height)).toBeLessThan(1);
 await expectReadableText(page.locator('#summarySection .dashboard-widget-header h2, #summarySection .dashboard-quick-actions a, #summarySection .dashboard-list small, #summarySection .dashboard-widget-body>p, #summarySection .dashboard-heading button'),'Dashboard '+theme);
 await page.screenshot({path:testInfo.outputPath('dashboard.png'),fullPage:true});
});


// Synthetic populated cards exercise wrapping and density without reading live data.
async function mockDashboardVisualRecords(page) {
 const clients=['Cedar Mechanical','Northern Pipeline','Federal Properties','Eastside Electric','Riverdale Rail'];
 const projects=['Ingleside Development','Gate operator replacement','Office painting and repairs','Control room renovation','Platform repairs'];
 const jobs=clients.map((customer,i)=>({id:'visual-job-'+i,job_number:String(26999-i),customer,job_name:projects[i],active:true,job_type:i%2?'T&M':'Contract'}));
 await page.route(`${supabaseOrigin}/rest/v1/jobs*`,r=>r.fulfill({json:jobs}));
 await page.route(`${supabaseOrigin}/rest/v1/estimator_workspaces*`,r=>r.fulfill({json:{payload:{clients:clients.map((name,i)=>({id:'c'+i,name})),jobs:[],quotes:projects.map((project,i)=>({id:'q'+i,number:'JGC-Q-2026-00'+(50-i),clientId:'c'+i,project,status:i===4?'Draft':'Finished',updatedAt:'2026-09-22T12:00:00Z'}))}}}));
 await page.route(`${supabaseOrigin}/rest/v1/subcontractor_portal_activity*`,r=>r.fulfill({json:clients.slice(0,3).map((company_name,i)=>({id:'s'+i,company_name,action:['Submitted quote','Uploaded site document','Confirmed start date'][i],created_at:'2026-09-22T12:00:00Z'}))}));
 await page.route(`${supabaseOrigin}/rest/v1/tasks*`,r=>r.fulfill({json:['Order synthetic material','Confirm concrete pour schedule','Review shop drawings','Follow up with painter'].map((title,i)=>({id:'t'+i,title,status:'open',priority:i?'normal':'high',due_date:'2026-09-23'}))}));
}

test('Dashboard restores subcontractor activity after a failed request',async({page})=>{
 await mockDashboard(page);let fail=true;
 await page.route(`${supabaseOrigin}/rest/v1/subcontractor_portal_activity*`,r=>r.fulfill(fail?{status:400,json:{message:'synthetic failure'}}:{json:[{id:'s',company_name:'Recovered Supplier',action:'Document updated',created_at:'2026-09-22T12:00:00Z'}]}));
 await page.goto('/admin.html?tab=summary');await expect(page.locator('[data-widget="subcontractors"]')).toContainText('Could not load this widget');
 fail=false;await page.locator('#dashboardRefresh').click();await expect(page.locator('.dashboard-sub-recent')).toContainText('Recovered Supplier');
 await expect(page.locator('#subcontractorActivityPanel')).toHaveCount(1);
});

test('Dashboard counts active jobs across pages and normalizes invalid layout',async({page})=>{
 await mockDashboard(page,{layout:{widgets:[{id:'tasks',width:999,height:0},{id:'tasks'},{id:'unknown'}]}});
 await page.route(`${supabaseOrigin}/rest/v1/jobs*`,r=>{const offset=Number(new URL(r.request().url()).searchParams.get('offset')||0);return r.fulfill({json:Array.from({length:offset?1:500},(_,i)=>({id:'j'+(i+offset),job_number:String(26999-i-offset),customer:'Synthetic Client',job_name:'Project',active:true}))});});
 await page.goto('/admin.html?tab=summary');await expect(page.locator('[data-widget="jobs-stat"] .dashboard-metric strong')).toHaveText('501');await expect(page.locator('.dashboard-widget')).toHaveCount(13);
 await expect(page.locator('.dashboard-widget').first()).toHaveAttribute('data-widget','tasks');
 await page.locator('[data-widget="tasks"] .dashboard-widget-options').click();await expect(page.getByLabel('Tasks / Follow-Ups width',{exact:true})).toHaveValue('4');
});

for(const theme of ['light','dark'])test(`Dashboard stacked calendar layout and slim totals survive reload ${theme}`,async({page},testInfo)=>{
 const state=await mockDashboard(page,{theme,layout:{version:1,widgets:[{id:'calendar',width:6,height:640},{id:'recent',width:4,height:456},{id:'active-jobs',width:4,height:408},{id:'estimate-desk',width:4,height:144}]}});
 await mockDashboardVisualRecords(page);await page.setViewportSize({width:1440,height:1100});await page.goto('/admin.html?tab=summary');await expect(page.locator('#dashboardEdit')).toBeEnabled();
 await expect(page.locator('[data-widget="estimate-desk"]')).toHaveCount(0);
 const links=await page.locator('.dashboard-quick-actions a').allTextContents();expect(links.slice(0,2)).toEqual(['Open Estimate Desk','Add Job']);
 await toggleDashboardEditing(page);await page.locator('#dashboardStackCalendar').click();await page.locator('#dashboardSlimTotals').click();await toggleDashboardEditing(page);
 await expect(page.locator('#dashboardLayoutStatus')).toHaveText('Layout saved to your account.');
 async function check(){
  const rects=await page.locator('.dashboard-widget').evaluateAll(elements=>Object.fromEntries(elements.filter(el=>!el.hidden).map(el=>{const r=el.getBoundingClientRect();return [el.dataset.widget,{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}];})));
  const c=rects.calendar,r=rects.recent,j=rects['active-jobs'];
  expect(Math.abs(c.y-r.y)).toBeLessThan(1);expect(Math.abs(j.x-r.x)).toBeLessThan(1);expect(Math.abs(j.y-r.bottom-14)).toBeLessThan(1);expect(Math.abs(j.bottom-c.bottom)).toBeLessThan(1);
  for(const id of ['jobs-stat','quotes','work-orders','purchase-orders','vacation','equipment-expiry','missing-timesheets'])expect(rects[id].height).toBe(44);
  const entries=Object.entries(rects);for(let i=0;i<entries.length;i++)for(let k=i+1;k<entries.length;k++){const a=entries[i][1],b=entries[k][1];expect(a.x<b.right-1&&a.right>b.x+1&&a.y<b.bottom-1&&a.bottom>b.y+1,entries[i][0]+' overlaps '+entries[k][0]).toBe(false);}
 }
 await check();await page.reload();await expect(page.locator('#dashboardEdit')).toBeEnabled();await check();
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:testInfo.outputPath('dashboard-stacked-'+theme+'.png'),fullPage:true});
 expect(state.layout.version).toBe(2);
});

test('Dashboard can place Active Jobs in the empty half beside calendar, and Escape cancels',async({page})=>{
 const state=await mockDashboard(page,{layout:{version:2,widgets:[{id:'calendar',x:0,y:0,width:6,height:640},{id:'recent',x:6,y:0,width:6,height:640},{id:'active-jobs',x:0,y:654,width:6,height:313}]}});
 await page.setViewportSize({width:1440,height:1200});await page.goto('/admin.html?tab=summary');await expect(page.locator('#dashboardEdit')).toBeEnabled();
 await page.locator('[data-widget="recent"] .dashboard-widget-options').click();await page.getByRole('button',{name:'Halve Recent Work height',exact:true}).click();
 await expect.poll(()=>state.layout?.widgets.find(w=>w.id==='recent').height).toBe(313);
 const active=page.locator('[data-widget="active-jobs"]');await active.scrollIntoViewIfNeeded();
 const source=await active.locator('.dashboard-widget-header').boundingBox(),grid=await page.locator('#dashboardGrid').boundingBox();
 const step=(grid.width+14)/12;
 await page.mouse.move(source.x+90,source.y+20);await page.mouse.down();await page.mouse.move(source.x+90+6*step,source.y+20-327,{steps:20});await page.mouse.up();
 await expect.poll(()=>state.layout?.widgets.find(w=>w.id==='active-jobs').x).toBe(6);
 const final=await active.boundingBox(),recent=await page.locator('[data-widget="recent"]').boundingBox();expect(Math.abs(final.y-recent.y-recent.height-14)).toBeLessThanOrEqual(4);
 const saved=structuredClone(state.layout),head=await active.locator('.dashboard-widget-header').boundingBox();
 await page.mouse.move(head.x+80,head.y+20);await page.mouse.down();await page.mouse.move(head.x+20,head.y+100,{steps:10});await page.keyboard.press('Escape');await page.mouse.up();
 await expect(page.locator('.dashboard-drop-preview')).toBeHidden();expect(state.layout).toEqual(saved);
});

test('Dashboard tablet touch dragging and keyboard resizing save real coordinates',async({browser})=>{
 const context=await browser.newContext({viewport:{width:1024,height:1100},hasTouch:true});const page=await context.newPage();
 try {
  const state=await mockDashboard(page);await page.goto('/admin.html?tab=summary');await expect(page.locator('#dashboardEdit')).toBeEnabled();await toggleDashboardEditing(page);
  const card=page.locator('[data-widget="recent"]');await card.scrollIntoViewIfNeeded();const box=await card.locator('.dashboard-widget-header').boundingBox();
  const cdp=await context.newCDPSession(page),point={x:box.x+70,y:box.y+20};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
  for(let n=1;n<=8;n++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x,y:point.y+n*10}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>state.layout?.widgets.find(w=>w.id==='recent').y).toBeGreaterThan(58);
  await card.locator('.dashboard-resize').focus();await page.keyboard.press('ArrowUp');await expect.poll(()=>state.layout?.widgets.find(w=>w.id==='recent').height).toBe(259);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 } finally {await context.close();}
});

test('Dashboard calendar cells resize to the available month area at small and large sizes',async({page},testInfo)=>{
 await mockDashboard(page);await page.setViewportSize({width:1440,height:1100});await page.goto('/admin.html?tab=summary');await expect(page.locator('#dashboardEdit')).toBeEnabled();
 const card=page.locator('[data-widget="calendar"]');await card.locator('.dashboard-widget-options').click();
 await page.evaluate(()=>{adminScheduleMonth=new Date(2026,7,1);scheduleEvents=[{id:'synthetic-event',event_date:'2026-08-18',event_type:'work',title:'Synthetic calendar work',start_time:'08:00'}];renderAdminScheduleCalendar();});
 await expect(card.getByRole('button',{name:/Tuesday, August 18, 2026/})).toHaveAttribute('aria-label',/1 schedule item/);
 async function measure(width,height){
  await page.getByLabel('Schedule Calendar width',{exact:true}).selectOption(width);await page.getByLabel('Schedule Calendar height',{exact:true}).selectOption(height);
  await toggleDashboardEditing(page);await card.scrollIntoViewIfNeeded();
  const geometry=await card.evaluate(el=>{const g=el.querySelector('.admin-schedule-grid'),d=g.querySelector('.admin-schedule-day'),r=g.getBoundingClientRect(),c=el.getBoundingClientRect(),last=g.lastElementChild.getBoundingClientRect();return {day:d.getBoundingClientRect().height,width:d.getBoundingClientRect().width,grid:r.height,overflow:g.scrollHeight>g.clientHeight+1,inside:r.left>=c.left&&r.right<=c.right&&last.bottom<=c.bottom,rows:[...g.children].filter(x=>x.classList.contains('admin-schedule-day')).length};});
  expect(geometry.inside).toBe(true);expect(geometry.overflow).toBe(false);expect(geometry.rows).toBeGreaterThanOrEqual(28);
  await card.screenshot({path:testInfo.outputPath('calendar-'+width+'-'+height+'.png')});
  await card.locator('.dashboard-widget-options').click();return geometry;
 }
 const small=await measure('3','280'),large=await measure('8','640');expect(large.day).toBeGreaterThan(small.day*2);expect(large.width).toBeGreaterThan(small.width*2);
});

for(const theme of ['light','dark'])for(const width of [390,1440])test(`Dashboard empty Work Orders stays clean in slim cards ${theme} ${width}`,async({page},testInfo)=>{
 await mockDashboard(page,{theme});await page.route(`${supabaseOrigin}/rest/v1/work_orders*`,r=>r.fulfill({headers:{'content-range':'*/0','access-control-expose-headers':'content-range'},json:[]}));
 await page.setViewportSize({width,height:1000});await page.goto('/admin.html?tab=summary');await expect(page.locator('#dashboardEdit')).toBeEnabled();
 const card=page.locator('[data-widget="work-orders"]'),count=card.locator('.dashboard-metric strong'),empty=card.getByText('No open work orders.',{exact:true});
 await expect(count).toHaveText('0');await expect(empty).toBeHidden();
 async function clean(){const c=await card.boundingBox(),n=await count.boundingBox();expect(Math.abs(n.y+n.height/2-c.y-c.height/2)).toBeLessThan(2);expect(n.x+n.width).toBeLessThan(c.x+c.width-28);}
 await clean();await toggleDashboardEditing(page);await clean();
 if(width>650){const n=await count.boundingBox(),resize=await card.locator('.dashboard-resize').boundingBox(),options=await card.locator('.dashboard-widget-options').boundingBox();expect(n.x+n.width).toBeLessThanOrEqual(resize.x);expect(resize.x+resize.width).toBeLessThanOrEqual(options.x);}
 await card.screenshot({path:testInfo.outputPath('empty-wo-'+theme+'-'+width+'.png')});
 await card.locator('.dashboard-widget-options').click();await page.getByLabel('Work Orders height',{exact:true}).selectOption('280');await expect(empty).toBeVisible();
 await page.getByLabel('Work Orders height',{exact:true}).selectOption('44');await expect(empty).toBeHidden();await clean();
});
