const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("../estimating-app/node_modules/typescript");
const { test, expect } = require("@playwright/test");

const root = path.resolve(__dirname, "..");
const parserSource = fs.readFileSync(path.join(root, "estimating-app/lib/job-workbook-import.ts"), "utf8");
const parserJs = ts.transpileModule(parserSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: "job-workbook-import.ts",
}).outputText.replace(/^export /gm, "");
const parser = vm.runInNewContext(`${parserJs}\n;({ parseJobWorkbook, validateJobImportRecords, jobWorkbookCellText, isJobImportSheet, jobImportNumberKey });`);
const panelSource = fs.readFileSync(path.join(root, "estimating-app/app/job-import-panel.tsx"), "utf8");

const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const row = (values, options = {}) => ({
  fill: options.fill,
  getCell(column) {
    const value = values[column - 1];
    return { value, ...(options.cells?.[column] || {}) };
  },
});
const job = (number, name = "Example job", manager = "ZH", type = "T&M", options) => row([name, "", "", "", "", number, "", manager, "", "", type], options);
const sheet = (name, rows) => ({ name, eachRow(_options, callback) { rows.forEach((entry, index) => callback(entry, index + 1)); } });
const workbook = (...sheets) => ({ worksheets: sheets });

test("Excel job import keeps the established columns and 2025-present sheet boundaries", () => {
  const result = parser.parseJobWorkbook(workbook(
    sheet("2024", [job("24001")]),
    sheet("2025 Jobs", [row(["Client", "Project", "Site", "", "", "25001", "", "AB", "", "", "Contract"])]),
    sheet("2026", [job("26001")]),
    sheet("2027", [job("27001")]),
    sheet("Reference", [job("ignore")]),
  ), 2026);
  expect(result.errors).toEqual([]);
  expect(result.records).toEqual([
    { jobNumber: "25001", jobName: "Client Project Site", projectManager: "AB", jobType: "Contract", active: true },
    { jobNumber: "26001", jobName: "Example job", projectManager: "ZH", jobType: "T&M", active: true },
  ]);
  expect(result.ignoredSheetNames).toEqual(["2024", "2027", "Reference"]);
  expect(parser.isJobImportSheet("2026 Archive", 2026)).toBe(true);
  expect(parser.isJobImportSheet("12026", 2026)).toBe(false);
});

test("Red workbook rows are excluded, other highlights inactive, and white or blank fills active", () => {
  const result = parser.parseJobWorkbook(workbook(sheet("2026", [
    job("1", "Red", "ZH", "Contract", { fill: fill("FFFF0000") }),
    job("2", "Red cell", "ZH", "Contract", { cells: { 11: { fill: fill("FFFFC7CE") } } }),
    job("3", "Indexed red", "ZH", "Contract", { cells: { 6: { fill: { type: "pattern", pattern: "solid", fgColor: { indexed: 10 } } } } }),
    job("4", "Yellow", "ZH", "Contract", { fill: fill("FFFFFF00") }),
    job("5", "Blue cell", "ZH", "T&M", { cells: { 8: { fill: fill("FFDDEEFF") } } }),
    job("6", "White", "ZH", "T&M", { fill: fill("FFFFFFFF") }),
    job("7", "Blank fill"),
    job("8", "No pattern", "ZH", "T&M", { fill: { ...fill("FFFF0000"), pattern: "none" } }),
  ])), 2026);
  expect(result.errors).toEqual([]);
  expect(result.skippedCancelled).toBe(3);
  expect(result.highlightedInactive).toBe(2);
  expect(result.records.map((entry) => [entry.jobNumber, entry.active])).toEqual([["4", false], ["5", false], ["6", true], ["7", true], ["8", true]]);
});

test("Job numbers retain text leading zeros and Excel zero-padded numeric identifiers", () => {
  const result = parser.parseJobWorkbook(workbook(sheet("2026", [
    job("00123", "Text identifier"),
    job(456, "Number mask", "ZH", "T&M", { cells: { 6: { numFmt: "00000" } } }),
    job({ formula: "1+2", result: 3 }, "Cached number", "ZH", "T&M", { cells: { 6: { numFmt: "00000;[Red]-00000" } } }),
    job("0", "Zero identifier"),
  ])), 2026);
  expect(result.errors).toEqual([]);
  expect(result.records.map((entry) => entry.jobNumber)).toEqual(["0", "00003", "00123", "00456"]);
  expect(parser.jobImportNumberKey(" 00123 ")).toBe("00123");
});

