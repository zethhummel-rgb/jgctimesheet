const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),ts=require('../estimating-app/node_modules/typescript');
const cache={};
function load(name){if(cache[name])return cache[name];const m={exports:{}};Function('exports','module','require',ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../estimating-app/lib/'+name+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m.exports,m,n=>n.startsWith('.')?load(n.replace(/^\.\//,'')):require('../estimating-app/node_modules/'+n));cache[name]=m.exports;return m.exports;}
const w=load('job-schedule'),merge=load('estimator-state-sync').mergeConcurrentEstimatorState;
const activity=(id,name,start,finish,overrides={})=>({...w.blankTask(start,'Preparation'),id,name,start,finish,owner:'JGC',...overrides});
function fixture(schedule){const state=load('estimator-data').createDefaultState();state.clients=[{id:'client',name:'Example Client',contact:'',email:'',phone:'',contacts:[],sites:[],notes:''}];state.quotes=[];state.priceBook=[];state.jobs=[{id:'job',jobNumber:'26999',quoteId:'',clientId:'client',project:'Washroom and Control Room',status:'Active',portalJobId:'portal-job',portalActive:true,portalCustomer:'Example Client',portalSiteName:'Main Office',portalAddress:'123 Example Street, Cornwall',projectManager:'Test Admin',startDate:'2026-10-05',targetEndDate:'2026-11-27',acceptedRevenue:0,originalCostBudget:0,approvedRevenueChanges:0,approvedCostChanges:0,estimateToComplete:0,acceptedAt:'2026-10-01T12:00:00Z',costs:[],notes:'',...(schedule?{schedule}:{})}];return state;}
const seed=()=>w.commitSchedule([
 activity('a','Shop drawings','2026-10-05','2026-10-09',{progress:40,notes:'Review the architectural detail before ordering.'}),
 activity('b','Concrete curing','2026-10-12','2026-10-18',{phase:'Rough-ins',calendar:'calendar'}),
 activity('c','Painting','2026-10-19','2026-10-23',{phase:'Finishes',owner:'Painting subcontractor'}),
],undefined,'Test Admin','Initial plan');
async function setup(page,schedule){let state=fixture(schedule);const saved=[];await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({actuals:[],jobs:[],rows:[]})}));await page.route('**/api/state',async r=>{if(r.request().method()==='PUT'){state=r.request().postDataJSON().state;saved.push(state);return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({saved:true,updatedAt:new Date().toISOString()})});}return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({state,updatedAt:'2026-10-01T12:00:00Z'})});});await page.goto('/estimating/index.html?dev=1&view=jobs&job=26999');await expect(page.locator('.job-detail-page')).toContainText('26999');await page.getByRole('tab',{name:'Schedule',exact:true}).click();await expect(page.locator('.job-schedule')).toBeVisible();return saved;}

