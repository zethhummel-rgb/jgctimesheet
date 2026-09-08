const { test, expect } = require("@playwright/test");
const fs = require("fs"), { createHash } = require("crypto");
const { directoryState, serveDirectory } = require("./fixtures/job-readability-fixture");
const { fixture, plan } = require("./fixtures/job-accounting-fixture");
const ExcelJS = require("../vendor/exceljs.min.js");

async function setup(page, options = {}) {
  const captures = await serveDirectory(page, directoryState());
  let preview = fixture();
  if (options.reference) preview = { ...preview, ...options.reference, sourceSnapshot: [], baselineSnapshot: [], previousSnapshot: [] };
  const versions = [], logs = [], calls = [];
  await page.route("**/api/job-accounting-export*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    const body = req.method() === "POST" ? req.postDataJSON() : {};
    calls.push({ method: req.method(), action: body.action });
    if (req.method() === "GET") {
      const id = url.searchParams.get("id");
      if (id) { const record = versions.find((r) => r.id === id); return route.fulfill({ status: record ? 200 : 404, json: record ? { record, requests: logs.filter((r) => r.exportId === id), requestCount: logs.filter((r) => r.exportId === id).length } : { error: "Not found" } }); }
      return route.fulfill({ json: { history: [...versions].reverse(), count: versions.length } });
    }
    if (body.action === "preview") return route.fulfill({ json: { preview, plan: plan(preview) } });
    if (body.action === "save") {
      if (options.stale) return route.fulfill({ status: 409, json: { error: "Jobs or download history changed. Refresh the preview before saving." } });
      const existing = versions.find((r) => r.id === body.id);
      if (existing) return route.fulfill({ json: { record: existing, reused: true } });
      const planned = plan(preview);
      const record = { id: body.id, version: preview.version, file_name: `JGC Accounting Job List - v${String(preview.version).padStart(4, "0")}.xlsx`, file_sha256: body.fileSha256, file_base64: body.fileBase64, exported_by_name: "QA Administrator", exported_at: "2026-09-08T16:00:00Z", rows: planned.rows, summary: planned.summary };
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
  return { captures, versions, logs, calls };
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
  const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes);
  expect(book.worksheets.map((s) => s.name)).toEqual(["2026", "2025", "Download details"]);
  const sheet = book.getWorksheet("2026");
  expect(sheet.getCell("A3").value).toBe("Original 26901");
  expect(sheet.getCell("G3").value).toBe("000123");
  expect(sheet.getCell("J3").value).toBe(1200);
  expect(sheet.getCell("A3").fill.fgColor.argb).toBe("FF92D050");
  expect(sheet.getCell("A4").fill.fgColor.argb).toBe("FFFFFF00");
  expect(sheet.getCell("A3").font.color.argb).toBe("FF000000");
  expect(sheet.views[0].ySplit).toBe(2);
  expect(state.versions).toHaveLength(1);
  const second = await create(page, 2);
  const secondBook = new ExcelJS.Workbook(); await secondBook.xlsx.load(fs.readFileSync(await second.path()));
  expect(secondBook.getWorksheet("2026").getCell("A3").fill.fgColor.argb).toBe("FFFFFF00");
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

test("optional supplied-master QA preserves every coloured reference cell and all year sheets", async ({ page }, testInfo) => {
  test.skip(!process.env.JGC_ACCOUNTING_REFERENCE_PATH, "Private customer workbook is supplied locally, never committed as a fixture.");
  const reference = JSON.parse(fs.readFileSync(process.env.JGC_ACCOUNTING_REFERENCE_PATH, "utf8"));
  const state = await setup(page, { reference });
  const file = await create(page, 1);
  await file.saveAs(testInfo.outputPath("accounting-reference-qa.xlsx"));
  const book = new ExcelJS.Workbook(); await book.xlsx.load(fs.readFileSync(await file.path()));
  const expected = reference.masterRows.filter((r) => r.color !== "white");
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
    expect(sheet.name).toBe(`20${source.jobNumber.slice(0, 2)}`);
    expect(row.getCell(1).fill.fgColor.argb).toBe({ green: "FF92D050", yellow: "FFFFFF00", red: "FFFF0000" }[source.color]);
    for (let c = 0; c < 16; c++) {
      if (c > 0 && c < 5) continue;
      const value = row.getCell(c + 1).value, wanted = source.cells[c];
      expect(value instanceof Date ? { date: value.toISOString().slice(0, 10) } : value ?? null).toEqual(wanted);
      expect(row.getCell(c + 1).formula).toBeUndefined();
    }
  }
  expect(state.versions).toHaveLength(1);
});
