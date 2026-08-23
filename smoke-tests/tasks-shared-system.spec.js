const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const portalRoot = path.resolve(__dirname, "..");

function base64Url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createSession() {
  const now = Math.floor(Date.now() / 1000);
  const user = {
    id: "00000000-0000-4000-8000-000000000092",
    aud: "authenticated",
    role: "authenticated",
    email: "tasks-style-test@johngordonconstruction.com",
    user_metadata: { display_name: "Tasks Style Test" }
  };
  const token = [
    base64Url({ alg: "HS256", typ: "JWT" }),
    base64Url({ aud: "authenticated", exp: now + 3600, iat: now, role: "authenticated", sub: user.id, email: user.email }),
    "tasks-style-test-signature"
  ].join(".");
  return {
    user,
    auth: {
      access_token: token,
      refresh_token: "tasks-style-test-refresh",
      expires_at: now + 3600,
      expires_in: 3600,
      token_type: "bearer",
      user
    }
  };
}

async function installState(page) {
  const state = createSession();
  await page.addInitScript(({ state, ref }) => {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(state.auth));
    localStorage.setItem("currentWorker", "tasks style test");
    localStorage.setItem("currentWorkerDisplay", "Tasks Style Test");
    localStorage.setItem("currentUserEmail", state.user.email);
    localStorage.setItem("currentUserRole", "admin");
    localStorage.setItem("currentAccountStatus", "approved");
    localStorage.setItem("jgcStayLoggedIn", "true");
    sessionStorage.setItem("jgcActiveSession", "true");
  }, { state, ref: "xnrljkkszoimegfivlya" });

  await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.startsWith("/auth/v1/user")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.user) });
      return;
    }
    if (requestUrl.pathname.startsWith("/auth/v1/token")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.auth) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

async function populateTasks(page) {
  await page.evaluate(() => {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 2);
    const dueValue = [
      dueDate.getFullYear(),
      String(dueDate.getMonth() + 1).padStart(2, "0"),
      String(dueDate.getDate()).padStart(2, "0")
    ].join("-");

    currentUserId = "00000000-0000-4000-8000-000000000092";
    taskFormDataLoaded = true;
    taskListLoaded = true;
    taskAssignees = [
      { value: currentUserId, profileId: currentUserId, name: "Tasks Style Test", source: "Portal" },
      { value: "employee-two", profileId: "employee-two", name: "Alexandra Longlastname", source: "Portal / WO" }
    ];
    jobs = [
      { job_number: "26123", job_name: "Long Customer Project Name for Mobile Layout Testing" }
    ];
    tasks = [
      {
        id: "task-open",
        title: "Confirm the long task title wraps cleanly without pushing the card beyond the screen",
        status: "open",
        priority: "urgent",
        category: "safety",
        due_date: dueValue,
        assigned_to_ids: [currentUserId],
        assigned_to_names: ["Tasks Style Test"],
        job_number: "26123",
        job_name: "Long Customer Project Name for Mobile Layout Testing",
        created_by: currentUserId,
        created_by_name: "Tasks Style Test",
        description: "This populated record verifies notes, metadata, status badges, actions, wrapping, and mobile spacing.",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: "task-progress",
        title: "Order replacement equipment labels",
        status: "in_progress",
        priority: "medium",
        category: "equipment",
        assigned_to_ids: [currentUserId],
        assigned_to_names: ["Tasks Style Test"],
        job_number: "",
        job_name: "",
        created_by: currentUserId,
        created_by_name: "Tasks Style Test",
        description: "Second task verifies the two-card desktop layout and alternate task state.",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ];

    renderTaskFormOptions();
    document.getElementById("taskFormDetails").open = true;
    document.getElementById("taskListDetails").open = true;
    document.getElementById("taskListLazyStatus").textContent = "2 tasks";
    renderTasks();
  });
}

async function contrastRatio(page, selector) {
  return page.locator(selector).first().evaluate((element) => {
    function parseRgb(value) {
      const parts = String(value).match(/[\d.]+/g) || [];
      return parts.slice(0, 3).map(Number);
    }
    function luminance(rgb) {
      const values = rgb.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4);
      });
      return (0.2126 * values[0]) + (0.7152 * values[1]) + (0.0722 * values[2]);
    }
    const style = getComputedStyle(element);
    const foreground = luminance(parseRgb(style.color));
    const background = luminance(parseRgb(style.backgroundColor));
    const light = Math.max(foreground, background);
    const dark = Math.min(foreground, background);
    return (light + 0.05) / (dark + 0.05);
  });
}

