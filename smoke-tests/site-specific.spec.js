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
async function expandFormatting(page){const button=page.getByRole('button',{name:'Expand formatting',exact:true});if(await button.isVisible())await button.click();}
async function saved(page){await page.getByRole('button',{name:'Save plan',exact:true}).click();await pdfMenu(page);await expect(page.getByRole('button',{name:'Download PDF',exact:true})).toBeEnabled({timeout:12000});}
async function texts(file){const pdfjs=await import(pathToFileURL(path.resolve(__dirname,'../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href),pdf=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(file)),disableWorker:true,standardFontDataUrl:path.resolve(__dirname,'../estimating-app/node_modules/pdfjs-dist/standard_fonts').replaceAll('\\','/')+'/'}).promise,values=[];for(let i=1;i<=pdf.numPages;i++)values.push((await (await pdf.getPage(i)).getTextContent()).items.map(x=>x.str).join(' '));return {pages:pdf.numPages,text:values.join('\n'),values};}
test('plan dates and concurrent saves prevent invalid dates and silently mixing a single plan',()=>{const s=fixture(),p=model.createSitePlan(s.jobs[0],'QA');p.planDate='2026-02-31';expect(model.sitePlanErrors(p)).toContain('Valid plan date');p.planDate='2028-02-29';expect(model.sitePlanErrors(p)).not.toContain('Valid plan date');s.jobs[0].siteSpecific=p;const a=structuredClone(s),b=structuredClone(s);a.jobs[0].siteSpecific.pages[0].fields[0].value='A';b.jobs[0].siteSpecific.pages[0].fields[1].value='B';expect(merge(s,a,b).state).toBeNull();const c=structuredClone(s);c.jobs[0].notes='Other field';expect(merge(s,a,c).state.jobs[0].siteSpecific.pages[0].fields[0].value).toBe('A');});
for(const theme of ['light','dark'])for(const width of [390,1440])test(`plan fields, toggles, reusable page copies and layout ${theme} ${width}`,async({page},info)=>{test.setTimeout(60000);const store=await setup(page,{theme,width});await page.getByLabel('Prepared by',{exact:true}).fill('QA Author');await showPage(page,'scope');await page.getByRole('textbox',{name:'Scope of work',exact:true}).fill('Site-specific QA scope');await page.getByRole('button',{name:'Save page to library',exact:true}).click();await options(page);await page.getByRole('button',{name:'Saved pages',exact:true}).click();await page.locator('.ss-library summary').filter({hasText:'Specific location of project'}).click();await page.getByRole('button',{name:'Use in this plan',exact:true}).click();await expect(page.getByRole('textbox',{name:'Scope of work',exact:true})).toHaveText('Site-specific QA scope');await page.getByLabel('Page title',{exact:true}).fill('Reusable QA scope copy');await showPage(page,'ppe');await page.getByRole('checkbox',{name:'Include this page',exact:true}).uncheck();await expect(page.getByRole('checkbox',{name:'Include this page',exact:true})).not.toBeChecked();await expect.poll(()=>store.saves.at(-1)?.jobs[0].siteSpecific.pages.some(p=>p.title==='Reusable QA scope copy')).toBe(true);expect(store.getState().safetyLibrary[0].title).toBe('Specific location of project');await showPage(page,'cover');await expect(page.getByLabel('Prepared by',{exact:true})).toHaveText('QA Author');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath('builder-'+theme+'-'+width+'.png'),fullPage:true});await page.reload();await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();await expect(page.getByLabel('Prepared by',{exact:true})).toHaveText('QA Author');});
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
  await expect(page.getByLabel('Site address',{exact:true})).toHaveText('456 QA Street');
  await options(page);await page.getByRole('button',{name:'Saved pages',exact:true}).click();await page.locator('.ss-library summary').click();
  await page.getByRole('button',{name:'Use in this plan',exact:true}).click();await page.getByRole('textbox',{name:'Scope of work',exact:true}).fill('Second job adapted scope');
  await expect.poll(()=>store.saves.at(-1)?.jobs[1].siteSpecific?.pages.at(-1).fields[0].value).toBe('Second job adapted scope');
  expect(store.getState().jobs[0].siteSpecific?.pages[0].fields[0].value).toBe('First job original scope');
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
  await expect(page.getByRole('textbox',{name:'Work steps or procedure',exact:true})).toHaveText(/Identify the equipment/);
  await page.getByRole('textbox',{name:'Person responsible / review',exact:true}).fill('QA Site Supervisor');await page.getByRole('button',{name:'Save page to library',exact:true}).click();
  await page.getByRole('button',{name:'Add procedure',exact:true}).click();await expect(page.getByRole('textbox',{name:'Person responsible / review',exact:true})).toHaveText('');
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
  await expect(page.locator('.ss-paper').getByRole('button',{name:/Remove|Delete/i})).toHaveCount(0);await page.getByRole('checkbox',{name:'Include hospital map in PDF',exact:true}).uncheck();await expect.poll(()=>store.getState().jobs[0].siteSpecific.hospitalMap?.included).toBe(false);expect(store.getState().jobs[0].siteSpecific.hospitalMap.fileName).toBe('qa-hospital-map.png');
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
  await expect(page.getByRole('textbox',{name:'JGC / contractor contacts row 3 Title / role',exact:true})).toHaveText('Additional trade');
  await page.getByRole('textbox',{name:'JGC / contractor contacts row 3 Title / role',exact:true}).fill('');await expect(page.getByRole('textbox',{name:'JGC / contractor contacts row 3 Title / role',exact:true})).toBeVisible();await expect(page.locator('.ss-paper').getByRole('button',{name:/Remove|Delete/i})).toHaveCount(0);
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
  const pdf=await texts(file),mapPage=pdf.values.findIndex(t=>t.includes('QA Logistics Map'));expect(mapPage).toBeGreaterThan(0);const mapSection=pdf.values[mapPage].match(/(\d+)\. Site plan, logistics and traffic control/);expect(mapSection).not.toBeNull();expect(pdf.values[mapPage]).toContain('QA red boundary and green muster point');expect(pdf.values[mapPage+1]).toContain(`${Number(mapSection[1])+1}. Waste and material storage`);
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

test('document pages navigate, exclude safely, add editable text and tables, keep their structure and export values',async({page},info)=>{
 test.setTimeout(90000);const store=await setup(page);await expect(page.getByRole('button',{name:'Previous page',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.locator('.ss-paper')).toHaveAttribute('data-page-id','contents');await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.locator('.ss-paper')).toHaveAttribute('data-page-id','scope');
 await page.getByRole('textbox',{name:'Scope of work',exact:true}).fill('DOCUMENT EDITOR SCOPE');await page.getByRole('checkbox',{name:'Include this page',exact:true}).uncheck();await page.getByRole('button',{name:'Next page',exact:true}).click();await page.getByRole('button',{name:'Previous page',exact:true}).click();await expect(page.getByRole('textbox',{name:'Scope of work',exact:true})).toHaveText('DOCUMENT EDITOR SCOPE');await expect(page.getByRole('checkbox',{name:'Include this page',exact:true})).not.toBeChecked();await page.getByRole('checkbox',{name:'Include this page',exact:true}).check();
 await page.getByRole('button',{name:'+ Text',exact:true}).click();await page.getByRole('textbox',{name:'Additional information',exact:true}).fill('DOCUMENT EDITOR EXTRA TEXT');await expect(page.locator('.ss-paper').getByRole('button',{name:/Remove|Delete/i})).toHaveCount(0);
 await page.getByRole('button',{name:'+ Table',exact:true}).click();await page.getByRole('textbox',{name:'Additional details row 1 Item',exact:true}).fill('DOCUMENT EDITOR TABLE ITEM');await page.getByRole('textbox',{name:'Additional details row 1 Details',exact:true}).fill('DOCUMENT EDITOR TABLE VALUE');await expect(page.locator('.ss-paper').getByRole('button',{name:/Remove|Delete/i})).toHaveCount(0);
 await saved(page);await page.reload();await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();await showPage(page,'scope');await expect(page.getByRole('textbox',{name:'Additional information',exact:true})).toHaveText('DOCUMENT EDITOR EXTRA TEXT');await pdfMenu(page);const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download PDF',exact:true}).click();const d=await download,file=info.outputPath(d.suggestedFilename());await d.saveAs(file);const pdf=await texts(file);for(const value of ['DOCUMENT EDITOR SCOPE','DOCUMENT EDITOR EXTRA TEXT','DOCUMENT EDITOR TABLE ITEM','DOCUMENT EDITOR TABLE VALUE'])expect(pdf.text).toContain(value);expect(store.getState().jobs[0].siteSpecific.pages[0].included).toBe(true);
});

test('PDF omits unanswered content, prompt-only rows and empty sections without changing the saved plan',async({},info)=>{
 const {buildSiteSpecificPdf}=load('site-specific-pdf'),plan=model.createSitePlan(fixture().jobs[0],'QA'),logoBytes=new Uint8Array(fs.readFileSync(path.resolve(__dirname,'../estimating/jgc-logo-transparent.png')));
 const empty=model.createTaskPage('custom');empty.title='UNFILLED SECTION';empty.fields=[{id:'blank',label:'UNFILLED FIELD',value:' \n '}];
 const content=model.createTaskPage('custom');content.title='Completed site information';content.fields=[{id:'filled',label:'Entered information',value:'KEEP ENTERED INFORMATION'},{id:'blank',label:'UNFILLED FIELD',value:''}];
 const columns=[{id:'item',label:'Item'},{id:'detail',label:'Details'},{id:'unused',label:'UNFILLED COLUMN'}];
 content.blocks=[
  {type:'table',id:'empty-table',title:'UNFILLED TABLE',columns,rows:[{id:'blank',cells:{item:' ',detail:'\n',unused:''}}]},
  {type:'table',id:'filled-table',title:'Entered rows',columns,rows:[{id:'blank',cells:{}},{id:'one',cells:{item:'KEEP FIRST ITEM',detail:'N/A'}},{id:'two',cells:{item:'KEEP SECOND ITEM',detail:'0'}}]},
  {type:'questions',id:'questions',title:'Assessed requirements',rows:[{id:'blank',label:'UNANSWERED QUESTION',options:['Yes','No'],value:'',notes:''},{id:'no',label:'KEEP NO ANSWER',options:['Yes','No'],value:'No',notes:''},{id:'na',label:'KEEP NOT APPLICABLE',options:['Applicable','Not applicable'],value:'Not applicable',notes:''},{id:'notes',label:'KEEP NOTES QUESTION',options:['Yes','No'],value:'',notes:'KEEP NOTES WITHOUT AN ANSWER'}]},
  {type:'checklist',id:'ppe',title:'Assessed equipment',rows:[{id:'blank',label:'UNASSESSED EQUIPMENT',value:'',notes:''},{id:'no',label:'KEEP NOT REQUIRED',value:'Not required',notes:''},{id:'notes',label:'KEEP EQUIPMENT NOTES',value:'',notes:'KEEP NOTES WITHOUT A STATUS'}]},
  {type:'steps',id:'steps',title:'Entered procedure',rows:[{id:'blank',title:'UNFILLED STEP',body:' '},{id:'filled',title:'Carry out the work',body:'KEEP PROCEDURE INSTRUCTIONS'}]},
 ];
 const defaults=load('site-specific-structure').structuredSafetyPages();
 const contacts=defaults.find(p=>p.id==='contacts');contacts.title='UNFILLED CONTACTS';
 const legend=defaults.find(p=>p.id==='logistics');legend.title='UNFILLED LEGEND';legend.fields=[];
 const imageOnly={...model.createTaskPage('custom'),title:'Site map only',fields:[],blocks:[],illustrations:[{id:'site-map',kind:'board',title:'KEEP SITE MAP',included:true,fileName:'map.png'}]};
 const emergency={...model.createTaskPage('custom'),id:'emergency',title:'Hospital map only',fields:[],blocks:[]};
 plan.client=' ';plan.pages=[empty,content,contacts,legend,imageOnly,emergency];plan.hospitalMap={id:'hospital-map',kind:'board',title:'Nearest hospital map',included:true,fileName:'hospital.png'};
 const before=structuredClone(plan),reads=[];
 const result=await buildSiteSpecificPdf({plan,logoBytes,readAttachment:async item=>{reads.push(item.id);return new Blob([logoBytes],{type:'image/png'});}});
 expect(plan).toEqual(before);expect(reads.sort()).toEqual(['hospital-map','site-map']);
 const file=info.outputPath('filled-content-only.pdf');fs.writeFileSync(file,Buffer.from(await result.blob.arrayBuffer()));const pdf=await texts(file);
 expect(pdf.pages).toBe(5);
 for(const value of ['UNFILLED','UNANSWERED','UNASSESSED','Not entered','Not assessed','No entries','Details not entered','CLIENT / OWNER'])expect(pdf.text).not.toContain(value);
 for(const value of ['KEEP ENTERED INFORMATION','KEEP FIRST ITEM','KEEP SECOND ITEM','N/A','0','No','Not applicable','Not required','KEEP NOTES WITHOUT AN ANSWER','KEEP NOTES WITHOUT A STATUS','KEEP PROCEDURE INSTRUCTIONS','KEEP SITE MAP','Nearest hospital map'])expect(pdf.text).toContain(value);
 expect(pdf.values[1]).toContain('1. Completed site information');expect(pdf.values[1]).toContain('2. Site map only');expect(pdf.values[1]).toContain('3. Hospital map only');
 expect(pdf.values[3]).not.toContain('continued');expect(pdf.values[4]).not.toContain('continued');
 for(let i=0;i<pdf.pages;i++)expect(pdf.values[i]).toContain(`Page ${i+1} of ${pdf.pages}`);
});

test('a plan with only blank sections exports its cover without empty contents or section pages',async({},info)=>{
 const {buildSiteSpecificPdf}=load('site-specific-pdf'),plan=model.createSitePlan(fixture().jobs[0],'QA'),logoBytes=new Uint8Array(fs.readFileSync(path.resolve(__dirname,'../estimating/jgc-logo-transparent.png')));
 plan.pages=[model.createTaskPage('task')];plan.pages[0].title='UNFILLED SECTION';plan.client='';
 const before=structuredClone(plan);const result=await buildSiteSpecificPdf({plan,logoBytes,readAttachment:async()=>{throw new Error('No attachments expected');}});
 const file=info.outputPath('cover-only.pdf');fs.writeFileSync(file,Buffer.from(await result.blob.arrayBuffer()));const pdf=await texts(file);
 expect(pdf.pages).toBe(1);expect(pdf.text).not.toMatch(/UNFILLED|PLAN CONTENTS|Not entered|CLIENT \/ OWNER/);expect(plan).toEqual(before);
});

test('blank editor fields remain available, cannot be deleted and only populated table columns reach the PDF',async({page},info)=>{
 test.setTimeout(60000);const store=await setup(page);await showPage(page,'scope');
 const floor=page.getByRole('textbox',{name:'Work areas and access row 1 Floor / level',exact:true});
 const room=page.getByRole('textbox',{name:'Work areas and access row 1 Room / work area',exact:true});
 await expect(page.locator('.ss-paper').getByRole('button',{name:/Remove|Delete/i})).toHaveCount(0);
 await expect(page.locator('.ss-paper .ss-row-actions')).toHaveCount(0);
 async function download(name){await saved(page);const event=page.waitForEvent('download');await pdfMenu(page);await page.getByRole('button',{name:'Download PDF',exact:true}).click();const d=await event,file=info.outputPath(name);await d.saveAs(file);return texts(file);}
 const blank=await download('empty-work-areas.pdf');expect(blank.text).not.toContain('Work areas and access');await expect(floor).toBeVisible();await expect(room).toHaveText('');
 await floor.fill('KEEP COMPLETED WORK AREA');const filled=await download('filled-work-areas.pdf');expect(filled.text).toContain('Work areas and access');expect(filled.text).toContain('KEEP COMPLETED WORK AREA');expect(filled.text).not.toContain('Room / work area');
 await floor.fill('');const cleared=await download('cleared-work-areas.pdf');expect(cleared.text).not.toContain('Work areas and access');
 await expect(floor).toBeVisible();await expect(room).toBeVisible();const table=store.getState().jobs[0].siteSpecific.pages.find(p=>p.id==='scope').blocks[0];expect(table.columns).toHaveLength(3);expect(table.rows).toHaveLength(1);
 await page.reload();await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();await showPage(page,'scope');await expect(floor).toHaveText('');await expect(room).toBeVisible();
});


for(const width of [390,1440])test(`automatic contents is the second editor page and follows included content ${width}`,async({page},info)=>{
 await setup(page,{width});await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.locator('.ss-paper')).toHaveAttribute('data-page-id','contents');await expect(page.locator('.ss-contents')).toContainText('Table of contents');
 await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.locator('.ss-paper')).toHaveAttribute('data-page-id','scope');await page.getByRole('textbox',{name:'Scope of work',exact:true}).fill('Completed scope');await page.getByRole('textbox',{name:'Page title',exact:true}).fill('Our scope');await showPage(page,'contents');await expect(page.locator('.ss-contents')).toContainText('Our scope');await page.locator('.ss-contents button').filter({hasText:'Our scope'}).click();await expect(page.locator('.ss-paper')).toHaveAttribute('data-page-id','scope');await page.getByRole('checkbox',{name:'Include this page',exact:true}).uncheck();await showPage(page,'contents');await expect(page.locator('.ss-contents')).not.toContainText('Our scope');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('contents-'+width+'.png'),fullPage:true});
});

