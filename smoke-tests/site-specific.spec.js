const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),ts=require('../estimating-app/node_modules/typescript');
const cache={};function load(name){if(cache[name])return cache[name];const m={exports:{}};Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../estimating-app/lib/'+name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m.exports,m,n=>n.startsWith('.')?load(n.replace(/^\.\//,'')):require('../estimating-app/node_modules/'+n));cache[name]=m.exports;return m.exports;}
const model=load('site-specific'),merge=load('estimator-state-sync').mergeConcurrentEstimatorState;
function fixture(){const s=load('estimator-data').createDefaultState();s.clients=[{id:'client',name:'Synthetic client',contact:'',email:'',phone:'',contacts:[],sites:[],notes:''}];s.quotes=[];s.priceBook=[];s.jobs=[{id:'job',jobNumber:'26999',quoteId:'',clientId:'client',project:'Safety Plan QA Project',status:'Active',portalJobId:'portal-job',portalActive:true,portalCustomer:'Synthetic client',portalAddress:'123 Synthetic Street, Cornwall',projectManager:'QA Administrator',acceptedRevenue:0,originalCostBudget:0,approvedRevenueChanges:0,approvedCostChanges:0,estimateToComplete:0,acceptedAt:'2026-10-01T12:00:00Z',costs:[],notes:''}];return s;}

async function showPage(page,id){
 if(await page.locator('.ss-paper').getAttribute('data-page-id')==='library')await page.getByRole('button',{name:'Back to plan',exact:true}).click();
 if(await page.locator('.ss-paper').getAttribute('data-page-id')===id)return;
 while(await page.getByRole('button',{name:'Previous page',exact:true}).isEnabled())await page.getByRole('button',{name:'Previous page',exact:true}).click();
 for(let n=0;n<40;n++){if(await page.locator('.ss-paper').getAttribute('data-page-id')===id)return;if(await page.getByRole('button',{name:'Next page',exact:true}).isDisabled())break;await page.getByRole('button',{name:'Next page',exact:true}).click();}
 throw new Error('Page not reached: '+id);
}
async function options(page){const node=page.locator('.ss-plan-options');if(!await node.evaluate(n=>n.open))await node.locator('summary').click();}
async function pdfMenu(page){const node=page.locator('.ss-output-menu');if(!await node.evaluate(n=>n.open))await node.locator('summary').click();}
async function rowOptions(page,label){const node=page.getByLabel(label+' options',{exact:true}).locator('..');if(!await node.evaluate(n=>n.open))await node.locator('summary').click();}

async function documents(){const {PDFDocument,StandardFonts,degrees}=require('../estimating-app/node_modules/pdf-lib');const policy=await PDFDocument.create(),font=await policy.embedFont(StandardFonts.Helvetica);for(let i=1;i<=184;i++)policy.addPage([612,792]).drawText('ORIGINAL POLICY PAGE '+i,{x:50,y:700,font,size:12});const cert=await PDFDocument.create(),f=await cert.embedFont(StandardFonts.Helvetica);cert.addPage([612,792]).drawText('SYNTHETIC TRAINING CERTIFICATE',{x:50,y:700,font:f,size:12});const reverse=cert.addPage([612,792]);reverse.setRotation(degrees(90));reverse.setCropBox(20,30,500,600);reverse.drawText('CERTIFICATE REVERSE PAGE',{x:50,y:200,font:f,size:12,rotate:degrees(90)});return {policy:Buffer.from(await policy.save()).toString('base64'),cert:Buffer.from(await cert.save()).toString('base64')};}
async function setup(page,{theme='light',width=1440,seed}={}) {let state=seed||fixture();const saves=[];await page.setViewportSize({width,height:980});await page.addInitScript(theme=>{localStorage.setItem('jgcPortalThemeGuest',theme);localStorage.setItem('jgcPortalTheme',theme);},theme);await page.route('**/*.supabase.co/**',r=>r.fulfill({status:403,json:{message:'Isolated fixture'}}));await page.route('**/api/**',r=>r.fulfill({status:200,json:{actuals:[],jobs:[],rows:[]}}));await page.route('**/api/state',async r=>{if(r.request().method()==='PUT'){state=r.request().postDataJSON().state;saves.push(structuredClone(state));return r.fulfill({status:200,json:{saved:true,updatedAt:new Date().toISOString()}});}return r.fulfill({status:200,json:{state,updatedAt:'2026-10-05T12:00:00Z'}});});await page.goto('/estimating/index.html?dev=1&view=jobs&job=26999');await expect(page.locator('.job-detail-page')).toBeVisible();await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();await expect(page.locator('.ss-paper')).toHaveAttribute('data-page-id','cover');await page.evaluate(t=>document.documentElement.setAttribute('data-jgc-theme',t),theme);return {saves,getState:()=>state};}
async function client(page,data,{deny=false,uploadFail=false}={}) {await page.evaluate(({data,deny,uploadFail})=>{window.__safetyCalls=[];window.__safetyFail=uploadFail;window.__safetyDenied=deny;const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));const b={id:'qa-board',token:'qa-token',enabled:true,can_manage:true,documents:[{id:'qa-policy',category:'jgc-policy',title:'JGC full policy',mime_type:'application/pdf',status:'published'},{id:'qa-jsa',category:'jsa',title:'Standard job JSA',mime_type:'application/pdf',status:'published'}]};let id=0;
 window.createJgcSupabaseClient=()=>({supabaseUrl:'https://qa.supabase.co',auth:{getSession:async()=>({data:{session:{user:{id:'qa-admin'}}}})},from:table=>{let rowId='';const q={select:()=>q,eq:(key,value)=>{rowId=value;return q;},order:()=>q,range:async()=>({data:table==='certificates'?[{id:'qa-cert',worker_name:'Synthetic worker',certificate_name:'Training',file_path:'qa/cert.pdf',file_name:'cert.pdf',file_type:'application/pdf',expiry_date:'2027-10-05'}]:[]}),maybeSingle:async()=>({data:table==='profiles'?{role:window.__safetyDenied?'worker':'admin',account_status:'approved'}:{file_path:'qa/cert.pdf'}})};return q;},rpc:async(name,args)=>{window.__safetyCalls.push({name,args});if(name==='get_or_create_job_board')return {data:b};if(name==='get_job_board_jsa')return {data:{acknowledgements:[]}};if(name==='begin_job_board_upload'){id++;return {data:{id:'upload-'+id,object_path:'qa-board/upload-'+id+'/original.pdf'}};}return {data:{id:args.p_document_id,status:name==='finalize_job_board_upload'?'pending':'published'}};},storage:{from:bucket=>({download:async()=>({data:new Blob([decode(data.cert)],{type:'application/pdf'})}),upload:async(objectPath,blob,opts)=>{window.__safetyCalls.push({name:'storage-upload',bucket,objectPath,size:blob.size,opts});if(window.__safetyFail){window.__safetyFail=false;return {error:{message:'offline',statusCode:'503'}};}return {data:{path:objectPath}};}})},functions:{invoke:async(name,{body})=>({data:body.documentId.startsWith('upload-')?{pdfBase64:data.map,mimeType:'image/png'}:body.documentId==='qa-jsa'?{sourcePayload:{source_type:'inspection_records',record:{id:'synthetic-jsa',inspection_type:'JSA',inspection_date:'2026-10-05',project:'QA Project',form_data:{fields:[{label:'Date',value:'2026-10-05'},{label:'Project',value:'QA JSA Project'},{label:'What work will be done?',value:'SYNTHETIC JSA WORK'}],rows:[{cells:['SYNTHETIC JSA WORK','Synthetic hazard','Synthetic controls / PPE']}]}}}}:{pdfBase64:data.policy,mimeType:'application/pdf'}})}});}, {data,deny,uploadFail});}
