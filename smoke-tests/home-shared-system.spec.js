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
    id: "00000000-0000-4000-8000-000000000098",
    aud: "authenticated",
    role: "authenticated",
    email: "home-style-test@johngordonconstruction.com",
    user_metadata: { display_name: "Home Style Test" }
  };
  const token = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: user.id, email: user.email }),
    "home-style-test-signature"
  ].join(".");
  return {
    user,
    auth: {
      access_token: token,
      refresh_token: "home-style-test-refresh",
      expires_at: now + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user
    }
  };
}

async function installState(page) {
  const state = createSession();
  const profile = {
    id: state.user.id,
    email: state.user.email,
    display_name: "Home Style Test",
    worker_key: "home style test",
    role: "worker",
    approved: true,
    account_status: "approved"
  };

  await page.addInitScript(({ state, ref }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(state.auth));
    localStorage.setItem("currentWorker", "home style test");
    localStorage.setItem("currentWorkerDisplay", "Home Style Test");
    localStorage.setItem("currentUserEmail", state.user.email);
    localStorage.setItem("currentUserRole", "worker");
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
    if (requestUrl.pathname.includes("/rest/v1/rpc/")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "false" });
      return;
    }
    const table = requestUrl.pathname.split("/rest/v1/")[1] || "";
    const rows = table.startsWith("profiles") || table.startsWith("accounts") ? [profile] : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` },
      body: JSON.stringify(accept.includes("vnd.pgrst.object") ? (rows[0] || null) : rows)
    });
  });
}

async function populateDashboard(page) {
  await page.evaluate(() => {
    document.getElementById("todayHours").textContent = "40.00";
    document.getElementById("todayInspections").textContent = "2";
    document.getElementById("expiringCertificates").textContent = "1";
    document.getElementById("pendingVacations").textContent = "1";
    document.getElementById("announcementsPanel").hidden = false;
    document.getElementById("announcementsList").innerHTML = `
      <article class="announcement-item">
        <span class="info-icon">!</span>
        <div><h2>Site safety update</h2><div class="muted">Read the latest field announcement.</div></div>
        <a class="announcement-file" href="#">Open</a>
      </article>`;
    document.getElementById("homeSchedulePanel").open = true;
    document.getElementById("homeScheduleCount").textContent = "2 upcoming items";
    document.getElementById("homeScheduleAgenda").innerHTML = `
      <div class="home-agenda-item"><div class="home-agenda-date">Mon 7:30</div><div><div class="home-agenda-title">Cornwall Courthouse</div><div class="home-agenda-meta">Job 26090 · Crew arrival</div></div></div>
      <div class="home-agenda-item vehicle"><div class="home-agenda-date">Tue 9:00</div><div><div class="home-agenda-title">Truck service</div><div class="home-agenda-meta">White F-150</div></div></div>`;
  });
}

async function contrastRatio(page, selector) {
  return page.locator(selector).first().evaluate((element) => {
    const parse = (value) => (String(value).match(/[\d.]+/g) || []).slice(0, 4).map(Number);
    const luminance = (rgb) => {
      const values = rgb.slice(0, 3).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
      });
      return (0.2126 * values[0]) + (0.7152 * values[1]) + (0.0722 * values[2]);
    };
    let backgroundNode = element;
    let background = [6, 17, 15];
    while (backgroundNode) {
      const candidate = parse(getComputedStyle(backgroundNode).backgroundColor);
      if (candidate.length >= 3 && (candidate.length < 4 || candidate[3] > 0)) {
        background = candidate;
        break;
      }
      backgroundNode = backgroundNode.parentElement;
    }
    const foregroundValue = luminance(parse(getComputedStyle(element).color));
    const backgroundValue = luminance(background);
    return (Math.max(foregroundValue, backgroundValue) + 0.05) / (Math.min(foregroundValue, backgroundValue) + 0.05);
  });
}

test("Employee Home uses one token-only visual source", async () => {
  const source = fs.readFileSync(path.join(portalRoot, "home.html"), "utf8");
  const css = fs.readFileSync(path.join(portalRoot, "home-design-system.css"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");

  expect(source).not.toMatch(/<style\b/i);
  expect(source).not.toMatch(/\sstyle\s*=/i);
  expect(source).not.toContain('href="styles.css');
  expect(source).toContain('jgc-design-system.css?v=7');
  expect(source).toContain('home-design-system.css?v=3');
  expect(source).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
  expect(source).not.toContain('class="mobile-bottom-nav"');
  expect(source).not.toContain('id="moreSheet"');
  expect(source.match(/class="feature-card jgc-card"/g) || []).toHaveLength(16);
  expect(css, "Home CSS must use shared tokens instead of page colours").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  expect(serviceWorker).toMatch(/const JGC_RELEASE_ID = "\d+";/);
  expect(serviceWorker).toContain('"./home-design-system.css?v=3"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "portrait", width: 390, height: 844 },
  { name: "landscape", width: 844, height: 390 }
]) {
  test(`populated Employee Home stays readable and contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installState(page);
    await page.goto("/home.html", { waitUntil: "domcontentloaded" });
    await populateDashboard(page);

    await expect(page.locator(".feature-card")).toHaveCount(16);
    await expect(page.locator("#announcementsPanel")).toBeVisible();
    await expect(page.locator("#homeScheduleAgenda .home-agenda-item")).toHaveCount(2);

    const dimensions = await page.evaluate(() => {
      const cards = document.querySelector(".cards-grid");
      return {
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        cardColumns: getComputedStyle(cards).gridTemplateColumns.trim().split(/\s+/).length,
        smallestControl: Math.min(...Array.from(document.querySelectorAll(".feature-card")).map((item) => item.getBoundingClientRect().height))
      };
    });
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.smallestControl).toBeGreaterThanOrEqual(44);
    expect(dimensions.cardColumns).toBe(viewport.name === "desktop" ? 4 : (viewport.name === "portrait" ? 2 : 3));

    if (viewport.name !== "desktop") {
      await expect(page.locator(".jgc-admin-global-search")).toBeVisible();
      await expect(page.locator(".jgc-notification-bell")).toBeVisible();
      const headerLayout = await page.evaluate(() => {
        const profile = document.querySelector(".profile-block").getBoundingClientRect();
        const search = document.querySelector(".jgc-admin-global-search").getBoundingClientRect();
        const bell = document.querySelector(".jgc-notification-bell").getBoundingClientRect();
        return {
          profileLeft: profile.left,
          searchRight: window.innerWidth - search.right,
          bellRight: window.innerWidth - bell.right,
          controlGap: bell.left - search.right
        };
      });
      expect(headerLayout.profileLeft).toBeLessThanOrEqual(16);
      expect(headerLayout.searchRight).toBeGreaterThan(headerLayout.bellRight);
      expect(headerLayout.bellRight).toBeLessThanOrEqual(16);
      expect(headerLayout.controlGap).toBeGreaterThanOrEqual(6);
      expect(headerLayout.controlGap).toBeLessThanOrEqual(16);
    }

    for (const selector of [".welcome-strip h1", ".stat-value", ".feature-card h2"]) {
      expect(await contrastRatio(page, selector), `${selector} must meet normal-text contrast`).toBeGreaterThanOrEqual(4.5);
    }

    if (viewport.name === "portrait") {
      const bottomNav = page.locator(".jgc-mobile-bottom-nav");
      await expect(bottomNav).toBeVisible();
      for (const scrollRatio of [0, 0.5, 1]) {
        await page.evaluate((ratio) => {
          const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
          window.scrollTo(0, maxScroll * ratio);
        }, scrollRatio);
        const navBox = await bottomNav.boundingBox();
        expect(Math.abs((navBox.y + navBox.height) - viewport.height)).toBeLessThanOrEqual(1);
      }
      await page.locator("#jgcMobileMoreButton").click();
      await expect(page.locator("#jgcMobileMoreSheet")).toHaveClass(/open/);
      await expect(page.locator('#jgcMobileMoreSheet a[href="jobs.html"]')).toBeVisible();
    }

    if (process.env.JGC_HOME_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.JGC_HOME_SCREENSHOT_DIR, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(process.env.JGC_HOME_SCREENSHOT_DIR, `home-${viewport.name}.png`),
        fullPage: true
      });
    }

    expect(errors).toEqual([]);
    await context.close();
  });
}

