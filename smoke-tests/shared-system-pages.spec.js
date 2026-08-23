const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");
const sharedPages = [
  "certificates.html",
  "equipment-vehicles.html",
  "inspections.html",
  "permits.html",
  "policies-admin.html",
  "policies-announcements.html",
  "reports.html",
  "reset-password.html",
  "subcontractor.html"
];
const removedStylesheets = [
  "styles.css",
  "employee-hub-design-system.css",
  "policy-design-system.css",
  "reset-password-design-system.css",
  "subcontractor-design-system.css",
  "permit-design-system.css",
  "report-design-system.css"
];

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createSession(role) {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "00000000-0000-4000-8000-000000000091",
    aud: "authenticated",
    role: "authenticated",
    email: "shared-system-test@johngordonconstruction.com",
    user_metadata: { display_name: "Shared System Test" }
  };
  const token = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: user.id, email: user.email }),
    "shared-system-test-signature"
  ].join(".");
  return {
    user,
    role,
    auth: {
      access_token: token,
      refresh_token: "shared-system-test-refresh",
      expires_at: now + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user
    }
  };
}

async function installState(page, role) {
  const state = createSession(role);
  await page.addInitScript(({ state, ref }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(state.auth));
    localStorage.setItem("currentWorker", "shared system test");
    localStorage.setItem("currentWorkerDisplay", "Shared System Test");
    localStorage.setItem("currentUserEmail", state.user.email);
    localStorage.setItem("currentUserRole", state.role);
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { state, ref: "xnrljkkszoimegfivlya" });

  await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.startsWith("/auth/v1/user")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.user) });
      return;
    }
    if (requestUrl.pathname.startsWith("/auth/v1/token")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.auth) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

