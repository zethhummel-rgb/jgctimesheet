export const rfiStatuses = ['Draft', 'Open / Sent', 'Answered', 'Closed'] as const;
export type RfiStatus = typeof rfiStatuses[number];
export interface RfiAttachment { id: string; label: string; url: string }
export interface RfiDetails {
  subject: string; createdDate: string; sentDate: string; raisedBy: string; sentTo: string;
  question: string; references: string; dueDate: string; status: RfiStatus;
  responder: string; responseDate: string; answer: string; attachments: RfiAttachment[];
}
export interface RfiEvent { id: string; at: string; actor: string; action: string; note: string; details: RfiDetails }
export interface Rfi extends RfiDetails { id: string; number: string; cycle: number; history: RfiEvent[]; createdAt: string; updatedAt: string }
export const rfiToday = () => { const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export const rfiOutstanding = (r: RfiDetails) => r.status === 'Open / Sent';
export const rfiOverdue = (r: RfiDetails, today=rfiToday()) => rfiOutstanding(r) && Boolean(r.dueDate && r.dueDate<today);
export const rfiLink = (url: string) => { try {return new URL(url.trim()).protocol==='https:'?url.trim():'';}catch{return '';} };
export function blankRfi(actor: string): RfiDetails {return {subject:'',createdDate:rfiToday(),sentDate:'',raisedBy:actor,sentTo:'',question:'',references:'',dueDate:'',status:'Draft',responder:'',responseDate:'',answer:'',attachments:[]};}
export function rfiDetails(r: RfiDetails): RfiDetails {return {subject:r.subject,createdDate:r.createdDate,sentDate:r.sentDate,raisedBy:r.raisedBy,sentTo:r.sentTo,question:r.question,references:r.references,dueDate:r.dueDate,status:r.status,responder:r.responder,responseDate:r.responseDate,answer:r.answer,attachments:r.attachments.map(a=>({...a}))};}
export function nextRfiNumber(records: Rfi[]) {return `RFI-${String(Math.max(0,...records.map(r=>Number(/^RFI-(\d+)$/.exec(r.number)?.[1])||0))+1).padStart(3,'0')}`;}
export function validateRfi(d: RfiDetails, previous?: Rfi, reopen=false, note=''): Record<string,string> {
  const errors:Record<string,string>={};
  if(!d.subject.trim())errors.subject='Subject is required.';
  if(!d.createdDate)errors.createdDate='Created date is required.';
  if(!d.raisedBy.trim())errors.raisedBy='Raised by is required.';
  if(d.status!=='Draft'){
    if(!d.question.trim())errors.question='Question or clarification request is required.';
    if(!d.sentTo.trim())errors.sentTo='Sent to is required.';
    if(!d.sentDate)errors.sentDate='Sent date is required.';
  }
  if(d.status==='Answered'||d.status==='Closed'){
    if(!d.answer.trim())errors.answer='Complete answer is required.';
    if(!d.responder.trim())errors.responder='Responder is required.';
    if(!d.responseDate)errors.responseDate='Response date is required.';
  }
  if(d.sentDate && d.createdDate && d.sentDate<d.createdDate)errors.sentDate='Sent date cannot precede creation.';
  if(d.dueDate && d.dueDate<(d.sentDate||d.createdDate))errors.dueDate='Due date cannot precede creation or sending.';
  if(d.responseDate && d.sentDate && d.responseDate<d.sentDate)errors.responseDate='Response date cannot precede sending.';
  if(d.attachments.some(a=>!a.label.trim()||!rfiLink(a.url)))errors.attachments='Each attachment needs a name and a secure https:// file link, or remove the empty row.';
  const rank=(s:RfiStatus)=>rfiStatuses.indexOf(s);
  if(previous && !reopen && rank(d.status)<rank(previous.status))errors.status='Use Reopen / follow up to return this RFI to Open / Sent.';
  if(reopen && (!previous || !['Answered','Closed'].includes(previous.status) || d.status!=='Open / Sent'))errors.status='Only an answered or closed RFI can be reopened.';
  if(reopen && !note.trim())errors.note='A follow-up / reopening reason is required.';
  if(previous?.status==='Closed'&&!reopen)errors.status='Reopen this RFI before making changes.';
  return errors;
}
export function saveRfi(records:Rfi[], draft:RfiDetails, actor:string, previous?:Rfi, reopen=false, note=''):Rfi {
  const errors=validateRfi(draft,previous,reopen,note);if(Object.keys(errors).length)throw new Error(Object.values(errors)[0]);
  const now=new Date().toISOString(), details=rfiDetails(draft);
  const action=!previous?'Created':reopen?'Reopened / follow-up':previous.status!==draft.status?`${previous.status} → ${draft.status}`:'Details updated';
  return {...details,id:previous?.id||crypto.randomUUID(),number:previous?.number||nextRfiNumber(records),cycle:(previous?.cycle||0)+(reopen?1:0),createdAt:previous?.createdAt||now,updatedAt:now,history:[...(previous?.history||[]),{id:crypto.randomUUID(),at:now,actor,action,note:note.trim(),details}]};
}
// Called before each optimistic workspace write, including retries after a conflict.
// A stale browser cannot silently remove an RFI, renumber it, or discard its history.
export function rfiPersistenceError(base:{jobs:{id:string;rfis?:Rfi[]}[]}|null,next:{jobs:{id:string;rfis?:Rfi[]}[]}):string {
  for(const job of next.jobs){
    const records=job.rfis||[],numbers=new Set<string>(),ids=new Set<string>();
    for(const r of records){if(!/^RFI-\d+$/.test(r.number)||numbers.has(r.number)||ids.has(r.id))return 'RFI numbers must be unique within each job. Refresh the workspace before saving.';numbers.add(r.number);ids.add(r.id);}
  }
  for(const job of base?.jobs||[])for(const old of job.rfis||[]){
    const r=next.jobs.find(j=>j.id===job.id)?.rfis?.find(r=>r.id===old.id);
    if(!r||r.number!==old.number||old.history.some(h=>!r.history.some(n=>n.id===h.id&&JSON.stringify(n)===JSON.stringify(h))))return 'RFI history changed in another browser. Copy your unsaved text, then refresh before editing; saved RFIs and answers cannot be overwritten.';
  }
  return '';
}
export function rfiCsv(jobNumber:string,records:Rfi[]) {
  const cell=(v:unknown)=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
  const rows:unknown[][]=[['Job','RFI','Subject','Status','Outstanding','Overdue','Created','Sent','Raised by','Sent to','Due','Responder','Response date','Question','References','Answer','Follow-up cycles','Attachments']];
  for(const r of records)rows.push([jobNumber,r.number,r.subject,r.status,rfiOutstanding(r)?'Yes':'No',rfiOverdue(r)?'Yes':'No',r.createdDate,r.sentDate,r.raisedBy,r.sentTo,r.dueDate,r.responder,r.responseDate,r.question,r.references,r.answer,r.cycle,r.attachments.map(a=>`${a.label}: ${a.url}`).join('\n')]);
  return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
