const fs = require("fs");
const path = require("path");
const ts = require("../estimating-app/node_modules/typescript");
const { test, expect } = require("@playwright/test");

function loadEstimatorHelper(name) {
  const filename = path.resolve(__dirname, "../estimating-app/lib", name + ".ts");
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  Function("exports", "module", output)(loaded.exports, loaded);
  return loaded.exports;
}

function state(projectA = "Base A", projectB = "Base B") {
  return {
    version: 1,
    settings: { nextQuoteNumber: 3 },
    clients: [],
    vendors: [],
    priceBook: [],
    quotes: [
      { id: "quote-a", number: "A", project: projectA, lines: [] },
      { id: "quote-b", number: "B", project: projectB, lines: [] },
    ],
    jobs: [],
    activity: [],
  };
}

test("estimator state merge preserves independent browser edits", () => {
  const { mergeConcurrentEstimatorState: merge } = loadEstimatorHelper("estimator-state-sync");
  const base = state();
  const local = state("Local A", "Base B");
  const remote = state("Base A", "Remote B");
  const result = merge(base, local, remote);

  expect(result.conflicts).toEqual([]);
  expect(result.state.quotes.find((quote) => quote.id === "quote-a").project).toBe("Local A");
  expect(result.state.quotes.find((quote) => quote.id === "quote-b").project).toBe("Remote B");
});

test("estimator state merge stops conflicting edits to the same field", () => {
  const { mergeConcurrentEstimatorState: merge } = loadEstimatorHelper("estimator-state-sync");
  const result = merge(state(), state("Local A", "Base B"), state("Remote A", "Base B"));

  expect(result.state).toBeNull();
  expect(result.conflicts).toContain("quotes[quote-a].project");
});


test("shop drawing revisions merge independently but concurrent edits of one revision require review", () => {
  const { mergeConcurrentEstimatorState: merge } = loadEstimatorHelper("estimator-state-sync"),base=state();base.jobs=[{id:'job',shopDrawings:[{id:'sd1',revision:0,status:'Submitted for review',revisions:[],history:[]},{id:'sd2',revision:0,status:'Required',history:[]}]}];
  const local=structuredClone(base),remote=structuredClone(base);
  local.jobs[0].shopDrawings[0].status='Approved';local.jobs[0].shopDrawings[0].history=[{id:'event1',action:'Approved'}];
  remote.jobs[0].shopDrawings[1].status='Requested from vendor';
  expect(merge(base,local,remote).state.jobs[0].shopDrawings.map(d=>d.status)).toEqual(['Approved','Requested from vendor']);
  remote.jobs[0].shopDrawings[0].revision=1;remote.jobs[0].shopDrawings[0].revisions=[{id:'revision1',revision:0}];
  const conflict=merge(base,local,remote);expect(conflict.state).toBeNull();expect(conflict.conflicts).toContain('jobs[job].shopDrawings[sd1]');
});

test("concurrent quote creation preserves the saved number and gives the new draft an unused number", () => {
  const { mergeConcurrentEstimatorState: merge } = loadEstimatorHelper("estimator-state-sync");
  const { nextAvailableQuoteNumber, resolveNewDraftQuoteNumbers } = loadEstimatorHelper("quote-numbering");
  const base = state();
  base.settings = { quotePrefix: "JGC-Q", nextQuoteNumber: 90 };
  const local = structuredClone(base);
  const remote = structuredClone(base);
  const number = nextAvailableQuoteNumber(base, "2026-11-12").number;
  const draft = { id: "new-draft", number, status: "Draft", lines: [{ id: "line-a" }], revisions: [], project: "Draft estimate" };
  const savedQuote = { id: "saved-quote", number, status: "Finished", lines: [], revisions: [], project: "Existing proposal" };
  local.quotes.push(draft);
  local.settings.nextQuoteNumber = 91;
  local.activity.push({ id: "draft-activity", quoteId: draft.id, title: "Quote created", detail: number + " started as a new draft." });
  remote.quotes.push(savedQuote, { ...savedQuote, id: "another-quote", number: "JGC-Q-2026-0091" });
  remote.settings.nextQuoteNumber = 92;

  expect(nextAvailableQuoteNumber({ ...remote, settings: base.settings }, "2026-11-12").number).toBe("JGC-Q-2026-0092");
  const merged = merge(base, local, remote);
  expect(merged.conflicts).toEqual([]);
  const reconciled = resolveNewDraftQuoteNumbers(remote, merged.state);
  expect(reconciled.quotes.find(quote => quote.id === savedQuote.id)).toEqual(savedQuote);
  expect(reconciled.quotes.find(quote => quote.id === draft.id)).toEqual({ ...draft, number: "JGC-Q-2026-0092" });
  expect(reconciled.activity.find(item => item.quoteId === draft.id).detail).toContain("JGC-Q-2026-0092");
  expect(reconciled.settings.nextQuoteNumber).toBe(93);
  expect(resolveNewDraftQuoteNumbers(reconciled, reconciled)).toBe(reconciled);
});

test("subcontract POs use job suffixes and resolve concurrent creation without changing existing orders", () => {
  const { nextSubcontractPurchaseOrderNumber: next, resolveNewPurchaseOrderNumbers: resolve } = loadEstimatorHelper("subcontract-po-numbering");
  const order = (id, number) => ({ id, number, vendorName: id });
  const job = { id: "job", jobNumber: "26142", purchaseOrders: [order("legacy", "26142"), order("first", "26142-001"), order("second", "26142-002")] };
  expect(next(job)).toBe("26142-003");
  const base = { jobs: [job], activity: [] };
  const incoming = { jobs: [{ ...job, purchaseOrders: [...job.purchaseOrders, order("new", "26142-002")] }], activity: [] };
  const result = resolve(base, incoming);
  expect(result.jobs[0].purchaseOrders.map(po => po.number)).toEqual(["26142", "26142-001", "26142-002", "26142-003"]);
});