test('working dates survive weekends, leap day and time changes; calendar durations count curing days',()=>{
 expect(w.finishFor('2026-10-02',5,'weekdays')).toBe('2026-10-08');
 expect(w.finishFor('2026-10-02',5,'calendar')).toBe('2026-10-06');
 expect(w.duration(activity('a','Work','2026-10-02','2026-10-08'))).toBe(5);
 expect(w.finishFor('2028-02-28',4,'calendar')).toBe('2028-03-02');
 expect(w.finishFor('2026-10-30',3,'weekdays')).toBe('2026-11-03');
 expect(Number.isNaN(w.dateNumber('2026-02-30'))).toBe(true);
});
test('explicit links cascade through chains, leave parallel work alone and reject cycles',()=>{
 const a=activity('a','Demolition','2026-10-05','2026-10-09'),b=activity('b','Patch','2026-10-05','2026-10-06',{predecessorId:'a',lag:2}),c=activity('c','Paint','2026-10-05','2026-10-09',{predecessorId:'b'}),d=activity('d','Parallel electrical','2026-10-05','2026-10-09');
 const tasks=w.reflowTasks([c,b,a,d]);expect(tasks[1].start).toBe('2026-10-12');expect(tasks[0].start).toBe('2026-10-14');expect(tasks[3]).toEqual(d);
 expect(w.validateTask({...a,predecessorId:'c'},tasks).predecessorId).toContain('circular');expect(()=>w.reflowTasks([{...a,predecessorId:'b'},b])).toThrow('circular');
});
test('revisions preserve issued dates and reject competing schedules, stale retry and removed history',()=>{
 const base=seed(),local=w.commitSchedule(base.tasks.map(t=>t.id==='a'?w.moveTask(t,'2026-10-12'):t),base,'First admin','Revised'),remote=w.commitSchedule(base.tasks.map(t=>t.id==='a'?w.moveTask(t,'2026-10-19'):t),base,'Second admin','Competing');
 const state=s=>({jobs:[{id:'job',schedule:s}],quotes:[]});
 expect(base.revisions[0].tasks[0].start).toBe('2026-10-05');expect(local.revisions).toHaveLength(2);
 expect(w.schedulePersistenceError(state(base),state(local))).toBe('');expect(merge(state(base),state(local),state(remote)).state).toBeNull();
 expect(w.schedulePersistenceError(state(remote),state(local))).toContain('another browser');expect(w.schedulePersistenceError(state(base),state({...local,revisions:[local.revisions[1]]}))).toContain('unchanged');
 const other={...state(base),quotes:[{id:'q',name:'Remote quote'}]};expect(merge(state(base),state(local),other).state.jobs[0].schedule).toEqual(local);
});
test('optional empty state never creates a schedule on opening or cancelling',async({page})=>{
 const saves=await setup(page);await expect(page.locator('.schedule-empty')).toContainText('Jobs never need a schedule');await page.getByRole('button',{name:'Create schedule',exact:true}).click();await page.getByRole('button',{name:'Cancel editing'}).click();await expect(page.locator('.schedule-empty')).toBeVisible();expect(saves).toHaveLength(0);
});
test('required information, date/duration editing, saving, reload and read-only activity notes',async({page})=>{
 const saves=await setup(page);await page.getByRole('button',{name:'Create schedule',exact:true}).click();await page.getByRole('button',{name:'Add first activity',exact:false}).click();const dialog=page.getByRole('dialog',{name:'Schedule activity editor'});await dialog.getByRole('button',{name:'Apply to draft'}).click();await expect(dialog).toContainText('An activity name is required');await dialog.getByLabel('Activity name *').fill('Concrete cure');await dialog.getByLabel('Start date *').fill('2026-10-02');await dialog.getByLabel('Count days as').selectOption('calendar');await dialog.getByLabel('Duration (days)').fill('7');await expect(dialog.getByLabel('Finish date *')).toHaveValue('2026-10-08');await dialog.getByRole('button',{name:'Apply to draft'}).click();await page.getByRole('tab',{name:'Summary',exact:true}).click();await page.getByRole('tab',{name:'Schedule',exact:true}).click();await expect(page.locator('.schedule-task-name')).toContainText('Concrete cure');await page.getByRole('button',{name:'Save schedule',exact:true}).click();await expect.poll(()=>saves.at(-1)?.jobs[0]?.schedule?.revision).toBe(1);expect(saves.at(-1).jobs[0].startDate).toBe('2026-10-05');await page.reload();await page.getByRole('tab',{name:'Schedule',exact:true}).click();await page.getByRole('button',{name:'Show details for Concrete cure'}).click();await expect(page.locator('.schedule-task-name')).toContainText('7 calendar days');await page.locator('.schedule-task-name').click();await expect(page.getByRole('dialog',{name:'Activity details'})).toContainText('Concrete cure');await expect(page.getByRole('dialog').locator('input')).toHaveCount(0);await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('bar moves, resize, undo and cancel stay in a draft until saved',async({page})=>{
 const saves=await setup(page,seed());await page.getByRole('button',{name:'Edit schedule',exact:true}).click();await page.getByRole('button',{name:'Show details for Shop drawings'}).click();const bar=page.getByRole('button',{name:/Shop drawings: .*drag to move/});await bar.scrollIntoViewIfNeeded();const b=await bar.boundingBox();await page.mouse.move(b.x+25,b.y+12);await page.mouse.down();await page.mouse.move(b.x+25+7*18,b.y+12,{steps:5});await page.mouse.up();await expect(page.locator('.schedule-task-name').first()).toContainText('Oct 12');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.schedule-task-name').first()).toContainText('Oct 5');const handle=page.getByRole('button',{name:'Change finish date for Shop drawings'});await handle.scrollIntoViewIfNeeded();const h=await handle.boundingBox();await page.mouse.move(h.x+10,h.y+18);await page.mouse.down();await page.mouse.move(h.x+10+7*18,h.y+18,{steps:5});await page.mouse.up();await expect(page.locator('.schedule-task-name').first()).toContainText('10 working days');expect(saves).toHaveLength(0);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Cancel editing'}).click();await expect(page.locator('.schedule-task-name').first()).toContainText('5 working days');
});
for(const theme of ['light','dark'])for(const viewport of [{width:1440,height:1000},{width:390,height:844}])test(`Gantt ${theme} ${viewport.width}: contained timeline, details and export`,async({page},testInfo)=>{
 await page.setViewportSize(viewport);await page.addInitScript(t=>{localStorage.setItem('jgcPortalTheme',t);},theme);await setup(page,seed());await expect(page.locator('html')).toHaveAttribute('data-jgc-theme',theme);await expect(page.locator('.schedule-scroll')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('button',{name:'Fit',exact:true}).click();await page.locator('.job-schedule').screenshot({path:testInfo.outputPath(`gantt-${theme}-${viewport.width}.png`)});await page.locator('.schedule-task-name').first().click();await expect(page.getByRole('dialog')).toContainText('Review the architectural detail');await page.getByRole('button',{name:'Close details'}).click();const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download schedule PDF',exact:true}).click();const pdf=await pending;expect(pdf.suggestedFilename()).toBe('26999 Job Schedule Rev 1.pdf');await pdf.saveAs(testInfo.outputPath('schedule.pdf'));expect(fs.statSync(testInfo.outputPath('schedule.pdf')).size).toBeGreaterThan(5000);
});
test('PDF tiles long dates and activity lists and keeps all task names and client information',async({},testInfo)=>{
 const tasks=Array.from({length:45},(_,i)=>activity('t'+i,'Unique activity '+i,'2026-10-05',w.addDays('2026-10-05',110),{calendar:'calendar',phase:i<20?'Preparation':'Finishes',owner:'Test contractor'}));const schedule=w.commitSchedule(tasks,undefined,'Test Admin','Long timeline');const state=fixture(schedule),bytes=await load('job-schedule-pdf').buildSchedulePdf({job:state.jobs[0],state,schedule,logoBytes:fs.readFileSync(path.resolve(__dirname,'../estimating/jgc-logo-transparent.png'))});const doc=await require('../estimating-app/node_modules/pdf-lib').PDFDocument.load(bytes);expect(doc.getPageCount()).toBeGreaterThanOrEqual(4);for(const p of doc.getPages())expect(p.getSize()).toEqual({width:1224,height:792});fs.writeFileSync(testInfo.outputPath('long-schedule.pdf'),bytes);
});

const ui=load('job-schedule-interactions');
test('screen adds six future weeks while start and finish handles keep the opposite date',()=>{
 const t=activity('a','Electrical','2026-10-05','2026-10-09');
 expect(w.dateString(ui.scheduleViewport([t]).finish)).toBe('2026-11-20');
 expect(ui.resizeTaskDate(t,'start',-7)).toMatchObject({start:'2026-09-28',finish:'2026-10-09'});
 expect(ui.resizeTaskDate(t,'start',100)).toMatchObject({start:'2026-10-09',finish:'2026-10-09'});
 expect(ui.resizeTaskDate(t,'finish',-100)).toMatchObject({start:'2026-10-05',finish:'2026-10-05'});
 expect(ui.resizeTaskDate(t,'finish',1).finish).toBe('2026-10-12');
 expect(ui.resizeTaskDate(t,'start',-1).start).toBe('2026-10-02');
});
test('reordering changes phase and sequence while preserving dates, progress and links',()=>{
 const a=activity('a','Demolition','2026-10-05','2026-10-09',{notes:'Preserve notes'}),b=activity('b','Electrical','2026-10-12','2026-10-16',{phase:'Rough-ins',predecessorId:'a'}),c=activity('c','Paint','2026-10-19','2026-10-23',{phase:'Finishes'});
 const rows=ui.reorderTask([a,b,c],'a',{id:'b',phase:'Rough-ins',after:true});
 expect(rows.map(t=>t.id)).toEqual(['b','a','c']);expect(rows[1]).toEqual({...a,phase:'Rough-ins'});expect(rows[0]).toEqual(b);
 expect(ui.reorderTask(rows,'a',{id:'a',phase:'Finishes',after:false})).toEqual(rows);
});
for(const theme of ['light','dark'])for(const viewport of [{width:1440,height:1000},{width:390,height:844}])test('inline activity entry keeps rows and dates visible '+theme+' '+viewport.width,async({page},testInfo)=>{
 await page.setViewportSize(viewport);await page.addInitScript(t=>localStorage.setItem('jgcPortalTheme',t),theme);await setup(page,seed());await page.getByRole('button',{name:'Edit schedule',exact:true}).click();await page.getByRole('button',{name:'Add activity',exact:false}).click();
 const editor=page.getByRole('dialog',{name:'Schedule activity editor'}),chart=page.locator('.schedule-scroll');
 await expect(editor).toHaveAttribute('aria-modal','false');await expect(page.locator('.schedule-modal-backdrop')).toHaveCount(0);expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
 const eb=await editor.boundingBox(),gb=await chart.boundingBox();expect(eb.y).toBeGreaterThan(gb.y);expect(eb.y).toBeLessThan(viewport.height-90);await expect(editor.locator('xpath=ancestor::div[contains(@class,"schedule-grid")]')).toHaveCount(1);
 await editor.getByLabel('Activity name *').fill('New electrical inspection');await editor.getByLabel('Start date *').fill('2026-12-14');await expect(chart).toHaveAttribute('data-finish','2027-01-29');
 await expect.poll(()=>chart.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('entry-'+theme+'-'+viewport.width+'.png')});
 await page.keyboard.press('Escape');await expect(editor).toHaveCount(0);
});
test('left and right dots change separate endpoints, then Undo restores the draft',async({page})=>{
 const saves=await setup(page,seed());await page.getByRole('button',{name:'Edit schedule',exact:true}).click();await page.getByRole('button',{name:'Show details for Shop drawings'}).click();
 const handle=page.getByRole('button',{name:'Change start date for Shop drawings'});await handle.scrollIntoViewIfNeeded();let b=await handle.boundingBox();
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2-7*18,b.y+b.height/2,{steps:5});await page.mouse.up();
 await expect(page.locator('[data-task-id="a"]')).toContainText('Sep 28');await expect(page.locator('[data-task-id="a"]')).toContainText('Oct 9');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('[data-task-id="a"]')).toContainText('Oct 5');expect(saves).toHaveLength(0);
});
test('grab reorders without changing dates and Escape cancels an unfinished row drag',async({page})=>{
 const tasks=Array.from({length:6},(_,i)=>activity('t'+i,'Activity '+i,'2026-10-05','2026-10-09')),saved=w.commitSchedule(tasks,undefined,'Test admin','Initial');const saves=await setup(page,saved);
 await page.getByRole('button',{name:'Edit schedule',exact:true}).click();await page.locator('.schedule-scroll').evaluate(el=>el.scrollIntoView({block:'center'}));
 const grip=page.getByRole('button',{name:'Reorder Activity 0',exact:true}),target=page.locator('[data-task-id="t3"]');let a=await grip.boundingBox(),b=await target.boundingBox();
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2,b.y+b.height-5,{steps:5});await page.mouse.up();
 await expect.poll(()=>page.locator('[data-schedule-row="task"]').evaluateAll(es=>es.map(e=>e.dataset.taskId))).toEqual(['t1','t2','t3','t0','t4','t5']);
 a=await grip.boundingBox();b=await page.locator('[data-task-id="t1"]').boundingBox();await page.mouse.move(a.x+10,a.y+15);await page.mouse.down();await page.mouse.move(a.x+10,b.y+5,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();
 await expect.poll(()=>page.locator('[data-schedule-row="task"]').evaluateAll(es=>es.map(e=>e.dataset.taskId))).toEqual(['t1','t2','t3','t0','t4','t5']);
 await page.getByRole('button',{name:'Save schedule',exact:true}).click();await expect.poll(()=>saves.at(-1)?.jobs[0].schedule.revision).toBe(2);expect(saves.at(-1).jobs[0].schedule.tasks.every(t=>t.start==='2026-10-05'&&t.finish==='2026-10-09')).toBe(true);
});
test('compact rows expand independently; applying a new activity reveals the row in a long list',async({page})=>{
 const tasks=Array.from({length:35},(_,i)=>activity('t'+i,'Existing '+i,'2026-10-05','2026-10-09')),saved=w.commitSchedule(tasks,undefined,'Test admin','Initial');await setup(page,saved);
 await expect(page.locator('.schedule-row-extra')).toHaveCount(0);await page.getByRole('button',{name:'Show details for Existing 0',exact:true}).click();await expect(page.locator('.schedule-row-extra')).toHaveCount(1);await page.getByRole('button',{name:'Hide details for Existing 0',exact:true}).click();
 await page.getByRole('button',{name:'Edit schedule',exact:true}).click();await page.getByRole('button',{name:'Add activity',exact:false}).click();const editor=page.getByRole('dialog',{name:'Schedule activity editor'});
 await editor.getByLabel('Activity name *').fill('Newest activity');await editor.getByLabel('Start date *').fill('2027-01-04');await editor.getByRole('button',{name:'Apply to draft'}).click();const added=page.locator('.schedule-task-name').filter({hasText:'Newest activity'});
 await expect(added).toBeVisible();await expect.poll(()=>page.locator('.schedule-scroll').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 const b=await added.boundingBox(),s=await page.locator('.schedule-scroll').boundingBox();expect(b.y).toBeGreaterThanOrEqual(s.y);expect(b.y+b.height).toBeLessThanOrEqual(s.y+s.height+2);
 const bar=await added.locator('xpath=ancestor::*[@data-task-id]').locator('.schedule-bar').boundingBox();expect(bar.x).toBeGreaterThanOrEqual(s.x+330);expect(bar.x+bar.width).toBeLessThanOrEqual(s.x+s.width+2);
});
test('Days Weeks Months Fit fill the chart and keep real month headings readable',async({page},testInfo)=>{
 await page.setViewportSize({width:1440,height:1000});await setup(page,seed());await expect(page.locator('.schedule-scroll')).toHaveAttribute('data-finish','2026-12-04');
 for(const zoom of ['Days','Weeks','Months','Fit']){await page.getByRole('button',{name:zoom,exact:true}).click();const sizes=await page.locator('.schedule-scroll').evaluate(el=>({viewport:el.clientWidth,grid:el.querySelector('.schedule-grid').getBoundingClientRect().width}));expect(sizes.grid).toBeGreaterThanOrEqual(sizes.viewport-1);if(zoom==='Months'||zoom==='Fit')await expect(page.locator('.schedule-weeks')).toContainText('November 2026');await page.locator('.job-schedule').screenshot({path:testInfo.outputPath('scale-'+zoom+'.png')});}
});
test('draft download is an Adobe-readable PDF marked Draft without saving a revision',async({page},testInfo)=>{
 const saves=await setup(page,seed());await page.getByRole('button',{name:'Edit schedule',exact:true}).click();await page.locator('.schedule-task-name').first().click();const editor=page.getByRole('dialog',{name:'Schedule activity editor'});await editor.getByLabel('Activity name *').fill('Draft electrical inspection');await editor.getByRole('button',{name:'Apply to draft'}).click();
 const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download draft PDF',exact:true}).click();const pdf=await pending;expect(pdf.suggestedFilename()).toBe('26999 Job Schedule Draft.pdf');await pdf.saveAs(testInfo.outputPath('draft-schedule.pdf'));const bytes=fs.readFileSync(testInfo.outputPath('draft-schedule.pdf'));expect(bytes.subarray(0,5).toString()).toBe('%PDF-');const doc=await require('../estimating-app/node_modules/pdf-lib').PDFDocument.load(bytes);expect(doc.getTitle()).toContain('DRAFT');expect(saves).toHaveLength(0);await expect(page.getByRole('button',{name:'Save schedule',exact:true})).toBeVisible();
});

test('row grab auto-scrolls a long list before dropping into the current visible target',async({page})=>{
 const tasks=Array.from({length:40},(_,i)=>activity('t'+i,'Row '+i,'2026-10-05','2026-10-09')),saved=w.commitSchedule(tasks,undefined,'Test admin','Initial');const saves=await setup(page,saved);
 await page.getByRole('button',{name:'Edit schedule',exact:true}).click();await page.locator('.schedule-scroll').evaluate(el=>el.scrollIntoView({block:'start'}));
 const scroll=page.locator('.schedule-scroll'),grip=page.getByRole('button',{name:'Reorder Row 0',exact:true}),a=await grip.boundingBox(),b=await scroll.boundingBox();
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2,Math.min(b.y+b.height-20,844-90),{steps:5});
 await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBeGreaterThan(120);await page.mouse.up();
 const order=await page.locator('[data-schedule-row="task"]').evaluateAll(es=>es.map(e=>e.dataset.taskId));expect(order.indexOf('t0')).toBeGreaterThan(2);expect(new Set(order).size).toBe(40);expect(saves).toHaveLength(0);
});

