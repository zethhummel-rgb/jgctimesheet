import type { PDFPageProxy } from 'pdfjs-dist';
import type { Point } from './drawing-model';
export type Segment = { a: Point; b: Point };
type Matrix = number[];
const multiply = (a: Matrix, b: Matrix): Matrix => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const transform = (m: Matrix, x: number, y: number): Point => ({ x:m[0]*x+m[2]*y+m[4], y:m[1]*x+m[3]*y+m[5] });
// Real sheets have tens of thousands of lines. A page built with millions would exhaust memory, so snapping
// keeps the first DRAWING_SNAP_MAX_SEGMENTS and pauses regularly so the page stays responsive while reading.
export const DRAWING_SNAP_MAX_SEGMENTS = 600000;
const PAUSE_EVERY = 50000;
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
// PDF.js 6 packed paths must be read before canvas rendering turns them into Path2D.
export async function drawingSegments(page: PDFPageProxy, ops: Record<string, number>, limit = DRAWING_SNAP_MAX_SEGMENTS): Promise<Segment[]> {
  const list = await page.getOperatorList(), segments: Segment[] = [], stack: Matrix[] = [];
  if(list.fnArray.length>1_000_000)throw new Error('This drawing is too complex for line snapping.');
  let matrix: Matrix = [1,0,0,1,0,0], work = 0;
  read: for (let i = 0; i < list.fnArray.length; i++) {
    if (++work % PAUSE_EVERY === 0) await pause();
    const fn = list.fnArray[i], args = list.argsArray[i];
    if (fn === ops.save || fn === ops.paintFormXObjectBegin) { if(stack.length>=512)throw new Error('This drawing is too complex for line snapping.');stack.push([...matrix]); if (fn === ops.paintFormXObjectBegin && args[0]) matrix = multiply(matrix,args[0]); }
    else if (fn === ops.restore || fn === ops.paintFormXObjectEnd) matrix = stack.pop() ?? [1,0,0,1,0,0];
    else if (fn === ops.transform) matrix = multiply(matrix,args);
    else if (fn === ops.constructPath) {
      for (const path of args[1] ?? []) {
      if (!Array.isArray(path) && !ArrayBuffer.isView(path)) continue;
      const data = path as unknown as number[];
      let start: Point | undefined, previous: Point | undefined;
      for (let k = 0; k < data.length;) {
        if (segments.length >= limit) break read;
        if (++work % PAUSE_EVERY === 0) await pause();
        const command = data[k++];
        if (command === 0 || command === 1) {
          const next = transform(matrix,data[k++],data[k++]);
          if (command === 0) start = next;
          else if (previous && Math.hypot(previous.x-next.x,previous.y-next.y)>0.1) segments.push({a:previous,b:next});
          previous = next;
        } else if (command === 2) { previous = transform(matrix,data[k+4],data[k+5]);k+=6; }
        else if (command === 3) { previous = transform(matrix,data[k+2],data[k+3]);k+=4; }
        else if (command === 4) { if(previous&&start) segments.push({a:previous,b:start}); previous=start; }
        else break;
      }
      }
    }
  }
  return segments;
}
// Keep the complete vector drawing, including late, thin extension lines. A cached
// spatial index limits pointer searches to nearby lines instead of truncating PDFs.
type SegmentIndex = { cells: Map<string, number[]>; long: number[] };
const indexes = new WeakMap<Segment[], SegmentIndex>();
const cellSize = 64;
function segmentIndex(segments: Segment[]): SegmentIndex {
  const cached = indexes.get(segments);
  if (cached) return cached;
  const index: SegmentIndex = { cells: new Map(), long: [] };
  let entries=0;
  segments.forEach(({ a, b }, id) => {
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return;
    const left = Math.floor(Math.min(a.x, b.x) / cellSize), right = Math.floor(Math.max(a.x, b.x) / cellSize);
    const top = Math.floor(Math.min(a.y, b.y) / cellSize), bottom = Math.floor(Math.max(a.y, b.y) / cellSize);
    if ((right-left+1)*(bottom-top+1) > 256 || entries+(right-left+1)*(bottom-top+1)>2_000_000 || index.cells.size>150_000) { if(index.long.length<5000)index.long.push(id);return; }
    for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) {
      const key = `${x},${y}`, bucket = index.cells.get(key);
      entries++;
      if (bucket) bucket.push(id); else index.cells.set(key, [id]);
    }
  });
  indexes.set(segments, index);
  return index;
}
export function snapPoint(point: Point, segments: Segment[], tolerance: number): { point: Point; snapped: boolean } {
  if (!Number.isFinite(tolerance) || tolerance <= 0 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return { point, snapped: false };
  const index = segmentIndex(segments), candidates = new Set(index.long);
  const left = Math.floor((point.x-tolerance)/cellSize), right = Math.floor((point.x+tolerance)/cellSize);
  const top = Math.floor((point.y-tolerance)/cellSize), bottom = Math.floor((point.y+tolerance)/cellSize);
  if((right-left+1)*(bottom-top+1)>4096)return {point,snapped:false};
  for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) {
    for (const id of index.cells.get(`${x},${y}`) ?? []) candidates.add(id);
  }
  let nearest = tolerance, result: Point | undefined;
  for (const id of candidates) for (const p of [segments[id].a,segments[id].b]) { const distance=Math.hypot(p.x-point.x,p.y-point.y);if(distance<=nearest){nearest=distance;result=p;} }
  if (result) return { point: result, snapped: true };
  for (const id of candidates) {
    const {a,b} = segments[id];
    const dx=b.x-a.x,dy=b.y-a.y,span=dx*dx+dy*dy;if(!span)continue;
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/span)),p={x:a.x+t*dx,y:a.y+t*dy},distance=Math.hypot(p.x-point.x,p.y-point.y);
    if(distance<=nearest){nearest=distance;result=p;}
  }
  return { point: result ?? point, snapped: !!result };
}
