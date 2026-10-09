const { test, expect } = require("@playwright/test");

// Release 1012 (Zeth, 2026-10-09): Jason's 10-hour Thursday showed as "1 hrs" on the phone week cards while the
// card total (13 hrs) and the table view were right. The formatter stripped a trailing zero from whole numbers.
const ORIGIN = "https://xnrljkkszoimegfivlya.supabase.co";

async function openTimesheet(page) {
  await page.addInitScript(() => {
    localStorage.setItem("currentWorker", "pat framer");
    localStorage.setItem("currentWorkerDisplay", "Pat Framer");
    localStorage.setItem("currentUserRole", "worker");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    sessionStorage.setItem("jgcActiveSession", "true");
  });
  await page.route(ORIGIN + "/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/timesheet.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof formatMobileHours === "function" && typeof renderMobileWeeklySummaryCards === "function");
}

test("hours keep their tens: 10, 20 and 30 are never shown as 1, 2 or 3", async ({ page }) => {
  await openTimesheet(page);
  const values = [10, 20, 30, 100, 8, 3, 8.5, 5.5, 5.25, 10.5, 12.75, 0, 7.999];
  expect(await page.evaluate((list) => list.map((value) => formatMobileHours(value)), values))
    .toEqual(["10", "20", "30", "100", "8", "3", "8.5", "5.5", "5.25", "10.5", "12.75", "0", "8"]);
});

test("a week card shows a 10-hour day as 10 hrs and the total still adds up", async ({ page }) => {
  await openTimesheet(page);
  const html = await page.evaluate(() => {
    const entry = (day, timeIn, timeOut, hours) => ({ day, timeIn, timeOut, hours, entryType: "work", jobName: "TNPL 2026 Megadome", jobNumber: "26108" });
    const group = { jobName: "TNPL 2026 Megadome", jobNumber: "26108", dayEntries: { Tuesday: [entry("Tuesday", "07:00", "10:00", 3)], Thursday: [entry("Thursday", "07:00", "17:00", 10)] } };
    return renderMobileWeeklySummaryCards([group], ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
  });
  await page.setContent(html);
  await expect(page.locator(".mobile-week-day-value")).toHaveText(["3 hrs", "10 hrs"]);
  await expect(page.locator(".mobile-week-card-total")).toHaveText("Total: 13 hrs");
});
