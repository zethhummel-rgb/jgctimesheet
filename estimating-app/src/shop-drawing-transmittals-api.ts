import { uploadDrawingPdf } from './drawings-api';

const bucket = 'shop-drawing-transmittals';

export interface TransmittalDetails {
  revision: number;
  drawing_updated_at: string;
  reference: string;
  filename: string;
  source_name: string;
  recipient: string;
  reviewer: string | null;
  review_status: string | null;
  review_date: string | null;
  transmittal_date: string;
  notes: string;
  page_count: number;
  stamped_pages: number[];
  byte_count: number;
}

export interface ShopTransmittal extends Omit<TransmittalDetails, 'drawing_updated_at'> {
  id: string;
  ready_at: string | null;
  downloaded_at: string | null;
  abandoned_at: string | null;
  has_pdf: boolean;
}

export interface TransmittalScope { jobId: string; drawingId: string }

function client(): any {
  const factory = (window as Window & { createJgcSupabaseClient?: () => any }).createJgcSupabaseClient;
  if (!factory) throw new Error('Sign in to the Portal to use shop drawing transmittals.');
  return factory();
}

function checked<T>(result: { data: T; error: { message?: string } | null }): T {
  if (result.error) throw new Error(result.error.message || 'The transmittal request could not finish.');
  return result.data;
}

async function manage<T>(scope: TransmittalScope, operation: string, id: string | null, details?: TransmittalDetails): Promise<T> {
  return checked<T>(await client().rpc('manage_shop_transmittal', {
    operation, transmittal_id: id, job_key: scope.jobId, drawing_key: scope.drawingId,
    ...(details ? { details } : {}),
  }));
}

export function listTransmittals(scope: TransmittalScope) {
  return manage<ShopTransmittal[]>(scope, 'list', null);
}

export function finishTransmittal(scope: TransmittalScope, id: string) {
  return manage<ShopTransmittal>(scope, 'publish', id);
}

export async function saveTransmittal(scope: TransmittalScope, id: string, details: TransmittalDetails, pdf: Blob, onProgress: (value: number) => void) {
  const entry = await manage<ShopTransmittal>(scope, 'reserve', id, details);
  if (entry.ready_at) return entry;
  if (!entry.has_pdf) {
    try {
      await uploadDrawingPdf(client(), bucket, id + '.pdf', new File([pdf], details.filename, { type: 'application/pdf' }), onProgress);
    } catch (error) {
      // The upload response can be lost after Storage has committed the file.
      return finishTransmittal(scope, id).catch(() => { throw error; });
    }
  }
  return finishTransmittal(scope, id);
}

export async function downloadTransmittal(entry: ShopTransmittal): Promise<Blob> {
  const pdf = checked<Blob>(await client().storage.from(bucket).download(entry.id + '.pdf'));
  if (pdf.size !== entry.byte_count) throw new Error('The PDF download was incomplete. Please retry.');
  return pdf;
}

async function removePdf(entry: ShopTransmittal) {
  if (entry.has_pdf) checked(await client().storage.from(bucket).remove([entry.id + '.pdf']));
}

export async function clearDownloadedTransmittal(scope: TransmittalScope, id: string) {
  await removePdf(await manage<ShopTransmittal>(scope, 'confirm', id));
  const entries = await listTransmittals(scope);
  if (entries.some(entry => entry.id === id && entry.has_pdf)) throw new Error('The PDF is still in the portal. Retry clearing it.');
  return entries;
}

export async function discardTransmittal(scope: TransmittalScope, id: string) {
  await removePdf(await manage<ShopTransmittal>(scope, 'discard', id));
  await manage(scope, 'forget', id);
}
