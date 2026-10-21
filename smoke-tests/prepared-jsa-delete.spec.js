const {test,expect}=require('@playwright/test');
const origin='https://xnrljkkszoimegfivlya.supabase.co';
async function setup(page,{admin=true,error=false}={}){
 const user={id:'00000000-0000-4000-8000-000000000001',email:'synthetic@example.com',role:'admin',account_status:'approved'};
 const token=Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture';
 const session={access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,user,token_type:'bearer'};
 await page.addInitScript(session=>{localStorage.setItem('sb-xnrljkkszoimegfivlya-auth-token',JSON.stringify(session));localStorage.setItem('currentWorker','synthetic');localStorage.setItem('currentUserRole','admin');localStorage.setItem('currentUserStatus','approved');localStorage.setItem('jgcTheme','light');},session);
 const row=(id,date,active=false)=>({id,revision:2,activated_at:active?'2026-10-01':null,record_id:active?id:null,payload:{record:{inspection_date:date,form_data:{fields:[{label:'Project / Job',value:'26999 - Synthetic project'}]}}}});
 const store={rows:[row('00000000-0000-4000-8000-000000000010','2020-10-10'),row('00000000-0000-4000-8000-000000000011','2099-10-15'),row('00000000-0000-4000-8000-000000000012','2026-10-01',true)],calls:[]};
 await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1')return route.fallback();if(url.origin!==origin)return route.abort();if(url.pathname.includes('/auth/v1/'))return route.fulfill({json:url.pathname.endsWith('/user')?user:session});if(url.pathname.endsWith('/rpc/is_admin'))return route.fulfill({json:admin});if(url.pathname.endsWith('/jsa_preparations'))return route.fulfill({json:store.rows});if(url.pathname.endsWith('/rpc/delete_prepared_jsa')){store.calls.push(route.request().postDataJSON());if(error)return route.fulfill({status:409,json:{message:'This prepared JSA changed elsewhere. Refresh the list before deleting.'}});store.rows=store.rows.filter(row=>row.id!==store.calls.at(-1).p_id);return route.fulfill({json:true});}return route.fulfill({json:[]});});
 await page.goto('/prepared-jsas.html');return store;
}
for(const width of [390,1440])test(`delete unused past preparation and preserve tomorrow at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const store=await setup(page);await page.locator("#preparedFilter").selectOption("all");await expect(page.getByRole('button',{name:'Delete',exact:true})).toHaveCount(2);
 const old=page.locator('.prepared-jsa-card').filter({hasText:'2020-10-10'});page.once('dialog',d=>{expect(d.message()).toContain('2020-10-10');d.accept();});await old.getByRole('button',{name:'Delete',exact:true}).click();await expect(old).toHaveCount(0);await page.locator('#preparedFilter').selectOption('draft');await expect(page.locator('.prepared-jsa-card')).toContainText(['2099-10-15']);expect(store.calls).toEqual([{p_id:'00000000-0000-4000-8000-000000000010',p_revision:2}]);
 await page.locator('#preparedFilter').selectOption('active');await expect(page.getByRole('button',{name:'Delete',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Open active JSA'})).toBeVisible();
});
test('cancel leaves preparation intact',async({page})=>{const store=await setup(page);await page.locator("#preparedFilter").selectOption("all");await expect(page.getByRole('button',{name:'Delete',exact:true})).toHaveCount(2);page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Delete',exact:true}).first().click();expect(store.calls).toHaveLength(0);await expect(page.locator('.prepared-jsa-card')).toHaveCount(3);});
test('conflict retains the preparation and enables retry',async({page})=>{await setup(page,{error:true});await page.locator('#preparedFilter').selectOption('all');page.on('dialog',d=>d.accept());const button=page.getByRole('button',{name:'Delete',exact:true}).first();await button.click();await expect(page.locator('#preparedStatus')).toContainText('changed elsewhere');await expect(button).toBeEnabled();await expect(page.locator('.prepared-jsa-card')).toHaveCount(3);});
test('non-admin never receives delete controls',async({page})=>{await setup(page,{admin:false});await expect(page.locator('#preparedStatus')).toContainText('administrators only');await expect(page.getByRole('button',{name:'Delete',exact:true})).toHaveCount(0);});

for (const width of [390, 1440]) test(`unused preparations appear in previous JSA history at ${width}px`, async ({page}, testInfo) => {
 await page.setViewportSize({width, height:900});
 const store = await setup(page);
 await expect(page.locator('.prepared-jsa-card')).toHaveCount(1);
 await expect(page.locator('.prepared-jsa-card')).toContainText('2099-10-15');
 await page.locator('#preparedFilter').selectOption('previous');
 await expect(page.locator('.prepared-jsa-card')).toHaveCount(1);
 await expect(page.locator('.prepared-jsa-card')).toContainText('Not activated');
 await expect(page.locator('.prepared-jsa-card')).toContainText('2020-10-10');
 for (const theme of ['light','dark']) {
  await page.evaluate(theme=>applyJgcTheme(theme),theme);
  await expect(page.locator('html')).toHaveAttribute('data-jgc-theme',theme);
  await page.screenshot({path:testInfo.outputPath(`previous-preparations-${theme}.png`)});
 }
 await page.getByRole('link', {name:'Previous JSAs',exact:true}).click();
 const card=page.locator('.history-card');
 await expect(card).toHaveCount(1);
 await expect(card).toContainText('Not activated');
 await expect(card).toContainText('JSA');
 await expect(card.getByRole('link',{name:'Open / PDF'})).toHaveAttribute('href', /prepared=00000000-0000-4000-8000-000000000010/);
 await expect(card.getByRole('button')).toHaveCount(0);
 for (const theme of ['light','dark']) {
  await page.evaluate(theme=>applyJgcTheme(theme),theme);
  await expect(card.locator('.jgc-badge')).toHaveCSS('color',theme==='light'?'rgb(255, 255, 255)':'rgb(255, 246, 214)');
  await page.screenshot({path:testInfo.outputPath(`previous-report-history-${theme}.png`)});
 }
 expect(store.calls).toHaveLength(0);
});

test('Toronto midnight moves an open prepared JSA list to history, without changing stored rows', async ({page}) => {
 await page.clock.install({time:new Date('2026-10-21T03:59:55Z')});
 const store=await setup(page);
 store.rows[0].payload.record.inspection_date='2026-10-20';
 await page.locator('#preparedRefresh').click();
 await expect(page.locator('.prepared-jsa-card')).toHaveCount(2);
 const before=JSON.stringify(store.rows);
 await page.clock.fastForward(35000);
 await expect(page.locator('.prepared-jsa-card')).toHaveCount(1);
 await page.locator('#preparedFilter').selectOption('previous');
 await expect(page.locator('.prepared-jsa-card')).toContainText('2026-10-20');
 await expect(page.locator('.prepared-jsa-card')).toContainText('Not activated');
 expect(JSON.stringify(store.rows)).toBe(before);
 expect(store.calls).toHaveLength(0);
});

test('past preparations are not requested or exposed to non-admin report viewers', async ({page}) => {
 let requests=0;
 await setup(page,{admin:false});
 page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/jsa_preparations'))requests++;});
 await page.goto('/previous-inspections.html?recordType=reports');
 await expect(page.locator('#inspectionList')).toContainText('No reports');
 await expect(page.locator('.history-card')).toHaveCount(0);
 expect(requests).toBe(0);
});

test('unavailable preparation history leaves saved reports visible and offers retry', async ({page}) => {
 await setup(page);
 await page.route('**/rest/v1/jsa_preparations*',route=>route.fulfill({status:403,json:{message:'Unavailable'}}));
 await page.route('**/rest/v1/inspection_records*',route=>route.fulfill({json:[{id:'00000000-0000-4000-8000-000000000013',inspection_type:'JSA',inspection_date:'2020-10-09',created_at:new Date().toISOString(),form_data:{fields:[{label:'Project / Job',value:'26999 - Synthetic project'}]}}]}));
 await page.goto('/previous-inspections.html?recordType=reports');
 await expect(page.locator('#preparedHistoryStatus')).toContainText('Could not load unused JSAs');
 await expect(page.locator('.history-card')).toHaveCount(1);
 await expect(page.locator('.history-card')).not.toContainText('Not activated');
});

test('classification preserves today, future, undated, linked and activated JSAs across timezone and DST boundaries', async ({page}) => {
 await setup(page);
 const result=await page.evaluate(()=>{
  const status=window.JgcJsaPreparationStatus;
  const row=(date,extra={})=>({payload:{record:{inspection_date:date}},...extra});
  const cases=[row('2026-10-20'),row('2026-10-21'),row('2026-10-22'),row(''),row('2026-02-30'),row('2026-10-20',{activated_at:'2026-10-20'}),row('2026-10-20',{record_id:'linked'})];
  return {past:cases.map(r=>status.isNotActivated(r,'2026-10-21')),dates:['2026-10-21T03:59:59Z','2026-10-21T04:00:00Z','2026-11-01T03:59:59Z','2026-11-01T04:00:00Z','2026-11-02T04:59:59Z','2026-11-02T05:00:00Z'].map(value=>status.today(new Date(value)))};
 });
 expect(result.past).toEqual([true,false,false,false,false,false,false]);
 expect(result.dates).toEqual(['2026-10-20','2026-10-21','2026-10-31','2026-11-01','2026-11-01','2026-11-02']);
});

test('previous reports refresh across Toronto midnight without a new sign-in', async ({page}) => {
 await page.clock.install({time:new Date('2026-10-21T03:59:55Z')});
 const store=await setup(page);
 store.rows=store.rows.slice(0,1);
 store.rows[0].payload.record.inspection_date='2026-10-20';
 await page.goto('/previous-inspections.html?recordType=reports');
 await expect(page.locator('#inspectionList')).toContainText('No reports');
 await page.clock.fastForward(35000);
 await expect(page.locator('.history-card')).toContainText('Not activated');
 expect(store.calls).toHaveLength(0);
});

test('preparation history reads every page and keeps permissions and source records intact', async ({page}) => {
 await setup(page);
 const result=await page.evaluate(async()=>{
  const source=Array.from({length:201},(_,i)=>({id:String(i),payload:{record:{inspection_date:'2020-10-10'}}}));
  const before=JSON.stringify(source),ranges=[];
  const client={rpc:async()=>({data:true}),from:()=>({select(){return this},is(){return this},order(){return this},async range(start,end){ranges.push([start,end]);return {data:source.slice(start,end+1)}}})};
  const rows=await JgcJsaPreparationStatus.loadPrevious(client);
  return {count:rows.length,ranges,unchanged:JSON.stringify(source)===before};
 });
 expect(result).toEqual({count:201,ranges:[[0,199],[200,399]],unchanged:true});
});
