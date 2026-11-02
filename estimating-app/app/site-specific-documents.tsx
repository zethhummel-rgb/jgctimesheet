import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Job } from '../lib/estimator-data';
import { sitePlanDate, type SafetyAttachment } from '../lib/site-specific';
import { certificateType, documentCategories, documentCategory, type DocumentCategory } from '../lib/site-specific-workspace';
import { readSafetyAttachment } from '../src/site-specific-api';
import { WorkspaceIcon } from './site-specific-workspace';

function DocumentPreview({ job, item, onClose }: { job: Job; item: SafetyAttachment; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState(''), [isImage, setIsImage] = useState(false), [error, setError] = useState(''), [count, setCount] = useState(0), [number, setNumber] = useState(1), [ready, setReady] = useState(false), [retry, setRetry] = useState(0);
  const [pdf, setPdf] = useState<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { previous?.focus(); }; }, []);
  useEffect(() => {
    let active = true, objectUrl = '', task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    setError(''); setReady(false); setCount(0); setPdf(null); setUrl(''); setNumber(1);
    void (async () => {
      const blob = await readSafetyAttachment(job, item);
      if (!active) return;
      if (blob.size > 20 * 1024 * 1024) throw new Error('This file exceeds the 20 MB preview limit.');
      const image = /image\/(png|jpeg|webp)/.test(blob.type || item.fileType || ''); setIsImage(image);
      if (!image) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const { validatePdfIsolated } = await import('../lib/document-worker-client'); await validatePdfIsolated(bytes);
        if (!active) return;
        const engine = await import('pdfjs-dist/legacy/build/pdf.mjs');
        engine.GlobalWorkerOptions.workerSrc = './supplier-import/pdf.worker.min.mjs';
        if (!active) return;
        task = engine.getDocument({ data: bytes, maxImageSize: 16_000_000 });
        const loaded = await task.promise; if (!active) { void task.destroy(); return; } setPdf(loaded); setCount(loaded.numPages);
      }
      if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }
    })().catch(e => { if (active) setError(e instanceof Error ? e.message : 'The file could not load.'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); void task?.destroy(); };
  }, [job.id, item.id, retry]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true, render: import('pdfjs-dist').RenderTask | undefined;
    setReady(false);
    void (async () => {
      const page = await pdf.getPage(number); if (!active || !canvas.current) return;
      const original = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: Math.min(1.5, 1100 / Math.max(original.width, original.height)) });
      const target = canvas.current; target.width = Math.ceil(viewport.width); target.height = Math.ceil(viewport.height);
      render = page.render({ canvas: target, viewport }); await render.promise; if (active) setReady(true);
    })().catch(e => { if (active) setError(e instanceof Error ? e.message : 'This page could not be displayed.'); });
    return () => { active = false; render?.cancel(); };
  }, [pdf, number]);
  return <dialog ref={dialog} className="ss-preview-dialog" aria-labelledby="ss-preview-title" onCancel={onClose}>
    <div className="ss-preview-heading"><div><small>SUPPORTING DOCUMENT</small><h3 id="ss-preview-title">{item.title}</h3></div><button className="button secondary" type="button" onClick={onClose}>Close preview</button></div>
    <div className="ss-preview-tools">{count > 0 && <><button type="button" className="button secondary" disabled={number <= 1} onClick={() => setNumber(n => n - 1)}>Previous</button><span>Page {number} of {count}</span><button type="button" className="button secondary" disabled={number >= count} onClick={() => setNumber(n => n + 1)}>Next</button></>}{url && <a href={url} download={item.fileName} className="button secondary">Download original</a>}</div>
    {error ? <p className="ss-message error" role="alert">{error} <button type="button" className="button secondary" onClick={() => setRetry(n => n + 1)}>Retry preview</button></p> : <>
      {!ready && <p role="status">Loading document preview…</p>}
      <div className="ss-preview-content">{isImage ? url && <img src={url} alt={item.title} onLoad={() => setReady(true)} onError={() => setError('This image could not be displayed.')} /> : <canvas ref={canvas} aria-label={`Page ${number} of ${item.title}`} style={{ visibility: ready ? 'visible' : 'hidden' }} />}</div>
    </>}
  </dialog>;
}