test("the nine migrated pages have one visual source of truth", async () => {
  for (const file of sharedPages) {
    const source = fs.readFileSync(path.join(portalRoot, file), "utf8");
    expect(source, `${file} must not retain inline CSS`).not.toMatch(/<style\b/i);
    expect(source, `${file} must load design-system version 7`).toContain('jgc-design-system.css?v=7');
    expect(source, `${file} must opt into the centralized component system`).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
    for (const stylesheet of removedStylesheets) {
      expect(source, `${file} must not load ${stylesheet}`).not.toContain(stylesheet);
    }
  }
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`shared pages render without page overflow at ${viewport.name} width`, async ({ browser }, testInfo) => {
    for (const file of sharedPages) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("favicon")) {
          consoleErrors.push(message.text());
        }
      });
      await installState(page, file === "subcontractor.html" ? "subcontractor" : "admin");
      await page.goto(`/${file}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(150);

      await expect(page.locator('link[data-jgc-design-system="7"]')).toHaveCount(1);
      const dimensions = await page.evaluate(() => ({
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        pageBackground: getComputedStyle(document.body).backgroundColor,
        pageColor: getComputedStyle(document.body).color
      }));
      expect(dimensions.bodyWidth, `${file} overflowed at ${viewport.name} width`).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
      expect(dimensions.pageBackground).toBe("rgb(6, 17, 15)");
      expect(dimensions.pageColor).toBe("rgb(244, 248, 244)");
      expect(consoleErrors, `${file} logged browser errors`).toEqual([]);

      const bottomNav = page.locator(".jgc-mobile-bottom-nav");
      if (viewport.name === "phone" && await bottomNav.count()) {
        for (const scrollRatio of [0, 0.5, 1]) {
          await page.evaluate((ratio) => {
            const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
            window.scrollTo(0, maxScroll * ratio);
          }, scrollRatio);
          await page.waitForTimeout(25);
          const navBox = await bottomNav.boundingBox();
          expect(navBox, `${file} mobile menu must be visible`).not.toBeNull();
          expect(
            Math.abs((navBox.y + navBox.height) - viewport.height),
            `${file} mobile menu must stay pinned to the viewport bottom`
          ).toBeLessThanOrEqual(1);
        }
      }

      if (process.env.JGC_SHARED_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.JGC_SHARED_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({
          path: path.join(process.env.JGC_SHARED_SCREENSHOT_DIR, `${path.basename(file, ".html")}-${viewport.name}.png`),
          fullPage: true
        });
      }
      await context.close();
    }
  });
}

test("certificate and equipment records become readable mobile cards", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await installState(page, "admin");

  await page.goto("/certificates.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    certificates = [{
      id: "certificate-mobile-test",
      certificate_name: "Working at Heights",
      expiry_date: "2029-03-16",
      notes: "Mobile certificate record"
    }];
    certificateUrls = {};
    renderCertificates();
  });

  const certificateTable = page.locator("#certificatesList .jgc-table--mobile-cards");
  await expect(certificateTable).toBeVisible();
  await expect(certificateTable.locator("thead")).toHaveCSS("display", "none");
  await expect(certificateTable.locator("td").first()).toHaveCSS("display", "grid");
  await expect(certificateTable.locator('td[data-label="Certificate"]')).toContainText("Working at Heights");
  expect(await certificateTable.locator("td:not([data-label])").count()).toBe(0);
  expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(391);

  await page.goto("/equipment-vehicles.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    document.getElementById("equipmentDirectoryDetails").open = true;
  });
  await page.waitForFunction(() => !equipmentDirectoryLoading);
  await page.evaluate(() => {
    const sample = {
      name: "White F-150 Service Truck",
      equipment_type: "Vehicle",
      identification_number: "BD48405",
      operator_name: "Portal Test",
      current_km: 123456,
      ownership_type: "owned",
      rental_supplier: "",
      billable_equipment: true,
      transportation_required: false,
      yearly_inspection_expiry: "2027-08-23"
    };
    document.getElementById("equipmentList").innerHTML = renderEquipmentTable([sample], "Vehicles");
  });

  const equipmentTable = page.locator("#equipmentList .jgc-table--mobile-cards");
  await expect(equipmentTable).toBeVisible();
  await expect(equipmentTable.locator("thead")).toHaveCSS("display", "none");
  await expect(equipmentTable.locator("td").first()).toHaveCSS("display", "grid");
  await expect(equipmentTable.locator('td[data-label="Name"]')).toContainText("White F-150 Service Truck");
  expect(await equipmentTable.locator("td:not([data-label])").count()).toBe(0);
  expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(391);

  await context.close();
});

test("admin notice and policy tables can be swiped horizontally on phones", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await installState(page, "admin");
  await page.goto("/admin.html", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const panel = document.createElement("details");
    panel.className = "sub-card admin-collapsible-panel";
    panel.open = true;
    panel.innerHTML = `
      <summary>Announcements / Notices</summary>
      <div id="mobileTableScrollTest" class="table-wrap jgc-table-wrap" tabindex="0">
        <table class="jgc-table jgc-table--wide">
          <thead><tr><th>Title</th><th>Message</th><th>PDF</th><th>Read Status</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody><tr><td>Scheduled</td><td>A deliberately long announcement message</td><td>-</td><td>0/5 read</td><td>Aug 24</td><td>Delete</td></tr></tbody>
        </table>
      </div>`;
    document.body.appendChild(panel);
  });

  const wrapper = page.locator("#mobileTableScrollTest");
  const metrics = await wrapper.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX
  }));
  expect(metrics.overflowX).toBe("auto");
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  const scrolled = await wrapper.evaluate((element) => {
    element.scrollLeft = 140;
    return element.scrollLeft;
  });
  expect(scrolled).toBeGreaterThan(0);
  await context.close();
});

test("employee mobile More menu includes the Jobs page", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await installState(page, "worker");
  await page.goto("/home.html", { waitUntil: "domcontentloaded" });
  const moreButton = page.locator("#jgcMobileMoreButton");
  await expect(moreButton).toBeVisible();
  await moreButton.click();
  const jobsLink = page.locator('.jgc-mobile-more-sheet a[href="jobs.html"]');
  await expect(jobsLink).toBeVisible();
  await expect(jobsLink).toHaveText("Jobs");
  await context.close();
});

test("shared token combinations meet normal-text contrast", async ({ page }) => {
  await page.goto("/reset-password.html", { waitUntil: "domcontentloaded" });
  const ratios = await page.evaluate(() => {
    function channel(value) {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
    }
    function luminance(hex) {
      const value = hex.replace("#", "");
      const rgb = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
      return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
    }
    function contrast(foreground, background) {
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    }
    return {
      pageText: contrast("#f4f8f4", "#06110f"),
      mutedText: contrast("#b9c9bd", "#06110f"),
      panelText: contrast("#f4f8f4", "#0e2119"),
      cardText: contrast("#f4f8f4", "#142a20"),
      cardMuted: contrast("#b9c9bd", "#142a20"),
      tableHeader: contrast("#f4f8f4", "#173a24"),
      tableRow: contrast("#f4f8f4", "#101d1a"),
      tableAlternateRow: contrast("#f4f8f4", "#162421"),
      primaryButton: contrast("#ffffff", "#13843f"),
      secondaryButton: contrast("#ffffff", "#1b3127"),
      dangerButton: contrast("#ffffff", "#c72a22"),
      warningBadge: contrast("#fff6d6", "#775816"),
      inputText: contrast("#102018", "#f7faf6"),
      greenLink: contrast("#52dc63", "#06110f")
    };
  });
  for (const [name, ratio] of Object.entries(ratios)) {
    expect(ratio, `${name} contrast ratio`).toBeGreaterThanOrEqual(4.5);
  }
});