test("Rich text, hyperlinks, cached formulas and merged repeated names resolve to values, not formula text", () => {
  const result = parser.parseJobWorkbook(workbook(sheet("2026", [
    row([{ richText: [{ text: "Via " }, { text: "Rail" }] }, "Via Rail", { text: "Brockville", hyperlink: "https://example.invalid" }, "", "", { formula: '"26001"', result: "26001" }, "", { sharedFormula: "H1", result: "ZH" }, "", "", { formula: '"T&M"', result: "T&M" }]),
    job("26002", "Shop Shop Shop"),
  ])), 2026);
  expect(result.errors).toEqual([]);
  expect(result.records[0]).toEqual({ jobNumber: "26001", jobName: "Via Rail Brockville", projectManager: "ZH", jobType: "T&M", active: true });
  expect(result.records[1].jobName).toBe("Shop");
});

test("Missing cached formula results and Excel formula errors block the whole import", () => {
  const result = parser.parseJobWorkbook(workbook(sheet("2026", [
    job("26001"),
    job({ formula: "A1+1" }, "No cached number"),
    job("26003", { formula: '"Name"', result: { error: "#REF!" } }),
    job("26004", "No cached PM", { sharedFormula: "H1" }),
  ])), 2026);
  expect(result.records).toHaveLength(1);
  expect(result.errors.join(" ")).toContain("without a saved result");
  expect(result.errors.join(" ")).toContain("#REF!");
  expect(result.errors.join(" ")).not.toContain("[object Object]");
});

test("Duplicate identifiers across sheets reject the import instead of silently replacing a job", () => {
  const result = parser.parseJobWorkbook(workbook(sheet("2025", [job(" ABC01 ")]), sheet("2026", [job("abc01", "Different job")])), 2026);
  expect(result.errors.join(" ")).toMatch(/Duplicate job number/);
  expect(result.errors.join(" ")).toContain("2025, row 1");
  expect(result.errors.join(" ")).toContain("2026, row 1");
});

test("Blank or wrong-layout workbooks never produce a valid import, and incomplete rows are explained", () => {
  expect(parser.parseJobWorkbook(workbook(sheet("2024", [job("24001")])), 2026).errors.join(" ")).toContain("No 2025–2026 tabs");
  const empty = parser.parseJobWorkbook(workbook(sheet("2026", [job("Job Number", "Job Name"), job("", "Missing job number"), job("26003", "")])), 2026);
  expect(empty.records).toEqual([]);
  expect(empty.skippedIncomplete).toBe(2);
  expect(empty.errors.join(" ")).toContain("No valid jobs");
  expect(empty.warnings.join(" ")).toContain("2 incomplete");
});

test("Import validation safely rejects hostile or malformed API records without throwing", () => {
  for (const candidate of [null, 5, [], { jobNumber: 123, jobName: {} }, { jobNumber: "1", jobName: "Name", active: "true", projectManager: "ZH", jobType: "T&M" }]) {
    expect(() => parser.validateJobImportRecords([candidate])).not.toThrow();
    expect(parser.validateJobImportRecords([candidate]).length).toBeGreaterThan(0);
  }
  const valid = { jobNumber: "001", jobName: "Name", active: true, projectManager: "ZH", jobType: "T&M" };
  expect(parser.validateJobImportRecords([valid])).toEqual([]);
  expect(parser.validateJobImportRecords([{ ...valid, jobName: "x".repeat(301) }]).join(" ")).toContain("exceeds 300");
  expect(parser.validateJobImportRecords([{ ...valid, jobNumber: "1\u0000" }]).length).toBeGreaterThan(0);
  expect(parser.validateJobImportRecords([valid, { ...valid }]).join(" ")).toContain("Duplicate job number");
});

