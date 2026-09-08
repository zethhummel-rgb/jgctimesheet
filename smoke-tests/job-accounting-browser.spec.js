const { test, expect } = require("@playwright/test");
const fs = require("fs"), { createHash } = require("crypto");
const { directoryState, serveDirectory } = require("./fixtures/job-readability-fixture");
const { fixture, plan, helpers } = require("./fixtures/job-accounting-fixture");
const ExcelJS = require("../vendor/exceljs.min.js");

async function setup(page, options = {}) {
  const captures = await serveDirectory(page, directoryState());
  let preview = fixture();
  if (options.reference) preview = { ...preview, ...options.reference, sourceSnapshot: [], baselineSnapshot: [], previousSnapshot: [] };
  const versions = [], logs = [], calls = [], resets = [];
  await page.route("**/api/job-accounting-export*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    const body = req.method() === "POST" ? req.postDataJSON() : {};
    calls.push({ method: req.method(), action: body.action });
    if (req.method() === "GET") {
      const id = url.searchParams.get("id");
      if (id) { const record = versions.find((r) => r.id === id); return route.fulfill({ status: record ? 200 : 404, json: record ? { record, requests: logs.filter((r) => r.exportId === id), requestCount: logs.filter((r) => r.exportId === id).length } : { error: "Not found" } }); }
      return route.fulfill({ json: { history: [...versions].reverse(), count: versions.length, state: { cycle: preview.cycle, nextVersion: preview.version, latestExportId: preview.previousExportId, lastResetAt: resets.length ? "2026-09-08T17:00:00Z" : null, lastResetBy: "QA Administrator" } } });
    }
    if (body.action === "preview") return route.fulfill({ json: { preview, plan: plan(preview) } });
    if (body.action === "reset") {
      const previous = resets.find((r) => r.id === body.id);
      if (previous) return route.fulfill({ json: { reset: previous } });
      if (body.confirmation !== "RESET TO V0" || body.expectedCycle !== preview.cycle || body.expectedExportId !== preview.previousExportId) return route.fulfill({ status: 409, json: { error: "Download history changed. Refresh history before resetting." } });
      const reset = { id: body.id, cycle: preview.cycle + 1 }; resets.push(reset);
      preview = { ...preview, cycle: reset.cycle, version: 0, previousExportId: null, previousRows: [], previousSnapshot: structuredClone(preview.baselineSnapshot) };
      if (options.lostResetResponse && resets.length === 1) return route.abort("connectionfailed");
      return route.fulfill({ json: { reset } });
    }
    if (body.action === "save") {
      if (options.stale) return route.fulfill({ status: 409, json: { error: "Jobs or download history changed. Refresh the preview before saving." } });
      const existing = versions.find((r) => r.id === body.id);
      if (existing) return route.fulfill({ json: { record: existing, reused: true } });
      const planned = plan(preview);
      const record = { id: body.id, cycle: preview.cycle, version: preview.version, file_name: helpers.accountingExportFilename(preview.version, preview.cycle), file_sha256: body.fileSha256, file_base64: body.fileBase64, exported_by_name: "QA Administrator", exported_at: "2026-09-08T16:00:00Z", rows: planned.rows, summary: planned.summary };
      versions.push(record);
      preview = { ...preview, version: preview.version + 1, previousExportId: record.id, previousSnapshot: structuredClone(preview.sourceSnapshot), previousRows: structuredClone(planned.rows) };
      if (options.lostSaveResponse && versions.length === 1) return route.abort("connectionfailed");
      return route.fulfill({ json: { record } });
    }
    if (body.action === "download") {
      const record = versions.find((r) => r.id === body.exportId);
      if (options.failDownload) return route.fulfill({ status: 500, json: { error: "Download connection interrupted" } });
      logs.push({ id: body.requestId, exportId: record.id, downloaded_by_name: "QA Administrator", requested_at: "2026-09-08T16:01:00Z" });
      return route.fulfill({ json: { record } });
    }
    return route.fulfill({ status: 400, json: { error: "Unexpected request" } });
  });
  if (!options.collapsed) await page.locator(".job-accounting-disclosure > summary").click();
  return { captures, versions, logs, calls, resets };
}
async function create(page, version) {
  await page.getByRole("button", { name: "Download accounting job list", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Preview version ${version}` })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: `Create version ${version} & download`, exact: true }).click();
  const file = await download;
  await expect(page.getByRole("heading", { name: `Saved version ${version}`, exact: true })).toBeVisible();
  return file;
}

test("real XLSX, exact old-version download, green-to-yellow and history leave jobs/uploader untouched", async ({ page }, testInfo) => {
  const state = await setup(page);
  const first = await create(page, 1);
  const bytes = fs.readFileSync(await first.path());
  await first.saveAs(testInfo.outputPath("accounting-full-list-qa.xlsx"));
  const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes);
  expect(book.worksheets.map((s) => s.name)).toEqual(["2026", "2025", "Download details"]);
  const sheet = book.getWorksheet("2026");
  expect(sheet.getCell("A3").value).toBe("Original 26901");
  expect(sheet.getCell("G3").value).toBe("000123");
  expect(sheet.getCell("J3").value).toBe(1200);
  expect(sheet.getCell("A3").fill.fgColor.argb).toBe("FF92D050");
  expect(sheet.getCell("A4").fill.fgColor.argb).toBe("FFFFFF00");
  expect(sheet.getCell("A5").value).toBe("Original 26904");
  expect(sheet.getCell("A5").fill.fgColor.argb).toBe("FFFFFFFF");
  expect(sheet.getCell("A3").font.color.argb).toBe("FF000000");
  expect(sheet.views[0].ySplit).toBe(2);
  expect(sheet.properties.defaultRowHeight).toBe(12.75);
  expect(sheet.getCell("A1").font).toMatchObject({ name: "Arial", size: 10 });
  expect(Boolean(sheet.getCell("A1").font.bold)).toBe(false);
  for (const s of book.worksheets) s.eachRow((row) => {
    expect(row.height ?? s.properties.defaultRowHeight).toBe(12.75);
    row.eachCell((cell) => { expect(cell.font.name).toBe("Arial"); expect(cell.font.size).toBe(10); });
  });
  expect(sheet.getCell("A3").alignment.wrapText ?? false).toBe(false);
  expect(state.versions).toHaveLength(1);
  const second = await create(page, 2);
  const secondBook = new ExcelJS.Workbook(); await secondBook.xlsx.load(fs.readFileSync(await second.path()));
  expect(secondBook.getWorksheet("2026").getCell("A3").fill.fgColor.argb).toBe("FFFFFF00");
  expect(secondBook.getWorksheet("2026").getCell("A5").fill.fgColor.argb).toBe("FFFFFFFF");
  expect(secondBook.getWorksheet("2025").getCell("A3").fill.fgColor.argb).toBe("FFFF0000");
  await page.locator(".job-accounting-history > summary").click();
  const oldDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download v1", exact: true }).click();
  const old = fs.readFileSync(await (await oldDownload).path());
  expect(old.equals(bytes)).toBe(true);
  expect(createHash("sha256").update(old).digest("hex")).toBe(state.versions[0].file_sha256);
  expect(state.versions).toHaveLength(2); expect(state.logs).toHaveLength(3);
  await expect(page.getByRole("heading", { name: "Download requests for version 1 (2)" })).toBeVisible();
  expect(state.captures.jobInfo).toEqual([]); expect(state.captures.writes).toEqual([]);
  await expect(page.locator(".job-import-disclosure > summary")).toHaveText("Excel job-list upload");
  if (process.env.JGC_CAPTURE_VISUAL_QA) await page.locator(".job-accounting-panel").screenshot({ path: testInfo.outputPath("accounting-desktop.png") });
});
test("stale preview creates no version or download request", async ({ page }) => {
  const state = await setup(page, { stale: true });
  await page.getByRole("button", { name: "Download accounting job list", exact: true }).click();
  await page.getByRole("button", { name: "Create version 1 & download", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Refresh the preview");
  expect(state.versions).toEqual([]); expect(state.logs).toEqual([]);
});
test("lost save response is recovered without consuming green twice", async ({ page }) => {
  const state = await setup(page, { lostSaveResponse: true });
  await page.getByRole("button", { name: "Download accounting job list", exact: true }).click();
  await page.getByRole("button", { name: "Create version 1 & download", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(state.versions).toHaveLength(1);
  await page.getByRole("button", { name: "Download accounting job list", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Saved version 1", exact: true })).toBeVisible();
  expect(state.versions).toHaveLength(1);
  await expect(page.locator(".job-accounting-panel")).toContainText("Your previous version was saved");
});
test("delivery failure retains the saved file and offers recovery from history", async ({ page }) => {
  const state = await setup(page, { failDownload: true });
  await page.getByRole("button", { name: "Download accounting job list", exact: true }).click();
  await page.getByRole("button", { name: "Create version 1 & download", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("safely saved in Download history");
  expect(state.versions).toHaveLength(1); expect(state.logs).toHaveLength(0);
});
test("mobile accounting controls remain readable without overflowing the page", async ({ page }, testInfo) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Download accounting job list", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Preview version 1" })).toBeVisible();
  const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.width + 1);
  const chips = await page.locator(".job-accounting-legend .accounting-chip").evaluateAll((els) => els.map((el) => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor })));
  expect(chips.every((chip) => chip.color !== chip.background && chip.color !== "rgb(255, 255, 255)")).toBe(true);
  if (process.env.JGC_CAPTURE_VISUAL_QA) await page.locator(".job-accounting-panel").screenshot({ path: testInfo.outputPath("accounting-mobile.png") });
});

for (const width of [390, 1366]) test(`accounting download collapses like the upload without losing its preview at ${width}px`, async ({ page }, testInfo) => {
  const state = await setup(page, { collapsed: true });
  await page.setViewportSize({ width, height: 900 });
  const disclosure = page.locator(".job-accounting-disclosure");
  const toggle = disclosure.locator(":scope > summary");
  await expect(disclosure).not.toHaveAttribute("open");
  await expect(page.getByRole("button", { name: "Download accounting job list", exact: true })).toBeHidden();
  const appearance = await page.locator(".job-import-disclosure > summary, .job-accounting-disclosure > summary").evaluateAll((items) => items.map((el) => { const s = getComputedStyle(el); return { padding: s.padding, fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color, height: el.getBoundingClientRect().height }; }));
  expect(appearance[1]).toEqual(appearance[0]);
  if (process.env.JGC_CAPTURE_VISUAL_QA) await disclosure.screenshot({ path: testInfo.outputPath(`collapsed-download-${width}.png`) });
  await toggle.focus(); await page.keyboard.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  await page.getByRole("button", { name: "Download accounting job list", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Preview version 1" })).toBeVisible();
  await toggle.click();
  await expect(page.getByRole("heading", { name: "Preview version 1" })).toBeHidden();
  await toggle.focus(); await page.keyboard.press("Space");
  await expect(page.getByRole("heading", { name: "Preview version 1" })).toBeVisible();
  expect(state.versions).toEqual([]); expect(state.logs).toEqual([]);
  expect(state.captures.jobInfo).toEqual([]); expect(state.captures.writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

for (const lostResetResponse of [false, true]) test(`confirmed reset preserves old files and restarts green at V0 (lost response: ${lostResetResponse})`, async ({ page }, testInfo) => {
  const state = await setup(page, { lostResetResponse });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Reset downloads to V0", exact: true })).toBeDisabled();
  await create(page, 1); await create(page, 2);
  const old = JSON.stringify(state.versions), oldFile = state.versions[0].file_base64;
  await page.getByRole("button", { name: "Reset downloads to V0", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm reset to V0", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Keep current versions", exact: true }).click();
  expect(state.resets).toHaveLength(0);
  await page.getByRole("button", { name: "Reset downloads to V0", exact: true }).click();
  await page.getByLabel("Type RESET TO V0 to confirm", { exact: true }).fill("RESET TO V0");
  const inputStyle = await page.getByLabel("Type RESET TO V0 to confirm", { exact: true }).evaluate((el) => { const s = getComputedStyle(el); return { color: s.color, fill: s.webkitTextFillColor, background: s.backgroundColor, scheme: s.colorScheme }; });
  expect(inputStyle.background).toBe("rgb(255, 255, 255)"); expect(inputStyle.scheme).toBe("light");
  expect(inputStyle.color).not.toBe(inputStyle.background); expect(inputStyle.fill).toBe(inputStyle.color);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (process.env.JGC_CAPTURE_VISUAL_QA) await page.getByRole("region", { name: "Confirm accounting reset" }).screenshot({ path: testInfo.outputPath("reset-confirmation-mobile.png") });
  await page.getByRole("button", { name: "Confirm reset to V0", exact: true }).click();
  if (lostResetResponse) {
    await expect(page.getByRole("alert")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page.getByRole("button", { name: /^Jobs(?:\s|$)/ }).click();
    await page.locator(".job-accounting-disclosure > summary").click();
    await page.getByLabel("Type RESET TO V0 to confirm", { exact: true }).fill("RESET TO V0");
    await page.getByRole("button", { name: "Retry confirmed reset", exact: true }).click();
  }
  await expect(page.locator(".job-accounting-panel")).toContainText("Next download: V0 · Run 2");
  expect(state.resets).toHaveLength(1); expect(JSON.stringify(state.versions)).toBe(old);
  await expect(page.getByRole("button", { name: "Reset downloads to V0", exact: true })).toBeDisabled();
  const restarted = await create(page, 0);
  await expect(page.locator(".job-accounting-panel")).toContainText("Next download: V1 · Run 2");
  expect(restarted.suggestedFilename()).toBe("JGC Accounting Job List - v0000 - run2.xlsx");
  await restarted.saveAs(testInfo.outputPath("accounting-reset-v0-qa.xlsx"));
  const book = new ExcelJS.Workbook(); await book.xlsx.load(fs.readFileSync(await restarted.path()));
  expect(book.getWorksheet("2026").getCell("A3").fill.fgColor.argb).toBe("FF92D050");
  expect(book.getWorksheet("2026").getCell("A4").fill.fgColor.argb).toBe("FFFFFF00");
  expect(book.getWorksheet("2026").getCell("A5").fill.fgColor.argb).toBe("FFFFFFFF");
  expect(book.getWorksheet("2025").getCell("A3").fill.fgColor.argb).toBe("FFFF0000");
  expect(book.getWorksheet("Download details").getCell("A1").value).toContain("Version 0 · Run 2");
  await page.locator(".job-accounting-history > summary").click();
  const oldRow = page.locator(".job-accounting-history tbody tr").filter({ hasText: "Run 1 · Previous run" }).filter({ has: page.getByRole("button", { name: "Download v1", exact: true }) });
  const downloaded = page.waitForEvent("download");
  await oldRow.getByRole("button", { name: "Download v1", exact: true }).click();
  expect(fs.readFileSync(await (await downloaded).path()).toString("base64")).toBe(oldFile);
  expect(state.versions).toHaveLength(3); expect(state.captures.jobInfo).toEqual([]); expect(state.captures.writes).toEqual([]);
  const subsequent = await create(page, 1);
  expect(subsequent.suggestedFilename()).toBe("JGC Accounting Job List - v0001 - run2.xlsx");
  const nextBook = new ExcelJS.Workbook(); await nextBook.xlsx.load(fs.readFileSync(await subsequent.path()));
  expect(nextBook.getWorksheet("2026").getCell("A3").fill.fgColor.argb).toBe("FFFFFF00");
  expect(nextBook.getWorksheet("Download details").getCell("A1").value).toContain("Version 1 · Run 2");
  expect(state.versions).toHaveLength(4);
  expect(state.versions[2].file_base64).toBe(fs.readFileSync(await restarted.path()).toString("base64"));
  expect(state.captures.jobInfo).toEqual([]); expect(state.captures.writes).toEqual([]);
});

test("optional supplied-master QA preserves every reference cell and all year sheets", async ({ page }, testInfo) => {
  test.skip(!process.env.JGC_ACCOUNTING_REFERENCE_PATH, "Private customer workbook is supplied locally, never committed as a fixture.");
  const reference = JSON.parse(fs.readFileSync(process.env.JGC_ACCOUNTING_REFERENCE_PATH, "utf8"));
  const state = await setup(page, { reference });
  const file = await create(page, 1);
  await file.saveAs(testInfo.outputPath("accounting-reference-qa.xlsx"));
  const book = new ExcelJS.Workbook(); await book.xlsx.load(fs.readFileSync(await file.path()));
  const expected = reference.masterRows;
  const actual = new Map();
  for (const sheet of book.worksheets.filter((s) => /^20\d{2}$/.test(s.name))) {
    sheet.eachRow((r, number) => { if (number >= 3 && /^\d{5,}$/.test(String(r.getCell(6).value ?? ""))) actual.set(String(r.getCell(6).value), { row: r, sheet }); });
  }
  expect(actual.size).toBe(expected.length);
  for (let row = 6; row <= expected.length + 5; row++) {
    for (const column of [4, 5, 6, 7]) expect(book.getWorksheet("Download details").getCell(row, column).value).toBeNull();
  }
  for (const sheet of book.worksheets.filter((s) => /^20\d{2}$/.test(s.name))) expect(sheet.headerFooter.oddFooter).toContain("&CVersion 1");
  for (const source of expected) {
    const { row, sheet } = actual.get(source.jobNumber);
    expect(row.height ?? sheet.properties.defaultRowHeight).toBe(12.75);
    expect(row.getCell(1).font).toMatchObject({ name: "Arial", size: 10 });
    expect(row.getCell(1).alignment.wrapText ?? false).toBe(false);
    expect(sheet.name).toBe(`20${source.jobNumber.slice(0, 2)}`);
    expect(row.getCell(1).fill.fgColor.argb).toBe({ white: "FFFFFFFF", green: "FF92D050", yellow: "FFFFFF00", red: "FFFF0000" }[source.color]);
    for (let c = 0; c < 16; c++) {
      if (c > 0 && c < 5) continue;
      const value = row.getCell(c + 1).value, wanted = source.cells[c];
      expect(value instanceof Date ? { date: value.toISOString().slice(0, 10) } : value ?? null).toEqual(wanted);
      expect(row.getCell(c + 1).formula).toBeUndefined();
    }
  }
  expect(state.versions).toHaveLength(1);
});
