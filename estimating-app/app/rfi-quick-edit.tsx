import { useState } from 'react';
import { rfiDetails, rfiStatuses, rfiToday, validateRfi, type Rfi, type RfiDetails } from '../lib/rfi-workflow';

export type RfiQuickField = 'Dates' | 'Status' | 'Response';
interface Props { record: Rfi; field: RfiQuickField; actor: string; disabled: boolean; cancel: () => void;
  commit: (details: RfiDetails, reopen: boolean, note: string) => void }

export function RfiQuickEdit({record,field,actor,disabled,cancel,commit}:Props) {
  const [draft, setDraft] = useState(()=>{const d=rfiDetails(record);if(field==='Response' && d.status==='Open / Sent'){d.status='Answered';d.responder=d.responder||actor;d.responseDate=d.responseDate||rfiToday();}return d;});
  const [note,setNote]=useState('');
  const [errors,setErrors]=useState<Record<string,string>>({});
  const reopen=(record.status==='Answered'||record.status==='Closed') && draft.status==='Open / Sent';
  const change=(key:keyof RfiDetails,value:string)=>setDraft(d=>({...d,[key]:value,...(key==='question'?{questionRich:undefined}:{})}));
  const input=(key:'sentDate'|'dueDate'|'responder'|'responseDate'|'answer'|'question'|'sentTo',label:string,type='text')=>
    <label className="field" key={key}><span>{label}</span>{type==='area'?<textarea aria-label={label} value={draft[key]} onChange={e=>change(key,e.target.value)}/>:<input aria-label={label} type={type} value={draft[key]} onChange={e=>change(key,e.target.value)}/>}</label>;
  function setStatus(status:RfiDetails['status']) {
    setDraft(d=>({...d,status,...(status==='Open / Sent'?{sentDate:d.sentDate||rfiToday()}:{}),
      ...((record.status==='Answered'||record.status==='Closed') && status==='Open / Sent'?{answer:'',responder:'',responseDate:'',sentDate:rfiToday(),dueDate:''}:{}),
      ...(status==='Answered'||status==='Closed'?{responder:d.responder||actor,responseDate:d.responseDate||rfiToday()}: {})}));
  }
  const needsResponse = draft.status==='Answered'||draft.status==='Closed';
  return <form className="rfi-inline-edit" aria-label={field+' for '+record.number} onSubmit={e=>{
    e.preventDefault();
    const issues=validateRfi(draft,record,reopen,note);
    setErrors(issues);
    if(!Object.keys(issues).length)commit(draft,reopen,note);
  }}>
    <strong>{record.number} · {field}</strong>
    <div className="rfi-inline-fields">
      {(field==='Status'||field==='Response')&&<label className="field"><span>Status</span><select aria-label="Status" value={draft.status} onChange={e=>setStatus(e.target.value as RfiDetails['status'])}>{rfiStatuses.map(s=><option key={s}>{s}</option>)}</select></label>}
      {(field==='Dates'||field==='Status'||errors.sentDate)&&input('sentDate','Sent date','date')}
      {(field==='Dates'||reopen)&&input('dueDate','Response due date','date')}
      {(field==='Response'||needsResponse)&&<>{input('responder','Responder')}{input('responseDate','Response date','date')}{input('answer','Response','area')}</>}
      {errors.sentTo&&input('sentTo','Sent to')}{errors.question&&input('question','Question','area')}
      {reopen&&<label className="field"><span>Reason for reopening</span><input value={note} onChange={e=>setNote(e.target.value)}/></label>}
    </div>
    {Object.values(errors).map(s=><p role="alert" key={s}>{s}</p>)}
    <div className="rfi-actions"><button disabled={disabled} className="button primary">Save changes</button><button type="button" className="button secondary" onClick={cancel}>Cancel</button></div>
  </form>;
}