test("Unsafe numeric identifiers and actual dates are not silently converted into job numbers", () => {
  expect(() => parser.jobWorkbookCellText({ value: 9007199254740992 }, true)).toThrow(/preserve exactly/);
  expect(() => parser.jobWorkbookCellText({ value: 12.5 }, true)).toThrow(/whole number/);
  expect(() => parser.jobWorkbookCellText({ value: new Date("2026-09-07") }, true)).toThrow(/unsupported cell value/);
});

test("The bundled Excel reader round-trips cached formulas, styles and leading-zero job numbers", async ({ page }) => {
  await page.setContent("<!doctype html><html><body>Job import parser test</body></html>");
  await page.addScriptTag({ path: path.join(root, "vendor/exceljs.min.js") });
  await page.addScriptTag({ content: `${parserJs}\nwindow.parseJobWorkbook = parseJobWorkbook;` });
  const result = await page.evaluate(async () => {
    const source = new window.ExcelJS.Workbook();
    const sheet = source.addWorksheet("2026 Jobs");
    sheet.getCell("A1").value = "Merged job name";
    sheet.mergeCells("A1:E1");
    sheet.getCell("F1").value = { formula: "100+23", result: 123 };
    sheet.getCell("F1").numFmt = "00000";
    sheet.getCell("H1").value = "ZH";
    sheet.getCell("K1").value = "T&M";
    sheet.getCell("A2").value = "Inactive job";
    sheet.getCell("F2").value = "00124";
    sheet.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
    sheet.getCell("A3").value = "Cancelled job";
    sheet.getCell("F3").value = "00125";
    sheet.getCell("A3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF0000" } };
    const loaded = new window.ExcelJS.Workbook();
    await loaded.xlsx.load(await source.xlsx.writeBuffer());
    return window.parseJobWorkbook(loaded, 2026);
  });
  expect(result.errors).toEqual([]);
  expect(result.records[0]).toEqual({ jobNumber: "00123", jobName: "Merged job name", projectManager: "ZH", jobType: "T&M", active: true });
  expect(result.records[1].active).toBe(false);
  expect(result.skippedCancelled).toBe(1);
});

test("The import panel requires preview and explicit confirmation and never calls a delete endpoint", () => {
  expect(panelSource).toContain('action: "preview"');
  expect(panelSource).toContain('action: "apply"');
  expect(panelSource).toContain("expectedSnapshot: preview.snapshot");
  expect(panelSource).toContain("useState(false)");
  expect(panelSource).toContain("deactivateMissing ? preview.missingJobs.map((job) => job.id) : []");
  expect(panelSource).toContain("disabled={!confirmed || Boolean(busy)}");
  expect(panelSource).toContain("protectedMissingJobs");
  expect(panelSource).toContain("../vendor/exceljs.min.js?v=1");
  expect(panelSource).not.toMatch(/method:\s*["']DELETE["']/);
  expect(panelSource).not.toContain("deleteImportedJobs");
});

async function exampleWorkbookFile() {
  const ExcelJS = require(path.join(root, "vendor/exceljs.min.js"));
  const source = new ExcelJS.Workbook();
  const sheet = source.addWorksheet("2026");
  sheet.getCell("A1").value = "Example T&M job";
  sheet.getCell("F1").value = "00123";
  sheet.getCell("H1").value = "ZH";
  sheet.getCell("K1").value = "T&M";
  return { name: "test-jobs.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(await source.xlsx.writeBuffer()) };
}

async function openImportPanel(page, options = {}) {
  const requests = [];
  const state = {
    version: 14,
    settings: { companyName: "John Gordon Construction Inc.", appName: "JGC Estimate Desk", defaultMarkup: 0.2, targetMargin: 0.15, taxName: "HST", taxRate: 0.13, quotePrefix: "JGC-Q", nextQuoteNumber: 1, defaultValidityDays: 30 },
    clients: [], vendors: [], priceBook: [], quotes: [], jobs: [], activity: [],
  };
  await page.route("**/api/state", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(route.request().method() === "PUT" ? { saved: true, updatedAt: "2026-09-07T12:00:00Z" } : { state, updatedAt: "2026-09-07T12:00:00Z" }) }));
  await page.route("**/api/job-costing", (route) => route.fulfill({ status: 200, contentType: "application/json", body: '{"actuals":[]}' }));
  await page.route("**/api/jobs", (route) => route.fulfill({ status: options.refreshFails ? 503 : 200, contentType: "application/json", body: JSON.stringify(options.refreshFails ? { error: "Refresh temporarily unavailable" } : { jobs: [] }) }));
  await page.route("**/api/job-import", (route) => {
    const request = route.request().postDataJSON();
    requests.push(request);
    if (request.action === "apply") return route.fulfill({ status: options.stale ? 409 : 200, contentType: "application/json", body: JSON.stringify(options.stale ? { error: "The Portal job list or workbook changed after preview. Preview again before importing." } : { saved: true, message: "Import saved successfully." }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ preview: {
      insertCount: 1, updateCount: 0, activeCount: 1, inactiveCount: 0, snapshot: "reviewed-snapshot",
      missingJobs: [{ id: "unquoted-missing", jobNumber: "26050", jobName: "Prior unquoted job" }],
      protectedMissingJobs: [{ id: "protected-job", jobNumber: "26051", jobName: "Won quote job" }],
    } }) });
  });
  await page.goto("/estimating/index.html?dev=1");
  const navigation = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await navigation.isVisible()) await navigation.click();
  await page.getByRole("button", { name: /Jobs/ }).click();
  await page.locator(".job-import-disclosure > summary").click();
  const panel = page.locator(".job-import-panel");
  await expect(panel).toBeVisible();
  await panel.getByLabel("Excel job-list workbook").setInputFiles(await exampleWorkbookFile());
  await expect(panel.getByTestId("job-import-preview")).toBeVisible();
  return { panel, requests };
}

