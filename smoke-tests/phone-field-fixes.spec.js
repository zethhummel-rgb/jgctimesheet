const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

// Release 946, from Zeth's iPhone screenshots: the Field Calculator's "Quick Calculations" title was cut
// off at the top, date boxes ran out the right side (Timesheet, PO, Work Orders), and a Work Order job
// lost its client once picked.
const portalRoot = path.resolve(__dirname, "..");
const supabaseOrigin = "https://xnrljkkszoimegfivlya.supabase.co";
const USER_ID = "00000000-0000-4000-8000-000000000946";
const PHONE = { width: 393, height: 852 };
const JOB = { id: "job-26132", customer: "McKay Mechanical", job_number: "26132", job_name: "Ingleside Development", job_type: "contract", active: true };

async function signIn(page, { homeScreenApp = false, theme = "light" } = {}) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "phone-fields@johngordonconstruction.com", user_metadata: { display_name: "Phone Fields" } };
  const auth = { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: USER_ID, exp: now + 3600, role: "authenticated" }), "phone-fields"].join("."), refresh_token: "phone-fields", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
  const profile = { id: USER_ID, email: user.email, display_name: "Phone Fields", worker_key: "phone fields", role: "worker", approved: true, account_status: "approved" };
  await page.addInitScript(({ auth, homeScreenApp, theme }) => {
    localStorage.setItem("jgcPortalTheme", theme);
    localStorage.setItem("jgcPortalTheme:" + auth.user.id, theme);
    localStorage.setItem("sb-xnrljkkszoimegfivlya-auth-token", JSON.stringify(auth));
    localStorage.setItem("currentWorker", "phone fields");
    localStorage.setItem("currentWorkerDisplay", "Phone Fields");
    localStorage.setItem("currentUserEmail", auth.user.email);
    localStorage.setItem("currentUserRole", "worker");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    localStorage.setItem("jgcPushOnboarding:v1:phone fields", "dismissed");
    sessionStorage.setItem("jgcActiveSession", "true");
    if (homeScreenApp) {
      Object.defineProperty(navigator, "standalone", { get: () => true });
    }
  }, { auth, homeScreenApp, theme });
  await page.route(`${supabaseOrigin}/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    if (url.pathname.includes("/rest/v1/rpc/")) return route.fulfill({ status: 200, contentType: "application/json", body: url.pathname.includes("is_") ? "false" : "[]" });
    const table = url.pathname.split("/rest/v1/")[1] || "";
    const rows = {
      profiles: [profile],
      accounts: [profile],
      jobs: [JOB, { id: "job-26140", customer: "Trans Northern Pipeline", job_number: "26140", job_name: "Gate Replacement", job_type: "T&M", active: true }],
      work_order_labour_workers: [{ id: "phone-worker", profile_id: USER_ID, display_name: "Phone Fields", worker_key: "phone fields", approved: true }],
      employee_feature_access: [{ worker_id: "phone-worker", feature_key: "work_orders", enabled: true }]
    }[table] || [];
    const single = String(route.request().headers().accept || "").includes("vnd.pgrst.object");
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` }, body: JSON.stringify(single ? (rows[0] || null) : rows) });
  });
}

const box = (page, selector) => page.locator(selector).evaluate(el => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
});

