import { drawingRecord, shopDrawingPdfFilename, shopDrawingRevisionLabel } from "../lib/shop-drawing-workflow";
import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { PDFDocumentProxy, PageViewport, RenderTask } from 'pdfjs-dist';
import type { Job, ShopDrawing } from '../lib/estimator-data';
import { DRAWING_MAX_BYTES, DRAWING_MAX_MB, drawingPageCountProblem, drawingPageSizeProblem, emptyDrawing, type Mark, type ReviewStamp } from '../lib/drawing-model';
import { documentDeadline } from '../lib/document-budget';
import { openDrawingPdf } from '../lib/open-drawing-pdf';
import { savePdfToDevice } from '../lib/save-pdf-to-device';
import { clearDownloadedTransmittal, discardTransmittal, downloadTransmittal, finishTransmittal, listTransmittals, saveTransmittal, type ShopTransmittal, type TransmittalDetails } from '../src/shop-drawing-transmittals-api';
import { ReviewStampGraphic, StampFields } from './drawing-controls';
import './shop-drawing-transmittal.css';

type Source = { name: string; bytes: Uint8Array; pdf: PDFDocumentProxy };
type Placement = { x: number; y: number; viewport: PageViewport; userUnit: number };
type Prepared = { id: string; details: TransmittalDetails; blob: Blob };
const aspect = 222 / 350;

function stampBox(placement: Placement, stamp: ReviewStamp) {
  const { viewport, userUnit } = placement;
  const width = Math.min(stamp.width * userUnit, viewport.width, viewport.height / aspect);
  return {
    width,
    x: Math.max(0, Math.min(placement.x * viewport.width, viewport.width - width)),
    y: Math.max(0, Math.min(placement.y * viewport.height, viewport.height - width * aspect)),
  };
}

function shopDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', dateStyle: 'short' }).format(new Date());
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Please retry.';
}

function ReviewSheet({ source, page, stamp, placement, disabled, onPlace, onError }: {
  source: Source;
  page: number;
  stamp: ReviewStamp;
  placement?: Placement;
  disabled: boolean;
  onPlace: (value: Placement) => void;
  onError: (message: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [sheet, setSheet] = useState<{ viewport: PageViewport; userUnit: number } | null>(null);
  useEffect(() => {
    let stopped = false;
    let task: RenderTask | undefined;
    async function render() {
      const pdfPage = await source.pdf.getPage(page);
      const target = canvas.current;
      if (stopped || !target) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: Math.min(1800 / Math.max(base.width, base.height), 3) });
      target.width = Math.max(1, Math.ceil(viewport.width));
      target.height = Math.max(1, Math.ceil(viewport.height));
      task = pdfPage.render({ canvas: target, viewport });
      await documentDeadline(task.promise, 30000, () => task?.cancel());
      if (!stopped) setSheet({ viewport: base, userUnit: pdfPage.userUnit });
    }
    void render().catch(error => { if (!stopped) onError(errorText(error)); });
    return () => { stopped = true; task?.cancel(); };
  }, [source, page, onError]);

  function place(event: MouseEvent<HTMLButtonElement>) {
    if (!sheet) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onPlace({
      ...sheet,
      x: event.detail === 0 ? 0.95 : (event.clientX - rect.left) / rect.width,
      y: event.detail === 0 ? 0.05 : (event.clientY - rect.top) / rect.height,
    });
  }

  const box = placement && stampBox(placement, stamp);
  return <div className="shop-review-preview">
    {!sheet && <p role="status">Rendering sheet {page}…</p>}
    <button className="shop-review-sheet" type="button" aria-label={'Place review stamp on sheet ' + page} onClick={place} disabled={disabled || !sheet} style={{ visibility: sheet ? 'visible' : 'hidden' }}>
      <canvas ref={canvas} />
      {placement && box && <span className="shop-review-stamp" style={{
        left: box.x / placement.viewport.width * 100 + '%',
        top: box.y / placement.viewport.height * 100 + '%',
        width: box.width / placement.viewport.width * 100 + '%',
      }}><ReviewStampGraphic stamp={stamp} /></span>}
    </button>
  </div>;
}

