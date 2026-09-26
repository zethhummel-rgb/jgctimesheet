const { test, expect } = require("@playwright/test");

const USER_ID = "00000000-0000-4000-8000-000000000094";
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1366, height: 900 };

async function signIn(page, theme = "light") {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "zeth@johngordonconstruction.com", user_metadata: { display_name: "Zeth Hummel" } };
  const auth = { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: USER_ID, exp: now + 3600, role: "authenticated" }), "page-bar"].join("."), refresh_token: "page-bar", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
  await page.addInitScript(({ auth, theme, id }) => {
    localStorage.setItem("jgcPortalTheme", theme);
    localStorage.setItem("jgcPortalTheme:" + id, theme);
    localStorage.setItem("sb-xnrljkkszoimegfivlya-auth-token", JSON.stringify(auth));
    localStorage.setItem("currentWorker", "zeth hummel");
    localStorage.setItem("currentWorkerDisplay", "Zeth Hummel");
    localStorage.setItem("currentUserEmail", auth.user.email);
    localStorage.setItem("currentUserRole", "admin");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    localStorage.setItem("jgcPushOnboarding:v1:zeth hummel", "dismissed");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { auth, theme, id: USER_ID });
  await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", route => {
    const p = new URL(route.request().url()).pathname;
    if (p.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    if (p.includes("/rpc/")) return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
    if (p.endsWith("/profiles")) {
      const profile = { id: USER_ID, email: user.email, display_name: "Zeth Hummel", worker_key: "zeth hummel", role: "admin", account_status: "approved" };
      const single = String(route.request().headers().accept || "").includes("vnd.pgrst.object");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(single ? profile : [profile]) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

const bar = page => page.locator("#jgcPageBar");

// Every Admin page outside admin.html: its bar title, and the old on-screen header that it replaces.
const STANDALONE = [
  ["/accounting-admin.html", "Accounting", "#accountingCurrentUser"],
  ["/purchase-orders-admin.html", "Purchase Orders", "#poAdminCurrentUser"],
  ["/certificates-admin.html", "Certificates", "#currentUser"],
  ["/employee-access-admin.html", "Employee Page Access", "#employeeAccessCurrentUser"],
  ["/diagnostics-admin.html", "Portal Diagnostics", "#diagnosticsCurrentUser"],
  ["/job-lists-admin.html", "Job Notes", "#jobListsAdminCurrentUser"],
  ["/jsa-library-admin.html", "JSA Library", ".jgc-page-header .jgc-page-user"],
  ["/employee-writeups-admin.html", "Employee Write-Ups", ".jgc-page-header .jgc-page-user"],
  ["/policies-admin.html", "Manage Policies", "#workerName"],
  ["/accounts.html", "Accounts", "#currentUser"],
  ["/notification-settings.html", "Notification Settings", "#currentUser"]
];

for (const [url, title, userLine] of STANDALONE) {
  test(`${title} gets the page bar instead of its old title and signed-in line`, async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signIn(page);
    await page.goto(url, { waitUntil: "load" });
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).locator(".jgc-page-bar__title")).toHaveText(title);
    await expect(bar(page).locator(".jgc-page-bar__tile svg")).toBeVisible();
    await expect(page.locator(userLine)).toBeHidden();
    await expect(page.locator("h1").first()).toBeHidden();
    // Computers keep the Admin tab row, directly above the bar.
    await expect(page.locator(".jgc-admin-nav")).toBeVisible();
    expect(await page.evaluate(() => document.querySelector(".jgc-admin-nav").nextElementSibling.id)).toBe("jgcPageBar");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test("admin.html follows the open section and the Add time action opens the time form", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page);
  await page.goto("/admin.html?tab=timesheets", { waitUntil: "load" });
  await expect(bar(page).locator(".jgc-page-bar__title")).toHaveText("Timesheets");
  await expect(bar(page).locator(".jgc-page-bar__subtitle")).toHaveText("Live entries and payroll");
  await expect(bar(page).locator(".jgc-page-bar__tile")).toHaveAttribute("data-tone", "amber");
  await expect(page.locator("body > h1")).toBeHidden();
  await expect(page.locator("#currentUser")).toBeHidden();
  // The panel no longer repeats "Timesheets" right under the bar.
  await expect(page.locator("#timesheetsSection > h2")).toBeHidden();

  const form = page.locator("#timesheetsSection details.admin-time-entry-card");
  await expect(form).not.toHaveAttribute("open", "");
  await bar(page).getByRole("button", { name: "Add time" }).click();
  await expect(form).toHaveAttribute("open", "");

  await page.locator(".jgc-admin-nav").getByRole("link", { name: "Tasks" }).click();
  await expect(bar(page).locator(".jgc-page-bar__title")).toHaveText("Tasks");
  await expect(bar(page).locator(".jgc-page-bar__action")).toBeHidden();

  await page.locator(".jgc-admin-nav").getByRole("link", { name: "Admin Tools" }).click();
  await expect(bar(page).locator(".jgc-page-bar__title")).toHaveText("Admin Tools");
});

test("Summary keeps its own greeting on computers and shows the bar on phones", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page);
  await page.goto("/admin.html?tab=summary", { waitUntil: "load" });
  await expect(page.locator("#dashboardGreeting")).toBeVisible();
  await expect(bar(page)).toBeHidden();
  await page.setViewportSize(PHONE);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).getByRole("button", { name: /Summary, switch Admin section/ })).toBeVisible();
});

