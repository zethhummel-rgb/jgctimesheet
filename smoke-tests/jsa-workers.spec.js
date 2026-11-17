const {test,expect}=require('@playwright/test');
const ORIGIN='https://xnrljkkszoimegfivlya.supabase.co';
const creator={id:'00000000-0000-4000-8000-000000000001',worker_key:'synthetic creator',display_name:'Synthetic Creator',email:'creator@example.com',role:'admin',account_status:'approved'};
const worker={id:'00000000-0000-4000-8000-000000000002',profile_id:'00000000-0000-4000-8000-000000000002',worker_key:'synthetic worker',display_name:'Synthetic Worker',email:'worker@example.com',role:'worker',account_status:'approved',approved:true};
const date=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const future=()=>{const now=new Date();now.setDate(now.getDate()+14);return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);};
async function pdfWords(bytes){
 const path=require('node:path'),url=require('node:url');
 const library=await import(url.pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs',{paths:[path.join(__dirname,'../estimating-app')]})).href);
 const task=library.getDocument({data:new Uint8Array(bytes),disableWorker:true}),pdf=await task.promise,words=[];
 try{for(let page=1;page<=pdf.numPages;page++)words.push((await (await pdf.getPage(page)).getTextContent()).items.map(item=>item.str).join(' '));return words.join(' ');}finally{await task.destroy();}
}
for(const width of [390,1280])test(`JSA searches or browses jobs without changing saved job context ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const jobs=[{id:'job1',job_number:'26108',customer:'Trans Northern Pipeline',job_name:'Megadome',site_name:'Lancaster Station',address:'100 Pipeline Road',active:true},{id:'job2',job_number:'26152',customer:'BGIS Federal',job_name:'Trailer Prep',site_name:'Cornwall Customs',address:'1 Water Street',active:true}];
 await fixture(page,jobs);await page.goto('/jsa.html');
 const search=page.getByRole('combobox',{name:'Search jobs'}), picker=page.locator('#jsaField1Select'), options=page.locator('#jsaJobSearchResults');
 await expect(picker.locator('option')).toHaveCount(4);
 await search.fill('26108');await expect(options.getByRole('option')).toHaveCount(1);await expect(options).toContainText('Megadome');
 for(const theme of ['light','dark']){await page.evaluate(t=>applyJgcTheme(t),theme);const contrast=await options.getByRole('option').evaluate(el=>{const lum=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};const bg=lum(getComputedStyle(el).backgroundColor),fg=lum(getComputedStyle(el.querySelector('.jgc-job-option__name')).color);return (Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05);});expect(contrast).toBeGreaterThanOrEqual(4.5);}
 if(process.env.JGC_JSA_SEARCH_SCREENSHOT)await page.screenshot({path:process.env.JGC_JSA_SEARCH_SCREENSHOT.replace('{width}',String(width))});
 await options.getByRole('option').click();await expect(page.locator('#jsaField1')).toHaveValue('26108 - Megadome');await expect(page.locator('#jsaField2')).toHaveValue('100 Pipeline Road');
 const saved=await page.evaluate(async()=>{const built=await buildInspectionRecord('JSA',getCurrentWorker());return {fields:built.record.form_data.fields,context:built.record.form_data.job_context};});
 expect(saved.fields.filter(field=>field.label==='Project / Job')).toEqual([{label:'Project / Job',value:'26108 - Megadome'}]);
 expect(saved.fields.some(field=>/Search jobs/i.test(field.label))).toBe(false);expect(saved.context).toMatchObject({jobNumber:'26108',jobName:'Megadome'});
 await search.fill('BGIS');await search.press('ArrowDown');await expect(options.getByRole('option')).toBeFocused();await page.keyboard.press('Escape');await expect(search).toBeFocused();await expect(options).toBeHidden();
 for(const term of ['BGIS','Trailer','Cornwall Customs','1 Water']){await search.fill(term);await expect(options.getByRole('option')).toHaveCount(1);await expect(options).toContainText('Trailer Prep');}
 await search.fill('no-such-project');await expect(options).toContainText('No matching jobs');await expect(page.locator('#jsaField1')).toHaveValue('26108 - Megadome');
 await page.keyboard.press('Escape');await expect(options).toBeHidden();
 await picker.selectOption('26152 - Trailer Prep');await expect(page.locator('#jsaField2')).toHaveValue('1 Water Street');await expect(search).toHaveValue('');
 await picker.selectOption('__manual__');await page.locator('#jsaField1').fill('Manual site');await expect(page.locator('#jsaField1')).toHaveValue('Manual site');
 await page.evaluate(()=>JgcPreparedJsa.restore({record:{inspection_date:'2099-10-15',form_data:{fields:[{label:'Project / Job',value:'26108 - Megadome'},{label:'Address',value:'Saved address'}],rows:[]}},crew:[],manual:[]}));
 await expect(picker).toHaveValue('26108 - Megadome');await expect(page.locator('#jsaField2')).toHaveValue('Saved address');
 await page.evaluate(()=>{document.getElementById('jsaField1').readOnly=true;});await expect(search).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
test('a future staff JSA saves the job selected through search',async({page})=>{
 const jobs=[{id:'job1',job_number:'26108',customer:'Trans Northern Pipeline',job_name:'Megadome',address:'100 Pipeline Road',active:true}];
 const store=await fixture(page,jobs,false);await page.goto('/jsa.html');await expect(page.locator('#approvedCrewStatus')).toContainText('1 approved employees loaded');
 await page.locator('#jsaJobSearch').fill('Megadome');await page.locator('#jsaJobSearchResults').getByRole('option').click();
 await page.locator('#jsaField3').fill(future());await page.locator('#tableBody textarea').nth(0).fill('Inspect access');await page.locator('#tableBody textarea').nth(1).fill('Falls');await page.locator('#tableBody textarea').nth(2).fill('Guardrails');
 await page.locator('#approvedCrewSelect').selectOption(worker.worker_key);await page.locator('#jsaSaveWorkerDraft').click();
 await expect.poll(()=>store.calls.some(call=>call.name==='save_worker_jsa')).toBe(true);
 const record=store.calls.find(call=>call.name==='save_worker_jsa').args.p_payload;
 expect(record.form_data.job_context).toMatchObject({jobNumber:'26108',jobName:'Megadome'});
 expect(record.form_data.fields.filter(field=>field.label==='Project / Job')).toEqual([{label:'Project / Job',value:'26108 - Megadome'}]);
});
for(const width of [390,1440])test(`job address autofills separately from on-site location ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const jobs=[{id:'job1',job_number:'26999',customer:'Synthetic Client',job_name:'Synthetic Job',site_name:'Main Office',address:'100 Synthetic Street, Test City',active:true},{id:'job2',job_number:'26998',customer:'Synthetic Client',job_name:'Other Job',address:'200 Other Street, Test City',active:true}];
 await fixture(page,jobs);await page.goto('/jsa.html');await expect(page.locator('#approvedCrewStatus')).toContainText('1 approved employees loaded');
 const values=await page.evaluate(jobs=>jobs.map(job=>getJgcProjectJobDisplay(job)),jobs);
 await page.locator('#jsaField1Select').selectOption(values[0]);await expect(page.getByLabel('Address',{exact:true})).toHaveValue(jobs[0].address);
 await page.getByLabel('General location on site',{exact:true}).fill('Northwest corner, second floor');
 await page.locator('#jsaField1Select').selectOption(values[1]);await expect(page.getByLabel('Address',{exact:true})).toHaveValue(jobs[1].address);await expect(page.getByLabel('General location on site',{exact:true})).toHaveValue('Northwest corner, second floor');
 const bytes=await page.evaluate(async()=>Array.from(new Uint8Array((await JgcJsaPdf.create({inspection_date:'2099-10-15',form_data:{fields:collectFields(),rows:[]}}, {prepared:true})).output('arraybuffer'))));
 const words=await pdfWords(bytes);expect(words).toContain('200 Other Street, Test City');expect(words).toContain('Northwest corner, second floor');
 await page.evaluate(()=>JgcPreparedJsa.restore({record:{inspection_date:'2099-10-15',form_data:{fields:[{label:'Location',value:'Saved legacy location'}],rows:[]}},crew:[],manual:[]}));await expect(page.getByLabel('Address',{exact:true})).toHaveValue('Saved legacy location');
 const oldBytes=await page.evaluate(async()=>Array.from(new Uint8Array((await JgcJsaPdf.create({inspection_date:'2020-10-10',form_data:{fields:[{label:'Location',value:'Saved legacy location'}],rows:[]}}, {prepared:true})).output('arraybuffer'))));
 const oldWords=await pdfWords(oldBytes);expect(oldWords).toContain('Saved legacy location');expect(oldWords).not.toContain('GENERAL LOCATION ON SITE');
});
async function fixture(page,jobs=[],isAdmin=true){
 const store={model:null,calls:[],savedDraft:null};
 const jwt=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:creator.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')+'.fixture';
 const session={access_token:jwt,refresh_token:'synthetic-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:creator};
 await page.addInitScript(({creator,session})=>{localStorage.setItem('sb-xnrljkkszoimegfivlya-auth-token',JSON.stringify(session));localStorage.setItem('currentWorker',creator.worker_key);localStorage.setItem('currentWorkerDisplay',creator.display_name);localStorage.setItem('currentUserEmail',creator.email);localStorage.setItem('currentUserRole','admin');localStorage.setItem('currentUserStatus','approved');localStorage.setItem('jgcTheme','light');}, {creator,session});
 page.on('dialog',d=>d.accept());
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),single=String(req.headers().accept || '').includes('object');
  if(url.hostname==='127.0.0.1' || url.hostname==='localhost' || url.hostname===process.env.JGC_SMOKE_LIVE_HOST)return route.fallback();
  if(url.origin!==ORIGIN)return route.abort();
  if(url.pathname.includes('/auth/v1/'))return route.fulfill({json:url.pathname.endsWith('/user')?creator:session});
  if(url.pathname.includes('/rpc/')){
   const name=url.pathname.split('/').pop(),args=req.postDataJSON();store.calls.push({name,args});
   if(name==='is_admin')return route.fulfill({json:isAdmin});
   if(name==='save_prepared_jsa'){store.savedDraft={id:args.p_id,revision:1,payload:args.p_payload,activated_at:null};return route.fulfill({json:store.savedDraft});}
   if(name==='save_worker_jsa'){
    const payload=args.p_payload,acks=store.model?.acknowledgements || args.p_workers.map((w,i)=>({id:'00000000-0000-4000-8000-00000000000'+(i+5),attendee_name:w.employee_id?worker.display_name:w.name,attendee_company:w.company,matched_employee_id:w.employee_id,signature_signed_at:null}));
    const active=payload.inspection_date===date();store.model={record:{...payload,id:args.p_id,form_data:{...payload.form_data,jsa_worker_workflow_version:2}},workflow:{version:2,revision:1,today:date(),active,valid_date:payload.inspection_date,required:acks.length,signed:0,outstanding:acks.length,status:active?'Draft — Awaiting Worker Sign-Offs':'Prepared'},acknowledgements:acks,can_collect:true};
    return route.fulfill({json:store.model});
   }
   if(name==='get_jsa_worker_workflow')return route.fulfill({json:store.model});
   if(name==='request_jsa_worker_signoff'){store.model.workflow.requested_at=new Date().toISOString();return route.fulfill({json:store.model});}
   if(name==='sign_jsa_worker'){
    const a=store.model.acknowledgements.find(a=>a.id===args.p_acknowledgement_id);Object.assign(a,{signature_signed_name:a.attendee_name,signature_strokes:args.p_strokes,signature_signed_at:new Date().toISOString(),signature_width:args.p_width,signature_height:args.p_height,acknowledged_at:new Date().toISOString()});
    const signed=store.model.acknowledgements.filter(a=>a.signature_signed_at).length;Object.assign(store.model.workflow,{signed,outstanding:store.model.acknowledgements.length-signed,status:signed===store.model.acknowledgements.length?'Completed':'Draft — Awaiting Worker Sign-Offs'});return route.fulfill({json:store.model});
   }
   if(name==='submit_current_user_safety_acknowledgement'){
    const now=new Date().toISOString();store.model.acknowledgements.push({id:'00000000-0000-4000-8000-000000000009',attendee_name:creator.display_name,attendee_company:'John Gordon Construction',matched_employee_id:creator.id,is_late:true,signature_signed_name:creator.display_name,signature_strokes:args.p_signature_strokes,signature_width:args.p_signature_width,signature_height:args.p_signature_height,signature_signed_at:now,acknowledged_at:now});
    const signed=store.model.acknowledgements.filter(a=>a.signature_signed_at).length;Object.assign(store.model.workflow,{required:store.model.acknowledgements.length,signed,outstanding:store.model.acknowledgements.length-signed});
    return route.fulfill({json:[{success:true,message:'Signature saved.',acknowledgement_id:'00000000-0000-4000-8000-000000000009',already_acknowledged:false}]});
   }
   return route.fulfill({json:[]});
  }
  if(url.pathname.endsWith('/jobs'))return route.fulfill({json:jobs});
  if(url.pathname.endsWith('/profiles'))return route.fulfill({json:single?creator:[creator,worker]});
  if(url.pathname.endsWith('/work_order_labour_workers'))return route.fulfill({json:[worker]});
  if(url.pathname.endsWith('/employee_feature_access'))return route.fulfill({json:[{worker_id:worker.id,feature_key:'jsa',enabled:true}]});
  if(url.pathname.endsWith('/jsa_preparations'))return route.fulfill({json:store.savedDraft});
  return route.fulfill({json:single?null:[]});
 });return store;
}
async function fill(page,workDate=date()){
 await page.goto('jsa.html');await expect(page.locator('#approvedCrewStatus')).toContainText('1 approved employees loaded');
 await page.locator('#jsaField1').evaluate(e=>{e.hidden=false;e.value='26132 - Synthetic project';e.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.locator('#jsaField3').fill(workDate);
 await page.locator('#tableBody textarea').nth(0).fill('Install blocking');await page.locator('#tableBody textarea').nth(1).fill('Sharp edges');await page.locator('#tableBody textarea').nth(2).fill('Wear gloves');
 await page.locator('#approvedCrewSelect').selectOption(worker.worker_key);
 await page.locator('#manualCrewInput').fill('Manual Worker');await page.locator('#manualCrewCompany').fill('Trade Co');await page.getByRole('button',{name:'Add Worker',exact:true}).click();
}
async function sign(page,name){
 const row=page.locator('#jsaPostSaveQrPanel .jgc-record-row').filter({hasText:name});await row.getByRole('button',{name:'Acknowledge and sign'}).click();
 await expect(page.locator('#safetySignaturePrintedName')).toHaveValue(name);await expect(page.locator('#safetySignaturePrintedName')).toHaveAttribute('readonly','');
 const canvas=page.locator('.safety-signature-pad'),box=await canvas.boundingBox();await page.mouse.move(box.x+30,box.y+30);await page.mouse.down();await page.mouse.move(box.x+70,box.y+55,{steps:6});await page.mouse.move(box.x+110,box.y+35,{steps:6});await page.mouse.up();
 await page.getByRole('button',{name:'Confirm signature',exact:true}).click();await expect(page.locator('.safety-signature-error')).toContainText('confirm you have read');
 await page.locator('#safetySignatureRead').check();await page.getByRole('button',{name:'Confirm signature',exact:true}).click();await expect(page.locator('.safety-signature-dialog')).toHaveCount(0);
}
for(const width of [390,1440])for(const theme of ['light','dark'])test(`creator collects staff and manual worker signatures ${width} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});const store=await fixture(page);await fill(page);
 await page.evaluate(theme=>{applyJgcTheme(theme);},theme);
 await expect(page.getByRole('button',{name:/Creator Sign Off|QR Code|Employee Signature/})).toHaveCount(0);
 await expect(page.locator('#jsaCrewTitle')).toHaveText('3. Workers Onsite');
 await page.getByRole('button',{name:'Complete and Worker Sign Off',exact:true}).filter({visible:true}).click();
 await expect(page.locator('#jsaAcknowledgementChoiceStatus')).toHaveText('All workers need to sign off report before JSA is completed.');
 await expect(page.locator('#jsaPostSaveQrPanel')).toContainText('2 outstanding');await expect(page.locator('[data-jsa-worker-sign]')).toHaveCount(2);
 await sign(page,'Synthetic Worker');await expect(page.locator('#jsaPostSaveQrPanel')).toContainText('1 outstanding');await expect(page.locator('#jsaPostSaveQrPanel h3')).toHaveText('Draft — Awaiting Worker Sign-Offs');
 await sign(page,'Manual Worker');await expect(page.locator('#jsaPostSaveQrPanel h3')).toHaveText('Completed');await expect(page.locator('[data-jsa-worker-sign]')).toHaveCount(0);
 expect(store.calls.filter(c=>c.name==='sign_jsa_worker')).toHaveLength(2);expect(store.calls.filter(c=>/submit_public|submit_current/.test(c.name))).toHaveLength(0);
 if(width===390 && theme==='light'){const download=page.waitForEvent('download');await page.locator('#jsaWorkerPdf').click();await (await download).saveAs(info.outputPath('completed-jsa.pdf'));}
 await page.screenshot({path:info.outputPath('completed.png'),fullPage:true});
});
test('future JSA saves and exports for the client without sign-off or notifications',async({page},info)=>{
 const store=await fixture(page);await fill(page,future());await expect(page.locator('#jsaPreparation')).toBeVisible();await expect(page.locator('#jsaActivate')).toBeDisabled();
 await page.locator('#jsaSaveDraft').click();await expect(page.locator('#jsaDraftStatus')).toContainText('Draft saved');expect(store.savedDraft.payload.record.inspection_date).toBe(future());await expect(page.locator('[data-jsa-worker-sign]')).toHaveCount(0);
 const download=page.waitForEvent('download');await page.locator('#jsaDraftPdf').click();await (await download).saveAs(info.outputPath('future-jsa.pdf'));
 expect(store.calls.some(c=>/sign_jsa_worker|request_jsa_worker_signoff|activate_prepared/.test(c.name))).toBe(false);
});
for (const width of [390, 1440]) test(`date changes select preparation without losing JSA entries ${width}`, async ({page}) => {
 await page.setViewportSize({width,height:900}); const store=await fixture(page); await fill(page);
 await expect(page.locator('#jsaSignoffChoiceSection')).toBeVisible();
 await page.locator('#jsaField3').fill(future());
 await expect(page.locator('#jsaPreparation')).toBeVisible();
 await expect(page.locator('#jsaActivate')).toBeDisabled();
 await expect(page.locator('#tableBody textarea').nth(0)).toHaveValue('Install blocking');
 await expect(page.locator('#selectedCrewList')).toContainText('Synthetic Worker');
 await page.locator('#jsaField3').fill(date());
 await expect(page.locator('#jsaSignoffChoiceSection')).toBeVisible();
 await expect(page.locator('#tableBody textarea').nth(1)).toHaveValue('Sharp edges');
 await page.locator('#jsaField3').fill(future());
 await page.locator('#jsaSaveDraft').click();
 await expect(page.locator('#jsaDraftStatus')).toContainText('Draft saved');
 expect(store.savedDraft.payload.record.form_data.rows[0].cells[0]).toBe('Install blocking');
 expect(store.calls.some(call => /request_jsa_worker_signoff|activate_prepared|sign_jsa_worker/.test(call.name))).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('manual workers require separate name and company',async({page})=>{
 await fixture(page);await page.goto('jsa.html');await page.locator('#manualCrewInput').fill('Manual Worker');await page.getByRole('button',{name:'Add Worker',exact:true}).click();await expect(page.locator('#manualWorkerStatus')).toHaveText('Enter both Name and Company.');await expect(page.locator('#manualCrewList')).toContainText('No manual entries');
});

for(const theme of ['light','dark'])test(`saved JSA review uses actual PDF pages with a contained phone roster in ${theme}`,async({page},info)=>{
 await page.setViewportSize({width:390,height:900});const store=await fixture(page);await fill(page);await page.locator('#jsaCompleteWorkers').click();
 const model=store.model;await page.goto('/todays-inspections.html?recordType=reports');await page.evaluate(theme=>applyJgcTheme(theme),theme);
 await page.evaluate(async id=>{await JGCJsaWorkers.openReview(inspectionSupabaseClient,id,document.getElementById('editPanel'));},model.record.id);
 await expect(page.locator('.board-jsa-pdf-sheet canvas').first()).toBeVisible();await expect(page.locator('#editPanel [data-jsa-worker-sign]')).toHaveCount(2);await expect(page.locator('#editPanel [data-jsa-late-sign]')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.locator('.board-jsa-accessible-text').first().evaluate(e=>getComputedStyle(e).clipPath)).toBe('inset(50%)');
 await page.getByRole('button',{name:'Zoom in JSA'}).click();await expect(page.locator('.board-jsa-preview-tools output')).toHaveText('125%');
 expect(await page.locator('.board-jsa-preview-scroll').evaluate(e=>e.scrollWidth>e.clientWidth)).toBe(true);
 await page.getByRole('button',{name:'Fit width',exact:true}).click();await page.locator('#editPanel').screenshot({path:info.outputPath('saved-jsa-review.png')});
 store.model.can_collect=false;await page.locator('#editPanel [data-jsa-refresh]').click();await expect(page.locator('#editPanel [data-jsa-worker-sign]')).toHaveCount(0);await expect(page.locator('#editPanel [data-jsa-request]')).toHaveCount(0);
});

for(const theme of ['light','dark'])test(`a late arrival signs onto a Completed JSA from Today's Reports in ${theme}`,async({page},info)=>{
 await page.setViewportSize({width:390,height:900});const store=await fixture(page);await fill(page);await page.locator('#jsaCompleteWorkers').click();
 const done=new Date().toISOString();store.model.acknowledgements.forEach(a=>Object.assign(a,{signature_signed_name:a.attendee_name,signature_strokes:[[[0.2,0.2],[0.6,0.5]]],signature_width:400,signature_height:150,signature_signed_at:done,acknowledged_at:done}));Object.assign(store.model.workflow,{signed:2,outstanding:0,completed_at:done,status:'Completed'});
 await page.goto('/todays-inspections.html?recordType=reports');await page.evaluate(theme=>applyJgcTheme(theme),theme);
 // Same entry point as the Today's Reports "View" button.
 await page.evaluate(record=>{inspectionRecords.push(record);openJsaSignOn(record.id);},store.model.record);
 const panel=page.locator('#editPanel');await expect(panel.locator('[data-jsa-status]')).toHaveText('Arrived late? Read the JSA above, then tap Sign onto JSA.');
 await expect(page.locator('.board-jsa-pdf-sheet canvas').first()).toBeVisible();await expect(panel.locator('[data-jsa-request]')).toHaveCount(0);await expect(panel.locator('[data-jsa-worker-sign]')).toHaveCount(0);
 await panel.getByRole('button',{name:'Sign onto JSA',exact:true}).click();
 await expect(page.locator('#safetySignaturePrintedName')).toHaveValue(creator.display_name);await expect(page.locator('#safetySignaturePrintedName')).toHaveAttribute('readonly','');
 const canvas=page.locator('.safety-signature-pad'),box=await canvas.boundingBox();await page.mouse.move(box.x+30,box.y+30);await page.mouse.down();await page.mouse.move(box.x+70,box.y+55,{steps:6});await page.mouse.move(box.x+110,box.y+35,{steps:6});await page.mouse.up();
 await page.getByRole('button',{name:'Confirm signature',exact:true}).click();await expect(page.locator('.safety-signature-error')).toContainText('confirm you have read');
 await page.locator('#safetySignatureRead').check();await page.getByRole('button',{name:'Confirm signature',exact:true}).click();await expect(page.locator('.safety-signature-dialog')).toHaveCount(0);
 await expect(panel.locator('[data-jsa-status]')).toContainText('You signed this JSA on');await expect(panel.locator('[data-jsa-late-sign]')).toHaveCount(0);
 await expect(panel.locator('.jgc-notice').first()).toContainText('Completed · 3/3 workers signed');await expect(panel.locator('.jgc-record-row').filter({hasText:creator.display_name})).toContainText('Signed late');
 const calls=store.calls.filter(c=>c.name==='submit_current_user_safety_acknowledgement');expect(calls).toHaveLength(1);expect(calls[0].args).toMatchObject({p_record_type:'jsa',p_record_id:store.model.record.id,p_mode:'signature'});expect(calls[0].args.p_signature_strokes.length).toBeGreaterThan(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await panel.screenshot({path:info.outputPath(`late-sign-on-${theme}.png`)});
});

test('creator-phone worker roster does not generate account reminders, including a future JSA',async({page})=>{
 await fixture(page);await page.goto('/jsa.html');
 const notifications=await page.evaluate(async()=>{
  const row={id:'synthetic-new-ack',record_type:'jsa',record_id:'synthetic-future-jsa',attendee_key:'jsa-worker:00000000-0000-4000-8000-000000000001',attendee_name:'Synthetic Creator',matched_employee_email:'creator@example.com',acknowledgement_status:'pending',record_date:'2099-01-01'};
  const rows=[row,{...row,id:'synthetic-legacy-ack',record_id:'historical-jsa',attendee_key:'synthetic creator',record_date:'2026-09-01'}];
  const q={select:()=>q,in:()=>q,is:()=>q,eq:()=>q,order:()=>q,maybeSingle:async()=>({data:{admin_enabled:true},error:null}),limit:async()=>({data:rows,error:null})};
  return await loadJgcSafetyAcknowledgementNotifications({from:()=>q,auth:inspectionSupabaseClient.auth});
 });expect(notifications).toHaveLength(1);expect(notifications[0].id).toBe('safety-ack:synthetic-legacy-ack');
});

test('a staff phone can collect a JSA prepared ahead of time without editing its saved report',async({page})=>{
 const store=await fixture(page,[],false);await fill(page,future());await page.locator('#jsaSaveWorkerDraft').click();
 Object.assign(store.model.workflow,{active:true,today:date(),valid_date:date(),status:'Draft — Awaiting Worker Sign-Offs',prepared_in_advance:true,signing_mode:'shared_phone'});
 store.model.record.inspection_date=date();store.model.record.form_data.fields.find(f=>f.label==='Date').value=date();store.model.can_edit=false;
 await page.goto('/jsa.html?record='+store.model.record.id);await expect(page.locator('#jsaWorkDateHelp')).toContainText('Staff with this JSA');await expect(page.locator('#jsaField3')).toBeDisabled();
 await expect(page.locator('#jsaJobSearch')).toBeDisabled();
 await page.locator('#jsaCompleteWorkers').click();await expect(page.locator('[data-jsa-worker-sign]')).toHaveCount(2);
 await sign(page,'Synthetic Worker');await sign(page,'Manual Worker');await expect(page.locator('#jsaPostSaveQrPanel h3')).toHaveText('Completed');
 expect(store.calls.filter(c=>c.name==='save_worker_jsa')).toHaveLength(1);
});

for(const width of [390,1440])test(`listed employee signs only their own outstanding JSA from Reports ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const store=await fixture(page);await fill(page);await page.locator('#jsaCompleteWorkers').click();
 store.model.can_collect=false;Object.assign(store.model.acknowledgements[0],{matched_employee_id:creator.id,attendee_name:creator.display_name});
 await page.goto('/todays-inspections.html?recordType=reports');await page.evaluate(async id=>JGCJsaWorkers.openReview(inspectionSupabaseClient,id,document.getElementById('editPanel')),store.model.record.id);
 const panel=page.locator('#editPanel');await expect(panel.locator('[data-jsa-worker-sign]')).toHaveCount(0);await expect(panel.locator('[data-jsa-own-sign]')).toBeEnabled();
 await panel.locator('[data-jsa-own-sign]').click();await expect(page.locator('#safetySignaturePrintedName')).toHaveValue(creator.display_name);
 const canvas=page.locator('.safety-signature-pad'),box=await canvas.boundingBox();await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.mouse.move(box.x+100,box.y+60,{steps:8});await page.mouse.up();
 await page.locator('#safetySignatureRead').check();await page.getByRole('button',{name:'Confirm signature',exact:true}).click();
 await expect(panel.locator('[data-jsa-own-sign]')).toHaveCount(0);expect(store.model.acknowledgements[0].signature_signed_at).toBeTruthy();expect(store.model.acknowledgements[1].signature_signed_at).toBeNull();expect(store.model.workflow.outstanding).toBe(1);
 expect(store.calls.filter(c=>c.name==='sign_jsa_worker').at(-1).args.p_acknowledgement_id).toBe(store.model.acknowledgements[0].id);
});

const copyJobs = [
 {id:'copy-job-1',job_number:'26152',job_name:'Trailer Prep',address:'1 Water Street',active:true},
 {id:'copy-job-2',job_number:'26153',job_name:'Other Project',address:'2 Water Street',active:true}
];
function copySource(id='00000000-0000-4000-8000-000000000090',job=copyJobs[0],workDate='2026-01-15') {
 return {
  id,inspection_type:'JSA',inspection_date:workDate,title:'JSA - '+workDate,
  worker_name:'previous author',worker_display_name:'Previous Author',created_by:'previous-user',created_at:workDate+'T12:00:00Z',
  form_data:{
   fields:[{label:'Contractor',value:'John Gordon Construction'},{label:'Project / Job',value:job.job_number+' - '+job.job_name},
    {label:'Address',value:job.address},{label:'General location on site',value:'North stairwell'},
    {label:'Date',value:workDate},{label:'Contractor Supervisor',value:'Previous Supervisor'},{label:'Reviewed By',value:'Previous Reviewer'},
    {label:'Elevated Work',value:'Yes'},{label:'Workers Onsite (Print Names)',value:'Previously Signed Worker'},
    {label:'Unrecognized hidden field',value:'should not be copied'}],
   rows:[{table:1,cells:['Install blocking','Sharp edges\nWorking at height','Wear gloves\nUse guardrails']}],
   job_context:{jobNumber:job.job_number,jobName:job.job_name,project:job.job_number+' - '+job.job_name,job_board_id:'old-board-id'},
   offline_submission_id:'original-submission',jsa_worker_workflow_version:2,
   workers_on_site:[{employee_id:worker.id,name:'Previously Signed Worker',company:'Old Company'}],
   signature_strokes:[[[0.1,0.1],[0.9,0.9]]]
  },
  jsa_workflow:{version:2,revision:7,status:'Completed',requested_at:workDate+'T13:00:00Z',completed_at:workDate+'T14:00:00Z',signed:1},
  safety_acknowledgements:[{id:'old-ack',matched_employee_id:worker.id,attendee_name:'Previously Signed Worker',signature_signed_at:workDate+'T14:00:00Z',signature_strokes:[[[0.1,0.1],[0.9,0.9]]]}]
 };
}
async function copyFixture(page,{isAdmin=false,sources=[copySource()],fail=false}={}) {
 const store=await fixture(page,copyJobs,isAdmin),requests=[];
 await page.route('**/rest/v1/inspection_records*',async route=>{
  const request=route.request(),url=new URL(request.url());requests.push({method:request.method(),url:url.toString()});
  if(request.method()!=='GET')return route.fulfill({status:405,json:{message:'Copy must never write the source record'}});
  if(fail)return route.fulfill({status:403,json:{message:'Source JSA unavailable'}});
  const id=url.searchParams.get('id')?.replace(/^eq\./,'');
  let records=id?sources.filter(record=>record.id===id):sources;
  if(!id)records=records.filter(record=>String(record.inspection_type).toLowerCase()==='jsa');
  const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000);
  records=records.slice(offset,offset+limit);
  return route.fulfill({json:String(request.headers().accept||'').includes('object')?(records[0]||null):records});
 });
 return {store,requests,sources};
}
function copyWrites(store) { return store.calls.filter(call=>/save_worker_jsa|save_prepared_jsa|request_jsa_worker_signoff|activate_prepared|sign_jsa_worker/.test(call.name)); }

for(const width of [390,1440])test(`copy JSA to a new day preserves source and starts fresh signatures ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 const {store,sources,requests}=await copyFixture(page),original=JSON.stringify(sources[0]);
 await page.goto('/jsa.html?copy='+sources[0].id);
 await expect(page.locator('#jsaCopyPanel')).toHaveAttribute('open','');
 await expect(page.locator('#jsaCopySource')).toHaveValue(sources[0].id);
 await expect(page.locator('#jsaCopyDate')).toHaveValue(date());
 expect(copyWrites(store)).toHaveLength(0);
 if(width===390)for(const theme of ['light','dark']){
  await page.evaluate(theme=>applyJgcTheme(theme),theme);
  await page.locator('#jsaCopyPanel').evaluate(element=>{element.scrollIntoView({block:'start'});window.scrollBy(0,-110);});
  await page.locator('#jsaCopyPanel').screenshot({path:info.outputPath('source-panel-'+theme+'.png')});
 }
 await page.evaluate(()=>applyJgcTheme('light'));
 await page.locator('#jsaCopyApply').click();
 await expect(page.locator('#tableBody textarea').nth(0)).toHaveValue('Install blocking');
 await expect(page.locator('#tableBody textarea').nth(1)).toHaveValue('Sharp edges\nWorking at height');
 await expect(page.locator('#tableBody textarea').nth(2)).toHaveValue('Wear gloves\nUse guardrails');
 await expect(page.locator('#jsaField1')).toHaveValue('26152 - Trailer Prep');
 await expect(page.locator('#jsaField2')).toHaveValue('1 Water Street');
 await expect(page.locator('#jsaSiteLocation')).toHaveValue('North stairwell');
 await expect(page.locator('#jsaField3')).toHaveValue(date());
 await expect(page.locator('#jsaField4')).toHaveValue(creator.display_name);
 await expect(page.locator('#jsaField5')).toHaveValue('');
 await expect(page.getByLabel('Elevated Work',{exact:true})).toBeChecked();
 await expect(page.locator('#crewSignOffCombined')).toHaveValue('');
 await expect(page.locator('#jsaPostSaveQrPanel')).toBeHidden();
 expect(copyWrites(store)).toHaveLength(0);
 if(width===390)for(const theme of ['light','dark']){
  await page.evaluate(theme=>applyJgcTheme(theme),theme);
  await page.locator('#jsaCopyPanel').evaluate(element=>{element.scrollIntoView({block:'start'});window.scrollBy(0,-110);});
  await page.locator('#jsaCopyPanel').screenshot({path:info.outputPath('ready-panel-'+theme+'.png')});
 }
 await page.evaluate(()=>applyJgcTheme('light'));
 await page.locator('#tableBody textarea').nth(0).fill('Install new blocking');
 await page.locator('#approvedCrewSelect').selectOption(worker.worker_key);
 await page.locator('#jsaSaveWorkerDraft').click();
 await expect.poll(()=>store.calls.filter(call=>call.name==='save_worker_jsa').length).toBe(1);
 const saved=store.calls.find(call=>call.name==='save_worker_jsa').args;
 expect(saved.p_id).not.toBe(sources[0].id);expect(saved.p_revision).toBe(0);
 expect(saved.p_payload.inspection_date).toBe(date());expect(saved.p_payload.worker_name).toBe(creator.worker_key);
 expect(saved.p_payload.form_data.offline_submission_id).not.toBe('original-submission');
 expect(saved.p_payload.form_data.job_context).toMatchObject({jobNumber:'26152',jobName:'Trailer Prep'});
 expect(saved.p_payload.form_data.job_context.job_board_id).toBeUndefined();
 expect(saved.p_payload.form_data.rows[0].cells[0]).toBe('Install new blocking');
 expect(saved.p_payload.form_data.fields).toContainEqual({label:'Elevated Work',value:'Yes'});
 expect(JSON.stringify(saved)).not.toMatch(/old-ack|Previously Signed Worker|Previous Reviewer|original-submission|old-board-id|signature_strokes|previous-user/);
 expect(store.model.acknowledgements).toHaveLength(1);expect(store.model.acknowledgements[0].signature_signed_at).toBeNull();
 expect(JSON.stringify(sources[0])).toBe(original);expect(requests.every(request=>request.method==='GET')).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('copied-jsa-'+width+'.png'),fullPage:true});
 await page.goto('/jsa.html?record='+saved.p_id);await expect(page.locator('#jsaCopyPanel')).toBeHidden();
 await expect(page.getByLabel('Elevated Work',{exact:true})).toBeChecked();
});

