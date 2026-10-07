const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

// Release 1002: forms save only as a signed-in account (the anonymous insert policies are gone). When a page is
// still open after the login quietly expired, the form says so plainly and keeps the entries.
const portalRoot = path.resolve(__dirname, "..");
const ORIGIN = "https://xnrljkkszoimegfivlya.supabase.co";
const MESSAGE = "You're signed out, so this wasn't saved. Your entries are still here. Sign in to the Portal in a new tab, then come back and save again.";

function storedSession() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const user = { id: "00000000-0000-4000-8000-000000001002", aud: "authenticated", role: "authenticated", email: "signed-in@example.test" };
  return { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: user.id, role: "authenticated", aud: "authenticated", exp: now + 3600 }), "fixture"].join("."), refresh_token: "fixture-refresh", token_type: "bearer", expires_at: now + 3600, expires_in: 3600, user };
}

// The page still remembers the employee, but there is no Supabase login behind it.
async function openSignedOut(page, url, options = {}) {
  const writes = [];
  await page.addInitScript(({ session }) => {
    localStorage.setItem("currentWorker", "pat framer");
    localStorage.setItem("currentWorkerDisplay", "Pat Framer");
    localStorage.setItem("currentUserRole", "worker");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    sessionStorage.setItem("jgcActiveSession", "true");
    if (session) localStorage.setItem("sb-xnrljkkszoimegfivlya-auth-token", JSON.stringify(session));
  }, { session: options.session || null });
  await page.route(ORIGIN + "/**", (route) => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() !== "GET" && /^\/(rest\/v1\/incident_reports|storage\/v1\/object)/.test(url.pathname)) writes.push(request.method() + " " + url.pathname);
    if (url.pathname.startsWith("/auth/v1/user")) return route.fulfill({ status: 401, json: { message: "No authenticated session" } });
    return route.fulfill({ json: [] });
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return writes;
}

test("isJgcSignedOut: no login is signed out; a stored login or no connection is not", async ({ page, context }) => {
  await openSignedOut(page, "/incident-report.html");
  expect(await page.evaluate(() => isJgcSignedOut(createJgcSupabaseClient()))).toBe(true);
  expect(await page.evaluate(() => JGC_SIGNED_OUT_SAVE_MESSAGE)).toBe(MESSAGE);
  await context.setOffline(true);
  expect(await page.evaluate(() => isJgcSignedOut(createJgcSupabaseClient()))).toBe(false);
  await context.setOffline(false);

  const signedIn = await context.newPage();
  await openSignedOut(signedIn, "/incident-report.html", { session: storedSession() });
  expect(await signedIn.evaluate(() => isJgcSignedOut(createJgcSupabaseClient()))).toBe(false);
});

test("a signed-out incident report is not sent and keeps every entry", async ({ page }) => {
  const writes = await openSignedOut(page, "/incident-report.html");
  await page.locator("#reportDate").fill("2026-10-07");
  // The project box sits behind the job picker; set its value as a picked job would.
  await page.locator("#project").evaluate((input) => { input.value = "Job 26142 Synthetic site"; });
  await page.locator("#location").fill("North stairwell");
  await page.locator("#description").fill("Synthetic near miss with a dropped tool.");
  await page.getByRole("button", { name: "Save & Email Report" }).click();

  await expect(page.locator("#saveStatus")).toHaveText(MESSAGE);
  expect(writes).toEqual([]);
  await expect(page.locator("#project")).toHaveValue("Job 26142 Synthetic site");
  await expect(page.locator("#location")).toHaveValue("North stairwell");
  await expect(page.locator("#description")).toHaveValue("Synthetic near miss with a dropped tool.");
});

// Every form that saves straight to a table checks the login first (after any offline handling).
for (const [file, start, before] of [
  ["accident-report.js", "async function submitAccidentReport", 'from("accident_reports").insert('],
  ["employee-injury-report.js", 'form.addEventListener("submit"', 'from("employee_injury_reports").insert('],
  ["incident-report.html", "async function submitIncidentReport", "await finishIncidentReport(baseRecord)"],
  ["toolbox-talks.html", 'const reportQuery = isExistingReport', null],
  ["inspection-records.js", "async function saveInspection", "await persistInspectionRecord(prepared.record)"]
]) {
  test(`${file} checks the login before saving`, () => {
    const source = fs.readFileSync(path.join(portalRoot, file), "utf8");
    if (before === null) {
      // Toolbox talk: the check sits at the top of the save, before the duplicate lookup and the insert.
      const check = source.indexOf("isJgcSignedOut(supabaseClient)"), lookup = source.indexOf("await findMatchingToolboxReport(record)"), insert = source.indexOf(start);
      expect(check).toBeGreaterThan(-1);
      expect(check).toBeLessThan(lookup);
      expect(lookup).toBeLessThan(insert);
      return;
    }
    const from = source.indexOf(start), check = source.indexOf("isJgcSignedOut(", from), save = source.indexOf(before, from);
    expect(from).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(from);
    expect(save).toBeGreaterThan(check);
    if (file === "inspection-records.js") {
      // Offline saves still queue on the device first; the login check only applies to a live save.
      expect(source.indexOf("queueInspectionRecord(prepared.record, worker)", from)).toBeLessThan(check);
    }
  });
}

test("no Portal page relies on the removed anonymous policies", () => {
  const migration = fs.readFileSync(path.join(portalRoot, "supabase", "migrations", "20261007220000_remove_anonymous_form_saves_1002.sql"), "utf8");
  for (const table of ["inspection_records", "incident_reports", "accident_reports", "accident_report_acknowledgements", "employee_injury_reports", "employee_injury_acknowledgements", "toolbox_talk_reports", "toolbox_talk_attendance", "safety_acknowledgements", "toolbox_talks"]) {
    expect(migration).toMatch(new RegExp(`drop policy if exists "Anonymous users can [^"]+" on public\\.${table};`));
  }
  expect(migration).not.toMatch(/\bto\s+anon\b|anon,/i);
  // The public QR pages only use SECURITY DEFINER functions, never these tables directly.
  for (const file of ["acknowledge.html", "equipment-inspection.html", "job-board.js"]) {
    const source = fs.readFileSync(path.join(portalRoot, file), "utf8");
    expect(source, file).not.toMatch(/\.from\(["'](inspection_records|incident_reports|accident_reports|employee_injury_reports|toolbox_talk_reports|toolbox_talk_attendance|safety_acknowledgements)["']\)\s*\.(insert|upsert)/);
  }
});
