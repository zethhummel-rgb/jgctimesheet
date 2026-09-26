const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const root = path.resolve(__dirname, "..");
const USER_ID = "00000000-0000-4000-8000-000000000094";
const IPHONE_INSET = 47;
const APP_BAND = 12;

// Run the page as an iPhone Home Screen web app (Safari exposes navigator.standalone there).
const openAsHomeScreenApp = page => page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));

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

    // In a browser without an inset nothing moves and there is no band.
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
    // iOS only samples a plain background colour, never a gradient.
    expect(await page.locator(".jgc-safe-area-top").evaluate(el => getComputedStyle(el).backgroundImage)).toBe("none");
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

// WebKit's status-bar colour probe (LocalFrameView::fixedContainerEdges): hit-test the middle of the
// top edge a few px down (ignoring pointer-events), walk up to the first fixed/sticky box, and use its
// plain background-color only if it is over 10px both ways, at least 90% of the screen wide and
// visible. Anything else and iOS 26+ blurs the top of the Home Screen app.
const probeTopEdge = page => page.evaluate(() => {
  const fixedAncestor = el => {
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      if (["fixed", "sticky"].includes(getComputedStyle(node).position)) return node;
    }
    return null;
  };
  const force = document.createElement("style");
  force.textContent = "* { pointer-events: auto !important; }";
  document.head.appendChild(force);
  const results = [0, 2, 4, 8].map(y => {
    const box = fixedAncestor(document.elementFromPoint(Math.floor(window.innerWidth / 2), y));
    if (!box) return { y, box: null };
    const rect = box.getBoundingClientRect();
    const style = getComputedStyle(box);
    return {
      y,
      box: box.className,
      wideEnough: rect.width >= window.innerWidth * 0.9,
      tallEnough: rect.height > 10,
      solid: /^rgb\(/.test(style.backgroundColor),
      noImage: style.backgroundImage === "none",
      visible: style.visibility === "visible" && style.opacity === "1"
    };
  });
  force.remove();
  return results;
});

for (const [name, url, signedIn] of [["Summary", "/admin.html?tab=summary", true], ["Timesheets", "/timesheet.html", true], ["Home", "/home.html", true], ["Field Calculator", "/field-calculator.html", true], ["Login", "/index.html", false]]) {
  test(`iPhone Home Screen app: iOS reads a solid colour at the top of ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAsHomeScreenApp(page);
    if (signedIn) await signIn(page, "dark");
    await page.goto(url, { waitUntil: "load" });
    await expect(page.locator("html")).toHaveClass(/jgc-ios-app/);
    await expect(page.locator(".jgc-safe-area-top")).toHaveCount(1);

    // A fresh install puts the page below an opaque status bar (inset 0); older installs draw under it.
    for (const inset of [0, IPHONE_INSET]) {
      await simulateInset(page, inset);
      for (const sample of await probeTopEdge(page)) {
        expect(sample, `inset ${inset}, ${sample.y}px down`).toEqual({ y: sample.y, box: "jgc-safe-area-top", wideEnough: true, tallEnough: true, solid: true, noImage: true, visible: true });
      }
    }
  });
}

test("iPhone Home Screen app: the band sits above the top bar without covering it", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAsHomeScreenApp(page);
  await signIn(page);
  await page.goto("/admin.html", { waitUntil: "load" });
  await expect(page.locator(".jgc-global-top-nav")).toBeVisible();

  for (const inset of [0, IPHONE_INSET]) {
    await simulateInset(page, inset);
    const top = Math.max(APP_BAND, inset);
    const layout = await topLayout(page);
    expect(layout.strip).toMatchObject({ top: 0, height: top });
    expect(layout.nav.top).toBe(top);
    expect(layout.bodyPadding).toBe(58 + top);
    expect(layout.adminNavTop).toBe(`${58 + top}px`);
    for (const control of ["home", "logout", "gear", "bell", "search"]) {
      expect(layout[control].top, `${control} below the band`).toBeGreaterThanOrEqual(top);
      expect(layout[control].bottom, `${control} inside the top bar`).toBeLessThanOrEqual(layout.nav.bottom + 1);
    }
  }
  // On pages with the green bar the band is the bar's own green.
  expect(await page.locator(".jgc-safe-area-top").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(7, 55, 28)");
});

test("iPhone Home Screen app: pages without the top bar start below the band in the page colour", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAsHomeScreenApp(page);
  await signIn(page, "light");
  await page.goto("/home.html", { waitUntil: "load" });
  expect((await topLayout(page)).htmlPadding).toBe(APP_BAND);
  expect(await page.locator(".jgc-safe-area-top").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(231, 236, 232)");

  // Field Calculator keeps its own top room (field-calculator.css reads --jgc-top-inset), so the page
  // itself is not pushed down and the bottom row of keys is never cut off.
  await page.goto("/field-calculator.html", { waitUntil: "load" });
  const calculator = () => page.evaluate(() => {
    const keys = Array.from(document.querySelectorAll("#calcKeypad button"));
    return {
      htmlPadding: parseFloat(getComputedStyle(document.documentElement).paddingTop),
      workbenchTop: document.querySelector(".calculator-workbench").getBoundingClientRect().top,
      lowestKey: Math.max(...keys.map(key => key.getBoundingClientRect().bottom)),
      viewportHeight: innerHeight
    };
  });
  for (const inset of [0, IPHONE_INSET]) {
    await simulateInset(page, inset);
    const layout = await calculator();
    expect(layout.htmlPadding, `inset ${inset}`).toBe(0);
    expect(layout.workbenchTop, `inset ${inset}`).toBeGreaterThanOrEqual(Math.max(APP_BAND, inset));
    expect(layout.lowestKey, `inset ${inset}`).toBeLessThanOrEqual(layout.viewportHeight);
  }
});

test("iPhone Home Screen app: the pull-to-refresh message is hidden until a pull starts", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAsHomeScreenApp(page);
  await signIn(page);
  await page.goto("/timesheet.html", { waitUntil: "load" });
  const indicator = page.locator("#jgcPwaPullIndicator");
  await expect(indicator).toHaveCount(1);
  await expect(indicator).toHaveCSS("visibility", "hidden");
  await indicator.evaluate(el => el.classList.add("is-visible"));
  await expect(indicator).toHaveCSS("visibility", "visible");
});

test("browsers never get the Home Screen band", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/admin.html", { waitUntil: "load" });
  await expect(page.locator("html")).not.toHaveClass(/jgc-ios-app/);
  expect(await page.evaluate(() => isJgcIosHomeScreenApp())).toBe(false);
  expect((await topLayout(page)).strip.height).toBe(0);
});

test("the status bar colour is JGC green in both themes", async ({ page }) => {
  await signIn(page, "light");
  await page.goto("/admin.html", { waitUntil: "load" });
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0b5e3b");
  await page.evaluate(() => window.applyJgcTheme("dark"));
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#0b5e3b");
});
