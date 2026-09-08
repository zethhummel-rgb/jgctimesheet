const fs = require("fs"), path = require("path"), vm = require("vm");
const ts = require("../estimating-app/node_modules/typescript");
const { test, expect } = require("@playwright/test");
const modulePath = path.join(__dirname, "../estimating-app/lib/job-accounting-export.ts");
const compiled = ts.transpileModule(fs.readFileSync(modulePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const loaded = { exports: {} };
vm.runInNewContext(compiled, { module: loaded, exports: loaded.exports, console });
const { planJobAccountingExport: plan } = loaded.exports;
const job = (number, changes = {}) => ({ jobNumber: number, jobName: `Job ${number}`, active: true, cancelledAt: null, statusChangedAt: null, projectManager: "ZH", jobType: "T&M", customer: "Client", site: "Site", address: "Address", startDate: null, targetEndDate: null, price: null, extras: null, acceptedAt: null, customerPo: "", quoteReference: "", ...changes });
const master = (number, color) => ({ jobNumber: number, color, cells: [`Original ${number}`, null, null, null, null, number, "000123", "ZH", null, 1200, "T&M", null, "yes", { date: "2026-07-16" }, null, null] });
const fixture = () => {
  const jobs = [job("26901", { active: false }), job("26902", { active: false }), job("26904")];
  return { version: 1, previousExportId: null, sourceSnapshot: structuredClone(jobs), baselineSnapshot: structuredClone(jobs), previousSnapshot: structuredClone(jobs), masterRows: [master("26901", "green"), master("26902", "yellow"), master("25903", "red"), master("26904", "white")], previousRows: [], sourceName: "Synthetic master.xlsx", sourceSha256: "a".repeat(64), trackingStartedAt: "2026-09-08T12:00:00Z" };
};
const next = (p, rows) => ({ ...p, version: p.version + 1, previousExportId: `version-${p.version}`, previousSnapshot: structuredClone(p.sourceSnapshot), previousRows: structuredClone(rows) });

test("first version preserves master colours/values and includes unchanged active jobs", () => {
  const p = fixture(), result = plan(p);
  expect(result.rows.map((r) => [r.jobNumber, r.color])).toEqual([["25903", "red"], ["26901", "green"], ["26902", "yellow"], ["26904", "white"]]);
  expect(result.rows[1].cells).toEqual(p.masterRows[0].cells);
  expect(result.summary).toMatchObject({ total: 4, green: 1, yellow: 1, red: 1, white: 1, missingFromPortal: 1 });
});
test("green becomes yellow only in subsequent versions; original snapshot is unchanged", () => {
  const p = fixture(), first = plan(p), original = JSON.stringify(first);
  const second = plan(next(p, first.rows));
  expect(second.rows.map((r) => [r.jobNumber, r.color])).toEqual([["25903", "red"], ["26901", "yellow"], ["26902", "yellow"], ["26904", "white"]]);
  expect(JSON.stringify(first)).toBe(original);
  expect(plan(next(next(p, first.rows), second.rows)).summary.yellow).toBe(2);
});
test("new/changed active jobs appear white; identifiers remain text and missing price stays blank", () => {
  const p = fixture();
  p.sourceSnapshot[2].jobName = "Updated active project";
  p.sourceSnapshot.push(job("26905", { projectManager: "Jeff Vandrish", startDate: "2026-09-09" }));
  const rows = plan(p).rows;
  expect(rows.find((r) => r.jobNumber === "26904").cells[0]).toBe("Updated active project");
  expect(rows.find((r) => r.jobNumber === "26905")).toMatchObject({ color: "white", change: "New job" });
  expect(rows.find((r) => r.jobNumber === "26905").cells.slice(5, 11)).toEqual(["26905", null, "JV", { date: "2026-09-09" }, null, "T&M"]);
});
test("reopen then reclose before the next download creates a fresh green event", () => {
  let p = fixture(); p = next(p, plan(p).rows);
  p.sourceSnapshot[0].statusChangedAt = "2026-09-09T13:00:00Z";
  const closed = plan(p);
  expect(closed.rows.find((r) => r.jobNumber === "26901").color).toBe("green");
  expect(plan(next(p, closed.rows)).rows.find((r) => r.jobNumber === "26901").color).toBe("yellow");
});
test("reactivation is white, cancellation is red, and detail-only changes remain yellow", () => {
  let p = fixture(); p = next(p, plan(p).rows);
  p.sourceSnapshot[0].customer = "Revised client";
  expect(plan(p).rows.find((r) => r.jobNumber === "26901")).toMatchObject({ color: "yellow", changed: true, customer: "Revised client" });
  p.sourceSnapshot[0].active = true; p.sourceSnapshot[0].statusChangedAt = "2026-09-09T12:00:00Z";
  expect(plan(p).rows.find((r) => r.jobNumber === "26901").color).toBe("white");
  p.sourceSnapshot[0].active = false; p.sourceSnapshot[0].cancelledAt = "2026-09-09T12:01:00Z";
  expect(plan(p).rows.find((r) => r.jobNumber === "26901").color).toBe("red");
});
test("an inactive-only Excel import does not invent an invoicing instruction", () => {
  const p = fixture(); p.sourceSnapshot[2].active = false;
  expect(plan(p).rows.some((r) => r.jobNumber === "26904")).toBe(false);
  expect(plan(p).summary.reviewInactive).toBe(1);
});
test("new canonical fields override reference only when changed; zero is not missing", () => {
  const p = fixture(); p.sourceSnapshot[0].price = 0; p.sourceSnapshot[0].extras = 45;
  p.sourceSnapshot[0].customerPo = "0000088";
  const row = plan(p).rows.find((r) => r.jobNumber === "26901");
  expect(row.cells[9]).toBe(0); expect(row.cells[11]).toBe(45); expect(row.cells[6]).toBe("0000088");
});
test("duplicate official numbers fail closed", () => {
  const p = fixture(); p.sourceSnapshot.push(p.sourceSnapshot[0]);
  expect(() => plan(p)).toThrow(/Duplicate/);
});

test("existing accepted-estimate pricing overrides the starting master without losing imported-only prices", () => {
  const p = fixture();
  for (const snapshot of [p.sourceSnapshot, p.baselineSnapshot, p.previousSnapshot]) {
    snapshot[0].price = 2500; snapshot[0].extras = 150;
  }
  const rows = plan(p).rows;
  expect(rows.find((r) => r.jobNumber === "26901").cells[9]).toBe(2500);
  expect(rows.find((r) => r.jobNumber === "26901").cells[11]).toBe(150);
  expect(rows.find((r) => r.jobNumber === "26902").cells[9]).toBe(1200);
});
test("only explicit status actions change the new marker; uploader logic remains independent", () => {
  const api = fs.readFileSync(path.join(__dirname, "../estimating-app/src/portal-api.ts"), "utf8");
  const importer = api.slice(api.indexOf("async function jobImportResponse"), api.indexOf("function vendorPayload"));
  expect(importer).not.toMatch(/job_accounting|accounting_status_changed_at/);
  expect(api).toContain("payload.accounting_status_changed_at = payload.updated_at;");
});

module.exports = { fixture, next, plan, job, master };

test("blue is handed off once, then yellow through repeated downloads, edits and missing portal rows; reset starts fresh", () => {
  let p = fixture();
  p.sourceSnapshot[0] = { ...p.sourceSnapshot[0], invoiceReviewAt: "2026-09-08T18:00:00Z", statusChangedAt: "2026-09-08T18:00:00Z" };
  for (let i = 0; i < 3; i++) {
    const result = plan(p);
    expect(result.rows.find(r => r.jobNumber === "26901").color).toBe(i === 0 ? "blue" : "yellow");
    expect(result.summary.blue).toBe(i === 0 ? 1 : 0);
    p = next(p, result.rows);
    p.sourceSnapshot[0].customer = "Changed details";
  }
  const reset = { ...p, version: 0, previousExportId: null, previousRows: [] };
  expect(plan(reset).summary.blue).toBe(1);
  expect(plan(next(reset, plan(reset).rows)).summary.blue).toBe(0);
  p.sourceSnapshot = p.sourceSnapshot.filter(j => j.jobNumber !== "26901");
  expect(plan(p).rows.find(r => r.jobNumber === "26901").color).toBe("yellow");
});

test("missing portal row immediately after a blue hand-off stays yellow in later downloads", () => {
  let p = fixture();
  p.sourceSnapshot[0] = { ...p.sourceSnapshot[0], invoiceReviewAt: "2026-09-08T18:00:00Z", statusChangedAt: "2026-09-08T18:00:00Z" };
  const first = plan(p), saved = JSON.stringify(first);
  p = next(p, first.rows); p.sourceSnapshot.shift();
  expect(plan(p).rows.find(r => r.jobNumber === "26901").color).toBe("yellow");
  expect(plan(next(p, plan(p).rows)).rows.find(r => r.jobNumber === "26901").color).toBe("yellow");
  expect(JSON.stringify(first)).toBe(saved);
});

test("a fresh discussion after reopening is blue again even if the previous download was yellow", () => {
  let p = fixture();
  p.sourceSnapshot[0] = { ...p.sourceSnapshot[0], invoiceReviewAt: "2026-09-08T18:00:00Z", statusChangedAt: "2026-09-08T18:00:00Z" };
  p = next(p, plan(p).rows); p = next(p, plan(p).rows);
  p.sourceSnapshot[0].invoiceReviewAt = p.sourceSnapshot[0].statusChangedAt = "2026-09-08T20:00:00Z";
  expect(plan(p).summary.blue).toBe(1);
  expect(plan(next(p, plan(p).rows)).summary.blue).toBe(0);
});

test("resolving a blue job is green once, then yellow; reopen/cancel clear the blue meaning", () => {
  let p = fixture();
  p.sourceSnapshot[1] = { ...p.sourceSnapshot[1], invoiceReviewAt: "2026-09-08T18:00:00Z", statusChangedAt: "2026-09-08T18:00:00Z" };
  p = next(p, plan(p).rows);
  p.sourceSnapshot[1].invoiceReviewAt = null;
  p.sourceSnapshot[1].statusChangedAt = "2026-09-08T19:00:00Z";
  const resolved = plan(p);
  expect(resolved.rows.find(r => r.jobNumber === "26902")).toMatchObject({ color: "green", change: "Discussion resolved - ready to invoice" });
  expect(plan(next(p, resolved.rows)).rows.find(r => r.jobNumber === "26902").color).toBe("yellow");
  p.sourceSnapshot[1].active = true;
  expect(plan(p).rows.find(r => r.jobNumber === "26902").color).toBe("white");
  p.sourceSnapshot[1].active = false; p.sourceSnapshot[1].cancelledAt = "2026-09-08T20:00:00Z";
  expect(plan(p).rows.find(r => r.jobNumber === "26902").color).toBe("red");
});

test("new nullable field does not mark legacy snapshots as changed", () => {
  const p = fixture(); p.sourceSnapshot.forEach(j => { j.invoiceReviewAt = null; });
  expect(plan(p).rows.find(r => r.jobNumber === "26904").changed).toBe(false);
});

test("reset after V20 restores green without clearing original yellow or changing any job", () => {
  let p = fixture(); const original = JSON.stringify(p);
  for (let i = 1; i <= 20; i++) { const result = plan(p); expect(result.summary.total).toBe(4); p = next(p, result.rows); }
  expect(plan(p).summary).toMatchObject({ green: 0, yellow: 2, white: 1, red: 1 });
  const reset = { ...p, cycle: 2, version: 0, previousExportId: null, previousRows: [], previousSnapshot: structuredClone(p.baselineSnapshot) };
  expect(plan(reset).summary).toMatchObject({ green: 1, yellow: 1, white: 1, red: 1 });
  expect(JSON.stringify(reset.sourceSnapshot)).toBe(JSON.stringify(JSON.parse(original).sourceSnapshot));
  expect(next(reset, plan(reset).rows).version).toBe(1);
  expect(plan(next(reset, plan(reset).rows)).summary).toMatchObject({ green: 0, yellow: 2, white: 1, red: 1 });
});

test("previously handed-off new jobs remain in history downloads if removed from the portal", () => {
  let p = fixture(); p.sourceSnapshot.push(job("26999", { active: false, statusChangedAt: "2026-09-08T12:00:00Z", price: 99 }));
  const first = plan(p); p = next(p, first.rows); p.sourceSnapshot = p.sourceSnapshot.filter((j) => j.jobNumber !== "26999");
  const second = plan(p), row = second.rows.find((r) => r.jobNumber === "26999");
  expect(row.color).toBe("yellow"); expect(row.cells[9]).toBe(99);
  expect(plan(next(p, second.rows)).rows.find((r) => r.jobNumber === "26999").color).toBe("yellow");
});
