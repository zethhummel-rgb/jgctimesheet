const { test, expect } = require("@playwright/test");

// Release 949, from Zeth's iPhone: the unit pickers on Aerial Lift, Forklift and Telehandler were a
// <datalist> (iPhones only offer it above the keyboard), Forklift asked the questions before which unit
// and date, and the Harness details table scrolled sideways.
const supabaseOrigin = "https://xnrljkkszoimegfivlya.supabase.co";
const USER_ID = "00000000-0000-4000-8000-000000000949";
const PHONE = { width: 393, height: 852 };
const UNITS = [
  { id: "u1", name: "SkyJack Scissor Lift", identification_number: "3220", equipment_type: "Lift", current_hours: 412, is_active: true },
  { id: "u2", name: "Genie Aerial Boom Lift", identification_number: "Z-34/22", equipment_type: "Lift", current_hours: 1180, is_active: true },
  { id: "u3", name: "Toyota Forklift", identification_number: "FL-7", equipment_type: "Forklift", current_hours: 2301, is_active: true },
  { id: "u4", name: "JLG Telehandler", identification_number: "TH-2", equipment_type: "Telehandler", current_hours: 950, is_active: true }
];

async function signIn(page) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "inspections-949@johngordonconstruction.com", user_metadata: { display_name: "Inspection Phone" } };
  const auth = { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: USER_ID, exp: now + 3600, role: "authenticated" }), "inspections-949"].join("."), refresh_token: "inspections-949", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
  await page.addInitScript(({ auth }) => {
    localStorage.setItem("sb-xnrljkkszoimegfivlya-auth-token", JSON.stringify(auth));
    localStorage.setItem("currentWorker", "inspection phone");
    localStorage.setItem("currentWorkerDisplay", "Inspection Phone");
    localStorage.setItem("currentUserEmail", auth.user.email);
    localStorage.setItem("currentUserRole", "worker");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    localStorage.setItem("jgcPushOnboarding:v1:inspection phone", "dismissed");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { auth });
  await page.route(`${supabaseOrigin}/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    if (url.pathname.includes("/rest/v1/rpc/")) return route.fulfill({ status: 200, contentType: "application/json", body: "false" });
    const table = url.pathname.split("/rest/v1/")[1] || "";
    const rows = table === "equipment_vehicles" ? UNITS : [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
}

// The saved fields, as the page would store them (the dropdown itself is skipped).
const savedFields = page => page.evaluate(() => collectFields().filter(field => field.value));

for (const [name, url, inputId, label, pickLabel, check] of [
  ["Aerial Lift", "/aerial-lifts.html", "aerialLiftEquipment", "Lift ID #", "3220 - SkyJack Scissor Lift", { id: "#aerialLiftUnitType", value: "Scissor Lift" }],
  ["Forklift", "/forklift.html", "forkliftEquipment", "Forklift", "FL-7 - Toyota Forklift", { id: "#forkliftHours", value: "2301" }],
  ["Telehandler", "/tele-handler.html", "telehandlerEquipment", "Telehandler", "TH-2 - JLG Telehandler", { id: "#telehandlerHours", value: "950" }]
]) {
  test(`${name}: the unit is picked from a real dropdown, with a rented or other unit option`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await signIn(page);
    await page.goto(url, { waitUntil: "load" });
    const select = page.locator(`#${inputId}Select`);
    const box = page.locator(`#${inputId}`);
    await expect(select).toBeVisible();
    await expect(box).toBeHidden();
    expect(await box.getAttribute("list")).toBeNull();
    await expect(select.locator("option", { hasText: pickLabel })).toHaveCount(1);
    await expect(select.locator("option").last()).toHaveText("Rented or other unit");

    await select.selectOption(pickLabel);
    await expect(box).toHaveValue(pickLabel);
    await expect(box).toBeHidden();
    await expect(page.locator(check.id)).toHaveValue(check.value);
    expect(await savedFields(page)).toContainEqual({ label, value: pickLabel });

    await select.selectOption({ label: "Rented or other unit" });
    await expect(box).toBeVisible();
    await expect(box).toHaveValue("");
    await expect(box).toBeFocused();
    await box.fill("Sunbelt rental 55123");
    const fields = await savedFields(page);
    expect(fields).toContainEqual({ label, value: "Sunbelt rental 55123" });
    expect(fields.some(field => field.value === "__other__")).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
  });
}

test("Forklift: the forklift, site and date come before the checklist", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page);
  await page.goto("/forklift.html", { waitUntil: "load" });
  const details = await page.locator(".field-grid").boundingBox();
  const checklist = await page.locator(".inspection-mobile-list").first().boundingBox();
  expect(details.y + details.height).toBeLessThanOrEqual(checklist.y);
  const dateBox = await page.locator('.field-grid input[type="date"]').boundingBox();
  expect(dateBox.y).toBeLessThan(checklist.y);
});

test("Harness: the details stack on a phone with no sideways scrolling, and keep their saved names", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page);
  await page.goto("/harness.html", { waitUntil: "load" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
  const fields = page.locator(".field-grid--three .field");
  await expect(fields).toHaveCount(3);
  const boxes = await fields.evaluateAll(els => els.map(el => el.getBoundingClientRect()).map(r => ({ top: r.top, left: r.left, right: r.right })));
  expect(boxes[1].top).toBeGreaterThan(boxes[0].top);
  expect(boxes[2].top).toBeGreaterThan(boxes[1].top);
  for (const b of boxes) expect(b.right).toBeLessThanOrEqual(PHONE.width);

  await page.locator(".field-grid--three .field:nth-child(2) input").fill("HS-4471");
  await page.locator('.field-grid--three input[type="date"]').fill("2026-09-27");
  const saved = await savedFields(page);
  expect(saved).toContainEqual({ label: "Serial Number", value: "HS-4471" });
  expect(saved).toContainEqual({ label: "Date of Inspection", value: "2026-09-27" });
});

test("Previous Reports: a JSA's details read as plain text, without a literal <br>", async ({ page }) => {
  const recent = new Date(Date.now() - 5 * 86400000);
  const day = recent.toISOString().slice(0, 10);
  const jsa = {
    id: "jsa-949", inspection_type: "JSA", inspection_date: day, created_at: recent.toISOString(),
    worker_name: "inspection phone", worker_display_name: "Inspection Phone",
    form_data: { fields: [
      { label: "Company", value: "John Gordon Construction" },
      { label: "Project / Job", value: "26132 - McKay Mechanical - Ingleside Development" },
      { label: "Location", value: "Ingleside" },
      { label: "Hot work", value: "No" },
      { label: "Crew size", value: "4 & 1 apprentice" }
    ], rows: [] }
  };
  await page.setViewportSize(PHONE);
  await signIn(page);
  await page.route(`${supabaseOrigin}/rest/v1/inspection_records**`, route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([jsa]) }));
  await page.goto("/previous-inspections.html?recordType=reports", { waitUntil: "load" });
  const row = page.locator("tr", { hasText: "Inspection Phone" }).first();
  await expect(row).toContainText("Summary: Company: John Gordon Construction; Crew size: 4 & 1 apprentice");
  const html = await row.innerHTML();
  expect(html).not.toContain("&lt;br&gt;");
  expect(html).not.toContain("&amp;amp;");
  await expect(row).not.toContainText("Hot work");
});