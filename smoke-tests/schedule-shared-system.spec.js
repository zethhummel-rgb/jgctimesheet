const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");
const supabaseOrigin = "https://xnrljkkszoimegfivlya.supabase.co";

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createSession(role = "worker") {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "00000000-0000-4000-8000-000000000095",
    aud: "authenticated",
    role: "authenticated",
    email: role === "admin" ? "zeth@johngordonconstruction.com" : "schedule-style-test@johngordonconstruction.com",
    user_metadata: { display_name: role === "admin" ? "Zeth Hummel" : "Schedule Style Test" }
  };
  const token = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: user.id, email: user.email }),
    "schedule-style-test-signature"
  ].join(".");
  return {
    user,
    auth: {
      access_token: token,
      refresh_token: "schedule-style-test-refresh",
      expires_at: now + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user
    }
  };
}

function localDateValue(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

async function installState(page, role = "worker") {
  const state = createSession(role);
  const displayName = role === "admin" ? "Zeth Hummel" : "Schedule Style Test";
  const workerKey = displayName.toLowerCase();
  const profile = {
    id: state.user.id,
    email: state.user.email,
    display_name: displayName,
    worker_key: workerKey,
    role,
    approved: true,
    account_status: "approved"
  };
  const worker = {
    id: "schedule-worker",
    profile_id: state.user.id,
    display_name: displayName,
    worker_key: workerKey,
    approved: true
  };
  const eventDate = localDateValue();
  const event = {
    id: "schedule-event",
    event_type: "work",
    event_date: eventDate,
    start_time: "07:00:00",
    end_time: "15:30:00",
    title: "Cornwall Courthouse access panel installation",
    job_number: "26090",
    job_name: "Cornwall Courthouse",
    location: "Cornwall, Ontario",
    notes: "Meet at the site trailer.",
    employee_keys: [workerKey],
    employee_names: [displayName],
    employee_emails: [state.user.email],
    created_by: state.user.id,
    google_sync_status: "synced"
  };
  const vacation = {
    id: "schedule-vacation",
    worker_name: workerKey,
    worker_display_name: displayName,
    start_date: eventDate,
    end_date: eventDate,
    status: "approved",
    google_sync_status: "synced"
  };

  await page.addInitScript(({ state, ref, role, workerKey, displayName }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(state.auth));
    localStorage.setItem("currentWorker", workerKey);
    localStorage.setItem("currentWorkerDisplay", displayName);
    localStorage.setItem("currentUserEmail", state.user.email);
    localStorage.setItem("currentUserRole", role);
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { state, ref: "xnrljkkszoimegfivlya", role, workerKey, displayName });

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
    if (requestUrl.pathname.includes("/rest/v1/rpc/")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: requestUrl.pathname.includes("admin") ? "true" : "[]" });
      return;
    }

    const table = requestUrl.pathname.split("/rest/v1/")[1] || "";
    const rowsByTable = {
      schedule_events: [event],
      vacation_requests: [vacation],
      work_order_labour_workers: [worker],
      employee_feature_access: [{ worker_id: worker.id, feature_key: "schedule", enabled: true }],
      profiles: [profile],
      accounts: [profile],
      jobs: [{ id: "job-26090", job_number: "26090", job_name: "Cornwall Courthouse", address: "Cornwall, Ontario", active: true }],
      equipment_vehicles: [{ id: "vehicle-1", name: "White F-150", identification_number: "BD48405", equipment_type: "Vehicle", operator_name: displayName, is_active: true }]
    };
    if (Object.prototype.hasOwnProperty.call(rowsByTable, table)) {
      const rows = rowsByTable[table];
      const body = accept.includes("vnd.pgrst.object") ? (rows[0] || null) : rows;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

async function contrastRatio(page, selector) {
  return page.locator(selector).first().evaluate((element) => {
    function parse(value) {
      return (String(value).match(/[\d.]+/g) || []).slice(0, 4).map(Number);
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

test("Schedule family uses one token-only shared visual source", async () => {
  const pageSource = fs.readFileSync(path.join(portalRoot, "schedule.html"), "utf8");
  const featureCss = fs.readFileSync(path.join(portalRoot, "schedule-design-system.css"), "utf8");
  const adminSource = fs.readFileSync(path.join(portalRoot, "admin.html"), "utf8");
  const adminCss = fs.readFileSync(path.join(portalRoot, "admin.css"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");

  expect(pageSource).not.toMatch(/<style\b/i);
  expect(pageSource).not.toMatch(/\sstyle\s*=/i);
  expect(pageSource).not.toContain("styles.css");
  expect(pageSource).toContain('jgc-design-system.css?v=8');
  expect(pageSource).toContain('schedule-design-system.css?v=3');
  expect(pageSource).toContain('id="scheduleAgenda"');
  expect(pageSource).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
  expect(featureCss, "Schedule-only CSS must use centralized design tokens instead of page colours").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);

  expect(adminSource).toContain('admin.css?v=16');
  expect(adminSource).toContain('schedule-design-system.css?v=3');
  expect(adminSource).toContain('class="admin-schedule-calendar-scroll"');
  expect(adminSource).toContain("admin-schedule-day-events");
  expect(adminSource).toContain("admin-schedule-vehicle-hint");
  expect(adminSource).not.toMatch(/adminSchedule[^>]*style=/i);
  expect(adminCss).not.toContain(".admin-schedule-summary");
  expect(adminCss).not.toContain(".admin-schedule-modal-backdrop");
  expect(serviceWorker).toMatch(/const JGC_RELEASE_ID = "\d+";/);
  expect(serviceWorker).toContain('"./admin.css?v=16"');
  expect(serviceWorker).toContain('"./schedule-design-system.css?v=3"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`populated employee Schedule stays readable and contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installState(page, "worker");
    await page.goto("/schedule.html", { waitUntil: "domcontentloaded" });

    await expect(page.locator(".calendar-head")).toHaveCount(7);
    await expect(page.locator(".day-item.work")).toHaveCount(1);
    await expect(page.locator(".day-item.vacation")).toHaveCount(1);
    await expect(page.locator(".detail-item")).toHaveCount(2);
    await expect(page.locator("#jobSelect option")).toHaveCount(2);
    await expect(page.locator("#vehicleSelect option")).toHaveCount(2);

    const dimensions = await page.evaluate(() => {
      const calendarWrap = document.querySelector(".schedule-calendar-scroll");
      const panel = document.querySelector("#scheduleForm");
      const firstButton = document.querySelector(".calendar-controls .jgc-button");
      const fieldOverflows = Array.from(panel.querySelectorAll("input, select, textarea")).filter((field) => {
        const fieldRect = field.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        return fieldRect.width > 0 && (fieldRect.left < panelRect.left - 1 || fieldRect.right > panelRect.right + 1);
      }).map((field) => ({ id: field.id, type: field.type, left: field.getBoundingClientRect().left, right: field.getBoundingClientRect().right, panelLeft: panel.getBoundingClientRect().left, panelRight: panel.getBoundingClientRect().right }));
      return {
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        layoutColumns: getComputedStyle(document.querySelector(".layout")).gridTemplateColumns,
        firstButtonHeight: firstButton ? firstButton.getBoundingClientRect().height : 0,
        calendarScrollable: calendarWrap.scrollWidth > calendarWrap.clientWidth,
        fieldOverflows
      };
    });

    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.fieldOverflows).toEqual([]);
    if (viewport.name === "phone") {
      expect(dimensions.layoutColumns.trim().split(/\s+/)).toHaveLength(1);
      await expect(page.locator("#scheduleAgenda")).toBeVisible();
      await expect(page.locator(".schedule-calendar-scroll")).toBeHidden();
      await expect(page.locator("#scheduleAgenda .admin-agenda-item")).toHaveCount(2);
      const firstAgendaButton = await page.locator("#scheduleAgenda button.admin-agenda-item").first().boundingBox();
      expect(firstAgendaButton.height).toBeGreaterThanOrEqual(44);
      const bottomNav = page.locator(".jgc-mobile-bottom-nav");
      await expect(bottomNav).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight / 2)));
      const navBox = await bottomNav.boundingBox();
      expect(Math.abs((navBox.y + navBox.height) - viewport.height)).toBeLessThanOrEqual(1);
    } else {
      expect(dimensions.layoutColumns.trim().split(/\s+/)).toHaveLength(2);
      expect(dimensions.firstButtonHeight).toBeGreaterThanOrEqual(44);
    }

    for (const selector of [".card", ".calendar-head", ".day-item.work", ".day-item.vacation", ".jgc-button"]) {
      expect(await contrastRatio(page, selector), `${selector} must meet normal-text contrast`).toBeGreaterThanOrEqual(4.5);
    }

    if (process.env.JGC_SCHEDULE_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.JGC_SCHEDULE_SCREENSHOT_DIR, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(process.env.JGC_SCHEDULE_SCREENSHOT_DIR, `schedule-${viewport.name}.png`),
        fullPage: true
      });
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("Employee Schedule fits all seven calendar columns in phone landscape", async ({ browser }) => {
  const viewport = { width: 844, height: 390 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installState(page, "worker");
  await page.goto("/schedule.html", { waitUntil: "domcontentloaded" });

  await expect(page.locator(".schedule-calendar-scroll")).toBeVisible();
  await expect(page.locator("#scheduleAgenda")).toBeHidden();
  await expect(page.locator("#scheduleCalendar .calendar-head")).toHaveCount(7);

  const dimensions = await page.evaluate(() => {
    const wrapper = document.querySelector(".schedule-calendar-scroll");
    const calendar = document.getElementById("scheduleCalendar");
    const columnWidths = Array.from(calendar.querySelectorAll(".calendar-head")).map((head) => head.getBoundingClientRect().width);
    return {
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      wrapperWidth: wrapper.clientWidth,
      wrapperScrollWidth: wrapper.scrollWidth,
      calendarWidth: calendar.getBoundingClientRect().width,
      minimumColumnWidth: Math.min(...columnWidths)
    };
  });

  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.wrapperScrollWidth).toBeLessThanOrEqual(dimensions.wrapperWidth + 1);
  expect(dimensions.calendarWidth).toBeLessThanOrEqual(dimensions.wrapperWidth + 1);
  expect(dimensions.minimumColumnWidth).toBeGreaterThanOrEqual(70);
  if (process.env.JGC_SCHEDULE_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.JGC_SCHEDULE_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.JGC_SCHEDULE_SCREENSHOT_DIR, "schedule-employee-landscape.png"),
      fullPage: true
    });
  }
  expect(errors).toEqual([]);
  await context.close();
});

test("Admin Schedule switches to its contained mobile agenda and modal", async ({ browser }) => {
  const viewport = { width: 390, height: 844 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installState(page, "admin");
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.renderAdminScheduleCalendar === "function");

  await expect(page.locator(".jgc-schedule-admin")).toBeVisible();
  await expect(page.locator("#adminScheduleAgenda")).toBeVisible();
  await expect(page.locator("#adminScheduleCalendar")).toBeHidden();

  await page.evaluate(() => {
    document.getElementById("adminScheduleModal").classList.add("open");
    document.getElementById("adminScheduleDate").value = new Date().toISOString().slice(0, 10);
  });
  await expect(page.locator("#adminScheduleModal")).toBeVisible();
  await expect(page.locator(".jgc-schedule-modal")).toBeVisible();

  const dimensions = await page.evaluate(() => {
    const modal = document.querySelector(".jgc-schedule-modal");
    const modalRect = modal.getBoundingClientRect();
    return {
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      modalLeft: modalRect.left,
      modalRight: modalRect.right,
      modalColumns: getComputedStyle(document.querySelector(".admin-schedule-form-grid")).gridTemplateColumns,
      controlHeight: document.getElementById("adminScheduleSaveButton").getBoundingClientRect().height
    };
  });
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.modalLeft).toBeGreaterThanOrEqual(0);
  expect(dimensions.modalRight).toBeLessThanOrEqual(viewport.width + 1);
  expect(dimensions.modalColumns.trim().split(/\s+/)).toHaveLength(1);
  expect(dimensions.controlHeight).toBeGreaterThanOrEqual(44);
  expect(await contrastRatio(page, ".jgc-schedule-modal")).toBeGreaterThanOrEqual(4.5);

  if (process.env.JGC_SCHEDULE_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.JGC_SCHEDULE_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.JGC_SCHEDULE_SCREENSHOT_DIR, "schedule-admin-phone.png"),
      fullPage: true
    });
  }

  expect(errors).toEqual([]);
  await context.close();
});

