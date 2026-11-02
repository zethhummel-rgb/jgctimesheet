import { memo, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { SafetyPage, SafetyNewPageType, SiteSpecificPlan } from '../lib/site-specific';
import { safetyTextPlain } from '../lib/site-specific-rich-text';
import { siteSpecificDocumentOrder, siteSpecificPdfPages } from '../lib/site-specific-pdf-content';
import { standardProcedureChoices } from '../lib/site-specific-content';

export function WorkspaceIcon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    document: 'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6',
    grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    folder: 'M3 6h7l2 3h9v11H3z M3 6V4h7l2 2h7v3',
    plus: 'M12 5v14 M5 12h14',
    grip: 'M9 5h.01 M15 5h.01 M9 12h.01 M15 12h.01 M9 19h.01 M15 19h.01',
    route: 'M5 5h5v7h9 M5 3v4 M17 10l3 2-3 2 M5 12v8h14v-3',
    shield: 'M12 3l8 3v6c0 5-8 9-8 9S4 17 4 12V6z M8 12l3 3 5-6',
    drop: 'M12 2S5 10 5 14a7 7 0 0 0 14 0c0-4-7-12-7-12z M9 14c0 2 1 3 3 3',
    emergency: 'M8 3h8v5h5v8h-5v5H8v-5H3V8h5z',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'grip' ? 3 : 1.65} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.document} /></svg>;
}

// Content previews intentionally represent editable sections, which may span
// several printed pages. PDF pagination remains owned by the existing exporter.
export const SectionPreview = memo(function SectionPreview({ page, title, type = 'section', files }: { page?: SafetyPage; title: string; type?: string; files?: string[] }) {
  const blocks = (page?.blocks || []).slice(0, 3);
  const fields = (page?.fields || []).slice(0, 3);
  return <div className={`ss-mini-sheet ss-mini-${type}`} aria-hidden="true">
    <div className="ss-mini-brand">JGC <span>JOHN GORDON CONSTRUCTION</span></div>
    <strong>{safetyTextPlain(title)}</strong>
    {type === 'cover' ? <><i>SITE SPECIFIC</i><b>Health and Safety Plan</b><span>Project information</span></> : <>
      {blocks.map(block => <div key={block.id}><b>{safetyTextPlain(block.title)}</b>{block.type === 'table' ? <div className="ss-mini-table"><span>{block.columns.map(c => c.label).join('  /  ')}</span><span>{block.rows.slice(0, 2).map(r => Object.values(r.cells).map(safetyTextPlain).filter(Boolean).join(' · ')).join(' / ') || 'Site information'}</span></div> : <p>{block.rows.slice(0, 2).map(r => safetyTextPlain('body' in r ? r.body : r.label)).join(' · ')}</p>}</div>)}
      {fields.map(field => <div key={field.id}><b>{safetyTextPlain(field.label)}</b><p>{safetyTextPlain(field.value) || 'To be completed'}</p></div>)}
      {files?.slice(0, 4).map((file, index) => <p className="ss-mini-file" key={index}>{file}</p>)}
      {!blocks.length && !fields.length && !files?.length && <div className="ss-mini-lines"><span /><span /><span /><span /></div>}
    </>}
  </div>;
});

export const SectionNavigator = memo(function SectionNavigator({ plan, selected, busy, onSelect }: { plan: SiteSpecificPlan; selected: string; busy: boolean; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false), [filter, setFilter] = useState('');
  const toggle = useRef<HTMLButtonElement>(null);
  const output = new Set(siteSpecificPdfPages(plan).map(page => page.id));
  const entries = [{ id: 'cover', title: 'Cover', page: undefined as SafetyPage | undefined }, { id: 'contents', title: 'Table of contents', page: undefined as SafetyPage | undefined }, ...plan.pages.map(page => ({ id: page.id, title: safetyTextPlain(page.title) || 'Untitled section', page }))];
  const selectedTitle = entries.find(item => item.id === selected)?.title || 'Choose a section';
  useEffect(() => { if (!open) return; const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); } }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, [open]);
  return <aside className={`ss-section-rail${open ? ' is-open' : ''}`}>
    <button ref={toggle} className="ss-mobile-sections" type="button" aria-expanded={open} aria-controls="ss-section-list" onClick={() => setOpen(!open)}><WorkspaceIcon name="document" /><span>{selectedTitle}</span><b>{open ? 'Close' : 'Sections'}</b></button>
    <div id="ss-section-list" className="ss-section-list">
      <div className="ss-rail-heading"><strong>Plan sections</strong><span>{plan.pages.length + 2}</span></div>
      <label className="ss-search"><span className="ss-visually-hidden">Find a section</span><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Find a section…" /></label>
      <nav aria-label="Plan sections">{entries.filter(item => item.title.toLowerCase().includes(filter.toLowerCase())).map(item => <button type="button" className="ss-section-link" key={item.id} data-section-id={item.id} aria-current={selected === item.id ? 'page' : undefined} disabled={busy} onClick={() => { onSelect(item.id); setOpen(false); if (matchMedia('(max-width:1200px)').matches) toggle.current?.focus(); }}>
        <SectionPreview page={item.page} title={item.title} type={item.id === 'cover' ? 'cover' : 'section'} />
        <span><strong>{item.title}</strong><small>{!item.page ? 'Always first' : !item.page.included ? 'Excluded' : output.has(item.id) ? 'Included' : 'Empty · omitted from PDF'}</small></span>
      </button>)}</nav>
      {!entries.some(item => item.title.toLowerCase().includes(filter.toLowerCase())) && <p>No matching sections.</p>}
      <p className="ss-rail-note">Section previews. Printed page numbers are calculated in the PDF.</p>
    </div>
  </aside>;
});

