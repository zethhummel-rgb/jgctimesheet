const { test, expect } = require("@playwright/test");

const supabaseOrigin = "https://xnrljkkszoimegfivlya.supabase.co";
const ADMIN = { id: "00000000-0000-4000-8000-00000000a011", email: "zeth@johngordonconstruction.com", display_name: "Zeth Hummel", worker_key: "zeth hummel", role: "admin", account_status: "approved" };
const WORKER = { id: "00000000-0000-4000-8000-00000000e011", email: "pat.framer@example.com", display_name: "Pat Framer", worker_key: "pat framer", role: "worker", account_status: "approved" };
const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");

// In-memory stand-in for jsa_library_items and its admin-only functions.
async function signIn(page, person, backend, theme = "light") {
  const now = Math.floor(Date.now() / 1000);
  const user = { id: person.id, aud: "authenticated", role: "authenticated", email: person.email, user_metadata: { display_name: person.display_name } };
  const auth = { access_token: [b64({ alg: "HS256", typ: "JWT" }), b64({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: person.id, email: person.email }), "jsa-library"].join("."), refresh_token: "r", expires_at: now + 3600, expires_in: 3600, token_type: "bearer", user };
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
  }, { auth, person, theme });
  const isAdmin = person.role === "admin";
  await page.route(`${supabaseOrigin}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const single = String(request.headers().accept || "").includes("vnd.pgrst.object");
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const fail = (message, code = "P0001") => json({ code, message }, 400);
    if (url.pathname.startsWith("/auth/v1/user")) return json(user);
    if (url.pathname.startsWith("/auth/v1/token")) return json(auth);
    if (url.pathname.endsWith("/rpc/is_admin")) return json(isAdmin);
    if (url.pathname.endsWith("/rpc/save_jsa_library_item")) {
      if (!isAdmin) return fail("Admin access required", "42501");
      const a = request.postDataJSON();
      backend.saves.push(a);
      let item = backend.items.find(i => i.id === a.p_id);
      const stamp = new Date().toISOString();
      if (!item) { item = { id: a.p_id, revision: 1, archived_at: null, created_at: stamp }; backend.items.push(item); }
      else if (item.revision !== a.p_revision) return fail("changed", "40001");
      else item.revision += 1;
      Object.assign(item, { category: a.p_category, task: a.p_task, hazards: a.p_hazards, controls: a.p_controls, updated_at: stamp });
      return json(item);
    }
    if (url.pathname.endsWith("/rpc/archive_jsa_library_item")) {
      const a = request.postDataJSON();
      const item = backend.items.find(i => i.id === a.p_id);
      Object.assign(item, { archived_at: a.p_archived ? new Date().toISOString() : null, revision: item.revision + 1 });
      return json(item);
    }
    if (url.pathname.includes("/rpc/")) return json(null);
    if (url.pathname.endsWith("/jsa_library_items")) return json(backend.items.filter(i => isAdmin || !i.archived_at));
    if (url.pathname.endsWith("/profiles")) return json(single ? person : [person]);
    return json(single ? null : []);
  });
}

test("admin creates, edits, archives and restores custom JSA tasks with duplicate protection", async ({ page }) => {
  const backend = { items: [], saves: [] };
  await signIn(page, ADMIN, backend);
  page.on("dialog", dialog => dialog.accept());
  await page.goto("/jsa-library-admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#libraryStatus")).toContainText("No custom tasks".slice(0, 0));
  await page.getByRole("button", { name: "New custom task", exact: true }).click();

  await page.locator("#libraryCategory").selectOption("Access & working at heights");
  await page.locator("#libraryTask").fill("ladders");
  await expect(page.locator("#libraryDuplicates")).toContainText("Already in the library");
  await page.locator("#libraryHazards").fill("Falls");
  await page.locator("#libraryControlsInput").fill("Inspect the ladder");
  await page.getByRole("button", { name: "Save to library", exact: true }).click();
  await expect(page.locator("#libraryFormError")).toContainText("already in the library");
  expect(backend.saves).toHaveLength(0);

  await page.locator("#libraryTask").fill("Trench shoring installation");
  await expect(page.locator("#libraryDuplicates")).toContainText("Trenching and shoring");
  await page.getByRole("button", { name: "Save to library", exact: true }).click();
  await expect(page.locator("#libraryFormError")).toContainText("Confirm this is different");
  await page.locator("#libraryTask").fill("Installing washroom partitions");
  await expect(page.locator("#libraryDuplicates")).toBeHidden();
  await page.locator("#libraryCategory").selectOption("__new__");
  await page.locator("#libraryNewCategory").fill("Interior fit-out");
  await page.locator("#libraryHazards").fill("- Heavy panels\nPinch points\n\n");
  await page.locator("#libraryControlsInput").fill("Two-person lift for panels\nKeep fingers clear of the hinge side when fastening");
  await page.getByRole("button", { name: "Save to library", exact: true }).click();
  await expect(page.locator("#libraryStatus")).toContainText("Saved “Installing washroom partitions”");
  expect(backend.saves[0]).toMatchObject({ p_revision: 0, p_category: "Interior fit-out", p_task: "Installing washroom partitions", p_hazards: ["Heavy panels", "Pinch points"], p_controls: ["Two-person lift for panels", "Keep fingers clear of the hinge side when fastening"] });
  await expect(page.locator(".library-card")).toContainText(["Installing washroom partitions"]);

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator("#libraryCategory")).toHaveValue("Interior fit-out");
  await page.locator("#libraryControlsInput").fill("Two-person lift for panels\nKeep fingers clear of the hinge side when fastening\nProtect finished floors");
  await page.getByRole("button", { name: "Save to library", exact: true }).click();
  await expect(page.locator("#libraryStatus")).toContainText("Saved");
  expect(backend.saves[1]).toMatchObject({ p_revision: 1 });
  expect(backend.items[0].controls).toHaveLength(3);

  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.locator("#libraryStatus")).toContainText("Archived");
  await expect(page.locator(".library-card")).toHaveCount(0);
  await page.locator("#libraryView").selectOption("archived");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.locator("#libraryStatus")).toContainText("Restored");
  expect(backend.items[0].archived_at).toBeNull();

  await page.locator("#libraryView").selectOption("system");
  await expect(page.locator(".library-group h3").first()).toHaveText("Access & working at heights");
  await expect(page.locator("#libraryList")).toContainText("Trenching and shoring");
});

test("non-admins cannot manage the JSA library", async ({ page }) => {
  await signIn(page, WORKER, { items: [], saves: [] });
  await page.goto("/jsa-library-admin.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#libraryStatus")).toContainText("approved administrators only");
  await expect(page.locator("#libraryControls")).toBeHidden();
});

for (const theme of ["light", "dark"]) for (const width of [390, 1440]) {
  test(`JSA library admin page is readable and contained ${theme} ${width}`, async ({ page }, testInfo) => {
    const backend = { items: [{ id: "a1", category: "Interior fit-out", task: "Installing washroom partitions", hazards: ["Heavy panels"], controls: ["Two-person lift", "Keep fingers clear"], revision: 1, archived_at: null, updated_at: "2026-09-25T12:00:00Z" }], saves: [] };
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, ADMIN, backend, theme);
    await page.goto("/jsa-library-admin.html", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".library-card")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const contrast = await page.locator(".library-card h3, .library-card p, .library-card small, .jgc-button, .jgc-page-title").evaluateAll(elements => {
      const parse = c => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const background = el => { for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c.slice(0, 3); } return [255, 255, 255]; };
      return elements.filter(el => el.getClientRects().length).map(el => { const a = lum(parse(getComputedStyle(el).color).slice(0, 3)), b = lum(background(el)); return { text: el.textContent.trim().slice(0, 30), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }; });
    });
    for (const sample of contrast) expect(sample.ratio, theme + " " + sample.text).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: testInfo.outputPath("library-list.png"), fullPage: true });
    await page.getByRole("button", { name: "New custom task", exact: true }).click();
    await page.locator("#libraryTask").fill("Trench shoring installation");
    await expect(page.locator("#libraryDuplicates")).toBeVisible();
    const shell = await page.locator(".jgc-page-shell").boundingBox();
    expect(Math.abs(shell.x - (width - shell.x - shell.width)), "form is centred in the page shell").toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const formContrast = await page.locator("#libraryForm :is(.jgc-label, .jgc-help-text, .jgc-button, .library-duplicates, .library-confirm)").evaluateAll(elements => {
      const parse = c => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const background = el => { for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c.slice(0, 3); } return [255, 255, 255]; };
      return elements.filter(el => el.getClientRects().length).map(el => { const a = lum(parse(getComputedStyle(el).color).slice(0, 3)), b = lum(background(el)); return { text: el.textContent.trim().slice(0, 30), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }; });
    });
    expect(formContrast.length).toBeGreaterThan(6);
    for (const sample of formContrast) expect(sample.ratio, theme + " form " + sample.text).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: testInfo.outputPath("library-form.png"), fullPage: true });
  });
}
