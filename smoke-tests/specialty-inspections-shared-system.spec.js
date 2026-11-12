const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");
const supabaseOrigin = "https://xnrljkkszoimegfivlya.supabase.co";
const specialtyPages = ["aerial-lifts.html", "forklift.html", "harness.html", "tele-handler.html"];

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function installState(page, theme) {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "00000000-0000-4000-8000-000000000132",
    aud: "authenticated",
    role: "authenticated",
    email: "specialty-inspection-test@johngordonconstruction.com",
    user_metadata: { display_name: "Inspection Test" }
  };
  const token = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: user.id, email: user.email }),
    "specialty-inspection-style-test-signature"
  ].join(".");
  const auth = { access_token: token, refresh_token: "specialty-test-refresh", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };

  await page.addInitScript(({ auth, user, ref, theme }) => {
    if (theme) {
      localStorage.setItem("jgcPortalTheme", theme);
      localStorage.setItem(`jgcPortalTheme:${user.id}`, theme);
    }
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(auth));
    localStorage.setItem("currentWorker", "inspection test");
    localStorage.setItem("currentWorkerDisplay", "Inspection Test");
    localStorage.setItem("currentUserEmail", user.email);
    localStorage.setItem("currentUserRole", "worker");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { auth, user, ref: "xnrljkkszoimegfivlya", theme });

  await page.route(`${supabaseOrigin}/**`, async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.startsWith("/auth/v1/user")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
      return;
    }
    if (requestUrl.pathname.startsWith("/auth/v1/token")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(auth) });
      return;
    }
    if (requestUrl.pathname.includes("/rest/v1/rpc/")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "false" });
      return;
    }
    const table = requestUrl.pathname.split("/rest/v1/")[1] || "";
    const rows = table.startsWith("profiles")
      ? [{ id: user.id, display_name: "Inspection Test", worker_key: "inspection test", role: "worker", approved: true, account_status: "approved" }]
      : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
}