type OrderEntry = ReturnType<typeof siteSpecificDocumentOrder>[number];
export function PlanOrganizer({ plan, busy, canUndo, onUndo, onMove, onOpen }: { plan: SiteSpecificPlan; busy: boolean; canUndo: boolean; onUndo: () => void; onMove: (key: string, target: string, after: boolean) => void; onOpen: (item: OrderEntry) => void }) {
  const entries = siteSpecificDocumentOrder(plan, plan.pages), output = new Set(siteSpecificPdfPages(plan).map(page => page.id));
  const [dragging, setDragging] = useState(''), [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null), [announcement, setAnnouncement] = useState('');
  const drag = useRef<{ key: string; x: number; y: number; startX: number; startY: number; active: boolean } | null>(null), dropRef = useRef<typeof drop>(null), frame = useRef(0);
  const grid = useRef<HTMLDivElement>(null);
  function locate(x: number, y: number) {
    const card = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-order-key]');
    if (!card || !grid.current?.contains(card) || card.dataset.orderKey === drag.current?.key) { dropRef.current = null; setDrop(null); return; }
    const box = card.getBoundingClientRect();
    const target = { key: card.dataset.orderKey!, after: x > box.left + box.width / 2 };
    if (dropRef.current?.key === target.key && dropRef.current.after === target.after) return;
    dropRef.current = target; setDrop(target);
  }
  function finish(cancel = false) {
    const source = drag.current, target = dropRef.current;
    cancelAnimationFrame(frame.current); drag.current = null; dropRef.current = null; setDragging(''); setDrop(null);
    if (!cancel && source?.active && target) {
      onMove(source.key, target.key, target.after);
      setAnnouncement(`Moved ${safetyTextPlain(entries.find(e => e.key === source.key)?.title || 'section')} ${target.after ? 'after' : 'before'} ${safetyTextPlain(entries.find(e => e.key === target.key)?.title || 'section')}.`);
    }
  }
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') finish(true); }; document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); cancelAnimationFrame(frame.current); }; }, []);
  function start(event: PointerEvent<HTMLButtonElement>, key: string) {
    if (busy || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { key, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, active: false };
    const tick = () => { const state = drag.current; if (!state) return; if (state.active) { const delta = state.y < 150 ? -12 : state.y > innerHeight - 90 ? 12 : 0; if (delta) { window.scrollBy(0, delta); locate(state.x, state.y); } } frame.current = requestAnimationFrame(tick); };
    frame.current = requestAnimationFrame(tick);
  }
  function motion(event: PointerEvent<HTMLButtonElement>) {
    const state = drag.current; if (!state) return;
    state.x = event.clientX; state.y = event.clientY;
    if (!state.active && Math.hypot(state.x - state.startX, state.y - state.startY) > 5) { state.active = true; setDragging(state.key); }
    if (state.active) locate(state.x, state.y);
  }
  return <div className="ss-workspace-panel ss-organizer">
    <div className="ss-panel-heading"><div><span className="ss-eyebrow">DOCUMENT WORKSPACE</span><h3>Organize plan</h3><p>Drag a handle to reorder. Use the position menu or arrow keys on a handle for precise moves.</p></div><button type="button" className="button secondary" onClick={onUndo} disabled={busy || !canUndo}>Undo last move</button></div>
    <p className="ss-organizer-note">Cover and contents stay first. Sections may span several PDF pages. Selected files stay complete; JSA and certificate groups stay together.</p>
    <div className="ss-pinned-pages"><span><WorkspaceIcon name="document" />Cover <small>Fixed · 1</small></span><span><WorkspaceIcon name="document" />Table of contents <small>Fixed · 2</small></span></div>
    <p className="ss-visually-hidden" role="status">{announcement}</p>
    <div ref={grid} className="ss-organizer-grid">{entries.map((item, index) => <article key={item.key} data-order-key={item.key} className={`ss-organizer-card${dragging === item.key ? ' is-dragging' : ''}${drop?.key === item.key ? (drop.after ? ' drop-after' : ' drop-before') : ''}`}>
      <div className="ss-card-top"><span>{index + 1}</span><button type="button" className="ss-drag-handle" aria-label={`Move ${safetyTextPlain(item.title)}`} title="Drag to reorder; use arrow keys to move" disabled={busy} onPointerDown={event => start(event, item.key)} onPointerMove={motion} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => { if (drag.current) finish(true); }} onKeyDown={event => {
        const delta = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : 0;
        if (!delta || !entries[index + delta]) return; event.preventDefault(); const target = entries[index + delta]; onMove(item.key, target.key, delta > 0); setAnnouncement(`${safetyTextPlain(item.title)} moved to position ${index + delta + 1}.`);
      }}><WorkspaceIcon name="grip" /></button></div>
      <button type="button" className="ss-card-preview" disabled={busy} aria-label={`Open ${safetyTextPlain(item.title)}`} onClick={() => onOpen(item)}><SectionPreview page={item.page} title={item.title} type={item.page ? 'section' : 'file'} files={item.appendix?.items.map(file => file.title)} /></button>
      <strong className="ss-card-title">{safetyTextPlain(item.title)}</strong>
      <span className={`ss-card-status${item.page && (!item.page.included || !output.has(item.page.id)) ? ' is-muted' : ''}`}>{item.page ? !item.page.included ? 'Excluded from PDF' : output.has(item.page.id) ? 'Plan section' : 'Empty · omitted from PDF' : `${item.appendix!.items.length} complete ${item.appendix!.items.length === 1 ? 'file' : 'files'}`}</span>
      <label className="ss-position"><span>Position</span><select aria-label={`Position for ${safetyTextPlain(item.title)}`} value={index} disabled={busy} onChange={event => { const next = Number(event.target.value); if (next !== index) onMove(item.key, entries[next].key, next > index); }}>{entries.map((target, n) => <option key={target.key} value={n}>{n + 1}</option>)}</select></label>
    </article>)}</div>
    {!entries.length && <p className="ss-empty-state">Add a section or include a supporting document to start organizing.</p>}
  </div>;
}