for(const theme of ['light','dark'])for(const viewport of [{width:1440,height:900},{width:390,height:844}])test(`sticky schedule toolbar ${theme} ${viewport.width}: add from scrolled timeline`,async({page},testInfo)=>{
 await page.setViewportSize(viewport);await page.addInitScript(t=>localStorage.setItem('jgcPortalTheme',t),theme);
 const tasks=Array.from({length:30},(_,i)=>activity('long'+i,'Activity '+i,'2026-10-05','2026-10-09'));
 const saves=await setup(page,w.commitSchedule(tasks,undefined,'Test Admin','Long schedule'));
 await page.getByRole('button',{name:'Edit schedule',exact:true}).click();
 const toolbar=page.locator('.schedule-toolbar'),add=toolbar.getByRole('button',{name:'Add activity',exact:false});
 const start=await toolbar.boundingBox();
 await page.evaluate(y=>window.scrollTo(0,y),await page.evaluate(()=>window.scrollY)+start.y-130+100);
 await expect.poll(async()=>Math.round((await toolbar.boundingBox()).y)).toBe(130);
 const bounds=await toolbar.boundingBox(),tabs=await page.locator('.job-tabs').boundingBox();
 expect(bounds.y).toBeGreaterThanOrEqual(tabs.y+tabs.height-1);
 expect(bounds.y+bounds.height).toBeLessThan(viewport.height-100);
 expect(await add.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
 await page.screenshot({path:testInfo.outputPath(`sticky-${theme}-${viewport.width}.png`)});
 await add.click();const editor=page.getByRole('dialog',{name:'Schedule activity editor'});
 await expect(editor).toBeVisible();await expect(page.locator('.schedule-preview-row')).toBeVisible();const head=await page.locator('.schedule-grid-head').boundingBox(),chartBox=await page.locator('.schedule-scroll').boundingBox();expect(head.y).toBeGreaterThanOrEqual(chartBox.y);expect(head.y+head.height).toBeLessThan(viewport.height-100);const input=editor.getByLabel('Activity name *');await input.fill('Added while scrolled');await page.screenshot({path:testInfo.outputPath('inline-'+theme+'-'+viewport.width+'.png')});
 expect(await input.evaluate(el=>{const r=el.getBoundingClientRect();return el===document.elementFromPoint(r.x+20,r.y+r.height/2);})).toBe(true);
 await editor.getByRole('button',{name:'Apply to draft'}).click();await expect(page.locator('.schedule-task-name').filter({hasText:'Added while scrolled'})).toBeVisible();
 const added=page.locator('.schedule-task-name').filter({hasText:'Added while scrolled'});
 await expect(added).toBeFocused(); await expect(page.locator('.schedule-preview-row')).toHaveCount(0);
 const newBox=await added.boundingBox();expect(newBox.y).toBeGreaterThan(130);expect(newBox.y+newBox.height).toBeLessThanOrEqual(viewport.height-64);
 await page.screenshot({path:testInfo.outputPath('added-'+theme+'-'+viewport.width+'.png')});
 expect(saves).toHaveLength(0);
});
