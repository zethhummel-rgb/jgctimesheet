const fs = require("fs");
const path = require("path");
const ts = require("../estimating-app/node_modules/typescript");
const { test, expect } = require("@playwright/test");

function loadMergeHelper() {
  const filename = path.resolve(__dirname, "../estimating-app/lib/estimator-state-sync.ts");
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  Function("exports", "module", output)(loaded.exports, loaded);
  return loaded.exports.mergeConcurrentEstimatorState;
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
  const merge = loadMergeHelper();
  const base = state();
  const local = state("Local A", "Base B");
  const remote = state("Base A", "Remote B");
  const result = merge(base, local, remote);

  expect(result.conflicts).toEqual([]);
  expect(result.state.quotes.find((quote) => quote.id === "quote-a").project).toBe("Local A");
  expect(result.state.quotes.find((quote) => quote.id === "quote-b").project).toBe("Remote B");
});

test("estimator state merge stops conflicting edits to the same field", () => {
  const merge = loadMergeHelper();
  const result = merge(state(), state("Local A", "Base B"), state("Remote A", "Base B"));

  expect(result.state).toBeNull();
  expect(result.conflicts).toContain("quotes[quote-a].project");
});


test("shop drawing revisions merge independently but concurrent edits of one revision require review", () => {
  const merge=loadMergeHelper(),base=state();base.jobs=[{id:'job',shopDrawings:[{id:'sd1',revision:0,status:'Submitted for review',revisions:[],history:[]},{id:'sd2',revision:0,status:'Required',history:[]}]}];
  const local=structuredClone(base),remote=structuredClone(base);
  local.jobs[0].shopDrawings[0].status='Approved';local.jobs[0].shopDrawings[0].history=[{id:'event1',action:'Approved'}];
  remote.jobs[0].shopDrawings[1].status='Requested from vendor';
  expect(merge(base,local,remote).state.jobs[0].shopDrawings.map(d=>d.status)).toEqual(['Approved','Requested from vendor']);
  remote.jobs[0].shopDrawings[0].revision=1;remote.jobs[0].shopDrawings[0].revisions=[{id:'revision1',revision:0}];
  const conflict=merge(base,local,remote);expect(conflict.state).toBeNull();expect(conflict.conflicts).toContain('jobs[job].shopDrawings[sd1]');
});
