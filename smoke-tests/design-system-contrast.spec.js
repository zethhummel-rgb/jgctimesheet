const { test, expect } = require("@playwright/test");

const USER_ID = "00000000-0000-4000-8000-000000000093";

// Contrast of each element's text against the colours actually painted behind it:
// semi-transparent layers are blended down to the first opaque colour or gradient,
// a gradient is judged by its worst colour stop, and see-through gradient stops are
// blended over whatever is painted behind that element.
const measure = selector => {
  const parse = value => {
    const nums = (value.match(/-?[\d.]+/g) || []).map(Number);
    if (value.startsWith("color(")) return [nums[0] * 255, nums[1] * 255, nums[2] * 255, nums.length > 3 ? nums[3] : 1];
    return [nums[0], nums[1], nums[2], nums.length > 3 ? nums[3] : 1];
  };
  const WHITE = [255, 255, 255, 1];
  const over = (top, bottom) => [0, 1, 2].map(i => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);
  const lum = c => c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const backgroundsOf = el => {
    const above = [];
    const paint = base => above.reduceRight((result, layer) => over(layer, result), base);
    for (let n = el; n; n = n.parentElement) {
      const style = getComputedStyle(n);
      const color = parse(style.backgroundColor);
      if (style.backgroundImage.includes("gradient")) {
        // Split stacked background layers (first listed is painted on top) and blend them bottom-up.
        const layers = [];
        let depth = 0, current = "";
        for (const ch of style.backgroundImage) {
          if (ch === "(") depth++;
          if (ch === ")") depth--;
          if (ch === "," && depth === 0) { layers.push(current); current = ""; } else current += ch;
        }
        layers.push(current);
        const behind = n.parentElement ? backgroundsOf(n.parentElement)[0] : WHITE;
        let candidates = [color[3] > 0 ? over(color, behind) : behind];
        for (const layer of layers.reverse()) {
          const stops = (layer.match(/rgba?\([^)]*\)|color\([^)]*\)/g) || []).map(parse);
          if (stops.length) candidates = candidates.flatMap(base => stops.map(stop => over(stop, base)));
        }
        return candidates.map(paint);
      }
      if (color[3] >= 1) return [paint(color)];
      if (color[3] > 0) above.push(color);
    }
    return [paint(WHITE)];
  };
  return Array.from(document.querySelectorAll(selector)).filter(el => el.getClientRects().length && el.textContent.trim()).map(el => {
    const ratios = backgroundsOf(el).map(bg => {
      const a = lum(over(parse(getComputedStyle(el).color), bg)), b = lum(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    return { text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 40), ratio: Math.min(...ratios) };
  });
};

const SHARED = '.jgc-button--secondary, .jgc-badge--warning, .jgc-tab.active, .jgc-tab[aria-selected="true"], .jgc-tab[aria-current="page"]';

for (const theme of ["light", "dark"]) {
  test(`shared secondary buttons, warning badges and active tabs are readable in ${theme} mode`, async ({ page }) => {
    await page.goto("/reset-password.html", { waitUntil: "domcontentloaded" });
    await page.evaluate(theme => {
      document.documentElement.setAttribute("data-jgc-theme", theme);
      document.body.classList.add("jgc-page", "jgc-theme");
      const sample = `<button type="button" class="jgc-button jgc-button--secondary">Secondary</button>
        <span class="jgc-badge jgc-badge--warning">Pending</span>
        <button type="button" class="jgc-tab active">Active tab</button>
        <button type="button" class="jgc-tab" aria-selected="true">Selected tab</button>
        <a class="jgc-tab" aria-current="page" href="#">Current tab</a>`;
      const onPage = document.createElement("div");
      onPage.dataset.contrastSample = "";
      onPage.innerHTML = sample;
      const panel = document.createElement("section");
      panel.className = "jgc-panel";
      panel.dataset.contrastSample = "";
      panel.innerHTML = sample;
      const card = document.createElement("article");
      card.className = "jgc-list-card";
      card.innerHTML = sample;
      panel.append(card);
      document.body.prepend(onPage, panel);
    }, theme);
    const samples = await page.evaluate(measure, SHARED.split(", ").map(s => "[data-contrast-sample] > " + s + ", [data-contrast-sample] > .jgc-list-card > " + s).join(", "));
    expect(samples).toHaveLength(15);
    for (const sample of samples) expect(sample.ratio, `${theme} ${sample.text}`).toBeGreaterThanOrEqual(4.5);
  });
}

for (const theme of ["light", "dark"]) {
  test(`Admin Notice panels, labels and read-status expanders are readable in ${theme} mode`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/admin.html", { waitUntil: "load" });
    await page.evaluate(theme => {
      document.documentElement.setAttribute("data-jgc-theme", theme);
      document.body.classList.add("jgc-theme");
      document.getElementById("summarySection").hidden = true;
      document.getElementById("noticePolicySection").hidden = false;
      document.getElementById("announcementsList").innerHTML = `<div class="table-wrap jgc-table-wrap"><table class="jgc-table jgc-table--wide">
        <thead><tr><th>Title</th><th>Read Status</th><th>Created</th></tr></thead>
        <tbody><tr><td>Safety meeting Friday</td><td><details><summary>0/1 read</summary></details></td><td>2026-09-21</td></tr></tbody></table></div>`;
    }, theme);
    const samples = await page.evaluate(measure, "#noticePolicySection .admin-collapsible-panel > summary, #noticePolicySection .jgc-label, #announcementsList th, #announcementsList td, #announcementsList summary");
    expect(samples.map(sample => sample.text)).toEqual(expect.arrayContaining(["Announcements / Notices", "Title", "Message", "0/1 read"]));
    for (const sample of samples) expect(sample.ratio, `${theme} ${sample.text}`).toBeGreaterThanOrEqual(4.5);
    await context.close();
  });
}