test("Admin Schedule fits all seven calendar columns in phone landscape", async ({ browser }) => {
  const viewport = { width: 844, height: 390 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installState(page, "admin");
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.renderAdminScheduleCalendar === "function");

  await expect(page.locator("#adminScheduleCalendar")).toBeVisible();
  await expect(page.locator("#adminScheduleAgenda")).toBeHidden();
  await expect(page.locator("#adminScheduleCalendar .admin-schedule-head")).toHaveCount(7);

  const dimensions = await page.evaluate(() => {
    const wrapper = document.querySelector(".admin-schedule-calendar-scroll");
    const calendar = document.getElementById("adminScheduleCalendar");
    const columnWidths = Array.from(calendar.querySelectorAll(".admin-schedule-head")).map((head) => head.getBoundingClientRect().width);
    return {
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      wrapperWidth: wrapper.clientWidth,
      wrapperScrollWidth: wrapper.scrollWidth,
      calendarWidth: calendar.getBoundingClientRect().width,
      minimumColumnWidth: Math.min(...columnWidths)
    };
  });

  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.wrapperScrollWidth).toBeLessThanOrEqual(dimensions.wrapperWidth + 1);
  expect(dimensions.calendarWidth).toBeLessThanOrEqual(dimensions.wrapperWidth + 1);
  expect(dimensions.minimumColumnWidth).toBeGreaterThanOrEqual(70);
  if (process.env.JGC_SCHEDULE_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.JGC_SCHEDULE_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.JGC_SCHEDULE_SCREENSHOT_DIR, "schedule-admin-landscape.png"),
      fullPage: true
    });
  }
  expect(errors).toEqual([]);
  await context.close();
});
