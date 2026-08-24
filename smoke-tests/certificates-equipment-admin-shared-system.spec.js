const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");
const supabaseOrigin = "https://xnrljkkszoimegfivlya.supabase.co";

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function installAdminState(page) {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "00000000-0000-4000-8000-000000000134",
    aud: "authenticated",
    role: "authenticated",
    email: "certificate-equipment-style-test@johngordonconstruction.com",
    user_metadata: { display_name: "Admin Style Test" }
  };
  const token = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: user.id, email: user.email }),
    "certificate-equipment-style-test-signature"
  ].join(".");
  const auth = { access_token: token, refresh_token: "admin-style-test-refresh", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };

  await page.addInitScript(({ auth, user, ref }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(auth));
    localStorage.setItem("currentWorker", "admin style test");
    localStorage.setItem("currentWorkerDisplay", "Admin Style Test");
    localStorage.setItem("currentUserEmail", user.email);
    localStorage.setItem("currentUserRole", "admin");
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
      await route.fulfill({ status: 200, contentType: "application/json", body: "true" });
      return;
    }
    const table = requestUrl.pathname.split("/rest/v1/")[1] || "";
    const profile = { id: user.id, email: user.email, display_name: "Admin Style Test", worker_key: "admin style test", role: "admin", approved: true, account_status: "approved" };
    const rows = table.startsWith("profiles") ? [profile] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
}

test("Certificate and Equipment admin views use scoped token-only extensions", async () => {
  const standalone = fs.readFileSync(path.join(portalRoot, "certificates-admin.html"), "utf8");
  const adminPage = fs.readFileSync(path.join(portalRoot, "admin.html"), "utf8");
  const adminCss = fs.readFileSync(path.join(portalRoot, "admin.css"), "utf8");
  const certificateCss = fs.readFileSync(path.join(portalRoot, "certificates-admin.css"), "utf8");
  const embeddedCss = fs.readFileSync(path.join(portalRoot, "certificates-embedded.css"), "utf8");
  const equipmentCss = fs.readFileSync(path.join(portalRoot, "equipment-admin.css"), "utf8");
  const certificateScript = fs.readFileSync(path.join(portalRoot, "admin-certificates.js"), "utf8");
  const equipmentScript = fs.readFileSync(path.join(portalRoot, "admin-equipment.js"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");

  expect(standalone).not.toMatch(/<style\b|\sstyle\s*=/i);
  expect(standalone).not.toContain('href="styles.css');
  expect(standalone).toContain('jgc-design-system.css?v=8');
  expect(standalone).toContain('certificates-admin.css?v=1');
  expect(standalone).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);

  expect(adminPage).toContain('certificates-embedded.css?v=1');
  expect(adminPage).toContain('equipment-admin.css?v=1');
  expect(adminPage).toContain('admin.css?v=16');
  expect(adminPage).toContain('admin-certificates.js?v=4');
  expect(adminPage).toContain('admin-equipment.js?v=2');
  const certificatesSection = adminPage.match(/<div id="certificatesSection"[\s\S]*?(?=<div id="vacationSection")/)?.[0] || "";
  const equipmentSection = adminPage.match(/<div id="equipmentSection"[\s\S]*?(?=<div id="jobsSection")/)?.[0] || "";
  expect(certificatesSection).not.toMatch(/\sstyle\s*=/i);
  expect(equipmentSection).not.toMatch(/\sstyle\s*=/i);
  expect(certificatesSection).toContain("jgc-panel");
  expect(equipmentSection).toContain("jgc-panel");

  for (const [name, source] of [["standalone certificates", certificateCss], ["embedded certificates", embeddedCss], ["equipment", equipmentCss]]) {
    expect(source, `${name} CSS must inherit centralized theme tokens`).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  }
  expect(adminCss).not.toContain("#equipmentSection");
  expect(adminCss).not.toContain(".equipment-qr-modal");
  expect(adminCss).not.toContain(".training-matrix-table");
  expect(certificateScript).not.toMatch(/\sstyle\s*=/i);
  const equipmentPortalSource = equipmentScript.split("printWindow.document.write")[0];
  expect(equipmentPortalSource).not.toMatch(/style\.|\sstyle\s*=/i);
  expect(equipmentPortalSource).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);

  const releaseId = Number(serviceWorker.match(/JGC_RELEASE_ID = "(\d+)"/)?.[1] || 0);
  expect(releaseId).toBeGreaterThanOrEqual(765);
  for (const asset of ["certificates-admin.css?v=1", "certificates-embedded.css?v=1", "equipment-admin.css?v=1", "admin.css?v=16", "admin-certificates.js?v=4", "admin-equipment.js?v=2"]) {
    expect(serviceWorker).toContain(`"./${asset}"`);
  }
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`standalone Admin Certificates stays contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installAdminState(page);
    await page.goto("/certificates-admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();
    const layout = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      background: getComputedStyle(document.body).backgroundColor,
      color: getComputedStyle(document.body).color
    }));
    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.background).toBe("rgb(6, 17, 15)");
    expect(layout.color).toBe("rgb(244, 248, 244)");
    expect(errors).toEqual([]);
    await context.close();
  });
}

for (const tab of ["certificates", "equipment"]) {
  test(`embedded Admin ${tab} controls stay contained on phones`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installAdminState(page);
    await page.goto(`/admin.html?tab=${tab}`, { waitUntil: "domcontentloaded" });
    const section = page.locator(`#${tab}Section`);
    await expect(section).toBeVisible({ timeout: 10000 });
    const layout = await section.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll("input, select, textarea, button")].filter((control) => control.offsetParent !== null);
      return {
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        contained: rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1,
        controlsContained: controls.every((control) => {
          const controlRect = control.getBoundingClientRect();
          return controlRect.left >= rect.left - 1 && controlRect.right <= rect.right + 1;
        })
      };
    });
    expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.contained).toBe(true);
    expect(layout.controlsContained).toBe(true);
    expect(errors).toEqual([]);
    await context.close();
  });
}
