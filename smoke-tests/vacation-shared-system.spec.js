const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");
const supabaseOrigin = "https://xnrljkkszoimegfivlya.supabase.co";

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createSession() {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "00000000-0000-4000-8000-000000000094",
    aud: "authenticated",
    role: "authenticated",
    email: "vacation-style-test@johngordonconstruction.com",
    user_metadata: { display_name: "Vacation Style Test" }
  };
  const token = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: user.id, email: user.email }),
    "vacation-style-test-signature"
  ].join(".");

  return {
    user,
    auth: {
      access_token: token,
      refresh_token: "vacation-style-test-refresh",
      expires_at: now + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user
    }
  };
}

const mockRequests = [
  {
    id: "vacation-style-approved",
    worker_name: "vacation style test",
    worker_display_name: "Vacation Style Test",
    request_date: "2026-08-20",
    start_date: "2026-09-03",
    end_date: "2026-09-04",
    return_date: "2026-09-08",
    total_days: 2,
    request_type: "Vacation",
    reason: "Family holiday",
    employee_signature: "Vacation Style Test",
    admin_note: "Approved",
    form_data: {},
    status: "approved",
    created_at: "2026-08-20T12:00:00Z"
  },
  {
    id: "vacation-style-pending",
    worker_name: "vacation style test",
    worker_display_name: "Vacation Style Test",
    request_date: "2026-08-21",
    start_date: "2026-10-15",
    end_date: "2026-10-15",
    return_date: "2026-10-16",
    total_days: 1,
    request_type: "Personal Day",
    reason: "Appointment",
    employee_signature: "Vacation Style Test",
    admin_note: "",
    form_data: {},
    status: "pending",
    created_at: "2026-08-21T12:00:00Z"
  }
];

async function installState(page) {
  const state = createSession();
  await page.addInitScript(({ state, ref }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(state.auth));
    localStorage.setItem("currentWorker", "vacation style test");
    localStorage.setItem("currentWorkerDisplay", "Vacation Style Test");
    localStorage.setItem("currentUserEmail", state.user.email);
    localStorage.setItem("currentUserRole", "worker");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { state, ref: "xnrljkkszoimegfivlya" });

  await page.route(`${supabaseOrigin}/**`, async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.startsWith("/auth/v1/user")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.user) });
      return;
    }
    if (requestUrl.pathname.startsWith("/auth/v1/token")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.auth) });
      return;
    }
    if (requestUrl.pathname === "/rest/v1/vacation_requests") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": `0-${mockRequests.length - 1}/${mockRequests.length}` },
        body: JSON.stringify(mockRequests)
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

async function installAdminState(page) {
  const state = createSession();
  state.user.email = "zeth@johngordonconstruction.com";
  state.user.user_metadata.display_name = "Zeth Hummel";
  state.auth.user = state.user;
  const adminProfile = {
    id: state.user.id,
    email: state.user.email,
    display_name: "Zeth Hummel",
    worker_key: "zeth hummel",
    role: "admin",
    approved: true,
    account_status: "approved"
  };

  await page.addInitScript(({ state, ref }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(state.auth));
    localStorage.setItem("currentWorker", "zeth hummel");
    localStorage.setItem("currentWorkerDisplay", "Zeth Hummel");
    localStorage.setItem("currentUserEmail", state.user.email);
    localStorage.setItem("currentUserRole", "admin");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { state, ref: "xnrljkkszoimegfivlya" });

  await page.route(`${supabaseOrigin}/**`, async (route) => {
    const requestUrl = new URL(route.request().url());
    const accept = String(route.request().headers().accept || "");
    if (requestUrl.pathname.startsWith("/auth/v1/user")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.user) });
      return;
    }
    if (requestUrl.pathname.startsWith("/auth/v1/token")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.auth) });
      return;
    }
    if (requestUrl.pathname === "/rest/v1/profiles") {
      const body = accept.includes("vnd.pgrst.object") ? adminProfile : [adminProfile];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      return;
    }
    if (requestUrl.pathname === "/rest/v1/accounts") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([adminProfile]) });
      return;
    }
    if (requestUrl.pathname === "/rest/v1/vacation_requests") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockRequests) });
      return;
    }
    if (requestUrl.pathname.includes("/rest/v1/rpc/") && /admin/i.test(requestUrl.pathname)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "true" });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

async function contrastRatio(page, selector) {
  return page.locator(selector).first().evaluate((element) => {
    function parse(value) {
      const parts = String(value).match(/[\d.]+/g) || [];
      return parts.slice(0, 4).map(Number);
    }
    function backgroundFor(node) {
      let current = node;
      while (current) {
        const parsed = parse(getComputedStyle(current).backgroundColor);
        if (parsed.length >= 3 && (parsed.length < 4 || parsed[3] > 0)) return parsed;
        current = current.parentElement;
      }
      return [255, 255, 255];
    }
    function luminance(rgb) {
      const values = rgb.slice(0, 3).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
      });
      return (0.2126 * values[0]) + (0.7152 * values[1]) + (0.0722 * values[2]);
    }
    const foreground = luminance(parse(getComputedStyle(element).color));
    const background = luminance(backgroundFor(element));
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
}