test('copy JSA picker shows only the selected job and switches jobs without stale choices',async({page})=>{
 const first=copySource(),second=copySource('00000000-0000-4000-8000-000000000091',copyJobs[1]);
 await copyFixture(page,{sources:[first,second]});await page.goto('/jsa.html');
 await page.locator('#jsaField1Select').selectOption('26152 - Trailer Prep');
 await page.locator('#jsaCopyPanel > summary').click();
 await expect(page.locator('#jsaCopySource option[value="'+first.id+'"]')).toHaveCount(1);
 await expect(page.locator('#jsaCopySource option[value="'+second.id+'"]')).toHaveCount(0);
 await page.locator('#jsaField1Select').selectOption('26153 - Other Project');
 await expect(page.locator('#jsaCopySource option[value="'+second.id+'"]')).toHaveCount(1);
 await expect(page.locator('#jsaCopySource option[value="'+first.id+'"]')).toHaveCount(0);
 await page.locator('#jsaCopySource').selectOption(second.id);await page.locator('#jsaCopyApply').click();
 await expect(page.locator('#jsaField1')).toHaveValue('26153 - Other Project');
 await expect(page.locator('#jsaField2')).toHaveValue('2 Water Street');
});

for(const isAdmin of [false,true])test(`copy JSA to future day saves prepared without signatures for ${isAdmin?'admin':'staff'}`,async({page})=>{
 const {store,sources}=await copyFixture(page,{isAdmin});await page.goto('/jsa.html?copy='+sources[0].id);
 await expect(page.locator('#jsaCopySource')).toHaveValue(sources[0].id);
 await page.locator('#jsaCopyDate').fill(future());await page.locator('#jsaCopyApply').click();
 await expect(page.locator('#jsaField3')).toHaveValue(future());
 await page.locator('#approvedCrewSelect').selectOption(worker.worker_key);
 await page.locator(isAdmin?'#jsaSaveDraft':'#jsaSaveWorkerDraft').click();
 const name=isAdmin?'save_prepared_jsa':'save_worker_jsa';
 await expect.poll(()=>store.calls.filter(call=>call.name===name).length).toBe(1);
 const args=store.calls.find(call=>call.name===name).args,record=isAdmin?args.p_payload.record:args.p_payload;
 expect(record.inspection_date).toBe(future());expect(args.p_id).not.toBe(sources[0].id);expect(args.p_revision).toBe(0);
 expect(record.form_data.rows[0].cells[0]).toBe('Install blocking');
 expect(copyWrites(store).map(call=>call.name)).toEqual([name]);
 await expect(page.locator(isAdmin?'#jsaActivate':'#jsaCompleteWorkers')).toBeDisabled();
});

