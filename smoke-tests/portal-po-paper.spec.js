const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const paper=require('./po-paper-helpers');
const origin='https://xnrljkkszoimegfivlya.supabase.co';
const userId='00000000-0000-4000-8000-000000000101';
const jobId='00000000-0000-4000-8000-000000000102';
async function setup(page,{locked=false,handoff=false}={}){
 const user={id:userId,email:'po-paper@example.com',role:'authenticated',user_metadata:{display_name:'Synthetic Worker'}};
 const profile={...user,display_name:'Synthetic Worker',worker_key:'synthetic worker',role:'worker',account_status:'approved',can_create_digital_pos:true};
 const session={access_token:Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:userId,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.synthetic',refresh_token:'synthetic',user,token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600};
 await page.addInitScript(({session,profile})=>{localStorage.setItem('sb-xnrljkkszoimegfivlya-auth-token',JSON.stringify(session));localStorage.setItem('currentWorker',profile.worker_key);localStorage.setItem('currentWorkerDisplay',profile.display_name);localStorage.setItem('currentUserRole',profile.role);localStorage.setItem('currentAccountStatus','approved');localStorage.setItem('jgcStayLoggedIn','true');sessionStorage.setItem('jgcActiveSession','true');},{session,profile});
 const store={orders:[],items:[],calls:[],errors:[]};page.on('pageerror',error=>store.errors.push(error.message));
 if(locked||handoff){store.orders=[{id:'00000000-0000-4000-8000-000000000110',po_number:39001,creator_profile_id:handoff?'00000000-0000-4000-8000-000000000111':userId,creator_name:'Original Creator',order_date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),job_id:jobId,job_number:'26142',job_name:'Control Room',supplier_name:'Historical supplier',notes:'Historical notes',workflow_status:'submitted',email_status:handoff?'pending':'emailed',revision:2,created_at:new Date().toISOString()}];store.items=[{id:'00000000-0000-4000-8000-000000000112',po_id:store.orders[0].id,quantity_ordered:3,description:'Historical item'}];}
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.hostname==='127.0.0.1')return route.fallback();if(url.origin!==origin)return route.abort();
  let data=[];
  if(url.pathname.includes('/auth/v1/'))data=url.pathname.endsWith('/user')?user:session;
  else if(url.pathname.endsWith('/profiles'))data=request.headers().accept?.includes('object')?profile:[profile];
  else if(url.pathname.endsWith('/jobs'))data=[{id:jobId,job_number:'26142',job_name:'Control Room',customer:'Synthetic Client',active:true}];
  else if(url.pathname.endsWith('/digital_purchase_orders'))data=store.orders;
  else if(url.pathname.endsWith('/digital_po_items'))data=store.items;
  else if(url.pathname.endsWith('/rpc/digital_po_get_device_context'))data={registered:true,device_id:'00000000-0000-4000-8000-000000000103',device_status:'active',lease_expires_at:'2099-12-31T00:00:00Z',blocks:[{id:'00000000-0000-4000-8000-000000000104',range_start:39000,range_end:39009,next_number:39000,status:'active'}]};
  else if(/\/rpc\/digital_po_save(_manual)?$/.test(url.pathname)){
   const payload=request.postDataJSON();store.calls.push({type:'save',payload});data={...payload.p_order,revision:(payload.p_order.revision||0)+1};store.orders=[data];store.items=payload.p_items.map(item=>({...item,po_id:data.id}));
  }else if(url.pathname.endsWith('/rpc/digital_po_submit')){store.calls.push({type:'submit'});data={...store.orders[0],workflow_status:'submitted',email_status:'pending',revision:2};store.orders=[data];}
  else if(url.pathname.endsWith('/rpc/digital_po_open_pending'))data=store.orders[0];
  return route.fulfill({json:data});
 });
 await page.goto('/purchase-orders.html');await expect(page.locator('#poCurrentUser')).toContainText('Synthetic Worker');
 await page.evaluate(()=>{window.uploadJgcFile=async options=>({data:{path:options.path},error:null});});
 return store;
}

