const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");
const supabaseOrigin = "https://xnrljkkszoimegfivlya.supabase.co";

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function installState(page) {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "00000000-0000-4000-8000-000000000131",
    aud: "authenticated",
    role: "authenticated",
    email: "permit-test@johngordonconstruction.com",
    user_metadata: { display_name: "Permit Test" }
  };
  const token = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: user.id, email: user.email }),
    "permit-style-test-signature"
  ].join(".");
  const auth = { access_token: token, refresh_token: "permit-test-refresh", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };

  await page.addInitScript(({ auth, user, ref }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(auth));
    localStorage.setItem("currentWorker", "permit test");
    localStorage.setItem("currentWorkerDisplay", "Permit Test");
    localStorage.setItem("currentUserEmail", user.email);
    localStorage.setItem("currentUserRole", "worker");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { auth, user, ref: "xnrljkkszoimegfivlya" });

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
    const rows = table === "profiles"
      ? [{ id: user.id, display_name: "Permit Test", worker_key: "permit test", role: "worker", approved: true, account_status: "approved" }]
      : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
}

test("Permits family uses one token-only shared visual source", async () => {
  const pages = ["permits.html", "hot-work-permit.html", "confined-space-permit.html", "excavation-permit.html"];
  const featureCss = fs.readFileSync(path.join(portalRoot, "permit-design-system.css"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");

  for (const file of pages) {
    const source = fs.readFileSync(path.join(portalRoot, file), "utf8");
    expect(source, `${file} must not own embedded styles`).not.toMatch(/<style\b/i);
    expect(source, `${file} must not write inline styles`).not.toMatch(/\sstyle\s*=/i);
    expect(source, `${file} must not load legacy styles`).not.toContain("styles.css");
    expect(source).toContain('jgc-design-system.css?v=8');
    expect(source).toContain('permit-design-system.css?v=2');
    expect(source).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
  }

  for (const file of pages.slice(1)) {
    const source = fs.readFileSync(path.join(portalRoot, file), "utf8");
    expect(source, `${file} must use shared readiness classes`).not.toMatch(/style\.background|#[0-9a-f]{3,8}/i);
  }

  expect(featureCss, "Permit-only CSS must use centralized design tokens").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  expect(serviceWorker).toContain('"./permit-design-system.css?v=2"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  for (const pageCase of [
    { file: "permits.html", form: false },
    { file: "hot-work-permit.html", form: true },
    { file: "confined-space-permit.html", form: true },
    { file: "excavation-permit.html", form: true }
  ]) {
    test(`${pageCase.file} stays readable and contained on ${viewport.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await installState(page);
      await page.goto(`/${pageCase.file}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".permit-page-shell")).toBeVisible();

      const dimensions = await page.evaluate(() => {
        const controls = [...document.querySelectorAll(".permit-page-shell .jgc-button, .permit-page-shell .jgc-input, .permit-page-shell .jgc-select, .permit-page-shell .jgc-textarea")].filter((item) => item.offsetParent !== null);
        return {
          bodyWidth: document.body.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          smallestControl: Math.min(...controls.map((item) => item.getBoundingClientRect().height)),
          gridColumns: document.querySelector(".permit-form-page .jgc-form-grid")
            ? getComputedStyle(document.querySelector(".permit-form-page .jgc-form-grid")).gridTemplateColumns.split(" ").length
            : 0
        };
      });
      expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
      expect(dimensions.smallestControl).toBeGreaterThanOrEqual(44);

      if (pageCase.form) {
        expect(dimensions.gridColumns).toBe(viewport.name === "phone" ? 1 : 2);
        await expect(page.locator("#permitStatus")).toHaveClass(/jgc-notice--danger/);
        await page.locator(".permitCheck").evaluateAll((boxes) => {
          for (const box of boxes) {
            box.checked = true;
            box.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
        await expect(page.locator("#permitStatus")).toHaveText("PERMIT READY FOR APPROVAL");
        await expect(page.locator("#permitStatus")).toHaveClass(/jgc-notice--success/);
      } else {
        await expect(page.locator(".permit-card")).toHaveCount(5);
      }

      expect(errors).toEqual([]);
      await context.close();
    });
  }
}

test("permit print layout hides portal-only controls", async ({ page }) => {
  await installState(page);
  await page.goto("/hot-work-permit.html", { waitUntil: "domcontentloaded" });
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".permit-page-header")).toBeHidden();
  await expect(page.locator(".permit-page-shell .actions")).toBeHidden();
  const boxShadow = await page.locator(".container.jgc-panel").evaluate((element) => getComputedStyle(element).boxShadow);
  expect(boxShadow).toBe("none");
});
