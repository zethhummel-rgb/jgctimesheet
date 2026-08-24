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
    id: role === "admin" ? "00000000-0000-4000-8000-000000000096" : "00000000-0000-4000-8000-000000000097",
    aud: "authenticated",
    role: "authenticated",
    email: role === "admin" ? "zeth@johngordonconstruction.com" : "work-order-style-test@johngordonconstruction.com",
    user_metadata: { display_name: role === "admin" ? "Zeth Hummel" : "Work Order Style Test" }
  };
  const token = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: user.id, email: user.email }),
    "work-order-style-test-signature"
  ].join(".");
  return {
    user,
    auth: {
      access_token: token,
      refresh_token: "work-order-style-test-refresh",
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
  const displayName = role === "admin" ? "Zeth Hummel" : "Work Order Style Test";
  const workerKey = displayName.toLowerCase();
  const workDate = localDateValue();
  const worker = {
    id: "work-order-worker",
    profile_id: state.user.id,
    display_name: displayName,
    worker_key: workerKey,
    approved: true
  };
  const profile = {
    id: state.user.id,
    email: state.user.email,
    display_name: displayName,
    worker_key: workerKey,
    role,
    approved: true,
    account_status: "approved"
  };
  const workOrder = {
    id: "work-order-1",
    wo_number: "WO26090-001",
    work_order_date: workDate,
    status: "draft",
    locked: false,
    job_id: "job-26090",
    job_number: "26090",
    job_name: "Cornwall Courthouse",
    job_type: "T&M",
    job_address: "Cornwall, Ontario",
    customer: "Site Supervisor",
    customer_po_number: "PO-123",
    description_of_work: "Installed access panels.",
    created_by: state.user.id,
    created_by_name: displayName,
    supervisor_name: displayName,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  const labour = {
    id: "work-order-labour-1",
    work_order_id: workOrder.id,
    employee_id: worker.id,
    profile_id: state.user.id,
    employee_name: displayName,
    worker_key: workerKey,
    hours: 8,
    complete: true
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
      const rpcName = requestUrl.pathname.split("/rest/v1/rpc/")[1] || "";
      const body = rpcName.includes("admin") || rpcName.includes("is_") ? (role === "admin" ? "true" : "false") : "[]";
      await route.fulfill({ status: 200, contentType: "application/json", body });
      return;
    }

    const table = requestUrl.pathname.split("/rest/v1/")[1] || "";
    const rowsByTable = {
      profiles: [profile],
      accounts: [profile],
      work_orders: [workOrder],
      work_order_purchase_orders: [],
      work_order_labour: [labour],
      work_order_equipment: [],
      work_order_rentals: [],
      work_order_materials: [],
      work_order_misc_items: [],
      work_order_travel: [],
      work_order_labour_workers: [worker],
      employee_feature_access: [{ worker_id: worker.id, feature_key: "work_orders", enabled: true }],
      jobs: [{ id: "job-26090", job_number: "26090", job_name: "Cornwall Courthouse", job_type: "T&M", address: "Cornwall, Ontario", active: true }],
      equipment_vehicles: [{ id: "vehicle-1", name: "White F-150", identification_number: "BD48405", equipment_type: "Vehicle", operator_name: displayName, is_active: true }],
      timesheet_entries: [{ id: "time-1", worker_name: workerKey, week_start: workDate, job_name: "Cornwall Courthouse", job_number: "26090", day_of_week: "Sunday", hours: 8, entry_type: "Work" }],
      previous_timesheet_weeks: [],
      digital_po_work_order_links: [],
      digital_purchase_orders: [],
      notifications: []
    };
    const rows = Object.prototype.hasOwnProperty.call(rowsByTable, table) ? rowsByTable[table] : [];
    const responseBody = accept.includes("vnd.pgrst.object") ? (rows[0] || null) : rows;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` },
      body: JSON.stringify(responseBody)
    });
  });

  return { state, displayName, workerKey, workOrder, labour };
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

test("Work Orders family uses one token-only shared visual source", async () => {
  const pageSource = fs.readFileSync(path.join(portalRoot, "work-orders.html"), "utf8");
  const pageHead = pageSource.match(/<head>([\s\S]*?)<\/head>/i)?.[1] || "";
  const featureCss = fs.readFileSync(path.join(portalRoot, "work-orders-design-system.css"), "utf8");
  const adminSource = fs.readFileSync(path.join(portalRoot, "admin.html"), "utf8");
  const adminCss = fs.readFileSync(path.join(portalRoot, "admin.css"), "utf8");
  const adminWorkOrders = fs.readFileSync(path.join(portalRoot, "admin-work-orders.js"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");

  expect(pageHead).not.toMatch(/<style\b/i);
  expect(pageSource).not.toMatch(/\sstyle\s*=/i);
  expect(pageSource).not.toContain('href="styles.css');
  expect(pageSource).toContain('jgc-design-system.css?v=7');
  expect(pageSource).toContain('work-orders-design-system.css?v=1');
  expect(pageSource).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
  expect(featureCss, "Work Orders CSS must use centralized design tokens instead of page colours").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);

  expect(adminSource).toContain('admin.css?v=16');
  expect(adminSource).toContain('work-orders-design-system.css?v=1');
  expect(adminSource).toContain('admin-work-orders.js?v=3');
  expect(adminSource).toContain('class="card jgc-panel jgc-work-orders-admin"');
  expect(adminWorkOrders).not.toMatch(/class="small" style=/i);
  expect(adminCss).not.toContain(".admin-wo-management {");
  expect(adminCss).not.toContain(".admin-wo-editor-panel {");

  expect(serviceWorker).toMatch(/const JGC_RELEASE_ID = "\d+";/);
  expect(serviceWorker).toContain('"./admin.css?v=16"');
  expect(serviceWorker).toContain('"./work-orders-design-system.css?v=1"');
  expect(serviceWorker).toContain('"./admin-work-orders.js?v=3"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`populated employee Work Orders stays readable and contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installState(page, "worker");
    await page.goto("/work-orders.html", { waitUntil: "domcontentloaded" });

    await expect(page.locator("#workOrderFormCard")).toBeVisible();
    await expect(page.locator("#woJobSearch")).toBeVisible();
    await expect(page.locator("#employeePicker .employee-check")).toHaveCount(1);
    await expect(page.locator(".form-section.collapsible")).toHaveCount(6);
    await page.locator("#workOrderManagementCard .collapse-header").click();
    await expect(page.locator("#managementBody")).toBeVisible();
    await expect(page.locator("#woList .wo-management-table tbody tr")).toHaveCount(1);

    const dimensions = await page.evaluate(() => {
      const form = document.getElementById("workOrderFormCard");
      const formRect = form.getBoundingClientRect();
      const fieldOverflows = Array.from(form.querySelectorAll("input:not([type='hidden']), select, textarea")).filter((field) => {
        const rect = field.getBoundingClientRect();
        return rect.width > 0 && (rect.left < formRect.left - 1 || rect.right > formRect.right + 1);
      }).map((field) => field.id || field.getAttribute("data-material-field") || field.type);
      const firstButton = document.getElementById("saveButton");
      const managementTable = document.querySelector("#woList .wo-management-table");
      return {
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        formColumns: getComputedStyle(document.querySelector("#workOrderFormCard .form-grid")).gridTemplateColumns,
        firstButtonHeight: firstButton ? firstButton.getBoundingClientRect().height : 0,
        fieldOverflows,
        managementScrollable: managementTable ? managementTable.scrollWidth > managementTable.clientWidth : false
      };
    });

    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.fieldOverflows).toEqual([]);
    expect(dimensions.firstButtonHeight).toBeGreaterThanOrEqual(44);
    if (viewport.name === "phone") {
      expect(dimensions.formColumns.trim().split(/\s+/)).toHaveLength(1);
      expect(dimensions.managementScrollable).toBe(true);
      const bottomNav = page.locator(".jgc-mobile-bottom-nav");
      await expect(bottomNav).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight / 2)));
      const navBox = await bottomNav.boundingBox();
      expect(Math.abs((navBox.y + navBox.height) - viewport.height)).toBeLessThanOrEqual(1);
    } else {
      expect(dimensions.formColumns.trim().split(/\s+/)).toHaveLength(2);
    }

    for (const selector of [".card", "#formTitle", ".jgc-button", ".jgc-input"]) {
      expect(await contrastRatio(page, selector), `${selector} must meet normal-text contrast`).toBeGreaterThanOrEqual(4.5);
    }

    if (process.env.JGC_WORK_ORDER_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.JGC_WORK_ORDER_SCREENSHOT_DIR, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(process.env.JGC_WORK_ORDER_SCREENSHOT_DIR, `work-orders-${viewport.name}.png`),
        fullPage: true
      });
    }

    expect(errors).toEqual([]);
    await context.close();
  });
}

