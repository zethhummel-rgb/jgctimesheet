const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");

test("Field Calculator uses one token-only feature stylesheet", async () => {
  const pageSource = fs.readFileSync(path.join(portalRoot, "field-calculator.html"), "utf8");
  const featureCss = fs.readFileSync(path.join(portalRoot, "field-calculator.css"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");

  expect(pageSource).not.toMatch(/<style\b/i);
  expect(pageSource).not.toMatch(/\sstyle\s*=/i);
  expect(pageSource).toContain('jgc-design-system.css?v=9');
  expect(pageSource).toContain('field-calculator.css?v=17');
  expect(pageSource).not.toContain("field-calculator-design-system.css");
  expect(featureCss, "calculator-specific CSS must inherit centralized theme tokens").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);

  const releaseId = Number(serviceWorker.match(/JGC_RELEASE_ID = "(\d+)"/)?.[1] || 0);
  expect(releaseId).toBeGreaterThanOrEqual(764);
  expect(serviceWorker).toContain('"./field-calculator.css?v=17"');
  expect(serviceWorker).not.toContain("field-calculator-design-system.css");
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "compact landscape", width: 844, height: 390 }
]) {
  test(`Field Calculator remains contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/field-calculator.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#mainCalculatorPanel")).toBeVisible();
    await expect(page.locator(".calc-key").first()).toBeVisible();

    const dimensions = await page.evaluate(() => {
      const workbench = document.querySelector(".calculator-workbench").getBoundingClientRect();
      return {
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
        workbenchLeft: workbench.left,
        workbenchRight: workbench.right,
        workbenchTop: workbench.top,
        workbenchBottom: workbench.bottom,
        pageColor: getComputedStyle(document.body).color,
        pageBackground: getComputedStyle(document.documentElement).backgroundColor
      };
    });

    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.workbenchLeft).toBeGreaterThanOrEqual(0);
    expect(dimensions.workbenchRight).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.workbenchTop).toBeGreaterThanOrEqual(0);
    expect(dimensions.workbenchBottom).toBeLessThanOrEqual(dimensions.viewportHeight + 1);
    expect(dimensions.pageColor).toBe("rgb(255, 255, 255)");
    expect(dimensions.pageBackground).toBe("rgb(2, 11, 8)");
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("Field Calculator keypad and overlays remain interactive", async ({ page }) => {
  await page.goto("/field-calculator.html", { waitUntil: "domcontentloaded" });
  await page.locator('[data-action="digit:2"]').click();
  await page.locator('[data-action="op:+"]').click();
  await page.locator('[data-action="digit:3"]').click();
  await page.locator('[data-action="equals"]').click();
  await expect(page.locator("#calcMainValue")).toContainText("5");

  await page.getByRole("button", { name: "Open calculator pocket guide" }).click();
  await expect(page.locator("#calcOverlay")).toHaveClass(/open/);
  await expect(page.locator("#calcOverlayTitle")).toContainText("Guide");
  await page.locator("#calcOverlay .calc-overlay-header button").click();
  await expect(page.locator("#calcOverlay")).not.toHaveClass(/open/);
});

async function signInWorker(page) {
  const id = "00000000-0000-4000-8000-00000000e001";
  const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const user = { id, aud: "authenticated", role: "authenticated", email: "pat.framer@example.com", user_metadata: { display_name: "Pat Framer" } };
  const auth = { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: id, exp: now + 3600, role: "authenticated" }), "calc"].join("."), refresh_token: "calc", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
  await page.addInitScript(({ auth }) => {
    localStorage.setItem("sb-xnrljkkszoimegfivlya-auth-token", JSON.stringify(auth));
    localStorage.setItem("currentWorker", "pat framer");
    localStorage.setItem("currentWorkerDisplay", "Pat Framer");
    localStorage.setItem("currentUserEmail", auth.user.email);
    localStorage.setItem("currentUserRole", "worker");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    localStorage.setItem("jgcPushOnboarding:v1:pat framer", "dismissed");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { auth });
  await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", route => {
    const p = new URL(route.request().url()).pathname;
    if (p.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    if (p.includes("/rpc/")) return route.fulfill({ status: 200, contentType: "application/json", body: "false" });
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

// Signed in, the Portal's gear/search/bell float at the top of the screen. Where they would land on the
// calculator, the calculator gives them a row of their own; elsewhere it keeps its full size.
for (const viewport of [
  { name: "phone", width: 390, height: 844, room: true },
  { name: "small laptop", width: 1100, height: 800, room: true },
  { name: "tablet", width: 820, height: 1180, room: false },
  { name: "desktop", width: 1366, height: 900, room: false }
]) {
  test(`signed-in Field Calculator keeps the gear, search and bell off the calculator on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await signInWorker(page);
    await page.goto("/field-calculator.html", { waitUntil: "load" });
    for (const control of ["#jgcAppearanceSettingsButton", ".jgc-notification-button", ".jgc-admin-search-button"]) {
      await expect(page.locator(control), control).toBeVisible();
    }
    await expect(page.locator("body")).toHaveClass(viewport.room ? /jgc-calc-controls-room/ : /field-calculator-page/);
    if (!viewport.room) await expect(page.locator("body")).not.toHaveClass(/jgc-calc-controls-room/);

    const layout = await page.evaluate(() => {
      const bench = document.querySelector(".calculator-workbench").getBoundingClientRect();
      const overlapping = Array.from(document.querySelectorAll("#jgcAppearanceSettingsButton, .jgc-notification-button, .jgc-admin-search-button")).filter(button => {
        const box = button.getBoundingClientRect();
        return box.left < bench.right && box.right > bench.left && box.top < bench.bottom && box.bottom > bench.top;
      }).length;
      // Every calculator toolbar button can be tapped (nothing sits on top of it).
      const covered = Array.from(document.querySelectorAll(".calc-toolbar button")).filter(button => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return !button.contains(hit);
      }).map(button => button.textContent.trim());
      const keys = Array.from(document.querySelectorAll("#calcKeypad button"));
      return { overlapping, covered, lowestKey: Math.max(...keys.map(key => key.getBoundingClientRect().bottom)), height: innerHeight };
    });
    expect(layout.overlapping).toBe(0);
    expect(layout.covered).toEqual([]);
    expect(layout.lowestKey).toBeLessThanOrEqual(layout.height);
  });
}

test("Field Calculator quick calculations remain available", async ({ page }) => {
  await page.goto("/field-calculator.html", { waitUntil: "domcontentloaded" });
  await page.locator('[data-quick-calc="sonotube"]').first().click();
  await expect(page.locator("#quickCalcPanel")).toBeVisible();
  await expect(page.locator("#sonotubeResults")).not.toBeEmpty();
  await page.locator('[data-quick-calc="stairs"]').first().click();
  await expect(page.locator("#stairsCalcForm")).toBeVisible();
  await expect(page.locator("#stairsResults")).not.toBeEmpty();
});