for(const width of [390,1440])test(`site text formatting saves in narrative and table cells ${width}`,async({page},info)=>{
 test.setTimeout(60000);const store=await setup(page,{width,theme:width===390?'dark':'light'});const author=page.getByRole('textbox',{name:'Prepared by',exact:true});await author.fill('Format Author');await author.click();await author.press('ControlOrMeta+A');await expandFormatting(page);await page.getByRole('button',{name:'Bold',exact:true}).click();await expect.poll(()=>store.getState().jobs[0].siteSpecific?.preparedBy).toContain('[b]');await page.getByLabel('Plan date',{exact:true}).focus();await expect(page.getByRole('group',{name:'Site plan text formatting',exact:true})).toBeHidden();expect(store.getState().jobs[0].siteSpecific.preparedBy).not.toContain('[u]');await showPage(page,'scope');const field=page.getByRole('textbox',{name:'Scope of work',exact:true});await field.fill('Important site hazard');await field.click();await field.press('ControlOrMeta+A');await expandFormatting(page);await page.getByRole('button',{name:'Bold',exact:true}).click();await page.getByRole('button',{name:'Underline',exact:true}).click();await page.getByLabel('Highlight colour',{exact:true}).selectOption('yellow');await page.getByRole('combobox',{name:'Text font',exact:true}).selectOption('serif');await page.getByRole('combobox',{name:'Text size',exact:true}).selectOption('lg');
 await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages[0].fields[0].value).toContain('[b]');await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages[0].fields[0].value).toContain('[u]');await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages[0].fields[0].value).toContain('[hy]');await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages[0].fields[0].value).toContain('[serif]');
 await saved(page);await page.reload();await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();await showPage(page,'scope');await expect(field).toHaveText('Important site hazard');expect(await field.locator('span').first().evaluate(el=>getComputedStyle(el).fontFamily)).toContain('Times New Roman');await page.screenshot({path:info.outputPath('formatting-'+width+'.png'),fullPage:true});
 const cell=page.getByRole('textbox',{name:'Work areas and access row 1 Floor / level',exact:true});await cell.fill('North floor');await cell.click();await cell.press('ControlOrMeta+A');await expandFormatting(page);await page.getByRole('button',{name:'Italic',exact:true}).click();await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages[0].blocks.find(b=>b.id==='work-areas').rows[0].cells.floor).toContain('[i]');
 await field.fill('First task\nSecond task');await field.click();await field.press('ControlOrMeta+A');if(width===390)await page.getByRole('tab',{name:'Paragraph',exact:true}).click();await page.getByRole('button',{name:'Bullets',exact:true}).click();await expect.poll(()=>load('site-specific-rich-text').safetyTextPlain(store.getState().jobs[0].siteSpecific?.pages[0].fields[0].value||'')).toContain('\u2022 First task');await field.press('ControlOrMeta+A');await page.getByRole('button',{name:'Numbered list',exact:true}).click();await expect.poll(()=>load('site-specific-rich-text').safetyTextPlain(store.getState().jobs[0].siteSpecific?.pages[0].fields[0].value||'')).toContain('1. First task');
});

