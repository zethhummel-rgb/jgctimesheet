const { test, expect } = require("@playwright/test");

const supabaseOrigin = "https://xnrljkkszoimegfivlya.supabase.co";
const ADMIN = { id: "00000000-0000-4000-8000-00000000a001", email: "zeth@johngordonconstruction.com", display_name: "Zeth Hummel", worker_key: "zeth hummel", role: "admin", account_status: "approved" };
const EMPLOYEE = { id: "00000000-0000-4000-8000-00000000e001", email: "pat.framer@example.com", display_name: "Pat Framer", worker_key: "pat framer", role: "worker", account_status: "approved" };
const OTHER = { id: "00000000-0000-4000-8000-00000000e002", email: "sam.other@example.com", display_name: "Sam Other", worker_key: "sam other", role: "worker", account_status: "approved" };
const JOBS = [
  { id: "job-1", job_number: "26142", customer: "Cornwall Electric", job_name: "New Control Room", job_type: "Contract", active: true },
  { id: "job-2", job_number: "26141", customer: "Via Rail Canada", job_name: "Property Inspection", job_type: "T&M", active: true }
];

const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
function session(person) {
  const now = Math.floor(Date.now() / 1000);
  const user = { id: person.id, aud: "authenticated", role: "authenticated", email: person.email, user_metadata: { display_name: person.display_name } };
  const token = [b64({ alg: "HS256", typ: "JWT" }), b64({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: person.id, email: person.email }), "writeup-test"].join(".");
  return { user, auth: { access_token: token, refresh_token: "writeup-refresh", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user } };
}

// In-memory stand-in for the migration: same visibility and versioning rules as the SQL functions.
function createBackend() {
  return { writeups: [], versions: [], acks: [], notifications: [] };
}

