const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const { test, expect } = require("@playwright/test");

// Release 1005: security fixes from the 2026-10-03 repository scan (batch 1). The database half is in
// supabase/migrations/20261008090000_security_batch_1005.sql (rehearsed and checked against production).
const portalRoot = path.resolve(__dirname, "..");
const ORIGIN = "https://xnrljkkszoimegfivlya.supabase.co";
const NOTIFICATION_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const read = (file) => fs.readFileSync(path.join(portalRoot, file), "utf8");

// The notifications table check (notifications_link_url_safe), as a JavaScript pattern.
const DATABASE_LINK_RULE = /^(https:\/\/\S+|[A-Za-z0-9][A-Za-z0-9._/-]*([?#]\S*)?)$/;

async function openSignedIn(page, url) {
  const requests = [];
  await page.addInitScript(() => {
    localStorage.setItem("currentWorker", "pat framer");
    localStorage.setItem("currentWorkerDisplay", "Pat Framer");
    localStorage.setItem("currentUserRole", "worker");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    sessionStorage.setItem("jgcActiveSession", "true");
  });
  await page.route(ORIGIN + "/**", (route) => {
    requests.push(route.request().method() + " " + new URL(route.request().url()).pathname);
    return route.fulfill({ json: [] });
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return requests;
}

test("notification links open Portal pages and https addresses only", async ({ page }) => {
  await openSignedIn(page, "/incident-report.html");
  const cases = [
    ["schedule.html", "schedule.html"],
    ["/home.html", "home.html"],
    ["admin.html?tab=summary#notices", "admin.html?tab=summary#notices"],
    ["purchase-orders.html?po=" + NOTIFICATION_ID, "purchase-orders.html?po=" + NOTIFICATION_ID],
    ["employee-writeups.html?id=a%20b", "employee-writeups.html?id=a%20b"],
    ["https://example.com/plan.pdf", "https://example.com/plan.pdf"],
    ["javascript:alert(1)", ""],
    [" JavaScript:alert(1)", ""],
    ["data:text/html,hello", ""],
    ["vbscript:msgbox", ""],
    ["http://example.com/", ""],
    ["", ""],
    [null, ""]
  ];
  const results = await page.evaluate((links) => links.map((link) => getJgcNotificationHref(link)), cases.map(([link]) => link));
  expect(results).toEqual(cases.map(([, expected]) => expected));
});

test("clicking a notification with an unsafe link stays on the page; a Portal link still opens", async ({ page }) => {
  await openSignedIn(page, "/incident-report.html");
  const before = page.url();
  await page.evaluate(async (id) => {
    jgcNotificationRecords = [{ id, notification_type: "test", link_url: "javascript:window.__jgcLinkRan=1" }];
    await handleJgcNotificationClick(id);
  }, NOTIFICATION_ID);
  await page.waitForTimeout(300);
  expect(page.url()).toBe(before);
  expect(await page.evaluate(() => window.__jgcLinkRan)).toBeUndefined();

  await page.evaluate((id) => {
    jgcNotificationRecords = [{ id, notification_type: "test", link_url: "policies-announcements.html?from=notice" }];
    handleJgcNotificationClick(id);
  }, NOTIFICATION_ID);
  await page.waitForURL(/\/policies-announcements\.html\?from=notice$/);
});

test("every notification link the Portal creates passes the database rule and opens", () => {
  const files = fs.readdirSync(portalRoot).filter((file) => /\.(js|html)$/.test(file));
  const links = [];
  for (const file of files) {
    for (const match of read(file).matchAll(/link_url:\s*"([^"]+)"/g)) links.push([file, match[1]]);
  }
  links.push(["send-push-notification", "home.html"]);
  expect(links.length).toBeGreaterThan(15);
  for (const [file, link] of links) {
    expect(link, file).toMatch(DATABASE_LINK_RULE);
  }
  const migration = read("supabase/migrations/20261008090000_security_batch_1005.sql");
  expect(migration).toContain("link_url ~ '^(https://[^[:space:]]+|[A-Za-z0-9][A-Za-z0-9._/-]*([?#][^[:space:]]*)?)$'");
});

test("a tapped push notification opens only Portal pages", async () => {
  const scope = "https://zethhummel-rgb.github.io/jgctimesheet/";
  const handlers = {};
  const opened = [];
  const self = {
    registration: { scope },
    location: new URL(scope + "service-worker.js"),
    addEventListener: (type, handler) => { handlers[type] = handler; },
    clients: { matchAll: async () => [], openWindow: async (url) => opened.push(url) }
  };
  vm.runInNewContext(read("service-worker.js"), { self, URL, console, Request: class {}, caches: {}, fetch: () => {} });

  const tap = async (url) => {
    let done;
    handlers.notificationclick({ notification: { close() {}, data: url === undefined ? undefined : { url } }, waitUntil: (promise) => { done = promise; } });
    await done;
    return opened.pop();
  };
  // Push links are built on the Portal's own address (send-push-notification), so they still open their page.
  expect(read("supabase/functions/send-push-notification/index.ts")).toContain('"https://zethhummel-rgb.github.io/jgctimesheet/" + link');
  expect(await tap(scope + "schedule.html?date=2026-10-08")).toBe(scope + "schedule.html?date=2026-10-08");
  expect(await tap("timesheet.html")).toBe(scope + "timesheet.html");
  expect(await tap(undefined)).toBe(scope + "home.html");
  expect(await tap("https://example.com/")).toBe(scope + "home.html");
  expect(await tap("javascript:alert(1)")).toBe(scope + "home.html");
  expect(await tap("data:text/html,hello")).toBe(scope + "home.html");
});

test("Field Calculator keeps quick-calc preferences on this device only", async ({ page }) => {
  const requests = await openSignedIn(page, "/field-calculator.html");
  await page.locator('[data-quick-calc="sonotube"]').first().click();
  await page.locator("#sonoQuantity").fill("7");
  await page.locator("#sonoQuantity").dispatchEvent("change");
  await page.waitForTimeout(1000);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("jgc_field_quick_calc_preferences:pat framer") || "{}"));
  expect(Number(saved.sonoQuantity)).toBe(7);
  expect(requests.filter((request) => request.includes("/rest/v1/user_preferences"))).toEqual([]);
  expect(read("field-calculator.js")).not.toContain("user_preferences");
  expect(fs.existsSync(path.join(portalRoot, "supabase-field-calculator-preferences.sql"))).toBe(false);
});

test("vehicle inspection pages get descriptive asset fields only, which cover what the page uses", () => {
  const migration = read("supabase/migrations/20261008090000_security_batch_1005.sql");
  const helper = migration.slice(migration.indexOf("function private.jgc_vehicle_inspection_asset"), migration.indexOf("$f$;", migration.indexOf("function private.jgc_vehicle_inspection_asset")));
  const fields = Array.from(helper.matchAll(/'([a-z_0-9]+)', e\./g), (match) => match[1]);
  expect(fields).not.toContain("vehicle_qr_token");
  expect(helper).not.toMatch(/token|email/);
  const page = read("vehicle-inspection.html");
  const used = new Set(Array.from(page.matchAll(/\b(?:asset|vehicle|trailer|state\.vehicle|state\.selectedTrailer[12])\.([a-z_]+)\b/g), (match) => match[1]));
  expect(used.size).toBeGreaterThan(12);
  for (const field of used) {
    expect(fields, `vehicle-inspection.html reads ${field}`).toContain(field);
  }
});

test("schedule reminders go to Portal accounts only and are claimed before sending", () => {
  const source = read("supabase/functions/send-schedule-reminders/index.ts");
  expect(source).toMatch(/\.filter\(\(email\) => employeeEmails\.has\(/);
  expect(source).toMatch(/\.in\("account_status", \["approved", "limited"\]\)/);
  const claim = source.indexOf(".is(column, null)"), send = source.indexOf("await send()");
  expect(claim).toBeGreaterThan(-1);
  expect(send).toBeGreaterThan(claim);
});

test("the backup only writes stored files inside their bucket folder", () => {
  const script = read("backup-jgc-portal.ps1");
  expect(script).toContain("$targetPath = Resolve-StorageBackupPath -BucketDirectory $bucketDirectory -ObjectPath $object.path");
  expect(script).not.toContain('$object.path -replace "/"');
  test.skip(process.platform !== "win32", "The backup runs on Windows.");
  const check = `
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile('${path.join(portalRoot, "backup-jgc-portal.ps1").replace(/'/g, "''")}', [ref]$tokens, [ref]$errors)
    $fn = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Resolve-StorageBackupPath' }, $true) | Select-Object -First 1
    . ([scriptblock]::Create($fn.Extent.Text))
    $bucket = Join-Path $env:TEMP 'jgc-backup-1005\\certificates'
    foreach ($p in @('abc/def.pdf', '2026/10/photo 1.jpg', '../evil.ps1', 'a/../../evil.ps1', '/abs.txt', 'C:/Windows/x.txt', 'a//b.txt', 'a/./b.txt', 'a:b.txt', 'a\\..\\..\\x.txt', 'a/b.', 'trailing/')) {
      try { $null = Resolve-StorageBackupPath -BucketDirectory $bucket -ObjectPath $p; "OK $p" } catch { "REFUSED $p" }
    }`;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", check], { encoding: "utf8" }).trim().split(/\r?\n/);
  expect(output).toEqual([
    "OK abc/def.pdf", "OK 2026/10/photo 1.jpg", "REFUSED ../evil.ps1", "REFUSED a/../../evil.ps1", "REFUSED /abs.txt",
    "REFUSED C:/Windows/x.txt", "REFUSED a//b.txt", "REFUSED a/./b.txt", "REFUSED a:b.txt", "REFUSED a\\..\\..\\x.txt",
    "REFUSED a/b.", "REFUSED trailing/"
  ]);
});