for(const width of [390,1440])for(const theme of ['light','dark'])test(`paper PO manual entry saves reopens and submits ${width} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:920});const store=await setup(page);await page.evaluate(theme=>applyJgcTheme(theme),theme);
 await expect(page.locator('#poNewButton')).toBeEnabled();await page.locator('#poNewButton').click();
 await expect(page.locator('#poNumberDisplay')).toHaveText('PO-39000');
 const number=await page.locator('#poNumberDisplay').boundingBox(),to=await page.locator('[data-paper-edit="to"]').boundingBox();expect(number.y+number.height).toBeLessThan(to.y);
 await paper.to(page,'Synthetic Supply\n123 Example Road');await expect(page.locator('#poPaperSaveStatus')).toContainText('Saved on this device');
 await expect(page.locator('.po-paper [data-paper-to]')).toHaveText('Synthetic Supply\n123 Example Road');
 await page.locator('#poSyncButton').click();expect(store.calls).toHaveLength(0); // Incomplete local draft must not be sent.
 await paper.manualJob(page,'Manual renovation','TEST-42');await paper.item(page,'12','Drywall sheets');
 await expect(page.locator('#poPaperSaveStatus')).toContainText('Saved on this device');
 expect(await page.locator('.po-paper-items th').allTextContents()).toEqual(['Qty.','Description','Actions']);
 await expect(page.locator('.po-paper')).not.toContainText(/Unit price|Subtotal|Qty.*Rec.d/);
 await page.evaluate(()=>window.scrollTo(0,0));await expect(page.locator('.jgc-global-top-nav')).toHaveCount(1);
 await expect(page.locator('.po-paper-banner')).toHaveCSS('color','rgb(255, 255, 255)');
 await page.screenshot({path:info.outputPath(`paper-po-${width}-${theme}.png`),fullPage:true});
 await page.locator('[data-paper-item]').first().click();await expect(page.locator('#poPaperDialog .jgc-label').first()).toHaveText('Qty.');await page.locator('#poPaperQty').fill('99');await page.locator('[data-paper-cancel]').click();await expect(page.locator('.po-paper-items')).toContainText('12');await expect(page.locator('.po-paper-items')).not.toContainText('99');
 await page.reload();await expect(page.locator('#poList')).toContainText('PO-39000');await page.locator('[data-po-open]').first().click();
 await expect(page.locator('[data-paper-to]')).toContainText('123 Example Road');await expect(page.locator('[data-paper-job-name]')).toHaveText('Manual renovation');await expect(page.locator('.po-paper-items')).toContainText('Drywall sheets');
 await page.evaluate(()=>{window.uploadJgcFile=async options=>({data:{path:options.path},error:null});});
 page.once('dialog',d=>d.accept());await page.locator('#poSubmitButton').click();
 await expect(page.locator('#poNotice')).toContainText('submitted');expect(store.calls.filter(call=>call.type==='submit')).toHaveLength(1);
 expect(store.orders[0].po_number).toBe(39000);expect(store.orders[0].supplier_name).toContain('123 Example Road');expect(store.items[0].quantity_ordered).toBe('12');expect(store.errors).toEqual([]);
});

test('saved job selection and manual popup cancellation preserve the original job',async({page})=>{
 await setup(page);await page.locator('#poNewButton').click();await paper.openJob(page);await page.locator('#poJobSearch').fill('26142');await page.locator('[data-po-job-id]').click();await paper.finishJob(page);await expect(page.locator('[data-paper-job-number]')).toHaveText('26142');
 await paper.openJob(page);await page.locator('#poJobClear').click();await page.locator('[data-paper-cancel]').click();await expect(page.locator('#poJob')).toHaveValue(jobId);
 await paper.openJob(page);await page.locator('#poPaperManualEntry').click();await page.locator('#poPaperManualName').fill('Discard');await page.locator('[data-manual-cancel]').click();await page.locator('[data-paper-cancel]').click();await expect(page.locator('#poJob')).toHaveValue(jobId);
});

test('submitted PO remains read-only and retains its historical creator',async({page})=>{
 const store=await setup(page,{locked:true});await page.locator('[data-po-list-tab="submitted"]').click();await page.locator('[data-po-open]').first().click();
 await expect(page.locator('[data-paper-edit="to"]')).toBeDisabled();await expect(page.locator('[data-paper-edit="job"]').first()).toBeDisabled();await expect(page.locator('[data-paper-item]').first()).toBeDisabled();await expect(page.locator('#poAddItemButton')).toBeDisabled();await expect(page.locator('[data-paper-author]')).toHaveText('Original Creator');expect(store.calls).toHaveLength(0);
});

test('offline section saves retain the allocated number and recover without duplicate items',async({page,context})=>{
 const store=await setup(page);await page.locator('#poNewButton').click();await context.setOffline(true);
 await paper.to(page,'Offline Supplier');await paper.manualJob(page,'Offline repair');await paper.item(page,'2','Offline materials');await expect(page.locator('#poPaperSaveStatus')).toHaveText('Saved on this device');
 expect(store.calls).toHaveLength(0);await page.locator('#poCloseFormButton').click();await page.locator('[data-po-open]').first().click();await expect(page.locator('#poNumberDisplay')).toHaveText('PO-39000');await expect(page.locator('[data-paper-to]')).toHaveText('Offline Supplier');await expect(page.locator('.po-paper-items tbody tr')).toHaveCount(1);
 await context.setOffline(false);await expect.poll(()=>store.orders.length).toBe(1);expect(store.orders[0].po_number).toBe(39000);expect(store.items).toHaveLength(1);expect(store.items[0].description).toBe('Offline materials');expect(store.errors).toEqual([]);
});

test('manual job does not require a number and cancelled item and To edits do not alter the draft',async({page})=>{
 await setup(page);await page.locator('#poNewButton').click();await paper.manualJob(page,'Name only');await expect(page.locator('[data-paper-job-name]')).toHaveText('Name only');await expect(page.locator('#poManualJobNumber')).toHaveValue('');
 await paper.to(page,'Original supplier');await page.locator('[data-paper-edit="to"]').click();await page.locator('#poPaperText').fill('Discard supplier');await page.locator('[data-paper-cancel]').click();await expect(page.locator('[data-paper-to]')).toHaveText('Original supplier');
 await page.locator('#poAddItemButton').click();await page.locator('#poPaperDescription').fill('Discard item');await page.locator('[data-paper-cancel]').click();await expect(page.locator('.po-paper-items')).not.toContainText('Discard item');
});

test('section popup remains within the visual viewport when the phone keyboard opens',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);await page.locator('#poNewButton').click();await paper.to(page,'Supplier');await page.locator('#poAddItemButton').click();await page.setViewportSize({width:390,height:440});
 const bounds=await page.locator('#poPaperDialog').boundingBox();expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(440);await page.locator('#poPaperQty').fill('4');await page.locator('#poPaperDescription').fill('Material');await page.locator('[data-paper-done]').click();await expect(page.locator('.po-paper-items')).toContainText('Material');
});

test('paper PO PDF has only quantity and description and preserves long content and identity',async({page},info)=>{
 await setup(page);
 const data=await page.evaluate(async()=>Array.from(new Uint8Array(await (await JgcPurchaseOrderPdf.createBlob({po_number:39000,order_date:'2026-10-26',supplier_name:'Synthetic Supply\n123 Example Road\nCornwall, Ontario',job_number:'TEST-42',job_name:'Manual renovation',creator_name:'Synthetic Worker',notes:'Delivery at rear door\n'+Array.from({length:120},(_,i)=>'Detailed delivery note '+i).join('\n'),items:[{quantity_ordered:'12',description:'Drywall sheets'},...Array.from({length:35},(_,i)=>({quantity_ordered:i+1,description:'Long material description '+i+' — '+('Complete material specification. '.repeat(8))}))]})).arrayBuffer())));
 const dest=info.outputPath('paper-po.pdf');fs.writeFileSync(dest,Buffer.from(data));
 const pdfjs=await import(require('node:url').pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs',{paths:[path.join(__dirname,'../estimating-app')]})).href);const pdf=await pdfjs.getDocument({data:new Uint8Array(data),disableWorker:true}).promise;let text='';for(let i=1;i<=pdf.numPages;i++)text+=(await(await pdf.getPage(i)).getTextContent()).items.map(x=>x.str).join(' ');
 expect(text).toContain('PO-39000');expect(text).toContain('123 Example Road');expect(text).toContain('Long material description 34');expect(text).toContain('Delivery at rear door');expect(text).toContain('Detailed delivery note 119');expect(text).toContain('Synthetic Worker');expect(text).toContain('QTY.');expect(text).toContain('DESCRIPTION');expect(text).not.toMatch(/QTY\. REC.D|UNIT PRICE|AMOUNT|STOCK NUMBER/);expect(pdf.numPages).toBeGreaterThan(1);
});


test('unfinished paper PO cancellation retains its number without sending invalid job details',async({page})=>{
 const store=await setup(page);await page.locator('#poNewButton').click();await paper.to(page,'Unfinished supplier');await expect(page.locator('#poPaperSaveStatus')).toHaveText('Saved on this device');
 page.once('dialog',d=>d.accept());await page.locator('#poCancelButton').click();await expect(page.locator('#poNotice')).toContainText('cancelled on this device');expect(store.calls).toHaveLength(0);
 await page.locator('[data-po-list-tab="cancelled"]').click();await expect(page.locator('#poList')).toContainText('PO-39000');await page.locator('#poNewButton').click();await expect(page.locator('#poNumberDisplay')).toHaveText('PO-39001');
});


test('paper PO section editors reload from the actual offline app shell',async({browser})=>{
 test.setTimeout(90000);const context=await browser.newContext({serviceWorkers:'allow'});
 try {const page=await context.newPage();await setup(page);await page.evaluate(()=>navigator.serviceWorker.ready);await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
 await context.setOffline(true);await page.reload();await expect(page.locator('#poNewButton')).toBeEnabled();await page.locator('#poNewButton').click();await expect(page.locator('#poNumberDisplay')).toHaveText('PO-39000');await paper.to(page,'Cached offline supplier');await expect(page.locator('#poPaperSaveStatus')).toHaveText('Saved on this device');await expect(page.locator('.po-paper-banner')).toBeVisible();
 } finally {await context.close();}
});