// Real pages that use these components in their own layouts. Timesheet checks every button,
// including its green gradient buttons.
const PAGES = [
  { url: "/admin.html?tab=workOrders" }, { url: "/admin.html?tab=safetyRecords&records=reports" }, { url: "/admin.html?tab=noticePolicy" },
  { url: "/admin.html?tab=equipment" }, { url: "/work-orders.html" }, { url: "/schedule.html" }, { url: "/job-lists.html" },
  { url: "/field-calculator.html" }, { url: "/notification-settings.html" }, { url: "/accounting-admin.html" },
  { url: "/employee-writeups-admin.html" }, { url: "/home.html" },
  { url: "/timesheet.html", selector: ".timesheet-page button" },
  { url: "/index.html", selector: ".login-page button.jgc-button", signedOut: true },
  { url: "/harness.html", selector: ".status-btn" },
  { url: "/admin.html?tab=safetyRecords&records=reports", selector: ".admin-safety-record-tile" },
  { url: "/home.html", selector: ".side-link" },
  // Operator keys (large symbols) meet the 3:1 large-text rule and are not listed here.
  { url: "/field-calculator.html", selector: ".toolbar-button, .quick-calc-tab, .calc-key.function, .calc-key.danger" }
];

for (const theme of ["light", "dark"]) {
  test(`Portal pages keep shared components readable in ${theme} mode`, async ({ browser }) => {
    test.setTimeout(120000);
    const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "zeth@johngordonconstruction.com", user_metadata: { display_name: "Zeth Hummel" } };
    const token = [b64({ alg: "HS256", typ: "JWT" }), b64({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: USER_ID, email: user.email }), "contrast-test"].join(".");
    const auth = { access_token: token, refresh_token: "contrast-test", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
    let checked = 0;
    const failures = [];
    for (const { url, selector = SHARED, signedOut = false } of PAGES) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await page.addInitScript(({ auth, theme, id, signedOut }) => {
        localStorage.setItem("jgcPortalTheme", theme);
        if (signedOut) return;
        localStorage.setItem("sb-xnrljkkszoimegfivlya-auth-token", JSON.stringify(auth));
        localStorage.setItem("currentWorker", "zeth hummel");
        localStorage.setItem("currentWorkerDisplay", "Zeth Hummel");
        localStorage.setItem("currentUserEmail", auth.user.email);
        localStorage.setItem("currentUserRole", "admin");
        localStorage.setItem("currentAccountStatus", "approved");
        localStorage.setItem("jgcStayLoggedIn", "true");
        localStorage.setItem("jgcPortalTheme", theme);
        localStorage.setItem("jgcPortalTheme:" + id, theme);
        sessionStorage.setItem("jgcActiveSession", "true");
      }, { auth, theme, id: USER_ID, signedOut });
      await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", route => {
        const p = new URL(route.request().url()).pathname;
        if (p.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
        if (p.startsWith("/auth/v1/token")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(auth) });
        if (p.endsWith("/rpc/is_admin")) return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
        if (p.endsWith("/profiles")) {
          const profile = { id: USER_ID, email: user.email, display_name: "Zeth Hummel", worker_key: "zeth hummel", role: "admin", account_status: "approved" };
          const single = String(route.request().headers().accept || "").includes("vnd.pgrst.object");
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(single ? profile : [profile]) });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", theme);
      await page.waitForTimeout(800);
      expect(new URL(page.url()).pathname, `${url} stays open`).toBe(url.split("?")[0]);
      const samples = await page.evaluate(measure, selector);
      expect(samples.length, `${url} has elements to check`).toBeGreaterThan(0);
      checked += samples.length;
      for (const sample of samples) if (sample.ratio < 4.5) failures.push(`${url} "${sample.text}" ${sample.ratio.toFixed(2)}`);
      await context.close();
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(30);
  });
}

