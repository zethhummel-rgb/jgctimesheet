const { test, expect } = require("@playwright/test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { directoryState, serveDirectory } = require("./fixtures/job-readability-fixture");

function previewState() {
  const state = directoryState();
  state.clients[0].sites = [{ id: "saved-site", label: "Brockville Station", address: "100 Station Road" }];
  state.clients[0].contacts = [{ id: "saved-contact", name: "Avery Buyer", email: "avery@example.com", phone: "613-555-0100", role: "Facilities" }];
  state.quotes[0].customerPo = "WO-100";
  state.jobs[0].acceptedQuoteSnapshot = JSON.stringify(state.quotes[0]);
  state.quotes.push({ ...state.quotes[0], id: "finished-preview-quote", number: "JGC-Q-2026-0905", status: "Finished", revisions: [],
    project: "Sump pump inspections", site: "Brockville Station", address: "100 Station Road", customerPo: "WO-200", proposalAttention: "Avery Buyer",
    lines: [{ id: "sub-preview-line", division: "02", priceBookCode: null, description: "Emergency service", internalScope: "", classification: "Firm", included: true,
      costType: "Sub / Vendor", quantity: 1, unit: "LS", catalogCost: 100, projectCost: 100, markupOverride: null, priceOverride: null,
      vendorId: "fixture-sub", vendorName: "Fixture subcontractor", vendorReference: "REF", vendorQuoteDate: "", vendorQuoteExpiry: "", vendorActualCost: 100,
      liveQuote: true, confidence: "High", low: null, high: null, sourceNote: "", customerNote: "", internalNote: "" }],
  });
  return state;
}
async function openPreview(page, state = previewState()) {
  const captures = await serveDirectory(page, state);
  await page.getByRole("button", { name: /New job.*Preview/ }).click();
  await expect(page.getByRole("dialog", { name: "New job", exact: true })).toBeVisible();
  return captures;
}
async function choose(page, name, value) {
  await page.getByRole("combobox", { name, exact: true }).fill(value);
  await page.getByRole("option").filter({ hasText: value }).first().click();
}

test("job preview has no persistence route and no creation handler", () => {
  const source = readFileSync(path.join(__dirname, "../estimating-app/app/job-create-preview.tsx"), "utf8");
  expect(source).not.toMatch(/\bfetch\s*\(|localStorage|sessionStorage|indexedDB|supabase|setState\s*\(/);
  expect(source).toContain('disabled title="Job creation is disabled until approval"');
  expect(source).not.toContain("Not-to-exceed");
});

test("preview validates details without saving, numbering or affecting Excel tools", async ({ page }) => {
  const captures = await openPreview(page);
  await page.getByLabel(/Job date/).fill("2026-09-12");
  await expect(page.getByLabel(/Next job #/)).toHaveValue("26904");
  await expect(page.getByRole("button", { name: /Create job/ })).toBeDisabled();
  await page.getByRole("button", { name: "Check details" }).click();
  await expect(page.locator("#new-job-name")).toHaveAttribute("aria-invalid", "true");
  await choose(page, "New job client", "Quoted Contract Client");
  await page.getByLabel(/Job name \/ scope/).fill("New inspection visit");
  await page.getByLabel(/Job type/).selectOption("T&M");
  await page.getByLabel("Subcontractors", { exact: false }).selectOption("Yes");
  await expect(page.getByRole("option", { name: "Yes", exact: true })).toHaveCount(1);
  await expect(page.getByLabel(/Job value/)).toHaveValue("");
  await page.getByRole("button", { name: "Check details" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Details checked" })).toBeVisible();
  await page.locator("#new-job-name").press("Enter");
  await page.waitForTimeout(1200); // Beyond the workspace autosave debounce: preview must never write.
  expect(captures.writes).toEqual([]);
  expect(captures.jobInfo).toEqual([]);
  expect(captures.unexpectedRequests).toEqual([]);
  await page.getByRole("button", { name: "Close preview", exact: true }).click();
  await expect(page.getByText("Excel job-list upload", { exact: true })).toBeVisible();
  await expect(page.getByText("Excel job-list download", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /New job.*Preview/ }).click();
  await expect(page.locator("#new-job-name")).toHaveValue("");
  await page.getByLabel(/Job date/).fill("2026-09-12");
  await expect(page.getByLabel(/Next job #/)).toHaveValue("26904");
});

test("finished quote autofills value and Yes/No flag without changing quote handoff", async ({ page }) => {
  const state = previewState();
  const captures = await openPreview(page, state);
  await choose(page, "Preview linked quote", "JGC-Q-2026-0905");
  await expect(page.locator("#new-job-name")).toHaveValue("Sump pump inspections");
  await expect(page.getByRole("combobox", { name: "New job client" })).toHaveValue("Quoted Contract Client");
  await expect(page.getByLabel(/Client PO#\/WO#/)).toHaveValue("WO-200");
  await expect(page.getByLabel(/Job value/)).toHaveValue("120");
  await expect(page.getByLabel(/Job value/)).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Subcontractors", { exact: false })).toHaveValue("Yes");
  await expect(page.getByLabel("Site address", { exact: true })).toHaveValue("100 Station Road");
  await page.getByRole("button", { name: "Unlink preview" }).click();
  await page.getByLabel(/Job value/).fill("2500");
  await page.getByRole("button", { name: "Close preview", exact: true }).click();
  await page.getByRole("button", { name: /^Quotes(?:\s|$)/ }).first().click();
  await page.getByPlaceholder("Search quote, client, project or reference").fill("JGC-Q-2026-0905");
  await page.locator(".quotes-table tbody tr").filter({ hasText: "JGC-Q-2026-0905" }).click();
  await page.getByRole("button", { name: "Make into job", exact: true }).click();
  const handoff = page.getByRole("dialog", { name: "Make into job", exact: true });
  await expect(handoff.getByRole("combobox", { name: "Portal job" })).toBeVisible();
  await expect(handoff).toContainText("linked to this existing job");
  expect(captures.writes).toEqual([]);
  expect(captures.jobInfo).toEqual([]);
});

test("new clients, sites and attention contacts remain local to the preview on phone", async ({ page }) => {
  const captures = await openPreview(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("combobox", { name: "New job client" }).fill("Preview Client Only");
  await page.getByRole("button", { name: /Add new client: Preview Client Only/ }).click();
  let dialog = page.getByRole("dialog", { name: "Add new client", exact: true });
  await dialog.getByLabel("Attention name").fill("Preview Contact");
  await dialog.getByLabel("Email", { exact: true }).fill("preview@example.com");
  await dialog.getByLabel("Site name", { exact: true }).fill("Preview Station");
  await dialog.getByLabel("Address", { exact: true }).fill("12 Preview Road");
  await dialog.getByRole("button", { name: "Use in preview" }).click();
  await expect(page.getByRole("combobox", { name: "New job client" })).toHaveValue("Preview Client Only");
  await expect(page.getByRole("combobox", { name: "New job attention" })).toHaveValue("Preview Contact");
  await expect(page.getByLabel("Site address", { exact: true })).toHaveValue("12 Preview Road");
  await choose(page, "New job client", "Quoted Contract Client");
  await choose(page, "New job site", "Brockville Station");
  await expect(page.getByLabel("Site address", { exact: true })).toHaveValue("100 Station Road");
  await page.getByRole("combobox", { name: "New job site" }).fill("New station");
  await page.getByRole("button", { name: /Add new site: New station/ }).click();
  dialog = page.getByRole("dialog", { name: "Add new site", exact: true });
  await dialog.getByLabel("Address", { exact: true }).fill("50 New Road");
  await dialog.getByRole("button", { name: "Use in preview" }).click();
  await page.getByRole("combobox", { name: "New job attention" }).fill("New Attention");
  await page.getByRole("button", { name: /Add new attention: New Attention/ }).click();
  await page.getByRole("dialog", { name: "Add new attention", exact: true }).getByRole("button", { name: "Use in preview" }).click();
  await expect(page.getByLabel("Site address", { exact: true })).toHaveValue("50 New Road");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Close preview", exact: true }).click();
  await page.getByRole("button", { name: /New job.*Preview/ }).click();
  await page.getByRole("combobox", { name: "New job client" }).fill("Preview Client Only");
  await expect(page.getByRole("option").filter({ hasText: "Preview Client Only" })).toHaveCount(0);
  expect(captures.writes).toEqual([]);
  expect(captures.jobInfo).toEqual([]);
});

test("only active matching names and matching or unknown client references trigger advisory", async ({ page }) => {
  await openPreview(page);
  await choose(page, "New job client", "Quoted Contract Client");
  await page.locator("#new-job-name").fill("Accepted Canopy Contract");
  await page.getByLabel(/Client PO#\/WO#/).fill("WO-100");
  await expect(page.locator(".job-preview-warning")).toContainText("26901");
  await page.getByLabel(/Client PO#\/WO#/).fill("WO-101");
  await expect(page.locator(".job-preview-warning")).toHaveCount(0);
  await page.locator("#new-job-name").fill("Historical Imported Repair");
  await page.getByLabel(/Client PO#\/WO#/).fill("");
  await expect(page.locator(".job-preview-warning")).toHaveCount(0);
});

test("Toronto job date and yearly number preview never consume a number", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2027-01-01T02:00:00Z"));
  await openPreview(page);
  await expect(page.getByLabel(/Job date/)).toHaveValue("2026-12-31");
  await expect(page.getByLabel(/Next job #/)).toHaveValue("26904");
  await page.getByLabel(/Job date/).fill("2027-01-01");
  await expect(page.getByLabel(/Next job #/)).toHaveValue("27001");
  await page.getByLabel(/Job date/).fill("2025-01-01");
  await expect(page.getByLabel(/Next job #/)).toHaveValue("25905");
});

for (const theme of ["light", "dark"]) {
  test(`job preview is readable and keyboard-contained in ${theme} theme`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openPreview(page);
    await page.evaluate((theme) => { if (typeof applyJgcTheme === "function") applyJgcTheme(theme); }, theme);
    await page.locator("#new-job-name").fill("Sump pump inspections");
    await choose(page, "New job client", "Quoted Contract Client");
    await choose(page, "New job site", "Brockville Station");
    await expect(page.getByRole("button", { name: /Create job/ })).toBeDisabled();
    const size = await page.locator(".job-preview-modal").evaluate((element) => ({
      width: element.getBoundingClientRect().width, overflow: getComputedStyle(element).overflowY,
      bottom: element.getBoundingClientRect().bottom,
    }));
    expect(size.width).toBeGreaterThan(900);
    expect(size.overflow).toBe("visible");
    expect(size.bottom).toBeLessThanOrEqual(1000);
    expect(await page.getByLabel(/Job date/).evaluate((element) => getComputedStyle(element).colorScheme)).toBe("light");
    await page.screenshot({ path: path.join(__dirname, "screenshots", `job-preview-${theme}.png`) });
    await page.getByRole("button", { name: "Check details" }).focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close job preview", exact: true })).toBeFocused();
    await page.getByRole("combobox", { name: "New job client" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "New job", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "New job", exact: true })).toHaveCount(0);
  });
}