test('copy JSA lookup failure keeps current entries and does not save anything',async({page})=>{
 const {store,sources}=await copyFixture(page,{fail:true});await page.goto('/jsa.html?copy='+sources[0].id);
 await expect(page.locator('#jsaCopyStatus')).toContainText(/could not|unavailable|unable/i);
 await expect(page.locator('#jsaCopyApply')).toBeDisabled();
 await page.locator('#tableBody textarea').nth(0).fill('Keep my work');
 await expect(page.locator('#tableBody textarea').nth(0)).toHaveValue('Keep my work');
 expect(copyWrites(store)).toHaveLength(0);
});

test('copy JSA is unavailable when reopening an existing record or prepared JSA',async({page})=>{
 const {store,sources,requests}=await copyFixture(page,{isAdmin:true});
 await fill(page);await page.locator('#jsaSaveWorkerDraft').click();
 await expect.poll(()=>store.model?.record?.id).toBeTruthy();
 const savedId=store.model.record.id;
 await page.goto('/jsa.html?record='+savedId+'&copy='+sources[0].id);
 await expect(page.locator('#tableBody textarea').nth(0)).toHaveValue('Install blocking');
 await expect(page.locator('#jsaCopyPanel')).toBeHidden();
 const preparedId='00000000-0000-4000-8000-000000000092';
 store.savedDraft={id:preparedId,revision:1,activated_at:null,payload:{record:{inspection_date:future(),form_data:{fields:[{label:'Date',value:future()},{label:'Project / Job',value:'26152 - Trailer Prep'}],rows:[{table:1,cells:['Prepared task','Hazard','Control']}]}},crew:[],manual:[]}};
 await page.goto('/jsa.html?prepared='+preparedId+'&copy='+sources[0].id);
 await expect(page.locator('#tableBody textarea').nth(0)).toHaveValue('Prepared task');
 await expect(page.locator('#jsaCopyPanel')).toBeHidden();
 expect(requests.some(request=>new URL(request.url).searchParams.get('id')==='eq.'+sources[0].id)).toBe(false);
 expect(copyWrites(store).map(call=>call.name)).toEqual(['save_worker_jsa']);
});

