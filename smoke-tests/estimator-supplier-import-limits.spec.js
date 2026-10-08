const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),ts=require('../estimating-app/node_modules/typescript');
const {zipSync,strToU8}=require('../estimating-app/node_modules/fflate');

// Release 1008: booby-trapped supplier price files (scan finding "Supplier XLSX and PDF imports permit
// unbounded decompression, page traversal, and OCR allocation").
const cache={};function load(name){if(cache[name])return cache[name];const m={exports:{}};Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../estimating-app/lib/'+name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m.exports,m,n=>n.startsWith('.')?load(n.replace(/^\.\//,'')):require('../estimating-app/node_modules/'+n));return cache[name]=m.exports;}
const sheet='<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Material Name</t></is></c><c r="B1" t="inlineStr"><is><t>Price</t></is></c></row>'
  +'<row r="2"><c r="A2" t="inlineStr"><is><t>2x4x8 SPF</t></is></c><c r="B2"><v>5.25</v></c></row></sheetData></worksheet>';
const workbook=(extra={})=>zipSync({'[Content_Types].xml':strToU8('<Types/>'),'xl/worksheets/sheet1.xml':strToU8(sheet),...extra},{level:9});

test('a normal material price workbook still imports',()=>{
  const summary=load('material-price-workbook').parseMaterialPriceWorkbook(workbook());
  expect(summary.result.rows).toHaveLength(1);
  expect(JSON.stringify(summary.result.rows[0])).toContain('5.25');
});

test('a workbook that unpacks past the limit is refused quickly',()=>{
  const w=load('material-price-workbook'),bomb=new Uint8Array(w.WORKBOOK_MAX_UNPACKED_BYTES+1024*1024).fill(32);
  const file=zipSync({'[Content_Types].xml':strToU8('<Types/>'),'xl/worksheets/sheet1.xml':bomb},{level:9});
  expect(file.length).toBeLessThan(200000);
  const started=Date.now();
  expect(()=>w.parseMaterialPriceWorkbook(file)).toThrow('This workbook is too large to import.');
  expect(Date.now()-started).toBeLessThan(5000);
});

test('large parts the import never reads are not unpacked',()=>{
  const w=load('material-price-workbook'),media=new Uint8Array(2*w.WORKBOOK_MAX_UNPACKED_BYTES).fill(7);
  const summary=w.parseMaterialPriceWorkbook(workbook({'xl/media/image1.png':media}));
  expect(summary.result.rows).toHaveLength(1);
});

test('a bundle with thousands of parts, or a file that is not a workbook, is refused',()=>{
  const w=load('material-price-workbook'),parts={};for(let i=0;i<5001;i++)parts['xl/extra/'+i+'.xml']=strToU8('<x/>');
  expect(()=>w.parseMaterialPriceWorkbook(workbook(parts))).toThrow('This workbook is too large to import.');
  expect(()=>w.parseMaterialPriceWorkbook(new Uint8Array([1,2,3,4,5]))).toThrow('This file is not a readable Excel .xlsx workbook.');
  expect(()=>w.parseMaterialPriceWorkbook(zipSync({'readme.txt':strToU8('hello')}))).toThrow('This file is not a valid Excel .xlsx workbook.');
});

test('supplier PDF page limits and the scanned-page size cap',()=>{
  const p=load('supplier-price-parser');
  expect(p.supplierPdfPageProblem(100,false)).toBe('');
  expect(p.supplierPdfPageProblem(101,false)).toBe('This PDF has 101 pages. Supplier price lists are limited to 100 pages.');
  expect(p.supplierPdfPageProblem(25,true)).toBe('');
  expect(p.supplierPdfPageProblem(26,true)).toBe('This scanned PDF has 26 pages. Scanned price lists are limited to 25 pages.');
  // Letter, legal and tabloid pages are still read at 3x; a giant page is read at the largest safe size.
  for(const [w,h] of [[612,792],[612,1008],[792,1224]])expect(p.ocrScale(w,h)).toBe(3);
  const s=p.ocrScale(14400,14400);
  expect(14400*s*14400*s).toBeLessThanOrEqual(12000001);
  expect(14400*s).toBeLessThanOrEqual(8192);
  // The import screen applies both checks before reading pages and before text recognition.
  const screen=fs.readFileSync(path.resolve(__dirname,'../estimating-app/app/supplier-price-import.tsx'),'utf8');
  expect(screen).toContain('supplierPdfPageProblem(pdf.numPages, false)');
  expect(screen).toContain('supplierPdfPageProblem(pdf.numPages, true)');
  expect(screen).toContain('page.getViewport({ scale: ocrScale(base.width, base.height) })');
  expect(screen).not.toContain('getViewport({ scale: 3 })');
});
