const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createSession() {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "00000000-0000-4000-8000-000000000093",
    aud: "authenticated",
    role: "authenticated",
    email: "jobs-style-test@johngordonconstruction.com",
    user_metadata: { display_name: "Jobs Style Test" }
  };
  const token = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: user.id, email: user.email }),
    "jobs-style-test-signature"
  ].join(".");
  return {
    user,
    auth: {
      access_token: token,
      refresh_token: "jobs-style-test-refresh",
      expires_at: now + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user
    }
  };
}

const mockJobs = [
  {
    id: "job-active-one",
    job_number: "26123",
    job_name: "Long Customer Project Name for Mobile Layout Testing",
    job_type: "Contract",
    active: true,
    document_link: "https://example.com/jobs/26123",
    document_link_label: "Open Project Documents",
    updated_at: "2026-08-23T12:00:00Z"
  },
  {
    id: "job-active-two",
    job_number: "26124",
    job_name: "Cornwall Courthouse Access Panel Installation",
    job_type: "T&M",
    active: true,
    document_link: "",
    document_link_label: "",
    updated_at: "2026-08-23T12:00:00Z"
  }
];

async function installState(page) {
  const state = createSession();
  await page.addInitScript(({ state, ref }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(state.auth));
    localStorage.setItem("currentWorker", "jobs style test");
    localStorage.setItem("currentWorkerDisplay", "Jobs Style Test");
    localStorage.setItem("currentUserEmail", state.user.email);
    localStorage.setItem("currentUserRole", "worker");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { state, ref: "xnrljkkszoimegfivlya" });

  await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.startsWith("/auth/v1/user")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.user) });
      return;
    }
    if (requestUrl.pathname.startsWith("/auth/v1/token")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.auth) });
      return;
    }
    if (requestUrl.pathname === "/rest/v1/jobs") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockJobs) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

async function contrastRatio(page, selector) {
  return page.locator(selector).first().evaluate((element) => {
    function parseRgb(value) {
      const parts = String(value).match(/[\d.]+/g) || [];
      return parts.slice(0, 3).map(Number);
    }
    function luminance(rgb) {
      const values = rgb.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4);
      });
      return (0.2126 * values[0]) + (0.7152 * values[1]) + (0.0722 * values[2]);
    }
    const style = getComputedStyle(element);
    const foreground = luminance(parseRgb(style.color));
    const background = luminance(parseRgb(style.backgroundColor));
    const light = Math.max(foreground, background);
    const dark = Math.min(foreground, background);
    return (light + 0.05) / (dark + 0.05);
  });
}

test("Jobs family uses shared tokens without employee-page legacy CSS", async () => {
  const source = fs.readFileSync(path.join(portalRoot, "jobs.html"), "utf8");
  const featureCss = fs.readFileSync(path.join(portalRoot, "jobs-design-system.css"), "utf8");
  const adminCss = fs.readFileSync(path.join(portalRoot, "admin.css"), "utf8");
  const firstAdminJobsBlock = adminCss.match(/\.job-dashboard-card[\s\S]*?(?=\.admin-schedule-summary)/)?.[0] || "";
  const secondAdminJobsBlock = adminCss.match(/\.job-dashboard-shell[\s\S]*?(?=@media \(max-width: 900px\) \{\s*\.employee-profile-layout)/)?.[0] || "";

  expect(source).not.toMatch(/<style\b/i);
  expect(source).not.toMatch(/\sstyle\s*=/i);
  expect(source).not.toContain("styles.css");
  expect(source).toContain('jgc-design-system.css?v=7');
  expect(source).toContain('jobs-design-system.css?v=3');
  expect(source).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
  expect(featureCss, "Jobs-only CSS must use centralized design tokens instead of page colours").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  expect(firstAdminJobsBlock).not.toBe("");
  expect(secondAdminJobsBlock).not.toBe("");
  expect(firstAdminJobsBlock + secondAdminJobsBlock, "Admin Jobs visual values must use the same shared tokens").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`populated Jobs page stays readable and contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installState(page);
    await page.goto("/jobs.html", { waitUntil: "domcontentloaded" });

    await expect(page.locator(".jobs-table tbody tr")).toHaveCount(2);
    await expect(page.locator("#jobsStatus")).toHaveText("2 jobs shown.");
    await expect(page.locator(".jobs-document-link")).toHaveAttribute("href", "https://example.com/jobs/26123");
    await expect(page.locator(".job-type-badge").first()).toHaveText("Contract");

    const dimensions = await page.evaluate(() => {
      const firstControl = document.querySelector(".top-actions .jgc-button:not(.jgc-old-nav-hidden)");
      const firstRow = document.querySelector(".jobs-table tbody tr");
      return {
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        firstControlHeight: firstControl ? firstControl.getBoundingClientRect().height : 0,
        tableDisplay: getComputedStyle(document.querySelector(".jobs-table")).display,
        rowDisplay: getComputedStyle(firstRow).display
      };
    });
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.firstControlHeight).toBeGreaterThanOrEqual(44);

    if (viewport.name === "phone") {
      expect(dimensions.tableDisplay).toBe("block");
      expect(dimensions.rowDisplay).toBe("grid");
      const bottomNav = page.locator(".jgc-mobile-bottom-nav");
      await expect(bottomNav).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight / 2)));
      const navBox = await bottomNav.boundingBox();
      expect(Math.abs((navBox.y + navBox.height) - viewport.height)).toBeLessThanOrEqual(1);
    } else {
      expect(dimensions.tableDisplay).toBe("table");
      expect(dimensions.rowDisplay).toBe("table-row");
    }

    for (const selector of [
      ".jobs-lookup-panel",
      ".jobs-status",
      ".job-type-badge",
      ".jobs-document-link"
    ]) {
      expect(await contrastRatio(page, selector), `${selector} must meet normal-text contrast`).toBeGreaterThanOrEqual(4.5);
    }

    await page.locator("#jobSearch").fill("Cornwall");
    await expect(page.locator(".jobs-table tbody tr")).toHaveCount(1);
    await expect(page.locator(".jobs-table tbody tr")).toContainText("26124");
    await expect(page.locator("#jobsStatus")).toHaveText("1 job shown.");

    await page.locator("#jobSearch").fill("not-a-real-job");
    await expect(page.locator(".jobs-empty")).toBeVisible();
    await expect(page.locator("#jobsStatus")).toHaveText("0 jobs shown.");

    if (process.env.JGC_JOBS_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.JGC_JOBS_SCREENSHOT_DIR, { recursive: true });
      await page.locator("#jobSearch").fill("");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(process.env.JGC_JOBS_SCREENSHOT_DIR, `jobs-${viewport.name}.png`),
        fullPage: true
      });
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}