export function ShopDrawingTransmittal({ job, drawing, actor, clientName, workspaceSaved, initialFile, onClose }: {
  job: Job;
  drawing: ShopDrawing;
  actor: string;
  clientName: string;
  workspaceSaved: boolean;
  initialFile?: File;
  onClose: () => void;
}) {
  const scope = useMemo(() => ({ jobId: job.id, drawingId: drawing.id }), [job.id, drawing.id]);
  const heading = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [page, setPage] = useState(1);
  const [placements, setPlacements] = useState<Record<number, Placement>>({});
  const [stamp, setStamp] = useState<ReviewStamp>({ status: 'Reviewed', reviewer: actor.slice(0, 120), date: shopDate(), width: 175 });
  const [recipient, setRecipient] = useState(drawing.consultant.slice(0, 180));
  const [notes, setNotes] = useState('');
  const [entries, setEntries] = useState<ShopTransmittal[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const recentPdf = useRef<{ id: string; blob: Blob } | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<{ id: string; confirmed: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [renderError, setRenderError] = useState('');
  const lock = useRef(false);
  const sheetNumbers = Object.keys(placements).map(Number).sort((a, b) => a - b);

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let cancelled = false;
    void listTransmittals(scope).then(rows => { if (!cancelled) setEntries(rows); })
      .catch(error => { if (!cancelled) setHistoryError(errorText(error)); })
      .finally(() => { if (!cancelled) setLoadingHistory(false); });
    return () => { cancelled = true; };
  }, [scope]);
  useEffect(() => () => { if (source) void source.pdf.loadingTask.destroy().catch(() => {}); }, [source]);

  async function refresh() {
    setEntries(await listTransmittals(scope));
    setHistoryError('');
  }

  async function run(status: string, work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(status);
    setError('');
    setMessage('');
    try { await work(); }
    catch (error) {
      setError(error instanceof DOMException && error.name === 'AbortError' ? 'Save cancelled. The PDF is still available.' : errorText(error));
    } finally {
      setBusy('');
      lock.current = false;
    }
  }

  function close() {
    if (!lock.current) onClose();
  }

  async function openFile(file: File) {
    if (file.size > DRAWING_MAX_BYTES) throw new Error('Choose a PDF no larger than ' + DRAWING_MAX_MB + ' MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw new Error('Choose a valid PDF.');
    const pdf = await openDrawingPdf(bytes);
    try {
      const countProblem = drawingPageCountProblem(pdf.numPages);
      if (countProblem) throw new Error(countProblem);
      for (let n = 1; n <= pdf.numPages; n++) {
        const viewport = (await pdf.getPage(n)).getViewport({ scale: 1 });
        const sizeProblem = drawingPageSizeProblem(viewport.width, viewport.height, n);
        if (sizeProblem) throw new Error(sizeProblem);
      }
    } catch (error) {
      await pdf.loadingTask.destroy().catch(() => {});
      throw error;
    }
    setPlacements({});
    setPage(1);
    setRenderError('');
    setSource({ name: file.name.slice(0, 250), bytes, pdf });
  }

  useEffect(() => {
    if (initialFile) void run('Opening PDF…', () => openFile(initialFile));
    // The parent mounts this review for one file and drawing revision.
  }, [initialFile]);

  async function save() {
    if (!source) return;
    if (!workspaceSaved) throw new Error('Wait for the shop drawing register to finish saving.');
    let draft = prepared;
    if (!draft) {
      const hasStamp = sheetNumbers.length > 0;
      const reviewer = stamp.reviewer.trim();
      if (!recipient.trim()) throw new Error('Enter the transmittal recipient.');
      if (hasStamp && (!reviewer || !/^\d{4}-\d{2}-\d{2}$/.test(stamp.date))) {
        throw new Error('Enter the reviewer and review date for the stamp.');
      }
      const id = crypto.randomUUID();
      const reference = drawing.number + '-R' + drawing.revision + '-' + id.slice(0, 8).toUpperCase();
      const details: Omit<TransmittalDetails, 'byte_count'> = {
        revision: drawing.revision, drawing_updated_at: drawing.updatedAt || drawing.createdAt || '',
        reference, filename: shopDrawingPdfFilename(drawing),
        source_name: source.name, recipient: recipient.trim(), reviewer: hasStamp ? reviewer : null,
        review_status: hasStamp ? stamp.status : null, review_date: hasStamp ? stamp.date : null,
        transmittal_date: shopDate(), notes: notes.trim(),
        page_count: source.pdf.numPages, stamped_pages: sheetNumbers,
      };
      const content = emptyDrawing();
      content.marks = sheetNumbers.map((sheet): Mark => {
        const placement = placements[sheet], box = stampBox(placement, stamp);
        const [x, y] = placement.viewport.convertToPdfPoint(box.x, box.y);
        return {
          id: crypto.randomUUID(), page: sheet, kind: 'stamp', points: [{ x, y }], color: '#b31a1f', text: '',
          rotation: placement.viewport.rotation, author: actor, createdAt: new Date().toISOString(), layer: 'Review',
          stamp: { ...stamp, reviewer, width: box.width / placement.userUnit },
        };
      });
      const { shopDrawingTransmittalPdf } = await import('../lib/shop-drawing-transmittal-pdf');
      const bytes = await shopDrawingTransmittalPdf(source.bytes, content, {
        jobNumber: job.jobNumber, project: job.portalJobName || job.project,
        client: job.portalCustomer || clientName, drawingNumber: drawing.number, title: drawing.title,
        vendor: drawing.vendorName, details,
      });
      if (bytes.byteLength > DRAWING_MAX_BYTES) throw new Error('The transmittal exceeds the ' + DRAWING_MAX_MB + ' MB limit. Choose a smaller drawing PDF.');
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/pdf' });
      draft = { id, details: { ...details, byte_count: blob.size }, blob };
      setPrepared(draft);
    }
    const saved = await saveTransmittal(scope, draft.id, draft.details, draft.blob, progress => setBusy('Saving PDF · ' + progress + '%'));
    recentPdf.current = saved.has_pdf ? { id: saved.id, blob: draft.blob } : null;
    setEntries(rows => [saved, ...rows.filter(row => row.id !== saved.id)]);
    setPrepared(null);
    setSource(null);
    setPlacements({});
    setMessage('Transmittal saved. Download the PDF from history below.');
    setHistoryError('');
  }

  async function clear(id: string) {
    setPendingConfirmation({ id, confirmed: true });
    setEntries(await clearDownloadedTransmittal(scope, id));
    if (recentPdf.current?.id === id) recentPdf.current = null;
    setPendingConfirmation(null);
    setMessage('PDF saved to your device and cleared from the portal.');
  }

  async function download(entry: ShopTransmittal) {
    const blob = recentPdf.current?.id === entry.id ? recentPdf.current.blob : await downloadTransmittal(entry);
    const legacyFilename = entry.reference.replace(/[^a-z0-9._-]+/gi, '-') + '-Transmittal.pdf';
    const revision = drawing.revisions.find(item => item.revision === entry.revision);
    const snapshot = revision ? drawingRecord(revision.snapshot) : {};
    const originalNumber = typeof snapshot.number === 'string' && snapshot.number ? snapshot.number : drawing.number;
    const previousPrefix = shopDrawingPdfFilename({ number: originalNumber, title: '' }).slice(0, -4) + '- ';
    let filename = entry.filename;
    if (filename === legacyFilename) {
      filename = shopDrawingPdfFilename({
        number: drawing.number, revision: entry.revision,
        title: typeof snapshot.title === 'string' && snapshot.title ? snapshot.title : drawing.title,
      });
    } else if (entry.revision > 0 && filename.startsWith(previousPrefix)) {
      filename = shopDrawingPdfFilename({ number: drawing.number, revision: entry.revision, title: filename.slice(previousPrefix.length) });
    }
    if (await savePdfToDevice(blob, filename)) await clear(entry.id);
    else setPendingConfirmation({ id: entry.id, confirmed: false });
  }

  const waiting = !!busy;
  return <dialog ref={dialog} className="shop-review-dialog" aria-labelledby={heading} onCancel={event => { event.preventDefault(); close(); }}>
    <header className="shop-review-header">
      <div><h2 id={heading}>Review shop drawing</h2><p>{shopDrawingRevisionLabel(drawing.number, drawing.revision)} · {drawing.title}</p></div>
      <button type="button" className="button secondary" onClick={close} disabled={waiting}>Close</button>
    </header>
    <div className="shop-review-body">
      {error && <p className="shop-drawing-message error" role="alert">{error}</p>}
      {(busy || message) && <p className="shop-drawing-message success" role="status">{busy || message}</p>}
      <div className="shop-review-source">
        <button className="button secondary" type="button" disabled={waiting || !!prepared} onClick={() => fileInput.current?.click()}>{source ? 'Choose another PDF' : 'Choose drawing PDF'}</button>
        {!source && <span>Up to {DRAWING_MAX_MB} MB</span>}
        <input ref={fileInput} hidden type="file" accept=".pdf,application/pdf" disabled={waiting || !!prepared} onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void run('Opening PDF…', () => openFile(file));
        }} />
      </div>
      {source && <>
        <p className="shop-review-source-name">{source.name} · {source.pdf.numPages} {source.pdf.numPages === 1 ? 'sheet' : 'sheets'}</p>
        <div className="shop-review-editor">
          <div className="shop-review-options">
            <StampFields value={stamp} onChange={setStamp} disabled={waiting || !!prepared} />
            <label className="field"><span>Transmitted to *</span><input value={recipient} onChange={event => setRecipient(event.target.value)} maxLength={180} disabled={waiting || !!prepared} /></label>
            <label className="field"><span>Transmittal notes</span><textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} maxLength={1500} disabled={waiting || !!prepared} /></label>
          </div>
          <section className="shop-review-viewer" aria-label="Shop drawing sheets">
            <div className="shop-review-toolbar">
              <button type="button" className="button secondary compact" disabled={page <= 1 || waiting} onClick={() => { setRenderError(''); setPage(page - 1); }}>Previous sheet</button>
              <span>Sheet {page} of {source.pdf.numPages}</span>
              <button type="button" className="button secondary compact" disabled={page >= source.pdf.numPages || waiting} onClick={() => { setRenderError(''); setPage(page + 1); }}>Next sheet</button>
            </div>
            <p>To add a review stamp, tap or click the sheet. You can save without a stamp.</p>
            {renderError && <p role="alert">{renderError}</p>}
            <ReviewSheet key={page} source={source} page={page} stamp={stamp} placement={placements[page]} disabled={waiting || !!prepared} onError={setRenderError} onPlace={value => setPlacements(previous => ({ ...previous, [page]: value }))} />
            <div className="shop-review-toolbar">
              <span>{sheetNumbers.length ? 'Stamped sheets: ' + sheetNumbers.join(', ') : 'No stamp placed'}</span>
              {placements[page] && <button type="button" className="button secondary compact" disabled={waiting || !!prepared} onClick={() => setPlacements(previous => {
                const next = { ...previous };
                delete next[page];
                return next;
              })}>Remove stamp from this sheet</button>}
            </div>
          </section>
        </div>
        <div className="shop-review-toolbar">
          <button type="button" className="button primary" disabled={waiting || loadingHistory || !!historyError || !workspaceSaved} onClick={() => void run('Creating transmittal PDF…', save)}>{prepared ? 'Retry saving transmittal' : 'Save transmittal'}</button>
          {!workspaceSaved && <span>Waiting for the shop drawing register to finish saving.</span>}
          {prepared && <button type="button" className="button secondary" disabled={waiting} onClick={() => void run('Discarding unfinished transmittal…', async () => {
            const rows = await listTransmittals(scope);
            if (rows.some(row => row.id === prepared.id && !row.ready_at)) await discardTransmittal(scope, prepared.id);
            setPrepared(null);
            await refresh();
          })}>Discard unfinished PDF</button>}
        </div>
      </>}
      <section className="shop-review-history" aria-label="Transmittal history">
        <div className="shop-review-toolbar"><h3>Transmittal history</h3><button type="button" className="button secondary compact" disabled={waiting || loadingHistory} onClick={() => void run('Refreshing history…', refresh)}>Refresh</button></div>
        {loadingHistory && <p>Loading history…</p>}
        {historyError && <p role="alert">{historyError}</p>}
        {!loadingHistory && !historyError && !entries.length && <p>No transmittals saved for this drawing.</p>}
        {entries.map(entry => <article key={entry.id} className="shop-review-history-item">
          <div>
            <strong>{entry.reference}</strong>
            <p>Revision {entry.revision} · {entry.transmittal_date}{entry.review_status ? ' · ' + entry.review_status : ''}</p>
            <p>To {entry.recipient}{entry.reviewer ? ' · Reviewed by ' + entry.reviewer : ''}</p>
            <p>{entry.stamped_pages.length ? 'Stamped sheets: ' + entry.stamped_pages.join(', ') : 'No review stamp'}</p>
            {entry.notes && <p className="shop-review-notes">{entry.notes}</p>}
          </div>
          <div className="shop-review-history-actions">
            {entry.ready_at && entry.has_pdf && !entry.downloaded_at && pendingConfirmation?.id !== entry.id && <button type="button" className="button primary" disabled={waiting || !!pendingConfirmation} onClick={() => void run('Opening download…', () => download(entry))}>Download PDF</button>}
            {pendingConfirmation?.id === entry.id && !pendingConfirmation.confirmed && <>
              <p>Check that the PDF is saved on your device before clearing it.</p>
              <button type="button" className="button primary" disabled={waiting} onClick={() => void run('Clearing saved PDF…', () => clear(entry.id))}>PDF saved — clear from portal</button>
              <button type="button" className="button secondary" disabled={waiting} onClick={() => setPendingConfirmation(null)}>Keep PDF</button>
            </>}
            {(pendingConfirmation?.id === entry.id && pendingConfirmation.confirmed || entry.downloaded_at && entry.has_pdf) && <button type="button" className="button secondary" disabled={waiting} onClick={() => void run('Clearing saved PDF…', () => clear(entry.id))}>Retry clearing PDF</button>}
            {entry.ready_at && !entry.has_pdf && <span>{entry.downloaded_at ? 'Downloaded · PDF cleared' : 'PDF unavailable'}</span>}
            {!entry.ready_at && entry.id !== prepared?.id && <>
              <span>Unfinished transmittal</span>
              {entry.has_pdf && !entry.abandoned_at && <button type="button" className="button primary" disabled={waiting} onClick={() => void run('Finishing upload…', async () => {
                const saved = await finishTransmittal(scope, entry.id);
                setEntries(rows => rows.map(row => row.id === saved.id ? saved : row));
              })}>Finish saving</button>}
              <button type="button" className="button secondary" disabled={waiting} onClick={() => void run('Removing unfinished PDF…', async () => { await discardTransmittal(scope, entry.id); await refresh(); })}>Remove unfinished PDF</button>
            </>}
          </div>
        </article>)}
      </section>
    </div>
  </dialog>;
}