test('copy JSA rejects a source from a different signed-in Job Board',async({page})=>{
 const {store,sources}=await copyFixture(page);
 await page.route('**/rest/v1/profiles*',route=>route.fulfill({json:String(route.request().headers().accept||'').includes('object')?creator:[creator]}));
 await page.route('**/rest/v1/rpc/get_job_board',route=>route.fulfill({json:{id:'locked-board',job_number:'26153',job_name:'Other Project',address:'2 Water Street',can_upload:true}}));
 await page.goto('/jsa.html?copy='+sources[0].id+'&jobBoard=1#board=synthetic-board&visit=synthetic-visit');
 await expect(page.locator('#jsaCopyStatus')).toContainText('different job');
 await expect(page.locator('#jsaField1')).toHaveValue('26153 - Other Project');
 await expect(page.locator('#jsaCopyApply')).toBeDisabled();
 await expect(page.locator('#tableBody textarea').nth(0)).toHaveValue('');
 expect(copyWrites(store)).toHaveLength(0);
});

test('copy JSA history reads later result pages instead of silently omitting an older job',async({page})=>{
 const target=copySource(),sources=Array.from({length:200},(_,i)=>copySource('00000000-0000-4000-8000-'+String(i+100).padStart(12,'0'),copyJobs[1]));
 sources.push(target);const {requests}=await copyFixture(page,{sources});await page.goto('/jsa.html');
 await page.locator('#jsaField1Select').selectOption('26152 - Trailer Prep');await page.locator('#jsaCopyPanel > summary').click();
 await expect(page.locator('#jsaCopySource option[value="'+target.id+'"]')).toHaveCount(1);
 expect(requests.some(request=>new URL(request.url).searchParams.get('offset')==='200')).toBe(true);
 await expect(page.locator('#jsaCopySource option')).toHaveCount(2);
});

