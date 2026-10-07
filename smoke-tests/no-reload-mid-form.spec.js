const { test, expect } = require("@playwright/test");

// Release 1003: a Portal update (or the first offline install) must not reload a page someone is filling in.
// Job Board QR visitors lost their typed sign-in details to these reloads. Service workers are blocked in
// tests, so the page fakes an installed worker and fires the "a new version took over" event itself.
const ORIGIN = "https://xnrljkkszoimegfivlya.supabase.co";

async function openBoard(page, { installed = false, signedIn = false } = {}) {
  await page.addInitScript(({ installed, signedIn }) => {
    window.__registerCalls = 0;
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = () => { window.__registerCalls++; return new Promise(() => {}); };
      if (installed) Object.defineProperty(navigator.serviceWorker, "controller", { configurable: true, get: () => ({ state: "activated" }) });
    }
    if (signedIn) { localStorage.setItem("currentWorker", "pat framer"); localStorage.setItem("currentAccountStatus", "approved"); sessionStorage.setItem("jgcActiveSession", "true"); }
  }, { installed, signedIn });
  await page.route(ORIGIN + "/**", (route) => route.fulfill(new URL(route.request().url()).pathname.startsWith("/auth/v1/user") ? { status: 401, json: {} } : { json: {} }));
  await page.goto("/job-board.html?embedded=1#board=" + "a".repeat(8) + "-aaaa-4aaa-aaaa-" + "a".repeat(12) + "b".repeat(8) + "-bbbb-4bbb-bbbb-" + "b".repeat(12), { waitUntil: "load" });
  await page.evaluate(() => { window.__sameDocument = true; });
}

async function takeOverAndCheckReload(page) {
  const reloaded = page.waitForEvent("load", { timeout: 1500 }).then(() => true, () => false);
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")));
  return reloaded;
}

test("a QR visitor without the Portal never downloads the offline copy or reloads on its first install", async ({ page }) => {
  await openBoard(page);
  expect(await page.evaluate(() => isJgcPublicQrVisit())).toBe(true);
  expect(await page.evaluate(() => window.__registerCalls)).toBe(0);
  expect(await takeOverAndCheckReload(page)).toBe(false);
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
});

test("a signed-in employee on the Job Board still gets the offline copy", async ({ page }) => {
  await openBoard(page, { signedIn: true });
  expect(await page.evaluate(() => isJgcPublicQrVisit())).toBe(false);
  expect(await page.evaluate(() => window.__registerCalls)).toBe(1);
});

test("an update reloads an untouched page but waits while someone is typing or on the JSA", async ({ page }) => {
  await openBoard(page, { installed: true });
  expect(await page.evaluate(() => window.__registerCalls)).toBe(1);
  expect(await page.evaluate(() => hasJgcWorkInProgress())).toBe(false);
  expect(await takeOverAndCheckReload(page)).toBe(true);

  await page.evaluate(() => { window.__sameDocument = true; });
  await page.evaluate(() => { document.getElementById("jsaSignOnPanel").hidden = false; });
  expect(await page.evaluate(() => hasJgcWorkInProgress())).toBe(true);
  expect(await takeOverAndCheckReload(page)).toBe(false);
  await page.evaluate(() => { document.getElementById("jsaSignOnPanel").hidden = true; });

  await page.locator("#visitorName").evaluate((input) => { input.closest("section").hidden = false; });
  await page.locator("#visitorName").fill("Synthetic Visitor");
  expect(await page.evaluate(() => hasJgcWorkInProgress())).toBe(true);
  expect(await takeOverAndCheckReload(page)).toBe(false);
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  await expect(page.locator("#visitorName")).toHaveValue("Synthetic Visitor");
});
