const fs=require('fs');
const path=require('path');
const {test,expect}=require('@playwright/test');
const root=path.resolve(__dirname,'..');
const po=fs.readFileSync(path.join(root,'purchase-orders.js'),'utf8');
const ts=require('../estimating-app/node_modules/typescript');
const {PDFDocument,PDFName,PDFDict,PDFHexString,StandardFonts,degrees}=require('../estimating-app/node_modules/pdf-lib');
const loaded={};
function lib(name){if(loaded[name])return loaded[name];const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(root,'estimating-app/lib',name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;Function('exports','module','require',code)(module.exports,module,x=>x.startsWith('.')?lib(x.slice(2)):require('../estimating-app/node_modules/'+x));return loaded[name]=module.exports;}

async function offlinePoHarness(page){
 await page.route('https://offline-po.invalid/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated offline PO test</title>'}));
 await page.goto('https://offline-po.invalid/');
 await page.evaluate(async()=>{
  const request=indexedDB.open('jgc-digital-purchase-orders',1);
  request.onupgradeneeded=()=>{for(const [store,key] of [['meta','key'],['drafts','id'],['receipts','po_id']])request.result.createObjectStore(store,{keyPath:key});};
  const db=await new Promise((res,rej)=>{request.onsuccess=()=>res(request.result);request.onerror=()=>rej(request.error);});
  const tx=db.transaction(['drafts','receipts','meta'],'readwrite');
  for(const id of ['alice','bob']){
   tx.objectStore('drafts').put({id:id+'-po',po:{creator_profile_id:id,po_number:id==='alice'?30001:30002,notes:id+' private draft'},dirty:true,items:[{description:id+' materials'}],pending_submit:true});
   tx.objectStore('receipts').put({po_id:id+'-po',blob:new Blob([id+' private receipt']),name:id+'.jpg'});
  }
  tx.objectStore('receipts').put({po_id:'orphan-po',blob:new Blob(['unresolved receipt'])});
  tx.objectStore('meta').put({key:'device_token',value:'keep-number-allocation-token'});
  await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});db.close();
 });
 const source=po.slice(0,po.lastIndexOf('  if (document.readyState'))+`window.__po={state,openDatabase,idbGet,idbGetAll,idbPut,idbDelete,getDraft,getRecord,syncDraftNow,DRAFT_STORE,RECEIPT_STORE,getOrCreateDeviceToken};})();`;
 await page.evaluate(source);
 await page.evaluate(async()=>{const h=window.__po;h.state.user={id:'alice'};h.state.storageAccountId='alice';h.state.profile={role:'worker'};h.state.db=await h.openDatabase();h.state.drafts=await h.idbGetAll(h.DRAFT_STORE);});
}

test('offline PO upgrade preserves drafts, receipt photos and allocated numbers while isolating accounts',async({page})=>{
 await offlinePoHarness(page);
 const alice=await page.evaluate(async()=>{const h=window.__po;return {ids:h.state.drafts.map(d=>d.id),number:h.getDraft('alice-po').po.po_number,receipt:await(await h.idbGet(h.RECEIPT_STORE,'alice-po')).blob.text(),foreignReceipt:await h.idbGet(h.RECEIPT_STORE,'bob-po'),foreignDraft:h.getDraft('bob-po'),token:await h.getOrCreateDeviceToken()};});
 expect(alice).toEqual({ids:['alice-po'],number:30001,receipt:'alice private receipt',foreignReceipt:undefined,foreignDraft:null,token:'keep-number-allocation-token'});
 const bob=await page.evaluate(async()=>{const h=window.__po;h.state.user={id:'bob'};h.state.storageAccountId='bob';h.state.drafts=await h.idbGetAll(h.DRAFT_STORE);return {ids:h.state.drafts.map(d=>d.id),receipt:await(await h.idbGet(h.RECEIPT_STORE,'bob-po')).blob.text(),foreignRecord:h.getRecord('alice-po'),orphan:await h.idbGet(h.RECEIPT_STORE,'orphan-po')};});
 expect(bob).toEqual({ids:['bob-po'],receipt:'bob private receipt',foreignRecord:null,orphan:undefined});
 const preserved=await page.evaluate(async()=>{const h=window.__po;const tx=h.state.db.transaction(['drafts','receipts'],'readonly');return await Promise.all(['drafts','receipts'].map(store=>new Promise((res,rej)=>{const req=tx.objectStore(store).count();req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);})));});
 expect(preserved).toEqual([2,3]);
});