test("Employee Home mobile hamburger locks the page and scrolls through every link", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installState(page);
  await page.goto("/home.html", { waitUntil: "domcontentloaded" });

  const sidebar = page.locator(".sidebar");
  await expect(sidebar).not.toBeVisible();
  await page.locator("#sidebarToggle").click();
  await expect(sidebar).toBeVisible();
  await expect(page.locator("html")).toHaveClass(/home-sidebar-open/);
  await expect(page.locator("body")).toHaveClass(/home-sidebar-open/);

  const lockedState = await page.evaluate(() => ({
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    bodyOverflow: getComputedStyle(document.body).overflow,
    sidebarOverflow: getComputedStyle(document.querySelector(".sidebar")).overflowY
  }));
  expect(lockedState.htmlOverflow).toBe("hidden");
  expect(lockedState.bodyOverflow).toBe("hidden");
  expect(lockedState.sidebarOverflow).toBe("auto");

  await sidebar.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const menuState = await page.evaluate(() => {
    const menu = document.querySelector(".sidebar");
    const lastLink = menu.querySelector(".side-link:last-child").getBoundingClientRect();
    const bottomNav = document.querySelector(".jgc-mobile-bottom-nav").getBoundingClientRect();
    return {
      reachedBottom: menu.scrollTop + menu.clientHeight >= menu.scrollHeight - 2,
      lastLinkBottom: lastLink.bottom,
      bottomNavTop: bottomNav.top
    };
  });
  expect(menuState.reachedBottom).toBe(true);
  expect(menuState.lastLinkBottom).toBeLessThanOrEqual(menuState.bottomNavTop - 4);
  await expect(page.locator(".side-link").last()).toBeVisible();

  await page.locator("#sidebarToggle").click();
  await expect(sidebar).not.toBeVisible();
  await expect(page.locator("html")).not.toHaveClass(/home-sidebar-open/);
  await expect(page.locator("body")).not.toHaveClass(/home-sidebar-open/);
  expect(errors).toEqual([]);
  await context.close();
});