test("phones fold the Admin tabs into the bar title", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page);
  await page.goto("/admin.html?tab=timesheets", { waitUntil: "load" });
  await expect(page.locator(".jgc-admin-nav")).toBeHidden();
  await expect(bar(page).locator(".jgc-page-bar__title")).toBeHidden();

  const switcher = bar(page).getByRole("button", { name: "Timesheets, switch Admin section" });
  await expect(switcher).toHaveAttribute("aria-expanded", "false");
  await switcher.click();
  const menu = page.locator("#jgcPageBarMenu");
  await expect(menu).toBeVisible();
  await expect(switcher).toHaveAttribute("aria-expanded", "true");
  await expect(menu.locator("a")).toHaveText(["Summary", "Timesheets", "Accounting", "Safety Records", "Vacation Requests", "Tasks", "Work Orders", "Purchase Orders", "Admin Tools"]);
  await expect(menu.locator('a[aria-current="page"]')).toHaveText("Timesheets");
  // Everything in the menu fits on screen and is easy to tap.
  const boxes = await menu.locator("a").evaluateAll(links => links.map(link => link.getBoundingClientRect()).map(r => ({ left: r.left, right: r.right, height: r.height })));
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(390);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  await menu.getByRole("link", { name: "Vacation Requests" }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator("#vacationSection")).toBeVisible();
  await expect(bar(page).getByRole("button", { name: "Vacation Requests, switch Admin section" })).toBeVisible();

  // Escape and tapping elsewhere both close the menu.
  await bar(page).locator(".jgc-page-bar__switch").click();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await bar(page).locator(".jgc-page-bar__switch").click();
  await page.mouse.click(3, 700);
  await expect(menu).toBeHidden();

  // Other Admin pages link to their section.
  await page.goto("/employee-writeups-admin.html", { waitUntil: "load" });
  await bar(page).locator(".jgc-page-bar__switch").click();
  await expect(page.locator('#jgcPageBarMenu a[aria-current="page"]')).toHaveText("Admin Tools");
  await expect(page.locator("#jgcPageBarMenu").getByRole("link", { name: "Timesheets" })).toHaveAttribute("href", "admin.html?tab=timesheets");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("the switcher menu leaves out Accounting when the account has no accounting access", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page);
  await page.goto("/admin.html?tab=tasks", { waitUntil: "load" });
  // Let the real access check finish first, then take access away.
  await expect(page.locator("html")).toHaveAttribute("data-jgc-accounting-access", "enabled");
  await page.evaluate(() => setJgcAccountingNavigationAccess(false));
  await bar(page).locator(".jgc-page-bar__switch").click();
  await expect(page.locator("#jgcPageBarMenu a")).toHaveCount(8);
  expect(await page.locator("#jgcPageBarMenu a").allTextContents()).not.toContain("Accounting");
});

test("printouts keep the original header and never show the bar", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page);
  await page.goto("/accounts.html", { waitUntil: "load" });
  await expect(bar(page)).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(bar(page)).toBeHidden();
  await expect(page.locator(".accounts-page-header h1")).toBeVisible();
  await expect(page.locator("#currentUser")).toBeVisible();
});

test("the gear panel shows who is signed in", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page);
  await page.goto("/admin.html?tab=tasks", { waitUntil: "load" });
  await page.locator("#jgcAppearanceSettingsButton").click();
  await expect(page.locator(".jgc-appearance-settings__account")).toHaveText("Signed in as Zeth Hummel");
});

test("embedded Admin pages do not get a bar", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page);
  await page.goto("/certificates-admin.html?embedded=1", { waitUntil: "load" });
  await expect(page.locator("#jgcPageBar")).toHaveCount(0);
});

for (const theme of ["light", "dark"]) {
  for (const viewport of [PHONE, DESKTOP]) {
    test(`page bar text is readable in ${theme} mode at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, theme);
      await page.goto("/admin.html?tab=timesheets", { waitUntil: "load" });
      await expect(bar(page)).toBeVisible();
      if (viewport === PHONE) await bar(page).locator(".jgc-page-bar__switch").click();
      const samples = await page.locator("#jgcPageBar :is(.jgc-page-bar__title, .jgc-page-bar__switch, .jgc-page-bar__subtitle, .jgc-page-bar__action, .jgc-page-bar__menu a > span:last-of-type)").evaluateAll(elements => {
        const parse = c => (c.match(/[\d.]+/g) || []).map(Number);
        const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        // The bar is a gradient: measure against its lighter end (#0f5a33); translucent layers sit on it.
        const background = el => {
          for (let n = el; n; n = n.parentElement) {
            if (n.id === "jgcPageBar") return [15, 90, 51];
            const c = parse(getComputedStyle(n).backgroundColor);
            if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c.slice(0, 3);
          }
          return [255, 255, 255];
        };
        return elements.filter(el => el.getClientRects().length).map(el => {
          const a = lum(parse(getComputedStyle(el).color).slice(0, 3));
          const b = lum(background(el));
          return { text: el.textContent.trim().slice(0, 30), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
        });
      });
      expect(samples.length).toBeGreaterThanOrEqual(viewport === PHONE ? 12 : 3);
      for (const sample of samples) expect(sample.ratio, sample.text).toBeGreaterThanOrEqual(4.5);
    });
  }
}
