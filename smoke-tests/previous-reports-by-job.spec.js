const { test, expect } = require("@playwright/test");

// Release 951: Previous Reports (and the same page's Inspections and Permits views) grouped by job in
// collapsible sections, with cards instead of a 9-column table that scrolled sideways on phones.
const supabaseOrigin = "https://xnrljkkszoimegfivlya.supabase.co";
const USER_ID = "00000000-0000-4000-8000-000000000952";
const PHONE = { width: 393, height: 852 };
const daysAgo = n => new Date(Date.now() - n * 86400000);
const day = n => daysAgo(n).toISOString().slice(0, 10);

const JSA_1 = { id: "jsa-1", inspection_type: "JSA", inspection_date: day(4), created_at: daysAgo(4).toISOString(), worker_display_name: "Zeth Hummel",
  form_data: { fields: [{ label: "Project / Job", value: "26132 - McKay Mechanical - Ingleside Development" }, { label: "Location", value: "Ingleside" }, { label: "Work", value: "Overhead work near live lines" }], rows: [] } };
const JSA_2 = { id: "jsa-2", inspection_type: "JSA", inspection_date: day(9), created_at: daysAgo(9).toISOString(), worker_display_name: "Andre Labrosse",
  form_data: { fields: [{ label: "Project / Job", value: "26132 - McKay Mechanical - Ingleside Development" }, { label: "Work", value: "Concrete forming" }], rows: [] } };
const DAILY = { id: "daily-1", report_date: day(6), created_at: daysAgo(6).toISOString(), worker_display_name: "Zeth Hummel", project: "26130 - Structural Shoring", location: "Cornwall", work_completed: "Shoring installed on level 2" };
const INCIDENT = { id: "incident-1", report_date: day(3), created_at: daysAgo(3).toISOString(), reported_by_name: "Zeth Hummel", project: "26130 - Structural Shoring", location: "Cornwall", severity: "Minor", description: "Pinched finger", incident_type: "Incident / Near Miss" };
const INJURY = { id: "injury-1", accident_date: day(2), created_at: daysAgo(2).toISOString(), employee_display: "Crew Member", accident_location: "Yard", bodily_injury: "Sprained wrist" };

async function setup(page) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const user = { id: USER_ID, aud: "authenticated", role: "authenticated", email: "reports-951@johngordonconstruction.com", user_metadata: { display_name: "Zeth Hummel" } };
  const auth = { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: USER_ID, exp: now + 3600, role: "authenticated" }), "reports-951"].join("."), refresh_token: "reports-951", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
  await page.addInitScript(({ auth }) => {
    localStorage.setItem("sb-xnrljkkszoimegfivlya-auth-token", JSON.stringify(auth));
    localStorage.setItem("currentWorker", "zeth hummel");
    localStorage.setItem("currentWorkerDisplay", "Zeth Hummel");
    localStorage.setItem("currentUserEmail", auth.user.email);
    localStorage.setItem("currentUserRole", "admin");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    localStorage.setItem("jgcPushOnboarding:v1:zeth hummel", "dismissed");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { auth });
  await page.route(`${supabaseOrigin}/**`, route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    if (url.pathname.includes("/rest/v1/rpc/")) return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
    const table = url.pathname.split("/rest/v1/")[1] || "";
    const rows = {
      inspection_records: [JSA_1, JSA_2], daily_site_reports: [DAILY], toolbox_talk_reports: [], incident_reports: [INCIDENT],
      accident_reports: [], employee_injury_reports: [INJURY]
    }[table] || [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
}

test("reports are grouped by job in collapsible sections, newest job open, with no sideways scrolling", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await setup(page);
  await page.goto("/previous-inspections.html?recordType=reports", { waitUntil: "load" });
  const groups = page.locator(".record-job");
  await expect(groups).toHaveCount(3);
  await expect(page.locator("#recordSummary")).toHaveText("5 reports on 2 jobs");
  // Newest job first and open; the rest collapsed; reports without a job last.
  await expect(groups.nth(0).locator(".record-job__title")).toHaveText("26130 - Structural Shoring");
  await expect(groups.nth(0)).toHaveAttribute("open", "");
  await expect(groups.nth(0).locator(".record-job__badge.is-incident")).toHaveText("1 incident");
  await expect(groups.nth(1).locator(".record-job__title")).toHaveText("26132 - McKay Mechanical - Ingleside Development");
  await expect(groups.nth(1)).not.toHaveAttribute("open", "");
  await expect(groups.nth(2).locator(".record-job__title")).toHaveText("No job listed");
  expect(await page.locator("table").count()).toBe(0);

  const incident = groups.nth(0).locator(".history-card.is-incident");
  await expect(incident.locator(".history-card__type")).toHaveText("Incident / Near Miss");
  await expect(incident.locator(".history-card__meta")).toContainText("Zeth Hummel");
  await expect(incident.locator(".history-card__details")).toContainText("Minor - Pinched finger");

  await groups.nth(1).locator("summary").click();
  await expect(groups.nth(1)).toHaveAttribute("open", "");
  await expect(groups.nth(1).locator(".history-card")).toHaveCount(2);
  await expect(groups.nth(1).locator(".history-card").first().locator(".history-card__actions .jgc-button").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);
});

test("search and type chips narrow the reports and open the matching jobs", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await setup(page);
  await page.goto("/previous-inspections.html?recordType=reports", { waitUntil: "load" });
  await page.locator("#recordSearch").fill("andre");
  await expect(page.locator(".record-job")).toHaveCount(1);
  await expect(page.locator(".record-job")).toHaveAttribute("open", "");
  await expect(page.locator(".history-card")).toHaveCount(1);
  await expect(page.locator("#recordSummary")).toHaveText("1 report on 1 job");

  await page.locator("#recordSearch").fill("");
  await page.locator('.record-type-chip[data-record-type="JSA"]').click();
  await expect(page.locator('.record-type-chip[data-record-type="JSA"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".history-card")).toHaveCount(2);
  await expect(page.locator(".record-job")).toHaveCount(1);
  await page.locator('.record-type-chip[data-record-type=""]').click();
  await expect(page.locator("#recordSummary")).toHaveText("5 reports on 2 jobs");
});