for(const theme of ['light','dark'])test(`copy JSA safely shows source text and can cancel replacing entries on phone in ${theme}`,async({page},info)=>{
 await page.setViewportSize({width:390,height:900});const source=copySource();
 source.worker_display_name='<img src=x onerror="window.copyInjected=true">';
 source.form_data.rows[0].cells[0]='Cut blocking < 24 inches & protect opening';
 const {store}=await copyFixture(page,{sources:[source]});
 await page.goto('/jsa.html?copy='+source.id);await page.evaluate(theme=>applyJgcTheme(theme),theme);
 await expect(page.locator('#jsaCopySource')).toHaveValue(source.id);
 await expect(page.locator('#jsaCopySource option').last()).toContainText(source.worker_display_name);
 expect(await page.evaluate(()=>window.copyInjected)).toBeUndefined();
 await page.locator('#jsaCopyPanel').scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('copy-panel-'+theme+'.png')});
 await page.locator('#tableBody textarea').nth(0).fill('Keep my current task');
 page.removeAllListeners('dialog');page.once('dialog',dialog=>dialog.dismiss());
 await page.locator('#jsaCopyApply').click();
 await expect(page.locator('#tableBody textarea').nth(0)).toHaveValue('Keep my current task');
 expect(copyWrites(store)).toHaveLength(0);
 page.once('dialog',dialog=>dialog.accept());await page.locator('#jsaCopyApply').click();
 await expect(page.locator('#tableBody textarea').nth(0)).toHaveValue(source.form_data.rows[0].cells[0]);
 expect(await page.evaluate(()=>window.copyInjected)).toBeUndefined();
 await page.locator('#jsaCopyPanel').scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('copied-panel-'+theme+'.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const isAdmin of [false,true])test(`copy JSA cannot replace entries while ${isAdmin?'prepared':'worker'} save is pending`,async({page})=>{
 const {store,sources}=await copyFixture(page,{isAdmin});
 await page.goto('/jsa.html?copy='+sources[0].id);await expect(page.locator('#jsaCopySource')).toHaveValue(sources[0].id);
 if(isAdmin)await page.locator('#jsaCopyDate').fill(future());
 await page.locator('#jsaCopyApply').click();
 await page.locator('#tableBody textarea').nth(0).fill('Keep edits made before save');
 await page.locator('#approvedCrewSelect').selectOption(worker.worker_key);
 const name=isAdmin?'save_prepared_jsa':'save_worker_jsa';let releaseSave,saveStarted=false;
 const saving=new Promise(resolve=>{releaseSave=resolve;});
 await page.route('**/rest/v1/rpc/'+name,async route=>{saveStarted=true;await saving;return route.fallback();});
 await page.locator(isAdmin?'#jsaSaveDraft':'#jsaSaveWorkerDraft').click();
 await expect.poll(()=>saveStarted).toBe(true);
 await expect(page.locator('#jsaCopyApply')).toBeDisabled();
 await page.locator('#jsaCopyApply').dispatchEvent('click');
 await expect(page.locator('#tableBody textarea').nth(0)).toHaveValue('Keep edits made before save');
 releaseSave();
 await expect.poll(()=>store.calls.filter(call=>call.name===name).length).toBe(1);
 await expect(page.locator('#jsaCopyPanel')).toBeHidden();
 const args=store.calls.find(call=>call.name===name).args,record=isAdmin?args.p_payload.record:args.p_payload;
 expect(record.form_data.rows[0].cells[0]).toBe('Keep edits made before save');
 expect(copyWrites(store).map(call=>call.name)).toEqual([name]);
});

