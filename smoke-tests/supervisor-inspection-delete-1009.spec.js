const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

// Release 1009 (Zeth, 2026-10-07): supervisors read injury and accident reports, and an inspection's creator
// can delete it. The pages offer Delete only to the creator or an admin and say so when a delete is refused.
const portalRoot = path.resolve(__dirname, "..");
const supabaseOrigin = "https://xnrljkkszoimegfivlya.supabase.co";
const USER_ID = "00000000-0000-4000-8000-000000001009";
const migration = fs.readFileSync(path.join(portalRoot, "supabase/migrations/20261008150000_supervisors_and_inspection_deletes_1009.sql"), "utf8");

async function signIn(page, role, deleted, daysAgo) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "delete-1009@johngordonconstruction.com" };
  const auth = { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: USER_ID, exp: now + 3600, role: "authenticated" }), "delete-1009"].join("."), refresh_token: "delete-1009", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
  await page.addInitScript(({ auth, role }) => {
    localStorage.setItem("sb-xnrljkkszoimegfivlya-auth-token", JSON.stringify(auth));
    localStorage.setItem("currentWorker", "pat framer");
    localStorage.setItem("currentWorkerDisplay", "Pat Framer");
    localStorage.setItem("currentUserEmail", auth.user.email);
    localStorage.setItem("currentUserRole", role);
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    localStorage.setItem("jgcPushOnboarding:v1:pat framer", "dismissed");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { auth, role });
  const now2 = new Date(Date.now() - daysAgo * 86400000);
  const day = now2.toISOString().slice(0, 10);
  const record = (id, worker, display) => ({ id, inspection_type: "JSA", inspection_date: day, created_at: now2.toISOString(), worker_name: worker, worker_display_name: display,
    form_data: { fields: [{ label: "Project / Job", value: "26132 - Test Site" }], rows: [] } });
  const records = [record("own-1009", "pat framer", "Pat Framer"), record("other-1009", "sam other", "Sam Other")];
  await page.route(`${supabaseOrigin}/**`, route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    if (url.pathname.includes("/rest/v1/rpc/")) return route.fulfill({ status: 200, contentType: "application/json", body: "false" });
    if (url.pathname.endsWith("/rest/v1/inspection_records")) {
      if (request.method() === "DELETE") { deleted.push(url.searchParams.get("id")); return route.fulfill({ status: 200, contentType: "application/json", body: "[]" }); }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(records) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

// Previous Reports lists earlier days; Today's Reports lists today.
for (const [url, daysAgo] of [["/previous-inspections.html?recordType=reports", 5], ["/todays-inspections.html?recordType=reports", 0]]) {
  test(`${url.split("?")[0]}: Delete appears only on your own inspections and a refused delete is explained`, async ({ page }) => {
    const deleted = [], dialogs = [];
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, "worker", deleted, daysAgo);
    page.on("dialog", dialog => { dialogs.push(dialog.type() + ": " + dialog.message()); dialog.accept(); });
    await page.goto(url, { waitUntil: "load" });
    await expect(page.getByText("Sam Other").first()).toBeVisible();
    const buttons = page.locator(".delete-button");
    await expect(buttons).toHaveCount(1);
    await expect(page.locator(`.delete-button[onclick*="own-1009"]`)).toHaveCount(1);
    await expect(page.locator(`.delete-button[onclick*="other-1009"]`)).toHaveCount(0);
    // The database answers a refused delete with no rows; the page says why instead of silently reloading.
    await buttons.first().click();
    await expect.poll(() => dialogs.length).toBe(2);
    expect(dialogs).toEqual(["confirm: Delete this inspection?", "alert: Only the creator or an admin can delete this inspection."]);
    expect(deleted).toEqual(["eq.own-1009"]);
  });

  test(`${url.split("?")[0]}: an admin can delete anyone's inspection`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, "admin", [], daysAgo);
    await page.goto(url, { waitUntil: "load" });
    await expect(page.getByText("Sam Other").first()).toBeVisible();
    await expect(page.locator(".delete-button")).toHaveCount(2);
  });
}

test("the database: supervisors read injury and accident reports; creators or admins delete inspections", () => {
  expect(migration).toContain("p.account_status = 'approved' and p.role = 'supervisor'");
  for (const name of ["Admins, supervisors, the injured employee and the filer read injury reports", "Admins, supervisors, the injured worker and the filer read accident reports"]) {
    const start = migration.indexOf(`create policy "${name}"`);
    expect(start, name).toBeGreaterThan(-1);
    expect(migration.slice(start, migration.indexOf(";", start))).toContain("(select private.jgc_is_approved_supervisor())");
  }
  const board = migration.slice(migration.indexOf("function private.jgc_can_read_injury_report"));
  expect(board.match(/jgc_is_approved_supervisor\(\)/g)).toHaveLength(2);
  const remove = migration.slice(migration.indexOf('create policy "The creator or an admin deletes inspection records"'));
  expect(remove).toContain("for delete to authenticated");
  expect(remove).toContain("private.jgc_current_worker_matches(worker_name)");
  // Vehicle inspections stay admin-only to delete, and Previous Inspections only offers that to admins.
  expect(migration).not.toContain("vehicle_inspection_records");
  const previous = fs.readFileSync(path.join(portalRoot, "previous-inspections.html"), "utf8");
  expect(previous).toContain("record && !isVehicleInspectionRecord(record) && current.key");
});