test("Tasks page uses the shared visual source without inline or legacy CSS", async () => {
  const source = fs.readFileSync(path.join(portalRoot, "tasks.html"), "utf8");
  const featureCss = fs.readFileSync(path.join(portalRoot, "tasks-design-system.css"), "utf8");

  expect(source).not.toMatch(/<style\b/i);
  expect(source).not.toContain("styles.css");
  expect(source).toContain('jgc-design-system.css?v=7');
  expect(source).toContain('tasks-design-system.css?v=2');
  expect(source).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
  expect(featureCss, "Tasks-only CSS must use centralized design tokens instead of page colours").not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  test(`populated Tasks page stays readable and contained on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installState(page);
    await page.goto("/tasks.html", { waitUntil: "domcontentloaded" });
    await populateTasks(page);

    await expect(page.locator(".task-card")).toHaveCount(2);
    await expect(page.locator("#taskFilters .jgc-tab")).toHaveCount(9);
    await expect(page.locator("#taskFilters .jgc-tab.active")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".task-actions .jgc-button").first()).toBeVisible();
    await expect(page.locator(".assignee-option")).toHaveCount(2);

    const dimensions = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      cardColumns: getComputedStyle(document.querySelector(".task-meta")).gridTemplateColumns,
      firstControlHeight: document.querySelector(".top-actions .jgc-button:not(.jgc-old-nav-hidden)").getBoundingClientRect().height
    }));
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.firstControlHeight).toBeGreaterThanOrEqual(44);
    if (viewport.name === "phone") {
      expect(dimensions.cardColumns.trim().split(/\s+/)).toHaveLength(1);
      const bottomNav = page.locator(".jgc-mobile-bottom-nav");
      await expect(bottomNav).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight / 2)));
      const navBox = await bottomNav.boundingBox();
      expect(Math.abs((navBox.y + navBox.height) - viewport.height)).toBeLessThanOrEqual(1);
    } else {
      expect(dimensions.cardColumns.trim().split(/\s+/)).toHaveLength(2);
    }

    for (const selector of [
      ".task-card",
      ".meta-box",
      ".task-badge.priority-urgent",
      "#taskFilters .jgc-tab.active",
      ".task-actions .jgc-button--danger"
    ]) {
      expect(await contrastRatio(page, selector), `${selector} must meet normal-text contrast`).toBeGreaterThanOrEqual(4.5);
    }

    await page.getByRole("tab", { name: "High Priority" }).click();
    await expect(page.locator(".task-card")).toHaveCount(1);
    await page.getByRole("tab", { name: "All Tasks" }).click();
    await expect(page.locator(".task-card")).toHaveCount(2);

    await page.locator(".task-card").first().getByRole("button", { name: "Edit" }).click();
    await expect(page.locator("#taskFormTitle")).toHaveText("Edit Task");
    await expect(page.locator("#taskTitle")).toHaveValue(/Confirm the long task title/);
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(page.locator("#taskFormTitle")).toHaveText("New Task");

    if (process.env.JGC_TASKS_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.JGC_TASKS_SCREENSHOT_DIR, { recursive: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: path.join(process.env.JGC_TASKS_SCREENSHOT_DIR, `tasks-${viewport.name}.png`),
        fullPage: true
      });
    }
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("embedded Admin Tasks keeps the shared layout without duplicate portal chrome", async ({ page }) => {
  await installState(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tasks.html?embedded=1&admin=1", { waitUntil: "domcontentloaded" });
  await populateTasks(page);

  await expect(page.locator(".tasks-page-header")).toBeHidden();
  await expect(page.locator(".top-actions")).toBeHidden();
  await expect(page.locator("#jgcAdminGlobalSearch")).toBeHidden();
  await expect(page.locator(".jgc-mobile-bottom-nav")).toHaveCount(0);
  await expect(page.locator(".task-card")).toHaveCount(2);
  expect(await page.evaluate(() => document.body.scrollWidth)).toBeLessThanOrEqual(391);
});
