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

async function installAuthenticatedPortalState(page) {
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
  }, { authSession: session, profile: fakeProfile, ref: projectRef });
}

async function mockPortalServices(page) {
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
        ? JSON.stringify(fakeProfile)
        : JSON.stringify([fakeProfile]);
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

function watchRuntimeErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /(?:Uncaught|ReferenceError|TypeError|SyntaxError)/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on("dialog", (dialog) => dialog.dismiss());
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
