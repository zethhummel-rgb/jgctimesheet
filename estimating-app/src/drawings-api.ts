import { DRAWING_MAX_BYTES, DRAWING_MAX_MB, emptyDrawing, validateContent, type DrawingContent } from '../lib/drawing-model';
export type DrawingRecord = { id: string; job_id: string; title: string; file_name: string; object_path: string; revision: number; content: DrawingContent; created_at: string; updated_at: string };
function client(): any {
  const factory = (window as Window & { createJgcSupabaseClient?: () => any }).createJgcSupabaseClient;
  if (!factory) throw new Error('Sign in to the Portal to open shared drawings.');
  return factory();
}
function checked(result: any) { if (result.error) throw new Error(result.error.message || 'Shared drawings could not be saved.'); return result.data; }
export async function listDrawings(jobId: string): Promise<DrawingRecord[]> {
  return checked(await client().from('job_drawings').select('*').eq('job_id', jobId).order('created_at', { ascending: false })) ?? [];
}
export async function loadDrawing(record: DrawingRecord): Promise<Uint8Array> {
  const blob: Blob = checked(await client().storage.from('job-drawings').download(record.object_path));
  return new Uint8Array(await blob.arrayBuffer());
}
async function uploadOriginal(c:any,id:string,file:File,onProgress:(percent:number)=>void) {
  if(file.size<=6*1024*1024){checked(await c.storage.from('job-drawings').upload(`${id}/original.pdf`,file,{contentType:'application/pdf',upsert:false}));onProgress(100);return;}
  const {data,error}=await c.auth.getSession();if(error||!data.session?.access_token)throw new Error('Sign in again before uploading this drawing.');
  const {Upload}=await import('tus-js-client'),url=new URL(c.supabaseUrl);
  if(url.hostname.endsWith('.supabase.co')&&!url.hostname.endsWith('.storage.supabase.co'))url.hostname=url.hostname.replace('.supabase.co','.storage.supabase.co');
  await new Promise<void>((resolve,reject)=>{
    const upload=new Upload(file,{
      endpoint:`${url.origin}/storage/v1/upload/resumable`,chunkSize:6*1024*1024,retryDelays:[0,1000,3000,5000],storeFingerprintForResuming:false,
      headers:{authorization:`Bearer ${data.session.access_token}`,'x-upsert':'false'},
      metadata:{bucketName:'job-drawings',objectName:`${id}/original.pdf`,contentType:'application/pdf',cacheControl:'3600'},
      onBeforeRequest:async request=>{const fresh=await c.auth.getSession();if(fresh.data.session?.access_token)request.setHeader('authorization',`Bearer ${fresh.data.session.access_token}`);},
      onProgress:(sent,total)=>onProgress(Math.round(sent/total*100)),
      onError:()=>reject(new Error('The drawing upload did not finish. Check your connection and storage limit, then retry.')),
      onSuccess:()=>resolve(),
    });upload.start();
  });
}
export async function addDrawing(jobId: string, file: File, onProgress:(percent:number)=>void=()=>{}): Promise<{ record: DrawingRecord; bytes: Uint8Array }> {
  if (file.size > DRAWING_MAX_BYTES) throw new Error(`Choose a PDF no larger than ${DRAWING_MAX_MB} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('Choose a valid PDF drawing.');
  const c = client(), id = crypto.randomUUID();
  // Immutable original: never upsert or replace an uploaded source PDF.
  await uploadOriginal(c,id,file,onProgress);
  const record: DrawingRecord = checked(await c.from('job_drawings').insert({ id, job_id: jobId, title: file.name.replace(/\.pdf$/i, ''), file_name: file.name, content: emptyDrawing() }).select().single());
  return { record, bytes };
}
export async function saveDrawing(record: DrawingRecord, content: DrawingContent, title: string): Promise<DrawingRecord> {
  validateContent(content);
  const row = checked(await client().from('job_drawings').update({ content, title: title.trim() || record.title, revision: record.revision + 1 }).eq('id', record.id).eq('revision', record.revision).select().maybeSingle());
  if (!row) throw new Error('This drawing changed on another device. Reload it before editing further. Your unsaved markups can be downloaded below.');
  return row;
}
