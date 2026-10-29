const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const origin = 'https://xnrljkkszoimegfivlya.supabase.co';
const userId = '00000000-0000-4000-8000-000000000096';
const jobId = '00000000-0000-4000-8000-000000026169';
const woId = '00000000-0000-4000-8000-000000000020';
const workerId = '00000000-0000-4000-8000-000000000002';
async function setup(page, {locked=false, theme='light',failDigitalLink=false}={}) {
  await page.clock.install({time:new Date('2026-10-29T16:00:00Z')});
  const user = {id:userId,aud:'authenticated',role:'authenticated',email:'zeth@johngordonconstruction.com',user_metadata:{display_name:'Zeth Hummel'}};
  const b64 = v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now()/1000);
  const session = {user,access_token:b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:userId,aud:'authenticated',role:'authenticated',email:user.email,exp:now+86400*90,iat:now})+'.fixture-signature',refresh_token:'fixture-refresh',expires_at:now+86400*90,expires_in:86400*90,token_type:'bearer'};
  const employee = {id:workerId,profile_id:userId,display_name:'Zeth Hummel',worker_key:'zeth hummel',approved:true};
  const wo = {id:woId,wo_number:'WO25169-020',work_order_date:'2026-10-29',job_id:jobId,job_number:'25169',job_name:'Service work',job_address:'100 Test Street',job_type:'T&M',customer:'Site manager',customer_po_number:'CLIENT-45',description_of_work:'Repair the entrance.',notes:'Keep access clear.',status:locked?'submitted':'draft',locked,created_by:userId,created_by_name:'Zeth Hummel',supervisor_name:'Zeth Hummel',labour_complete:true,waiting_for:[],created_at:'2026-10-29T14:00:00Z',updated_at:'2026-10-29T14:00:00Z'};
  const db = {
    profiles:[{...user,display_name:'Zeth Hummel',role:'admin',worker_key:'zeth hummel',approved:true,account_status:'approved'}],
    accounts:[],work_orders:[wo],
    jobs:[{id:jobId,job_number:'25169',job_name:'Service work',customer:'Sample client',address:'100 Test Street',job_type:'T&M',active:true}],
    work_order_labour_workers:[employee],employee_feature_access:[{worker_id:workerId,feature_key:'work_orders',enabled:true}],
    work_order_labour:[{id:'labour-1',work_order_id:woId,employee_id:workerId,worker_key:'zeth hummel',employee_name:'Zeth Hummel',hours:5,complete:true}, {id:'manual-1',work_order_id:woId,worker_key:'manual-sam-1',employee_name:'Sam Manual',hours:2.5,complete:true,notes:'Manual labour entry'}],
    timesheet_entries:[
      {id:'time-1',worker_name:'zeth hummel',week_start:'2026-10-25',day_of_week:'Thursday',job_number:'25169',job_name:'Service work',hours:3,entry_type:'Work'},
      {id:'time-2',worker_name:'zeth hummel',week_start:'2026-10-25',day_of_week:'Thursday',job_number:'25169',job_name:'Service work',hours:2,entry_type:'Work'},
      {id:'wrong-date',worker_name:'zeth hummel',week_start:'2026-10-25',day_of_week:'Wednesday',job_number:'25169',job_name:'Service work',hours:8,entry_type:'Work'},
      {id:'wrong-job',worker_name:'zeth hummel',week_start:'2026-10-25',day_of_week:'Thursday',job_number:'25170',job_name:'Other work',hours:9,entry_type:'Work'}],
    work_order_purchase_orders:[{id:'paper-po',work_order_id:woId,po_number:'PO-1234',company_name:'Supply Co',notes:'Fasteners',sort_order:0}],
    work_order_materials:[{id:'shop-1',work_order_id:woId,purchased_from:'JGC Shop',quantity:'3 sheets',material_description:'Plywood'}],
    work_order_misc_items:[{id:'misc-1',work_order_id:woId,invoice_name:'Disposal invoice 45'}],
    work_order_travel:[{id:'travel-1',work_order_id:woId,vehicle_id:'truck',vehicle_name:'Truck',identification_number:'TRUCK-1',total_km:40,trailer_used:true,trailer_equipment_id:'trailer',trailer_name:'Trailer',trailer_identification_number:'TR-1'}],
    work_order_equipment:[{id:'eq-1',work_order_id:woId,equipment_id:'lift',equipment_name:'Scissor lift',identification_number:'LIFT-1',transportation_required:true}],
    work_order_rentals:[{id:'rental-1',work_order_id:woId,rental_equipment_description:'Generator',po_number:'PO-5678',rental_company:'Rental Co',quantity:1,hours_used:4,days_used:1,notes:'Pickup Friday'}],
    equipment_vehicles:[{id:'truck',name:'Truck',identification_number:'TRUCK-1',equipment_type:'Vehicle',is_active:true},{id:'lift',name:'Scissor lift',identification_number:'LIFT-1',equipment_type:'Lift',is_active:true},{id:'trailer',name:'Trailer',identification_number:'TR-1',equipment_type:'Trailer',is_active:true}],
    digital_po_work_order_links:[{work_order_id:woId,po_id:'linked-po'}]
  };
  const digital = [{id:'linked-po',po_number:30042,supplier_name:'Supply Co',order_date:'2026-10-29',linked_work_order_id:woId,creator_name:'Zeth Hummel',assigned_name:'Zeth Hummel',material_count:2,receipt_attached:true,workflow_status:'submitted'}, {id:'available-po',po_number:30043,supplier_name:'Rental Co',order_date:'2026-10-29',linked_work_order_id:null,creator_name:'Zeth Hummel',assigned_name:'Zeth Hummel',material_count:1,receipt_attached:false,workflow_status:'draft'}];
  const writes=[], emails=[];
  await page.addInitScript(({session,theme})=>{
    localStorage.setItem('sb-xnrljkkszoimegfivlya-auth-token',JSON.stringify(session));
    for(const [key,value] of Object.entries({currentWorker:'zeth hummel',currentWorkerDisplay:'Zeth Hummel',currentUserEmail:session.user.email,currentUserRole:'admin',currentAccountStatus:'approved',jgcStayLoggedIn:'true',jgcPortalTheme:theme}))localStorage.setItem(key,value);
    localStorage.setItem('jgcPortalTheme:'+session.user.id,theme);sessionStorage.setItem('jgcActiveSession','true');
  },{session,theme});
  await page.route('https://script.google.com/**',async route=>{emails.push(route.request().postDataJSON());await route.fulfill({status:200,body:'ok'});});
  await page.route(origin+'/**',async route=>{
    const request=route.request(),url=new URL(request.url()),method=request.method();
    const reply=async body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname.startsWith('/auth/v1/user'))return reply(user);
    if(url.pathname.startsWith('/auth/v1/token'))return reply(session);
    const table=url.pathname.split('/rest/v1/')[1]||'';
    if(table.startsWith('rpc/')) {
      const name=table.slice(4),body=request.postDataJSON()||{};
      if(name==='digital_po_work_order_options')return reply(digital.filter(row=>body.p_job_id===jobId && row.order_date===body.p_order_date && (!row.linked_work_order_id||row.linked_work_order_id===body.p_work_order_id)));
      if(name==='digital_po_link_work_orders'){writes.push({table:name,body});if(failDigitalLink){failDigitalLink=false;return route.fulfill({status:403,json:{message:'Synthetic link failure'}});}for(const id of body.p_po_ids){digital.find(row=>row.id===id).linked_work_order_id=body.p_work_order_id;}return reply({});}
      if(name==='digital_po_unlink_work_order'){digital.find(row=>row.id===body.p_po_id).linked_work_order_id=null;return reply({});}
      if(name.includes('digital_po'))return reply(digital.filter(row=>row.linked_work_order_id===woId));
      return reply(name.includes('admin')||name.startsWith('is_')?true:[]);
    }
    const matches=row=>Array.from(url.searchParams).every(([key,value])=>{
      if(['select','order','limit','offset','or','and'].includes(key))return true;
      if(value.startsWith('eq.'))return String(row[key])===value.slice(3);
      if(value.startsWith('neq.'))return String(row[key])!==value.slice(4);
      if(value.startsWith('in.('))return value.slice(4,-1).split(',').map(s=>s.replace(/"/g,'')).includes(String(row[key]));
      if(value.startsWith('like.'))return String(row[key]||'').startsWith(value.slice(5).replace(/%|\*/g,''));
      return true;
    });
    db[table] ||= [];
    let rows=db[table].filter(matches);
    if(method!=='GET'&&method!=='HEAD') {
      const body=request.postDataJSON();writes.push({table,method,body});
      if(method==='POST'){rows=(Array.isArray(body)?body:[body]).map((v,i)=>({id:v.id||'saved-'+table+'-'+writes.length+'-'+i,...v}));db[table].push(...rows);}
      if(method==='PATCH')rows.forEach(row=>Object.assign(row,body));
      if(method==='DELETE'){db[table]=db[table].filter(row=>!matches(row));return reply([]);}
    }
    return reply((request.headers().accept||'').includes('vnd.pgrst.object')?(rows[0]||null):rows);
  });
  page.on('dialog',dialog=>dialog.accept());
  await page.goto('/work-orders.html?wo='+woId);
  await expect(page.locator('#woNumber')).toHaveValue('WO25169-020');
  await expect(page.locator('#labourPreview')).toContainText('7.50');
  return {db,writes,emails,digital,wo};
}

