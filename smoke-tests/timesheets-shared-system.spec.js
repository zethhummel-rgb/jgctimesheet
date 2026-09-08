const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");
const projectRef = "xnrljkkszoimegfivlya";
const supabaseOrigin = `https://${projectRef}.supabase.co`;

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createState() {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "00000000-0000-4000-8000-000000000098",
    aud: "authenticated",
    role: "authenticated",
    email: "timesheets-style-test@johngordonconstruction.com",
    user_metadata: { display_name: "Timesheets Style Test" }
  };
  const profile = {
    id: user.id,
    email: user.email,
    display_name: "Timesheets Style Test",
    worker_key: "timesheets style test",
    role: "admin",
    account_status: "approved"
  };
  const token = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: user.id, email: user.email }),
    "timesheets-style-test-signature"
  ].join(".");
  return {
    user,
    profile,
    auth: {
      access_token: token,
      refresh_token: "timesheets-style-test-refresh",
      expires_at: now + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user
    }
  };
}

async function installState(page, jobs = [], theme = null) {
  const state = createState();
  await page.addInitScript(({ state, ref, theme }) => {
    if (theme) {
      localStorage.setItem("jgcPortalTheme", theme);
      localStorage.setItem("jgcPortalTheme:" + state.user.id, theme);
    }
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(state.auth));
    localStorage.setItem("currentWorker", state.profile.worker_key);
    localStorage.setItem("currentWorkerDisplay", state.profile.display_name);
    localStorage.setItem("currentUserEmail", state.profile.email);
    localStorage.setItem("currentUserRole", state.profile.role);
    localStorage.setItem("currentAccountStatus", state.profile.account_status);
    localStorage.setItem("jgcStayLoggedIn", "true");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { state, ref: projectRef, theme });

  await page.route(`${supabaseOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const accept = String(request.headers().accept || "");
    let body = "[]";
    if (url.pathname.startsWith("/auth/v1/user")) body = JSON.stringify(state.user);
    else if (url.pathname.startsWith("/auth/v1/token")) body = JSON.stringify(state.auth);
    else if (url.pathname.includes("/rest/v1/profiles")) body = accept.includes("vnd.pgrst.object") ? JSON.stringify(state.profile) : JSON.stringify([state.profile]);
    else if (url.pathname.includes("/rest/v1/accounts")) body = JSON.stringify([state.profile]);
    else if (url.pathname === "/rest/v1/jobs") body = JSON.stringify(jobs);
    else if (url.pathname.startsWith("/rest/v1/rpc/") && /admin/i.test(url.pathname)) body = "true";
    else if (accept.includes("vnd.pgrst.object")) body = "{}";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*", "Content-Range": "0-0/0" },
      body: request.method() === "HEAD" ? "" : body
    });
  });
}

// Exercise the real job picker with isolated data, including its inherited text colors.
for (const theme of ["light", "dark"]) {
  for (const width of [320, 390, 1280]) {
    test(`timesheet job picker is readable in ${theme} theme at ${width}px`, async ({ browser }, testInfo) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await installState(page, [
        { id: "picker-tm", job_number: "99001", job_name: "Sample Drain Repair", job_type: "T&M", active: true },
        { id: "picker-contract", job_number: "99002", job_name: "Sample Community Centre Wall Panels and Exterior Restoration", job_type: "Contract", active: true }
      ], theme);
      await page.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
      await expect(page.locator(".form-card")).toBeVisible();
      await page.evaluate((value) => { storeJgcThemePreference(value); applyJgcTheme(value); }, theme);
      await page.locator("#jobName").click();
      const options = page.locator("#jobDropdown .job-option");
      await expect(options).toHaveCount(2);

      const assertContrast = async () => {
        await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", theme);
        const measurements = await page.locator("#jobDropdown").evaluate((dropdown) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          const rgba = (color) => {
            ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data);
          };
          const luminance = (channels) => channels.slice(0, 3).reduce((sum, value, i) => {
            const c = value / 255;
            return sum + (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
          }, 0);
          return Array.from(dropdown.querySelectorAll(".job-option-name, .job-option-number, .job-option-type, .job-option-empty")).map((element) => {
            const style = getComputedStyle(element);
            let background = [255, 255, 255, 255];
            const ancestors = [];
            for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
            for (const node of ancestors) {
              const layer = rgba(getComputedStyle(node).backgroundColor);
              const alpha = layer[3] / 255;
              background = background.map((value, i) => i === 3 ? 255 : layer[i] * alpha + value * (1 - alpha));
            }
            const foreground = rgba(style.color);
            const a = luminance(foreground), b = luminance(background);
            return { text: element.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
          });
        });
        expect(measurements.length).toBeGreaterThan(0);
        for (const measurement of measurements) expect(measurement.ratio, measurement.text).toBeGreaterThanOrEqual(4.5);
      };

      await assertContrast();
      for (const option of await options.all()) {
        await option.hover();
        await assertContrast();
        expect(await option.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      }
      await page.mouse.move(0, 0);
      await page.locator("#jobDropdown").screenshot({ path: testInfo.outputPath(`job-picker-${theme}-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
      await options.first().focus();
      await assertContrast();
      // The existing picker intentionally closes shortly after the input loses focus.
      await expect(page.locator("#jobDropdown")).not.toBeVisible();
      await page.locator("#jobName").click();
      await options.last().click();
      await expect(page.locator("#jobNumber")).toHaveValue("99002");
      await expect(page.locator("#jobName")).toHaveValue(/Sample Community Centre/);
      await expect(page.locator("#jobDropdown")).not.toBeVisible();
      await page.locator("#jobName").fill("No matching test job");
      await expect(page.locator(".job-option-empty")).toBeVisible();
      await assertContrast();
      await context.close();
    });
  }
}

