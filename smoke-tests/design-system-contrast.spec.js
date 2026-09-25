const { test, expect } = require("@playwright/test");

const USER_ID = "00000000-0000-4000-8000-000000000093";

// Contrast of each element's text against the colours actually painted behind it:
// semi-transparent layers are blended down to the first opaque colour or gradient,
// and a gradient is judged by its worst colour stop.
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
      const stops = style.backgroundImage.includes("gradient") ? (style.backgroundImage.match(/rgba?\([^)]*\)|color\([^)]*\)/g) || []).map(parse) : [];
      if (stops.length) return stops.map(stop => paint(over(stop, color[3] > 0 ? over(color, WHITE) : WHITE)));
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

// Real pages that use these components in their own layouts. Timesheet checks every button,
// including its green gradient buttons.
const PAGES = [
  { url: "/admin.html?tab=workOrders" }, { url: "/admin.html?tab=safetyRecords&records=reports" }, { url: "/admin.html?tab=noticePolicy" },
  { url: "/admin.html?tab=equipment" }, { url: "/work-orders.html" }, { url: "/schedule.html" }, { url: "/job-lists.html" },
  { url: "/field-calculator.html" }, { url: "/notification-settings.html" }, { url: "/accounting-admin.html" },
  { url: "/employee-writeups-admin.html" }, { url: "/home.html" },
  { url: "/timesheet.html", selector: ".timesheet-page button" },
  { url: "/index.html", selector: ".toggle-button", signedOut: true }
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
