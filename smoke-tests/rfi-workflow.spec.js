const fs=require('node:fs'),path=require('node:path'),ts=require('../estimating-app/node_modules/typescript');
const {test,expect}=require('@playwright/test');
function load(name){const m={exports:{}};Function('exports','module',ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../estimating-app/lib/'+name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m.exports,m);return m.exports;}
const w=load('rfi-workflow'),merge=load('estimator-state-sync').mergeConcurrentEstimatorState;
const state=rfis=>({jobs:[{id:'job',rfis}]});
test('RFI numbers and history remain controlled during stale saves and concurrent creation',()=>{
 const a=w.saveRfi([],{...w.blankRfi('Admin'),subject:'First'},'Admin');expect(a.number).toBe('RFI-001');
 const b=w.saveRfi([a],{...w.blankRfi('Admin'),subject:'Second'},'Admin');expect(b.number).toBe('RFI-002');
 const edited=w.saveRfi([a],{...a,question:'Edited question'},'Admin',a);expect(edited.history).toHaveLength(2);expect(a.history).toHaveLength(1);
 expect(w.rfiPersistenceError(state([edited]),state([a]))).toContain('history changed');expect(w.rfiPersistenceError(state([a]),state([]))).toContain('history changed');expect(w.rfiPersistenceError(state([a]),state([edited]))).toBe('');
 const competing=w.saveRfi([],{...w.blankRfi('Other'),subject:'Other first'},'Other');const merged=merge(state([]),state([a]),state([competing]));expect(w.rfiPersistenceError(state([competing]),merged.state)).toContain('unique');
 const conflict=merge(state([a]),state([edited]),state([w.saveRfi([a],{...a,question:'Competing question'},'Other',a)]));expect(conflict.state).toBeNull();
});
test('RFI due dates, state validation, attachment security and CSV escaping',()=>{
 const d={...w.blankRfi('Admin'),subject:'Subject',status:'Open / Sent',sentTo:'Engineer',createdDate:'2026-09-01',sentDate:'2026-09-02',dueDate:'2026-09-03',question:'Question'};
 expect(w.rfiOverdue(d,'2026-09-03')).toBe(false);expect(w.rfiOverdue(d,'2026-09-04')).toBe(true);expect(w.rfiOverdue({...d,status:'Answered'},'2026-09-04')).toBe(false);
 expect(w.validateRfi({...d,status:'Answered'}).answer).toBeTruthy();expect(w.validateRfi({...d,attachments:[{id:'a',label:'Bad',url:'javascript:alert(1)'}]}).attachments).toBeTruthy();expect(w.rfiLink('http://example.com')).toBe('');
 const r=w.saveRfi([],{...d,subject:'=1+1',question:'Line 1\nLine 2, "quoted"'},'Admin');const csv=w.rfiCsv('26144',[r]);expect(csv).toContain("'=1+1");expect(csv).toContain('""quoted""');
});
