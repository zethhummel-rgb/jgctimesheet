const { test, expect } = require("@playwright/test");

// Release 950: the Job Note editor redesign Zeth approved (mockup 2026-09-27). The job box is the shared
// job picker (locks, X removes), people and reminders show as chips, the checklist has a done count, a
// quantity pill and a quiet remove X, and the bottom bar is delete icon + Save and close + Complete.
const supabaseOrigin = "https://xnrljkkszoimegfivlya.supabase.co";
const USER_ID = "00000000-0000-4000-8000-000000000950";
const PHONE = { width: 393, height: 852 };
const JOBS = [
  { id: "job-25169", customer: "McKay Mechanical", job_number: "25169", job_name: "McKay Office Addition", job_type: "T&M", active: true },
  { id: "job-26132", customer: "McKay Mechanical", job_number: "26132", job_name: "Ingleside Development", job_type: "Contract", active: true }
];
const WORKERS = [
  { id: "w-me", profile_id: USER_ID, display_name: "Note Tester", worker_key: "note tester", approved: true },
  { id: "w-andre", profile_id: "00000000-0000-4000-8000-000000000951", display_name: "Andre Labrosse", worker_key: "andre labrosse", approved: true }
];
const SAVED_LIST = {
  id: "list-950", job_id: "job-25169", job_number: "25169", job_name: "McKay Office Addition", title: "Level 2 punch list",
  status: "open", created_by: USER_ID, created_by_name: "Note Tester", created_at: "2026-09-20T12:00:00.000Z", updated_at: "2026-09-20T12:00:00.000Z", deleted_at: null
};

async function setup(page, { lists = [], items = [], members = [] } = {}) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "note-tester@johngordonconstruction.com", user_metadata: { display_name: "Note Tester" } };
  const auth = { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: USER_ID, exp: now + 3600, role: "authenticated" }), "notes-950"].join("."), refresh_token: "notes-950", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
  const profile = { id: USER_ID, email: user.email, display_name: "Note Tester", worker_key: "note tester", role: "worker", account_status: "approved", approved: true };
  const calls = [];
  await page.addInitScript(({ auth }) => {
    localStorage.setItem("jgcPortalTheme", "light");
    localStorage.setItem("sb-xnrljkkszoimegfivlya-auth-token", JSON.stringify(auth));
    localStorage.setItem("currentWorker", "note tester");
    localStorage.setItem("currentWorkerDisplay", "Note Tester");
    localStorage.setItem("currentUserEmail", auth.user.email);
    localStorage.setItem("currentUserRole", "worker");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    localStorage.setItem("jgcPushOnboarding:v1:note tester", "dismissed");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { auth });
  await page.route(`${supabaseOrigin}/**`, route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    if (url.pathname.includes("/rest/v1/rpc/")) return route.fulfill({ status: 200, contentType: "application/json", body: "false" });
    const table = url.pathname.split("/rest/v1/")[1] || "";
    if (request.method() !== "GET") {
      calls.push({ table, method: request.method(), body: request.postDataJSON ? request.postDataJSON() : null });
      const body = request.postDataJSON() || {};
      const row = Array.isArray(body) ? body : Object.assign({ id: "saved-" + table, status: "open" }, SAVED_LIST, body);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(row) });
    }
    const single = String(request.headers().accept || "").includes("vnd.pgrst.object");
    const rows = {
      profiles: [profile], jobs: JOBS, work_order_labour_workers: WORKERS,
      employee_feature_access: WORKERS.map(worker => ({ worker_id: worker.id, feature_key: "job_notes", enabled: true })),
      job_lists: lists, job_list_members: members, job_list_items: items, job_list_reminders: []
    }[table] || [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(single ? (rows[0] || null) : rows) });
  });
  return calls;
}

test("a new note picks its job from the shared job picker, which locks until the X removes it", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await setup(page);
  await page.goto("/job-lists.html", { waitUntil: "load" });
  await page.locator("#jobListsNewButton").click();
  const search = page.locator("#jobListJobSearch");
  const clear = page.locator("#jobListJobClear");
  await search.click();
  const options = page.locator("#jobListJobOptions .jgc-job-option");
  await expect(options).toHaveCount(2);
  await expect(options.first().locator(".jgc-job-option__client")).toHaveText("McKay Mechanical");
  await search.fill("Ingleside");
  await expect(options).toHaveCount(1);
  await options.first().click();
  await expect(page.locator("#jobListJob")).toHaveValue("job-26132");
  await expect(search).toHaveValue("26132 - McKay Mechanical - Ingleside Development - Contract");
  await expect(search).not.toBeEditable();
  await expect(clear).toBeVisible();

  await clear.click();
  await expect(page.locator("#jobListJob")).toHaveValue("");
  await expect(search).toHaveValue("");
  await expect(search).toBeEditable();
  await expect(options).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
});