test('paper WO retains its number, every extra, linked POs and both labour sources through save/reopen/PDF',async({page})=>{
  const {db,writes,digital}=await setup(page);
  await expect(page.locator('#woStatus')).toBeHidden();
  await expect(page.locator('#woStatusLabel')).toHaveText('Draft');
  await expect(page.locator('#materialSectionBody')).toBeHidden();
  await expect(page.locator('#labourPreview')).toContainText('2 matching entries');
  await expect(page.locator('#labourPreview')).toContainText('Manual hours');
  await page.getByRole('button',{name:'Refresh timesheet hours',exact:true}).click();
  await expect(page.locator('#labourPreview')).toContainText('7.50');
  await page.locator('[data-digital-po-id="available-po"]').check();
  await page.locator('#woDescription').fill('Updated scope without changing references.');
  // Use the actual Save button; it saves and starts a new WO as before.
  await page.locator('#saveButton').click();
  await expect(page.locator('#formStatus')).toContainText('saved');
  const saved=db.work_orders.find(row=>row.id===woId);
  expect(saved.wo_number).toBe('WO25169-020');
  expect(saved.status).toBe('draft');
  expect(saved.description_of_work).toBe('Updated scope without changing references.');
  expect(db.work_order_labour.filter(row=>row.work_order_id===woId).map(r=>[r.employee_name,r.hours]).sort()).toEqual([['Sam Manual',2.5],['Zeth Hummel',5]]);
  expect(writes.filter(w=>w.table==='timesheet_entries')).toEqual([]);
  expect(digital.every(row=>row.linked_work_order_id===woId)).toBe(true);
  expect(db.work_order_purchase_orders[0].po_number).toBe('PO-1234');
  expect(db.work_order_rentals[0]).toMatchObject({po_number:'PO-5678',hours_used:4,days_used:1,notes:'Pickup Friday'});
  expect(db.work_order_materials[0]).toMatchObject({quantity:'3 sheets',purchased_from:'JGC Shop',material_description:'Plywood'});
  expect(db.work_order_travel[0]).toMatchObject({trailer_used:true,trailer_name:'Trailer',total_km:40});
  expect(db.work_order_equipment[0].transportation_required).toBe(true);
  expect(db.work_order_misc_items[0].invoice_name).toBe('Disposal invoice 45');
  await page.reload();
  await expect(page.locator('#woNumber')).toHaveValue('WO25169-020');
  await expect(page.locator('#labourPreview')).toContainText('7.50');
  await expect(page.locator('#digitalPoLinkedList')).toContainText('PO-30043');
  const popupPromise=page.waitForEvent('popup');
  await page.locator('#previewButton').click();
  const pdf=await popupPromise;
  await expect(pdf.locator('.summary')).toContainText('WO25169-020');
  await expect(pdf.locator('body')).toContainText('PO-1234');
  await expect(pdf.locator('body')).toContainText('PO-30043');
  await expect(pdf.locator('body')).toContainText('Sam Manual');
  await expect(pdf.locator('body')).toContainText('7.50');
});

