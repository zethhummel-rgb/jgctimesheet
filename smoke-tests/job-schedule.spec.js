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

async function openSchedulePdf(page, name='Download schedule PDF'){
  await page.getByRole('button',{name,exact:true}).click();
  const dialog=page.getByRole('dialog',{name,exact:true});
  await expect(dialog).toBeVisible();
  return dialog;
}

async function downloadSchedulePdf(page, dialog){
  const pending=page.waitForEvent('download');
  await dialog.getByRole('button',{name:'Download PDF',exact:true}).click();
  const download=await pending;
  await expect(dialog).toBeHidden();
  return download;
}

async function editFirstActivity(page){
  await page.locator('.schedule-task-name').first().click();
  await page.getByRole('dialog',{name:'Activity details',exact:true}).getByRole('button',{name:'Edit activity',exact:true}).click();
  return page.getByRole('dialog',{name:'Schedule activity editor',exact:true});
}

test('activity quick progress accepts any percentage, autosaves and can be undone',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  const original=seed(),saves=await setup(page,original);
  const row=page.locator('[data-task-id="a"]');
  const dialog=page.getByRole('dialog',{name:'Activity details',exact:true});
  const progress=dialog.getByRole('spinbutton',{name:'Progress (%)',exact:true});
  const save=dialog.getByRole('button',{name:'Save progress',exact:true});
  await row.locator('.schedule-task-name').click();
  await expect(progress).toHaveValue('40');
  await progress.fill('101');
  await expect(save).toBeDisabled();
  await expect(dialog.getByRole('alert')).toHaveText('Enter a percentage from 0 to 100.');
  await progress.fill('37.5');
  await dialog.screenshot({path:testInfo.outputPath('activity-quick-actions-phone.png')});
  await progress.press('Enter');
  await expect(dialog).toBeHidden();
  await expect.poll(()=>saves.at(-1)?.jobs[0]?.scheduleDraft?.tasks[0].progress).toBe(37.5);
  expect(saves.at(-1).jobs[0].schedule).toEqual(original);
  await expect(row.locator('.schedule-progress')).toHaveAttribute('style',/width: 37\.5%/);

  await page.reload();
  await page.getByRole('tab',{name:'Schedule',exact:true}).click();
  await row.locator('.schedule-bar').click();
  await expect(progress).toHaveValue('37.5');
  await dialog.getByRole('button',{name:'Mark 100%',exact:true}).click();
  await expect(row.locator('.schedule-progress')).toHaveAttribute('style',/width: 100%/);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(row.locator('.schedule-progress')).toHaveAttribute('style',/width: 37\.5%/);

  await row.locator('.schedule-task-name').click();
  await progress.fill('0');
  await save.click();
  await expect.poll(()=>saves.at(-1)?.jobs[0]?.scheduleDraft?.tasks[0].progress).toBe(0);
  const editor=await editFirstActivity(page);
  await expect(editor.getByLabel('Progress (%)',{exact:true})).toHaveValue('0');
});

test('delete activity confirms the removal and Undo restores linked activities',async({page})=>{
  const original=w.commitSchedule([
    activity('forms','Build forms','2026-10-05','2026-10-09'),
    activity('pour','Pour concrete','2026-10-12','2026-10-16',{phase:'Finishing',predecessorId:'forms'})
  ],undefined,'Test Admin','');
  const saves=await setup(page,original);
  const row=page.locator('[data-task-id="forms"]');
  const dialog=page.getByRole('dialog',{name:'Activity details',exact:true});
  const remove=dialog.getByRole('button',{name:'Delete activity',exact:true});
  await row.locator('.schedule-task-name').click();
  await remove.click();
  await expect(dialog.getByRole('button',{name:'Keep activity'})).toBeFocused();
  await expect(dialog).toContainText('will keep their dates and become independent');
  await dialog.getByRole('button',{name:'Keep activity'}).click();
  expect(saves).toHaveLength(0);
  await remove.click();
  await remove.click();
  await expect(row).toHaveCount(0);
  const undo=page.getByRole('button',{name:'Undo',exact:true});
  await expect(undo).toBeFocused();
  await expect.poll(()=>saves.at(-1)?.jobs[0]?.scheduleDraft?.tasks).toEqual([
    {...original.tasks[1],predecessorId:'',lag:0}
  ]);
  expect(saves.at(-1).jobs[0].schedule).toEqual(original);
  await undo.click();
  await expect(row).toBeVisible();
  await expect.poll(()=>saves.at(-1)?.jobs[0]?.scheduleDraft?.tasks).toEqual(original.tasks);
});

