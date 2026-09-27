const { test, expect } = require("@playwright/test");

// Admin > Safety Records > Tool Box Talks: choosing a PDF fills in a readable title from its file name
// (the library used to be named straight from PDF names like "back_care_basic_manual-material-handling").
const ADMIN = { id: "00000000-0000-4000-8000-000000000094", email: "zeth@johngordonconstruction.com", name: "Zeth Hummel", key: "zeth hummel", role: "admin" };

async function signIn(page) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const user = { id: ADMIN.id, aud: "authenticated", role: "authenticated", email: ADMIN.email, user_metadata: { display_name: ADMIN.name } };
  const auth = { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: ADMIN.id, exp: now + 3600, role: "authenticated" }), "toolbox-titles"].join("."), refresh_token: "toolbox-titles", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
  await page.addInitScript(({ auth, person }) => {
    localStorage.setItem("sb-xnrljkkszoimegfivlya-auth-token", JSON.stringify(auth));
    localStorage.setItem("currentWorker", person.key);
    localStorage.setItem("currentWorkerDisplay", person.name);
    localStorage.setItem("currentUserEmail", person.email);
    localStorage.setItem("currentUserRole", person.role);
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    localStorage.setItem("jgcPushOnboarding:v1:" + person.key, "dismissed");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { auth, person: ADMIN });
  await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", route => {
    const p = new URL(route.request().url()).pathname;
    if (p.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    if (p.includes("/rpc/")) return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
    if (p.endsWith("/profiles")) {
      const profile = { id: ADMIN.id, email: ADMIN.email, display_name: ADMIN.name, worker_key: ADMIN.key, role: "admin", account_status: "approved" };
      const single = String(route.request().headers().accept || "").includes("vnd.pgrst.object");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(single ? profile : [profile]) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

const pdf = (name) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });

test("PDF names become readable toolbox talk titles", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin.html?tab=safetyRecords&records=reports", { waitUntil: "load" });
  const titles = await page.evaluate(() => [
    "back_care_basic_manual-material-handling.pdf",
    "HEPA_filters.pdf",
    "working-at-heights-site-specific-training.pdf",
    "traffic_control_public_roads_1.pdf",
    "Ladder Safety.PDF"
  ].map(cleanToolboxTalkTitle));
  expect(titles).toEqual([
    "Back Care Basic Manual Material Handling",
    "HEPA Filters",
    "Working at Heights Site Specific Training",
    "Traffic Control Public Roads 1",
    "Ladder Safety"
  ]);
});

test("choosing a PDF fills the title, but never replaces one the admin typed", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin.html?tab=safetyRecords&records=reports", { waitUntil: "load" });
  await page.evaluate(() => switchAdminReportSubtab("toolbox"));
  const title = page.locator("#toolboxTalkTitle");
  await expect(title).toBeVisible();
  const file = page.locator("#toolboxTalkFile");

  await file.setInputFiles(pdf("eye_protection.pdf"));
  await expect(title).toHaveValue("Eye Protection");
  // Picking a different PDF updates a title we filled in.
  await file.setInputFiles(pdf("hearing_protection.pdf"));
  await expect(title).toHaveValue("Hearing Protection");

  await title.fill("Hearing Protection on Noisy Sites");
  await file.setInputFiles(pdf("fire_extinguishers.pdf"));
  await expect(title).toHaveValue("Hearing Protection on Noisy Sites");
});
