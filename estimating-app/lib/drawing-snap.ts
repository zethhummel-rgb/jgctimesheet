import type { PDFPageProxy } from 'pdfjs-dist';
import type { Point } from './drawing-model';
export type Segment = { a: Point; b: Point };
type Matrix = number[];
const multiply = (a: Matrix, b: Matrix): Matrix => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const transform = (m: Matrix, x: number, y: number): Point => ({ x:m[0]*x+m[2]*y+m[4], y:m[1]*x+m[3]*y+m[5] });
// PDF.js 6 packed paths must be read before canvas rendering turns them into Path2D.
export async function drawingSegments(page: PDFPageProxy, ops: Record<string, number>): Promise<Segment[]> {
  const list = await page.getOperatorList(), segments: Segment[] = [], stack: Matrix[] = [];
  let matrix: Matrix = [1,0,0,1,0,0];
  for (let i = 0; i < list.fnArray.length && segments.length < 30000; i++) {
    const fn = list.fnArray[i], args = list.argsArray[i];
    if (fn === ops.save || fn === ops.paintFormXObjectBegin) { stack.push([...matrix]); if (fn === ops.paintFormXObjectBegin && args[0]) matrix = multiply(matrix,args[0]); }
    else if (fn === ops.restore || fn === ops.paintFormXObjectEnd) matrix = stack.pop() ?? [1,0,0,1,0,0];
    else if (fn === ops.transform) matrix = multiply(matrix,args);
    else if (fn === ops.constructPath) {
      const path = args[1]?.[0];
      if (!Array.isArray(path) && !ArrayBuffer.isView(path)) continue;
      const data = path as unknown as number[];
      let start: Point | undefined, previous: Point | undefined;
      for (let k = 0; k < data.length && segments.length < 30000;) {
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
  return segments;
}
export function snapPoint(point: Point, segments: Segment[], tolerance: number): { point: Point; snapped: boolean } {
  let nearest = tolerance, result: Point | undefined;
  for (const segment of segments) for (const p of [segment.a,segment.b]) { const distance=Math.hypot(p.x-point.x,p.y-point.y);if(distance<=nearest){nearest=distance;result=p;} }
  if (result) return { point: result, snapped: true };
  for (const {a,b} of segments) {
    const dx=b.x-a.x,dy=b.y-a.y,span=dx*dx+dy*dy;if(!span)continue;
    const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/span)),p={x:a.x+t*dx,y:a.y+t*dy},distance=Math.hypot(p.x-point.x,p.y-point.y);
    if(distance<=nearest){nearest=distance;result=p;}
  }
  return { point: result ?? point, snapped: !!result };
}