for(const width of [1440,390])test('schedule dates and activity colours remain readable at '+width+'px',async({page})=>{
  await page.setViewportSize({width,height:900});
  const tasks=[
    activity('complete','Safety inspection','2026-10-05','2026-10-05',{progress:100}),
    activity('partial','Rough-in and inspection','2026-10-12','2026-10-16',{phase:'Electrical',progress:25}),
    activity('remaining','Final paint','2026-10-19','2026-10-23',{phase:'Finishes'})
  ];
  await setup(page,w.commitSchedule(tasks,undefined,'Test Admin',''));
  const day=page.locator('.schedule-day-head [data-day="2026-10-12"]');
  await expect(day.locator('.schedule-weekday')).toHaveText('M');
  await expect(day.locator('.schedule-date-number')).toHaveText('12');
  const clearance=await day.evaluate(el=>{
    const range=document.createRange();
    range.selectNodeContents(el.querySelector('.schedule-date-number'));
    const bottom=range.getBoundingClientRect().bottom;
    return Math.min(...['.schedule-day-head','.schedule-time-head','.schedule-date-scroll','.schedule-datebar']
      .map(selector=>el.closest(selector).getBoundingClientRect().bottom-bottom));
  });
  expect(clearance).toBeGreaterThanOrEqual(2);
  const partial=page.locator('[data-task-id="partial"] .schedule-bar');
  await expect(partial).toHaveCSS('background-color','rgb(40, 107, 158)');
  await expect(partial.locator('.schedule-progress')).toHaveCSS('background-color','rgb(11, 74, 51)');
  await expect(partial.locator('.schedule-bar-label')).toHaveCSS('color','rgb(255, 255, 255)');
  await expect(partial.locator('.schedule-bar-label')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  const bar=await partial.boundingBox(),fill=await partial.locator('.schedule-progress').boundingBox();
  expect(fill.width/bar.width).toBeCloseTo(0.25,2);
  expect(Math.abs((await day.boundingBox()).x-bar.x)).toBeLessThan(2);
  const oneDay=page.locator('[data-task-id="complete"]');
  await expect(oneDay.locator('.schedule-bar-label')).toBeHidden();
  await expect(oneDay.locator('.schedule-task-name')).toContainText('Safety inspection');
  await expect(oneDay.locator('.schedule-bar')).toHaveAccessibleName(/Safety inspection/);
  await expect(page.locator('[data-task-id="remaining"] .schedule-bar')).toHaveCSS('background-color','rgb(120, 87, 163)');
});

test('printed schedule gives the timeline the space around measured dates, duration and percent',async()=>{
  const task=activity('long','Electrical rough-in and inspection with the mechanical contractor','2026-09-30','2027-01-30',{calendar:'calendar',progress:100});
  const schedule=w.commitSchedule([task],undefined,'Test Admin',''),state=fixture(schedule);
  const bytes=await load('job-schedule-pdf').buildSchedulePdf({
    job:state.jobs[0],state,schedule,
    logoBytes:fs.readFileSync(path.resolve(__dirname,'../estimating/jgc-logo-transparent.png')),
    periodRange:w.schedulePdfPeriod('Weekly','2026-09-30','')
  });
  const pdfjs=await import(require('node:url').pathToFileURL(path.resolve(__dirname,'../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  const loading=pdfjs.getDocument({data:new Uint8Array(bytes)});
  try{
    const doc=await loading.promise,page=await doc.getPage(1);
    const items=(await page.getTextContent()).items.filter(item=>item.str?.trim());
    const find=value=>items.find(item=>item.str.trim()===value);
    const asDate=value=>new Date(value+'T00:00:00Z').toLocaleDateString('en-CA',{month:'short',day:'numeric',timeZone:'UTC'});
    const headings=['START','FINISH','DAYS','%'].map(find);
    const values=[asDate(task.start),asDate(task.finish),'123c','100%'].map(find);
    const center=item=>item.transform[4]+item.width/2;
    for(let i=0;i<values.length;i++){
      expect(values[i]).toBeDefined();
      expect(Math.abs(center(headings[i])-center(values[i]))).toBeLessThan(1);
      if(i===0)continue;
      const previousRight=Math.max(headings[i-1].transform[4]+headings[i-1].width,values[i-1].transform[4]+values[i-1].width);
      const gap=Math.min(headings[i].transform[4],values[i].transform[4])-previousRight;
      expect(gap).toBeGreaterThanOrEqual(7);
      expect(gap).toBeLessThanOrEqual(11);
    }
    const firstDay=center(items.find(item=>item.str==='S')),secondDay=center(find('M'));
    const chartLeft=firstDay-(secondDay-firstDay)/2;
    expect(chartLeft-(values[3].transform[4]+values[3].width)).toBeLessThan(6);
    expect(chartLeft).toBeLessThan(425);
    expect(items.map(item=>item.str).join(' ')).toContain('mechanical contractor');
  }finally{await loading.destroy();}
});

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
 const saves=await setup(page);await expect(page.locator('.schedule-empty')).toContainText('Jobs never need a schedule');await page.getByRole('button',{name:'Create schedule',exact:true}).click();await page.getByRole('button',{name:'Cancel editing'}).click();await expect(page.locator('.schedule-empty')).toBeVisible();expect(saves.every(s=>!s.jobs[0].schedule||s.jobs[0].schedule.revision===1)).toBe(true);
});
test('required information, date/duration editing, saving, reload and read-only activity notes',async({page})=>{
 const saves=await setup(page);await page.getByRole('button',{name:'Create schedule',exact:true}).click();await page.getByRole('button',{name:'Add first activity',exact:false}).click();const dialog=page.getByRole('dialog',{name:'Schedule activity editor'});await dialog.getByRole('button',{name:'Apply to draft'}).click();await expect(dialog).toContainText('An activity name is required');await dialog.getByLabel('Activity name *').fill('Concrete cure');await dialog.getByLabel('Start date *').fill('2026-10-02');await dialog.getByLabel('Count days as').selectOption('calendar');await dialog.getByLabel('Duration (days)').fill('7');await expect(dialog.getByLabel('Finish date *')).toHaveValue('2026-10-08');await dialog.getByRole('button',{name:'Apply to draft'}).click();await page.getByRole('tab',{name:'Summary',exact:true}).click();await page.getByRole('tab',{name:'Schedule',exact:true}).click();await expect(page.locator('.schedule-task-name')).toContainText('Concrete cure');await downloadSchedulePdf(page,await openSchedulePdf(page));await expect.poll(()=>saves.at(-1)?.jobs[0]?.schedule?.revision).toBe(1);expect(saves.at(-1).jobs[0].startDate).toBe('2026-10-05');await page.reload();await page.getByRole('tab',{name:'Schedule',exact:true}).click();await page.getByRole('button',{name:'Show details for Concrete cure'}).click();await expect(page.locator('.schedule-task-name')).toContainText('7 calendar days');await page.locator('.schedule-task-name').click();await expect(page.getByRole('dialog',{name:'Activity details'})).toContainText('Concrete cure');await expect(page.getByRole('dialog').getByRole('spinbutton',{name:'Progress (%)'})).toHaveValue('');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('bar moves, resize, undo and cancel stay in a draft until saved',async({page})=>{
 const saves=await setup(page,seed());await page.getByRole('button',{name:'Edit schedule',exact:true}).click();await page.getByRole('button',{name:'Show details for Shop drawings'}).click();const bar=page.getByRole('button',{name:/Shop drawings: .*drag to move/});await bar.scrollIntoViewIfNeeded();const b=await bar.boundingBox();await page.mouse.move(b.x+25,b.y+12);await page.mouse.down();await page.mouse.move(b.x+25+7*18,b.y+12,{steps:5});await page.mouse.up();await expect(page.locator('.schedule-task-name').first()).toContainText('Oct 12');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.schedule-task-name').first()).toContainText('Oct 5');const handle=page.getByRole('button',{name:'Change finish date for Shop drawings'});await handle.scrollIntoViewIfNeeded();const h=await handle.boundingBox();await page.mouse.move(h.x+10,h.y+18);await page.mouse.down();await page.mouse.move(h.x+10+7*18,h.y+18,{steps:5});await page.mouse.up();await expect(page.locator('.schedule-task-name').first()).toContainText('10 working days');expect(saves.every(s=>!s.jobs[0].schedule||s.jobs[0].schedule.revision===1)).toBe(true);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Cancel editing'}).click();await expect(page.locator('.schedule-task-name').first()).toContainText('5 working days');
});
for(const theme of ['light','dark'])for(const viewport of [{width:1440,height:1000},{width:390,height:844}])test(`Gantt ${theme} ${viewport.width}: contained timeline, details and export`,async({page},testInfo)=>{
  await page.setViewportSize(viewport);
  await page.addInitScript(t=>localStorage.setItem('jgcPortalTheme',t),theme);
  await setup(page,seed());
  await expect(page.locator('html')).toHaveAttribute('data-jgc-theme',theme);
  await expect(page.locator('body')).toHaveClass(/\bjgc-theme\b/);
  await expect(page.locator('.schedule-scroll')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Fit',exact:true}).click();
  await page.locator('.job-schedule').screenshot({path:testInfo.outputPath(`gantt-${theme}-${viewport.width}.png`)});
  await page.locator('.schedule-task-name').first().click();
  const details=page.getByRole('dialog',{name:'Activity details',exact:true});
  await expect(details).toContainText('Review the architectural detail');
  await expect(details.getByRole('heading',{name:'Shop drawings',exact:true})).toHaveCSS('color','rgb(255, 255, 255)');
  await expect(details.locator('.schedule-activity-phase')).toHaveCSS('color','rgb(242, 250, 245)');
  await details.getByRole('button',{name:'Close details',exact:true}).click();
  const pdf=await downloadSchedulePdf(page,await openSchedulePdf(page));
  expect(pdf.suggestedFilename()).toBe('26999 Job Schedule Rev 1.pdf');
  const output=testInfo.outputPath('schedule.pdf');
  await pdf.saveAs(output);
  expect(fs.statSync(output).size).toBeGreaterThan(5000);
});
test('PDF tiles long dates and activity lists and keeps all task names and client information',async({},testInfo)=>{
 const tasks=Array.from({length:45},(_,i)=>activity('t'+i,'Unique activity '+i,'2026-10-05',w.addDays('2026-10-05',110),{calendar:'calendar',phase:i<20?'Preparation':'Finishes',owner:'Test contractor'}));const schedule=w.commitSchedule(tasks,undefined,'Test Admin','Long timeline');const state=fixture(schedule),bytes=await load('job-schedule-pdf').buildSchedulePdf({job:state.jobs[0],state,schedule,logoBytes:fs.readFileSync(path.resolve(__dirname,'../estimating/jgc-logo-transparent.png'))});const doc=await require('../estimating-app/node_modules/pdf-lib').PDFDocument.load(bytes);expect(doc.getPageCount()).toBeGreaterThanOrEqual(4);for(const p of doc.getPages())expect(p.getSize()).toEqual({width:1224,height:792});fs.writeFileSync(testInfo.outputPath('long-schedule.pdf'),bytes);
});

const ui=load('job-schedule-interactions');
test('screen adds six future weeks while start and finish handles keep the opposite date',()=>{
 const t=activity('a','Electrical','2026-10-05','2026-10-09');
 expect(w.dateString(ui.scheduleViewport([t]).finish)).toBe('2026-11-21');
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
 await expect(editor).toHaveAttribute('aria-modal','false');await expect(page.locator('dialog[open]')).toHaveCount(0);expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
 const eb=await editor.boundingBox(),gb=await chart.boundingBox();expect(eb.y).toBeGreaterThan(gb.y);expect(eb.y).toBeLessThan(viewport.height-90);await expect(editor.locator('xpath=ancestor::div[contains(@class,"schedule-grid")]')).toHaveCount(1);
 await editor.getByLabel('Activity name *').fill('New electrical inspection');await editor.getByLabel('Start date *').fill('2026-12-14');await expect(chart).toHaveAttribute('data-finish','2027-01-30');
 await expect.poll(()=>chart.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:testInfo.outputPath('entry-'+theme+'-'+viewport.width+'.png')});
 await page.keyboard.press('Escape');await expect(editor).toHaveCount(0);
});
test('left and right dots change separate endpoints, then Undo restores the draft',async({page})=>{
 const saves=await setup(page,seed());await page.getByRole('button',{name:'Edit schedule',exact:true}).click();await page.getByRole('button',{name:'Show details for Shop drawings'}).click();
 const handle=page.getByRole('button',{name:'Change start date for Shop drawings'});await handle.scrollIntoViewIfNeeded();let b=await handle.boundingBox();
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2-7*18,b.y+b.height/2,{steps:5});await page.mouse.up();
 await expect(page.locator('[data-task-id="a"]')).toContainText('Sep 28');await expect(page.locator('[data-task-id="a"]')).toContainText('Oct 9');
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('[data-task-id="a"]')).toContainText('Oct 5');expect(saves.every(s=>!s.jobs[0].schedule||s.jobs[0].schedule.revision===1)).toBe(true);
});
test('grab reorders without changing dates and Escape cancels an unfinished row drag',async({page})=>{
 const tasks=Array.from({length:6},(_,i)=>activity('t'+i,'Activity '+i,'2026-10-05','2026-10-09')),saved=w.commitSchedule(tasks,undefined,'Test admin','Initial');const saves=await setup(page,saved);
 await page.getByRole('button',{name:'Edit schedule',exact:true}).click();await page.locator('.schedule-scroll').evaluate(el=>el.scrollIntoView({block:'center'}));
 const grip=page.getByRole('button',{name:'Reorder Activity 0',exact:true}),target=page.locator('[data-task-id="t3"]');let a=await grip.boundingBox(),b=await target.boundingBox();
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2,b.y+b.height-5,{steps:5});await page.mouse.up();
 await expect.poll(()=>page.locator('[data-schedule-row="task"]').evaluateAll(es=>es.map(e=>e.dataset.taskId))).toEqual(['t1','t2','t3','t0','t4','t5']);
 a=await grip.boundingBox();b=await page.locator('[data-task-id="t1"]').boundingBox();await page.mouse.move(a.x+10,a.y+15);await page.mouse.down();await page.mouse.move(a.x+10,b.y+5,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();
 await expect.poll(()=>page.locator('[data-schedule-row="task"]').evaluateAll(es=>es.map(e=>e.dataset.taskId))).toEqual(['t1','t2','t3','t0','t4','t5']);
 await downloadSchedulePdf(page,await openSchedulePdf(page));await expect.poll(()=>saves.at(-1)?.jobs[0].schedule.revision).toBe(2);expect(saves.at(-1).jobs[0].schedule.tasks.every(t=>t.start==='2026-10-05'&&t.finish==='2026-10-09')).toBe(true);
});
test('compact rows expand independently; applying a new activity reveals the row in a long list',async({page})=>{
 const tasks=Array.from({length:35},(_,i)=>activity('t'+i,'Existing '+i,'2026-10-05','2026-10-09')),saved=w.commitSchedule(tasks,undefined,'Test admin','Initial');await setup(page,saved);
 await expect(page.locator('.schedule-row-extra')).toHaveCount(0);await page.getByRole('button',{name:'Show details for Existing 0',exact:true}).click();await expect(page.locator('.schedule-row-extra')).toHaveCount(1);await page.getByRole('button',{name:'Hide details for Existing 0',exact:true}).click();
 await page.getByRole('button',{name:'Edit schedule',exact:true}).click();await page.getByRole('button',{name:'Add activity',exact:false}).click();const editor=page.getByRole('dialog',{name:'Schedule activity editor'});
 await editor.getByLabel('Activity name *').fill('Newest activity');await editor.getByLabel('Start date *').fill('2027-01-04');await editor.getByRole('button',{name:'Apply to draft'}).click();const added=page.locator('.schedule-task-name').filter({hasText:'Newest activity'});
 await expect(added).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(0);expect(await page.locator('.schedule-scroll').evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
 const b=await added.boundingBox(),s=await page.locator('.schedule-scroll').boundingBox();expect(b.y).toBeGreaterThanOrEqual(s.y);expect(b.y+b.height).toBeLessThanOrEqual(s.y+s.height+2);
 const bar=await added.locator('xpath=ancestor::*[@data-task-id]').locator('.schedule-bar').boundingBox();expect(bar.x).toBeGreaterThanOrEqual(s.x+330);expect(bar.x+bar.width).toBeLessThanOrEqual(s.x+s.width+2);
});
test('Days Weeks Months Fit fill the chart and keep real month headings readable',async({page},testInfo)=>{
 await page.setViewportSize({width:1440,height:1000});await setup(page,seed());await expect(page.locator('.schedule-scroll')).toHaveAttribute('data-finish','2026-12-05');
 for(const zoom of ['Days','Weeks','Months','Fit']){await page.getByRole('button',{name:zoom,exact:true}).click();const sizes=await page.locator('.schedule-scroll').evaluate(el=>({viewport:el.clientWidth,grid:el.querySelector('.schedule-grid').getBoundingClientRect().width}));expect(sizes.grid).toBeGreaterThanOrEqual(sizes.viewport-1);if(zoom==='Months'||zoom==='Fit')await expect(page.locator('.schedule-weeks')).toContainText('November 2026');await page.locator('.job-schedule').screenshot({path:testInfo.outputPath('scale-'+zoom+'.png')});}
});
test('draft download is an Adobe-readable PDF marked Draft without saving a revision',async({page},testInfo)=>{
 const saves=await setup(page,seed());await page.getByRole('button',{name:'Edit schedule',exact:true}).click();const editor=await editFirstActivity(page);await editor.getByLabel('Activity name *').fill('Draft electrical inspection');await editor.getByRole('button',{name:'Apply to draft'}).click();
 const pdf=await downloadSchedulePdf(page,await openSchedulePdf(page,'Download draft PDF'));expect(pdf.suggestedFilename()).toBe('26999 Job Schedule Draft.pdf');await pdf.saveAs(testInfo.outputPath('draft-schedule.pdf'));const bytes=fs.readFileSync(testInfo.outputPath('draft-schedule.pdf'));expect(bytes.subarray(0,5).toString()).toBe('%PDF-');const doc=await require('../estimating-app/node_modules/pdf-lib').PDFDocument.load(bytes);expect(doc.getTitle()).toContain('DRAFT');expect(saves.every(s=>!s.jobs[0].schedule||s.jobs[0].schedule.revision===1)).toBe(true);await expect(page.getByRole('button',{name:'Download schedule PDF',exact:true})).toBeVisible();
});

test('row grab auto-scrolls a long list before dropping into the current visible target',async({page})=>{
 const tasks=Array.from({length:40},(_,i)=>activity('t'+i,'Row '+i,'2026-10-05','2026-10-09')),saved=w.commitSchedule(tasks,undefined,'Test admin','Initial');const saves=await setup(page,saved);
 await page.getByRole('button',{name:'Edit schedule',exact:true}).click();await page.locator('.schedule-scroll').evaluate(el=>el.scrollIntoView({block:'start'}));
 const scroll=page.locator('.schedule-scroll'),grip=page.getByRole('button',{name:'Reorder Row 0',exact:true}),a=await grip.boundingBox(),b=await scroll.boundingBox();
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2,Math.min(b.y+b.height-20,page.viewportSize().height-90),{steps:5});
 const before=await page.evaluate(()=>window.scrollY);await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(before+120);await page.mouse.up();
 const order=await page.locator('[data-schedule-row="task"]').evaluateAll(es=>es.map(e=>e.dataset.taskId));expect(order.indexOf('t0')).toBeGreaterThan(2);expect(new Set(order).size).toBe(40);expect(saves.every(s=>!s.jobs[0].schedule||s.jobs[0].schedule.revision===1)).toBe(true);
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
 // All job tabs stay on one row (ten tabs wrapped to two on desktop and covered this toolbar).
 expect(await page.locator('.job-tabs button').evaluateAll(buttons=>new Set(buttons.map(button=>Math.round(button.getBoundingClientRect().top))).size)).toBe(1);
 expect(bounds.y).toBeGreaterThanOrEqual(tabs.y+tabs.height-1);
 expect(bounds.y+bounds.height).toBeLessThan(viewport.height-100);
 const dateBox=await page.locator('.schedule-datebar').boundingBox();expect(dateBox.y).toBeGreaterThanOrEqual(bounds.y+bounds.height);
 await page.locator('.schedule-date-scroll').evaluate(el=>el.scrollLeft=80);await expect.poll(()=>page.locator('.schedule-scroll').evaluate(el=>el.scrollLeft)).toBe(80);
 await page.locator('.schedule-scroll').evaluate(el=>el.scrollLeft=0);await expect.poll(()=>page.locator('.schedule-date-scroll').evaluate(el=>el.scrollLeft)).toBe(0);
 expect(await add.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
 await page.screenshot({path:testInfo.outputPath(`sticky-${theme}-${viewport.width}.png`)});
 await add.click();const editor=page.getByRole('dialog',{name:'Schedule activity editor'});
 await expect(editor).toBeVisible();await expect(page.locator('.schedule-preview-row')).toBeVisible();const head=await page.locator('.schedule-grid-head').boundingBox(),chartBox=await page.locator('.schedule-scroll').boundingBox();expect(head.y).toBeGreaterThanOrEqual(130);expect(await page.locator('.schedule-scroll').evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);expect(head.y+head.height).toBeLessThan(viewport.height-100);const input=editor.getByLabel('Activity name *');await input.fill('Added while scrolled');await page.screenshot({path:testInfo.outputPath('inline-'+theme+'-'+viewport.width+'.png')});
 expect(await input.evaluate(el=>{const r=el.getBoundingClientRect();return el===document.elementFromPoint(r.x+20,r.y+r.height/2);})).toBe(true);
 await editor.getByRole('button',{name:'Apply to draft'}).click();await expect(page.locator('.schedule-task-name').filter({hasText:'Added while scrolled'})).toBeVisible();
 const added=page.locator('.schedule-task-name').filter({hasText:'Added while scrolled'});
 await expect(added).toBeFocused(); await expect(page.locator('.schedule-preview-row')).toHaveCount(0);
 const newBox=await added.boundingBox();expect(newBox.y).toBeGreaterThan(130);expect(newBox.y+newBox.height).toBeLessThanOrEqual(viewport.height-64);
 await page.screenshot({path:testInfo.outputPath('added-'+theme+'-'+viewport.width+'.png')});
 expect(saves.every(s=>!s.jobs[0].schedule||s.jobs[0].schedule.revision===1)).toBe(true);
});

test('inline entry accepts typed 1, 5 and 120 days; finish-date selection recalculates duration',async({page})=>{
 await setup(page,seed());await page.getByRole('button',{name:'Edit schedule',exact:true}).click();await page.getByRole('button',{name:'Add activity',exact:false}).click();
 const entry=page.getByRole('dialog',{name:'Schedule activity editor'}),start=entry.getByLabel('Start date *'),finish=entry.getByLabel('Finish date *'),days=entry.getByLabel('Duration (days)');
 await start.fill('2026-10-05');
 for(const [value,end] of [['1','2026-10-05'],['5','2026-10-09'],['120','2027-03-19']]){await days.fill('');await expect(days).toHaveValue('');await days.pressSequentially(value);await expect(days).toHaveValue(value);await expect(finish).toHaveValue(end);}
 await finish.fill('2026-10-16');await expect(days).toHaveValue('10');
 await entry.getByLabel('Count days as').selectOption('calendar');await days.fill('120');await expect(finish).toHaveValue('2027-02-01');
 await finish.fill('2026-10-16');await expect(days).toHaveValue('12');
 await start.fill('2026-11-02');await expect(days).toHaveValue('12');await expect(finish).toHaveValue('2026-11-13');
 await entry.getByLabel('Activity name *').fill('Typed duration');await days.fill('');await entry.getByRole('button',{name:'Apply to draft'}).click();await expect(entry).toContainText('Enter a whole duration');
 await days.fill('5');await entry.getByRole('button',{name:'Apply to draft'}).click();await expect(entry).toHaveCount(0);
});

test('autosave restores unfinished activity input and applied rows after reopening without manual save',async({page})=>{
 const saves=await setup(page,seed());await page.getByRole('button',{name:'Edit schedule',exact:true}).click();await page.getByRole('button',{name:'Add activity',exact:false}).click();
 let entry=page.getByRole('dialog',{name:'Schedule activity editor'});await entry.getByLabel('Activity name *').fill('Recover this unfinished entry');await entry.getByLabel('Duration (days)').fill('120');
 await expect.poll(()=>saves.at(-1)?.jobs[0]?.scheduleDraft?.editor?.name).toBe('Recover this unfinished entry');
 await page.reload();await page.getByRole('tab',{name:'Schedule',exact:true}).click();entry=page.getByRole('dialog',{name:'Schedule activity editor'});await expect(entry.getByLabel('Activity name *')).toHaveValue('Recover this unfinished entry');await expect(entry.getByLabel('Duration (days)')).toHaveValue('120');
 await entry.getByRole('button',{name:'Apply to draft'}).click();await expect.poll(()=>saves.at(-1)?.jobs[0]?.scheduleDraft?.tasks.at(-1)?.name).toBe('Recover this unfinished entry');
 expect(saves.at(-1).jobs[0].schedule.revision).toBe(1);expect(saves.at(-1).jobs[0].schedule.revisions).toHaveLength(1);
 await page.reload();await page.getByRole('tab',{name:'Schedule',exact:true}).click();await expect(page.locator('.schedule-task-name').filter({hasText:'Recover this unfinished entry'})).toBeVisible();await expect(page.getByRole('dialog',{name:'Schedule activity editor'})).toHaveCount(0);
});
test('competing autosaved schedule drafts conflict rather than combining their dates',()=>{
 const original=fixture(seed());original.jobs[0].scheduleDraft={tasks:seed().tasks,editor:null,durationInput:null,note:'',baseSchedule:JSON.stringify(seed())};const local=structuredClone(original),remote=structuredClone(original);
 local.jobs[0].scheduleDraft.tasks[0].start='2026-10-12';remote.jobs[0].scheduleDraft.note='Changed on another device';expect(merge(original,local,remote).state).toBeNull();
});

test('downloading locks one revision; repeated autosaves stay in the next working revision',async({page},testInfo)=>{
 const original=seed();const saves=await setup(page,original);await page.getByRole('button',{name:'Edit schedule',exact:true}).click();const editor=await editFirstActivity(page);
 await editor.getByLabel('Activity name *').fill('Revised shop drawings');await editor.getByRole('button',{name:'Apply to draft'}).click();await expect.poll(()=>saves.at(-1)?.jobs[0]?.scheduleDraft?.tasks[0]?.name).toBe('Revised shop drawings');
 expect(saves.at(-1).jobs[0].schedule.revision).toBe(1);expect(saves.at(-1).jobs[0].schedule.revisions).toEqual(original.revisions);
 const pdf=await downloadSchedulePdf(page,await openSchedulePdf(page));expect(pdf.suggestedFilename()).toBe('26999 Job Schedule Rev 2.pdf');await pdf.saveAs(testInfo.outputPath('locked-revision2.pdf'));
 await expect.poll(()=>saves.at(-1)?.jobs[0]?.schedule?.revision).toBe(2);const locked=saves.at(-1).jobs[0].schedule;expect(locked.revisions[0]).toEqual(original.revisions[0]);expect(locked.revisions[1].tasks[0].name).toBe('Revised shop drawings');expect(saves.at(-1).jobs[0].scheduleDraft).toBeUndefined();
 await page.getByRole('button',{name:'Edit schedule',exact:true}).click();const nextEditor=await editFirstActivity(page);await nextEditor.getByLabel('Duration (days)').fill('120');await page.getByRole('button',{name:'Apply to draft'}).click();await expect.poll(()=>saves.at(-1)?.jobs[0]?.scheduleDraft?.tasks[0]?.finish).toBe('2027-03-19');expect(saves.at(-1).jobs[0].schedule).toEqual(locked);
 await page.reload();await page.getByRole('tab',{name:'Schedule',exact:true}).click();await expect(page.locator('.schedule-facts')).toContainText('Rev 3');expect(saves.at(-1).jobs[0].schedule).toEqual(locked);
});

for(const [name,count,span,noteLines,onePage] of [['small',4,21,0,true],['medium',24,100,0,true],['year',8,300,0,true],['huge',70,110,0,false],['notes',3,21,90,false]])test(`PDF adaptive single-page layout ${name}`,async({},testInfo)=>{
 const tasks=Array.from({length:count},(_,i)=>activity('fit'+i,'Activity '+i,'2026-10-05',w.addDays('2026-10-05',span),{calendar:'calendar',phase:i<count/2?'Preparation':'Finishes',owner:'JGC',notes:i===0?Array.from({length:noteLines},(_,n)=>'NOTE '+n+' - Preserve all scope and responsibility information.').join('\n'):''}));const schedule=w.commitSchedule(tasks,undefined,'Test Admin','Adaptive PDF'),state=fixture(schedule);const bytes=await load('job-schedule-pdf').buildSchedulePdf({job:state.jobs[0],state,schedule,logoBytes:fs.readFileSync(path.resolve(__dirname,'../estimating/jgc-logo-transparent.png'))});const doc=await require('../estimating-app/node_modules/pdf-lib').PDFDocument.load(bytes);if(onePage)expect(doc.getPageCount()).toBe(1);else expect(doc.getPageCount()).toBeGreaterThan(1);fs.writeFileSync(testInfo.outputPath(name+'.pdf'),bytes);
 const pdfjs=await import(require('node:url').pathToFileURL(path.resolve(__dirname,'../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);const parsed=await pdfjs.getDocument({data:new Uint8Array(bytes),disableWorker:true}).promise;let text='';for(let n=1;n<=parsed.numPages;n++){const page=await parsed.getPage(n);text+=(await page.getTextContent()).items.map(i=>i.str).join(' ');}for(let i=0;i<count;i++)expect(text).toContain('Activity '+i);if(noteLines)expect(text).toContain('NOTE '+(noteLines-1));expect(text).toContain('Example Client');expect(text).toContain('123 Example Street');
});
for(const [mode,from,to,first,last] of [
 ['Day','2026-10-07','','2026-10-07','2026-10-07'],
 ['Week','2026-10-07','','2026-10-04','2026-10-10'],
 ['Month','2028-02-15','','2028-02-01','2028-02-29'],
 ['Year','2026-10-05','','2026-01-01','2026-12-31'],
 ['Custom dates','2026-10-08','2026-10-12','2026-10-08','2026-10-12']
])test('schedule PDF date range '+mode,async({page},testInfo)=>{
 const schedule=seed();schedule.tasks[0].progress=100;
 await setup(page,schedule);
 await expect(page.locator('.schedule-day-head .schedule-weekday').first()).toHaveText('S');
 expect(await page.locator('.schedule-day-head .schedule-weekday').allTextContents().then(days=>days.slice(0,7))).toEqual(['S','M','T','W','T','F','S']);
 const dialog=await openSchedulePdf(page);
 await dialog.getByRole('radio',{name:mode,exact:true}).check();
 if(mode==='Month')await dialog.getByRole('combobox',{name:'Month',exact:true}).selectOption(from.slice(5,7));
 if(mode==='Month'||mode==='Year'){
  await dialog.getByRole('spinbutton',{name:'Year',exact:true}).fill(from.slice(0,4));
 }else{
  const field=mode==='Custom dates'?'Start date':mode==='Week'?'Jump to a week':'Date';
  await dialog.getByLabel(field,{exact:true}).fill(from);
 }
 if(mode==='Custom dates')await dialog.getByLabel('End date',{exact:true}).fill(to);
 const format=new Intl.DateTimeFormat('en-CA',{dateStyle:'medium',timeZone:'UTC'}),fromDate=new Date(first),toDate=new Date(last);
 const dates=first===last?first:first+' to '+last;
 await expect(dialog.locator('.schedule-pdf-includes strong')).toHaveText(first===last?format.format(fromDate):format.formatRange(fromDate,toDate));
 if(mode==='Month')await expect(dialog).toContainText('No activities scheduled in this range');
 const file=await downloadSchedulePdf(page,dialog);
 expect(file.suggestedFilename()).toBe('26999 Job Schedule Rev 1 '+dates+'.pdf');
 const dest=testInfo.outputPath(mode+'.pdf');await file.saveAs(dest);
 const pdfjs=await import(require('node:url').pathToFileURL(path.resolve(__dirname,'../estimating-app/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
 const loading=pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(dest))});const doc=await loading.promise;
 const firstPage=await doc.getPage(1);const text=(await firstPage.getTextContent()).items.map(i=>i.str).join(' ');
 expect(text).toContain('Timeline '+dates);
 if(mode==='Week')expect(text).toMatch(/S\s+4\s+M\s+5\s+T\s+6\s+W\s+7\s+T\s+8\s+F\s+9\s+S\s+10/);
 expect(text).toContain('Completed');expect(text).toContain('Remaining');
 if(mode==='Month')expect(text).toContain('No scheduled activities');
 else expect(text).toContain('100%');
 if(mode==='Day'||mode==='Week'||mode==='Custom dates')expect(text).not.toContain('Painting');
 await loading.destroy();
});

test('phone PDF picker shows the selected dates, steps through periods and cancels without saving',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:844});
  await page.clock.setFixedTime(new Date('2026-10-07T16:00:00Z'));
  const saves=await setup(page,seed());
  const trigger=page.getByRole('button',{name:'Download schedule PDF',exact:true});
  const dialog=await openSchedulePdf(page);
  const range=dialog.locator('.schedule-pdf-includes strong');
  await expect(dialog.getByRole('radio',{name:'Full schedule'})).toBeChecked();
  await expect(range).toHaveText(/Oct 4\D+24, 2026/);
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('radio',{name:'Day',exact:true})).toBeChecked();
  await expect(range).toHaveText('Oct 7, 2026');

  await dialog.getByRole('radio',{name:'Week',exact:true}).check();
  await expect(range).toHaveText(/Oct 4\D+10, 2026/);
  await dialog.getByRole('button',{name:'Next week'}).click();
  await expect(range).toHaveText(/Oct 11\D+17, 2026/);
  await dialog.getByRole('button',{name:'This week'}).click();
  await expect(range).toHaveText(/Oct 4\D+10, 2026/);
  await dialog.screenshot({path:testInfo.outputPath('weekly-pdf-picker-phone.png')});

  await dialog.getByRole('radio',{name:'Month',exact:true}).check();
  await dialog.getByRole('combobox',{name:'Month',exact:true}).selectOption('01');
  await dialog.getByRole('button',{name:'Previous month'}).click();
  await expect(dialog.getByRole('spinbutton',{name:'Year',exact:true})).toHaveValue('2025');
  await expect(range).toHaveText(/Dec 1\D+31, 2025/);
  await dialog.getByRole('button',{name:'This month'}).click();
  await expect(range).toHaveText(/Oct 1\D+31, 2026/);

  await dialog.getByRole('radio',{name:'Custom dates',exact:true}).check();
  await dialog.getByLabel('Start date',{exact:true}).fill('2026-10-30');
  await expect(dialog.getByLabel('End date',{exact:true})).toHaveValue('2026-10-30');
  await dialog.getByLabel('End date',{exact:true}).fill('2026-10-29');
  await expect(range).toContainText('Choose an end date on or after the start date.');
  await expect(dialog.getByRole('button',{name:'Download PDF',exact:true})).toBeDisabled();
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(saves).toHaveLength(0);
});