test('formatted PDF preserves fonts, emphasis, highlighting and contents as page two',async({},info)=>{
 const plan=model.createSitePlan(fixture().jobs[0],'QA');plan.pages=[{id:'formatted',kind:'custom',title:'Formatted safety page',included:true,fields:[{id:'narrative',label:'[b]Read first[/b]',value:'[serif][b][u][hy][lg]IMPORTANT HAZARD[/lg][/hy][/u][/b][/serif]\n\u2022 [i]Keep clear[/i]\n1. [mono]Contact supervisor[/mono]'}],blocks:[{type:'table',id:'t',title:'Table heading',columns:[{id:'a',label:'Description'}],rows:[{id:'r',cells:{a:'[hg][b]TABLE CONTROL[/b][/hg]'}}]}]}];const before=structuredClone(plan),{buildSiteSpecificPdf}=load('site-specific-pdf'),logoBytes=new Uint8Array(fs.readFileSync(path.resolve(__dirname,'../estimating/jgc-logo-transparent.png')));const result=await buildSiteSpecificPdf({plan,logoBytes,readAttachment:async()=>{throw Error('No attachments expected');}});const file=info.outputPath('formatted-site-specific.pdf');fs.writeFileSync(file,Buffer.from(await result.blob.arrayBuffer()));const parsed=await texts(file);expect(parsed.values[1]).toContain('PLAN CONTENTS');expect(parsed.values[1]).toContain('Formatted safety page');expect(parsed.text).toContain('IMPORTANT HAZARD');expect(parsed.text).toContain('TABLE CONTROL');expect(parsed.text).toMatch(/Contact\s+supervisor/);expect(parsed.text).not.toMatch(/\[(?:b|u|hy|lg|serif|mono)\]/);expect(plan).toEqual(before);
 const pdfjs=await import(pathToFileURL(path.resolve(__dirname,'../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href),pdf=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(file)),disableWorker:true}).promise;const content=await(await pdf.getPage(3)).getTextContent();const hazard=content.items.find(i=>i.str.includes('IMPORTANT HAZARD'));expect(hazard.height).toBeGreaterThan(11);expect(content.styles[hazard.fontName].fontFamily).toMatch(/serif/);
});


test('formatting preserves plain text, safely escapes HTML and changes list type without duplicate markers',()=>{
 const rich=load('site-specific-rich-text');expect(rich.safetyTextPlain('Legacy plain content')).toBe('Legacy plain content');expect(rich.safetyTextHtml('<img src=x onerror=alert(1)>')).not.toContain('<img');expect(rich.safetyTextHtml('[b]Important[/b]')).toContain('font-weight:bold');const bullets=rich.safetyList('[b]First task\nSecond task[/b]',false);expect(rich.safetyTextPlain(bullets)).toBe('\u2022 First task\n\u2022 Second task');expect(rich.safetyTextPlain(rich.safetyList(bullets,true))).toBe('1. First task\n2. Second task');expect(rich.safetyTextPlain(rich.safetyList(rich.safetyList(bullets,true),false))).toBe('\u2022 First task\n\u2022 Second task');
});


for(const width of [390,1440])test(`site contact phone formatting saves and preserves emphasis ${width}`,async({page},info)=>{
 test.setTimeout(60000);const store=await setup(page,{width});await showPage(page,'contacts');const phone=page.getByRole('textbox',{name:'JGC / contractor contacts row 1 Phone',exact:true});await phone.fill('');await phone.pressSequentially('6135551234');await expect(phone).toHaveText('613-555-1234');await phone.evaluate(el=>{el.focus();const node=document.createTreeWalker(el,NodeFilter.SHOW_TEXT).nextNode(),range=document.createRange();range.setStart(node,4);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);});await phone.press('Backspace');expect((await phone.innerText()).replace(/\D/g,'')).toBe('615551234');await phone.fill('6135551234');await phone.click();await phone.press('ControlOrMeta+A');await expandFormatting(page);await page.getByRole('button',{name:'Bold',exact:true}).click();await phone.press('End');await phone.pressSequentially(' x22');await expect(phone).toHaveText('613-555-1234 x22');await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages.find(p=>p.id==='contacts').blocks.find(b=>b.id==='contractor-contacts').rows[0].cells.phone).toContain('[b]');await saved(page);await page.reload();await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();await showPage(page,'contacts');await expect(phone).toHaveText('613-555-1234 x22');await phone.fill('+44 20 7946 0958');await expect(phone).toHaveText('+44 20 7946 0958');await phone.fill('');await expect(phone).toHaveText('');await showPage(page,'emergency');const emergency=page.getByRole('textbox',{name:'Emergency phone number',exact:true});await expect(emergency).toHaveText('911');const hospital=page.getByRole('textbox',{name:'Hospital phone',exact:true});await hospital.fill('6135556677');await expect(hospital).toHaveText('613-555-6677');
});

for(const width of [390,1440])test(`Word style ribbon selection, caret, colours and undo ${width}`,async({page},info)=>{
 test.setTimeout(90000);const store=await setup(page,{width});await showPage(page,'scope');const field=page.getByRole('textbox',{name:'Scope of work',exact:true});await field.fill('Important hazard\nKeep clear');await field.click();await field.press('ControlOrMeta+A');await expandFormatting(page);await page.getByRole('button',{name:'Bold',exact:true}).click();await expect(page.getByRole('button',{name:'Bold',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByLabel('Text size',{exact:true}).selectOption('pt18');await page.getByLabel('Font colour',{exact:true}).selectOption('#b42318');await page.getByLabel('Highlight colour',{exact:true}).selectOption('#cce9ff');await page.getByRole('button',{name:'Strikethrough',exact:true}).click();
 if(width===390)await page.getByRole('tab',{name:'Paragraph',exact:true}).click();await page.getByRole('button',{name:'Align centre',exact:true}).click();await page.getByLabel('Line spacing',{exact:true}).selectOption('ls15');await page.getByRole('button',{name:'Increase indent',exact:true}).click();await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages[0].fields[0].value).toContain('[in1]');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages[0].fields[0].value).not.toContain('[in1]');await page.getByRole('button',{name:'Redo',exact:true}).click();await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages[0].fields[0].value).toContain('[in1]');
 await saved(page);await page.reload();await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();await showPage(page,'scope');await expect(field).toContainText('Important hazard');await expect(field.locator('[data-ss-line]').first()).toHaveCSS('text-align','center');await field.click();await field.press('ControlOrMeta+A');await expandFormatting(page);await expect(page.getByLabel('Text size',{exact:true})).toHaveValue('pt18');await expect(page.getByLabel('Font colour',{exact:true})).toHaveValue('#b42318');await page.screenshot({path:info.outputPath('ribbon-'+width+'.png'),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.getByRole('button',{name:'Clear formatting',exact:true}).click();await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages[0].fields[0].value).toBe('Important hazard\nKeep clear');
 await field.fill('');await field.click();await page.getByLabel('Text size',{exact:true}).selectOption('pt14');await page.getByLabel('Font colour',{exact:true}).selectOption('#184e9e');await field.pressSequentially('Typed after choosing font');await expect(field).toHaveText('Typed after choosing font');await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages[0].fields[0].value).toContain('[pt14]');await expect.poll(()=>store.getState().jobs[0].siteSpecific?.pages[0].fields[0].value).toContain('[c184e9e]');const before=await field.innerHTML();await field.evaluate(el=>{el.closest('fieldset').disabled=true;el.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}));});expect(await field.innerHTML()).toBe(before);
});
test('ribbon PDF honours exact sizes, colour, alignment and large table pagination',async({},info)=>{
 const plan=model.createSitePlan(fixture().jobs[0],'QA'),{buildSiteSpecificPdf}=load('site-specific-pdf'),logoBytes=new Uint8Array(fs.readFileSync(path.resolve(__dirname,'../estimating/jgc-logo-transparent.png')));
 plan.pages=[{id:'ribbon',kind:'custom',title:'Formatting checks',included:true,fields:[{id:'f',label:'Read before starting',value:'[ac][pt24][cb42318][h cce9ff]CENTRED HAZARD[/h cce9ff][/cb42318][/pt24][/ac]\n[ar][u][pt18]RIGHT ALIGNED[/pt18][/u][/ar]\n[ls20][in1][pt16]First spaced paragraph\nSecond spaced paragraph[/pt16][/in1][/ls20]'}],blocks:[{type:'table',id:'t',title:'Large text in tables',columns:[{id:'a',label:'Requirement'},{id:'b',label:'Control'}],rows:Array.from({length:18},(_,i)=>({id:String(i),cells:{a:`[pt24][b]Requirement ${i}[/b][/pt24]`,b:`[pt18][c145b3d]Control ${i}[/c145b3d][/pt18]`}}))}]}];plan.pages[0].fields[0].value=plan.pages[0].fields[0].value.replaceAll('h cce9ff','hcce9ff');
 const result=await buildSiteSpecificPdf({plan,logoBytes,readAttachment:async()=>{throw Error('Unexpected attachment');}}),file=info.outputPath('ribbon-formatting.pdf');fs.writeFileSync(file,Buffer.from(await result.blob.arrayBuffer()));const parsed=await texts(file);for(let i=0;i<18;i++)expect(parsed.text).toContain('Control '+i);expect(parsed.text).not.toMatch(/\[(?:pt|ac|ar|ls|in|cb4)/);expect(parsed.text).toContain('CENTRED HAZARD');
 const pdfjs=await import(pathToFileURL(path.resolve(__dirname,'../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href),pdf=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(file)),disableWorker:true}).promise;
 let centred,right;for(let i=3;i<=pdf.numPages;i++){const content=await(await pdf.getPage(i)).getTextContent();for(const t of content.items){if(t.str==='CENTRED HAZARD')centred=t;if(t.str==='RIGHT ALIGNED')right=t; if(t.str&&t.height>15){expect(t.transform[5]).toBeGreaterThan(60);expect(t.transform[5]+t.height).toBeLessThan(695);}}}expect(centred.height).toBeCloseTo(24);expect(centred.transform[4]).toBeGreaterThan(100);expect(right.transform[4]+right.width).toBeCloseTo(554,0);
});

for(const width of [320,390,1440])test(`floating formatting follows selection, dismisses and fits viewport ${width}`,async({page},info)=>{
 test.setTimeout(60000);await setup(page,{width});await showPage(page,'scope');const box=page.getByRole('group',{name:'Site plan text formatting',exact:true}),field=page.getByRole('textbox',{name:'Scope of work',exact:true});await expect(box).toBeHidden();await field.fill('First line of work');await field.click();await expect(box).toBeVisible();await expect(box).toHaveCSS('position','fixed');
 await expect(page.getByRole('button',{name:'Expand formatting',exact:true})).toBeVisible();await expect(box.getByRole('button')).toHaveCount(4);await expect(page.getByLabel('Text font',{exact:true})).toBeHidden();await expect.poll(async()=>{const r=await box.boundingBox();return !!r&&r.width<=204&&r.height<=56;}).toBe(true);await page.screenshot({path:info.outputPath('compact-'+width+'.png')});
 await field.press('ControlOrMeta+A');await page.getByRole('button',{name:'Bold',exact:true}).click();await expect(field.locator('span').first()).toHaveCSS('font-weight','700');await page.getByRole('button',{name:'Italic',exact:true}).click();await page.getByRole('button',{name:'Underline',exact:true}).click();await expect(field.locator('span').first()).toHaveCSS('font-style','italic');await expect(field.locator('span').first()).toHaveCSS('text-decoration-line','underline');await expandFormatting(page);await page.getByLabel('Text font',{exact:true}).selectOption('serif');await expect(field.locator('span').first()).toHaveCSS('font-family',/Times/);
 await expect.poll(async()=>{const r=await box.boundingBox();return !!r&&r.x>=0&&r.y>=0&&r.x+r.width<=width+1&&r.y+r.height<=980;}).toBe(true);await page.screenshot({path:info.outputPath('floating-'+width+'.png')});
 await page.keyboard.press('Escape');await expect(box).toBeHidden();await field.click();await expect(box).toBeVisible();
 await expect(page.getByRole('button',{name:'Expand formatting',exact:true})).toBeVisible();await expandFormatting(page);await page.getByRole('button',{name:'Collapse formatting',exact:true}).click();await expect(page.getByRole('button',{name:'Bold',exact:true})).toBeVisible();await expect(page.getByLabel('Text font',{exact:true})).toBeHidden();await expandFormatting(page);
 await page.getByRole('button',{name:'Close formatting',exact:true}).click();await expect(box).toBeHidden();await field.click();await expect(box).toBeVisible();await page.getByRole('button',{name:'Save plan',exact:true}).click();await expect(box).toBeHidden();
 await field.click();await field.press('ControlOrMeta+A');await expandFormatting(page);await page.getByLabel('Text size',{exact:true}).selectOption('pt14');await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(box).toBeHidden();
});

test('mobile floating formatting stays above a reduced visual viewport keyboard',async({page},info)=>{
 await setup(page,{width:390});await showPage(page,'scope');const field=page.getByRole('textbox',{name:'Scope of work',exact:true}),box=page.getByRole('group',{name:'Site plan text formatting',exact:true});await field.fill('Keyboard selection');await field.click();await field.press('ControlOrMeta+A');await field.evaluate(el=>el.scrollIntoView({block:'center'}));
 await page.evaluate(()=>{const v=window.visualViewport;Object.defineProperty(v,'height',{configurable:true,value:380});Object.defineProperty(v,'offsetTop',{configurable:true,value:300});v.dispatchEvent(new Event('resize'));});await expect(box).toBeVisible();await expect.poll(async()=>{const r=await box.boundingBox();return !!r&&r.y>=300&&r.y+r.height<=680;}).toBe(true);await expandFormatting(page);await expect.poll(async()=>{const r=await box.boundingBox();return !!r&&r.y>=300&&r.y+r.height<=680;}).toBe(true);await page.getByRole('button',{name:'Underline',exact:true}).click();await expect(field.locator('span').first()).toHaveCSS('text-decoration-line','underline');await page.screenshot({path:info.outputPath('mobile-keyboard.png')});
});

test('traffic and spill templates are optional independent copies with blank site records',()=>{
 const choices=load('site-specific-plan-templates').sitePlanTemplateChoices;
 const plan=model.createSitePlan(fixture().jobs[0],'QA Author'),before=structuredClone(plan);
 expect(plan.pages.some(p=>choices.some(c=>c.id===p.layoutKey))).toBe(false);
 for(const {id} of choices){
  const a=model.createTaskPage(id),b=model.createStandardProcedure(id);
  expect(a.kind).toBe('procedure');expect(a.layoutKey).toBe(id);expect(a.id).not.toBe(b.id);
  expect(a.blocks.length).toBeGreaterThan(5);expect(a.illustrations).toEqual([]);
  expect(JSON.stringify(a)).not.toMatch(/GOC6812588|Brookdale|CBSA|BGIS|green-marked|red access alignment/);
  for(const block of a.blocks.filter(b=>b.type==='questions'))expect(block.rows.every(r=>r.value===''&&r.notes==='')).toBe(true);
  a.blocks[0].rows[0].cells.entry='QA entered site detail';expect(JSON.stringify(b)).not.toContain('QA entered site detail');
 }
 expect(plan).toEqual(before);
 const pages=choices.map(c=>model.createTaskPage(c.id)),filtered=load('site-specific-pdf-content').siteSpecificPdfPages({...plan,pages});
 expect(filtered[0].blocks.some(b=>b.id==='traffic-site'||b.id==='traffic-contacts'||b.id==='traffic-checks')).toBe(false);
 expect(filtered[1].blocks.some(b=>b.id==='spill-inventory'||b.id==='spill-capacity'||b.id==='spill-kits')).toBe(false);
 expect(filtered[2].blocks.some(b=>b.id==='spill-incident'||b.id==='spill-call-log'||b.id==='spill-closeout')).toBe(false);
 expect(JSON.stringify(filtered)).toContain('Off-site refuelling only');
 pages[0].blocks.find(b=>b.id==='traffic-checks').rows[0].value='No';
 expect(JSON.stringify(load('site-specific-pdf-content').siteSpecificPdfPages({...plan,pages}))).toContain('"value":"No"');
});

for(const width of [390,1440])test(`traffic and spill plan selectors save editable records and reuse safely ${width}`,async({page},info)=>{
 test.setTimeout(90000);const store=await setup(page,{width});await options(page);
 await page.getByRole('combobox',{name:'New page type',exact:true}).selectOption('traffic-control');await page.getByRole('button',{name:'Add page',exact:true}).click();
 await expect(page.getByLabel('Page title',{exact:true})).toHaveText('Traffic control plan');
 const entry=page.getByRole('textbox',{name:'Site access and layout row 2 Site information',exact:true});await entry.fill('QA approved east entrance');
 const check=page.getByRole('combobox',{name:'Access, security and delivery arrangements confirmed',exact:true});await check.selectOption('No');
 await page.getByRole('textbox',{name:'Access, security and delivery arrangements confirmed notes',exact:true}).fill('Awaiting QA confirmation');
 await page.getByRole('button',{name:'Save page to library',exact:true}).click();await expect.poll(()=>store.getState().safetyLibrary?.length).toBe(1);
 await options(page);await page.getByRole('combobox',{name:'Procedure template',exact:true}).selectOption('spill-prevention');await page.getByRole('button',{name:'Add procedure',exact:true}).click();
 await expect(page.getByLabel('Page title',{exact:true})).toHaveText('Spill prevention plan');
 await page.getByRole('textbox',{name:'Spill capacity worksheet row 2 Site information',exact:true}).fill('QA verified example 400 L');
 await page.getByRole('textbox',{name:'Spill kit register row 1 Exact location',exact:true}).fill('QA east staging area');
 await page.getByText('+ Map or photo',{exact:true}).click();await expect(page.getByLabel('Section map or photo',{exact:true})).toBeVisible();
 await options(page);await page.getByRole('combobox',{name:'New page type',exact:true}).selectOption('spill-response');await page.getByRole('button',{name:'Add page',exact:true}).click();
 await page.getByRole('textbox',{name:'Notification log row 1 Recipient / role',exact:true}).fill('QA site representative');
 await page.getByRole('checkbox',{name:'Include this page',exact:true}).uncheck();await saved(page);
 const pages=store.getState().jobs[0].siteSpecific.pages,traffic=pages.find(p=>p.layoutKey==='traffic-control'),response=pages.find(p=>p.layoutKey==='spill-response');
 expect(response.included).toBe(false);expect(store.getState().safetyLibrary[0].blocks[0].rows[1].cells.entry).toBe('QA approved east entrance');
 await page.reload();await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();
 await showPage(page,traffic.id);await expect(entry).toHaveText('QA approved east entrance');await expect(check).toHaveValue('No');
 await entry.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`traffic-${width}.png`)});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await options(page);await page.getByRole('combobox',{name:'Procedure template',exact:true}).selectOption('traffic-control');await page.getByRole('button',{name:'Add procedure',exact:true}).click();
 await expect(entry).toHaveText('');expect(store.getState().safetyLibrary[0].blocks[0].rows[1].cells.entry).toBe('QA approved east entrance');
});

test('traffic and spill PDF keeps procedures, entered records, contents and maps while omitting empty forms',async({page},info)=>{
 test.setTimeout(60000);const {buildSiteSpecificPdf}=load('site-specific-pdf'),plan=model.createSitePlan(fixture().jobs[0],'QA Author');
 plan.pages=['traffic-control','spill-prevention','spill-response'].map(id=>model.createTaskPage(id));
 const traffic=plan.pages[0],prevention=plan.pages[1],response=plan.pages[2];
 traffic.blocks.find(b=>b.id==='traffic-site').rows[1].cells.entry='QA verified entrance';
 traffic.blocks.find(b=>b.id==='traffic-checks').rows[0].value='No';
 prevention.blocks.find(b=>b.id==='spill-inventory').rows[0].cells={unit:'QA HYDRO UNIT',product:'QA hydraulic fluid',volume:'400',release:'400 L - independent system',control:'QA verified manufacturer data'};
 response.blocks.find(b=>b.id==='spill-call-log').rows[0].cells={recipient:'QA representative',time:'QA logged call',record:'QA reference 123'};
 const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=800;canvas.height=400;const c=canvas.getContext('2d');c.fillStyle='#e7f0e9';c.fillRect(0,0,800,400);c.fillStyle='#145b3d';c.font='28px Arial';c.fillText('QA TRAFFIC LAYOUT',60,150);return canvas.toDataURL('image/png').split(',')[1];});
 traffic.illustrations=[{id:'qa-layout',kind:'board',title:'Traffic layout',fileName:'qa-layout.png',fileType:'image/png',included:true,caption:'QA confirmed routes and exclusion zones'}];
 const before=structuredClone(plan),logoBytes=new Uint8Array(fs.readFileSync(path.resolve(__dirname,'../estimating/jgc-logo-transparent.png')));
 let reads=0;const result=await buildSiteSpecificPdf({plan,logoBytes,readAttachment:async()=>{reads++;return new Blob([Buffer.from(image,'base64')],{type:'image/png'});}});
 const file=info.outputPath('traffic-and-spill.pdf');fs.writeFileSync(file,Buffer.from(await result.blob.arrayBuffer()));const parsed=await texts(file);
 expect(reads).toBe(1);expect(plan).toEqual(before);expect(parsed.values[1]).toContain('PLAN CONTENTS');
 for(const text of ['Traffic control plan','Spill prevention plan','Spill cleanup and response plan','QA verified entrance','QA HYDRO UNIT','QA reference 123','QA confirmed routes and exclusion zones','Off-site refuelling only','110%'])expect(parsed.text).toContain(text);
 expect(parsed.text).not.toMatch(/GOC6812588|Brookdale|TO CONFIRM|Spill incident report|Spill capacity worksheet/);
 expect(parsed.values.at(-1)).toContain('Page '+parsed.pages+' of '+parsed.pages);
 const {PDFDocument}=require('../estimating-app/node_modules/pdf-lib'),pdf=await PDFDocument.load(fs.readFileSync(file));expect(pdf.getPages().every(p=>p.getWidth()===612&&p.getHeight()===792)).toBe(true);
});