test("people and reminders show as chips, and the checklist counts what's done", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await setup(page);
  await page.goto("/job-lists.html", { waitUntil: "load" });
  await page.locator("#jobListsNewButton").click();
  const chips = page.locator("#jobListOptionsSummary .job-list-option-chip");
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toHaveText("People and reminders");

  await page.locator("#jobListOptions > summary").click();
  await page.locator("#jobListMembers label", { hasText: "Andre Labrosse" }).locator("input").check();
  const reminder = page.locator("#jobListReminder");
  await reminder.fill("2030-07-26T07:00");
  await reminder.dispatchEvent("change");
  await expect(chips).toHaveCount(3);
  await expect(chips.nth(0)).toHaveText("Andre Labrosse");
  await expect(chips.nth(1)).toContainText("2030");
  await expect(chips.nth(2)).toHaveText("Edit");

  const first = page.locator('[data-job-list-item-input="0"]');
  await first.fill("Patch drywall at stair");
  await first.press("Enter");
  await page.locator('[data-job-list-item-input="1"]').fill("Ceiling tiles, room 204");
  await expect(page.locator("#jobListChecklistCount")).toHaveText("· 0 of 2 done");
  await page.locator('[data-job-list-edit-toggle="0"]').click();
  await expect(page.locator("#jobListChecklistCount")).toHaveText("· 1 of 2 done");

  // Quantity is a small pill after the item; remove is a quiet X at the end of the row.
  const row = page.locator(".job-list-item-edit-row").nth(1);
  const [text, qty, remove] = await Promise.all([
    row.locator("[data-job-list-item-input]").boundingBox(),
    row.locator("[data-job-list-item-quantity]").boundingBox(),
    row.locator("[data-job-list-remove-item]").boundingBox()
  ]);
  expect(qty.x).toBeGreaterThan(text.x);
  expect(remove.x).toBeGreaterThan(qty.x);
  await expect(row.locator("[data-job-list-item-quantity]")).toHaveAttribute("placeholder", "Qty");
  expect(await row.locator("[data-job-list-remove-item]").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");

  // A new note: no Complete or Delete, and Save and close is the one green button.
  await expect(page.locator("#jobListComplete")).toBeHidden();
  await expect(page.locator("#jobListDelete")).toBeHidden();
  await expect(page.locator("#jobListSave")).not.toHaveClass(/jgc-button--secondary/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
});

test("a saved note keeps its job, and the delete icon deletes the open note after confirming", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const calls = await setup(page, {
    lists: [SAVED_LIST],
    items: [{ id: "item-1", list_id: "list-950", item_text: "FRP corner trim", quantity: 4, position: 0, completed: false, created_at: "2026-09-20T12:01:00.000Z" }],
    members: [{ id: "m-1", list_id: "list-950", profile_id: USER_ID, display_name: "Note Tester" }]
  });
  await page.goto("/job-lists.html?list=list-950", { waitUntil: "load" });
  await expect(page.locator("#jobListsModal")).toBeVisible();
  await expect(page.locator("#jobListJobSearch")).toHaveValue("25169 - McKay Mechanical - McKay Office Addition - T&M");
  await expect(page.locator("#jobListJobSearch")).not.toBeEditable();
  // A saved note's job can't change, so there is no X.
  await expect(page.locator("#jobListJobClear")).toBeHidden();
  await expect(page.locator("#jobListComplete")).toBeVisible();
  await expect(page.locator("#jobListSave")).toHaveClass(/jgc-button--secondary/);

  const dialogs = [];
  page.on("dialog", dialog => { dialogs.push(dialog.message()); dialog.accept(); });
  await page.locator("#jobListDelete").click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain("Level 2 punch list");
  await expect.poll(() => calls.some(call => call.table.startsWith("job_lists") && call.method === "PATCH" && call.body && call.body.deleted_at)).toBe(true);
  await expect(page.locator("#jobListsModal")).toBeHidden();
});
