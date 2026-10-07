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

async function signIn(page, { homeScreenApp = false, theme = "light", jobs = null } = {}) {
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
      jobs: jobs || [JOB, { id: "job-26140", customer: "Trans Northern Pipeline", job_number: "26140", job_name: "Gate Replacement", job_type: "T&M", active: true }],
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

test("Work Orders: a picked job keeps its client and shows the job details card", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page);
  await page.goto("/work-orders.html", { waitUntil: "load" });
  const search = page.locator("#woJobSearch");
  await expect(search).toBeVisible();
  await search.fill("McKay");
  const suggestion = page.locator("#woJobSuggestions .jgc-job-option").filter({ hasText: "McKay Mechanical" });
  await expect(suggestion).toHaveCount(1);
  await suggestion.click();

  await expect(search).toHaveValue("26132 - McKay Mechanical - Ingleside Development - Contract");
  await expect(page.locator("#woJobNumber")).toHaveValue("26132");
  await expect(page.locator("#woJobName")).toHaveValue("Ingleside Development");
  // The shared "Selected job details" card recognises the label and shows the client.
  const card = page.locator(".jgc-employee-job-details").filter({ hasText: "McKay Mechanical" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Ingleside Development");
});

test("Work Orders: the job list uses the Timesheet cards (number, Contract/T&M tag, job, client)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page);
  await page.goto("/work-orders.html", { waitUntil: "load" });
  await page.locator("#woJobSearch").focus();
  const options = page.locator("#woJobSuggestions .jgc-job-option");
  await expect(options).toHaveCount(2);
  const first = options.first();
  await expect(first.locator(".jgc-job-option__number")).toHaveText("26132");
  await expect(first.locator(".jgc-job-option__type")).toHaveText("Contract");
  await expect(first.locator(".jgc-job-option__name")).toHaveText("Ingleside Development");
  await expect(first.locator(".jgc-job-option__client")).toHaveText("McKay Mechanical");
  await expect(options.nth(1).locator(".jgc-job-option__type")).toHaveText("T&M");
  // The iPhone keyboard suggestion list is gone; the page's own dropdown is the only list.
  expect(await page.locator("#woJobSearch").getAttribute("list")).toBeNull();
  // Same look as the Timesheet: white card rows, green bold number, overlaying the form.
  const style = await first.evaluate(el => ({
    number: getComputedStyle(el.querySelector(".jgc-job-option__number")).fontWeight,
    list: getComputedStyle(el.parentElement).position,
    background: getComputedStyle(el).backgroundColor
  }));
  expect(Number(style.number)).toBeGreaterThanOrEqual(700);
  expect(style.list).toBe("absolute");
  expect(style.background).toBe("rgb(255, 255, 255)");
});

test("Work Orders: a picked job is locked and the X is the only way to remove it", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page);
  await page.goto("/work-orders.html", { waitUntil: "load" });
  const search = page.locator("#woJobSearch");
  const clear = page.locator("#woJobClear");
  await expect(clear).toBeHidden();

  await search.fill("Ingleside");
  await page.locator("#woJobSuggestions .jgc-job-option").first().click();
  await expect(search).toHaveValue("26132 - McKay Mechanical - Ingleside Development - Contract");
  await expect(search).not.toBeEditable();
  await expect(clear).toBeVisible();
  // Backspace does nothing and tapping the box does not reopen the list.
  await search.click();
  await page.keyboard.press("Backspace");
  await expect(search).toHaveValue("26132 - McKay Mechanical - Ingleside Development - Contract");
  await expect(page.locator("#woJobSuggestions")).toBeHidden();
  // The X sits inside the box.
  const [box, x] = await Promise.all([search.boundingBox(), clear.boundingBox()]);
  expect(x.x + x.width).toBeLessThanOrEqual(box.x + box.width);
  expect(x.y).toBeGreaterThanOrEqual(box.y);
  expect(x.y + x.height).toBeLessThanOrEqual(box.y + box.height);

  await clear.click();
  await expect(search).toHaveValue("");
  await expect(search).toBeEditable();
  await expect(search).toBeFocused();
  await expect(clear).toBeHidden();
  await expect(page.locator("#woJobNumber")).toHaveValue("");
  await expect(page.locator("#woJobName")).toHaveValue("");
  await expect(page.locator("#woNumber")).toHaveValue("");
  await expect(page.locator("#woJobSuggestions .jgc-job-option")).toHaveCount(2);
  await expect(page.locator(".jgc-employee-job-details").filter({ hasText: "McKay Mechanical" })).toBeHidden();
});

test("Work Orders: typing or backspacing to a job number never re-picks the job", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page);
  await page.goto("/work-orders.html", { waitUntil: "load" });
  const search = page.locator("#woJobSearch");
  await search.click();
  await page.keyboard.type("26132 - Mc");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  // This used to snap back to the full "26132 - ..." label.
  await expect(search).toHaveValue("26132 - ");
  await expect(search).toBeEditable();
  await expect(page.locator("#woJobNumber")).toHaveValue("");
  await expect(page.locator("#woJobSuggestions .jgc-job-option")).toHaveCount(1);

  // Leaving the box with a whole job number still picks that job.
  await search.fill("26140");
  await expect(search).toBeEditable();
  await search.blur();
  await expect(search).toHaveValue("26140 - Trans Northern Pipeline - Gate Replacement - T&M");
  await expect(search).not.toBeEditable();
  await expect(page.locator("#woJobNumber")).toHaveValue("26140");
});