test('knowing another employee PO UUID cannot open, overwrite or sync their offline draft',async({page})=>{
 await offlinePoHarness(page);
 const result=await page.evaluate(async()=>{
  const h=window.__po,calls=[];h.state.client={rpc:(...args)=>{calls.push(args);throw Error('No foreign sync should occur');}};
  let overwriteDenied=false;try{await h.idbPut(h.DRAFT_STORE,{id:'bob-po',po:{creator_profile_id:'bob'}});}catch{overwriteDenied=true;}
  await h.syncDraftNow('bob-po');
  await h.idbDelete(h.DRAFT_STORE,'bob-po');
  h.state.user={id:'bob'};h.state.storageAccountId='bob';
  return {overwriteDenied,calls,bobDraftExists:!!(await h.idbGet(h.DRAFT_STORE,'bob-po'))};
 });
 expect(result).toEqual({overwriteDenied:true,calls:[],bobDraftExists:true});
});

test('a live account change rejects stale draft and receipt access',async({page})=>{
 await offlinePoHarness(page);
 const result=await page.evaluate(async()=>{const h=window.__po;h.state.user={id:'bob'};const denied=[];for(const read of [()=>h.getDraft('alice-po'),()=>h.idbGet(h.RECEIPT_STORE,'alice-po'),()=>h.idbGetAll(h.DRAFT_STORE),()=>h.syncDraftNow('alice-po')]){try{await read();denied.push(false);}catch{denied.push(true);}}return denied;});
 expect(result).toEqual([true,true,true,true]);
});

test('an online pending PO handoff cannot reveal the original creator local receipt',async({page})=>{
 await offlinePoHarness(page);
 const result=await page.evaluate(async()=>{const h=window.__po;h.state.serverRecords=[{id:'bob-po',creator_profile_id:'bob',workflow_status:'submitted',items:[{description:'Permitted material handoff'}]}];h.state.handoffRecordIds.add('bob-po');return {canOpen:!!h.getRecord('bob-po'),receipt:await h.idbGet(h.RECEIPT_STORE,'bob-po'),draft:h.getDraft('bob-po')};});
 expect(result).toEqual({canOpen:true,receipt:undefined,draft:null});
});

async function activePdfFixture(){
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),context=pdf.context;
 const action=context.obj({Type:'Action',S:'JavaScript',JS:PDFHexString.fromText('app.alert("untrusted")')});
 pdf.catalog.set(PDFName.of('OpenAction'),context.register(action));
 for(let i=0;i<2;i++){
  const page=pdf.addPage([612,792]);page.drawText('VECTOR DRAWING '+i,{x:80,y:650,size:18,font});
  page.node.set(PDFName.of('AA'),context.obj({O:action}));
  page.node.addAnnot(context.register(context.obj({Type:'Annot',Subtype:'Text',Rect:[50,50,70,70],Contents:PDFHexString.fromText('Original review note'),Name:'Comment',F:4})));
  for(const subtype of ['Link','Widget','FileAttachment','RichMedia'])page.node.addAnnot(context.register(context.obj({Type:'Annot',Subtype:subtype,Rect:[80,50,100,70],A:context.obj({S:'Launch',F:PDFHexString.fromText('bad.exe')}),AA:context.obj({E:action})})));
  if(i===1){page.setRotation(degrees(90));page.setCropBox(20,30,540,700);}
 }
 const field=pdf.getForm().createTextField('drawing-note');field.setText('Existing filled note');field.addToPage(pdf.getPage(0),{x:90,y:100,width:200,height:25});field.acroField.dict.set(PDFName.of('AA'),context.obj({K:action}));
 return pdf.save();
}