async function saved(page){await page.getByRole('button',{name:'Save plan',exact:true}).click();await pdfMenu(page);await expect(page.getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled({timeout:12000});}
async function texts(file){const pdfjs=await import(pathToFileURL(path.resolve(__dirname,'../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href),pdf=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(file)),disableWorker:true,standardFontDataUrl:path.resolve(__dirname,'../estimating-app/node_modules/pdfjs-dist/standard_fonts').replaceAll('\\','/')+'/'}).promise,values=[];for(let i=1;i<=pdf.numPages;i++)values.push((await (await pdf.getPage(i)).getTextContent()).items.map(x=>x.str).join(' '));return {pages:pdf.numPages,text:values.join('\n'),values};}
test('plan dates and concurrent saves prevent invalid dates and silently mixing a single plan',()=>{const s=fixture(),p=model.createSitePlan(s.jobs[0],'QA');p.planDate='2026-02-31';expect(model.sitePlanErrors(p)).toContain('Valid plan date');p.planDate='2028-02-29';expect(model.sitePlanErrors(p)).not.toContain('Valid plan date');s.jobs[0].siteSpecific=p;const a=structuredClone(s),b=structuredClone(s);a.jobs[0].siteSpecific.pages[0].fields[0].value='A';b.jobs[0].siteSpecific.pages[0].fields[1].value='B';expect(merge(s,a,b).state).toBeNull();const c=structuredClone(s);c.jobs[0].notes='Other field';expect(merge(s,a,c).state.jobs[0].siteSpecific.pages[0].fields[0].value).toBe('A');});
for(const theme of ['light','dark'])for(const width of [390,1440])test(`plan fields, toggles, reusable page copies and layout ${theme} ${width}`,async({page},info)=>{test.setTimeout(60000);const store=await setup(page,{theme,width});await page.getByLabel('Prepared by',{exact:true}).fill('QA Author');await showPage(page,'scope');await page.getByRole('textbox',{name:'Scope of work',exact:true}).fill('Site-specific QA scope');await page.getByRole('button',{name:'Save page to library',exact:true}).click();await options(page);await page.getByRole('button',{name:'Saved pages',exact:true}).click();await page.locator('.ss-library summary').filter({hasText:'Specific location of project'}).click();await page.getByRole('button',{name:'Use in this plan',exact:true}).click();await expect(page.getByRole('textbox',{name:'Scope of work',exact:true})).toHaveValue('Site-specific QA scope');await page.getByLabel('Page title',{exact:true}).fill('Reusable QA scope copy');await showPage(page,'ppe');await page.getByRole('checkbox',{name:'Include this page',exact:true}).uncheck();await expect(page.getByRole('checkbox',{name:'Include this page',exact:true})).not.toBeChecked();await expect.poll(()=>store.saves.at(-1)?.jobs[0].siteSpecific.pages.some(p=>p.title==='Reusable QA scope copy')).toBe(true);expect(store.getState().safetyLibrary[0].title).toBe('Specific location of project');await showPage(page,'cover');await expect(page.getByLabel('Prepared by',{exact:true})).toHaveValue('QA Author');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath('builder-'+theme+'-'+width+'.png'),fullPage:true});await page.reload();await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();await expect(page.getByLabel('Prepared by',{exact:true})).toHaveValue('QA Author');});
test('combined PDF preserves complete policy, certificate reverse and standard JSA; publish uses this job and selected visibility',async({page},info)=>{test.setTimeout(120000);await setup(page);await client(page,await documents());await showPage(page,'attachments');await page.getByRole('button',{name:'Load Portal documents',exact:true}).click();await page.getByRole('checkbox',{name:/JGC full policy/}).check();await page.getByRole('checkbox',{name:/Synthetic worker/}).check();await page.getByRole('checkbox',{name:/Standard job JSA/}).check();await pdfMenu(page);await expect(page.getByLabel('Published PDF access')).toHaveValue('restricted');await saved(page);const event=page.waitForEvent('download',{timeout:60000});await pdfMenu(page);await page.getByRole('button',{name:'Download PDF',exact:true}).click();const d=await event,file=info.outputPath(d.suggestedFilename());await d.saveAs(file);const parsed=await texts(file);expect(parsed.pages).toBeGreaterThanOrEqual(195);expect(parsed.text).toContain('ORIGINAL POLICY PAGE 184');expect(parsed.text).toContain('CERTIFICATE REVERSE PAGE');expect(parsed.text).toContain('SYNTHETIC JSA WORK');expect(parsed.text).toContain('PLAN CONTENTS');expect(parsed.values.at(-1)).toContain('Page '+parsed.pages+' of '+parsed.pages);await pdfMenu(page);await page.getByRole('button',{name:'Publish to Job Board',exact:true}).click();await expect(page.getByRole('status')).toContainText('published in the Job Board');const calls=await page.evaluate(()=>window.__safetyCalls);expect(calls.filter(c=>c.name==='begin_job_board_upload')).toHaveLength(1);expect(calls.find(c=>c.name==='begin_job_board_upload').args.p_board_id).toBe('qa-board');expect(calls.find(c=>c.name==='review_job_board_document').args.p_visibility).toBe('restricted');});
test('failed publish retains the plan and retries the same reserved upload; extra originals remain separate',async({page})=>{test.setTimeout(60000);await setup(page);await client(page,await documents(),{uploadFail:true});await saved(page);await pdfMenu(page);await page.getByRole('button',{name:'Publish to Job Board',exact:true}).click();await expect(page.getByRole('status')).toContainText('Your plan is kept');await pdfMenu(page);await page.getByRole('button',{name:'Publish to Job Board',exact:true}).click();await expect(page.getByRole('status')).toContainText('published in the Job Board');let calls=await page.evaluate(()=>window.__safetyCalls);expect(calls.filter(c=>c.name==='begin_job_board_upload')).toHaveLength(1);await showPage(page,'attachments');await page.getByLabel('Additional PDFs, forms or photos').setInputFiles({name:'extra.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 QA original file')});await page.getByRole('button',{name:'Upload 1 supporting file',exact:true}).click();await expect(page.getByRole('status')).toContainText('saved privately');calls=await page.evaluate(()=>window.__safetyCalls);expect(calls.filter(c=>c.name==='review_job_board_document')).toHaveLength(1);expect(calls.filter(c=>c.name==='begin_job_board_upload')).toHaveLength(2);});
test('attachment failure produces no partial PDF and unapproved access cannot invoke write RPCs',async({page})=>{test.setTimeout(60000);const seed=fixture();seed.jobs[0].siteSpecific=model.createSitePlan(seed.jobs[0],'QA');seed.jobs[0].siteSpecific.updatedAt=new Date().toISOString();seed.jobs[0].siteSpecific.attachments=[{id:'board:gone',kind:'board',boardId:'wrong-board',documentId:'gone',title:'Missing file',included:true,fileName:'gone.pdf'}];await setup(page,{seed});await client(page,await documents());await pdfMenu(page);await page.getByRole('button',{name:'Download PDF',exact:true}).click();await expect(page.getByRole('status')).toContainText('No incomplete PDF was exported');await client(page,await documents(),{deny:true});await pdfMenu(page);await page.getByRole('button',{name:'Publish to Job Board',exact:true}).click();await expect(page.getByRole('status')).toContainText('Approved administrator access is required');expect(await page.evaluate(()=>window.__safetyCalls)).toHaveLength(0);});


test('saved tasks can be reused across jobs without altering the source job or library version',async({page})=>{
  test.setTimeout(60000);
  const seed=fixture();seed.jobs.push({...structuredClone(seed.jobs[0]),id:'second-job',jobNumber:'26998',project:'Second QA job',portalJobId:'second-portal-job',portalAddress:'456 QA Street'});
  const store=await setup(page,{seed});
  await showPage(page,'scope');
  await page.getByRole('textbox',{name:'Scope of work',exact:true}).fill('First job original scope');
  await page.getByRole('button',{name:'Save page to library',exact:true}).click();
  await expect.poll(()=>store.saves.at(-1)?.safetyLibrary?.length).toBe(1);
  await page.goto('/estimating/index.html?dev=1&view=jobs&job=26998');
  await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();
  await expect(page.getByLabel('Site address',{exact:true})).toHaveValue('456 QA Street');
  await options(page);await page.getByRole('button',{name:'Saved pages',exact:true}).click();await page.locator('.ss-library summary').click();
  await page.getByRole('button',{name:'Use in this plan',exact:true}).click();await page.getByRole('textbox',{name:'Scope of work',exact:true}).fill('Second job adapted scope');
  await expect.poll(()=>store.saves.at(-1)?.jobs[1].siteSpecific?.pages.at(-1).fields[0].value).toBe('Second job adapted scope');
  expect(store.getState().jobs[0].siteSpecific.pages[0].fields[0].value).toBe('First job original scope');
  expect(store.getState().safetyLibrary[0].fields[0].value).toBe('First job original scope');
});

test('new plans contain reusable source content without carrying another site identity or unverified rules',()=>{
  const plan=model.createSitePlan(fixture().jobs[0],'QA Author'),value=id=>{const p=plan.pages.find(p=>p.id===id);return p.fields.map(f=>f.value).join('\n')+JSON.stringify(p.blocks||[]);};
  expect(value('roles')).toContain('JGC project manager');expect(value('roles')).toContain('Subcontractors');expect(value('roles')).toContain('mobile phones');
  expect(value('emergency')).toContain('headcount');expect(value('dust')).toContain('Do not dry sweep');expect(value('waste')).toContain('at least daily');expect(value('sds')).toContain('current supplier SDS');
  expect(plan.pages.find(p=>p.id==='emergency').fields.find(f=>f.id==='emergency-1').value).toBe('');
  expect(plan.pages.find(p=>p.id==='emergency').fields.find(f=>f.label==='Directions to nearest hospital').value).toBe('');
  expect(plan.pages.find(p=>p.id==='scope').fields.every(f=>!f.value)).toBe(true);expect(value('contacts')).not.toMatch(/@|\d{3}[- ]\d{3}/);
  expect(JSON.stringify(plan)).not.toMatch(/Belleville|Dundas|Fieldless|Columbine|COVID|within 3 years|9['’]\s*11|80 dB/);
  const procedure=model.createStandardProcedure('lockout');expect(procedure.fields[1].value).toContain('personal locks');expect(procedure.fields[1].value).toContain('Verify isolation');
});

test('standard content is an explicit fill-only operation preserving saved revisions, fields, order, files and choices',async({page})=>{
  const seed=fixture(),plan=model.createSitePlan(seed.jobs[0],'Original Author');plan.pages=load('site-specific-content').standardSafetyPages();
  for(const p of plan.pages)for(const f of p.fields)f.value='';
  plan.pages.reverse();plan.pages.find(p=>p.id==='roles').title='Our site responsibilities';plan.pages.find(p=>p.id==='roles').included=false;
  plan.pages.find(p=>p.id==='roles').fields[0].value='KEEP THE APPROVED SITE WORDING';plan.pages.find(p=>p.id==='emergency').fields=plan.pages.find(p=>p.id==='emergency').fields.filter(f=>f.id!=='emergency-5');
  plan.attachments=[{id:'original',kind:'board',title:'Original document',included:false,fileName:'original.pdf'}];plan.hospitalMap={id:'old-map',kind:'board',title:'Original map',included:false,fileName:'original.png'};
  plan.published={documentId:'published',at:'2026-10-01T12:00:00Z',revision:'2',updatedAt:'original-stamp'};plan.updatedAt='original-stamp';seed.jobs[0].siteSpecific=plan;
  const before=structuredClone(plan),filled=model.addStandardSafetyContent(plan);
  expect(plan).toEqual(before);expect(filled.plan.attachments).toEqual(before.attachments);expect(filled.plan.hospitalMap).toEqual(before.hospitalMap);expect(filled.plan.published).toEqual(before.published);
  expect(filled.plan.pages.map(p=>p.id)).toEqual(before.pages.map(p=>p.id));expect(filled.plan.pages.find(p=>p.id==='roles')).toMatchObject({title:'Our site responsibilities',included:false});
  expect(filled.plan.pages.find(p=>p.id==='roles').fields[0].value).toBe('KEEP THE APPROVED SITE WORDING');expect(filled.plan.pages.find(p=>p.id==='roles').fields[1].value).toContain('daily safety briefings');
  expect(model.addStandardSafetyContent(filled.plan)).toMatchObject({fieldsAdded:0,pagesAdded:0});
  const store=await setup(page,{seed});await page.waitForTimeout(2200);expect(store.getState().jobs[0].siteSpecific).toEqual(before);
  await options(page);await page.getByRole('button',{name:'Add standard JGC content',exact:true}).click();await expect(page.getByRole('status')).toContainText('Your entered information and page choices are kept');
  await expect.poll(()=>store.getState().jobs[0].siteSpecific.pages.find(p=>p.id==='roles').fields[1].value).toContain('Before starting work');
  expect(store.getState().jobs[0].siteSpecific.published).toEqual(before.published);
});

test('standard procedures are editable independent copies and completed versions can be reused',async({page})=>{
  test.setTimeout(60000);
  const store=await setup(page);await showPage(page,'scope');
  await options(page);await page.getByRole('combobox',{name:'Procedure template',exact:true}).selectOption('lockout');await page.getByRole('button',{name:'Add procedure',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Work steps or procedure',exact:true})).toHaveValue(/Identify the equipment/);
  await page.getByRole('textbox',{name:'Person responsible / review',exact:true}).fill('QA Site Supervisor');await page.getByRole('button',{name:'Save page to library',exact:true}).click();
  await page.getByRole('button',{name:'Add procedure',exact:true}).click();await expect(page.getByRole('textbox',{name:'Person responsible / review',exact:true})).toHaveValue('');
  await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages.filter(p=>p.title==='Lockout and tagout').length).toBe(2);
  const copies=store.getState().jobs[0].siteSpecific.pages.filter(p=>p.title==='Lockout and tagout');expect(copies[0].id).not.toBe(copies[1].id);expect(store.getState().safetyLibrary[0].fields.at(-1).value).toBe('QA Site Supervisor');
});

async function mapImage(page){return page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=500;const x=c.getContext('2d');x.fillStyle='#edf4ef';x.fillRect(0,0,900,500);x.strokeStyle='#718279';x.lineWidth=32;x.beginPath();x.moveTo(100,380);x.lineTo(440,380);x.lineTo(440,100);x.lineTo(790,100);x.stroke();x.fillStyle='#174934';x.font='bold 32px Arial';x.fillText('SYNTHETIC HOSPITAL ROUTE',38,48);x.fillText('QA JOB SITE',40,450);x.fillText('QA HOSPITAL',625,180);return c.toDataURL('image/png').split(',')[1];});}
for(const theme of ['light','dark'])for(const width of [390,1440])test(`hospital map upload persists, previews and uses private original ${theme} ${width}`,async({page},info)=>{
  test.setTimeout(60000);const store=await setup(page,{theme,width}),map=await mapImage(page);await client(page,{map,policy:'',cert:''});
  await showPage(page,'scope');await showPage(page,'emergency');
  await page.getByLabel('Nearest hospital and address',{exact:true}).fill('QA Hospital, 456 Synthetic Road');await page.getByLabel('Directions to nearest hospital',{exact:true}).fill('Synthetic QA directions; verify actual route before use.');
  await page.getByLabel('Hospital map photo',{exact:true}).setInputFiles({name:'qa-hospital-map.png',mimeType:'image/png',buffer:Buffer.from(map,'base64')});
  await page.getByRole('button',{name:'Upload hospital map',exact:true}).click();await expect(page.getByRole('status')).toContainText('Hospital map saved privately');
  await expect(page.getByRole('img',{name:'Nearest hospital map preview',exact:true})).toBeVisible();await expect.poll(()=>page.getByRole('img',{name:'Nearest hospital map preview',exact:true}).evaluate(i=>i.naturalWidth)).toBe(900);
  expect(await page.evaluate(()=>window.__safetyCalls.filter(c=>c.name==='review_job_board_document').length)).toBe(0);
  await expect.poll(()=>store.getState().jobs[0].siteSpecific?.hospitalMap?.fileName).toBe('qa-hospital-map.png');expect(store.getState().jobs[0].siteSpecific.attachments).toHaveLength(0);
  await saved(page);await page.screenshot({path:info.outputPath('hospital-map-'+theme+'-'+width+'.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  if(theme==='light'&&width===1440){const event=page.waitForEvent('download');await pdfMenu(page);await page.getByRole('button',{name:'Download PDF',exact:true}).click();const d=await event,file=info.outputPath(d.suggestedFilename());await d.saveAs(file);const parsed=await texts(file);expect(parsed.text).toContain('Nearest hospital map');expect(parsed.text).toContain('QA Hospital, 456 Synthetic Road');expect(parsed.text).toContain('JGC project manager');expect(parsed.text).toContain('headcount');}
  await page.reload();await client(page,{map,policy:'',cert:''});await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();await showPage(page,'scope');await showPage(page,'emergency');await expect(page.getByRole('img',{name:'Nearest hospital map preview',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Remove hospital map from plan',exact:true}).click();await expect.poll(()=>store.getState().jobs[0].siteSpecific.hospitalMap).toBeUndefined();
});

test('a missing hospital map blocks incomplete export; excluding the map or emergency section never reads it',async()=>{
  const {buildSiteSpecificPdf}=load('site-specific-pdf'),plan=model.createSitePlan(fixture().jobs[0],'QA'),logoBytes=new Uint8Array(fs.readFileSync(path.resolve(__dirname,'../estimating/jgc-logo-transparent.png')));
  plan.hospitalMap={id:'missing',kind:'board',title:'Nearest hospital map',included:true,fileName:'missing.png'};let reads=0;
  const build=()=>buildSiteSpecificPdf({plan,logoBytes,readAttachment:async()=>{reads++;throw new Error('File unavailable');}});
  await expect(build()).rejects.toThrow(/Nearest hospital map.*No incomplete PDF/);expect(reads).toBe(1);
  plan.hospitalMap.included=false;expect((await build()).pages).toBeGreaterThan(10);expect(reads).toBe(1);
  plan.hospitalMap.included=true;plan.pages.find(p=>p.id==='emergency').included=false;await build();expect(reads).toBe(1);
});

test('structured upgrade preserves legacy information and adds the full sample section structure without inventing decisions',()=>{
  const plan=model.createSitePlan(fixture().jobs[0],'QA');
  expect(plan.pages.slice(0,14).map(p=>p.id)).toEqual(['scope','work','contacts','roles','ppe','noise','dust','locates','logistics','waste','fire','controls','sds','emergency']);
  const questions=plan.pages.flatMap(p=>p.blocks||[]).filter(b=>b.type==='questions').flatMap(b=>b.rows);
  expect(questions.every(q=>q.value==='')).toBe(true);
  expect(questions.map(q=>q.label)).toEqual(expect.arrayContaining(['Powder-actuated tools required','System bypass required','Silica work required','Hot work required','Fire watch required','Concrete / floor scanning required']));
  const legacy={...structuredClone(plan),pages:load('site-specific-content').standardSafetyPages().reverse()};
  legacy.pages.find(p=>p.id==='contacts').fields[0].value='Preserve the previously assigned contact and notes';
  legacy.pages.find(p=>p.id==='contacts').included=false;legacy.pages.find(p=>p.id==='contacts').title='Existing signed plan contacts';
  legacy.published={documentId:'old-publication',at:'2026-10-01',updatedAt:'old',revision:'1'};
  const before=structuredClone(legacy),result=model.addStructuredSafetyContent(legacy);
  expect(legacy).toEqual(before);expect(result.plan.pages.slice(0,before.pages.length).map(p=>p.id)).toEqual(before.pages.map(p=>p.id));
  for(const old of before.pages){const upgraded=result.plan.pages.find(p=>p.id===old.id);expect(upgraded.fields.slice(0,old.fields.length)).toEqual(old.fields);expect(upgraded.title).toBe(old.title);expect(upgraded.included).toBe(old.included);}
  expect(result.plan.published).toEqual(before.published);expect(result.pagesAdded).toBe(2);
  expect(model.addStructuredSafetyContent(result.plan)).toMatchObject({blocksAdded:0,pagesAdded:0,fieldsAdded:0});
});

for(const theme of ['light','dark'])for(const width of [390,1440])test(`structured contacts, requirements, procedure steps and library persist ${theme} ${width}`,async({page},info)=>{
  test.setTimeout(90000);const store=await setup(page,{theme,width});await showPage(page,'scope');
  const choose={selectOption:id=>showPage(page,id)};await choose.selectOption('contacts');
  await page.getByRole('textbox',{name:'JGC / contractor contacts row 1 Name',exact:true}).fill('QA Contact');
  await page.getByRole('textbox',{name:'JGC / contractor contacts row 1 Phone',exact:true}).fill('613-555-0101');
  await page.getByRole('button',{name:'Add row to JGC / contractor contacts',exact:true}).click();
  await page.getByRole('textbox',{name:'JGC / contractor contacts row 4 Title / role',exact:true}).fill('Additional trade');
  await rowOptions(page,'JGC / contractor contacts row 4');await page.getByRole('button',{name:'Move JGC / contractor contacts row 4 up',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'JGC / contractor contacts row 3 Title / role',exact:true})).toHaveValue('Additional trade');
  await rowOptions(page,'JGC / contractor contacts row 3');await page.getByRole('button',{name:'Remove JGC / contractor contacts row 3',exact:true}).click();
  await page.screenshot({path:info.outputPath(`contacts-${theme}-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Save page to library',exact:true}).click();
  await choose.selectOption('noise');await page.getByRole('combobox',{name:'Project requirement',exact:true}).selectOption('Applicable');
  await page.getByRole('combobox',{name:'Generators required',exact:true}).selectOption('No');
  await page.getByRole('textbox',{name:'Generators required notes',exact:true}).fill('Facility supply agreed');
  await choose.selectOption('ppe');await page.getByRole('combobox',{name:'Safety glasses requirement',exact:true}).selectOption('Required');
  await page.getByRole('textbox',{name:'Safety glasses details',exact:true}).fill('Task-appropriate eye protection');
  await page.screenshot({path:info.outputPath(`ppe-${theme}-${width}.png`),fullPage:true});
  await choose.selectOption('dust');await page.getByRole('textbox',{name:'Dust control procedure step 1 instructions',exact:true}).fill('QA editable source control steps');
  await page.getByRole('button',{name:'Add step to Dust control procedure',exact:true}).click();
  await page.getByRole('textbox',{name:'Dust control procedure step 8 heading',exact:true}).fill('Final inspection');
  await page.getByRole('textbox',{name:'Dust control procedure step 8 instructions',exact:true}).fill('QA end-of-shift inspection');
  await saved(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages.find(p=>p.id==='dust').blocks.find(b=>b.id==='dust-plan').rows.length).toBe(8);
  await page.reload();await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();await showPage(page,'scope');await choose.selectOption('noise');
  await expect(page.getByRole('combobox',{name:'Generators required',exact:true})).toHaveValue('No');
  await options(page);await page.getByRole('button',{name:'Saved pages',exact:true}).click();await page.locator('.ss-library summary').click();await page.getByRole('button',{name:'Use in this plan',exact:true}).click();
  await page.getByRole('textbox',{name:'JGC / contractor contacts row 1 Name',exact:true}).fill('Adapted copy');
  await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages.at(-1).blocks[0].rows[0].cells.name).toBe('Adapted copy');
  expect(store.getState().safetyLibrary[0].blocks[0].rows[0].cells.name).toBe('QA Contact');
});

test('section map uploads stay private, retain captions and export inside their section without a duplicate appendix',async({page},info)=>{
  test.setTimeout(90000);const store=await setup(page),map=await mapImage(page);await client(page,{map,policy:'',cert:''});
  await showPage(page,'scope');await showPage(page,'logistics');
  await page.getByLabel('Section map or photo',{exact:true}).setInputFiles({name:'qa-site-map.png',mimeType:'image/png',buffer:Buffer.from(map,'base64')});
  await expect(page.getByRole('status')).toContainText('Plan image saved privately');
  await page.getByRole('textbox',{name:'Image 1 title',exact:true}).fill('QA Logistics Map');
  await page.getByRole('textbox',{name:'Image 1 caption',exact:true}).fill('QA red boundary and green muster point');
  await expect(page.getByRole('img',{name:'QA Logistics Map preview',exact:true})).toBeVisible();
  await saved(page);const event=page.waitForEvent('download');await pdfMenu(page);await page.getByRole('button',{name:'Download PDF',exact:true}).click();const d=await event,file=info.outputPath(d.suggestedFilename());await d.saveAs(file);
  const pdf=await texts(file),mapPage=pdf.values.findIndex(t=>t.includes('QA Logistics Map'));expect(mapPage).toBeGreaterThan(0);expect(pdf.values[mapPage]).toContain('9. Site plan, logistics and traffic control');expect(pdf.values[mapPage]).toContain('QA red boundary and green muster point');expect(pdf.values[mapPage+1]).toContain('10. Waste and material storage');
  expect(pdf.text.match(/QA Logistics Map/g)).toHaveLength(1);expect(await page.evaluate(()=>window.__safetyCalls.filter(c=>c.name==='review_job_board_document').length)).toBe(0);
  expect(store.getState().jobs[0].siteSpecific.pages.find(p=>p.id==='logistics').illustrations[0].caption).toContain('QA red');
});

test('large table rows and long checklist details continue without losing text; missing section images block export',async({},info)=>{
  test.setTimeout(60000);const {buildSiteSpecificPdf}=load('site-specific-pdf'),plan=model.createSitePlan(fixture().jobs[0],'QA'),logoBytes=new Uint8Array(fs.readFileSync(path.resolve(__dirname,'../estimating/jgc-logo-transparent.png')));
  plan.pages=plan.pages.filter(p=>['contacts','ppe','logistics'].includes(p.id));
  const contacts=plan.pages[0].blocks[0];contacts.rows=Array.from({length:38},(_,i)=>({id:'row-'+i,cells:{role:'Role '+i,name:'Unique contact '+i,phone:'613-555-0100',email:`person${i}@example.invalid`}}));
  contacts.rows[5].cells.email=Array.from({length:450},(_,i)=>'uniquetoken'+i).join(' ');
  const ppe=plan.pages[1].blocks[0];ppe.rows[0].notes=Array.from({length:220},(_,i)=>'ppeword'+i).join(' ');ppe.rows[0].value='Required';
  plan.pages[2].illustrations=[{id:'missing-image',kind:'board',included:true,title:'Site plan image',fileName:'missing.png'}];let reads=0;
  const build=()=>buildSiteSpecificPdf({plan,logoBytes,readAttachment:async()=>{reads++;throw new Error('Missing image');}});
  await expect(build()).rejects.toThrow(/No incomplete PDF/);plan.pages[2].illustrations[0].included=false;
  const result=await build();expect(reads).toBe(1);const file=info.outputPath('structured-long-content.pdf');fs.writeFileSync(file,Buffer.from(await result.blob.arrayBuffer()));const pdf=await texts(file);
  for(let i=0;i<38;i++)expect(pdf.text).toContain('Unique contact '+i);
  for(let i=0;i<450;i++)expect(pdf.text).toContain('uniquetoken'+i);
  for(let i=0;i<220;i++)expect(pdf.text).toContain('ppeword'+i);
  expect(pdf.values.filter(v=>v.includes('JGC / contractor contacts - continued')).length).toBeGreaterThan(1);
});

test('document pages navigate, exclude safely, add editable text and tables, undo removals and export their values',async({page},info)=>{
 test.setTimeout(90000);const store=await setup(page);await expect(page.getByRole('button',{name:'Previous page',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.locator('.ss-paper')).toHaveAttribute('data-page-id','scope');
 await page.getByRole('textbox',{name:'Scope of work',exact:true}).fill('DOCUMENT EDITOR SCOPE');await page.getByRole('checkbox',{name:'Include this page',exact:true}).uncheck();await page.getByRole('button',{name:'Next page',exact:true}).click();await page.getByRole('button',{name:'Previous page',exact:true}).click();await expect(page.getByRole('textbox',{name:'Scope of work',exact:true})).toHaveValue('DOCUMENT EDITOR SCOPE');await expect(page.getByRole('checkbox',{name:'Include this page',exact:true})).not.toBeChecked();await page.getByRole('checkbox',{name:'Include this page',exact:true}).check();
 await page.getByRole('button',{name:'+ Text',exact:true}).click();await page.getByRole('textbox',{name:'Additional information',exact:true}).fill('DOCUMENT EDITOR EXTRA TEXT');await page.getByRole('button',{name:'Remove Additional information field',exact:true}).click();await expect(page.getByRole('textbox',{name:'Additional information',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Undo removal',exact:true}).click();await expect(page.getByRole('textbox',{name:'Additional information',exact:true})).toHaveValue('DOCUMENT EDITOR EXTRA TEXT');
 await page.getByRole('button',{name:'+ Table',exact:true}).click();await page.getByRole('textbox',{name:'Additional details row 1 Item',exact:true}).fill('DOCUMENT EDITOR TABLE ITEM');await page.getByRole('textbox',{name:'Additional details row 1 Details',exact:true}).fill('DOCUMENT EDITOR TABLE VALUE');await page.getByRole('button',{name:'Remove Additional details section',exact:true}).click();await page.getByRole('button',{name:'Undo removal',exact:true}).click();await expect(page.getByRole('textbox',{name:'Additional details row 1 Details',exact:true})).toHaveValue('DOCUMENT EDITOR TABLE VALUE');
 await saved(page);await page.reload();await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();await showPage(page,'scope');await expect(page.getByRole('textbox',{name:'Additional information',exact:true})).toHaveValue('DOCUMENT EDITOR EXTRA TEXT');await pdfMenu(page);const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download PDF',exact:true}).click();const d=await download,file=info.outputPath(d.suggestedFilename());await d.saveAs(file);const pdf=await texts(file);for(const value of ['DOCUMENT EDITOR SCOPE','DOCUMENT EDITOR EXTRA TEXT','DOCUMENT EDITOR TABLE ITEM','DOCUMENT EDITOR TABLE VALUE'])expect(pdf.text).toContain(value);expect(store.getState().jobs[0].siteSpecific.pages[0].included).toBe(true);
});
