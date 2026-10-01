const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const ref = "xnrljkkszoimegfivlya";
const user = { id: "00000000-0000-4000-8000-000000000001", email: "synthetic@example.com",
  aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
const profile = { id: user.id, email: user.email, worker_key: "synthetic", display_name: "Synthetic",
  role: "admin", account_status: "approved" };
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
function session(expired = false) {
  const exp = Math.floor(Date.now() / 1000) + (expired ? -60 : 3600);
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  return { access_token: [encode({ alg: "HS256", typ: "JWT" }), encode({ sub: user.id, exp,
    aud: "authenticated", role: "authenticated" }), "synthetic-signature"].join("."),
    refresh_token: "synthetic-refresh-token", expires_at: exp, expires_in: 3600, token_type: "bearer", user };
}

async function setup(page, options = {}) {
  const state = { tokens: 0, reads: 0, inserts: 0, activity: 0, errors: [] };
  page.on("pageerror", error => state.errors.push(error.message));
  await page.addInitScript(({ stored, ref, persist, theme }) => {
    if (theme) localStorage.setItem("jgcPortalTheme", theme);
    if (stored) {
      const storage = persist === false ? sessionStorage : localStorage;
      storage.setItem(`sb-${ref}-auth-token`, JSON.stringify(stored));
      localStorage.setItem("jgcStayLoggedIn", persist === false ? "false" : "true");
      if (!persist) sessionStorage.setItem("jgcActiveSession", "true");
    }
  }, { stored: options.stored ? session(options.expired) : null, ref, persist: options.persist !== false, theme: options.theme });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      if (["/admin.html", "/home.html", "/limited-access.html"].includes(url.pathname)) {
        return route.fulfill({ contentType: "text/html", body: "<h1>Entered Portal</h1>" });
      }
      return route.continue();
    }
    let body = [];
    if (url.pathname === "/auth/v1/token") {
      state.tokens++;
      if (options.tokenGate) await options.tokenGate.promise;
      if (options.tokenError) return route.fulfill({ status: 400, contentType: "application/json",
        headers: { "X-Supabase-Api-Version": "2024-01-01" },
        body: JSON.stringify({ code: options.tokenError, msg: options.tokenError === "invalid_credentials"
          ? "Invalid login credentials" : "Synthetic error" }) });
      body = session();
    } else if (url.pathname === "/auth/v1/signup") body = session();
    else if (url.pathname === "/auth/v1/user") body = user;
    else if (url.pathname === "/auth/v1/logout") body = {};
    else if (url.pathname === "/rest/v1/profiles") {
      if (route.request().method() === "POST") { state.inserts++; body = { ...profile, account_status: "pending" }; }
      else if (route.request().method() === "GET") {
        state.reads++;
        if (options.profileGate && state.reads === 1) await options.profileGate.promise;
        if (options.failProfile) return route.fulfill({ status: 400,
          contentType: "application/json", body: JSON.stringify({ message: "Synthetic unavailable" }) });
        body = options.missing ? [] : [{ ...profile, ...options.profile }];
      }
    } else if (url.pathname.endsWith("/record_my_portal_activity")) {
      state.activity++;
      if (options.activityGate) await options.activityGate.promise;
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  return state;
}

test("PWA recovery hides login until the saved expired session refreshes once", async ({ page }) => {
  const tokenGate = gate();
  const state = await setup(page, { stored: true, expired: true, tokenGate });
  await page.goto("/index.html");
  await expect(page.locator("#loginStatus")).toHaveText("Restoring your session…");
  await expect(page.locator("#loginControls")).toBeHidden();
  await expect.poll(() => state.tokens).toBe(1);
  await page.evaluate(() => { signIn(); signIn(); checkExistingSession(); });
  expect(state.tokens).toBe(1);
  tokenGate.release();
  await expect(page).toHaveURL(/admin.html$/);
  expect(state.reads).toBe(1);
  expect(state.errors).toEqual([]);
});

test("saved session enters while activity logging is still stalled", async ({ page }) => {
  const activityGate = gate();
  const state = await setup(page, { stored: true, activityGate });
  await page.goto("/index.html");
  await expect(page).toHaveURL(/admin.html$/, { timeout: 4000 });
  // Recovery and delayed page activity may both be recorded; neither may block entry.
  await expect.poll(() => state.activity).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => localStorage.getItem("currentWorker"))).toBe("synthetic");
  activityGate.release();
});