test("Field Calculator: the quick calculation title row stays whole while the panel scrolls on an iPhone", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, { homeScreenApp: true });
  await page.goto("/field-calculator.html", { waitUntil: "load" });
  await page.evaluate(() => document.documentElement.style.setProperty("--jgc-safe-area-top", "59px"));
  await page.locator('.quick-calc-tab[data-quick-calc="sonotube"]').click();
  const panel = page.locator("#quickCalcPanel");
  await expect(panel).toBeVisible();

  for (const scrollTop of [0, 25, 300]) {
    await panel.evaluate((el, y) => { el.scrollTop = y; }, scrollTop);
    const [panelBox, header, kicker, title] = await Promise.all([box(page, "#quickCalcPanel"), box(page, ".quick-calc-header"), box(page, ".quick-calc-kicker"), box(page, "#quickCalcTitle")]);
    expect(await panel.evaluate(el => el.scrollTop), "the panel really scrolled").toBeGreaterThanOrEqual(Math.min(scrollTop, 1));
    // 1px is the panel's border.
    expect(Math.abs(header.top - panelBox.top - 1), `header pinned to the panel's top edge at scroll ${scrollTop}`).toBeLessThanOrEqual(1);
    expect(kicker.top, `"Quick Calculations" fully inside the panel at scroll ${scrollTop}`).toBeGreaterThanOrEqual(panelBox.top + 4);
    expect(title.bottom).toBeLessThanOrEqual(header.bottom);
  }
  // The pinned row is solid, so the scrolled cards pass underneath instead of showing through.
  expect(await page.locator(".quick-calc-header").evaluate(el => getComputedStyle(el).backgroundColor)).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  // The first card starts below the title row.
  await panel.evaluate(el => { el.scrollTop = 0; });
  expect((await box(page, "#sonotubeCalcForm .quick-calc-card >> nth=0")).top).toBeGreaterThan((await box(page, ".quick-calc-header")).bottom);

  // Switching calculators opens the next one at its title.
  await panel.evaluate(el => { el.scrollTop = 300; });
  await page.locator('.quick-calc-tab[data-quick-calc="stairs"]').click();
  await expect(page.locator("#quickCalcTitle")).toHaveText("Stairs");
  expect(await panel.evaluate(el => el.scrollTop)).toBe(0);
});

for (const theme of ["light", "dark"]) {
  test(`Field Calculator: Sonotube and Stairs results are readable in ${theme} mode`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page, { theme });
    await page.goto("/field-calculator.html", { waitUntil: "load" });
    for (const tab of ["sonotube", "stairs"]) {
      await page.locator(`.quick-calc-tab[data-quick-calc="${tab}"]`).click();
      const rows = page.locator(`#quickCalcPanel [data-quick-form="${tab}"] .quick-result-row:not(.highlight):not(.warning)`);
      await expect(rows.first()).toBeVisible();
      const ratios = await rows.evaluateAll(elements => elements.flatMap(row => [row, row.querySelector("strong")].filter(Boolean)).map(el => {
        // color-mix() computes to "color(srgb r g b / a)" with 0-1 channels; rgb() uses 0-255.
        const parse = value => {
          const numbers = (String(value).match(/[\d.]+/g) || []).slice(0, 4).map(Number);
          return /^color\(srgb/.test(String(value)) ? numbers.map((n, i) => (i < 3 ? n * 255 : n)) : numbers;
        };
        let node = el.closest(".quick-calc-card");
        let bg = null;
        while (node && !bg) {
          const c = parse(getComputedStyle(node).backgroundColor);
          if (c.length >= 3 && (c.length < 4 || c[3] > 0.5)) bg = c;
          node = node.parentElement;
        }
        const fg = parse(getComputedStyle(el).color);
        const alpha = fg.length > 3 ? fg[3] : 1;
        const mixed = fg.slice(0, 3).map((v, i) => v * alpha + bg[i] * (1 - alpha));
        const lum = rgb => rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const [a, b] = [lum(mixed), lum(bg.slice(0, 3))];
        return { text: el.textContent.trim().slice(0, 30), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      }));
      for (const { text, ratio } of ratios) {
        expect(ratio, `"${text}" on the ${tab} card in ${theme} mode`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
}

test("Field Calculator: the page is put back after iOS leaves it scrolled when the keyboard closes", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, { homeScreenApp: true });
  await page.goto("/field-calculator.html", { waitUntil: "load" });
  await page.locator('.quick-calc-tab[data-quick-calc="sonotube"]').click();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflowY)).toBe("hidden");
  // iOS lets the page scroll while the keyboard is up; give it room to do the same here.
  await page.evaluate(() => {
    const room = document.createElement("div");
    room.id = "keyboardRoom";
    room.style.height = "300px";
    document.body.appendChild(room);
  });
  const diameter = page.locator("#sonoDiameter");
  await diameter.focus();
  await page.evaluate(() => window.scrollTo(0, 38));
  expect(await page.evaluate(() => scrollY)).toBe(38);
  // While a field is in use the page is left alone.
  await page.locator("#sonoHeight").focus();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => scrollY)).toBe(38);
  await page.locator("#sonoHeight").blur();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
});