test("Timesheets family has one token-only visual source", async () => {
  const employee = fs.readFileSync(path.join(portalRoot, "timesheet.html"), "utf8");
  const employeeHead = employee.match(/<head>[\s\S]*?<\/head>/i)?.[0] || "";
  const featureCss = fs.readFileSync(path.join(portalRoot, "timesheet-design-system.css"), "utf8");
  const admin = fs.readFileSync(path.join(portalRoot, "admin.html"), "utf8");
  const adminCss = fs.readFileSync(path.join(portalRoot, "admin.css"), "utf8");
  const adminJs = fs.readFileSync(path.join(portalRoot, "admin-timesheets.js"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");

  expect(employeeHead).not.toMatch(/<style\b/i);
  expect(employeeHead).not.toContain("styles.css");
  expect(employeeHead).toContain('jgc-design-system.css?v=8');
  expect(employeeHead).toContain('timesheet-design-system.css?v=3');
  expect(employee).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
  expect(employee.match(/<style\b/gi) || [], "Only the generated PDF template keeps its print style block").toHaveLength(1);
  expect(featureCss, "Timesheet-only CSS must use centralized design tokens").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  expect(admin).toContain('timesheet-design-system.css?v=3');
  expect(adminCss).not.toMatch(/admin-time-entry-card|timesheet-(?:edit|worker)/i);
  expect(adminJs.match(/\sstyle\s*=/gi) || [], "Only the generated Admin PDF night row keeps inline print styling").toHaveLength(1);
  const releaseMatch = serviceWorker.match(/const JGC_RELEASE_ID = "(\d+)"/);
  expect(releaseMatch, "The service worker must expose a numeric release id").not.toBeNull();
  expect(Number(releaseMatch[1])).toBeGreaterThanOrEqual(758);
  expect(serviceWorker).toContain('timesheet-design-system.css?v=3');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone portrait", width: 390, height: 844 },
  { name: "phone landscape", width: 844, height: 390 }
]) {
  test(`employee Timesheets remains contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installState(page);
    await page.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".form-card")).toBeVisible();
    await expect(page.locator(".entries-card")).toBeVisible();
    await expect(page.locator("#timesheetCalendar")).toBeVisible();
    await expect(page.locator("#submitButton")).toBeVisible();

    const layout = await page.evaluate(() => {
      const form = document.querySelector(".form-card");
      const button = document.getElementById("submitButton");
      const rect = form && form.getBoundingClientRect();
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        formContained: Boolean(rect && rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1),
        buttonHeight: button ? button.getBoundingClientRect().height : 0,
        inputContained: Array.from(document.querySelectorAll(".form-card input, .form-card select, .form-card textarea")).filter((control) => control.offsetParent !== null).every((control) => {
          const controlRect = control.getBoundingClientRect();
          return rect && controlRect.left >= rect.left - 1 && controlRect.right <= rect.right + 1;
        })
      };
    });
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.formContained).toBe(true);
    expect(layout.inputContained).toBe(true);
    expect(layout.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(errors).toEqual([]);
    await context.close();
  });
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`Admin Timesheets remains usable on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installState(page);
    await page.goto("/admin.html?tab=timesheets", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#timesheetsSection")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#timesheetsSection .admin-time-entry-card")).toBeVisible();
    await page.locator("#timesheetsSection .admin-time-entry-card summary").click();
    await expect(page.locator("#adminTimeEntryWorker")).toBeVisible();
    const layout = await page.evaluate(() => {
      const section = document.getElementById("timesheetsSection");
      const rect = section && section.getBoundingClientRect();
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        sectionContained: Boolean(rect && rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1),
        controlsContained: Array.from(section.querySelectorAll("input, select, textarea")).filter((control) => control.offsetParent !== null).every((control) => {
          const controlRect = control.getBoundingClientRect();
          return controlRect.left >= rect.left - 1 && controlRect.right <= rect.right + 1;
        })
      };
    });
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.sectionContained).toBe(true);
    expect(layout.controlsContained).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });
}