test("Import preview makes no changes until confirmation and deactivates only explicitly reviewed missing jobs", async ({ page }, testInfo) => {
  const { panel, requests } = await openImportPanel(page);
  expect(requests.map((request) => request.action)).toEqual(["preview"]);
  const submit = panel.getByRole("button", { name: /^Confirm and import 1 jobs?$/ });
  await expect(submit).toBeDisabled();
  const missing = panel.getByRole("checkbox", { name: /Also mark these/ });
  const confirmation = panel.getByRole("checkbox", { name: /I have reviewed/ });
  await expect(missing).not.toBeChecked();
  await expect(panel).toContainText("quote-linked job(s) missing from this workbook will stay unchanged");
  await confirmation.check();
  await expect(submit).toBeEnabled();
  await missing.check();
  await expect(confirmation).not.toBeChecked();
  await expect(submit).toBeDisabled();
  await confirmation.check();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("job-import-desktop.png"), fullPage: true });
  await submit.click();
  await expect(panel).toContainText("Import saved successfully.");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({ action: "apply", expectedSnapshot: "reviewed-snapshot", deactivateMissingJobIds: ["unquoted-missing"] });
  expect(requests[1].records[0].jobNumber).toBe("00123");
  expect(requests[1].deactivateMissingJobIds).not.toContain("protected-job");
});

test("Missing jobs stay unchanged by default and a refresh failure does not offer a saved import for retry", async ({ page }) => {
  const { panel, requests } = await openImportPanel(page, { refreshFails: true });
  await panel.getByRole("checkbox", { name: /I have reviewed/ }).check();
  await panel.getByRole("button", { name: /^Confirm and import 1 jobs?$/ }).click();
  await expect(panel).toContainText("The import was saved, but the job list could not refresh");
  expect(requests[1].deactivateMissingJobIds).toEqual([]);
  await expect(panel.getByRole("button", { name: /Confirm and import/ })).toHaveCount(0);
});

test("A stale import clears confirmation, requires a fresh preview and remains contained on mobile", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { panel, requests } = await openImportPanel(page, { stale: true });
  await panel.getByRole("checkbox", { name: /I have reviewed/ }).check();
  await panel.getByRole("button", { name: /^Confirm and import 1 jobs?$/ }).click();
  await expect(panel).toContainText("changed after preview");
  await expect(panel.getByTestId("job-import-preview")).toHaveCount(0);
  await panel.getByRole("button", { name: "Refresh import preview" }).click();
  await expect(panel.getByTestId("job-import-preview")).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: /I have reviewed/ })).not.toBeChecked();
  expect(requests.map((request) => request.action)).toEqual(["preview", "apply", "preview"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("job-import-mobile.png"), fullPage: true });
});