test('added page deletion preserves standard sections, library copies and historical files',()=>{
 const plan=model.createSitePlan(fixture().jobs[0],'QA Author'),core=plan.pages[0];
 expect(model.deleteSafetyPage(plan,core.id)).toBe(plan);
 expect(model.deleteSafetyPage(plan,'missing')).toBe(plan);
 for(const kind of ['custom','task','procedure','risk','traffic-control','spill-prevention','spill-response'])expect(model.canDeleteSafetyPage(model.createTaskPage(kind))).toBe(true);
 const copy={...structuredClone(core),id:model.safetyId()},other={...structuredClone(copy),id:model.safetyId()};
 copy.illustrations=[{id:'map',kind:'board',title:'Saved map',included:true,fileName:'map.png'}];
 plan.pages.push(copy,other);plan.published={documentId:'published',at:'2026-10-01',revision:'1',updatedAt:'2026-10-01'};
 plan.attachments=[{id:'support',kind:'board',title:'Supporting PDF',included:true,fileName:'support.pdf'}];
 const library=structuredClone(copy),before=structuredClone(plan),result=model.deleteSafetyPage(plan,copy.id);
 expect(result.pages.some(p=>p.id===copy.id)).toBe(false);expect(result.pages.some(p=>p.id===other.id)).toBe(true);
 expect(result.published).toEqual(before.published);expect(result.attachments).toEqual(before.attachments);expect(plan).toEqual(before);expect(library.illustrations[0].id).toBe('map');
});