// Light mode: the grey status lines, empty states and profile facts (the shared muted text colour),
// the Limited Access tabs and the Home initials, each signed in as someone who sees that page.
const LIGHT_TEXT = [
  { who: "admin", url: "/employee-writeups-admin.html", selector: "#writeupsStatus" },
  { who: "admin", url: "/jsa-library-admin.html", selector: "#libraryStatus" },
  { who: "admin", url: "/diagnostics-admin.html", selector: "#diagnosticsUpdatedAt" },
  { who: "admin", url: "/admin.html?tab=employeeProfile", selector: ".profile-contact-grid .small" },
  { who: "admin", url: "/home.html", selector: "#homeProfileIcon" },
  { who: "worker", url: "/purchase-orders.html", selector: ".po-list-empty" },
  { who: "worker", url: "/employee-writeups.html", selector: "#myWriteupsStatus, #myWriteupsList .jgc-empty-state" },
  { who: "limited", url: "/limited-access.html", selector: ".limited-tab" }
];

test("light-mode grey status text, Limited Access tabs and Home initials are readable", async ({ browser }) => {
  test.setTimeout(120000);
  const failures = [];
  for (const { who, url, selector } of LIGHT_TEXT) {
    const id = who === "admin" ? USER_ID : "00000000-0000-4000-8000-00000000e00" + (who === "limited" ? "2" : "1");
    const key = who === "admin" ? "zeth hummel" : who === "limited" ? "sam reed" : "pat framer";
    const role = who === "admin" ? "admin" : "worker";
    const status = who === "limited" ? "limited" : "approved";
    const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const user = { id, aud: "authenticated", role: "authenticated", email: key.replace(" ", ".") + "@example.com", user_metadata: { display_name: key } };
    const auth = { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: id, exp: now + 3600, role: "authenticated" }), "light"].join("."), refresh_token: "light", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(({ auth, id, key, role, status }) => {
      localStorage.setItem("jgcPortalTheme", "light");
      localStorage.setItem("jgcPortalTheme:" + id, "light");
      localStorage.setItem("sb-xnrljkkszoimegfivlya-auth-token", JSON.stringify(auth));
      localStorage.setItem("currentWorker", key);
      localStorage.setItem("currentWorkerDisplay", key);
      localStorage.setItem("currentUserEmail", auth.user.email);
      localStorage.setItem("currentUserRole", role);
      localStorage.setItem("currentAccountStatus", status);
      localStorage.setItem("jgcStayLoggedIn", "true");
      localStorage.setItem("jgcPushOnboarding:v1:" + key, "dismissed");
      sessionStorage.setItem("jgcActiveSession", "true");
    }, { auth, id, key, role, status });
    await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", route => {
      const p = new URL(route.request().url()).pathname;
      if (p.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
      if (p.includes("/rpc/")) return route.fulfill({ status: 200, contentType: "application/json", body: String(role === "admin") });
      if (p.endsWith("/profiles")) {
        const profile = { id, email: user.email, display_name: key, worker_key: key, role, account_status: status };
        const single = String(route.request().headers().accept || "").includes("vnd.pgrst.object");
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(single ? profile : [profile]) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.goto(url, { waitUntil: "load" });
    await expect(page.locator(selector).first(), url).toBeVisible();
    await expect(page.locator(selector).first(), url).not.toHaveText("");
    const samples = await page.evaluate(measure, selector);
    expect(samples.length, `${url} ${selector}`).toBeGreaterThan(0);
    for (const sample of samples) if (sample.ratio < 4.5) failures.push(`${url} "${sample.text}" ${sample.ratio.toFixed(2)}`);
    await context.close();
  }
  expect(failures).toEqual([]);
});

