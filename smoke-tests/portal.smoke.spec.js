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

async function mockPortalServices(page, profile = fakeProfile) {
  const session = createFakeSession();

  await page.route(`${supabaseOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const accept = String(request.headers().accept || "");
    let body = "[]";

    if (url.pathname.startsWith("/auth/v1/user")) {
      body = JSON.stringify(fakeUser);
    } else if (url.pathname.startsWith("/auth/v1/token")) {
      body = JSON.stringify(session);
    } else if (url.pathname.includes("/rest/v1/profiles")) {
      body = accept.includes("application/vnd.pgrst.object")
        ? JSON.stringify(profile)
        : JSON.stringify([profile]);
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
  await page.route(`${supabaseOrigin}/rest/v1/toolbox_talks**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/1" },
    body: JSON.stringify([talk])
  }));
  await installAuthenticatedPortalState(page);
  await page.goto("/toolbox-talks.html", { waitUntil: "domcontentloaded" });

  const reportSection = page.locator("#toolboxTalkReportSection");
  const librarySection = page.locator("#toolboxTalkLibrarySection");
  const talkSelect = page.locator("#toolboxTalkSelect");
  const pdfButton = page.locator("#selectedTalkPdfButton");

  await expect(talkSelect).toBeEnabled();
  await expect(talkSelect.locator("option")).toHaveCount(2);
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
  await expectNoRuntimeErrors(errors, "toolbox talk report selector");
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
  await installAuthenticatedPortalState(page);
  await page.goto("/jsa.html", { waitUntil: "domcontentloaded" });

  const approvedPicker = page.locator("#approvedCrewPicker");
  const select = page.locator("#approvedCrewSelect");
  const selectedCrew = page.locator("#selectedCrewList");

  await expect(select.locator("option")).toHaveCount(3);
  await expect(approvedPicker.getByRole("button", { name: "Add Employee" })).toHaveCount(0);
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
  await expect(viewer.getByRole("button", { name: "Print / Save PDF" })).toBeVisible();
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
  await page.route(`${supabaseOrigin}/rest/v1/toolbox_talk_reports**`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/1" },
    body: JSON.stringify([report])
  }));
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
  await history.locator("summary").click();
  await expect(history).toContainText(report.presenter_name);
  await expect(history).toContainText("Pending acknowledgement");
  await expectNoRuntimeErrors(errors, "admin toolbox talk history");
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

  const tabs = ["summary", "jobDashboard", "timesheets", "inspections", "vacation", "tasks", "reports", "workOrders", "adminTools"];
  for (const tab of tabs) {
    await page.locator(`#${tab}Tab`).click();
    await expect(page.locator(`#${tab}Section`)).toBeVisible();
    await expect(page.locator(`#${tab}Tab`)).toHaveClass(/active/);
  }
  await expectNoRuntimeErrors(errors, "admin tabs");
});

test("admin tool data loads only after its tool is opened", async ({ page }) => {
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
    ["jobs", "jobs"],
    ["equipment", "equipment_vehicles"],
    ["contacts", "contacts"],
    ["subcontractorsSuppliers", "subcontractors_suppliers"],
    ["noticePolicy", "announcements"]
  ];

  await installAuthenticatedPortalState(page);
  await mockPortalServices(page);

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
  await page.locator("#inspectionsTab").click();
  await expect(page.locator("#inspectionsSection")).toBeVisible();
  await page.waitForFunction(() => adminTabDataLoaded.has("inspections"));

  await page.evaluate(() => {
    adminTabDataLoading.inspections = false;
    adminTabDataLoaded.add("inspections");
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
    renderInspections();
  });

  const categories = page.locator("#inspectionsList > .jgc-archive-list > details[data-inspection-category]");
  await expect(categories).toHaveCount(3);
  await expect(page.locator("#inspectionsList table")).toHaveCount(0);

  const vehicleCategory = categories.filter({ hasText: "Vehicle / Trailer" });
  await vehicleCategory.locator("summary").click();
  await expect(vehicleCategory.locator("[data-inspection-lazy-body]")).toHaveAttribute("data-loaded", "true");
  await expect(vehicleCategory.locator("table")).toHaveCount(1);
  await expect(page.locator("#inspectionsList table")).toHaveCount(1);
  await expectNoRuntimeErrors(errors, "admin inspection categories");
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
  await expectNoRuntimeErrors(errors, "employee directory lazy loading");
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

  await page.locator("#poManualJobNumber").fill("39999");
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