test("Admin Work Orders stays contained and keeps its editor and management actions", async ({ browser }) => {
  const viewport = { width: 390, height: 844 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const data = await installState(page, "admin");
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.renderAdminWorkOrders === "function");

  await page.evaluate(({ workOrder, labour }) => {
    workOrders = [workOrder];
    workOrderLabour = [labour];
    workOrderPurchaseOrders = [];
    adminWorkOrderDigitalPoCounts = {};
    showTab("workOrders");
    renderAdminWorkOrders();
  }, { workOrder: data.workOrder, labour: data.labour });

  await expect(page.locator("#workOrdersSection")).toBeVisible();
  await expect(page.locator("#adminWorkOrdersSummary .summary-tile")).toHaveCount(5);
  await expect(page.locator("#adminWorkOrdersList tbody tr")).toHaveCount(1);
  await expect(page.locator("#adminWorkOrdersList .jgc-button", { hasText: "Edit" })).toBeVisible();
  await expect(page.locator("#adminWorkOrdersList .jgc-button", { hasText: "Delete" })).toBeVisible();
  await page.locator("#adminWorkOrdersList .jgc-button", { hasText: "Edit" }).click();
  await expect(page.locator("#adminWorkOrderEditorPanel")).toBeVisible();
  const editor = page.frameLocator("#adminWorkOrderEditorFrame");
  await expect(editor.locator("#workOrderFormCard")).toBeVisible();
  await expect(editor.locator("#workOrderManagementCard")).toBeHidden();
  await expect(page.locator("#adminWorkOrderEditorPanel .jgc-button", { hasText: "Close Editor" })).toBeVisible();

  const dimensions = await page.evaluate(() => {
    const section = document.getElementById("workOrdersSection");
    const sectionRect = section.getBoundingClientRect();
    const wrapper = document.querySelector("#adminWorkOrdersList .admin-wo-management-table");
    const filters = document.querySelector("#workOrdersSection .filters");
    const summaryGrid = document.querySelector("#adminWorkOrdersSummary .summary-grid");
    return {
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      sectionLeft: sectionRect.left,
      sectionRight: sectionRect.right,
      tableScrollable: wrapper.scrollWidth > wrapper.clientWidth,
      filterColumns: getComputedStyle(filters).gridTemplateColumns,
      summaryColumns: getComputedStyle(summaryGrid).gridTemplateColumns
    };
  });

  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.sectionLeft).toBeGreaterThanOrEqual(0);
  expect(dimensions.sectionRight).toBeLessThanOrEqual(viewport.width + 1);
  expect(dimensions.tableScrollable).toBe(true);
  expect(dimensions.filterColumns.trim().split(/\s+/)).toHaveLength(1);
  expect(dimensions.summaryColumns.trim().split(/\s+/)).toHaveLength(1);
  expect(await contrastRatio(page, "#workOrdersSection .summary-tile")).toBeGreaterThanOrEqual(4.5);
  expect(errors).toEqual([]);

  if (process.env.JGC_WORK_ORDER_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.JGC_WORK_ORDER_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.JGC_WORK_ORDER_SCREENSHOT_DIR, "work-orders-admin-phone.png"),
      fullPage: true
    });
  }

  await context.close();
});
