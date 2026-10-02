const { test, expect } = require('@playwright/test');
const fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const ts = require('../estimating-app/node_modules/typescript');
const { PDFDocument } = require('../estimating-app/node_modules/pdf-lib');
const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const m = { exports: {} };
  Function('exports', 'module', 'require', ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../estimating-app/lib/' + name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(m.exports, m, n => n.startsWith('.') ? load(n.replace(/^\.\//, '')) : require('../estimating-app/node_modules/' + n));
  return cache[name] = m.exports;
}
async function readPages(bytes) {
  const pdfjs = await import(pathToFileURL(path.resolve(__dirname, '../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), disableWorker: true });
  const pdf = await loading.promise;
  const result = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const p = await pdf.getPage(n), content = await p.getTextContent();
    result.push({ text: content.items.map(i => i.str).join(' '), items: content.items.filter(i => i.str.trim()) });
  }
  await loading.destroy();
  return result;
}
function entries(prefix, count) { return Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(3, '0')} - Confirm the drawing reference and site conditions before completing the work.`); }
function assertBounds(pages) {
  for (const p of pages) for (const i of p.items) {
    expect(i.transform[4], i.str).toBeGreaterThanOrEqual(29);
    expect(i.transform[4] + i.width, i.str).toBeLessThanOrEqual(583);
    expect(i.transform[5], i.str).toBeGreaterThanOrEqual(30);
    expect(i.transform[5] + i.height, i.str).toBeLessThanOrEqual(765);
  }
}
function assertAllOnce(pages, prefixes) {
  const text = pages.map(p => p.text).join(' ');
  for (const [prefix, count] of prefixes) for (let n = 1; n <= count; n++) expect(text.split(prefix + String(n).padStart(3, '0')).length - 1).toBe(1);
  expect(text).not.toMatch(/\[\/?(?:b|i|u|hy|hg|lg|sm)\]/);
  assertBounds(pages);
}
async function sourcePdf(info, fields, name) {
  const state = load('estimator-data').createDefaultState();
  const quote = { ...state.quotes[0], scopeSummary: '', ...fields };
  const bytes = await load('proposal-pdf').createProposalPdf(state, quote, new Uint8Array(fs.readFileSync(path.resolve(__dirname, '../estimating/jgc-logo-transparent.png'))));
  fs.writeFileSync(info.outputPath(name + '.pdf'), bytes);
  const document = await PDFDocument.load(bytes);
  expect(document.getForm().getFields()).toHaveLength(3);
  return readPages(bytes);
}
test('long inclusion and exclusion columns start on page one and continue without losing entries', async ({}, info) => {
  const pages = await sourcePdf(info, { inclusions: entries('Inc', 120).join('\n'), exclusions: '[b][i][hy]' + entries('Exc', 95).join('\n') + '[/hy][/i][/b]' }, 'two-long-columns');
  expect(pages[0].text).toContain('Inc001'); expect(pages[0].text).toContain('Exc001');
  expect(pages.length).toBeGreaterThan(2);
  const continued = pages.filter(p => p.text.includes('INCLUSIONS / EXCLUSIONS - CONTINUED'));
  expect(continued.length).toBeGreaterThan(1);
  assertAllOnce(pages, [['Inc', 120], ['Exc', 95]]);
  for (const p of pages) for (const i of p.items) {
    if (/^Inc\d/.test(i.str)) expect(i.transform[4] + i.width).toBeLessThanOrEqual(298);
    if (/^Exc\d/.test(i.str)) expect(i.transform[4]).toBeGreaterThanOrEqual(310);
  }
});
for (const column of ['inclusions', 'exclusions']) test(`long ${column} flow independently with the other column empty`, async ({}, info) => {
  const pages = await sourcePdf(info, { inclusions: '', exclusions: '', [column]: entries('Only', 100).join('\n') }, column);
  expect(pages[0].text).toContain('Only001'); expect(pages[1].text).toContain('INCLUSIONS / EXCLUSIONS - CONTINUED');
  assertAllOnce(pages, [['Only', 100]]);
});
test('a single oversized formatted entry and long notes split at wrapped lines', async ({}, info) => {
  const pages = await sourcePdf(info, { proposalNotes: entries('Note', 95).join('\n'), inclusions: '[lg][u][hg]' + entries('Long', 140).join(' ') + '[/hg][/u][/lg]', exclusions: entries('Short', 2).join('\n') }, 'oversized-entry-and-notes');
  expect(pages[0].text).toContain('Note001'); expect(pages[1].text).toContain('NOTES & CLARIFICATIONS - CONTINUED');
  assertAllOnce(pages, [['Note', 95], ['Long', 140], ['Short', 2]]);
});
test('short clarification columns stay together and do not add a continuation heading', async ({}, info) => {
  const pages = await sourcePdf(info, { inclusions: 'Short included work.', exclusions: 'Short excluded work.' }, 'short-clarifications');
  expect(pages[0].text).toContain('Short included work.'); expect(pages[0].text).toContain('Short excluded work.');
  expect(pages.map(p => p.text).join(' ')).not.toContain('CONTINUED'); assertBounds(pages);
});
test('the built Proposal PDF download uses flowing columns', async ({ page }, info) => {
  await page.goto('/estimating/index.html?dev=1');
  await page.getByRole('button', { name: 'Company-wide' }).click();
  await page.getByRole('searchbox', { name: 'Search estimates and jobs' }).fill('Lancaster');
  await page.locator('.overview-result-group > button').filter({ hasText: 'JGC-Q-2026-0001' }).click();
  await page.getByRole('tab', { name: /Details/ }).click();
  const included = entries('BuiltInc', 70), excluded = entries('BuiltExc', 45);
  for (const [label, values] of [['Inclusions', included], ['Exclusions', excluded]]) {
    const input = page.getByRole('textbox', { name: label });
    await input.evaluate((element, lines) => {
      element.replaceChildren(...lines.map(value => { const row = document.createElement('div'); row.textContent = value; return row; }));
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    }, values);
  }
  await page.getByRole('tab', { name: /Proposal/ }).click();
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: /Proposal PDF/ }).click();
  const download = await pending, filename = info.outputPath('built-proposal.pdf'); await download.saveAs(filename);
  const pages = await readPages(fs.readFileSync(filename));
  expect(pages[0].text).toContain('BuiltInc001'); expect(pages[0].text).toContain('BuiltExc001');
  expect(pages[1].text).toContain('INCLUSIONS / EXCLUSIONS - CONTINUED');
  assertAllOnce(pages, [['BuiltInc', 70], ['BuiltExc', 45]]);
});
