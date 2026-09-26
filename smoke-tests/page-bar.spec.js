const { test, expect } = require("@playwright/test");

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1366, height: 900 };
const ADMIN = { id: "00000000-0000-4000-8000-000000000094", email: "zeth@johngordonconstruction.com", name: "Zeth Hummel", key: "zeth hummel", role: "admin" };
const EMPLOYEE = { id: "00000000-0000-4000-8000-00000000e001", email: "pat.framer@example.com", name: "Pat Framer", key: "pat framer", role: "worker" };

async function signIn(page, theme = "light", person = ADMIN) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const user = { id: person.id, aud: "authenticated", role: "authenticated", email: person.email, user_metadata: { display_name: person.name } };
  const auth = { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: person.id, exp: now + 3600, role: "authenticated" }), "page-bar"].join("."), refresh_token: "page-bar", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
  await page.addInitScript(({ auth, theme, person }) => {
    localStorage.setItem("jgcPortalTheme", theme);
    localStorage.setItem("jgcPortalTheme:" + person.id, theme);
    localStorage.setItem("sb-xnrljkkszoimegfivlya-auth-token", JSON.stringify(auth));
    localStorage.setItem("currentWorker", person.key);
    localStorage.setItem("currentWorkerDisplay", person.name);
    localStorage.setItem("currentUserEmail", person.email);
    localStorage.setItem("currentUserRole", person.role);
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    localStorage.setItem("jgcPushOnboarding:v1:" + person.key, "dismissed");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { auth, theme, person });
  await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", route => {
    const p = new URL(route.request().url()).pathname;
    if (p.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    if (p.includes("/rpc/")) return route.fulfill({ status: 200, contentType: "application/json", body: String(person.role === "admin") });
    if (p.endsWith("/profiles")) {
      const profile = { id: person.id, email: person.email, display_name: person.name, worker_key: person.key, role: person.role, account_status: "approved" };
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

// Employee pages: the bar title, and the old on-screen header pieces it replaces (still printed).
const EMPLOYEE_PAGES = [
  ["timesheet", "Timesheets", ["main > .page-title", "#currentUser"]],
  ["inspections", "Inspections", [".inspection-page-header", "main > .container > h1"]],
  ["todays-inspections", "Today's Inspections", [".inspection-page-header", "main > .container > h1"]],
  ["previous-inspections", "Previous Inspections", [".inspection-page-header", "main > .container > h1"]],
  ["certificates", "Certificates", [".certificates-page-header"]],
  ["vacation-request", "Vacation Request", [".vacation-page-header"]],
  ["equipment-vehicles", "Equipment / Vehicles", [".equipment-page-header"]],
  ["work-orders", "Work Orders", [".work-order-page-header"]],
  ["purchase-orders", "Purchase Orders", ["main > header"]],
  ["job-lists", "Job Notes", ["main > header"]],
  ["permits", "Permits", [".permit-page-header", "main > .container > h1"]],
  ["reports", "Reports", ["main > header", "main > .container > h1"]],
  ["tasks", "Tasks", [".tasks-page-header"]],
  ["schedule", "Schedule", [".schedule-page-header"]],
  ["jobs", "Job Lookup", [".jobs-page-header"]],
  ["contacts", "Contacts", ["main > h1", "#currentUser"]],
  ["subcontractors-suppliers", "Subcontractors / Suppliers", ["main > h1", "#currentUser"]],
  ["policies-announcements", "Policies & Announcements", [".hero-card", "#workerName"]],
  ["employee-writeups", "My Write-Ups", ["main > header"]],
  ["jsa", "Job Safety Analysis", ["main > .container > h1", "#currentUser"]],
  ["prepared-jsas", "Prepared JSAs", [".jsa-section-heading > h1"]],
  ["toolbox-talks", "Tool Box Talks", ["main > .container > h1", "#currentUser"]],
  ["daily-site-report", "Daily Site Report", ["main > .container > h1", "#userBar"]],
  ["incident-report", "Incident / Near Miss Report", ["main > .container > h1", "#currentUser"]],
  ["accident-report", "Accident Investigation", ["main > .container > h1", "main > .container > h2"]],
  ["employee-injury-report", "Injury & Incident Report", ["main > .container > h1", "#currentUser"]],
  ["aerial-lifts", "Aerial Lift Inspection", ["body > .container > h1", "#userBar"]],
  ["forklift", "Forklift Inspection", ["body > .container > h1", "body > .container > h2"]],
  ["harness", "Harness Inspection", ["body > .container > h1", "body > .container > h2"]],
  ["tele-handler", "Telehandler Inspection", ["body > .container > h1", "#userBar"]],
  ["hot-work-permit", "Hot Work Permit", [".permit-page-header", "main > .container > h1"]],
  ["confined-space-permit", "Confined Space Entry Permit", [".permit-page-header", "main > .container > h1"]],
  ["excavation-permit", "Excavation Permit", [".permit-page-header", "main > .container > h1"]]
];

for (const viewport of [PHONE, DESKTOP]) {
  test(`employee pages get the page bar at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize(viewport);
    await signIn(page, "light", EMPLOYEE);
    for (const [name, title, replaced] of EMPLOYEE_PAGES) {
      await page.goto(`/${name}.html`, { waitUntil: "load" });
      await expect(bar(page), name).toBeVisible();
      await expect(bar(page).locator(".jgc-page-bar__title"), name).toHaveText(title);
      await expect(bar(page).locator(".jgc-page-bar__title"), name + " title shows on phones too").toBeVisible();
      await expect(bar(page).locator(".jgc-page-bar__switch"), name + " no Admin switcher").toBeHidden();
      for (const selector of replaced) await expect(page.locator(selector).first(), `${name} ${selector}`).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + " no sideways scroll").toBe(true);

      // The bar lines up with the page's content and sits 16px above it.
      const fit = await page.evaluate(() => {
        const barBox = document.getElementById("jgcPageBar").getBoundingClientRect();
        const main = document.querySelector("main");
        const blocks = main
          ? Array.from(main.children).filter(el => !el.classList.contains("jgc-page-bar-source") && el.getClientRects().length && !["fixed", "absolute"].includes(getComputedStyle(el).position))
          : [document.querySelector("body > .container")];
        const widest = blocks.reduce((best, el) => el.getBoundingClientRect().width > best.getBoundingClientRect().width ? el : best);
        const content = widest.getBoundingClientRect();
        return { left: Math.abs(barBox.left - content.left), right: Math.abs(barBox.right - content.right), gap: blocks[0].getBoundingClientRect().top - barBox.bottom, fullBleed: barBox.left === 0 && Math.round(barBox.width) === innerWidth };
      });
      if (viewport === PHONE) {
        expect(fit.fullBleed, name + " edge to edge on phones").toBe(true);
      } else {
        expect(fit.left, name + " left edge").toBeLessThanOrEqual(2);
        expect(fit.right, name + " right edge").toBeLessThanOrEqual(2);
      }
      expect(fit.gap, name + " gap under the bar").toBeGreaterThanOrEqual(14);
    }
  });
}

test("employee bars follow page titles that change while the page is open", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, "light", EMPLOYEE);
  await page.goto("/todays-inspections.html?recordType=reports", { waitUntil: "load" });
  const pageTitle = (await page.locator("main > .container > h1").textContent()).trim();
  expect(pageTitle).toContain("Report");
  await expect(bar(page).locator(".jgc-page-bar__title")).toHaveText(pageTitle);
  await expect(bar(page).locator(".jgc-page-bar__subtitle")).toHaveText((await page.locator("main > .container > .subtitle").textContent()).trim());

  await page.goto("/vacation-request.html", { waitUntil: "load" });
  await page.evaluate(() => { document.getElementById("vacationFormSubtitle").textContent = "Editing approved vacation dates."; });
  await expect(bar(page).locator(".jgc-page-bar__subtitle")).toHaveText("Editing approved vacation dates.");
});

test("employee form printouts keep their letterhead and never show the bar", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, "light", EMPLOYEE);
  await page.goto("/forklift.html", { waitUntil: "load" });
  await page.emulateMedia({ media: "print" });
  await expect(bar(page)).toBeHidden();
  await expect(page.locator("body > .container > h1")).toBeVisible();
  await expect(page.locator("body > .container > h2")).toHaveText("Daily Forklift Inspection Form");
});

test("employee pages opened without signing in do not get a bar", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", route => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.goto("/reports.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#jgcGlobalTopNav")).toHaveCount(0);
  await expect(page.locator("#jgcPageBar")).toHaveCount(0);
});

// No strip of page colour between the phone top bar and the page bar, in a browser and in the
// iPhone Home Screen app (which adds a 12px band above the top bar).
for (const [who, person, urls] of [["Admin", ADMIN, ["/admin.html?tab=summary", "/accounts.html"]], ["employee", EMPLOYEE, ["/timesheet.html", "/forklift.html"]]]) {
  for (const homeScreenApp of [false, true]) {
    test(`${who} page bar sits flush under the phone top bar${homeScreenApp ? " in the Home Screen app" : ""}`, async ({ page }) => {
      await page.setViewportSize(PHONE);
      if (homeScreenApp) await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
      await signIn(page, "light", person);
      for (const url of urls) {
        await page.goto(url, { waitUntil: "load" });
        await expect(bar(page), url).toBeVisible();
        const edges = await page.evaluate(() => ({
          navBottom: document.getElementById("jgcGlobalTopNav").getBoundingClientRect().bottom,
          barTop: document.getElementById("jgcPageBar").getBoundingClientRect().top
        }));
        expect(Math.abs(edges.barTop - edges.navBottom), url).toBeLessThanOrEqual(1);
      }
    });
  }
}

// Employee Home: Quick Access cards, counters, Quick Info and Schedule use the same tiles as the pages.
for (const viewport of [PHONE, DESKTOP]) {
  test(`employee Home icons are the page tiles, with no two neighbouring cards the same colour at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signIn(page, "dark", EMPLOYEE);
    await page.goto("/home.html", { waitUntil: "load" });
    const hosts = page.locator("[data-jgc-page-tile]");
    expect(await hosts.count()).toBeGreaterThanOrEqual(25);
    const tiles = await hosts.evaluateAll(elements => elements.map(el => {
      const box = el.getBoundingClientRect();
      const svg = el.querySelector("svg");
      return {
        page: el.getAttribute("data-jgc-page-tile"),
        tone: el.getAttribute("data-tone"),
        tile: el.classList.contains("jgc-page-tile"),
        lucideLeft: Boolean(el.querySelector("[data-lucide], .lucide")),
        iconShare: svg && box.width ? svg.getBoundingClientRect().width / box.width : 0,
        filled: getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)"
      };
    }));
    for (const tile of tiles) {
      expect(tile, tile.page).toMatchObject({ tile: true, lucideLeft: false, filled: true });
      expect(tile.tone, tile.page).toBeTruthy();
      if (tile.iconShare) expect(tile.iconShare, tile.page + " icon fills the tile").toBeGreaterThan(0.45);
    }

    const cards = await page.locator(".cards-grid > .feature-card:visible").evaluateAll(elements => elements.map(el => {
      const r = el.getBoundingClientRect();
      return { name: el.querySelector("h2").textContent.trim(), tone: el.querySelector("[data-tone]").getAttribute("data-tone"), x: Math.round(r.left), y: Math.round(r.top + window.scrollY), w: r.width, h: r.height };
    }));
    expect(cards.length).toBeGreaterThanOrEqual(15);
    for (const a of cards) {
      for (const b of cards) {
        const sideBySide = a.y === b.y && Math.abs(b.x - (a.x + a.w)) < 40;
        const stacked = a.x === b.x && Math.abs(b.y - (a.y + a.h)) < 40;
        if (sideBySide || stacked) expect(a.tone, `${a.name} next to ${b.name}`).not.toBe(b.tone);
      }
    }
  });
}

test("a Home tile looks the same as the bar on the page it opens", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await signIn(page, "light", EMPLOYEE);
  await page.goto("/home.html", { waitUntil: "load" });
  const home = {};
  for (const target of ["timesheet.html", "certificates.html", "vacation-request.html", "permits.html"]) {
    const tile = page.locator(`.cards-grid [data-jgc-page-tile="${target}"]`);
    home[target] = { tone: await tile.getAttribute("data-tone"), icon: await tile.innerHTML() };
  }
  for (const [target, tile] of Object.entries(home)) {
    await page.goto("/" + target, { waitUntil: "load" });
    await expect(bar(page).locator(".jgc-page-bar__tile"), target).toHaveAttribute("data-tone", tile.tone);
    expect(await bar(page).locator(".jgc-page-bar__tile").innerHTML(), target).toBe(tile.icon);
  }
});