test('an unsaved employee selection survives refresh and new numbers use the existing sequence',async({page})=>{
  const {db}=await setup(page);
  await page.getByRole('button',{name:'New Work Order',exact:true}).click();
  await page.locator('#woJobSearch').fill('25169');
  await page.locator('#woJobSuggestions button').first().click();
  await expect(page.locator('#woNumber')).toHaveValue('WO25169-021');
  await page.locator('summary',{hasText:'Choose employees'}).click();
  await page.locator('#employeePicker input').check();
  await page.getByRole('button',{name:'Refresh timesheet hours',exact:true}).click();
  await expect(page.locator('#employeePicker input')).toBeChecked();
  await expect(page.locator('#labourPreview')).toContainText('5.00');
  expect(db.work_orders).toHaveLength(1);
});

test('normal and early submit keep their existing timing and lock rules with automatic status',async({page})=>{
  const {db,emails}=await setup(page);
  await page.locator('#submitButton').click();
  await expect.poll(()=>db.work_orders.find(row=>row.id===woId).status).toBe('ready_for_submission');
  expect(emails).toHaveLength(0);
  await page.reload();
  await expect(page.locator('#woStatusLabel')).toHaveText('Submitted');
  await expect(page.locator('#woSubmittedInfo')).toContainText('Nov');
  await expect(page.locator('#woDescription')).toBeEnabled();
  await page.locator('#earlySubmitButton').click();
  await expect.poll(()=>db.work_orders.find(row=>row.id===woId).status).toBe('submitted');
  expect(emails).toHaveLength(1);
  expect(db.work_orders.find(row=>row.id===woId).locked).toBe(true);
  await page.reload();
  await expect(page.locator('#submitButton')).toBeDisabled();
  await expect(page.locator('#earlySubmitButton')).toBeDisabled();
  await expect(page.locator('#supervisorSignatureButton')).toBeDisabled();
  await expect(page.locator('#woDescription')).toBeDisabled();
  await expect(page.locator('#previewButton')).toBeEnabled();
});

