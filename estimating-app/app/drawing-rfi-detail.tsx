import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { renderDrawingDetail, type DrawingDetail } from '../lib/drawing-detail';
import { photoFromCanvas, type PhotoUpload } from '../lib/rfi-photos';
import type { Rfi } from '../lib/rfi-workflow';
import { DrawingIcon } from './drawing-controls';
import './drawing-rfi-detail.css';

type Tool = 'Arrow' | 'Box' | 'Pen';
type Point = { x: number; y: number };
type Stroke = { tool: Tool; points: Point[] };
const ink = '#bf242c';

function strokePath({ tool, points }: Stroke, weight: number) {
  const a = points[0], b = points[points.length - 1];
  const start = `M ${a.x} ${a.y}`;
  if (tool === 'Box') return `${start} H ${b.x} V ${b.y} H ${a.x} Z`;
  if (tool === 'Pen') return start + points.slice(1).map(p => ` L ${p.x} ${p.y}`).join('');
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = Math.min(weight * 4, Math.hypot(b.x - a.x, b.y - a.y) * 0.45);
  const wing = (offset: number) => `${b.x - head * Math.cos(angle + offset)} ${b.y - head * Math.sin(angle + offset)}`;
  return `${start} L ${b.x} ${b.y} M ${wing(-0.55)} L ${b.x} ${b.y} L ${wing(0.55)}`;
}

export function DrawingRfiDetail({ detail, drafts, unsavedSubject, initialTarget, onAttach, onClose }: {
  detail: DrawingDetail; drafts: Rfi[]; unsavedSubject?: string; initialTarget: string;
  onAttach: (photo: PhotoUpload, target: string) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), base = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<{ pointer: number; stroke: Stroke } | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [target, setTarget] = useState(initialTarget), [tool, setTool] = useState<Tool>('Arrow');
  const [strokes, setStrokes] = useState<Stroke[]>([]), [preview, setPreview] = useState<Stroke | null>(null);
  const weight = Math.max(2, Math.max(detail.pixelsWide, detail.pixelsHigh) / 260);

  useEffect(() => {
    const modal = dialog.current!;
    modal.showModal();
    const controller = new AbortController();
    void renderDrawingDetail(detail, base.current!, controller.signal)
      .then(() => { if (!controller.signal.aborted) setReady(true); })
      .catch(() => { if (!controller.signal.aborted) setError('The drawing detail could not be prepared. Close this preview and try again.'); });
    return () => { controller.abort(); modal.close(); };
  }, [detail]);

  function point(event: PointerEvent<SVGSVGElement>): Point {
    const svg = event.currentTarget;
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.max(0, Math.min(detail.pixelsWide, local.x)), y: Math.max(0, Math.min(detail.pixelsHigh, local.y)) };
  }
  function start(event: PointerEvent<SVGSVGElement>) {
    if (!ready || gesture.current || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke = { tool, points: [point(event)] };
    gesture.current = { pointer: event.pointerId, stroke };
    setPreview(stroke);
  }
  function move(event: PointerEvent<SVGSVGElement>, finish = false) {
    const active = gesture.current;
    if (active?.pointer !== event.pointerId) return;
    const next = point(event);
    const previous = active.stroke.points;
    const stroke = { tool: active.stroke.tool, points: active.stroke.tool === 'Pen' ? [...previous, next] : [previous[0], next] };
    if (finish) {
      if (stroke.points.some(p => Math.hypot(p.x - previous[0].x, p.y - previous[0].y) >= 1)) setStrokes(old => [...old, stroke]);
      gesture.current = null;
      setPreview(null);
    } else { active.stroke = stroke; setPreview(stroke); }
  }
  function attach() {
    if (!ready || !base.current) return;
    try {
      const output = document.createElement('canvas');
      output.width = detail.pixelsWide;
      output.height = detail.pixelsHigh;
      const context = output.getContext('2d');
      if (!context) throw new Error('This device could not prepare the RFI image.');
      context.drawImage(base.current, 0, 0);
      context.strokeStyle = ink;
      context.lineWidth = weight;
      context.lineCap = context.lineJoin = 'round';
      for (const stroke of strokes) context.stroke(new Path2D(strokePath(stroke, weight)));
      onAttach(photoFromCanvas(output, detail.label.slice(0, 185) + ' - Detail.jpg'), target);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'The detail could not be attached. Try again.'); }
  }
  return <dialog ref={dialog} className="drawing-rfi-dialog" aria-label="Drawing detail for RFI"
    onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation(); }}
    onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><div><h2>Drawing detail for RFI</h2><p>{detail.label}</p></div><button type="button" className="button secondary compact" onClick={onClose}>Cancel</button></header>
    <div className="drawing-rfi-tools" role="toolbar" aria-label="RFI markup tools">
      {(['Arrow', 'Box', 'Pen'] as const).map(name => <button key={name} type="button" className="button secondary compact" disabled={!ready}
        aria-pressed={tool === name} onClick={() => setTool(name)}><DrawingIcon name={{ Arrow: 'arrow', Box: 'rectangle', Pen: 'pen' }[name]} />{name}</button>)}
      <button type="button" className="button secondary compact" disabled={!strokes.length} onClick={() => setStrokes(old => old.slice(0, -1))}><DrawingIcon name="undo"/>Undo</button>
    </div>
    <div className="drawing-rfi-preview">
      <canvas ref={base} width={detail.pixelsWide} height={detail.pixelsHigh} aria-label="Captured drawing detail"/>
      <svg width={detail.pixelsWide} height={detail.pixelsHigh} viewBox={`0 0 ${detail.pixelsWide} ${detail.pixelsHigh}`}
        aria-label="Mark up this RFI detail" onPointerDown={start} onPointerMove={e => move(e)} onPointerUp={e => move(e, true)}
        onPointerCancel={() => { gesture.current = null; setPreview(null); }}>
        <g fill="none" stroke={ink} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round">
          {(preview ? [...strokes, preview] : strokes).map((stroke, i) => <path key={i} d={strokePath(stroke, weight)} />)}
        </g>
      </svg>
    </div>
    <p className="drawing-rfi-hint">{ready ? 'Marks added here appear only on the RFI attachment.' : !error && 'Preparing the visible drawing area…'}</p>
    {error && <p role="alert" className="drawing-rfi-error">{error}</p>}
    <footer><label>Attach to<select value={target} onChange={e => { setTarget(e.target.value); setError(''); }}>
      <option value="new">New RFI</option>
      {unsavedSubject !== undefined && <option value="unsaved">Continue unsaved RFI{unsavedSubject && ' — ' + unsavedSubject}</option>}
      {drafts.map(r => <option key={r.id} value={r.id}>{r.number} — {r.subject}</option>)}
    </select></label><button type="button" className="button primary" disabled={!ready} onClick={attach}>Attach and open RFI</button></footer>
  </dialog>;
}
