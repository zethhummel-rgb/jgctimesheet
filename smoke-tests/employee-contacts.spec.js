const {test,expect}=require('@playwright/test');
const ORIGIN='https://xnrljkkszoimegfivlya.supabase.co';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
async function fixture(page,{guest=false,theme='light'}={}) {
 const admin={id:id(1),display_name:'Synthetic Admin',worker_key:'synthetic admin',email:'admin@example.com',phone:'6135550001',role:'admin',account_status:'approved',created_at:'2026-01-01',hire_date:'2026-01-01'};
 const employee={...admin,id:id(2),display_name:'Synthetic Employee',worker_key:'synthetic employee',email:'staff@example.com',phone:'6135550002',role:'worker',add_to_contacts:false};
 const former={...employee,id:id(3),display_name:'Former Employee',worker_key:'former employee',email:'former@example.com',account_status:'limited',phone:'6135550003'};
 const alias={...employee,id:id(4),display_name:'Michael Worker',worker_key:'michael worker',email:'michael@example.com',phone:'6135550004'};
 const contacts=[{id:id(102),name:employee.display_name,email:employee.email,phone:employee.phone,notes:'Preserved contact note',role:'Safety lead',sort_order:3,is_active:true},
 {id:id(103),name:former.display_name,email:former.email,phone:former.phone,is_active:false,employee_profile_id:former.id,employee_linked_at:'2026-01-01',employee_contact_status:'former',notes:'Former employee history'},
 {id:id(104),name:'Mike Worker',phone:alias.phone,email:'',is_active:true,notes:'Nickname contact history'}];
 const state={profiles:[admin,employee,former,alias],contacts,calls:[],alerts:[],failSave:false,failLinks:false,signup:null};
 const jwt=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:admin.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')+'.fixture';
 const session={access_token:jwt,refresh_token:'synthetic-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user:admin};
 await page.addInitScript(({admin,session,guest,theme})=>{
  localStorage.setItem('jgcPortalTheme',theme);localStorage.setItem('jgcPortalTheme:'+admin.id,theme);
  if(!guest){localStorage.setItem('sb-xnrljkkszoimegfivlya-auth-token',JSON.stringify(session));for(const [key,value] of Object.entries({currentWorker:admin.worker_key,currentWorkerDisplay:admin.display_name,currentUserEmail:admin.email,currentUserRole:'admin',currentAccountStatus:'approved',currentUserStatus:'approved'}))localStorage.setItem(key,value);}
 },{admin,session,guest,theme});
 page.on('dialog',async d=>{state.alerts.push(d.message());await d.accept();});
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),single=String(req.headers().accept||'').includes('object');
  if(url.hostname==='localhost'||url.hostname==='127.0.0.1'||url.hostname===process.env.JGC_SMOKE_LIVE_HOST)return route.fallback();
  if(url.origin!==ORIGIN)return route.abort();
  const name=url.pathname.split('/').pop(),args=req.postData()?req.postDataJSON():null;
  if(url.pathname.includes('/auth/v1/')){
   if(name==='signup'){state.signup=args;return route.fulfill({json:{user:{id:id(8),email:args.email},session:null}});}
   return route.fulfill({json:name==='user'?admin:guest?{session:null}:session});
  }
  if(url.pathname.includes('/rpc/')){
   state.calls.push({name,args});
   if(name==='is_admin')return route.fulfill({json:true});
   if(name==='get_employee_contact_links'){
    if(state.failLinks)return route.fulfill({status:403,json:{message:'Contacts temporarily unavailable'}});
    return route.fulfill({json:state.profiles.map(p=>{
     const c=contacts.find(c=>c.employee_profile_id===p.id);
     return {profile_id:p.id,add_to_contacts:p.add_to_contacts,contact_id:c?.id,contact_active:c?.is_active,contact_status:c?.employee_contact_status,
      candidates:c?[]:contacts.filter(c=>c.phone===p.phone).map(c=>({contact_id:c.id,name:c.name,phone:c.phone,email:c.email,match_quality:c.name===p.display_name?'strong':'review',reasons:['Phone matches']}))};
    })});
   }
   if(name==='save_employee_contact_details'){
    if(state.failSave)return route.fulfill({status:409,json:{message:'Contact is already linked. Refresh before retrying.'}});
    const p=state.profiles.find(p=>p.id===args.p_profile_id);Object.assign(p,{display_name:args.p_name,email:args.p_email,phone:args.p_phone,add_to_contacts:args.p_add_to_contacts});
    let c=contacts.find(c=>c.employee_profile_id===p.id)||contacts.find(c=>c.id===args.p_contact_id);
    if(args.p_add_to_contacts){if(!c){c={id:id(110),notes:'',role:'',sort_order:0};contacts.push(c);}Object.assign(c,{employee_profile_id:p.id,employee_linked_at:new Date().toISOString(),name:p.display_name,email:p.email,phone:p.phone,is_active:p.account_status==='approved',employee_contact_status:p.account_status==='approved'?'active':'former'});}
    return route.fulfill({json:{profile_id:p.id,contact_id:c?.id}});
   }
   return route.fulfill({json:[]});
  }
  if(name==='profiles'){
   if(req.method()==='PATCH'){const p=state.profiles.find(p=>p.id===url.searchParams.get('id')?.slice(3));if(p){Object.assign(p,args);const c=contacts.find(c=>c.employee_profile_id===p.id);if(c){c.is_active=p.account_status==='approved';c.employee_contact_status=c.is_active?'active':'former';}}return route.fulfill({json:single?p:[p]});}
   return route.fulfill({json:single?admin:state.profiles});
  }
  if(name==='contacts'){
   if(req.method()==='PATCH'){const c=contacts.find(c=>c.id===url.searchParams.get('id')?.slice(3));state.calls.push({name:'update_contact',args});Object.assign(c,args);return route.fulfill({json:single?c:[c]});}
   return route.fulfill({json:url.searchParams.get('is_active')==='eq.true'?contacts.filter(c=>c.is_active):contacts});
  }
  return route.fulfill({json:single?null:[]});
 });
 return state;
}
for(const width of [390,1440])for(const theme of ['light','dark'])test(`employee contact linking keeps identity synchronized ${width} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:844});const state=await fixture(page,{theme});await page.goto('accounts.html');
 await page.evaluate(value=>applyJgcTheme(value),theme);
 await expect(page.locator('html')).toHaveAttribute('data-jgc-theme',theme);
 const row=page.locator('tr').filter({has:page.getByText('Synthetic Employee',{exact:true})});
 await row.getByRole('button',{name:'Add to Contacts',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await expect(dialog).toContainText('existing matching Contact will be linked');
 await dialog.getByLabel('Full Name',{exact:true}).fill('Updated Employee');await dialog.getByLabel('Phone Number',{exact:true}).fill('6135550202');
 await page.screenshot({path:info.outputPath('employee-contact-dialog.png')});
 const rect=await dialog.boundingBox();expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(width);
 await dialog.getByRole('button',{name:'Save details'}).click();await expect(dialog).not.toBeVisible();
 expect(state.contacts).toHaveLength(3);expect(state.contacts[0].notes).toBe('Preserved contact note');expect(state.contacts[0].role).toBe('Safety lead');
 await expect(page.locator('tr').filter({hasText:'Updated Employee'})).toContainText('Linked to Contacts');
 await page.goto('contacts.html');await page.locator('#contactsDirectoryDetails > summary').click();await expect(page.locator('#contactsList')).toContainText('Updated Employee');
 await expect(page.locator('#contactsList')).toContainText('6135550202');await expect(page.locator('#contactsList')).not.toContainText('Former Employee');
 state.contacts[0].phone='6135550302';await page.getByRole('button',{name:'Refresh Contacts',exact:true}).click();await expect(page.locator('#contactsList')).toContainText('6135550302');
});
test('weak phone/name matches require a deliberate review and never create a duplicate',async({page})=>{
 const state=await fixture(page);await page.goto('accounts.html');await page.locator('tr').filter({hasText:'Michael Worker'}).getByRole('button',{name:'Add to Contacts'}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Save details'}).click();await expect(dialog.getByRole('status')).toContainText('Choose and confirm');
 expect(state.calls.filter(c=>c.name==='save_employee_contact_details')).toHaveLength(0);
 await dialog.getByLabel('Existing Contact',{exact:true}).selectOption(id(104));await dialog.getByLabel('I confirm this Contact is the same employee.').check();
 await dialog.getByRole('button',{name:'Save details'}).click();await expect(dialog).not.toBeVisible();expect(state.contacts).toHaveLength(3);expect(state.contacts[2].employee_profile_id).toBe(id(4));
});
test('account contact save errors preserve the entered details and allow retry',async({page})=>{
 const state=await fixture(page);await page.goto('accounts.html');await page.locator('tr').filter({hasText:'Synthetic Employee'}).getByRole('button',{name:'Add to Contacts'}).click();
 state.failSave=true;await page.getByRole('dialog').getByRole('button',{name:'Save details'}).click();await expect(page.locator('#employeeContactSaveStatus')).toContainText('already linked');
 await expect(page.locator('#employeeContactName')).toHaveValue('Synthetic Employee');await expect(page.locator('#employeeContactSave')).toBeEnabled();state.failSave=false;
 await page.locator('#employeeContactSave').click();await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('Contacts load failures leave Accounts usable and retryable',async({page})=>{
 const state=await fixture(page);state.failLinks=true;await page.goto('accounts.html');await expect(page.locator('#accountsList')).toContainText('Contacts unavailable');
 await expect(page.locator('#accountsList').getByRole('button',{name:'Deactivate',exact:true}).first()).toBeEnabled();state.failLinks=false;
 await page.getByRole('button',{name:'Refresh Accounts',exact:true}).click();await expect(page.locator('#accountsList').getByRole('button',{name:'Add to Contacts',exact:true}).first()).toBeEnabled();
});
test('account deactivation archives the linked Contact while retaining its notes',async({page})=>{
 const state=await fixture(page);Object.assign(state.contacts[0],{employee_profile_id:id(2),employee_linked_at:'2026-01-01',employee_contact_status:'active'});
 await page.goto('accounts.html');await page.locator('tr').filter({hasText:'Synthetic Employee'}).getByRole('button',{name:'Deactivate',exact:true}).click();
 await page.waitForFunction(()=>accounts.some(a=>a.display_name==='Synthetic Employee'&&a.account_status==='inactive'));
 expect(state.contacts[0].is_active).toBe(false);expect(state.contacts[0].notes).toBe('Preserved contact note');
});
test('linked Contacts keep notes editable and identity fields controlled by Accounts',async({page})=>{
 const state=await fixture(page);Object.assign(state.contacts[0],{employee_profile_id:id(2),employee_linked_at:'2026-01-01',employee_contact_status:'active'});
 await page.goto('admin.html?tab=contacts');await expect(page.locator('#contactsSection')).toBeVisible();await page.locator('#contactsList tr').filter({hasText:'Synthetic Employee'}).getByRole('button',{name:'Edit',exact:true}).click();
 await expect(page.locator('#contactName')).toBeDisabled();await expect(page.locator('#contactPhone')).toBeDisabled();await expect(page.locator('#contactEmail')).toBeDisabled();
 await page.locator('#contactNotes').fill('Updated contact-only note');await page.locator('#contactSaveButton').click();await expect(page.locator('#contactStatus')).toContainText('saved');
 const call=state.calls.find(c=>c.name==='update_contact');expect(call.args.notes).toBe('Updated contact-only note');expect(call.args).not.toHaveProperty('name');expect(call.args).not.toHaveProperty('phone');expect(call.args).not.toHaveProperty('email');
 await expect(page.getByText('Archived Contacts',{exact:true})).toBeVisible();await expect(page.locator('#contactName')).toBeEnabled();
});
test('signup requires name phone email and stores Contacts opt-in for approval',async({page})=>{
 const state=await fixture(page,{guest:true});await page.goto('index.html');await page.locator('#createAccountToggle').click();
 await page.locator('#signupName').fill('New Employee');await page.locator('#signupEmail').fill('new@example.com');await page.locator('#signupPassword').fill('SyntheticPasswordOnly');
 await page.locator('#createAccountPanel').getByRole('button',{name:'Create Account',exact:true}).click();expect(state.signup).toBeNull();expect(state.alerts.join(' ')).toContain('phone');
 await page.locator('#signupPhone').fill('6135550808 ext220');await page.locator('#signupAddToContacts').check();await page.locator('#createAccountPanel').getByRole('button',{name:'Create Account',exact:true}).click();
 await expect.poll(()=>state.signup).not.toBeNull();expect(state.signup.data.phone).toBe('6135550808 ext220');expect(state.signup.data.add_to_contacts).toBe(true);expect(state.signup.data.display_name).toBe('New Employee');
 expect(state.signup.data).not.toHaveProperty('role');
});
