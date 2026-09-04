const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");
const projectRef = "xnrljkkszoimegfivlya";
const supabaseOrigin = `https://${projectRef}.supabase.co`;
const fakeUser = {
  id: "00000000-0000-4000-8000-000000000095",
  aud: "authenticated",
  role: "authenticated",
  email: "po-style-test@johngordonconstruction.com",
  user_metadata: { display_name: "PO Style Test" }
};
const fakeProfile = {
  id: fakeUser.id,
  email: fakeUser.email,
  display_name: "PO Style Test",
  worker_key: "po style test",
  role: "admin",
  account_status: "approved"
};

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
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
    "po-style-test-signature"
  ].join(".");
  return {
    access_token: accessToken,
    refresh_token: "po-style-test-refresh",
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: "bearer",
    user: fakeUser
  };
}

async function installState(page) {
  const session = createSession();
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
    } else if (accept.includes("application/vnd.pgrst.object")) {
      body = "{}";
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/0" },
      body: request.method() === "HEAD" ? "" : body
    });
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

test("Purchase Orders family uses the shared visual source without inline styling", async () => {
  const employeeSource = fs.readFileSync(path.join(portalRoot, "purchase-orders.html"), "utf8");
  const adminSource = fs.readFileSync(path.join(portalRoot, "purchase-orders-admin.html"), "utf8");
  const adminScript = fs.readFileSync(path.join(portalRoot, "purchase-orders-admin.js"), "utf8");
  const featureCss = fs.readFileSync(path.join(portalRoot, "purchase-orders.css"), "utf8");

  for (const source of [employeeSource, adminSource]) {
    expect(source).not.toMatch(/<style\b/i);
    expect(source).not.toMatch(/\sstyle\s*=/i);
    expect(source).not.toContain("styles.css");
    expect(source).toContain('jgc-design-system.css?v=8');
    expect(source).toContain('purchase-orders.css?v=22');
    expect(source).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
  }
  expect(adminSource).toContain('purchase-orders-admin.js?v=14');
  expect(adminScript).not.toMatch(/\sstyle\s*=/i);
  expect(featureCss, "PO-only CSS must use centralized design tokens instead of page colours").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`employee Purchase Orders stays readable and contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installState(page);
    await page.goto("/purchase-orders.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".po-tabs")).toBeVisible();
    await expect(page.locator("#poNewButton")).toBeVisible();
    await expect(page.locator("#poSearch")).toBeVisible();
    await expect(page.locator("#poRangeBadge")).toBeHidden();

    const dimensions = await page.evaluate(() => {
      const newButton = document.getElementById("poNewButton");
      return {
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        controlHeight: newButton ? newButton.getBoundingClientRect().height : 0
      };
    });
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.controlHeight).toBeGreaterThanOrEqual(42);

    if (viewport.name === "phone") {
      const bottomNav = page.locator(".jgc-mobile-bottom-nav");
      await expect(bottomNav).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight / 2)));
      const navBox = await bottomNav.boundingBox();
      expect(Math.abs((navBox.y + navBox.height) - viewport.height)).toBeLessThanOrEqual(1);
    }
    for (const selector of [".po-tabs", "#poNewButton", ".po-status-row"]) {
      expect(await contrastRatio(page, selector), `${selector} must meet normal-text contrast`).toBeGreaterThanOrEqual(4.5);
    }
    if (process.env.JGC_PO_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.JGC_PO_SCREENSHOT_DIR, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(process.env.JGC_PO_SCREENSHOT_DIR, `purchase-orders-${viewport.name}.png`),
        fullPage: true
      });
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("light-theme PO controls and PO numbers remain readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installState(page);
  await page.goto("/purchase-orders.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#poCurrentUser")).toContainText("PO Style Test");
  await expect(page.locator("#poList")).toContainText("No purchase orders found");
  await page.locator("html").evaluate((element) => element.setAttribute("data-jgc-theme", "light"));
  await page.evaluate(() => {
    const list = document.getElementById("poList");
    if (list) {
      list.innerHTML = `
        <article class="po-record jgc-card">
          <div class="po-record-header">
            <div><div class="po-record-number">PO-30506</div><div class="po-record-title">Supplier not entered</div></div>
            <span class="po-badge green jgc-badge">Draft</span>
          </div>
          <div class="po-record-meta"><span><strong>Job:</strong> Shop</span></div>
        </article>`;
    }
    const formView = document.getElementById("poFormView");
    if (formView) formView.hidden = false;
    const poNumber = document.getElementById("poNumberDisplay");
    if (poNumber) poNumber.textContent = "PO-30506";
    const syncButton = document.getElementById("poSyncButton");
    const openPendingButton = document.getElementById("poOpenPendingButton");
    if (syncButton) syncButton.disabled = true;
    if (openPendingButton) openPendingButton.disabled = true;
  });

  await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", "light");
  await expect(page.locator(".po-record-number")).toHaveText("PO-30506");
  await expect(page.locator("#poNumberDisplay")).toHaveText("PO-30506");
  await expect(page.locator("#poSyncButton")).toHaveCSS("opacity", "1");

  for (const selector of [
    ".po-tabs button.active",
    ".po-tabs button:not(.active)",
    "#poSyncButton",
    "#poOpenPendingButton",
    ".po-record-number",
    ".po-record-meta strong",
    "#poNumberDisplay"
  ]) {
    expect(await contrastRatio(page, selector), `${selector} must meet normal-text contrast in light mode`).toBeGreaterThanOrEqual(4.5);
  }
  if (process.env.JGC_PO_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.JGC_PO_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: path.join(process.env.JGC_PO_SCREENSHOT_DIR, "purchase-orders-light-phone.png"),
      fullPage: true
    });
  }
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`Purchase Order Admin stays readable and contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installState(page);
    await page.goto("/purchase-orders-admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".po-admin-summary")).toBeVisible();
    await expect(page.locator('[data-admin-tab="devices"]')).toBeVisible();
    await page.locator('[data-admin-tab="devices"]').click();
    await expect(page.locator("#poAdminDevicesView")).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      tabHeight: document.querySelector("[data-admin-tab=devices]")?.getBoundingClientRect().height || 0,
      summaryColumns: getComputedStyle(document.querySelector(".po-admin-summary")).gridTemplateColumns
    }));
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.tabHeight).toBeGreaterThanOrEqual(40);
    if (viewport.name === "phone") {
      expect(dimensions.summaryColumns.split(" ").length).toBe(2);
      const bottomNav = page.locator(".jgc-mobile-bottom-nav");
      await expect(bottomNav).toBeVisible();
      const navBox = await bottomNav.boundingBox();
      expect(Math.abs((navBox.y + navBox.height) - viewport.height)).toBeLessThanOrEqual(1);
    }
    for (const selector of [".po-admin-summary", ".po-tabs", "[data-admin-tab=devices]"]) {
      expect(await contrastRatio(page, selector), `${selector} must meet normal-text contrast`).toBeGreaterThanOrEqual(4.5);
    }
    if (process.env.JGC_PO_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.JGC_PO_SCREENSHOT_DIR, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(process.env.JGC_PO_SCREENSHOT_DIR, `purchase-orders-admin-${viewport.name}.png`),
        fullPage: true
      });
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}