test('copy JSA blocks saving until the in-progress copy is ready',async({page})=>{
 const {store,sources}=await copyFixture(page);await page.goto('/jsa.html?copy='+sources[0].id);
 await expect(page.locator('#jsaCopySource')).toHaveValue(sources[0].id);
 await page.evaluate(()=>{window.prepareJgcJobBoardForm=()=>new Promise(resolve=>{window.finishCopyPreparation=resolve;});});
 await page.locator('#jsaCopyApply').click();
 await expect.poll(()=>page.evaluate(()=>typeof window.finishCopyPreparation)).toBe('function');
 await page.locator('#jsaSaveWorkerDraft').dispatchEvent('click');
 expect(copyWrites(store)).toHaveLength(0);
 await page.evaluate(()=>window.finishCopyPreparation(true));
 await expect(page.locator('#tableBody textarea').nth(0)).toHaveValue('Install blocking');
 expect(copyWrites(store)).toHaveLength(0);
});

test('copy JSA saved offline queues a fresh record and closes the copy controls',async({page})=>{
 const {store,sources}=await copyFixture(page),original=JSON.stringify(sources[0]);
 await page.goto('/jsa.html?copy='+sources[0].id);await expect(page.locator('#jsaCopySource')).toHaveValue(sources[0].id);
 await page.locator('#jsaCopyApply').click();
 await expect(page.locator('#tableBody textarea').nth(0)).toHaveValue('Install blocking');
 await page.locator('#approvedCrewSelect').selectOption(worker.worker_key);
 await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));
 await page.locator('#jsaSaveWorkerDraft').click();
 await expect(page.locator('#inspectionSaveStatus')).toContainText('JSA saved on this device');
 await expect(page.locator('#jsaCopyPanel')).toBeHidden();
 const queue=await page.evaluate(()=>getCurrentWorkerInspectionQueue());
 expect(queue).toHaveLength(1);expect(queue[0].workerName).toBe(creator.worker_key);
 const record=queue[0].record;
 expect(record.id).not.toBe(sources[0].id);expect(record.inspection_date).toBe(date());
 expect(record.worker_name).toBe(creator.worker_key);expect(record.form_data.offline_submission_id).toBe(queue[0].localId);
 expect(record.form_data.offline_submission_id).not.toBe('original-submission');
 expect(record.form_data.job_context).toMatchObject({jobNumber:'26152',jobName:'Trailer Prep'});
 expect(record.form_data.rows[0].cells).toEqual(sources[0].form_data.rows[0].cells);
 expect(record.form_data.workers_on_site).toEqual([{employee_id:worker.id,name:worker.display_name,company:'John Gordon Construction'}]);
 expect(JSON.stringify(record)).not.toMatch(/old-ack|Previously Signed Worker|Previous Reviewer|original-submission|old-board-id|signature_strokes|previous-user/);
 expect(record.jsa_workflow).toBeUndefined();
 expect(copyWrites(store)).toHaveLength(0);expect(JSON.stringify(sources[0])).toBe(original);
 await page.locator('#jsaCopyApply').dispatchEvent('click');
 expect(await page.evaluate(()=>getCurrentWorkerInspectionQueue())).toEqual(queue);
});

