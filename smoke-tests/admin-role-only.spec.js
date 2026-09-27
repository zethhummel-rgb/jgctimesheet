const { test, expect } = require("@playwright/test");

// Admin comes from the account role only. Employees can edit their own profile email, so an owner's email
// address on an employee account must never unlock admin screens (release 944; the database rules match).
const OWNER_EMAIL = "zeth@johngordonconstruction.com";

async function signInAs(page, person) {
  const b64 = v => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const user = { id: person.id, aud: "authenticated", role: "authenticated", email: person.email, user_metadata: { display_name: person.name } };
  const auth = { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: person.id, exp: now + 3600, role: "authenticated" }), "admin-role"].join("."), refresh_token: "admin-role", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
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
  }, { auth, person });
  await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", route => {
    const p = new URL(route.request().url()).pathname;
    if (p.startsWith("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    if (p.includes("/rpc/")) return route.fulfill({ status: 200, contentType: "application/json", body: String(person.role === "admin") });
    if (p.endsWith("/profiles")) {
      const profile = { id: person.id, email: person.email, display_name: person.name, worker_key: person.key, role: person.role, account_status: "approved" };
      const single = String(route.request().headers().accept || "").includes("vnd.pgrst.object");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(single ? profile : [profile]) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

test("an owner's email address never makes an account an admin", async ({ page }) => {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  const checks = await page.evaluate((ownerEmail) => ({
    workerWithOwnerEmail: isAdminWorker("pat framer", "worker", ownerEmail),
    storedOwnerEmailOnly: (() => {
      localStorage.setItem("currentUserRole", "worker");
      localStorage.setItem("currentUserEmail", ownerEmail);
      return isAdminWorker("pat framer");
    })(),
    adminRole: isAdminWorker("zeth hummel", "admin", ownerEmail)
  }), OWNER_EMAIL);
  expect(checks).toEqual({ workerWithOwnerEmail: false, storedOwnerEmailOnly: false, adminRole: true });
});

test("an employee whose profile email is the owner's is turned away from Admin", async ({ page }) => {
  await signInAs(page, { id: "00000000-0000-4000-8000-00000000e044", email: OWNER_EMAIL, name: "Pat Framer", key: "pat framer", role: "worker" });
  const messages = [];
  page.on("dialog", (dialog) => {
    messages.push(dialog.message());
    dialog.dismiss();
  });
  await page.goto("/admin.html", { waitUntil: "commit" });
  await expect(page).toHaveURL(/\/home\.html/);
  expect(messages).toContain("Admin is only available to authorized users.");
});
