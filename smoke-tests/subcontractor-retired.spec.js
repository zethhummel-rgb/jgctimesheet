const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(portalRoot, file), "utf8");

// Release 1001: Job Board Access (each site's QR code) replaced the old Subcontractor Access sign-in,
// which kept a device-only session with the "subcontractor" role and no account.
const RETIRED_SESSION = {
  currentWorker: "subcontractor:lee@subtrade.example.com",
  currentWorkerDisplay: "Lee Subtrade - Subtrade Inc",
  currentUserEmail: "lee@subtrade.example.com",
  currentUserRole: "subcontractor",
  currentAccountStatus: "approved",
  jgcSubcontractorCompany: "Subtrade Inc",
  jgcSubcontractorPhone: "613-555-0100",
  jgcSubcontractorSessionId: "retired-session",
  jgcStayLoggedIn: "true"
};

async function openWithRetiredSession(page, url, theme) {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.addInitScript(({ session, theme }) => {
    if (theme) localStorage.setItem("jgcPortalTheme", theme);
    // Install once: later navigations must show whether the Portal cleared it.
    if (sessionStorage.getItem("retiredSessionInstalled")) return;
    sessionStorage.setItem("retiredSessionInstalled", "1");
    for (const [key, value] of Object.entries(session)) localStorage.setItem(key, value);
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { session: RETIRED_SESSION, theme });
  await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return requests;
}

const storedSession = (page) => page.evaluate((keys) => keys.filter((key) => localStorage.getItem(key) !== null), Object.keys(RETIRED_SESSION));

test("the sign-in page has no Subcontractor Access and points subcontractors to the Job Board QR code", async ({ page }) => {
  await openWithRetiredSession(page, "/index.html");
  await expect(page.locator(".site-access-note")).toBeVisible();
  await expect(page.locator(".site-access-note")).toHaveText("Subcontractors and visitors: scan the Job Board QR code posted at your site to sign in.");
  await expect(page.locator(".subcontractor-access-button, #subcontractorAccessOverlay")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /subcontractor/i })).toHaveCount(0);
  expect(await storedSession(page)).toEqual([]);
});

test("a retired Subcontractor Access session left on a device is signed out", async ({ page }) => {
  const requests = await openWithRetiredSession(page, "/reports.html");
  await expect(page).toHaveURL(/\/index\.html$/);
  await expect(page.locator(".site-access-note")).toBeVisible();
  expect(await storedSession(page)).toEqual([]);
  expect(requests.filter((url) => url.includes("subcontractor_portal_activity"))).toEqual([]);
});

for (const theme of ["dark", "light"]) {
  for (const viewport of [{ name: "phone", width: 390, height: 844 }, { name: "desktop", width: 1280, height: 900 }]) {
    test(`subcontractor.html explains the move (${theme}, ${viewport.name})`, async ({ browser }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text()); });
      await openWithRetiredSession(page, "/subcontractor.html", theme);

      await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", theme);
      await expect(page.locator("h1")).toHaveText("Subcontractor sign-in has moved");
      await expect(page.locator(".subcontractor-moved")).toContainText("Scan the Job Board QR code posted on site");
      await expect(page.getByRole("link", { name: "JGC employee sign-in" })).toHaveAttribute("href", "index.html");
      await expect(page.locator("#jgcGlobalTopNav, #jgcPageBar, #jgcMobileBottomNav")).toHaveCount(0);
      expect(await storedSession(page)).toEqual([]);

      const layout = await page.evaluate(() => {
        function rgb(value) { return (String(value).match(/[\d.]+/g) || []).slice(0, 4).map(Number); }
        function background(element) {
          for (let node = element; node; node = node.parentElement) {
            const value = rgb(getComputedStyle(node).backgroundColor);
            if (value.length === 3 || value[3] > 0.9) return value.slice(0, 3);
          }
          return [255, 255, 255];
        }
        function luminance(values) {
          const [r, g, b] = values.map((channel) => { const v = channel / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        const contrast = (element) => {
          const a = luminance(rgb(getComputedStyle(element).color).slice(0, 3)), b = luminance(background(element));
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const panel = document.querySelector(".subcontractor-moved").getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          panelContained: panel.left >= 0 && panel.right <= innerWidth + 1,
          contrasts: Array.from(document.querySelectorAll(".subcontractor-moved h1, .subcontractor-moved p, .subcontractor-moved a")).map(contrast)
        };
      });
      expect(layout.overflow).toBe(false);
      expect(layout.panelContained).toBe(true);
      for (const ratio of layout.contrasts) expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}

test("no Portal page still calls the retired subcontractor session code", () => {
  const retired = /isJgcSubcontractorSession|setJgcSubcontractorSession|recordJgcSubcontractorActivity|withJgcSubcontractorEmailCopy|JGC_SUBCONTRACTOR_|subcontractor_portal_activity|subcontractorActivity/;
  const files = fs.readdirSync(portalRoot).filter((file) => /\.(html|js|css)$/.test(file));
  expect(files.length).toBeGreaterThan(50);
  for (const file of files) expect(read(file), file).not.toMatch(retired);
  // The page stays for old bookmarks and installed shortcuts.
  expect(read("service-worker.js")).toContain('"./subcontractor.html"');
});
