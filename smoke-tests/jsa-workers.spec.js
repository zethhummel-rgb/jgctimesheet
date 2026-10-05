const {test,expect}=require('@playwright/test');
const ORIGIN='https://xnrljkkszoimegfivlya.supabase.co';
const creator={id:'00000000-0000-4000-8000-000000000001',worker_key:'synthetic creator',display_name:'Synthetic Creator',email:'creator@example.com',role:'admin',account_status:'approved'};
const worker={id:'00000000-0000-4000-8000-000000000002',profile_id:'00000000-0000-4000-8000-000000000002',worker_key:'synthetic worker',display_name:'Synthetic Worker',email:'worker@example.com',role:'worker',account_status:'approved',approved:true};
const date=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const future=()=>{const now=new Date();now.setDate(now.getDate()+14);return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);};
async function fixture(page){
 const store={model:null,calls:[],savedDraft:null};
 const jwt=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:creator.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')+'.fixture';
 const session={access_token:jwt,refresh_token:'synthetic-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:creator};
 await page.addInitScript(({creator,session})=>{localStorage.setItem('sb-xnrljkkszoimegfivlya-auth-token',JSON.stringify(session));localStorage.setItem('currentWorker',creator.worker_key);localStorage.setItem('currentWorkerDisplay',creator.display_name);localStorage.setItem('currentUserEmail',creator.email);localStorage.setItem('currentUserRole','admin');localStorage.setItem('currentUserStatus','approved');localStorage.setItem('jgcTheme','light');}, {creator,session});
 page.on('dialog',d=>d.accept());
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),single=String(req.headers().accept || '').includes('object');
  if(url.hostname==='127.0.0.1' || url.hostname==='localhost')return route.fallback();
  if(url.origin!==ORIGIN)return route.abort();
  if(url.pathname.includes('/auth/v1/'))return route.fulfill({json:url.pathname.endsWith('/user')?creator:session});
  if(url.pathname.includes('/rpc/')){
   const name=url.pathname.split('/').pop(),args=req.postDataJSON();store.calls.push({name,args});
   if(name==='is_admin')return route.fulfill({json:true});
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
   return route.fulfill({json:[]});
  }
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
 const store=await fixture(page);await fill(page,future());await expect(page.locator('#jsaCompleteWorkers')).toBeDisabled();
 await page.locator('#jsaSaveWorkerDraft').click();await expect(page.locator('#jsaPostSaveQrPanel h3')).toHaveText('Prepared');await expect(page.locator('#jsaPostSaveQrPanel')).toContainText('Planned — sign on work date');await expect(page.locator('[data-jsa-worker-sign]')).toHaveCount(0);
 const download=page.waitForEvent('download');await page.locator('#jsaWorkerPdf').click();await (await download).saveAs(info.outputPath('future-jsa.pdf'));
 expect(store.calls.some(c=>/sign_jsa_worker|request_jsa_worker_signoff|activate_prepared/.test(c.name))).toBe(false);
});
test('manual workers require separate name and company',async({page})=>{
 await fixture(page);await page.goto('jsa.html');await page.locator('#manualCrewInput').fill('Manual Worker');await page.getByRole('button',{name:'Add Worker',exact:true}).click();await expect(page.locator('#manualWorkerStatus')).toHaveText('Enter both Name and Company.');await expect(page.locator('#manualCrewList')).toContainText('No manual entries');
});
