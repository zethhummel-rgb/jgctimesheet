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
    id: "00000000-0000-4000-8000-000000000133",
    aud: "authenticated",
    role: "authenticated",
    email: "job-notes-style-test@johngordonconstruction.com",
    user_metadata: { display_name: "Job Notes Test" }
  };
  const token = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: user.id, email: user.email }),
    "job-notes-style-test-signature"
  ].join(".");
  const auth = { access_token: token, refresh_token: "job-notes-test-refresh", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };

  await page.addInitScript(({ auth, user, ref }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(auth));
    localStorage.setItem("currentWorker", "job notes test");
    localStorage.setItem("currentWorkerDisplay", "Job Notes Test");
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
    const profile = { id: user.id, email: user.email, display_name: "Job Notes Test", worker_key: "job notes test", role: "admin", approved: true, account_status: "approved" };
    const rows = table.startsWith("profiles")
      ? (requestUrl.searchParams.has("id") ? profile : [profile])
      : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
}

test("Job Notes family uses one token-only shared visual source", async () => {
  const featureCss = fs.readFileSync(path.join(portalRoot, "job-lists.css"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");

  for (const file of ["job-lists.html", "job-lists-admin.html"]) {
    const source = fs.readFileSync(path.join(portalRoot, file), "utf8");
    expect(source).not.toMatch(/<style\b/i);
    expect(source).not.toMatch(/\sstyle\s*=/i);
    expect(source).not.toContain('href="styles.css');
    expect(source).toContain('jgc-design-system.css?v=8');
    expect(source).toContain('job-lists.css?v=11');
    expect(source).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
  }

  expect(featureCss, "Job Notes CSS must use centralized tokens").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  const releaseId = Number(serviceWorker.match(/JGC_RELEASE_ID = "(\d+)"/)?.[1] || 0);
  expect(releaseId).toBeGreaterThanOrEqual(763);
  expect(serviceWorker).toContain('"./job-lists.css?v=11"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  for (const file of ["job-lists.html", "job-lists-admin.html"]) {
    test(`${file} stays readable and contained on ${viewport.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await installState(page);
      await page.goto(`/${file}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("main")).toBeVisible();
      await page.waitForTimeout(100);

      const dimensions = await page.evaluate(() => {
        const controls = [...document.querySelectorAll("main .jgc-button, main .jgc-input, main .jgc-select")]
          .filter((element) => element.offsetParent !== null);
        const tableWrap = document.querySelector(".job-list-admin-table-wrap");
        return {
          bodyWidth: document.body.scrollWidth,
          viewportWidth: document.documentElement.clientWidth,
          smallestControl: Math.min(...controls.map((element) => element.getBoundingClientRect().height)),
          pageBackground: getComputedStyle(document.body).backgroundColor,
          pageColor: getComputedStyle(document.body).color,
          tableClientWidth: tableWrap ? tableWrap.clientWidth : 0,
          tableScrollWidth: tableWrap ? tableWrap.scrollWidth : 0
        };
      });

      expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
      expect(dimensions.smallestControl).toBeGreaterThanOrEqual(44);
      expect(dimensions.pageBackground).toBe("rgb(6, 17, 15)");
      expect(dimensions.pageColor).toBe("rgb(244, 248, 244)");
      if (file === "job-lists-admin.html" && viewport.name === "phone") {
        expect(dimensions.tableScrollWidth).toBeGreaterThan(dimensions.tableClientWidth);
      }
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}
