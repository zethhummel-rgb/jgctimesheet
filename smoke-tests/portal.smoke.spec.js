const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");
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
  await expect(summaryCounts.first()).toHaveCSS("color", "rgb(11, 94, 59)");

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

  const tabs = ["summary", "jobDashboard", "timesheets", "safetyRecords", "vacation", "tasks", "workOrders", "adminTools"];
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

test("admin job dashboard selector filters and selects jobs", async ({ page }) => {
  const errors = watchRuntimeErrors(page);
  const requestedTables = new Set();
  const dashboardJobs = [
    { id: "job-one", job_number: "101", job_name: "Main Street Office", active: true },
    { id: "job-two", job_number: "205", job_name: "North Warehouse", active: true },
    { id: "job-three", job_number: "330", job_name: "Riverside Apartments", active: true },
    { id: "job-four", job_number: "050", job_name: "Closed Community Centre", active: false }
  ];

  page.on("request", (request) => {
    const match = request.url().match(/\/rest\/v1\/([^?]+)/);
    if (match) requestedTables.add(match[1]);
  });

  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);
  await page.route(`${supabaseOrigin}/rest/v1/jobs**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(dashboardJobs)
  }));
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.renderJobDashboardOptions === "function");
  await expect.poll(() => requestedTables.has("jobs")).toBe(true);
  await expect.poll(() => page.evaluate(() => jobs.length)).toBe(4);
  expect(requestedTables.has("work_orders")).toBe(false);

  await page.locator("#jobDashboardTab").click();

  const search = page.locator("#jobDashboardSearch");
  await expect(search).toHaveValue("");
  await expect(page.locator("#jobDashboardSelect")).toHaveValue("");
  await expect(page.locator("#jobDashboardContent")).toContainText("Start typing a job number or name");
  await search.click();
  await expect(page.locator("#jobDashboardOptions")).toBeHidden();
  await expect(page.locator("#jobDashboardOptions .job-dashboard-option")).toHaveCount(0);
  await search.fill("e");
  await expect(page.locator("#jobDashboardOptions .job-dashboard-option")).toHaveCount(4);
  await expect.poll(() => page.locator("#jobDashboardOptions .job-dashboard-option").allTextContents()).toEqual([
    "101 - Main Street Office",
    "205 - North Warehouse",
    "330 - Riverside Apartments",
    "050 - Closed Community Centre"
  ]);
  const groupedOptionColors = await page.evaluate(() => ({
    active: getComputedStyle(document.querySelector(".job-dashboard-option--active")).backgroundColor,
    inactive: getComputedStyle(document.querySelector(".job-dashboard-option--inactive")).backgroundColor
  }));
  expect(groupedOptionColors.active).not.toBe(groupedOptionColors.inactive);
  await search.fill("warehouse");
  await expect(page.locator("#jobDashboardOptions .job-dashboard-option")).toHaveCount(1);
  await expect(page.getByRole("option", { name: "205 - North Warehouse" })).toHaveClass(/job-dashboard-option--active/);
  await expect.poll(() => page.locator("#jobDashboardSection").evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
  await expect.poll(() => page.locator("#jobDashboardOptions").evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
  await page.getByRole("option", { name: "205 - North Warehouse" }).click();

  await expect(search).toHaveValue("205 - North Warehouse");
  await expect(page.locator("#jobDashboardSelect")).toHaveValue("205");
  await expect(page.locator("#jobDashboardOptions")).toBeHidden();
  await expect.poll(() => requestedTables.has("work_orders")).toBe(true);
  await expect(page.locator("#jobDashboardContent .job-status-pill")).toHaveText("Active");

  await search.click();
  await search.fill("closed community");
  await expect(page.locator("#jobDashboardOptions .job-dashboard-option")).toHaveCount(1);
  await expect(page.getByRole("option", { name: "050 - Closed Community Centre" })).toHaveClass(/job-dashboard-option--inactive/);
  await page.getByRole("option", { name: "050 - Closed Community Centre" }).click();
  await expect(page.locator("#jobDashboardSelect")).toHaveValue("050");
  await expect(page.locator("#jobDashboardContent .job-status-pill")).toHaveText("Inactive");

  await page.locator("#jobDashboardSection").getByRole("button", { name: "Refresh Jobs" }).click();
  await expect(search).toHaveValue("");
  await expect(page.locator("#jobDashboardSelect")).toHaveValue("");
  await expect(page.locator("#jobDashboardContent")).toContainText("Start typing a job number or name");
  await expectNoRuntimeErrors(errors, "searchable job dashboard selector");
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
  await expect(spyglassGroups).toHaveCount(9);
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
  await expect(page).toHaveURL(/admin\.html\?tab=jobDashboard/);
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
  await page.locator("#accountingPayDate").evaluate((input) => {
    input.value = "2026-08-20";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("[data-jgc-admin-section='accounting']")).toHaveClass(/active/);
  await expect(page.locator("#accountingCurrentUser")).toContainText("Portal Smoke Test");
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
  expect(workbookNightHours.summaryWorkedHours.formula).toBe('SUMIF($B$5:$B$7,"<>Other",C5:C7)');
  expect(workbookNightHours.summaryWorkedHours.result).toBe(8);
  expect(workbookNightHours.summaryWeekOneWorkedHours.formula).toBe('SUMIF($B$5:$B$7,"<>Other",D5:D7)');
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
    weight: getComputedStyle(cell).fontWeight
  }));
  expect(warningStyle.background).toBe("rgb(143, 29, 29)");
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
