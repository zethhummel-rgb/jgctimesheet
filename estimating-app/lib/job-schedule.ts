export type ScheduleCalendar = 'weekdays' | 'calendar';
export interface ScheduleTask {
  id: string;
  name: string;
  phase: string;
  owner: string;
  start: string;
  finish: string;
  calendar: ScheduleCalendar;
  progress: number | null;
  predecessorId: string;
  lag: number;
  notes: string;
}
export interface ScheduleRevision { id: string; at: string; actor: string; number: number; tasks: ScheduleTask[]; note: string }
export interface JobSchedule { version: 1; revision: number; tasks: ScheduleTask[]; revisions: ScheduleRevision[] }
export const scheduleToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const DAY = 86400000;
export function dateNumber(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const n = Date.parse(value+'T00:00:00Z');
  return Number.isFinite(n) && new Date(n).toISOString().slice(0,10)===value ? n/DAY : NaN;
}
export const dateString = (n: number) => new Date(n*DAY).toISOString().slice(0,10);
export const addDays = (date: string, days: number) => dateString(dateNumber(date)+days);
export const weekend = (n: number) => [0,6].includes(new Date(n*DAY).getUTCDay());
export function nextWorkday(start: string, calendar: ScheduleCalendar) {
  let n=dateNumber(start);
  if (!Number.isFinite(n)) return start;
  while (calendar==='weekdays' && weekend(n)) n++;
  return dateString(n);
}
export function duration(task: Pick<ScheduleTask,'start'|'finish'|'calendar'>) {
  const start=dateNumber(task.start),finish=dateNumber(task.finish);
  if (!Number.isFinite(start)||!Number.isFinite(finish)||finish<start||finish-start>3650) return 0;
  if (task.calendar==='calendar') return finish-start+1;
  let days=0;
  for (let n=start;n<=finish;n++) if (!weekend(n)) days++;
  return days;
}
export function finishFor(start: string, days: number, calendar: ScheduleCalendar) {
  let n=dateNumber(nextWorkday(start,calendar));
  if (!Number.isFinite(n)) return start;
  let remaining=Math.max(1,Math.min(2600,Math.round(days)))-1;
  while (remaining>0) { n++; if(calendar==='calendar'||!weekend(n)) remaining--; }
  return dateString(n);
}
export function moveTask(task: ScheduleTask, start: string) {
  start=nextWorkday(start,task.calendar);
  return {...task,start,finish:finishFor(start,duration(task)||1,task.calendar)};
}
export function blankTask(start=scheduleToday(),phase='Preparation'): ScheduleTask {
  start=nextWorkday(start,'weekdays');
  return {id:crypto.randomUUID(),name:'',phase,owner:'',start,finish:finishFor(start,5,'weekdays'),calendar:'weekdays',progress:null,predecessorId:'',lag:0,notes:''};
}
export function validateTask(task: ScheduleTask, tasks: ScheduleTask[]) {
  const errors:Record<string,string>={};
  if (!task.name.trim()) errors.name='An activity name is required.';
  if (!task.phase.trim()) errors.phase='A phase is required.';
  if (!Number.isFinite(dateNumber(task.start))) errors.start='A valid start date is required.';
  if (!Number.isFinite(dateNumber(task.finish))) errors.finish='A valid finish date is required.';
  if (task.finish<task.start) errors.finish='Finish must be on or after start.';
  if (task.calendar!=='calendar'&&task.calendar!=='weekdays') errors.calendar='Choose weekdays or calendar days.';
  if (task.calendar==='weekdays' && (weekend(dateNumber(task.start))||weekend(dateNumber(task.finish)))) errors.calendar='Weekday activities must start and finish Monday to Friday. Use Calendar days for weekend work or curing.';
  if (!duration(task)||dateNumber(task.finish)-dateNumber(task.start)>3650) errors.finish='Enter a duration between 1 day and 10 years.';
  if (task.progress!==null && (!Number.isFinite(task.progress)||task.progress<0||task.progress>100)) errors.progress='Progress must be between 0 and 100, or leave blank.';
  if (!Number.isInteger(task.lag)||task.lag<0||task.lag>365) errors.lag='Waiting time must be between 0 and 365 calendar days.';
  const byId=new Map(tasks.map(t=>[t.id,t]));byId.set(task.id,task);
  const seen=new Set([task.id]);let id=task.predecessorId;
  while (id) {
    if (seen.has(id)) { errors.predecessorId='This link would make a circular schedule. Choose another activity.';break; }
    seen.add(id);const prior=byId.get(id);
    if (!prior) { errors.predecessorId='The preceding activity no longer exists. Remove or replace the link.';break; }
    id=prior.predecessorId;
  }
  return errors;
}
// A finish-to-start link is explicit. Parallel, unlinked activities keep their dates.
export function reflowTasks(tasks: ScheduleTask[]) {
  const byId=new Map(tasks.map(t=>[t.id,t])),done=new Map<string,ScheduleTask>(),visiting=new Set<string>();
  function resolve(id:string):ScheduleTask {
    const cached=done.get(id);if(cached)return cached;
    const task=byId.get(id);if(!task)throw new Error('A linked activity is missing.');
    if(visiting.has(id))throw new Error('Remove the circular activity link before saving.');
    visiting.add(id);
    const prior=task.predecessorId?resolve(task.predecessorId):null;
    const result=prior?moveTask(task,addDays(prior.finish,task.lag+1)):task;
    visiting.delete(id);done.set(id,result);return result;
  }
  return tasks.map(t=>resolve(t.id));
}
export function scheduleRows(tasks: ScheduleTask[]) {
  const phases=[...new Set(tasks.map(t=>t.phase))];
  return phases.flatMap((phase,index)=> {
    const items=tasks.filter(t=>t.phase===phase);
    return [{kind:'phase' as const,phase,index,start:items.reduce((s,t)=>t.start<s?t.start:s,items[0].start),finish:items.reduce((s,t)=>t.finish>s?t.finish:s,items[0].finish)},
      ...items.map((task,i)=>({kind:'task' as const,task,phase,index,number:`${index+1}.${i+1}`}))];
  });
}
export function scheduleRange(tasks: ScheduleTask[]) {
  const starts=tasks.map(t=>dateNumber(t.start)).filter(Number.isFinite),ends=tasks.map(t=>dateNumber(t.finish)).filter(Number.isFinite);
  const start=starts.length?Math.min(...starts):dateNumber(scheduleToday()),finish=ends.length?Math.max(...ends):start+27;
  return {start,finish,days:finish-start+1};
}
export function commitSchedule(tasks: ScheduleTask[],previous: JobSchedule|undefined,actor:string,note:string):JobSchedule {
  if (!tasks.length) throw new Error('Add at least one activity before saving the schedule.');
  const ids=new Set<string>();
  for (const t of tasks) {
    const errors=validateTask(t,tasks);
    if(ids.has(t.id))throw new Error('Activity IDs must be unique.');ids.add(t.id);
    if(Object.keys(errors).length)throw new Error(`${t.name||'Activity'}: ${Object.values(errors)[0]}`);
  }
  const revision=(previous?.revision||0)+1,at=new Date().toISOString(),clean=reflowTasks(tasks).map(t=>({...t,name:t.name.trim(),phase:t.phase.trim(),owner:t.owner.trim(),notes:t.notes.trim()}));
  return {version:1,revision,tasks:clean,revisions:[...(previous?.revisions||[]),{id:crypto.randomUUID(),at,actor,number:revision,tasks:structuredClone(clean),note:note.trim()}]};
}
export function schedulePersistenceError(base:{jobs:{id:string;schedule?:JobSchedule}[]}|null,next:{jobs:{id:string;schedule?:JobSchedule}[]}) {
  for (const job of next.jobs) {
    const old=base?.jobs.find(j=>j.id===job.id)?.schedule,value=job.schedule;
    if(JSON.stringify(old)===JSON.stringify(value))continue;
    if(!value || value.version!==1 || value.revision!==(old?.revision||0)+1) return 'This schedule changed in another browser. Keep a copy of your draft, then reload the latest schedule before saving.';
    if(!Array.isArray(value.tasks)||!value.tasks.length||!Array.isArray(value.revisions)) return 'A complete schedule is required.';
    if(new Set(value.tasks.map(t=>t.id)).size!==value.tasks.length)return 'Activity IDs must be unique.';
    for(const task of value.tasks)if(Object.keys(validateTask(task,value.tasks)).length)return 'Correct the schedule activity dates and links before saving.';
    if(JSON.stringify(reflowTasks(value.tasks))!==JSON.stringify(value.tasks))return 'Linked activity dates must follow their predecessor.';
    if(value.revisions.length!==(old?.revisions.length||0)+1||JSON.stringify(value.revisions.slice(0,-1))!==JSON.stringify(old?.revisions||[])||JSON.stringify(value.revisions.at(-1)?.tasks)!==JSON.stringify(value.tasks))return 'Saved schedule revisions must remain unchanged.';
  }
  return '';
}
