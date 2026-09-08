const fs = require("fs"), path = require("path"), vm = require("vm");
const ts = require("../../estimating-app/node_modules/typescript");
const { webcrypto } = require("crypto");
function load(relative, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../..", relative), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => dependencies[name] ?? {}, console, crypto: webcrypto, Uint8Array, Response, Request, URL, atob, btoa });
  return module.exports;
}
const helpers = load("estimating-app/lib/job-accounting-export.ts");
const job = (number, changes = {}) => ({ jobNumber: number, jobName: `Job ${number}`, active: true, cancelledAt: null, statusChangedAt: null, projectManager: "ZH", jobType: "T&M", customer: "Client", site: "Site", address: "Address", startDate: null, targetEndDate: null, price: null, extras: null, acceptedAt: null, customerPo: "", quoteReference: "", ...changes });
const master = (number, color) => ({ jobNumber: number, color, cells: [`Original ${number}`, null, null, null, null, number, "000123", "ZH", null, 1200, "T&M", null, "yes", { date: "2026-07-16" }, null, null] });
const fixture = () => {
  const jobs = [job("26901", { active: false }), job("26902", { active: false }), job("26904")];
  return { version: 1, previousExportId: null, sourceSnapshot: structuredClone(jobs), baselineSnapshot: structuredClone(jobs), previousSnapshot: structuredClone(jobs), masterRows: [master("26901", "green"), master("26902", "yellow"), master("25903", "red"), master("26904", "white")], previousRows: [], sourceName: "Synthetic master.xlsx", sourceSha256: "a".repeat(64), trackingStartedAt: "2026-09-08T12:00:00Z" };
};
const next = (p, rows) => ({ ...p, version: p.version + 1, previousExportId: `version-${p.version}`, previousSnapshot: structuredClone(p.sourceSnapshot), previousRows: structuredClone(rows) });
module.exports = { fixture, next, plan: helpers.planJobAccountingExport, job, master, helpers, load };
