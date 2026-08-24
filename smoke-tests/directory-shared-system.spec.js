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
    id: role === "admin" ? "00000000-0000-4000-8000-000000000121" : "00000000-0000-4000-8000-000000000122",
    aud: "authenticated",
    role: "authenticated",
    email: role === "admin" ? "zeth@johngordonconstruction.com" : "directory-test@johngordonconstruction.com",
    user_metadata: { display_name: role === "admin" ? "Zeth Hummel" : "Directory Test" }
  };
  const token = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: user.id, email: user.email }),
    "directory-style-test-signature"
  ].join(".");
  return {
    user,
    auth: {
      access_token: token,
      refresh_token: "directory-style-test-refresh",
      expires_at: now + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user
    }
  };
}

const contacts = [
  { id: "contact-1", name: "Darlene Accounting", role: "Accounting", phone: "613-555-0101", email: "darlene@example.com", notes: "Payroll and invoices", sort_order: 1, is_active: true },
  { id: "contact-2", name: "Jeff Vandriish", role: "Supervisor", phone: "613-555-0102", email: "jeff@example.com", notes: "Field operations", sort_order: 2, is_active: true }
];

const companies = [
  { id: "company-1", company_name: "Emard Lumber and Building Supplies", category: "Supplier", service_type: "Building materials", notes: "Primary material supplier", sort_order: 1, is_active: true }
];

const companyContacts = [
  { id: "company-contact-1", company_id: "company-1", contact_name: "Supplier Dispatch", role: "Dispatch", phone: "613-555-0201", email: "dispatch@example.com", notes: "Delivery scheduling", sort_order: 1, is_active: true }
];

async function installState(page, role = "worker") {
  const state = createSession(role);
  const displayName = role === "admin" ? "Zeth Hummel" : "Directory Test";
  const workerKey = displayName.toLowerCase();

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
      await route.fulfill({ status: 200, contentType: "application/json", body: role === "admin" ? "true" : "false" });
      return;
    }

    const table = requestUrl.pathname.split("/rest/v1/")[1] || "";
    const rowsByTable = {
      contacts,
      subcontractors_suppliers: companies,
      subcontractor_supplier_contacts: companyContacts,
      profiles: [{ id: state.user.id, display_name: displayName, worker_key: workerKey, role, approved: true, account_status: "approved" }],
      accounts: [{ id: state.user.id, display_name: displayName, worker_key: workerKey, role, approved: true, account_status: "approved" }],
      notifications: []
    };
    const rows = Object.prototype.hasOwnProperty.call(rowsByTable, table) ? rowsByTable[table] : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` },
      body: JSON.stringify(accept.includes("vnd.pgrst.object") ? (rows[0] || null) : rows)
    });
  });
}

test("directory family uses one token-only shared visual source", async () => {
  const contactsSource = fs.readFileSync(path.join(portalRoot, "contacts.html"), "utf8");
  const suppliersSource = fs.readFileSync(path.join(portalRoot, "subcontractors-suppliers.html"), "utf8");
  const adminSource = fs.readFileSync(path.join(portalRoot, "admin.html"), "utf8");
  const adminContacts = fs.readFileSync(path.join(portalRoot, "admin-contacts.js"), "utf8");
  const featureCss = fs.readFileSync(path.join(portalRoot, "directory-design-system.css"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");

  for (const source of [contactsSource, suppliersSource]) {
    expect(source).not.toMatch(/<style\b/i);
    expect(source).not.toMatch(/\sstyle\s*=/i);
    expect(source).not.toContain("styles.css");
    expect(source).toContain('jgc-design-system.css?v=7');
    expect(source).toContain('directory-design-system.css?v=2');
    expect(source).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
  }

  expect(featureCss, "Directory-only CSS must use centralized design tokens").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  expect(adminSource).toContain('directory-design-system.css?v=2');
  expect(adminSource).toContain('id="contactsSection" class="card jgc-panel jgc-directory-admin"');
  expect(adminSource).toContain('id="subcontractorsSuppliersSection" class="card jgc-panel jgc-directory-admin"');
  expect(adminContacts).not.toMatch(/\sstyle\s*=/i);
  expect(adminContacts).toContain("jgc-table jgc-table--wide");
  expect(serviceWorker).toContain('"./directory-design-system.css?v=2"');
  expect(serviceWorker).toContain('"./admin-contacts.js?v=2"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  for (const pageCase of [
    { url: "/contacts.html", details: "#contactsDirectoryDetails", cards: ".contact-card", expected: 2 },
    { url: "/subcontractors-suppliers.html", details: "#supplierDirectoryDetails", cards: ".contact-card", expected: 1 }
  ]) {
    test(`${pageCase.url} stays readable and contained on ${viewport.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await installState(page);
      await page.goto(pageCase.url, { waitUntil: "domcontentloaded" });
      await page.locator(pageCase.details).click();
      await expect(page.locator(pageCase.cards)).toHaveCount(pageCase.expected);

      const dimensions = await page.evaluate(() => {
        const controls = [...document.querySelectorAll(".directory-page-shell button, .directory-page-shell input, .directory-page-shell select, .directory-page-shell textarea")].filter((item) => item.offsetParent !== null);
        return {
          bodyWidth: document.body.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          smallestControl: Math.min(...controls.map((item) => item.getBoundingClientRect().height))
        };
      });
      expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
      expect(dimensions.smallestControl).toBeGreaterThanOrEqual(44);
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}

test("embedded Admin directory editors stay contained on phones", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installState(page, "admin");

  for (const tab of ["contacts", "subcontractorsSuppliers"]) {
    await page.goto(`/admin.html?tab=${tab}`, { waitUntil: "domcontentloaded" });
    const section = page.locator(tab === "contacts" ? "#contactsSection" : "#subcontractorsSuppliersSection");
    await expect(section).toBeVisible();
    await expect(section.locator(".jgc-form-grid").first()).toBeVisible();
    const dimensions = await section.evaluate((element) => {
      const controls = [...element.querySelectorAll("button, input, select")].filter((item) => item.offsetParent !== null);
      const viewportWidth = document.documentElement.clientWidth;
      return {
        right: element.getBoundingClientRect().right,
        viewportWidth,
        pageWidth: document.body.scrollWidth,
        smallestControl: Math.min(...controls.map((item) => item.getBoundingClientRect().height))
      };
    });
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.pageWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.smallestControl).toBeGreaterThanOrEqual(44);
  }

  expect(errors).toEqual([]);
  await context.close();
});
