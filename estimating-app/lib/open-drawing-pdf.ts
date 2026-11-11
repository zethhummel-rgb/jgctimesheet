import { pdfDecoderOptions } from './pdf-decoder-options';
import { validatePdfIsolated } from './document-worker-client';
let engine: ReturnType<typeof importEngine> | undefined;
async function importEngine() { const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs'); pdf.GlobalWorkerOptions.workerSrc = './supplier-import/pdf.worker.min.mjs'; return pdf; }
export async function openDrawingPdf(bytes: Uint8Array) { await validatePdfIsolated(bytes);engine ??= importEngine(); const pdf = await engine; return pdf.getDocument({ ...pdfDecoderOptions, data: bytes.slice() }).promise; }
