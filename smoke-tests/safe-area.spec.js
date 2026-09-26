const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const root = path.resolve(__dirname, "..");
const USER_ID = "00000000-0000-4000-8000-000000000094";
const IPHONE_INSET = 47;

async function signIn(page, theme = "light") {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "zeth@johngordonconstruction.com", user_metadata: { display_name: "Zeth Hummel" } };
  const auth = { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: USER_ID, exp: now + 3600, role: "authenticated" }), "safe-area"].join("."), refresh_token: "safe-area", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
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
    if (p.endsWith("/rpc/is_admin")) return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
    if (p.endsWith("/profiles")) {
      const profile = { id: USER_ID, email: user.email, display_name: "Zeth Hummel", worker_key: "zeth hummel", role: "admin", account_status: "approved" };
      const single = String(route.request().headers().accept || "").includes("vnd.pgrst.object");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(single ? profile : [profile]) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

// Pretend to be an iPhone: the whole layer reads its inset from this one custom property.
const simulateInset = (page, inset) => page.evaluate(value => document.documentElement.style.setProperty("--jgc-safe-area-top", value + "px"), inset);

const topLayout = page => page.evaluate(() => {
  const box = selector => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
  };
  return {
    strip: box(".jgc-safe-area-top"),
    nav: box(".jgc-global-top-nav"),
    home: box(".jgc-nav-home"),
    logout: box(".jgc-nav-logout"),
    gear: box("#jgcAppearanceSettingsButton"),
    bell: box(".jgc-notification-button"),
    search: box(".jgc-admin-search-button"),
    bodyPadding: parseFloat(getComputedStyle(document.body).paddingTop),
    htmlPadding: parseFloat(getComputedStyle(document.documentElement).paddingTop),
    adminNavTop: document.querySelector(".jgc-admin-nav") ? getComputedStyle(document.querySelector(".jgc-admin-nav")).top : null
  };
});

test("every Portal page lets the green bar reach under the iPhone status bar", () => {
  const pages = fs.readdirSync(root).filter(file => file.endsWith(".html"));
  expect(pages.length).toBeGreaterThan(40);
  for (const file of pages) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    expect(source, `${file} viewport`).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover/);
  }
});

for (const viewport of [{ name: "phone", width: 390, height: 844, pad: 58 }, { name: "desktop", width: 1280, height: 900, pad: 66 }]) {
  test(`Admin top bar clears the iPhone status bar on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signIn(page);
    await page.goto("/admin.html", { waitUntil: "load" });
    await expect(page.locator(".jgc-global-top-nav")).toBeVisible();
    await expect(page.locator(".jgc-safe-area-top")).toHaveCount(1);

    // Without an inset nothing moves.
    const plain = await topLayout(page);
    expect(plain.strip.height).toBe(0);
    expect(plain.nav.top).toBe(0);
    expect(plain.bodyPadding).toBe(viewport.pad);

    await simulateInset(page, IPHONE_INSET);
    const layout = await topLayout(page);
    expect(layout.strip).toMatchObject({ top: 0, height: IPHONE_INSET });
    expect(layout.nav.top).toBe(IPHONE_INSET);
    expect(layout.bodyPadding).toBe(viewport.pad + IPHONE_INSET);
    expect(layout.adminNavTop).toBe(`${viewport.pad + IPHONE_INSET}px`);
    for (const control of ["home", "logout", "gear", "bell", "search"]) {
      expect(layout[control], `${control} exists`).not.toBeNull();
      expect(layout[control].top, `${control} sits below the status bar`).toBeGreaterThanOrEqual(IPHONE_INSET);
      expect(layout[control].bottom, `${control} stays inside the top bar`).toBeLessThanOrEqual(layout.nav.bottom + 1);
    }
    // Only the solid green strip shows behind the clock and battery: full width and layered above
    // the top bar and its buttons (it ignores taps, so it never blocks anything underneath).
    const strip = await page.locator(".jgc-safe-area-top").evaluate(el => {
      const layers = [".jgc-global-top-nav", "#jgcAppearanceSettings", ".jgc-notification-bell", ".jgc-admin-global-search"]
        .map(selector => document.querySelector(selector)).filter(Boolean).map(node => Number(getComputedStyle(node).zIndex) || 0);
      return { width: el.getBoundingClientRect().width, colour: getComputedStyle(el).backgroundColor, z: Number(getComputedStyle(el).zIndex), highestBelow: Math.max(...layers) };
    });
    expect(strip.width).toBe(viewport.width);
    expect(strip.colour).toBe("rgb(7, 55, 28)");
    expect(strip.z).toBeGreaterThan(strip.highestBelow);
  });
}

for (const url of ["/home.html", "/index.html"]) {
  test(`${url} starts below the iPhone status bar`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    if (url === "/index.html") await page.addInitScript(() => localStorage.setItem("jgcPortalTheme", "light"));
    else await signIn(page);
    await page.goto(url, { waitUntil: "load" });
    await expect(page.locator(".jgc-safe-area-top")).toHaveCount(1);
    expect((await topLayout(page)).htmlPadding).toBe(0);

    await simulateInset(page, IPHONE_INSET);
    const layout = await topLayout(page);
    expect(layout.htmlPadding).toBe(IPHONE_INSET);
    expect(layout.strip).toMatchObject({ top: 0, height: IPHONE_INSET });
    const firstContentTop = await page.evaluate(() => {
      const visible = Array.from(document.body.children).filter(el => !el.classList.contains("jgc-safe-area-top") && getComputedStyle(el).position !== "fixed" && el.getClientRects().length);
      return Math.min(...visible.map(el => el.getBoundingClientRect().top));
    });
    expect(firstContentTop).toBeGreaterThanOrEqual(IPHONE_INSET);
    for (const control of ["gear", "bell"]) {
      if (layout[control]) expect(layout[control].top, `${control} below the status bar`).toBeGreaterThanOrEqual(IPHONE_INSET);
    }
  });
}

test("the status bar colour is JGC green in both themes", async ({ page }) => {
  await signIn(page, "light");
  await page.goto("/admin.html", { waitUntil: "load" });
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0b5e3b");
  await page.evaluate(() => window.applyJgcTheme("dark"));
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0b5e3b");
});
