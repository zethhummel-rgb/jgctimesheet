import { useEffect, useRef, useState } from 'react';
import type { AppState, Job } from '../lib/estimator-data';
import { blankRfi, nextRfiNumber, rfiCsv, rfiDetails, rfiLink, rfiOutstanding, rfiOverdue, rfiStatuses, rfiToday, saveRfi, validateRfi, type Rfi, type RfiDetails } from '../lib/rfi-workflow';
import { photoRequest, preparePhoto, uploadSavedPhotos, type PhotoUpload, type RfiPhoto } from '../lib/rfi-photos';
import { downloadFile as download, RfiPhotoExport, type PhotoDownload } from './rfi-photo-export';
import './job-rfis.css';

const filename=(s:string)=>s.replace(/[^a-zA-Z0-9 _.-]/g,'-').slice(0,100);
export function JobRfis({job,state,setState,actor,workspaceSaved}:{job:Job;state:AppState;setState:React.Dispatch<React.SetStateAction<AppState>>;actor:string;workspaceSaved:boolean}) {
  const records=job.rfis||[];
  const [editor,setEditor]=useState<{draft:RfiDetails;original?:Rfi;reopen:boolean;note:string}|null>(null);
  const [errors,setErrors]=useState<Record<string,string>>({}),[message,setMessage]=useState(''),[search,setSearch]=useState(''),[filter,setFilter]=useState('All'),[exporting,setExporting]=useState(false);
  const guard=useRef(false);
  const [picked, setPicked] = useState<PhotoUpload[]>([]);
  const [working, setWorking] = useState(false);
  const [retryBatch, setRetryBatch] = useState<{id:string;photos:PhotoUpload[]}|null>(null);
  const [delivery, setDelivery] = useState<PhotoDownload|null>(null);
  const [stored, setStored] = useState<RfiPhoto[]>([]);
  const [photoRefresh, setPhotoRefresh] = useState(0);
  const editingId = editor?.original?.id;
  useEffect(() => {
    let current = true;
    setStored([]);
    if (editingId) photoRequest<RfiPhoto[]>(editingId).then(rows => { if (current) setStored(rows); })
      .catch(() => { if (current) setMessage('Saved photos could not be listed. Reopen the RFI to retry.'); });
    return () => { current = false; };
  }, [editingId, photoRefresh]);
  async function pick(files: File[]) {
    if (!files.length) return;
    if (files.length + picked.length > 8) {setMessage('Choose up to eight photos per save.');return;}
    setWorking(true);
    try {
      const added:PhotoUpload[] = [];
      for (const file of files) added.push(await preparePhoto(file));
      setPicked(previous => [...previous, ...added]);
      setMessage('');
    } catch (error) {setMessage(error instanceof Error ? error.message : 'Photo could not be opened.');}
    finally {setWorking(false);}
  }
  async function upload(batch: {id:string;photos:PhotoUpload[]}) {
    setWorking(true);
    try {
      await uploadSavedPhotos(batch.id, batch.photos);
      setRetryBatch(null);
      setPhotoRefresh(n => n+1);
      setMessage('RFI photos uploaded and ready for the PDF.');
    } catch {
      setRetryBatch(batch);
      setMessage('The photos have not finished uploading. Keep this page open and retry.');
    } finally {setWorking(false);}
  }
  const busy = working || exporting || Boolean(delivery) || Boolean(retryBatch);
  const open=(r?:Rfi,reopen=false)=>{setPicked([]);setErrors({});setMessage('');setEditor({draft:r?rfiDetails(r):blankRfi(actor),original:r?structuredClone(r):undefined,reopen,note:''});if(r&&reopen)setEditor({draft:{...rfiDetails(r),status:'Open / Sent',sentDate:rfiToday(),dueDate:'',responder:'',responseDate:'',answer:''},original:structuredClone(r),reopen:true,note:''});};
  const change=<K extends keyof RfiDetails>(key:K,value:RfiDetails[K])=>setEditor(e=>e?{...e,draft:{...e.draft,[key]:value}}:e);
  const readonly=editor?.original?.status==='Closed'&&!editor.reopen;
  const save=()=>{
    if(!editor||guard.current)return;
    const issues=validateRfi(editor.draft,editor.original,editor.reopen,editor.note);setErrors(issues);
    if(Object.keys(issues).length){setMessage('Complete the highlighted required information.');return;}
    if(!workspaceSaved){setMessage('Wait for the current workspace to save before saving this RFI.');return;}
    const current=records.find(r=>r.id===editor.original?.id);
    if(editor.original&&JSON.stringify(current)!==JSON.stringify(editor.original)){setMessage('This RFI changed while you were editing. Copy your text and reopen the latest record.');return;}
    guard.current=true;
    const saved=saveRfi(records,editor.draft,actor,current,editor.reopen,editor.note);
    setState(s=>({...s,jobs:s.jobs.map(j=>j.id===job.id?{...j,rfis:current?(j.rfis||[]).map(r=>r.id===current.id?saved:r):[...(j.rfis||[]),saved]}:j)}));
    if (picked.length) { void upload({id:saved.id,photos:picked}); setPicked([]); }
    setEditor(null);setMessage(`${saved.number} recorded. Check the workspace save status before leaving.`);queueMicrotask(()=>{guard.current=false;});
  };
  const exportPdf = async (r?: Rfi) => {
    if (busy) return;
    setExporting(true);
    try {
      const { buildRfiPdf } = await import('../lib/rfi-pdf');
      const response = await fetch(new URL('jgc-logo-transparent.png', document.baseURI));
      if (!response.ok) throw new Error('The JGC logo could not be loaded. Try again.');
      const listed = r ? await photoRequest<RfiPhoto[]>(r.id) : [];
      const photos = [];
      for (const photo of listed) {
        const {jpeg} = await photoRequest<{jpeg:string}>(r!.id, 'GET', undefined, photo.id);
        photos.push({name:photo.name, jpeg});
      }
      const bytes = await buildRfiPdf({job,state,records:r?[r]:records,register:!r,photos,logoBytes:new Uint8Array(await response.arrayBuffer())});
      const blob = new Blob([new Uint8Array(bytes)], {type:'application/pdf'});
      const name = filename(`${job.jobNumber} ${r?r.number:'RFI Register'}`)+'.pdf';
      if (r && listed.length) setDelivery({rfi:r.id,ids:listed.map(photo=>photo.id),blob,filename:name});
      else download(blob, name);
    } catch (error) {setMessage(error instanceof Error?error.message:'PDF could not be created.');}
    finally {setExporting(false);}
  };
  const shown=records.filter(r=>(filter==='All'||filter==='Outstanding'&&rfiOutstanding(r)||filter==='Overdue'&&rfiOverdue(r)||filter===r.status)&&[r.number,r.subject,r.sentTo,r.raisedBy,r.question,r.references].some(v=>v.toLowerCase().includes(search.toLowerCase()))).sort((a,b)=>a.number.localeCompare(b.number,undefined,{numeric:true}));
  const input=(key:Exclude<keyof RfiDetails,'attachments'|'status'>,label:string,type='text',multiline=false)=> <label className={`field ${multiline?'full':''}`}><span>{label}</span>{multiline?<textarea aria-label={label} aria-invalid={Boolean(errors[key])} value={editor!.draft[key]} onChange={e=>change(key,e.target.value)} rows={key==='question'||key==='answer'?6:3}/>:<input aria-label={label} aria-invalid={Boolean(errors[key])} type={type} value={editor!.draft[key]} onChange={e=>change(key,e.target.value)}/>} {errors[key]&&<small className="rfi-error">{errors[key]}</small>}</label>;
  return <section className="rfi-page" aria-label="RFI Register">
    <div className="rfi-heading"><div><p className="eyebrow">JOB CORRESPONDENCE</p><h2>RFI Register</h2><p>Questions, responses and follow-ups for Job {job.jobNumber}.</p></div><div className="rfi-actions"><button className="button secondary" disabled={!records.length||busy} onClick={()=>void exportPdf()}>RFI log PDF</button><button className="button secondary" disabled={!records.length} onClick={()=>download(new Blob([rfiCsv(job.jobNumber,records)],{type:'text/csv;charset=utf-8'}),filename(`${job.jobNumber} RFI Register`)+'.csv')}>Export RFI log</button><button className="button primary" disabled={!workspaceSaved||busy} onClick={()=>open()}>New RFI</button></div></div>
    <div className="rfi-totals">{[['Total',records.length],['Outstanding',records.filter(rfiOutstanding).length],['Overdue',records.filter(r=>rfiOverdue(r)).length],['Answered',records.filter(r=>r.status==='Answered').length]].map(([label,n])=><div key={label}><span>{label}</span><strong>{n}</strong></div>)}</div>
    {!workspaceSaved&&<p role="status">Workspace sync pending. Wait for Saved before leaving or creating another RFI.</p>}
    {message&&<p role="status" className="rfi-message">{message}</p>}
    {working && <p role="status">Preparing or uploading photos…</p>}
    {retryBatch && <button disabled={working} className="button secondary" onClick={()=>void upload(retryBatch)}>Retry photo upload</button>}
    {delivery && <RfiPhotoExport item={delivery} done={text=>{setDelivery(null);setMessage(text);setPhotoRefresh(n=>n+1);}}/>}
    <div className="rfi-filters"><input aria-label="Search RFIs" placeholder="Search RFI number, subject, person or reference" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="RFI register filter" value={filter} onChange={e=>setFilter(e.target.value)}>{['All','Outstanding','Overdue',...rfiStatuses].map(s=><option key={s}>{s}</option>)}</select></div>
    {editor&&<section className="rfi-editor" aria-label="RFI editor">
      <div className="rfi-heading"><div><p className="eyebrow">{editor.reopen?'FOLLOW-UP / REOPEN':editor.original?'RFI DETAILS':'NEW RFI'}</p><h3>{editor.original?.number||'Number assigned when saved'}</h3><small>{editor.original?`${editor.original.cycle} follow-up cycles`:`Next available: ${nextRfiNumber(records)}. Cancelling does not use a number.`}</small></div><button className="button secondary" disabled={busy} onClick={()=>setEditor(null)}>Close RFI editor</button></div>
      {readonly&&<p>This RFI is closed. Use Reopen / follow up to make further changes.</p>}
      <fieldset disabled={readonly||busy} className="rfi-fields">
        {input('subject','Subject *')}{input('createdDate','Created date *','date')}{input('raisedBy','Raised by *')}{input('sentTo','Sent to')}
        <label className="field"><span>Status</span><select aria-label="RFI status" aria-invalid={Boolean(errors.status)} value={editor.draft.status} disabled={editor.reopen} onChange={e=>change('status',e.target.value as RfiDetails['status'])}>{rfiStatuses.map(s=><option key={s}>{s}</option>)}</select>{errors.status&&<small className="rfi-error">{errors.status}</small>}</label>
        {input('sentDate','Sent date','date')}{input('dueDate','Response due date','date')}
        <p className="full rfi-hint">Open / Sent records the issue date. It does not send an email. Due dates are optional.</p>
        {input('question','Question / clarification request', 'text',true)}{input('references','Drawing / specification / detail references','text',true)}
        <div className="full">
          <label className="field"><span>Photo attachments</span><input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy}
            onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';void pick(files);}} /></label>
          <p className="rfi-hint">Select photos, then save the RFI. Each photo gets a page in its PDF. Saving the photo PDF clears the uploaded copies.</p>
          {stored.map(photo=><p key={photo.id}>{photo.name} · Uploaded</p>)}
          {picked.map(photo=><div key={photo.id} className="rfi-actions"><span>{photo.name}</span><button type="button" className="button secondary compact" onClick={()=>setPicked(rows=>rows.filter(row=>row.id!==photo.id))}>Remove</button></div>)}
          {editor.draft.attachments.map(link=><p key={link.id}><a href={rfiLink(link.url)||undefined} target="_blank" rel="noopener noreferrer">{link.label}</a></p>)}
        </div>
        <h4 className="full">Response</h4>{input('responder','Responder')}{input('responseDate','Response date','date')}{input('answer','Complete answer','text',true)}
        <label className="field full"><span>{editor.reopen?'Follow-up / reopening reason *':'Change note (optional)'}</span><textarea aria-label="Follow-up / change note" aria-invalid={Boolean(errors.note)} value={editor.note} onChange={e=>setEditor({...editor,note:e.target.value})}/>{errors.note&&<small className="rfi-error">{errors.note}</small>}</label>
      </fieldset>
      <p className="rfi-hint">Save your changes before downloading the updated RFI PDF.</p><div className="rfi-actions">{!readonly&&<button className="button primary" disabled={!workspaceSaved||busy} onClick={save}>{editor.reopen?'Save reopened RFI':'Save RFI'}</button>}{editor.original&&<button className="button secondary" disabled={busy||picked.length>0||editor.reopen||JSON.stringify(editor.draft)!==JSON.stringify(rfiDetails(editor.original))||Boolean(editor.note.trim())} onClick={()=>void exportPdf(editor.original)}>Download RFI PDF</button>}{editor.original&&['Answered','Closed'].includes(editor.original.status)&&!editor.reopen&&<button className="button secondary" onClick={()=>open(editor.original,true)}>Reopen / follow up</button>}</div>
      {editor.original&&<details className="rfi-history"><summary>Question / answer history ({editor.original.history.length})</summary>{editor.original.history.map(h=><article key={h.id}><h4>{h.action}</h4><small>{new Date(h.at).toLocaleString()} · {h.actor}</small>{h.note&&<p>{h.note}</p>}<dl><dt>Subject / status</dt><dd>{h.details.subject} · {h.details.status}</dd><dt>Created / sent / due</dt><dd>{h.details.createdDate} / {h.details.sentDate||'—'} / {h.details.dueDate||'—'}</dd><dt>Raised by / sent to</dt><dd>{h.details.raisedBy} / {h.details.sentTo||'—'}</dd><dt>Question</dt><dd>{h.details.question||'—'}</dd><dt>References</dt><dd>{h.details.references||'—'}</dd><dt>Response</dt><dd>{h.details.responder} {h.details.responseDate}<br/>{h.details.answer||'No answer recorded'}</dd></dl>{h.details.attachments.map(a=><p key={a.id}><a href={rfiLink(a.url)||undefined} target="_blank" rel="noopener noreferrer">{a.label}</a></p>)}</article>)}</details>}
    </section>}
    <div className="data-table-wrap"><table className="rfi-table"><thead><tr>{['RFI / subject','Raised by / sent to','Sent / due','Status','Response','Actions'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{shown.map(r=><tr key={r.id}><td data-label="RFI / subject"><strong>{r.number}</strong><div>{r.subject}</div><small>{r.cycle>0?`${r.cycle} follow-up cycles`:''}</small></td><td data-label="Raised by / sent to">{r.raisedBy}<br/>{r.sentTo||'Not sent'}</td><td data-label="Sent / due">{r.sentDate||'—'}<br/>{r.dueDate||'No due date'}</td><td data-label="Status"><span className="pill">{r.status}</span>{rfiOverdue(r)&&<strong className="rfi-overdue">Overdue</strong>}{rfiOutstanding(r)&&!rfiOverdue(r)&&<small>Awaiting response</small>}</td><td data-label="Response">{r.responder||'—'}<br/>{r.responseDate}</td><td data-label="Actions"><div className="rfi-actions"><button className="button secondary compact" disabled={busy} onClick={()=>open(r)}>Open RFI</button><button className="button secondary compact" disabled={busy||picked.length>0} onClick={()=>void exportPdf(r)}>PDF</button></div></td></tr>)}</tbody></table>{!shown.length&&<p className="rfi-hint">{records.length?'No matching RFIs.':'No RFIs yet. Create the first request for this job.'}</p>}</div>
  </section>;
}