// Release 997 (Zeth): one client has the same kind of job at many sites (BGIS generator roofs at each Port of
// Entry), so every job picker shows the site, can be searched by it, and the picked job's card shows it.
const SITE_JOBS = [
  { id: "job-26147", customer: "BGIS Federal", job_number: "26147", job_name: "Generator Room Roof Leak", job_type: "T&M", site_name: "Prescott POE", address: "1032 Highway 16 (POE), Prescott ON K0E 1T0", active: true },
  { id: "job-26151", customer: "BGIS Federal", job_number: "26151", job_name: "Generator Room Roof Leak", job_type: "T&M", site_name: "Lansdowne POE", address: "860 Highway 137, Lansdowne ON", active: true }
];
for (const theme of ["light", "dark"]) for (const [name, url, selectors] of [
  ["Work Orders", "/work-orders.html", { search: "#woJobSearch", list: "#woJobSuggestions" }],
  ["Timesheet", "/timesheet.html", { search: "#jobName", list: "#jobDropdown" }],
  ["PO", "/purchase-orders.html", { search: "#poJobSearch", list: "#poJobOptions", form: "#poFormView" }]
]) {
  test(`${name}: job choices show the site, can be searched by it, and the picked job's card shows it (${theme})`, async ({ page }, testInfo) => {
    await page.setViewportSize(PHONE);
    await signIn(page, { jobs: SITE_JOBS, theme });
    await page.goto(url, { waitUntil: "load" });
    if (selectors.form) await page.locator(selectors.form).evaluate(el => { el.hidden = false; });
    const search = page.locator(selectors.search);
    await search.click();
    const options = page.locator(`${selectors.list} .jgc-job-option`);
    await expect(options).toHaveCount(2);
    await expect(options.first().locator(".jgc-job-option__site")).toHaveText("Site: Prescott POE · 1032 Highway 16 (POE), Prescott ON K0E 1T0");
    await expect(options.nth(1).locator(".jgc-job-option__site")).toHaveText("Site: Lansdowne POE · 860 Highway 137, Lansdowne ON");
    await page.locator(selectors.list).screenshot({ path: testInfo.outputPath(`${name.replace(/\s/g, "-").toLowerCase()}-site-${theme}.png`) });
    await search.fill("Prescott");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText("26147");
    await options.first().click();
    const card = page.locator(".jgc-employee-job-details").filter({ hasText: "Prescott POE" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("1032 Highway 16 (POE), Prescott ON K0E 1T0");
    await expect(card).not.toContainText("Lansdowne");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

// Release 948: Timesheet and PO use the same job dropdown and the same lock + X as Work Orders.
for (const [name, url, selectors] of [
  ["Timesheet", "/timesheet.html", { search: "#jobName", clear: "#jobNameClear", list: "#jobDropdown", number: "#jobNumber", picked: "Ingleside Development" }],
  ["PO", "/purchase-orders.html", { search: "#poJobSearch", clear: "#poJobClear", list: "#poJobOptions", form: "#poFormView", picked: "26132 - McKay Mechanical - Ingleside Development - Contract" }]
]) {
  test(`${name}: the job list uses the shared cards, and a picked job is locked until the X removes it`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page);
    await page.goto(url, { waitUntil: "load" });
    if (selectors.form) {
      // The PO form opens after a number is reserved; only the picker matters here.
      await page.locator(selectors.form).evaluate(el => { el.hidden = false; });
    }
    const search = page.locator(selectors.search);
    const clear = page.locator(selectors.clear);
    await expect(clear).toBeHidden();
    await search.click();
    const options = page.locator(`${selectors.list} .jgc-job-option`);
    await expect(options).toHaveCount(2);
    await expect(options.first().locator(".jgc-job-option__number")).toHaveText("26132");
    await expect(options.first().locator(".jgc-job-option__type")).toHaveText("Contract");
    await expect(options.first().locator(".jgc-job-option__client")).toHaveText("McKay Mechanical");
    expect(await options.first().evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");

    await options.first().click();
    await expect(search).toHaveValue(selectors.picked);
    if (selectors.number) await expect(page.locator(selectors.number)).toHaveValue("26132");
    await expect(search).not.toBeEditable();
    await expect(clear).toBeVisible();
    await search.click();
    await page.keyboard.press("Backspace");
    await expect(search).toHaveValue(selectors.picked);
    await expect(page.locator(selectors.list)).toBeHidden();
    const [box, x] = await Promise.all([search.boundingBox(), clear.boundingBox()]);
    expect(x.x + x.width).toBeLessThanOrEqual(box.x + box.width);
    expect(Math.abs((x.y + x.height / 2) - (box.y + box.height / 2))).toBeLessThanOrEqual(2);

    await clear.click();
    await expect(search).toHaveValue("");
    await expect(search).toBeEditable();
    await expect(search).toBeFocused();
    await expect(clear).toBeHidden();
    if (selectors.number) await expect(page.locator(selectors.number)).toHaveValue("");
    await expect(options).toHaveCount(2);
  });
}

test("Timesheet: a typed job name that isn't listed stays editable; a listed name locks when leaving the box", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page);
  await page.goto("/timesheet.html", { waitUntil: "load" });
  const name = page.locator("#jobName");
  await name.click();
  await page.keyboard.type("Garage cleanup");
  await name.blur();
  await expect(name).toBeEditable();
  await expect(page.locator("#jobNameClear")).toBeHidden();

  await name.fill("Gate Replacement");
  await name.blur();
  await expect(page.locator("#jobNumber")).toHaveValue("26140");
  await expect(name).not.toBeEditable();
  await expect(page.locator("#jobNameClear")).toBeVisible();
});