const featured = [
  { id: 'traffic-control', title: 'Traffic control plan', icon: 'route', group: 'SITE LOGISTICS', detail: 'Access, deliveries, pedestrian routes and site controls.' },
  { id: 'spill-prevention', title: 'Spill prevention plan', icon: 'shield', group: 'ENVIRONMENT', detail: 'Equipment, storage, inspections and spill prevention.' },
  { id: 'spill-response', title: 'Spill cleanup and response plan', icon: 'drop', group: 'ENVIRONMENT', detail: 'Response steps, reporting, cleanup and incident records.' },
  { id: 'evacuation', title: 'Emergency response and evacuation', icon: 'emergency', group: 'EMERGENCY', detail: 'Adapt the response procedure to the site and work.' },
];
export function PlanTemplateGallery({ busy, onAdd, onProcedure, onSaved, onStructure, onStandard }: { busy: boolean; onAdd: (kind: SafetyNewPageType) => void; onProcedure: (id: string) => void; onSaved: () => void; onStructure: () => void; onStandard: () => void }) {
  return <div className="ss-workspace-panel ss-template-gallery">
    <div className="ss-panel-heading"><div><span className="ss-eyebrow">BUILD YOUR PLAN</span><h3>Add to plan</h3><p>Choose a starting point. Every section stays editable for this job.</p></div><button className="button secondary" type="button" disabled={busy} onClick={onSaved}>Saved pages</button></div>
    <div className="ss-template-grid">{featured.map(template => <button type="button" key={template.id} className={`ss-template-card ss-template-${template.icon}`} disabled={busy} onClick={() => onProcedure(template.id)} aria-label={`Add ${template.title}`}><span className="ss-template-icon"><WorkspaceIcon name={template.icon} size={27} /></span><small>{template.group}</small><strong>{template.title}</strong><p>{template.detail}</p><span className="ss-template-action">Add template <WorkspaceIcon name="plus" size={17} /></span></button>)}</div>
    <h4>Start with a blank section</h4><div className="ss-start-grid">{([{ id: 'custom', title: 'Blank page', detail: 'Your own text, tables and images.' }, { id: 'task', title: 'Task', detail: 'Work steps, hazards and controls.' }, { id: 'procedure', title: 'Procedure', detail: 'An editable step-by-step procedure.' }, { id: 'risk', title: 'Risk assessment', detail: 'Assess hazards and required actions.' }] as const).map(item => <button type="button" disabled={busy} key={item.id} aria-label={`Add ${item.title}`} onClick={() => onAdd(item.id)}><WorkspaceIcon name="plus" /><span><strong>{item.title}</strong><small>{item.detail}</small></span></button>)}</div>
    <h4>More JGC procedures</h4><div className="ss-procedure-list">{standardProcedureChoices.filter(item => !featured.some(feature => feature.id === item.id)).map(item => <button className="button secondary" type="button" disabled={busy} key={item.id} onClick={() => onProcedure(item.id)}>+ {item.title}</button>)}</div>
    <p className="ss-template-note">Review each template against the project requirements. Add this site’s contacts, arrangements and drawings before issuing the plan.</p>
    <details className="ss-maintenance"><summary>Maintenance for older plans</summary><p>Add missing tables or standard wording while keeping existing entries and files.</p><div className="ss-actions"><button type="button" className="button secondary" disabled={busy} onClick={onStructure}>Add structured sections</button><button type="button" className="button secondary" disabled={busy} onClick={onStandard}>Add standard JGC content</button></div></details>
  </div>;
}
