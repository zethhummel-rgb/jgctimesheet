import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { AppState, Job } from '../lib/estimator-data';
import { addDays, blankTask, commitSchedule, dateNumber, dateString, duration, finishFor, moveTask, nextWorkday, reflowTasks, scheduleRange, scheduleRows, scheduleToday, validateTask, weekend, type ScheduleTask } from '../lib/job-schedule';
import './job-schedule.css';

const tones=['#197451','#286b9e','#7857a3','#a16918','#387d80','#a55555'];
const format=(v:string)=>new Date(v+'T12:00:00').toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'});
const shortDate=(n:number)=>new Date(n*86400000).toLocaleDateString('en-CA',{month:'short',day:'numeric',timeZone:'UTC'});
function download(data:Blob,name:string) { const url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000); }

export function JobSchedule({job,state,setState,actor,workspaceSaved}:{job:Job;state:AppState;setState:React.Dispatch<React.SetStateAction<AppState>>;actor:string;workspaceSaved:boolean}) {
  const saved=job.schedule;
  const [draft,setDraft]=useState<ScheduleTask[]|null>(null),[editor,setEditor]=useState<ScheduleTask|null>(null),[errors,setErrors]=useState<Record<string,string>>({});
  const [message,setMessage]=useState(''),[note,setNote]=useState(''),[zoom,setZoom]=useState('Weeks'),[exporting,setExporting]=useState(false),[detail,setDetail]=useState<ScheduleTask|null>(null);
  const [undo,setUndo]=useState<ScheduleTask[][]>([]),[width,setWidth]=useState(900),[collapsed,setCollapsed]=useState<string[]>([]);
  const scroller=useRef<HTMLDivElement>(null),base=useRef(''),saving=useRef(false);
  const gesture=useRef<{task:ScheduleTask;x:number;resize:boolean;days:number;before:ScheduleTask[]}|null>(null);
  const tasks=draft??saved?.tasks??[],editing=draft!==null,dirty=editing&&JSON.stringify(draft)!==JSON.stringify(saved?.tasks??[]);
  const range=scheduleRange(tasks),rows=scheduleRows(tasks),phases=rows.filter(r=>r.kind==='phase');
  const dayWidth=zoom==='Days'?34:zoom==='Weeks'?18:zoom==='Months'?5:Math.max(2,(width-(window.matchMedia('(max-width:760px)').matches?190:330))/Math.max(14,range.days+6));
  const origin=range.start-2,totalDays=Math.max(14,range.days+6),timelineWidth=totalDays*dayWidth;
  const today=dateNumber(scheduleToday()),todayLeft=(today-origin)*dayWidth;
  const syncPending=!workspaceSaved;
  useEffect(()=> {
    const element=scroller.current;if(!element)return;
    const observer=new ResizeObserver(entries=>setWidth(entries[0].contentRect.width));observer.observe(element);return()=>observer.disconnect();
  },[Boolean(tasks.length)]);
  useEffect(()=> {
    if(!editor&&!detail)return;
    const modal=document.querySelector<HTMLElement>('.schedule-modal');
    const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';modal?.querySelector<HTMLElement>('input,button')?.focus();
    const keys=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setEditor(null);setDetail(null);}
      if(event.key==='Tab'&&modal){const items=[...modal.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,textarea')].filter(e=>e.offsetParent!==null),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    };
    window.addEventListener('keydown',keys);
    return()=>{document.body.style.overflow=overflow;window.removeEventListener('keydown',keys);previous?.focus();};
  },[Boolean(editor||detail)]);
  useEffect(()=> {
    if(!dirty)return;
    const prevent=(e:BeforeUnloadEvent)=>{e.preventDefault();};
    // Keep unsaved work reviewable when switching jobs or leaving this page.
    const leave=(e:MouseEvent)=>{const target=e.target as HTMLElement;const control=target.closest('a[href],button');if(!control||control.closest('.job-schedule')||control.closest('[role="tablist"],[role="tabpanel"]'))return;if(!window.confirm('This schedule has unsaved changes. Leave and discard them?')){e.preventDefault();e.stopPropagation();}};
    window.addEventListener('beforeunload',prevent);document.addEventListener('click',leave,true);
    return()=>{window.removeEventListener('beforeunload',prevent);document.removeEventListener('click',leave,true);};
  },[dirty]);
  const begin=()=>{base.current=JSON.stringify(saved);setDraft(structuredClone(saved?.tasks??[]));setUndo([]);setNote('');setMessage('');};
  const update=(next:ScheduleTask[])=>{setUndo(u=>[...u.slice(-19),structuredClone(tasks)]);setDraft(next);setMessage('');};
  const openEditor=(task?:ScheduleTask)=>{setErrors({});setEditor(task?structuredClone(task):blankTask(tasks[0]?.start||job.startDate||scheduleToday(),tasks.at(-1)?.phase||'Preparation'));};
  const apply=()=> {
    if(!editor)return;
    const issues=validateTask(editor,tasks);setErrors(issues);if(Object.keys(issues).length)return;
    try{update(reflowTasks(tasks.some(t=>t.id===editor.id)?tasks.map(t=>t.id===editor.id?editor:t):[...tasks,editor]));setEditor(null);}catch(e){setErrors({predecessorId:e instanceof Error?e.message:'The link could not be applied.'});}
  };
  const save=()=> {
    if(!draft||saving.current)return;
    if(!workspaceSaved){setMessage('Wait for All changes saved before saving the schedule.');return;}
    if(base.current!==JSON.stringify(job.schedule)){setMessage('This schedule changed while you were editing. Download your draft, then reopen the latest schedule.');return;}
    try{
      const schedule=commitSchedule(draft,saved,actor,note);saving.current=true;
      setState(s=>({...s,jobs:s.jobs.map(j=>j.id===job.id?{...j,schedule}:j)}));
      setDraft(null);setEditor(null);setMessage(`Revision ${schedule.revision} recorded. Wait for All changes saved before leaving.`);
      queueMicrotask(()=>{saving.current=false;});
    }catch(e){setMessage(e instanceof Error?e.message:'The schedule could not be saved.');}
  };
  const remove=(task:ScheduleTask)=>{
    const followers=tasks.filter(t=>t.predecessorId===task.id);
    if(!window.confirm(`Remove ${task.name}?${followers.length?' Following activities will keep their dates and their links will be removed.':''}`))return;
    update(tasks.filter(t=>t.id!==task.id).map(t=>t.predecessorId===task.id?{...t,predecessorId:'',lag:0}:t));setEditor(null);
  };
  const reorder=(task:ScheduleTask,delta:number)=>{const i=tasks.findIndex(t=>t.id===task.id),next=tasks.slice(),other=next[i+delta];if(!other)return;next[i]=other;next[i+delta]=task;update(next);};
  const startGesture=(event:PointerEvent<HTMLButtonElement>,task:ScheduleTask,resize=false)=> {
    if(!editing||(!resize&&task.predecessorId))return;
    event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current={task:structuredClone(task),x:event.clientX,resize,days:0,before:structuredClone(tasks)};
  };
  const drag=(event:PointerEvent<HTMLButtonElement>)=> {
    const g=gesture.current;if(!g)return;
    const days=Math.round((event.clientX-g.x)/dayWidth);if(days===g.days)return;g.days=days;
    let task:ScheduleTask;
    if(g.resize){let finish=addDays(g.task.finish,days);if(finish<g.task.start)finish=g.task.start;if(g.task.calendar==='weekdays'){while(weekend(dateNumber(finish)))finish=addDays(finish,days<0?-1:1);}task={...g.task,finish};}
    else task=moveTask(g.task,addDays(g.task.start,days));
    if(Object.keys(validateTask(task,g.before)).length)return;
    setDraft(reflowTasks(g.before.map(t=>t.id===task.id?task:t)));
  };
  const endGesture=()=>{const g=gesture.current;if(g&&g.days!==0)setUndo(u=>[...u.slice(-19),g.before]);gesture.current=null;};
  const exportPdf=async()=> {
    if(!saved||!workspaceSaved)return;setExporting(true);setMessage('');
    try{const {buildSchedulePdf}=await import('../lib/job-schedule-pdf');const response=await fetch(new URL('jgc-logo-transparent.png',document.baseURI));if(!response.ok)throw new Error('The JGC logo could not be loaded. Try again.');const bytes=await buildSchedulePdf({job,state,schedule:saved,logoBytes:new Uint8Array(await response.arrayBuffer())});download(new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),`${job.jobNumber} Job Schedule Rev ${saved.revision}.pdf`);}catch(e){setMessage(e instanceof Error?e.message:'The PDF could not be created.');}finally{setExporting(false);}
  };
  const field=(key:'name'|'phase'|'owner'|'start'|'finish'|'notes',label:string,type='text')=><label className={`field ${key==='name'||key==='notes'?'full':''}`}><span>{label}</span>{key==='notes'?<textarea rows={3} value={editor![key]} onChange={e=>setEditor({...editor!,[key]:e.target.value})}/>:<input aria-label={label} type={type} list={key==='phase'?'schedule-phase-options':undefined} aria-invalid={Boolean(errors[key])} value={editor![key]} onChange={e=>{const value=e.target.value;if(key==='start'&&Number.isFinite(dateNumber(value)))setEditor(moveTask(editor!,value));else setEditor({...editor!,[key]:value});}}/>}{errors[key]&&<small className="schedule-error">{errors[key]}</small>}</label>;
  const weeks:Array<{start:number;days:number}>=[];
  for(let offset=0;offset<totalDays;){const n=origin+offset,day=new Date(n*86400000).getUTCDay(),days=Math.min(day===1?7:(8-day)%7||7,totalDays-offset);weeks.push({start:n,days});offset+=days;}
  return <section className="job-schedule" aria-label="Job Schedule">
    <header className="schedule-heading"><div><p className="eyebrow">PROJECT TIMELINE · OPTIONAL</p><h2>Job Schedule</h2><p>Phases, activities and milestones for Job {job.jobNumber}.</p></div><div className="schedule-actions">
      {saved&&<button className="button secondary" disabled={exporting||editing||syncPending} onClick={()=>void exportPdf()}>{exporting?'Creating PDF…':'Download schedule PDF'}</button>}
      {!editing&&<button className="button primary" disabled={syncPending} onClick={begin}>{saved?'Edit schedule':'Create schedule'}</button>}
    </div></header>
    {message&&<p className="schedule-message" role="status">{message}</p>}
    {syncPending&&saved&&<p role="status" className="schedule-message">Schedule sync pending. Check All changes saved before leaving.</p>}
    {!editing&&!tasks.length?<div className="schedule-empty"><div className="schedule-empty-icon" aria-hidden="true">▤</div><h3>A clearer plan for this job</h3><p>Add phases and activities when a schedule would help. Jobs never need a schedule to be created or used.</p><p>Set dates, track progress, and download a clean JGC Gantt PDF.</p></div>:<>
      <div className="schedule-facts"><div><span>Planned start</span><strong>{tasks.length?format(dateString(range.start)):'—'}</strong></div><div><span>Planned finish</span><strong>{tasks.length?format(dateString(range.finish)):'—'}</strong></div><div><span>Activities / phases</span><strong>{tasks.length} / {phases.length}</strong></div><div><span>Saved revision</span><strong>{saved?`Rev ${saved.revision}`:'Not saved yet'}</strong></div></div>
      <div className="schedule-toolbar"><div className="schedule-zoom" role="group" aria-label="Schedule zoom">{['Days','Weeks','Months','Fit'].map(z=><button key={z} aria-pressed={zoom===z} onClick={()=>setZoom(z)}>{z}</button>)}</div><span className="schedule-hint">{editing?'Drag a bar to move it; drag its right edge to change duration. Or open an activity to enter dates.':'Open an activity to view its details and notes.'}</span>{editing&&<div className="schedule-actions"><button className="button secondary compact" disabled={!undo.length} onClick={()=>{setDraft(undo.at(-1)!);setUndo(u=>u.slice(0,-1));}}>Undo</button><button className="button primary compact" onClick={()=>openEditor()}>＋ Add activity</button></div>}</div>
      {!!tasks.length&&<div className="schedule-scroll" ref={scroller} tabIndex={0} aria-label="Gantt timeline. Scroll horizontally to see more dates.">
        <div className="schedule-grid" style={{'--timeline-width':`${timelineWidth}px`,'--day-width':`${dayWidth}px`} as CSSProperties}>
          <div className="schedule-row schedule-grid-head"><div className="schedule-label"><span>ACTIVITY / RESPONSIBILITY</span><span>DATES · DAYS · PROGRESS</span></div><div className="schedule-time-head"><div className="schedule-weeks">{weeks.map(w=><div key={w.start} style={{width:w.days*dayWidth}}>{shortDate(w.start)}</div>)}</div><div className="schedule-day-head">{Array.from({length:totalDays},(_,i)=><span key={i} className={weekend(origin+i)?'weekend':''} style={{width:dayWidth}}>{dayWidth>=16?new Date((origin+i)*86400000).getUTCDate():''}</span>)}</div></div></div>
          {rows.filter(r=>r.kind==='phase'||!collapsed.includes(r.phase)).map(r=>r.kind==='phase'?<div className="schedule-row schedule-phase-row" key={`phase-${r.phase}`} style={{'--phase-color':tones[r.index%tones.length]} as CSSProperties}>
            <button className="schedule-label" aria-expanded={!collapsed.includes(r.phase)} onClick={()=>setCollapsed(c=>c.includes(r.phase)?c.filter(p=>p!==r.phase):[...c,r.phase])}><span>{collapsed.includes(r.phase)?'▸':'▾'} {r.index+1}. {r.phase}</span><small>{tasks.filter(t=>t.phase===r.phase).length} activities</small></button><div className="schedule-track"><div className="schedule-summary-bar" style={{left:(dateNumber(r.start)-origin)*dayWidth,width:(dateNumber(r.finish)-dateNumber(r.start)+1)*dayWidth}}/></div>
          </div>:<div className="schedule-row" key={r.task.id} style={{'--phase-color':tones[r.index%tones.length]} as CSSProperties}>
            <div className="schedule-label schedule-task-label"><button className="schedule-task-name" onClick={()=>editing?openEditor(r.task):setDetail(r.task)}><strong><span>{r.number}</span> {r.task.name}</strong><small>{r.task.owner||'Responsibility not assigned'}</small><small>{shortDate(dateNumber(r.task.start))} → {shortDate(dateNumber(r.task.finish))} · {duration(r.task)} {r.task.calendar==='weekdays'?'working':'calendar'} days · {r.task.progress===null?'Progress not entered':`${r.task.progress}%`}{r.task.predecessorId?' · Linked':''}</small></button>{editing&&<div className="schedule-order"><button aria-label={`Move ${r.task.name} up`} disabled={tasks[0].id===r.task.id} onClick={()=>reorder(r.task,-1)}>↑</button><button aria-label={`Move ${r.task.name} down`} disabled={tasks.at(-1)?.id===r.task.id} onClick={()=>reorder(r.task,1)}>↓</button></div>}</div>
            <div className="schedule-track">{Array.from({length:Math.min(totalDays,3660)},(_,i)=>weekend(origin+i)?<span className="schedule-weekend" key={i} style={{left:i*dayWidth,width:dayWidth}}/>:null)}
              {todayLeft>=0&&todayLeft<=timelineWidth&&<span className="schedule-today" style={{left:todayLeft}} title="Today"/>}
              <div className={`schedule-bar-wrap ${editing?'is-editing':''}`} style={{left:(dateNumber(r.task.start)-origin)*dayWidth,width:Math.max(6,(dateNumber(r.task.finish)-dateNumber(r.task.start)+1)*dayWidth)}}>
                <button className="schedule-bar" aria-label={`${r.task.name}: ${format(r.task.start)} to ${format(r.task.finish)}${editing?' (drag to move)':''}`} title={`${r.task.name}\n${format(r.task.start)} – ${format(r.task.finish)}\n${r.task.notes}`} onPointerDown={e=>startGesture(e,r.task)} onPointerMove={drag} onPointerUp={endGesture} onPointerCancel={endGesture} onClick={()=>{if(!editing)setDetail(r.task);}}><span className="schedule-progress" style={{width:`${r.task.progress??0}%`}}/><span>{r.task.name}</span></button>
                {editing&&<button className="schedule-resize" aria-label={`Resize ${r.task.name}`} title="Drag to change finish date" onPointerDown={e=>startGesture(e,r.task,true)} onPointerMove={drag} onPointerUp={endGesture} onPointerCancel={endGesture}>⋮</button>}
              </div>
            </div>
          </div>)}
        </div>
      </div>}
      {editing&&!tasks.length&&<div className="schedule-empty"><h3>Start with your first activity</h3><p>Enter a name, phase and dates. Responsibility and progress are optional.</p><button className="button primary" onClick={()=>openEditor()}>＋ Add first activity</button></div>}
      {!!tasks.length&&<div className="schedule-legend">{phases.map(p=><span key={p.phase}><i style={{background:tones[p.index%tones.length]}}/>{p.phase}</span>)}<span><i className="weekend"/>Weekend</span><span><i className="today"/>Today</span></div>}
      {editing&&<footer className="schedule-save-bar"><label className="field"><span>Revision note <small>Optional</small></span><input value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. Revised flooring dates"/></label><div className="schedule-actions"><button className="button secondary" onClick={()=>download(new Blob([JSON.stringify({jobNumber:job.jobNumber,tasks:draft},null,2)],{type:'application/json'}),`${job.jobNumber} Schedule Draft.json`)}>Download draft</button><button className="button secondary" onClick={()=>{if(dirty&&!window.confirm('Discard these unsaved schedule changes?'))return;setDraft(null);setEditor(null);}}>Cancel editing</button><button className="button primary" disabled={!tasks.length||syncPending||!!editor} onClick={save}>Save schedule</button></div><small>Changes stay in this draft until saved. Schedule dates do not change Project Details or calendar appointments.</small></footer>}
      {saved&&<details className="schedule-history"><summary>Saved revisions ({saved.revisions.length})</summary>{saved.revisions.slice().reverse().map(rev=><article key={rev.id}><div><strong>Revision {rev.number}</strong><small>{new Date(rev.at).toLocaleString()} · {rev.actor} · {rev.tasks.length} activities</small>{rev.note&&<p>{rev.note}</p>}</div><button className="button secondary compact" disabled={editing||syncPending} onClick={()=>{begin();setDraft(structuredClone(rev.tasks));setNote(`Based on revision ${rev.number}`);setMessage('Earlier dates loaded into a draft. Review and save as a new revision.');}}>Use dates in new revision</button></article>)}</details>}
    </>}
    {(editor||detail)&&<div className="schedule-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget){if(editor)setEditor(null);else setDetail(null);}}}><section className="schedule-modal" role="dialog" aria-modal="true" aria-label={editor?'Schedule activity editor':'Activity details'}>
      <header><div><p className="eyebrow">{editor?'SCHEDULE ACTIVITY':'ACTIVITY DETAILS'}</p><h3>{editor?(tasks.some(t=>t.id===editor.id)?'Edit activity':'New activity'):detail!.name}</h3></div><button className="button secondary compact" aria-label="Close activity" onClick={()=>{setEditor(null);setDetail(null);}}>✕</button></header>
      {editor?<><div className="schedule-fields">{field('name','Activity name *')}{field('phase','Phase *')}<datalist id="schedule-phase-options">{phases.map(p=><option value={p.phase} key={p.phase}/>)}</datalist>{field('owner','Responsibility / trade')}{field('start','Start date *','date')}{field('finish','Finish date *','date')}
        <label className="field"><span>Duration (days)</span><input aria-label="Duration (days)" type="number" min={1} max={2600} value={duration(editor)||''} onChange={e=>{const days=Number(e.target.value);if(days>=1&&days<=2600)setEditor({...editor,finish:finishFor(editor.start,days,editor.calendar)});}}/></label>
        <label className="field"><span>Count days as</span><select aria-label="Count days as" value={editor.calendar} onChange={e=>{const calendar=e.target.value as ScheduleTask['calendar'],start=nextWorkday(editor.start,calendar);setEditor({...editor,calendar,start,finish:finishFor(start,duration(editor)||1,calendar)});}}><option value="weekdays">Working days (Mon–Fri)</option><option value="calendar">Calendar days (includes weekends)</option></select>{errors.calendar&&<small className="schedule-error">{errors.calendar}</small>}</label>
        <p className="schedule-hint full">Working days skip weekends. Holidays are not automatically excluded. Use calendar days for curing or weekend work.</p>
        <label className="field"><span>Progress (%) <small>Optional</small></span><input aria-label="Progress (%)" type="number" min={0} max={100} placeholder="Not entered" value={editor.progress??''} onChange={e=>setEditor({...editor,progress:e.target.value===''?null:Number(e.target.value)})}/>{errors.progress&&<small className="schedule-error">{errors.progress}</small>}</label>
        <label className="field"><span>Start after activity <small>Optional</small></span><select aria-label="Start after activity" aria-invalid={Boolean(errors.predecessorId)} value={editor.predecessorId} onChange={e=>setEditor({...editor,predecessorId:e.target.value})}><option value="">Independent / no link</option>{tasks.filter(t=>t.id!==editor.id).map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select>{errors.predecessorId&&<small className="schedule-error">{errors.predecessorId}</small>}</label>
        {editor.predecessorId&&<><label className="field"><span>Waiting time after finish</span><input aria-label="Waiting time after finish" type="number" min={0} max={365} value={editor.lag} onChange={e=>setEditor({...editor,lag:Number(e.target.value)})}/>{errors.lag&&<small className="schedule-error">{errors.lag}</small>}</label><p className="schedule-hint full">Starts after the preceding activity finishes, plus this many calendar days. Linked dates update together when you apply changes.</p></>}{field('notes','Activity notes')}
      </div><footer><div>{tasks.some(t=>t.id===editor.id)&&<button className="button secondary" onClick={()=>remove(editor)}>Remove activity</button>}</div><div className="schedule-actions"><button className="button secondary" onClick={()=>setEditor(null)}>Cancel</button><button className="button primary" onClick={apply}>Apply to draft</button></div></footer></>:<><dl className="schedule-detail"><dt>Phase</dt><dd>{detail!.phase}</dd><dt>Responsibility / trade</dt><dd>{detail!.owner||'Not entered'}</dd><dt>Dates</dt><dd>{format(detail!.start)} – {format(detail!.finish)}</dd><dt>Duration</dt><dd>{duration(detail!)} {detail!.calendar==='weekdays'?'working':'calendar'} days</dd><dt>Progress</dt><dd>{detail!.progress===null?'Not entered':`${detail!.progress}%`}</dd><dt>Starts after</dt><dd>{tasks.find(t=>t.id===detail!.predecessorId)?.name||'Independent activity'}</dd><dt>Notes</dt><dd>{detail!.notes||'No notes entered'}</dd></dl><footer><span/><button className="button secondary" onClick={()=>setDetail(null)}>Close details</button></footer></>}
    </section></div>}
  </section>;
}