for(const legacy of [false,true])test(`copy JSA preserves ${legacy?'legacy unlabeled':'named'} work conditions and separate Other choices when saved and reopened`,async({page})=>{
 const labels=['Lockout / Tag Out','Hot Work','Confined Space','Elevated Work','Excavation','Crane / Hoisting / Rigging','Other','Other'];
 const values=['Yes','No','Yes','No','No','Yes','Yes','No'],source=copySource();
 source.form_data.fields=source.form_data.fields.filter(field=>field.label!=='Elevated Work').concat(values.map((value,index)=>({label:legacy?'':labels[index],value})));
 const {store}=await copyFixture(page,{sources:[source]});await page.goto('/jsa.html?copy='+source.id);
 await expect(page.locator('#jsaCopySource')).toHaveValue(source.id);await page.locator('#jsaCopyApply').click();
 await expect(page.locator('#tableBody textarea').nth(0)).toHaveValue('Install blocking');
 expect(await page.locator('.checklist input[type="checkbox"]').evaluateAll(inputs=>inputs.map(input=>input.checked))).toEqual(values.map(value=>value==='Yes'));
 await page.locator('#approvedCrewSelect').selectOption(worker.worker_key);await page.locator('#jsaSaveWorkerDraft').click();
 await expect.poll(()=>store.calls.filter(call=>call.name==='save_worker_jsa').length).toBe(1);
 const saved=store.calls.find(call=>call.name==='save_worker_jsa').args;
 expect(saved.p_payload.form_data.fields.filter(field=>labels.includes(field.label))).toEqual(labels.map((label,index)=>({label,value:values[index]})));
 await page.goto('/jsa.html?record='+saved.p_id);
 await expect(page.locator('#tableBody textarea').nth(0)).toHaveValue('Install blocking');
 expect(await page.locator('.checklist input[type="checkbox"]').evaluateAll(inputs=>inputs.map(input=>input.checked))).toEqual(values.map(value=>value==='Yes'));
});