test("Employee Home keeps profile, schedule, sidebar and shared navigation controls", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installState(page);
  await page.goto("/home.html", { waitUntil: "domcontentloaded" });

  await page.locator(".profile-block").click();
  await expect(page.locator("#profileModal")).toHaveClass(/open/);
  await expect(page.locator("#profileEmail")).toBeVisible();
  await page.locator("#profileModal .jgc-button--secondary").click();
  await expect(page.locator("#profileModal")).not.toHaveClass(/open/);

  await expect(page.locator(".home-dashboard-shell")).not.toHaveClass(/sidebar-collapsed/);
  await page.locator("#sidebarToggle").click();
  await expect(page.locator(".home-dashboard-shell")).toHaveClass(/sidebar-collapsed/);
  await page.locator("#sidebarToggle").click();
  await expect(page.locator(".home-dashboard-shell")).not.toHaveClass(/sidebar-collapsed/);
  await expect(page.locator('.side-link[onclick*="jobs.html"]')).toBeVisible();
  await expect(page.locator('.side-link[onclick*="job-lists.html"]')).toBeVisible();

  await page.locator("#homeSchedulePanel").evaluate((element) => { element.open = true; });
  await page.locator('[onclick="openHomeScheduleModal()"]', { hasText: "Add Event" }).click();
  await expect(page.locator("#homeScheduleModal")).toHaveClass(/open/);
  await expect(page.locator("#homeScheduleType")).toBeVisible();
  await page.locator("#homeScheduleModal .jgc-button--secondary").click();
  await expect(page.locator("#homeScheduleModal")).not.toHaveClass(/open/);

  expect(errors).toEqual([]);
  await context.close();
});