test("specialty inspection forms use one token-only shared visual source", async () => {
  const featureCss = fs.readFileSync(path.join(portalRoot, "specialty-inspection-design-system.css"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");

  for (const file of specialtyPages) {
    const source = fs.readFileSync(path.join(portalRoot, file), "utf8");
    expect(source, `${file} must not own active embedded styles`).not.toMatch(/<style\b/i);
    expect(source, `${file} must not write inline styles`).not.toMatch(/\sstyle\s*=/i);
    expect(source, `${file} must not load the legacy portal stylesheet`).not.toContain('href="styles.css');
    expect(source, `${file} must not load the legacy inspection mobile stylesheet`).not.toContain("inspection-mobile.css");
    expect(source).toContain('jgc-design-system.css?v=14');
    expect(source).toContain('specialty-inspection-design-system.css?v=5');
    expect(source).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
  }

  const harnessSource = fs.readFileSync(path.join(portalRoot, "harness.html"), "utf8");
  expect(harnessSource).not.toMatch(/style\.background/);
  expect(featureCss, "Specialty-only CSS must use centralized design tokens").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  const releaseId = Number(serviceWorker.match(/JGC_RELEASE_ID = "(\d+)"/)?.[1] || 0);
  expect(releaseId).toBeGreaterThanOrEqual(762);
  expect(serviceWorker).toContain('"./specialty-inspection-design-system.css?v=5"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  for (const file of specialtyPages) {
    test(`${file} stays readable and contained on ${viewport.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await installState(page);
      await page.goto(`/${file}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".container")).toBeVisible();
      await page.waitForTimeout(100);

      const dimensions = await page.evaluate(() => {
        const controls = [...document.querySelectorAll(".container .jgc-button, .container input:not([type='radio']):not([type='checkbox']), .container select, .container textarea")]
          .filter((item) => item.offsetParent !== null);
        return {
          bodyWidth: document.body.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          smallestControl: Math.min(...controls.map((item) => item.getBoundingClientRect().height)),
          pageBackground: getComputedStyle(document.body).backgroundColor,
          pageColor: getComputedStyle(document.body).color,
          mobileCards: document.querySelectorAll(".inspection-mobile-list .inspection-tile").length
        };
      });

      expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
      expect(dimensions.smallestControl).toBeGreaterThanOrEqual(44);
      expect(dimensions.pageBackground).toBe("rgb(6, 17, 15)");
      expect(dimensions.pageColor).toBe("rgb(244, 248, 244)");
      if (viewport.name === "phone") {
        expect(dimensions.mobileCards).toBeGreaterThan(0);
        await expect(page.locator(".inspection-mobile-list").first()).toBeVisible();
      }
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}

test("harness pass and fail states remain synchronized", async ({ page }) => {
  await installState(page);
  await page.goto("/harness.html", { waitUntil: "domcontentloaded" });
  const firstGroup = page.locator(".status-group").first();
  await firstGroup.locator(".fail").click();
  await expect(page.locator("#inspectionStatus")).toHaveText("HARNESS FAILED INSPECTION - REMOVE FROM SERVICE");
  await expect(page.locator("#inspectionStatus")).toHaveClass(/is-failed/);
  await firstGroup.locator(".pass").click();
  await expect(page.locator("#inspectionStatus")).toHaveText("HARNESS FIT FOR SERVICE");
  await expect(page.locator("#inspectionStatus")).not.toHaveClass(/is-failed/);
});

test("specialty inspection print layout hides portal-only controls", async ({ page }) => {
  await installState(page);
  await page.goto("/aerial-lifts.html", { waitUntil: "domcontentloaded" });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".logo-wrap")).toBeHidden();
  await expect(page.locator(".user-bar")).toBeHidden();
  await expect(page.locator(".actions")).toBeHidden();
  await expect(page.locator(".table-wrap").first()).toBeVisible();
  const shadow = await page.locator(".container").evaluate((element) => getComputedStyle(element).boxShadow);
  expect(shadow).toBe("none");
});

for (const [file, theme, values] of [
  ["aerial-lifts.html", "dark", ["P", "F", "N/A"]],
  ["forklift.html", "light", ["SAT", "UNS", "N/A"]]
]) {
  test(`Lift and forklift result colours sync between phone and desktop on ${file}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installState(page, theme);
    await page.goto("/" + file, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", theme);

    const tile = page.locator(".inspection-tile").first();
    const mobileButtons = tile.getByRole("button");
    const desktopButtons = page.locator(".inspection-mobile-source tbody tr").first().locator(".inspection-result-button");
    const fills = ["rgb(17, 106, 53)", "rgb(199, 42, 34)", "rgb(21, 84, 119)"];
    const grey = await mobileButtons.first().evaluate(button => getComputedStyle(button).backgroundColor);
    for (const button of await mobileButtons.all()) {
      await expect(button).toHaveAttribute("aria-pressed", "false");
      await expect(button).toHaveCSS("background-color", grey);
    }

    for (const [index, label] of ["Pass", "Fail", "N/A"].entries()) {
      const button = tile.getByRole("button", { name: label, exact: true });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(button).toHaveCSS("background-color", fills[index]);
      await expect(button).toHaveCSS("color", "rgb(255, 255, 255)");
      const mark = await button.evaluate(el => getComputedStyle(el, "::before").borderInlineStartWidth);
      expect(mark).toBe("2px");
      await expect(tile.locator('[aria-pressed="true"]')).toHaveCount(1);
      for (const other of await tile.locator('[aria-pressed="false"]').all()) {
        await expect(other).toHaveCSS("background-color", grey);
      }
      await expect(page.locator(".inspection-progress-count")).toHaveText(/^1 of \d+ completed$/);
      await expect(desktopButtons.nth(index).locator("..").locator("input")).toBeChecked();
      await expect(desktopButtons.nth(index).locator("..").locator("input")).toHaveValue(values[index]);
    }

    await tile.screenshot({ path: info.outputPath("mobile-selected.png") });
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(desktopButtons.nth(2)).toHaveCSS("background-color", fills[2]);
    const radio = desktopButtons.first().locator("..").locator("input");
    await radio.focus();
    await radio.press("Space");
    await expect(radio).toBeChecked();
    await expect(desktopButtons.first()).toHaveCSS("background-color", fills[0]);
    await expect(desktopButtons.nth(2)).toHaveCSS("background-color", grey);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(mobileButtons.first()).toHaveAttribute("aria-pressed", "true");
    await expect(mobileButtons.first()).toHaveCSS("background-color", fills[0]);
  });
}
