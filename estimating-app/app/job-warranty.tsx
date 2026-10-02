import { useEffect, useRef, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import type { AppState, Job } from '../lib/estimator-data';
import { cleanWarrantyFilename, createWarranty, lockWarranty, reopenWarranty, warrantyDate, warrantyDefaults, warrantyFieldErrors, warrantyFieldLimits, warrantyFilename, warrantyTemplateV1, type JobWarranty, type WarrantyFields, type WarrantyRevision } from '../lib/job-warranty';
import './job-warranty.css';

type DownloadVersion={value:JobWarranty;filename:string;historical:boolean};
function WarrantyDialog({title,onClose,busy=false,children}:{title:string;onClose:()=>void;busy?:boolean;children:ReactNode}) {
  const ref=useRef<HTMLElement>(null),close=useRef(onClose),blocked=useRef(busy);close.current=onClose;blocked.current=busy;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';ref.current?.querySelector<HTMLElement>('input,button')?.focus();
    const keys=(e:KeyboardEvent)=>{
      if(e.key==='Escape'&&!blocked.current){e.preventDefault();close.current();}
      if(e.key==='Tab') {
        const items=[...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')??[])].filter(el=>el.getClientRects().length);
        const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    };
    window.addEventListener('keydown',keys);
    return()=>{document.body.style.overflow=overflow;window.removeEventListener('keydown',keys);if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  return <div className="modal-layer warranty-dialog-layer" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}><section ref={ref} className="modal-card warranty-dialog" role="dialog" aria-modal="true" aria-label={title}><header><div><span className="eyebrow">JGC WARRANTY</span><h2>{title}</h2></div><button type="button" disabled={busy} aria-label={`Close ${title}`} onClick={onClose}>×</button></header>{children}</section></div>;
}
function PaperText({name,value,readonly,error,onChange}:{name:keyof WarrantyFields;value:string;readonly:boolean;error?:string;onChange:(key:keyof WarrantyFields,value:string)=>void}) {
  const ref=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{
    const el=ref.current;if(!el)return;let width=0;
    const resize=()=>{el.style.height='0px';el.style.height=`${Math.max(22,el.scrollHeight)}px`;};resize();
    const observer=new ResizeObserver(entries=>{const next=entries[0].contentRect.width;if(next!==width){width=next;resize();}});observer.observe(el);return()=>observer.disconnect();
  },[value]);
  const labels:Partial<Record<keyof WarrantyFields,string>>={owner:'Owner',building:'Building',location:'Location',project:'Project title',ownerOfficial:'Authorized official'};
  return <><textarea ref={ref} aria-label={labels[name]} aria-invalid={Boolean(error)} maxLength={warrantyFieldLimits[name]} value={value} readOnly={readonly} rows={1} placeholder={readonly?'':name==='building'?'Building / site (optional)':name==='ownerOfficial'?'Leave blank for owner to sign':`Enter ${labels[name]?.toLowerCase()}`} onChange={e=>onChange(name,e.target.value)} />{error&&<small className="warranty-field-error">{error}</small>}</>;
}
function WarrantyPaper({value,readonly,onChange,errors={}}:{value:JobWarranty;readonly:boolean;onChange:(key:keyof WarrantyFields,value:string)=>void;errors?:Partial<Record<keyof WarrantyFields,string>>}) {
  const f=value.fields,terms=warrantyTemplateV1;
  const date=(key:'completionDate'|'issueDate'|'ownerDate',label:string)=><label className="warranty-paper-date"><input type="date" aria-label={label} value={f[key]} max="2200-12-31" min="1900-01-01" disabled={readonly} aria-invalid={Boolean(errors[key])} onChange={e=>onChange(key,e.target.value)} />{f[key]&&<span>{warrantyDate(f[key])}</span>}{errors[key]&&<small className="warranty-field-error">{errors[key]}</small>}</label>;
  const header=<header className="warranty-letterhead"><div><img src="./jgc-warranty-logo-v1.png" alt="John Gordon Construction" /><strong>GENERAL CONTRACTORS</strong></div><address><strong>613-932-1293</strong><span>info@johngordonconstruction.com</span><span>www.johngordonconstruction.com</span><span>830 Campbell Street, Unit #3</span><span>Cornwall, Ontario&nbsp; K6H 6L7</span></address></header>;
  const footer=(number:number)=><footer className="warranty-paper-footer"><span>FIELD WARRANTY | {f.project.toUpperCase()} | REV {value.revision}</span><span>PAGE {number} OF 2</span></footer>;
  return <div className="warranty-preview" aria-label={readonly?'Read-only warranty preview':'Editable warranty preview'}>
    <article className="warranty-paper" aria-label="Warranty page 1">
      {header}<div className="warranty-paper-title"><h2>FIELD WARRANTY</h2><strong>CONTRACTORS GUARANTEE</strong></div>
      <div className="warranty-project-table">{(['owner','building','location','project'] as const).map((key,i)=><div key={key}><strong>{['Owner','Building','Location','Project Title'][i]}</strong><div><PaperText name={key} value={f[key]} readonly={readonly} error={errors[key]} onChange={onChange}/></div></div>)}<div><strong>Date of completion</strong><div>{date('completionDate','Date of completion')}</div></div></div>
      <section className="warranty-terms"><h3>Warranty Coverage</h3><p>{terms.coverage}</p><p><strong>{terms.introduction}</strong></p><ol>{terms.conditions.slice(0,3).map((v,i)=><li key={i}>{v}</li>)}</ol></section>
      {footer(1)}
    </article>
    <article className="warranty-paper" aria-label="Warranty page 2">
      {header}<section className="warranty-terms warranty-continued"><h3>Warranty Conditions - Continued</h3><ol start={4}>{terms.conditions.slice(3).map((v,i)=><li key={i}>{v}</li>)}</ol></section>
      <section className="warranty-authorization"><h3>Warranty Authorization</h3><p><strong>Issued by John Gordon Construction Inc.</strong></p><div className="warranty-signoff"><div><img src="./jgc-warranty-signature-v1.png" alt="Jeff Vandrish signature"/><strong>Jeff Vandrish</strong><span>President</span></div><div><strong>Date</strong>{date('issueDate','Warranty issue date')}</div></div></section>
      <section className="warranty-acceptance"><strong>OWNER ACCEPTANCE</strong><p>{terms.acceptance}</p></section>
      <div className="warranty-owner-signoff"><label><PaperText name="ownerOfficial" value={f.ownerOfficial} readonly={readonly} error={errors.ownerOfficial} onChange={onChange}/><strong>Authorized Official</strong></label><div>{date('ownerDate','Owner acceptance date')}<strong>Date</strong></div></div>
      {footer(2)}
    </article>
  </div>;
}
export function JobWarrantyPage({job,state,setState,actor,workspaceSaved}:{job:Job;state:AppState;setState:Dispatch<SetStateAction<AppState>>;actor:string;workspaceSaved:boolean}) {
  const value=job.warranty??createWarranty(warrantyDefaults(job,state),actor),locked=value.status==='Locked';
  const [errors,setErrors]=useState<Partial<Record<keyof WarrantyFields,string>>>({}),[message,setMessage]=useState('');
  const [menu,setMenu]=useState<DownloadVersion|null>(null),[filename,setFilename]=useState(''),[busy,setBusy]=useState(false),[downloaded,setDownloaded]=useState('');
  const [finish,setFinish]=useState<DownloadVersion|null>(null),[reopen,setReopen]=useState(false),[history,setHistory]=useState<WarrantyRevision|null>(null);
  const actionRef=useRef<HTMLButtonElement>(null),historyRef=useRef<HTMLDetailsElement>(null);
  const dialogWasOpen=useRef(false),dialogOpen=Boolean(menu||finish||reopen||history);
  useEffect(()=>{if(dialogWasOpen.current&&!dialogOpen)actionRef.current?.focus({preventScroll:true});dialogWasOpen.current=dialogOpen;},[dialogOpen]);
  const defaultName=warrantyFilename(job.portalCustomer||state.clients.find(c=>c.id===job.clientId)?.name||value.fields.owner,job.project||value.fields.project);
  const change=(key:keyof WarrantyFields,text:string)=>{
    if(locked)return;setErrors(e=>({...e,[key]:undefined}));setMessage('');
    setState(current=>({...current,jobs:current.jobs.map(j=>{
      if(j.id!==job.id)return j;const warranty=j.warranty??createWarranty(warrantyDefaults(j,current),actor);
      if(warranty.status!=='Draft'||warranty.revision!==value.revision)return j;
      return {...j,warranty:{...warranty,fields:{...warranty.fields,[key]:text},updatedAt:new Date().toISOString(),updatedBy:actor}};
    })}));
  };
  const openDownload=(record?:WarrantyRevision)=>{
    const source=record?{...value,fields:record.fields,revision:record.number,templateVersion:record.templateVersion,status:'Locked' as const}:value;
    const validation=warrantyFieldErrors(source.fields);setErrors(validation);if(Object.keys(validation).length){setMessage('Complete the highlighted warranty details before downloading.');return;}
    const name=record?.filename||defaultName;setMenu({value:structuredClone(source),filename:name,historical:Boolean(record)});setFilename(name);setDownloaded('');setMessage('');setHistory(null);
  };
  const download=async()=>{
    if(!menu||busy)return;setBusy(true);setMessage('');
    try {
      const {buildWarrantyPdf}=await import('../lib/job-warranty-pdf');
      const [logoResponse,signatureResponse]=await Promise.all([fetch('./jgc-warranty-logo-v1.png'),fetch('./jgc-warranty-signature-v1.png')]);
      if(!logoResponse.ok||!signatureResponse.ok)throw new Error('The warranty letterhead could not be loaded. Refresh and retry.');
      const bytes=await buildWarrantyPdf({warranty:menu.value,logoBytes:new Uint8Array(await logoResponse.arrayBuffer()),signatureBytes:new Uint8Array(await signatureResponse.arrayBuffer())});
      const name=cleanWarrantyFilename(filename),blob=new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);setFilename(name);setDownloaded(name);
    }catch(error){setMessage(error instanceof Error?error.message:'The PDF could not be prepared. Retry downloading.');}finally{setBusy(false);}
  };
  const done=()=>{if(!menu)return;const completed=menu;setMenu(null);if(downloaded&&!completed.historical&&completed.value.status==='Draft')setFinish({...completed,filename:downloaded});};
  const lock=()=>{
    if(!finish||!workspaceSaved)return;
    if(JSON.stringify(job.warranty)!==JSON.stringify(finish.value)){setMessage('The warranty changed after downloading. Download the updated version before locking it.');setFinish(null);return;}
    const expected=JSON.stringify(finish.value),next=lockWarranty(finish.value,actor,finish.filename);
    setState(current=>({...current,jobs:current.jobs.map(j=>j.id===job.id&&JSON.stringify(j.warranty)===expected?{...j,warranty:next}:j)}));setFinish(null);setMessage(`Revision ${next.revision} locked and kept in History.`);
  };
  const unlock=()=>{
    if(!job.warranty||!locked||!workspaceSaved)return;const expected=JSON.stringify(job.warranty),next=reopenWarranty(job.warranty,actor);
    setState(current=>({...current,jobs:current.jobs.map(j=>j.id===job.id&&JSON.stringify(j.warranty)===expected?{...j,warranty:next}:j)}));setReopen(false);setMessage(`Revision ${next.revision} is ready to edit. The previous warranty remains in History.`);
  };
  return <section className="job-warranty" aria-label="Job warranty">
    <header className="warranty-workspace-heading"><div><span className="eyebrow">PROJECT CLOSEOUT</span><h2>Warranty</h2><p>Enter details directly on the form. Changes save automatically.</p></div><span className={`warranty-status ${locked?'is-locked':''}`}>Rev {value.revision} · {locked?'Locked':'Draft'}</span></header>
    <div className="warranty-toolbar"><p>{locked?'This version is locked. Reopen it to create the next revision.':'Complete the project details and dates, then download your warranty.'}</p><div>{locked&&<button type="button" className="button secondary" disabled={!workspaceSaved} onClick={()=>setReopen(true)}>Reopen warranty</button>}<button type="button" className="button secondary" onClick={()=>{if(historyRef.current){historyRef.current.open=true;historyRef.current.scrollIntoView({block:'start'});}}}>History ({value.revisions.length})</button><button ref={actionRef} type="button" className="button primary" disabled={!workspaceSaved} onClick={()=>openDownload()}>⇩ Download PDF</button></div></div>
    {message&&<p className="warranty-message" role="status">{message}</p>}
    {!workspaceSaved&&<p className="warranty-message" role="status">Saving warranty changes — check the save status at the top before leaving.</p>}
    <WarrantyPaper value={value} readonly={locked} onChange={change} errors={errors}/>
    <details ref={historyRef} className="warranty-history"><summary>Warranty History ({value.revisions.length})</summary>{!value.revisions.length?<p>Locked versions appear here. Reopening starts a new revision.</p>:value.revisions.slice().reverse().map(record=><article key={record.id}><div><strong>Revision {record.number}</strong><span>{new Date(record.lockedAt).toLocaleString()} · {record.lockedBy}</span><small>{record.fields.owner} · {record.fields.project}</small></div><div><button type="button" className="button secondary compact" onClick={()=>setHistory(record)}>View revision {record.number}</button><button type="button" className="button primary compact" onClick={()=>openDownload(record)}>Download revision {record.number}</button></div></article>)}</details>
    {menu&&<WarrantyDialog title="Download warranty PDF" busy={busy} onClose={()=>setMenu(null)}><div className="pdf-download-intro"><strong>Warranty · Revision {menu.value.revision}</strong><p>You can change the filename before downloading.</p></div><section className="pdf-download-row"><label className="field pdf-filename-field"><span>Warranty PDF filename</span><input aria-label="Warranty PDF filename" value={filename} maxLength={184} spellCheck={false} disabled={busy} onFocus={e=>e.currentTarget.select()} onChange={e=>{setFilename(e.target.value);setDownloaded('');}}/></label><button type="button" className="button primary" disabled={busy} onClick={()=>void download()}>{busy?'Preparing…':downloaded?'✓ Downloaded — download again':'⇩ Download warranty PDF'}</button></section>{message&&<p className="warranty-message" role="alert">{message}</p>}<footer className="pdf-download-footer"><span role="status">{downloaded?'PDF download started.':'Your warranty stays open while you save the file.'}</span><button type="button" className="button secondary" disabled={busy} onClick={done}>Done</button></footer></WarrantyDialog>}
    {finish&&<WarrantyDialog title={`Lock warranty Revision ${finish.value.revision}?`} onClose={()=>setFinish(null)}><div className="confirm-content"><strong>{finish.value.fields.owner} · {finish.value.fields.project}</strong><p>Lock this version to preserve the warranty you downloaded. Reopening will create Revision {finish.value.revision+1} and keep this one in History.</p></div><footer className="confirm-actions"><button type="button" className="button secondary" onClick={()=>setFinish(null)}>No — keep editing</button><button type="button" className="button primary" disabled={!workspaceSaved} onClick={lock}>Yes — lock this version</button></footer></WarrantyDialog>}
    {reopen&&<WarrantyDialog title={`Reopen as Revision ${value.revision+1}?`} onClose={()=>setReopen(false)}><div className="confirm-content"><p>Revision {value.revision} stays locked in History. All new edits and autosaves will use Revision {value.revision+1}.</p></div><footer className="confirm-actions"><button type="button" className="button secondary" onClick={()=>setReopen(false)}>Cancel</button><button type="button" className="button primary" disabled={!workspaceSaved} onClick={unlock}>Create Revision {value.revision+1}</button></footer></WarrantyDialog>}
    {history&&<WarrantyDialog title={`Warranty Revision ${history.number}`} onClose={()=>setHistory(null)}><div className="warranty-history-preview"><WarrantyPaper value={{...value,fields:history.fields,revision:history.number,templateVersion:history.templateVersion,status:'Locked'}} readonly onChange={()=>{}}/></div><footer className="confirm-actions"><button type="button" className="button secondary" onClick={()=>setHistory(null)}>Close</button><button type="button" className="button primary" onClick={()=>openDownload(history)}>Download this revision</button></footer></WarrantyDialog>}
  </section>;
}