test("transient profile error keeps session and retries without creating a profile", async ({ page }) => {
  const options = { stored: true, failProfile: true };
  const state = await setup(page, options);
  await page.goto("/index.html");
  await expect(page.locator("#loginRetry")).toBeVisible();
  await expect(page.locator(".login-loader")).toBeHidden();
  await expect(page.locator("#loginControls")).toBeHidden();
  expect(state.inserts).toBe(0);
  expect(await page.evaluate(ref => !!localStorage.getItem(`sb-${ref}-auth-token`), ref)).toBe(true);
  options.failProfile = false;
  await page.locator("#loginRetry").click();
  await expect(page).toHaveURL(/admin.html$/);
  expect(state.inserts).toBe(0);
});

test("slow profile timeout cannot redirect later; Retry can recover", async ({ page }) => {
  const profileGate = gate();
  const state = await setup(page, { stored: true, profileGate });
  await page.clock.install();
  await page.goto("/index.html");
  await expect.poll(() => state.reads).toBe(1);
  await page.clock.fastForward(13000);
  await expect(page.locator("#loginRetry")).toBeVisible();
  await expect(page.locator(".login-loader")).toBeHidden();
  profileGate.release();
  await expect(page).toHaveURL(/index.html$/);
  await page.locator("#loginRetry").click();
  await page.clock.resume();
  await expect(page).toHaveURL(/admin.html$/);
  expect(state.inserts).toBe(0);
});

test("refresh timeout reuses outstanding SDK request and recovers on its late success", async ({ page }) => {
  const tokenGate = gate();
  const state = await setup(page, { stored: true, expired: true, tokenGate });
  await page.clock.install();
  await page.goto("/index.html");
  await expect.poll(() => state.tokens).toBe(1);
  await page.clock.fastForward(13000);
  await expect(page.locator("#loginRetry")).toBeVisible();
  await expect(page.locator(".login-loader")).toBeHidden();
  await page.locator("#loginRetry").click();
  expect(state.tokens).toBe(1);
  tokenGate.release();
  await page.clock.resume();
  await expect(page).toHaveURL(/admin.html$/);
  expect(state.tokens).toBe(1);
});

test("manual sign-in repeated taps and Enter submit only once", async ({ page }) => {
  const tokenGate = gate();
  const state = await setup(page, { tokenGate });
  await page.goto("/index.html");
  await expect(page.locator("#loginControls")).toBeVisible();
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("synthetic-only");
  await page.locator("#loginSubmit").click();
  await page.evaluate(() => { signIn(); signIn(); submitOnEnter({ key: "Enter" }); });
  await expect(page.locator("#loginSubmit")).toBeDisabled();
  await expect.poll(() => state.tokens).toBe(1);
  tokenGate.release();
  await expect(page).toHaveURL(/admin.html$/);
  expect(state.reads).toBe(1);
});

test("wrong password has clear feedback and re-enables sign-in", async ({ page }) => {
  const state = await setup(page, { tokenError: "invalid_credentials" });
  await page.goto("/index.html");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("synthetic-only");
  await page.locator("#loginSubmit").click();
  await expect(page.locator("#loginStatus")).toContainText("Check your email and password");
  await expect(page.locator("#loginSubmit")).toBeEnabled();
  expect(state.reads).toBe(0);
});

test("revoked refresh session reveals sign-in rather than endless retry", async ({ page }) => {
  await setup(page, { stored: true, expired: true, tokenError: "refresh_token_not_found" });
  await page.goto("/index.html");
  await expect(page.locator("#loginSubmit")).toBeVisible();
  await expect(page.locator("#loginSubmit")).toBeEnabled();
});

test("missing profile during restore does not create an account", async ({ page }) => {
  const state = await setup(page, { stored: true, missing: true });
  await page.goto("/index.html");
  await expect(page.locator("#loginStatus")).toContainText("profile could not be found");
  expect(state.inserts).toBe(0);
});

test("missing profile after password login preserves account approval setup", async ({ page }) => {
  const state = await setup(page, { missing: true });
  await page.goto("/index.html");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill("synthetic-only");
  await page.locator("#loginSubmit").click();
  await expect(page.locator("#loginStatus")).toContainText("waiting for admin approval");
  expect(state.inserts).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("currentWorker"))).toBeNull();
});