test("Vacation Requests family uses one shared visual source", async () => {
  const pageSource = fs.readFileSync(path.join(portalRoot, "vacation-request.html"), "utf8");
  const pageHead = pageSource.match(/<head>[\s\S]*?<\/head>/i)?.[0] || "";
  const featureCss = fs.readFileSync(path.join(portalRoot, "vacation-design-system.css"), "utf8");
  const adminSource = fs.readFileSync(path.join(portalRoot, "admin.html"), "utf8");
  const adminVacationSource = fs.readFileSync(path.join(portalRoot, "admin-vacation.js"), "utf8");
  const adminCss = fs.readFileSync(path.join(portalRoot, "admin.css"), "utf8");

  expect(pageHead).not.toMatch(/<style\b/i);
  expect(pageSource).not.toContain('style="margin-top:14px;"');
  expect(pageSource).not.toContain("styles.css");
  expect(pageSource).toContain('jgc-design-system.css?v=7');
  expect(pageSource).toContain('vacation-design-system.css?v=2');
  expect(pageSource).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
  expect(featureCss, "Vacation-only CSS must use centralized design tokens instead of page colours").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  expect(featureCss).toMatch(/input\[type="date"\]\.jgc-input\s*\{[\s\S]*?min-inline-size:\s*0;[\s\S]*?max-inline-size:\s*100%;/i);
  expect(adminSource).toContain('admin.css?v=14');
  expect(adminSource).toContain('vacation-design-system.css?v=2');
  expect(adminSource).toContain('jgc-panel jgc-vacation-admin');
  expect(adminVacationSource).not.toMatch(/\sstyle\s*=/i);
  expect(adminCss).not.toContain("Phase 8 design-system compatibility for the embedded Vacation Requests section");
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`populated Vacation Requests page stays readable and contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installState(page);
    await page.goto("/vacation-request.html", { waitUntil: "domcontentloaded" });

    await expect(page.locator(".vacation-history-table tbody tr")).toHaveCount(2);
    await expect(page.locator("#vacationSummary .summary-box")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Edit Approved Dates" })).toBeVisible();
    await expect(page.locator("#vacationCancelEditButton")).toBeHidden();
    await expect(page.locator(".calendar-head")).toHaveCount(7);

    const dimensions = await page.evaluate(() => {
      const submit = document.getElementById("vacationSubmitButton");
      const historyTable = document.querySelector(".vacation-history-table");
      const firstRow = historyTable && historyTable.querySelector("tbody tr");
      const calendarScroll = document.querySelector(".vacation-calendar-scroll");
      const requestPanel = document.querySelector(".vacation-request-panel");
      const panelRect = requestPanel ? requestPanel.getBoundingClientRect() : null;
      const dateInputsContained = Array.from(document.querySelectorAll('.vacation-request-panel input[type="date"]')).every((input) => {
        const rect = input.getBoundingClientRect();
        return panelRect && rect.left >= panelRect.left - 1 && rect.right <= panelRect.right + 1;
      });
      return {
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        submitHeight: submit ? submit.getBoundingClientRect().height : 0,
        tableDisplay: historyTable ? getComputedStyle(historyTable).display : "",
        rowDisplay: firstRow ? getComputedStyle(firstRow).display : "",
        calendarContained: calendarScroll ? calendarScroll.scrollWidth >= calendarScroll.clientWidth : false,
        dateInputsContained
      };
    });
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.submitHeight).toBeGreaterThanOrEqual(44);
    expect(dimensions.calendarContained).toBe(true);
    expect(dimensions.dateInputsContained).toBe(true);

    if (viewport.name === "phone") {
      expect(dimensions.tableDisplay).toBe("block");
      expect(dimensions.rowDisplay).toBe("grid");
      const bottomNav = page.locator(".jgc-mobile-bottom-nav");
      await expect(bottomNav).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight / 2)));
      const navBox = await bottomNav.boundingBox();
      expect(Math.abs((navBox.y + navBox.height) - viewport.height)).toBeLessThanOrEqual(1);
    } else {
      expect(dimensions.tableDisplay).toBe("table");
      expect(dimensions.rowDisplay).toBe("table-row");
    }

    for (const selector of [
      ".vacation-request-panel",
      ".vacation-history-panel",
      ".summary-box",
      "#vacationSubmitButton",
      ".status-pill.approved"
    ]) {
      expect(await contrastRatio(page, selector), `${selector} must meet normal-text contrast`).toBeGreaterThanOrEqual(4.5);
    }

    if (process.env.JGC_VACATION_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.JGC_VACATION_SCREENSHOT_DIR, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(process.env.JGC_VACATION_SCREENSHOT_DIR, `vacation-${viewport.name}.png`),
        fullPage: true
      });
    }

    expect(errors).toEqual([]);
    await context.close();
  });
}

test("Admin Vacation calendar and approval table stay contained on phone", async ({ browser }) => {
  const viewport = { width: 390, height: 844 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installAdminState(page);
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.renderVacationRequests === "function");
  await page.locator("#vacationTab").click();
  await expect(page.locator("#vacationSection")).toBeVisible();
  await expect(page.locator("#vacationList details[data-vacation-worker]")).toHaveCount(1);
  await page.locator("#vacationList details[data-vacation-worker] summary").click();
  await expect(page.locator(".vacation-admin-table")).toBeVisible();

  const dimensions = await page.evaluate(() => {
    const calendarScroll = document.querySelector("#vacationSection .vacation-calendar-scroll");
    const tableWrap = document.querySelector("#vacationSection .jgc-table-wrap");
    return {
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      calendarScrollable: calendarScroll ? calendarScroll.scrollWidth > calendarScroll.clientWidth : false,
      tableScrollable: tableWrap ? tableWrap.scrollWidth > tableWrap.clientWidth : false
    };
  });
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.calendarScrollable).toBe(true);
  expect(dimensions.tableScrollable).toBe(true);
  expect(await contrastRatio(page, "#vacationSection")).toBeGreaterThanOrEqual(4.5);

  if (process.env.JGC_VACATION_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.JGC_VACATION_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.JGC_VACATION_SCREENSHOT_DIR, "vacation-admin-phone.png"),
      fullPage: true
    });
  }

  expect(errors).toEqual([]);
  await context.close();
});