async function signIn(page, backend, person, theme = "light") {
  const state = session(person);
  await page.addInitScript(({ auth, person, theme }) => {
    localStorage.setItem("sb-xnrljkkszoimegfivlya-auth-token", JSON.stringify(auth));
    localStorage.setItem("currentWorker", person.worker_key);
    localStorage.setItem("currentWorkerDisplay", person.display_name);
    localStorage.setItem("currentUserEmail", person.email);
    localStorage.setItem("currentUserRole", person.role);
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    localStorage.setItem("jgcPortalTheme", theme);
    localStorage.setItem("jgcPortalTheme:" + person.id, theme);
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { auth: state.auth, person, theme });

  const isAdmin = person.role === "admin";
  const visible = w => isAdmin || (w.employee_profile_id === person.id && w.status !== "draft");
  const fail = (route, message, code = "P0001") => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code, message }) });

  await page.route(`${supabaseOrigin}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const params = url.searchParams;
    const single = String(request.headers().accept || "").includes("vnd.pgrst.object");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const eq = key => (params.get(key) || "").replace(/^eq\./, "");

    if (path.startsWith("/auth/v1/user")) return json(state.user);
    if (path.startsWith("/auth/v1/token")) return json(state.auth);
    if (path.endsWith("/rpc/is_admin")) return json(isAdmin);
    if (path.endsWith("/rpc/save_employee_writeup")) {
      if (!isAdmin) return fail(route, "Admin access required", "42501");
      const a = request.postDataJSON();
      const now = new Date().toISOString();
      let w = backend.writeups.find(x => x.id === a.p_id);
      const person2 = [EMPLOYEE, OTHER].find(p => p.id === a.p_employee);
      if (!w) {
        w = { id: a.p_id, employee_profile_id: person2.id, employee_name: person2.display_name, status: a.p_send ? "sent" : "draft", current_version: 1, incident_date: a.p_payload.incident_date, categories: a.p_payload.categories, created_by: ADMIN.id, created_by_name: ADMIN.display_name, created_at: now, updated_at: now, sent_at: a.p_send ? now : null };
        backend.writeups.push(w);
        const v = { writeup_id: w.id, version: 1, payload: a.p_payload, change_note: "", created_by_name: ADMIN.display_name, created_at: now, sent_at: a.p_send ? now : null };
        backend.versions.push(v);
        return json({ writeup: w, version: v, notify: a.p_send });
      }
      if (w.current_version !== a.p_expected_version) return fail(route, "This write-up changed elsewhere.", "40001");
      if (w.status === "draft") {
        const v = backend.versions.find(x => x.writeup_id === w.id && x.version === 1);
        Object.assign(v, { payload: a.p_payload, sent_at: a.p_send ? now : null });
        Object.assign(w, { status: a.p_send ? "sent" : "draft", sent_at: a.p_send ? now : null, updated_at: now });
        return json({ writeup: w, version: v, notify: a.p_send });
      }
      if (!a.p_change_note) return fail(route, "Explain what changed");
      const v = { writeup_id: w.id, version: w.current_version + 1, payload: a.p_payload, change_note: a.p_change_note, created_by_name: ADMIN.display_name, created_at: now, sent_at: now };
      backend.versions.push(v);
      Object.assign(w, { current_version: v.version, status: "sent", acknowledged_at: null, updated_at: now });
      return json({ writeup: w, version: v, notify: true });
    }
    if (path.endsWith("/rpc/acknowledge_employee_writeup")) {
      const a = request.postDataJSON();
      const w = backend.writeups.find(x => x.id === a.p_id);
      if (!w || w.employee_profile_id !== person.id || w.status === "draft") return fail(route, "Write-up not found", "42501");
      if (a.p_version !== w.current_version) return fail(route, "updated", "40001");
      const ack = { id: "ack-" + backend.acks.length, writeup_id: w.id, version: a.p_version, employee_profile_id: person.id, printed_name: a.p_printed_name, signature: a.p_signature, employee_comment: a.p_comment, acknowledged_at: new Date().toISOString() };
      backend.acks.push(ack);
      Object.assign(w, { status: "acknowledged", acknowledged_at: ack.acknowledged_at });
      return json({ writeup: w, acknowledgement: ack, notify: true });
    }
    if (path.endsWith("/rpc/void_employee_writeup")) {
      const a = request.postDataJSON();
      const w = backend.writeups.find(x => x.id === a.p_id);
      Object.assign(w, { status: "voided", voided_at: new Date().toISOString(), void_reason: a.p_reason });
      return json(w);
    }
    if (path.includes("/rpc/")) return json(null);
    if (path.endsWith("/employee_writeups")) {
      let rows = backend.writeups.filter(visible);
      if (params.get("id")) rows = rows.filter(w => w.id === eq("id"));
      if (params.get("employee_profile_id")) rows = rows.filter(w => w.employee_profile_id === eq("employee_profile_id"));
      if (params.get("status")) rows = rows.filter(w => w.status === eq("status"));
      return json(single ? rows[0] || null : rows);
    }
    if (path.endsWith("/employee_writeup_versions")) {
      const w = backend.writeups.find(x => x.id === eq("writeup_id"));
      return json(w && visible(w) ? backend.versions.filter(v => v.writeup_id === w.id && (isAdmin || v.sent_at)) : []);
    }
    if (path.endsWith("/employee_writeup_acknowledgements")) {
      return json(backend.acks.filter(a => a.writeup_id === eq("writeup_id") && (isAdmin || a.employee_profile_id === person.id)));
    }
    if (path.endsWith("/notifications") && request.method() === "POST") {
      const rows = [].concat(request.postDataJSON()).map((row, i) => ({ ...row, id: "n-" + backend.notifications.length + "-" + i }));
      backend.notifications.push(...rows);
      return json(rows, 201);
    }
    if (path.endsWith("/profiles")) {
      if (single) return json(person);
      if (params.get("role") === "eq.admin") return json([ADMIN]);
      return json(isAdmin ? [ADMIN, EMPLOYEE, OTHER] : [person]);
    }
    if (path.endsWith("/jobs")) return json(JOBS);
    return json(single ? null : []);
  });
}

async function createWriteUp(page, { manual = false, send = true } = {}) {
  await page.getByRole("button", { name: "New write-up", exact: true }).click();
  await page.locator("#writeupEmployee").selectOption({ label: EMPLOYEE.display_name });
  await page.getByRole("checkbox", { name: "PPE / harness violation" }).check();
  await page.getByRole("checkbox", { name: "Other / custom issue" }).check();
  await page.locator("#writeupCustom").fill("Left ladder unsecured");
  await page.locator("#writeupDate").fill("2026-09-22");
  if (manual) {
    await page.getByRole("radio", { name: "Enter a location" }).check();
    await page.locator("#writeupLocation").fill("Yard at 111 Water St");
  } else {
    await page.locator("#writeupJob").fill("26142 — Cornwall Electric — New Control Room — Contract");
  }
  await page.locator("#writeupDescription").fill("Worked at height on the mezzanine without a harness at 10:15.");
  await page.locator("#writeupAction").fill("Stopped work and reviewed fall protection with the foreman.");
  await page.locator("#writeupExpectations").fill("Harness and tie-off whenever above 3 m.");
  await page.locator("#writeupFollowDate").fill("2026-10-06");
  await page.getByRole("button", { name: send ? "Send to employee" : "Save draft", exact: true }).click();
}

test("admin records a write-up, validates it, notifies the employee and downloads a branded PDF", async ({ page }) => {
  const backend = createBackend();
  await signIn(page, backend, ADMIN);
  await page.goto("/employee-writeups-admin.html", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New write-up", exact: true }).click();
  await page.getByRole("button", { name: "Send to employee", exact: true }).click();
  const error = page.locator("#writeupFormError");
  await expect(error).toContainText("Choose the employee.");
  await expect(error).toContainText("Choose at least one issue type.");
  await expect(error).toContainText("Enter the factual description.");
  expect(backend.writeups).toHaveLength(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await createWriteUp(page);
  await expect(page.locator("#writeupDetailStatus")).toHaveText("Sent. The employee was notified.");
  const body = page.locator("#writeupDetailBody");
  await expect(body).toContainText("Awaiting acknowledgment");
  await expect(body).toContainText("PPE / harness violation, Other: Left ladder unsecured");
  await expect(body).toContainText("26142 — Cornwall Electric — New Control Room — Contract");
  const [saved] = backend.writeups;
  expect(saved).toMatchObject({ employee_profile_id: EMPLOYEE.id, status: "sent" });
  expect(backend.versions[0].payload).toMatchObject({ location_mode: "job", job: { job_number: "26142" }, follow_up_date: "2026-10-06" });
  const note = backend.notifications.find(n => n.target_profile_id === EMPLOYEE.id);
  expect(note).toMatchObject({ notification_type: "employee_writeup", title: "Document to review", link_url: "employee-writeups.html?id=" + saved.id });
  expect(JSON.stringify(note)).not.toContain("harness");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("JGC-Write-Up-Pat-Framer-2026-09-22-v1.pdf");
  const bytes = require("fs").readFileSync(await file.path());
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  expect(bytes.length).toBeGreaterThan(20000);
});

test("drafts stay private to admins, and the employee acknowledges with a signature and comment", async ({ browser }, testInfo) => {
  const backend = createBackend();
  const adminPage = await (await browser.newContext()).newPage();
  await signIn(adminPage, backend, ADMIN);
  await adminPage.goto("/employee-writeups-admin.html", { waitUntil: "domcontentloaded" });
  await createWriteUp(adminPage, { manual: true, send: false });
  await expect(adminPage.locator("#writeupDetailBody")).toContainText("Draft");
  expect(backend.notifications.filter(n => n.notification_type === "employee_writeup")).toHaveLength(0);
  const id = backend.writeups[0].id;

  const employeeContext = await browser.newContext();
  const employee = await employeeContext.newPage();
  await signIn(employee, backend, EMPLOYEE);
  await employee.goto("/employee-writeups.html", { waitUntil: "domcontentloaded" });
  await expect(employee.locator("#myWriteupsStatus")).toHaveText("You have no write-ups.");

  await adminPage.getByRole("button", { name: "Edit draft", exact: true }).click();
  await adminPage.getByRole("button", { name: "Send to employee", exact: true }).click();
  await expect(adminPage.locator("#writeupDetailStatus")).toHaveText("Sent. The employee was notified.");

  await employee.goto("/employee-writeups.html?id=" + id, { waitUntil: "domcontentloaded" });
  const ack = employee.getByRole("region", { name: "Acknowledge this write-up" });
  await expect(ack).toContainText("It does not necessarily mean I agree with it.");
  await expect(employee.locator("#myWriteupBody")).toContainText("Yard at 111 Water St");
  await ack.getByLabel(/^Your comments/).fill("I had the harness in the truck.");
  await ack.getByRole("button", { name: "Sign to acknowledge", exact: true }).click();
  const pad = employee.locator(".safety-signature-pad");
  const box = await pad.boundingBox();
  await employee.mouse.move(box.x + 20, box.y + 40); await employee.mouse.down();
  await employee.mouse.move(box.x + 120, box.y + 80, { steps: 8 }); await employee.mouse.move(box.x + 200, box.y + 30, { steps: 8 }); await employee.mouse.up();
  await employee.getByRole("button", { name: "Confirm signature", exact: true }).click();
  await expect(employee.locator("#myWriteupStatus")).toHaveText("Thank you. Your acknowledgment was recorded.");
  await expect(ack).toBeHidden();
  await expect(employee.locator("#myWriteupBody")).toContainText("Acknowledged");
  await expect(employee.locator("#myWriteupBody img.writeup-signature")).toBeVisible();
  expect(backend.acks[0]).toMatchObject({ version: 1, printed_name: EMPLOYEE.display_name, employee_comment: "I had the harness in the truck." });
  expect(backend.acks[0].signature.length).toBeGreaterThan(0);
  expect(backend.notifications.some(n => n.target_profile_id === ADMIN.id && n.title === "Write-up acknowledged")).toBe(true);

  await adminPage.reload({ waitUntil: "domcontentloaded" });
  await adminPage.getByRole("button", { name: "Correct & resend", exact: true }).click();
  await expect(adminPage.locator("#writeupEmployee")).toBeDisabled();
  await adminPage.locator("#writeupExpectations").fill("Harness and tie-off whenever above 3 m, checked at start of shift.");
  await adminPage.getByRole("button", { name: "Send correction to employee", exact: true }).click();
  await expect(adminPage.locator("#writeupFormError")).toContainText("Explain what changed.");
  await adminPage.locator("#writeupChange").fill("Added start-of-shift check");
  await adminPage.getByRole("button", { name: "Send correction to employee", exact: true }).click();
  await expect(adminPage.locator("#writeupDetailBody")).toContainText("Version 2");
  await expect(adminPage.locator("#writeupDetailBody")).toContainText("Change: Added start-of-shift check");
  await expect(adminPage.locator("#writeupDetailBody")).toContainText("Acknowledged");

  await employee.reload({ waitUntil: "domcontentloaded" });
  await expect(ack).toBeVisible();
  await expect(employee.locator("#myWriteupBody")).toContainText("checked at start of shift");

  const pdfDownload = adminPage.waitForEvent("download");
  await adminPage.getByRole("button", { name: "Download PDF", exact: true }).click();
  await (await pdfDownload).saveAs(testInfo.outputPath("writeup-v2.pdf"));
  await adminPage.getByRole("button", { name: "Void", exact: true }).click();
  await adminPage.getByRole("button", { name: "Void write-up", exact: true }).click();
  await expect(adminPage.locator("#writeupVoidError")).toHaveText("Enter the reason for voiding.");
  await adminPage.locator("#writeupVoidReason").fill("Issued to the wrong crew member");
  await adminPage.getByRole("button", { name: "Void write-up", exact: true }).click();
  await expect(adminPage.locator("#writeupDetailBody")).toContainText("Issued to the wrong crew member");
  await employeeContext.close();
});

test("other employees cannot see a write-up and non-admins cannot open the admin page", async ({ browser }) => {
  const backend = createBackend();
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, backend, ADMIN);
  await admin.goto("/employee-writeups-admin.html", { waitUntil: "domcontentloaded" });
  await createWriteUp(admin);
  const id = backend.writeups[0].id;
  const other = await (await browser.newContext()).newPage();
  await signIn(other, backend, OTHER);
  await other.goto("/employee-writeups.html?id=" + id, { waitUntil: "domcontentloaded" });
  await expect(other.locator("#myWriteupBody")).toContainText("could not be found");
  await other.goto("/employee-writeups-admin.html", { waitUntil: "domcontentloaded" });
  await expect(other.locator("#writeupsStatus")).toContainText("approved administrators only");
  await expect(other.locator("#writeupsControls")).toBeHidden();
});

for (const theme of ["light", "dark"]) for (const width of [390, 1440]) {
  test(`write-up pages are readable and contained ${theme} ${width}`, async ({ browser }, testInfo) => {
    const backend = createBackend();
    const admin = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
    await signIn(admin, backend, ADMIN, theme);
    await admin.goto("/employee-writeups-admin.html", { waitUntil: "domcontentloaded" });
    await admin.getByRole("button", { name: "New write-up", exact: true }).click();
    await admin.getByRole("checkbox", { name: "Lateness / attendance" }).check();
    const shell = await admin.locator(".jgc-page-shell").boundingBox();
    expect(Math.abs(shell.x - (width - shell.x - shell.width)), "form is centred in the page shell").toBeLessThanOrEqual(2);
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const formContrast = await admin.locator("#writeupForm :is(.jgc-label, .writeups-step, .writeup-chip span, .writeup-toggle .jgc-tab span, .jgc-help-text, .jgc-button)").evaluateAll(elements => {
      const parse = c => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const background = el => { for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c.slice(0, 3); } return [255, 255, 255]; };
      return elements.filter(el => el.getClientRects().length).map(el => { const a = lum(parse(getComputedStyle(el).color).slice(0, 3)), b = lum(background(el)); return { text: el.textContent.trim().slice(0, 30), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }; });
    });
    expect(formContrast.length).toBeGreaterThan(20);
    for (const sample of formContrast) expect(sample.ratio, theme + " form " + sample.text).toBeGreaterThanOrEqual(4.5);
    await admin.screenshot({ path: testInfo.outputPath("admin-form.png"), fullPage: true });
    await admin.getByRole("button", { name: "Cancel", exact: true }).click();
    await createWriteUp(admin);
    await expect(admin.locator("#writeupDetailBody")).toContainText("Awaiting acknowledgment");
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    for (const button of await admin.locator("#writeupDetailActions .jgc-button").all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(40);
    const voidButton = await admin.getByRole("button", { name: "Void", exact: true }).evaluate(el => { const p = c => (c.match(/[\d.]+/g) || []).map(Number); const l = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0); const s = getComputedStyle(el); const a = l(p(s.color)), b = l(p(s.backgroundColor)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); });
    expect(voidButton, theme + " Void button contrast").toBeGreaterThanOrEqual(4.5);
    await admin.screenshot({ path: testInfo.outputPath("admin-detail.png"), fullPage: true });
    const employee = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
    await signIn(employee, backend, EMPLOYEE, theme);
    await employee.goto("/employee-writeups.html?id=" + backend.writeups[0].id, { waitUntil: "domcontentloaded" });
    await expect(employee.getByRole("region", { name: "Acknowledge this write-up" })).toBeVisible();
    await expect(employee.locator("#myWriteupsList")).toBeHidden();
    expect(await employee.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const contrast = await employee.locator(".writeup-section h3, .writeup-row span, .writeup-row p, .writeup-ack-statement, .jgc-badge, .jgc-button").evaluateAll(elements => {
      const parse = c => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const background = el => { for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c.slice(0, 3); } return [255, 255, 255]; };
      return elements.filter(el => el.getClientRects().length).map(el => { const a = lum(parse(getComputedStyle(el).color).slice(0, 3)), b = lum(background(el)); return { text: el.textContent.trim().slice(0, 30), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }; });
    });
    for (const sample of contrast) expect(sample.ratio, theme + " " + sample.text).toBeGreaterThanOrEqual(4.5);
    await employee.screenshot({ path: testInfo.outputPath("employee-detail.png"), fullPage: true });
  });
}

test("write-ups are reachable from the phone More menu, the employee Home page and employee search", async ({ browser }) => {
  const backend = createBackend();
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const admin = await adminContext.newPage();
  await signIn(admin, backend, ADMIN);
  await admin.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
  await admin.getByRole("button", { name: /More/ }).last().click();
  await expect(admin.getByRole("link", { name: "Write-Ups", exact: true })).toHaveAttribute("href", "employee-writeups-admin.html");
  await admin.goto("/employee-writeups-admin.html", { waitUntil: "domcontentloaded" });
  await createWriteUp(admin);
  await adminContext.close();

  const employeeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const employee = await employeeContext.newPage();
  await signIn(employee, backend, EMPLOYEE);
  await employee.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
  await employee.getByRole("button", { name: /More/ }).last().click();
  await expect(employee.getByRole("link", { name: "My Write-Ups", exact: true })).toHaveAttribute("href", "employee-writeups.html");

  await employee.setViewportSize({ width: 1280, height: 900 });
  await employee.goto("/home.html", { waitUntil: "domcontentloaded" });
  const reminder = employee.locator("#writeupsReminder");
  await expect(reminder).toBeVisible({ timeout: 10000 });
  await expect(reminder).toContainText("You have a document to review");
  await expect(reminder).not.toContainText("harness");
  await expect(employee.getByRole("button", { name: "My Write-Ups", exact: true })).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await employee.evaluate(value => document.documentElement.setAttribute("data-jgc-theme", value), theme);
    const ratio = await reminder.locator(".vacation-reminder-text, button").evaluateAll(elements => elements.map(el => {
      const parse = c => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const back = n => { for (; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length === 3 || c[3] > 0.9) return c.slice(0, 3); const img = getComputedStyle(n).backgroundImage.match(/rgba?\([^)]*\)/); if (img) return parse(img[0]).slice(0, 3); } return [255, 255, 255]; };
      const a = lum(parse(getComputedStyle(el).color).slice(0, 3)), b = lum(back(el));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }));
    for (const value of ratio) expect(value, theme + " reminder contrast").toBeGreaterThanOrEqual(4.5);
    await employee.screenshot({ path: test.info().outputPath(`home-reminder-${theme}.png`) });
  }
  await employee.getByRole("button", { name: "Review", exact: true }).click();
  await expect(employee).toHaveURL(/employee-writeups\.html$/);
  await employeeContext.close();

  const other = await (await browser.newContext()).newPage();
  await signIn(other, backend, OTHER);
  await other.goto("/home.html", { waitUntil: "domcontentloaded" });
  await other.waitForTimeout(2500);
  await expect(other.locator("#writeupsReminder")).toBeHidden();

  const fs = require("fs"), path = require("path");
  expect(fs.readFileSync(path.join(__dirname, "../admin-global-search.js"), "utf8")).toContain('href: "employee-writeups.html"');
});