for(const width of [390,1440])test(`added page deletion confirms, saves and updates contents and PDF ${width}`,async({page},info)=>{
 test.setTimeout(60000);const seed=fixture(),plan=model.createSitePlan(seed.jobs[0],'QA Author'),added=model.createTaskPage('traffic-control'),keep=model.createTaskPage('traffic-control');
 added.title=keep.title='QA duplicate title';added.blocks[0].rows[0].cells.entry='UNIQUE DELETED PAGE CONTENT';keep.blocks[0].rows[0].cells.entry='RETAINED PAGE CONTENT';
 plan.pages=[plan.pages[0],added,keep];plan.updatedAt='2026-10-29T12:00:00Z';plan.published={documentId:'qa-historical',at:'2026-10-28',revision:'1',updatedAt:'2026-10-28'};seed.jobs[0].siteSpecific=plan;
 const store=await setup(page,{width,seed});await showPage(page,plan.pages[0].id);await expect(page.getByRole('button',{name:'Delete page',exact:true})).toHaveCount(0);
 await showPage(page,added.id);await page.getByRole('button',{name:'Save page to library',exact:true}).click();await expect.poll(()=>store.getState().safetyLibrary?.length).toBe(1);
 const library=structuredClone(store.getState().safetyLibrary),remove=page.getByRole('button',{name:'Delete page',exact:true});await remove.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`delete-page-${width}.png`)});
 page.once('dialog',dialog=>dialog.dismiss());await remove.click();expect(store.getState().jobs[0].siteSpecific.pages).toHaveLength(3);await expect(page.locator('.ss-paper')).toHaveAttribute('data-page-id',added.id);
 page.once('dialog',async dialog=>{expect(dialog.message()).toContain('QA duplicate title');await dialog.accept();});await remove.click();await saved(page);
 const result=store.getState().jobs[0].siteSpecific;expect(result.pages.map(p=>p.id)).toEqual([plan.pages[0].id,keep.id]);expect(result.published.documentId).toBe('qa-historical');expect(store.getState().safetyLibrary).toEqual(library);
 await expect(page.locator('.ss-paper')).toHaveAttribute('data-page-id',keep.id);await showPage(page,'contents');await expect(page.locator('.ss-contents').getByRole('button',{name:/QA duplicate title/})).toHaveCount(1);
 const built=await load('site-specific-pdf').buildSiteSpecificPdf({plan:result,logoBytes:new Uint8Array(fs.readFileSync(path.resolve(__dirname,'../estimating/jgc-logo-transparent.png'))),readAttachment:async()=>{throw new Error('No attachment should be read');}}),file=info.outputPath('after-delete.pdf');fs.writeFileSync(file,Buffer.from(await built.blob.arrayBuffer()));const parsed=await texts(file);expect(parsed.text).toContain('RETAINED PAGE CONTENT');expect(parsed.text).not.toContain('UNIQUE DELETED PAGE CONTENT');
 await page.reload();await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();await showPage(page,keep.id);expect(store.getState().jobs[0].siteSpecific.pages.some(p=>p.id===added.id)).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('last added page can be deleted and a fresh page can be added afterwards',async({page})=>{
 const seed=fixture(),plan=model.createSitePlan(seed.jobs[0],'QA Author'),added=model.createTaskPage('custom');plan.pages=[added];plan.updatedAt='2026-10-29T12:00:00Z';seed.jobs[0].siteSpecific=plan;
 const store=await setup(page,{width:390,seed});await showPage(page,added.id);page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete page',exact:true}).click();await saved(page);await expect(page.locator('.ss-paper')).toHaveAttribute('data-page-id','cover');expect(store.getState().jobs[0].siteSpecific.pages).toEqual([]);
 await page.reload();await page.getByRole('tab',{name:'Safety',exact:true}).click();await page.getByRole('tab',{name:'Create Site Specific',exact:true}).click();await options(page);await page.getByRole('combobox',{name:'New page type',exact:true}).selectOption('custom');await page.getByRole('button',{name:'Add page',exact:true}).click();await expect(page.getByLabel('Page title',{exact:true})).toHaveText('Additional page');await saved(page);expect(store.getState().jobs[0].siteSpecific.pages).toHaveLength(1);
});
