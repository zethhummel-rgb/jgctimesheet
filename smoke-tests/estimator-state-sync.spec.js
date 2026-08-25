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