test("date boxes carry the iOS fix in the shared design system", async () => {
  const css = fs.readFileSync(path.join(portalRoot, "jgc-design-system.css"), "utf8");
  expect(css).toMatch(/input:is\(\[type="date"\][^)]*\)\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
  expect(css).toMatch(/\.jgc-input:is\(\[type="date"\][^)]*\)\s*\{[^}]*display:\s*block;/);
  // Its own rule: browsers that do not know the pseudo-element drop the whole rule.
  expect(css).toMatch(/\ninput::-webkit-date-and-time-value\s*\{[^}]*height:\s*1\.4em;[^}]*margin:\s*0;[^}]*text-align:\s*left;[^}]*\}/);
  // iOS-only: the native look kept its own width (min-width 0 alone did not fix Vacation on the iPhone).
  expect(css).toMatch(/@supports \(-webkit-touch-callout: none\) \{\s*input:is\(\[type="date"\][^)]*\)\s*\{\s*-webkit-appearance:\s*none;\s*appearance:\s*none;/);
});

for (const [name, url, selector, form] of [
  ["Timesheet Week Date", "/timesheet.html", "#weekStart"],
  // The PO form opens after a number is reserved; only its layout matters here.
  ["PO Date of Order", "/purchase-orders.html", "#poOrderDate", "#poFormView"],
  ["Work Order Date", "/work-orders.html", "#woDate"]
]) {
  test(`${name} stays inside its column and at text-box height on a phone`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page);
    await page.goto(url, { waitUntil: "load" });
    if (form) {
      await page.locator(form).evaluate(el => { el.hidden = false; });
    }
    const field = page.locator(selector);
    await expect(field).toBeVisible();
    const layout = await field.evaluate(el => {
      const r = el.getBoundingClientRect();
      const parent = el.parentElement.getBoundingClientRect();
      const text = Array.from(document.querySelectorAll("input.jgc-input:not([type=date]):not([type=hidden]):not([type=checkbox]):not([type=radio]), input:not([type]):not([type=hidden])"))
        .find(other => other.offsetParent && other.getBoundingClientRect().width > 100);
      return { right: r.right, parentRight: parent.right, left: r.left, parentLeft: parent.left, height: r.height, textHeight: text ? text.getBoundingClientRect().height : null, minWidth: getComputedStyle(el).minWidth, display: getComputedStyle(el).display, pageWidth: document.documentElement.scrollWidth };
    });
    expect(layout.right).toBeLessThanOrEqual(layout.parentRight + 0.5);
    expect(layout.left).toBeGreaterThanOrEqual(layout.parentLeft - 0.5);
    expect(layout.minWidth).toBe("0px");
    expect(layout.display).toBe("block");
    expect(layout.pageWidth).toBeLessThanOrEqual(PHONE.width);
    if (layout.textHeight) {
      expect(Math.abs(layout.height - layout.textHeight)).toBeLessThanOrEqual(8);
    }
  });
}

test("Work Orders: a picked job keeps its client, and tapping back in lists it instead of 'No matching jobs found'", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page);
  await page.goto("/work-orders.html", { waitUntil: "load" });
  const search = page.locator("#woJobSearch");
  await expect(search).toBeVisible();
  await search.fill("McKay");
  const suggestion = page.locator("#woJobSuggestions .job-suggestion").filter({ hasText: "McKay Mechanical" });
  await expect(suggestion).toHaveText("26132 - McKay Mechanical - Ingleside Development - Contract");
  await suggestion.click();

  await expect(search).toHaveValue("26132 - McKay Mechanical - Ingleside Development - Contract");
  await expect(page.locator("#woJobNumber")).toHaveValue("26132");
  await expect(page.locator("#woJobName")).toHaveValue("Ingleside Development");
  // The shared "Selected job details" card now recognises the label and shows the client.
  const card = page.locator(".jgc-employee-job-details").filter({ hasText: "McKay Mechanical" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Ingleside Development");

  // Tapping back into the box lists the chosen job first, with others to switch to.
  await search.blur();
  await search.focus();
  await expect(page.locator("#woJobSuggestions")).not.toContainText("No matching jobs found");
  await expect(page.locator("#woJobSuggestions .job-suggestion").first()).toHaveText("26132 - McKay Mechanical - Ingleside Development - Contract");
  await expect(page.locator("#woJobSuggestions .job-suggestion")).toHaveCount(2);

  // Typing the label style shown in the box still finds the job.
  await search.fill("26132 - McKay");
  await expect(page.locator("#woJobSuggestions .job-suggestion")).toHaveCount(1);
});
