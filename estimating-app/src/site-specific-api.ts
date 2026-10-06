import type { Job } from '../lib/estimator-data';
import { sitePlanDate, sitePlanFileName, type SiteSpecificPlan, type SafetyAttachment } from '../lib/site-specific';
let client:any;
const tickets=new WeakMap<Blob,{id:string;object_path:string;uploaded:boolean;finalized:boolean}>();
async function connected() {
 client ||= (window as any).createJgcSupabaseClient?.();
 if(!client)throw new Error('The Portal connection is unavailable. Refresh and try again.');
 const s=await client.auth.getSession(); if(s.error||!s.data?.session?.user?.id)throw new Error('Sign in to the Portal again.');
 const p=await client.from('profiles').select('role,account_status').eq('id',s.data.session.user.id).maybeSingle();
 if(p.error||p.data?.role!=='admin'||p.data?.account_status!=='approved')throw new Error('Approved administrator access is required.');
 return client;
}
async function rpc(c:any,name:string,args:object):Promise<any>{const r=await c.rpc(name,args);if(r.error)throw new Error(r.error.message||'The Portal request failed.');return r.data;}
async function board(c:any,job:Job){const b=await rpc(c,'get_or_create_job_board',{p_job_id:job.id});if(!b?.id||!b.can_manage)throw new Error('This job’s board is unavailable to your account.');return b;}
export async function loadSafetyAttachments(job:Job):Promise<{items:SafetyAttachment[];warnings:string[]}> {
 const c=await connected(); const items:SafetyAttachment[]=[],warnings:string[]=[];
 const results=await Promise.allSettled([board(c,job),(async()=>{const rows:any[]=[];for(let first=0;;first+=500){const r=await c.from('certificates').select('id,worker_name,certificate_name,expiry_date,file_path,file_name,file_type').order('created_at',{ascending:false}).range(first,first+499);if(r.error)throw new Error(r.error.message||'Certificates could not be loaded.');rows.push(...(r.data||[]));if((r.data||[]).length<500)break;}return rows;})()]);
 const b=results[0];
 if(b.status==='fulfilled') {
  for(const d of b.value.documents||[]) {
   if(['uploading','archived'].includes(d.status)||d.category==='accident-incident')continue;
   items.push({id:`board:${d.id}`,kind:'board',title:d.title||d.file_name||'Job document',included:false,fileName:d.file_name||'document.pdf',fileType:d.mime_type,boardId:b.value.id,documentId:d.id,category:d.category});
  }
 } else warnings.push(b.reason?.message||'Job documents could not be loaded.');
 const cert=results[1];
 if(cert.status==='fulfilled') {
  for(const d of cert.value) {
   if(!d.file_path)continue;
   items.push({id:`certificate:${d.id}`,kind:'certificate',title:`${d.worker_name} — ${d.certificate_name}`,included:false,fileName:d.file_name||'certificate.pdf',fileType:d.file_type,filePath:d.file_path,expiryDate:d.expiry_date||''});
  }
 } else warnings.push(cert.reason?.message||'Certificates could not be loaded.');
 return {items,warnings};
}
const loadedScripts=new Map<string,Promise<void>>();
function loadScript(relative:string,globalName:string) {const url=new URL(relative,document.baseURI).href;if((window as any)[globalName])return Promise.resolve();let result=loadedScripts.get(url);if(!result){result=new Promise<void>((resolve,reject)=>{const s=document.createElement('script');s.src=url;s.onload=()=>{if((window as any)[globalName])resolve();else{loadedScripts.delete(url);reject(new Error('The report exporter did not load.'));}};s.onerror=()=>{loadedScripts.delete(url);s.remove();reject(new Error('The report exporter could not load. Retry when your connection improves.'));};document.head.append(s);});loadedScripts.set(url,result);}return result;}
export async function readSafetyAttachment(job:Job,item:SafetyAttachment):Promise<Blob> {
 const c=await connected();
 if(item.kind==='certificate'){const id=item.id.replace(/^certificate:/,'');const row=await c.from('certificates').select('file_path').eq('id',id).maybeSingle();if(row.error||!row.data?.file_path)throw new Error(`${item.title}: certificate unavailable.`);const r=await c.storage.from('certificates').download(row.data.file_path);if(r.error||!r.data)throw new Error(`${item.title}: download failed. Retry when connected.`);return r.data;}
 const b=await board(c,job);if(item.boardId!==b.id)throw new Error('The attachment belongs to a different job.');
 const response=await c.functions.invoke('jgc-job-board-document',{body:{boardToken:b.token,visitToken:null,documentId:item.documentId}});if(response.error||response.data?.error)throw new Error(`${item.title}: ${response.data?.error||response.error?.message||'document unavailable'}`);const data=response.data;
 if(data.sourcePayload){if(item.category==='jsa'){const j=await rpc(c,'get_job_board_jsa',{p_token:b.token,p_visit_token:null,p_document_id:item.documentId});data.sourcePayload.acknowledgements=j.acknowledgements||[];}await loadScript('../job-board-report-pdf.js?v=5','JGCJobBoardPdf');return (window as any).JGCJobBoardPdf.create(data.sourcePayload,{baseUrl:new URL('../',document.baseURI).href});}
 if(data.pdfBase64){const raw=atob(data.pdfBase64);return new Blob([Uint8Array.from(raw,x=>x.charCodeAt(0))],{type:data.mimeType||'application/pdf'});}
 if(!data.url)throw new Error('The document service did not return a file.');const u=new URL(data.url),allowed=new URL(c.supabaseUrl).hostname;
 if(u.protocol!=='https:'||![allowed,allowed.replace('.supabase.co','.storage.supabase.co')].includes(u.hostname))throw new Error('The document location could not be verified.');
 const responseFile=await fetch(u.href,{referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(45000)});if(!responseFile.ok)throw new Error(`${item.title}: download failed.`);return responseFile.blob();
}
async function upload(c:any,b:any,blob:Blob,name:string,title:string,date:string,notes:string) {
 if(!b.enabled)throw new Error('Enable this Job Board in the Job Board tab before uploading.');if(blob.size<1||blob.size>20*1024*1024)throw new Error('The combined file must be 20 MB or smaller. Remove an attachment or reduce its file size.');
 let ticket=tickets.get(blob);if(!ticket){const reserved=await rpc(c,'begin_job_board_upload',{p_board_id:b.id,p_category:'site-specific',p_title:title.slice(0,200),p_report_date:date,p_file_name:name.slice(0,255),p_mime_type:blob.type,p_file_size:blob.size,p_notes:notes});if(!reserved?.id||!reserved.object_path)throw new Error('An upload destination could not be created.');ticket={...reserved,uploaded:false,finalized:false};tickets.set(blob,ticket!);}
 if(!ticket!.uploaded){const r=await c.storage.from('job-board-files').upload(ticket!.object_path,blob,{contentType:blob.type,upsert:false});if(r.error&&String(r.error.statusCode)!=='409'&&!/already exists|duplicate/i.test(r.error.message||''))throw new Error('The upload did not finish. Your plan is kept; retry when connected.');ticket!.uploaded=true;}
 if(!ticket!.finalized){await rpc(c,'finalize_job_board_upload',{p_document_id:ticket!.id});ticket!.finalized=true;}return ticket!;
}
export async function uploadSafetyAttachment(job:Job,file:File):Promise<SafetyAttachment> {
 if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PDF, JPG, PNG or WebP attachment.');
 const c=await connected(),b=await board(c,job);const t=await upload(c,b,file,file.name,`Plan attachment · ${file.name}`,sitePlanDate(),'Supporting file for the site-specific plan; original kept separately.');
 return {id:`board:${t.id}`,kind:'board',title:file.name,fileName:file.name,fileType:file.type,documentId:t.id,boardId:b.id,category:'site-specific',included:true};
}
export async function publishSafetyPlan(job:Job,plan:SiteSpecificPlan,blob:Blob) {
 const c=await connected(),b=await board(c,job);const t=await upload(c,b,blob,sitePlanFileName(plan),`Site Specific · Revision ${plan.revision}`,plan.planDate,`JGC site-specific safety plan for Job ${job.jobNumber}. Revision ${plan.revision}.`);
 await rpc(c,'review_job_board_document',{p_document_id:t.id,p_status:'published',p_visibility:plan.visibility});return {documentId:t.id,at:new Date().toISOString(),revision:plan.revision,updatedAt:plan.updatedAt};
}