function assertInertExport(pdf){
 expect(pdf.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
 expect(pdf.getForm().getFields()).toHaveLength(0);
 for(const page of pdf.getPages()){
  expect(page.node.get(PDFName.of('AA'))).toBeUndefined();expect(page.node.Contents()).toBeTruthy();expect(page.node.Resources()).toBeTruthy();
  for(const ref of page.node.Annots()?.asArray()||[]){const note=pdf.context.lookup(ref);expect(note.get(PDFName.of('A'))).toBeUndefined();expect(note.get(PDFName.of('AA'))).toBeUndefined();expect(note.lookup(PDFName.of('Subtype')).decodeText()).toBe('Text');}
 }
 for(const [,object] of pdf.context.enumerateIndirectObjects())if(object instanceof PDFDict){expect(object.get(PDFName.of('JS'))).toBeUndefined();expect(object.get(PDFName.of('JavaScript'))).toBeUndefined();}
}

test('marked drawing export preserves vectors, rotated pages, filled fields and notes without source actions',async()=>{
 const source=await activePdfFixture();
 const content={version:1,marks:[{id:'jgc-note',kind:'text',page:1,points:[{x:150,y:500}],color:'#147d53',text:'JGC markup remains editable',author:'JGC test',layer:'Field'}],scales:{},pageOrder:[2,1]};
 const bytes=await lib('drawing-pdf').markedDrawingPdf(source,content),pdf=await PDFDocument.load(bytes);
 assertInertExport(pdf);expect(pdf.getPageCount()).toBe(2);expect(pdf.getPage(0).getRotation().angle).toBe(90);expect(pdf.getPage(0).getCropBox()).toEqual({x:20,y:30,width:540,height:700});
 const notes=pdf.getPages().flatMap(p=>(p.node.Annots()?.asArray()||[]).map(ref=>pdf.context.lookup(ref).lookup(PDFName.of('Contents')).decodeText()));
 expect(notes).toEqual(expect.arrayContaining(['Original review note','JGC markup remains editable']));
 expect((await PDFDocument.load(source)).getPage(0).node.get(PDFName.of('AA'))).toBeTruthy();
});

test('combined drawing export strips actions from every source while keeping page geometry',async()=>{
 const source=await activePdfFixture(),result=await lib('drawing-pdf').combinedDrawingPdf(source,{version:1,marks:[],scales:{},pageOrder:[2,1]},[source]);
 const pdf=await PDFDocument.load(result.bytes);assertInertExport(pdf);expect(pdf.getPageCount()).toBe(4);expect(pdf.getPage(0).getRotation().angle).toBe(90);expect(pdf.getPage(3).getRotation().angle).toBe(90);
});

test('service worker installs the current release with at most four concurrent downloads',async()=>{
 const vm=require('vm'),handlers={},source=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');let active=0,max=0,downloaded=0,activated=false;
 const context={URL,Request:class extends Request{constructor(input,init){super(new URL(input,'https://portal.invalid/'),init);}},Response,setTimeout,clearTimeout,console,caches:{match:async()=>undefined,open:async()=>({put:async()=>{}})},self:{location:new URL('https://portal.invalid/service-worker.js'),registration:{scope:'https://portal.invalid/'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:()=>{activated=true;}},fetch:async()=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,1));active--;downloaded++;return new Response('asset');}};
 vm.runInNewContext(source,context);let done;handlers.install({waitUntil:p=>done=p});await done;
 const list=JSON.parse('['+source.match(/const JGC_APP_SHELL = \[([\s\S]*?)\];/)[1]+']');
 expect(max).toBeLessThanOrEqual(4);expect(downloaded).toBe(list.length);expect(activated).toBe(true);
});

test('offline cache includes exactly current estimator assets within the release budget',()=>{
 const worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8'),list=JSON.parse('['+worker.match(/const JGC_APP_SHELL = \[([\s\S]*?)\];/)[1]+']');
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'estimating/.vite/manifest.json'),'utf8'));
 const current=[...new Set(Object.values(manifest).flatMap(entry=>[entry.file,...entry.css||[],...entry.assets||[]]).filter(file=>file.startsWith('assets/')).map(file=>'./estimating/'+file))].sort();
 expect(list.filter(file=>file.startsWith('./estimating/assets/')).sort()).toEqual(current);
 expect(list.length).toBeLessThanOrEqual(300);expect(list.reduce((bytes,file)=>bytes+fs.statSync(path.join(root,file.split('?')[0])).size,0)).toBeLessThanOrEqual(32*1024*1024);
});
