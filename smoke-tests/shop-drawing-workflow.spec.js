const fs=require('node:fs'),path=require('node:path'),ts=require('../estimating-app/node_modules/typescript');
const {test,expect}=require('@playwright/test');
const loaded={exports:{}};Function('exports','module',ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../estimating-app/lib/shop-drawing-workflow.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(loaded.exports,loaded);
const {drawingHistory,drawingRecord,approvedDrawingFile,validateDrawing}=loaded.exports;
test('legacy approved drawings retain their original file and acquire truthful history on the next update',()=>{
 const prior={id:'legacy',number:'SD-001',revision:3,status:'Approved',oneDriveUrl:'https://example.com/rev3.pdf',revisions:[{id:'r2',revision:2,snapshot:'{"oneDriveUrl":"https://example.com/rev2.pdf"}'}],createdAt:'2026-08-01T12:00:00Z',updatedAt:'2026-08-05T12:00:00Z'};
 const next={...prior,notes:'Added location note',updatedAt:'2026-09-23T12:00:00Z'};
 const events=drawingHistory(prior,next,'Reviewer');expect(events).toHaveLength(2);expect(events[0].recordedAt).toBe(prior.updatedAt);expect(events[0].actor).toBe('');expect(drawingRecord(events[0].snapshot).notes).toBeUndefined();expect(drawingRecord(events[1].snapshot).notes).toBe('Added location note');expect(approvedDrawingFile(next)).toBe(prior.oneDriveUrl);expect(prior.revisions).toHaveLength(1);expect(prior.history).toBeUndefined();
});
test('review dates and approved files cannot be silently replaced; malformed historical snapshots are harmless',()=>{
 const draft={status:'Approved',consultant:'Engineer',requestedDate:'2026-09-03',receivedDate:'2026-09-02',returnedDate:'2026-09-04',oneDriveUrl:'https://example.com/rev0.pdf',approvedFileUrl:'https://example.com/approved.pdf'};
 expect(validateDrawing(draft)).toContain('follow that order');draft.receivedDate='2026-09-03';expect(validateDrawing(draft)).toBe('');
 expect(validateDrawing({...draft,approvedFileUrl:'https://example.com/different.pdf'},{...draft,revisions:[]})).toContain('approved-for-use file is preserved');
 expect(approvedDrawingFile({...draft,status:'Under review'})).toBe('');expect(drawingRecord('null')).toEqual({});expect(drawingRecord('invalid')).toEqual({});
});

test('file links are optional at every shop drawing review stage',()=>{
 for(const status of ['Not requested','Requested from vendor','Received from vendor','Submitted for review','Under review','Approved','Approved as noted','Revise and resubmit','Rejected']){
  const draft={status,consultant:'Reviewer',requestedDate:'2026-09-01',receivedDate:'2026-09-02',submittedDate:'2026-09-03',returnedDate:'2026-09-04',reviewComments:'Review decision recorded',oneDriveUrl:'',approvedFileUrl:''};
  expect(validateDrawing(draft),status).toBe('');expect(approvedDrawingFile(draft)).toBe('');
 }
});