test("account requests do not race automatic session entry", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/index.html");
  await page.locator("#createAccountToggle").click();
  await page.locator("#signupName").fill("Synthetic Worker");
  await page.locator("#signupEmail").fill(user.email);
  await page.locator("#signupPassword").fill("synthetic-only");
  await page.evaluate(() => {
    window.alert = () => {};
    getJgcAdminNotificationRecipients = async () => [];
    createJgcPortalNotifications = async () => {};
  });
  await page.locator("#createAccountPanel button").click();
  await expect(page.locator("#loginStatus")).toContainText("Admin must approve");
  await expect(page).toHaveURL(/index.html$/);
  expect(state.reads).toBe(0);
  await expect(page.locator("#loginSubmit")).toBeEnabled();
});

for (const event of ["online", "visibilitychange"]) {
  test(`recovery retries when ${event} arrives after a connection failure`, async ({ page }) => {
    const options = { stored: true, failProfile: true };
    await setup(page, options);
    await page.goto("/index.html");
    await expect(page.locator("#loginRetry")).toBeVisible();
  await expect(page.locator(".login-loader")).toBeHidden();
    options.failProfile = false;
    await page.evaluate(event => (event === "online" ? window : document).dispatchEvent(new Event(event)), event);
    await expect(page).toHaveURL(/admin.html$/);
  });
}

for (const [status, role, destination] of [
  ["approved", "worker", "home.html"], ["limited", "worker", "limited-access.html"]
]) {
  test(`restoration preserves ${status} ${role} routing`, async ({ page }) => {
    await setup(page, { stored: true, profile: { account_status: status, role } });
    await page.goto("/index.html");
    await expect(page).toHaveURL(new RegExp(destination.replace(".", "\\.") + "$"));
  });
}
for (const status of ["pending", "inactive"]) {
  test(`${status} accounts remain blocked`, async ({ page }) => {
    const state = await setup(page, { stored: true, profile: { account_status: status } });
    await page.goto("/index.html");
    await expect(page.locator("#loginStatus")).toContainText(status === "pending" ? "waiting for admin approval" : "deactivated");
    await expect(page).toHaveURL(/index.html$/);
    expect(await page.evaluate(() => localStorage.getItem("currentWorker"))).toBeNull();
    expect(state.activity).toBe(0);
  });
}

test("session-only persistence remains session-only on restoration", async ({ page }) => {
  await setup(page, { stored: true, persist: false });
  await page.goto("/index.html");
  await expect(page).toHaveURL(/admin.html$/);
  expect(await page.evaluate(ref => ({ preference: localStorage.getItem("jgcStayLoggedIn"),
    persistent: localStorage.getItem(`sb-${ref}-auth-token`), temporary: !!sessionStorage.getItem(`sb-${ref}-auth-token`) }), ref))
    .toEqual({ preference: "false", persistent: null, temporary: true });
});

test("shared helpers reuse one Supabase client on a page", async ({ page }) => {
  await setup(page);
  await page.goto("/index.html");
  expect(await page.evaluate(() => createJgcSupabaseClient() === createJgcSupabaseClient())).toBe(true);
});

for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
  test(`session recovery readable at ${width}px in ${theme}`, async ({ page }) => {
    const tokenGate = gate();
    await page.setViewportSize({ width, height: width === 390 ? 844 : 950 });
    await setup(page, { stored: true, expired: true, tokenGate, theme });
    await page.goto("/index.html");
    await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", theme);
    await expect(page.locator("#loginStatus")).toBeVisible();
    await expect(page.locator(".login-loader")).toBeVisible();
    expect(await page.locator(".login-loader-hammer").evaluate(el => getComputedStyle(el).animationName)).toBe("login-hammer");
    if (width === 390 && theme === "light") {
      const motion = () => page.locator(".login-loader-hammer").evaluate(el => {
        const animation = el.getAnimations()[0];
        return { duration: animation.effect.getTiming().duration,
          iterations: animation.effect.getTiming().iterations === Infinity,
          elapsed: animation.currentTime };
      });
      expect(await motion()).toMatchObject({ duration: 850, iterations: true });
      await expect.poll(async () => (await motion()).elapsed).toBeGreaterThan(1700);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.locator(".login-loader-hammer").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(page.locator("#loginControls")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.JGC_LOGIN_SCREENSHOTS) {
      fs.mkdirSync(process.env.JGC_LOGIN_SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.JGC_LOGIN_SCREENSHOTS, `recovery-${width}-${theme}.png`), fullPage: true });
    }
    tokenGate.release();
  });
}
