import { emptyDrawing, validateContent, type DrawingContent } from '../lib/drawing-model';
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
export async function addDrawing(jobId: string, file: File): Promise<{ record: DrawingRecord; bytes: Uint8Array }> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose a PDF smaller than 25 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder().decode(bytes.slice(0, 1024)).includes('%PDF-')) throw new Error('Choose a valid PDF drawing.');
  const c = client(), id = crypto.randomUUID();
  // Immutable original: never upsert or replace an uploaded source PDF.
  checked(await c.storage.from('job-drawings').upload(`${id}/original.pdf`, file, { contentType: 'application/pdf', upsert: false }));
  const record: DrawingRecord = checked(await c.from('job_drawings').insert({ id, job_id: jobId, title: file.name.replace(/\.pdf$/i, ''), file_name: file.name, content: emptyDrawing() }).select().single());
  return { record, bytes };
}
export async function saveDrawing(record: DrawingRecord, content: DrawingContent, title: string): Promise<DrawingRecord> {
  validateContent(content);
  const row = checked(await client().from('job_drawings').update({ content, title: title.trim() || record.title, revision: record.revision + 1 }).eq('id', record.id).eq('revision', record.revision).select().maybeSingle());
  if (!row) throw new Error('This drawing changed on another device. Reload it before editing further. Your unsaved markups can be downloaded below.');
  return row;
}