test('a failed digital PO link stops submission and retry keeps the saved WO number',async({page})=>{
  const {db,emails,digital}=await setup(page,{failDigitalLink:true});
  await page.locator('[data-digital-po-id="available-po"]').check();
  await page.locator('#submitButton').click();
  await expect(page.locator('#formStatus')).toContainText('could not be linked');
  expect(db.work_orders[0].status).toBe('draft');expect(emails).toHaveLength(0);
  await expect(page.locator('#woNumber')).toHaveValue('WO25169-020');
  await page.locator('#saveButton').click();
  await expect.poll(()=>digital.find(row=>row.id==='available-po').linked_work_order_id).toBe(woId);
  expect(db.work_orders).toHaveLength(1);expect(db.work_orders[0].wo_number).toBe('WO25169-020');
});

for(const viewport of [{width:390,height:844},{width:1440,height:1000}])test(`sticky actions and paper fields remain usable at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);
  await setup(page);
  await page.evaluate(()=>document.documentElement.style.fontSize='20px');
  for(const y of [0,700,2000]){
    await page.evaluate(y=>window.scrollTo(0,y),y);
    const geometry=await page.evaluate(()=>{
      const submit=document.getElementById('submitButton').getBoundingClientRect();
      const early=document.getElementById('earlySubmitButton').getBoundingClientRect();
      const nav=document.querySelector('.jgc-mobile-bottom-nav');
      return {top:submit.top,bottom:submit.bottom,earlyTop:early.top,earlyBottom:early.bottom,limit:nav&&getComputedStyle(nav).display!=='none'?nav.getBoundingClientRect().top:innerHeight,width:document.documentElement.scrollWidth,viewport:innerWidth};
    });
    expect(geometry.top).toBeGreaterThanOrEqual(0);expect(geometry.bottom).toBeLessThanOrEqual(geometry.limit+1);
    expect(geometry.earlyTop).toBeGreaterThanOrEqual(0);expect(geometry.earlyBottom).toBeLessThanOrEqual(geometry.limit+1);
    expect(geometry.width).toBeLessThanOrEqual(geometry.viewport+1);
  }
  await page.locator('#woDescription').scrollIntoViewIfNeeded();
  await page.locator('#woDescription').fill('Readable fields at larger font sizes.');
  await page.evaluate(()=>window.scrollTo(0,0));
  fs.mkdirSync(path.join(__dirname,'../outputs/wo-1035'),{recursive:true});
  await page.screenshot({path:path.join(__dirname,`../outputs/wo-1035/paper-${viewport.width}.png`),fullPage:true});
});

test('optional signatures persist through a local draft and saved PDF; submitted signatures stay locked',async({page})=>{
  const {db}=await setup(page);
  await page.locator('#clientSignatureButton').click();
  await page.locator('#woSignatureName').fill('Client Representative');
  const box=await page.locator('#woSignatureCanvas').boundingBox();
  await page.mouse.move(box.x+30,box.y+90);await page.mouse.down();
  await page.mouse.move(box.x+110,box.y+40,{steps:6});await page.mouse.move(box.x+180,box.y+110,{steps:6});await page.mouse.up();
  await page.locator('#woSignatureDone').click();
  await expect(page.locator('#clientSignatureButton')).toContainText('Client Representative');
  await page.evaluate(()=>persistLocalWorkOrderDraft({force:true}));
  const local=await page.evaluate(()=>JSON.parse(localStorage.getItem(getWorkOrderLocalDraftKey())));
  expect(local.signatures.client.name).toBe('Client Representative');
  await page.locator('#saveButton').click();
  await expect.poll(()=>db.work_orders.find(row=>row.id===woId).signatures?.client?.name).toBe('Client Representative');
  await page.reload();
  await expect(page.locator('#clientSignatureButton img')).toBeVisible();
  const popupPromise=page.waitForEvent('popup');await page.locator('#previewButton').click();const pdf=await popupPromise;
  await expect(pdf.locator('.wo-pdf-signature img')).toBeVisible();
  await expect(pdf.locator('.wo-pdf-signature')).toContainText(['Supervisor Signature','Client RepresentativeClient Signature']);
});

test('the real offline cache contains the paper editor and keeps draft inputs usable',async({browser})=>{
  test.setTimeout(90000);
  const context=await browser.newContext({serviceWorkers:'allow'});
  try {
    const page=await context.newPage();await setup(page);
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
    const cached=await page.evaluate(async()=>{
      const keys=await caches.keys();const cache=await caches.open(keys.find(key=>key==='jgc-portal-v1035'));
      return Promise.all(['work-order-paper.css?v=1','work-order-paper.js?v=1','work-order-digital-pos.js?v=4'].map(async name=>!!await cache.match(new URL(name,location.href))));
    });
    expect(cached).toEqual([true,true,true]);
    await context.setOffline(true);
    await page.locator('#woDescription').fill('Offline work description');
    await page.locator('#saveButton').click();
    await expect(page.locator('#formStatus')).toContainText('saved on this device');
    const draft=await page.evaluate(()=>JSON.parse(localStorage.getItem(getWorkOrderLocalDraftKey())));
    expect(draft.description).toBe('Offline work description');expect(draft.woNumber).toBe('WO25169-020');
    expect(draft.manualLabour[0].hours).toBe(2.5);
    await expect(page.locator('#submitButton')).toBeVisible();
  } finally {await context.close();}
});