test("the sign-in page label follows the headline colour in light mode", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => localStorage.setItem("jgcPortalTheme", "light"));
  await page.goto("/index.html", { waitUntil: "load" });
  const colours = await page.evaluate(() => ({
    label: getComputedStyle(document.querySelector(".portal-label")).color,
    headline: getComputedStyle(document.querySelector(".hero-copy h1")).color
  }));
  expect(colours.label).toBe(colours.headline);
});

// The shared Portal search panel (the magnifying-glass button), with results, for an employee and an
// admin, in both themes: header buttons, title, status, result groups and result rows.
const SEARCH_PANEL_TEXT = [
  ".jgc-admin-search-eyebrow", "#jgcAdminGlobalSearchTitle", ".jgc-admin-search-header button", "#jgcAdminGlobalSearchSubmit",
  ".jgc-admin-search-status", ".jgc-admin-search-group-title", ".jgc-admin-search-group-count", ".jgc-admin-search-result-category",
  ".jgc-admin-search-result-title", ".jgc-admin-search-result-detail", ".jgc-admin-search-result button", ".jgc-admin-search-empty"
].map(selector => "#jgcAdminGlobalSearchPanel " + selector).join(", ");

for (const theme of ["light", "dark"]) {
  for (const role of ["worker", "admin"]) {
    test(`Portal search panel is readable in ${theme} mode for ${role === "admin" ? "an admin" : "an employee"}`, async ({ page }) => {
      const id = role === "admin" ? USER_ID : "00000000-0000-4000-8000-00000000e001";
      const key = role === "admin" ? "zeth hummel" : "pat framer";
      const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
      const now = Math.floor(Date.now() / 1000);
      const user = { id, aud: "authenticated", role: "authenticated", email: key.replace(" ", ".") + "@example.com", user_metadata: { display_name: key } };
      const auth = { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: id, exp: now + 3600, role: "authenticated" }), "search"].join("."), refresh_token: "search", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.addInitScript(({ auth, theme, id, key, role }) => {
        localStorage.setItem("jgcPortalTheme", theme);
        localStorage.setItem("jgcPortalTheme:" + id, theme);
        localStorage.setItem("sb-xnrljkkszoimegfivlya-auth-token", JSON.stringify(auth));
        localStorage.setItem("currentWorker", key);
        localStorage.setItem("currentWorkerDisplay", key);
        localStorage.setItem("currentUserEmail", auth.user.email);
        localStorage.setItem("currentUserRole", role);
        localStorage.setItem("currentAccountStatus", "approved");
        localStorage.setItem("jgcStayLoggedIn", "true");
        localStorage.setItem("jgcPushOnboarding:v1:" + key, "dismissed");
        sessionStorage.setItem("jgcActiveSession", "true");
      }, { auth, theme, id, key, role });
      await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", route => {
        const p = new URL(route.request().url()).pathname;
        if (p.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
        if (p.includes("/rpc/")) return route.fulfill({ status: 200, contentType: "application/json", body: String(role === "admin") });
        if (p.endsWith("/profiles")) {
          const profile = { id, email: user.email, display_name: key, worker_key: key, role, account_status: "approved" };
          const single = String(route.request().headers().accept || "").includes("vnd.pgrst.object");
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(single ? profile : [profile]) });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      });
      await page.goto("/timesheet.html", { waitUntil: "load" });
      await page.locator(".jgc-admin-search-button").click();
      await expect(page.locator("#jgcAdminGlobalSearchPanel")).toBeVisible();
      await page.locator("#jgcAdminGlobalSearchInput").fill("time");
      await page.locator("#jgcAdminGlobalSearchSubmit").click();
      await expect(page.locator("#jgcAdminGlobalSearchStatus")).not.toContainText("Searching");
      await page.waitForTimeout(400);
      const firstGroup = page.locator(".jgc-admin-search-group-header").first();
      if (await firstGroup.count() && (await firstGroup.getAttribute("aria-expanded")) !== "true") await firstGroup.click();
      const samples = await page.evaluate(measure, SEARCH_PANEL_TEXT);
      expect(samples.map(sample => sample.text)).toEqual(expect.arrayContaining(["Refresh Data", "Close", "Search"]));
      const failures = samples.filter(sample => sample.ratio < 4.5).map(sample => `"${sample.text}" ${sample.ratio.toFixed(2)}`);
      expect(failures, `${theme} ${role}: ${JSON.stringify(samples.map(s => s.text))}`).toEqual([]);
    });
  }
}