export function SupportingDocuments({ job, items, busy, onLoad, onInclude, onCategory, upload }: { job: Job; items: SafetyAttachment[]; busy: boolean; onLoad: () => void; onInclude: (item: SafetyAttachment, selected: boolean) => void; onCategory: (item: SafetyAttachment, category: DocumentCategory) => void; upload: ReactNode }) {
  const [search, setSearch] = useState(''), [category, setCategory] = useState('all'), [selectedOnly, setSelectedOnly] = useState(false), [preview, setPreview] = useState<SafetyAttachment | null>(null);
  const selected = items.filter(item => item.included).length;
  const filtered = items.filter(item => (!selectedOnly || item.included) && (category === 'all' || documentCategory(item) === category) && `${item.title} ${item.fileName} ${item.category || ''} ${item.kind === 'certificate' ? certificateType(item) : ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  function row(item: SafetyAttachment) {
    const expired = !!item.expiryDate && item.expiryDate < sitePlanDate();
    return <div className={`ss-document-row${item.included ? ' is-included' : ''}`} key={item.id}>
      <label className="ss-document-choice"><input type="checkbox" disabled={busy} checked={item.included} onChange={event => onInclude(item, event.target.checked)} /><span><strong>{item.title}</strong><small>{item.fileName}{item.expiryDate && <span className={expired ? 'ss-expired' : ''}> · {expired ? 'Expired' : 'Expires'} {item.expiryDate}</span>}</small>{item.kind === 'certificate' && <small>Portal certificate · Including selects restricted PDF access</small>}</span></label>
      <div className="ss-document-tools"><button type="button" className="button secondary" disabled={busy} aria-label={`Preview ${item.title}`} onClick={() => setPreview(item)}>Preview</button>{item.kind !== 'certificate' && <details><summary aria-label={`Category for ${item.title}`}>Category</summary><label><span className="ss-visually-hidden">Category for {item.title}</span><select disabled={busy} value={documentCategory(item)} onChange={event => onCategory(item, event.target.value as DocumentCategory)}>{documentCategories.filter(c => c.id !== 'certificates').map(c => <option value={c.id} key={c.id}>{c.title}</option>)}</select></label></details>}</div>
    </div>;
  }
  return <div className="ss-workspace-panel ss-documents">
    <div className="ss-panel-heading"><div><span className="ss-eyebrow">DOCUMENT LIBRARY</span><h3>Supporting documents</h3><p>{selected} of {items.length} files included. Selected originals are appended in full to your PDF.</p></div><button type="button" className="button secondary" disabled={busy} onClick={onLoad}>Load Portal documents</button></div>
    <div className="ss-document-filters"><label className="ss-search"><span className="ss-visually-hidden">Find supporting documents</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a worker, certificate or file…" /></label><label className="ss-selected-filter"><input type="checkbox" checked={selectedOnly} onChange={event => setSelectedOnly(event.target.checked)} />Included only</label></div>
    <div className="ss-category-tabs" role="group" aria-label="Document categories"><button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>All documents <span>{items.length}</span></button>{documentCategories.map(group => <button type="button" key={group.id} aria-pressed={category === group.id} onClick={() => setCategory(group.id)}>{group.title}<span>{items.filter(item => documentCategory(item) === group.id).length}</span></button>)}</div>
    {!items.length ? <div className="ss-empty-state"><WorkspaceIcon name="folder" size={36} /><h4>Your supporting files, in one place</h4><p>Load documents from the Portal or upload files below, then choose what to include.</p></div> : !filtered.length ? <div className="ss-empty-state"><p>No documents match these filters.</p><button type="button" className="button secondary" onClick={() => { setSearch(''); setCategory('all'); setSelectedOnly(false); }}>Clear filters</button></div> : documentCategories.map(group => {
      const members = filtered.filter(item => documentCategory(item) === group.id); if (!members.length) return null;
      const types = [...new Set(members.map(certificateType))].sort((a, b) => a.localeCompare(b));
      return <section className="ss-document-group" key={group.id} aria-label={group.title}><div className="ss-group-heading"><WorkspaceIcon name={group.id === 'certificates' ? 'shield' : 'folder'} /><div><h4>{group.title}</h4><p>{group.description}</p></div><span>{members.filter(item => item.included).length} / {members.length} included</span></div>{group.id === 'certificates' ? types.map(type => { const certificates = members.filter(item => certificateType(item) === type); return <details key={type} className="ss-certificate-group" open={types.length <= 4 || !!search}><summary>{type}<span>{certificates.filter(item => item.included).length} / {certificates.length} included</span></summary>{certificates.map(row)}</details>; }) : members.map(row)}</section>;
    })}
    <div className="ss-library-upload"><WorkspaceIcon name="plus" /><div><h4>Add supporting files</h4>{upload}</div></div>
    <p className="ss-library-note">Categories organize this plan’s library. Original Portal files stay unchanged. Use Organize plan to choose where selected documents appear in the PDF.</p>
    {preview && <DocumentPreview key={preview.id} job={job} item={preview} onClose={() => setPreview(null)} />}
  </div>;
}
