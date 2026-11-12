const { test, expect } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const portalRoot = path.resolve(__dirname, "..");
const pages = [
  { file: "equipment-inspection.html", css: "equipment-qr-inspection.css", version: 2 },
  { file: "vehicle-inspection.html", css: "vehicle-qr-inspection.css", version: 3 }
];

test("QR inspection screens use centralized token-only styling", async () => {
  const sharedCss = fs.readFileSync(path.join(portalRoot, "qr-inspection-design-system.css"), "utf8");
  expect(sharedCss).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);

  for (const page of pages) {
    const source = fs.readFileSync(path.join(portalRoot, page.file), "utf8");
    const featureCss = fs.readFileSync(path.join(portalRoot, page.css), "utf8");
    const screenMarkup = source.split("<script src=")[0];

    expect(source).toContain('jgc-design-system.css?v=14');
    expect(source).toContain('qr-inspection-design-system.css?v=2');
    expect(source).toContain('inspection-result-buttons.css?v=1');
    expect(source).toContain(`${page.css}?v=${page.version}`);
    expect(source).toMatch(/<body\b[^>]*\bjgc-system-page\b/i);
    expect(screenMarkup).not.toMatch(/<style\b/i);
    expect(screenMarkup).not.toMatch(/\sstyle\s*=/i);
    expect(featureCss).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(featureCss).toContain("var(--jgc-color-");
  }

  const serviceWorker = fs.readFileSync(path.join(portalRoot, "service-worker.js"), "utf8");
  expect(serviceWorker).toContain('"./qr-inspection-design-system.css?v=2"');
  expect(serviceWorker).toContain('"./inspection-result-buttons.css?v=1"');
  expect(serviceWorker).toContain('"./equipment-qr-inspection.css?v=2"');
  expect(serviceWorker).toContain('"./vehicle-qr-inspection.css?v=3"');
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 }
]) {
  for (const pageInfo of pages) {
    test(`${pageInfo.file} remains readable and contained on ${viewport.name}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport, javaScriptEnabled: false });
      const page = await context.newPage();
      await page.goto(`/${pageInfo.file}`, { waitUntil: "domcontentloaded" });

      await page.locator("[hidden]").evaluateAll((nodes) => nodes.forEach((node) => node.removeAttribute("hidden")));
      await expect(page.locator(".qr-inspection-shell")).toBeVisible();

      const layout = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        bodyWidth: document.body.scrollWidth,
        shell: (() => {
          const rect = document.querySelector(".qr-inspection-shell").getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width };
        })(),
        fieldsContained: Array.from(document.querySelectorAll("input, select, textarea, button")).every((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1;
        })
      }));

      expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewport + 1);
      expect(layout.shell.left).toBeGreaterThanOrEqual(0);
      expect(layout.shell.right).toBeLessThanOrEqual(layout.viewport + 1);
      expect(layout.fieldsContained).toBe(true);
      await context.close();
    });
  }
}

for (const [theme, mode] of [["dark", "QR"], ["light", "manual"]]) {
  test(`Vehicle and trailer selections have clear fills and pressed states on a ${theme} phone (${mode})`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const page = await context.newPage();
    try {
      await page.addInitScript(value => localStorage.setItem("jgcPortalTheme", value), theme);
      await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", route => {
        const endpoint = new URL(route.request().url()).pathname.split("/").pop();
        const vehicle = { id: "vehicle-1", name: "Test pickup", odometer_required: false };
        const trailers = [{ id: "trailer-1", name: "Test utility trailer" }];
        const employees = [{ worker_key: "test inspector", display_name: "Test Inspector" }];
        const data = {
          get_vehicle_qr_inspection: { vehicle, trailers, employees, history: [] },
          get_vehicle_manual_inspection_data: { vehicles: [vehicle], trailers, employees },
          get_vehicle_manual_inspection_history: { history: [] }
        };
        return route.fulfill({ json: data[endpoint] ?? [] });
      });

      const manual = mode === "manual";
      await page.goto("/vehicle-inspection.html?" + (manual ? "mode=manual" : "vehicle_id=vehicle-1&token=test"));
      if (manual) await page.getByLabel("Vehicle / Trailer", { exact: true }).selectOption("vehicle-1");
      await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", theme);
      const vehicleCard = page.locator('[data-response-key^="vehicle-"]').first();
      const group = vehicleCard.getByRole("group", { name: "Air Brake System result" });
      const choices = group.getByRole("button");
      await expect(choices).toHaveCount(3);
      const grey = await choices.first().evaluate(button => getComputedStyle(button).backgroundColor);
      for (const button of await choices.all()) {
        await expect(button).toHaveAttribute("aria-pressed", "false");
        await expect(button).toHaveCSS("background-color", grey);
      }
      const options = [
        ["Pass", "rgb(17, 106, 53)"],
        ["Defect", "rgb(199, 42, 34)"],
        ["N/A", "rgb(21, 84, 119)"]
      ];
      for (const [name, fill] of options) {
        const choice = group.getByRole("button", { name, exact: true });
        await choice.tap();
        await expect(choice).toHaveAttribute("aria-pressed", "true");
        await expect(choice).toHaveCSS("background-color", fill);
        await expect(group.locator('button[aria-pressed="true"]')).toHaveCount(1);
        for (const button of await group.locator('button[aria-pressed="false"]').all()) {
          await expect(button).toHaveCSS("background-color", grey);
        }
        const mark = await choice.evaluate(button => getComputedStyle(button, "::before").borderInlineStartWidth);
        expect(mark).toBe("2px");
        await expect(page.locator("#progressText")).toHaveText(/^1 of \d+ completed$/);
        if (name === "Defect") await expect(vehicleCard.getByText("Defect Severity")).toBeVisible();
      }
      await expect(vehicleCard.getByText("Defect Severity")).toBeHidden();

      await page.getByLabel("Trailer 1", { exact: true }).selectOption("trailer-1");
      const trailer = page.locator('[data-response-key^="trailer1-"]').first();
      const trailerPass = trailer.getByRole("button", { name: "Pass", exact: true });
      await expect(trailerPass).toHaveCSS("background-color", grey);
      await trailerPass.focus();
      await trailerPass.press("Space");
      await expect(trailerPass).toBeFocused();
      await expect(trailerPass).toHaveAttribute("aria-pressed", "true");
      await expect(trailerPass).toHaveCSS("background-color", options[0][1]);
      await expect(group.getByRole("button", { name: "N/A" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("#progressText")).toHaveText(/^2 of \d+ completed$/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await trailer.screenshot({ path: info.outputPath(`trailer-selection-${theme}.png`) });
    } finally {
      await context.close();
    }
  });
}

for (const [inspectionType, theme] of [["Aerial Lifts", "light"], ["Fork Lift", "dark"], ["Tele Handler", "light"]]) {
  test(`Equipment QR result colours work for ${inspectionType} on mobile`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(value => localStorage.setItem("jgcPortalTheme", value), theme);
    await page.route("https://xnrljkkszoimegfivlya.supabase.co/**", route => {
      const endpoint = new URL(route.request().url()).pathname.split("/").pop();
      return route.fulfill({
        json: endpoint === "get_public_equipment_inspection" ? {
          equipment_name: "Test equipment",
          equipment_identification: "TEST-1",
          inspection_type: inspectionType,
          employees: [{ worker_key: "test inspector", display_name: "Test Inspector" }]
        } : []
      });
    });
    await page.goto("/equipment-inspection.html?token=test");
    await expect(page.locator("html")).toHaveAttribute("data-jgc-theme", theme);
    const item = page.locator(".inspection-item").first();
    const options = [
      ["Pass", "P", "rgb(17, 106, 53)"],
      ["Fail", "F", "rgb(199, 42, 34)"],
      ["N/A", "NA", "rgb(21, 84, 119)"]
    ];
    const grey = await item.getByRole("button", { name: "Pass", exact: true }).evaluate(button => getComputedStyle(button).backgroundColor);
    for (const [name, value, fill] of options) {
      const button = item.getByRole("button", { name, exact: true });
      await expect(button).toHaveCSS("background-color", grey);
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await expect(button).toHaveAttribute("data-choice", value);
      await expect(button).toHaveCSS("background-color", fill);
      await expect(item.locator('[aria-pressed="true"]')).toHaveCount(1);
      await expect(page.locator("#progressText")).toHaveText(/^1 of \d+ completed$/);
    }
  });
}
