export type Point = { x: number; y: number };
export const DRAWING_MAX_MB = 50;
export const DRAWING_MAX_BYTES = DRAWING_MAX_MB * 1024 * 1024;
export const SCALE_UNITS = ['ft', 'in', 'ft-in', 'm', 'cm', 'mm'] as const;
export const MEASUREMENT_UNITS = [...SCALE_UNITS, 'yd'] as const;
export type MeasurementUnit = typeof MEASUREMENT_UNITS[number];
export const REVIEW_STATUSES = ['Reviewed', 'Reviewed as noted', 'Revise and resubmit', 'For record only'] as const;
export type ReviewStamp = { status: typeof REVIEW_STATUSES[number]; reviewer: string; date: string; width: number };
export type MarkKind = 'pen' | 'line' | 'rectangle' | 'highlight' | 'text' | 'distance' | 'area' | 'perimeter' | 'callout' | 'stamp';
export type MeasurementCalibration = Pick<Scale, 'unit' | 'unitsPerPoint'>;
export type Mark = { id: string; page: number; kind: MarkKind; points: Point[]; color: string; text: string; rotation?: number; dimensionOffset?: number; calibration?: MeasurementCalibration; stamp?: ReviewStamp; author: string; createdAt: string; layer: 'Review' | 'As-built' };
export type Scale = { unitsPerPoint: number; unit: typeof SCALE_UNITS[number]; displayUnit?: MeasurementUnit; reference: Point[]; knownLength: number };
// Page IDs always refer to source PDF pages. Reordering does not move their markups or scale.
export type DrawingContent = { version: 1; marks: Mark[]; scales: Record<string, Scale>; pageOrder?: number[]; archived?: boolean };
export const emptyDrawing = (): DrawingContent => ({ version: 1, marks: [], scales: {} });
export const length = (points: Point[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
export const area = (points: Point[]) => Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
export function calibrate(points: Point[], knownLength: number, unit: Scale['unit']): Scale {
  const span = length(points);
  if (points.length !== 2 || span < 1 || !Number.isFinite(knownLength) || knownLength <= 0) throw new Error('Click both ends of a reference line and enter a positive known length.');
  return { unitsPerPoint: knownLength / span, unit, displayUnit: unit, reference: points, knownLength };
}
function formatLength(value:number,unit:MeasurementUnit):string {
  if (unit !== 'ft-in') return `${value.toFixed(unit === 'm' ? 3 : 2)} ${unit}`;
  const inches = Math.round(value * 12 * 16) / 16;
  const feet = Math.floor(inches / 12), rest = Math.round((inches - feet * 12) * 16) / 16;
  return `${feet} ft ${rest} in`;
}
export const scaleReferenceLabel=(scale:Scale)=>`Scale reference - ${formatLength(scale.knownLength,scale.unit)}`;
export function measurement(mark: Pick<Mark,'kind'|'points'> & Partial<Pick<Mark,'calibration'>>, scale?: Scale): string {
  const calibration = mark.calibration ?? scale;
  if (!calibration) return 'Set page scale';
  const unit = scale?.displayUnit ?? (calibration.unit === 'ft' ? 'ft-in' : calibration.unit);
  const metres: Record<MeasurementUnit,number> = {ft:.3048,'ft-in':.3048,in:.0254,m:1,cm:.01,mm:.001,yd:.9144};
  const factor=metres[calibration.unit]/metres[unit],unitsPerPoint=calibration.unitsPerPoint*factor;
  const value = mark.kind === 'area' ? area(mark.points) * unitsPerPoint ** 2 : length(mark.kind==='perimeter'?[...mark.points,mark.points[0]]:mark.points) * unitsPerPoint;
  if (mark.kind === 'area') return `${value.toFixed(2)} sq ${unit === 'ft-in' ? 'ft' : unit}`;
  return formatLength(value,unit);
}
export const isMeasurement = (kind: string) => ['distance', 'area', 'perimeter'].includes(kind);
export function replacePageScale(content: DrawingContent, page: number, scale: Scale): DrawingContent {
  const previous = content.scales[String(page)];
  return { ...content, scales: { ...content.scales, [page]: scale }, marks: content.marks.map(mark => previous && mark.page === page && isMeasurement(mark.kind) && !mark.calibration
    ? { ...mark, calibration: { unit: previous.unit, unitsPerPoint: previous.unitsPerPoint } }
    : mark) };
}
export function dimensionGeometry(mark: Mark) {
  const [a,b]=mark.points,span=Math.hypot(b.x-a.x,b.y-a.y)||1,normal={x:-(b.y-a.y)/span,y:(b.x-a.x)/span},offset=mark.dimensionOffset??0;
  const start={x:a.x+normal.x*offset,y:a.y+normal.y*offset},end={x:b.x+normal.x*offset,y:b.y+normal.y*offset};
  return {a,b,normal,start,end,middle:{x:(start.x+end.x)/2,y:(start.y+end.y)/2}};
}
export function drawingPageOrder(content: DrawingContent, count: number): number[] {
  const order = content.pageOrder ?? Array.from({ length: count }, (_, i) => i + 1);
  if (order.length !== count || new Set(order).size !== count || order.some(n => !Number.isInteger(n) || n < 1 || n > count)) throw new Error('The saved page order does not match this PDF.');
  return order;
}
export function reorderDrawingPages(order: number[], selected: number[], target: number | null, after = false): number[] {
  const selection = new Set(selected);
  if (!selection.size || (target !== null && selection.has(target))) return order;
  const moving = order.filter(page => selection.has(page)), remaining = order.filter(page => !selection.has(page));
  if (!moving.length || (target !== null && !remaining.includes(target))) return order;
  const index = target === null ? remaining.length : remaining.indexOf(target) + (after ? 1 : 0);
  return [...remaining.slice(0, index), ...moving, ...remaining.slice(index)];
}
export function commentLines(text: string, limit = 27): string[] {
  return (text || 'Add a comment').split('\n').flatMap(line => {
    const words = line.match(new RegExp(`.{1,${limit}}(?:\\s|$)|.{1,${limit}}`, 'g'));
    return words?.map(word => word.trimEnd()) ?? [''];
  });
}
export function validateContent(value: unknown): DrawingContent {
  const v = value as DrawingContent;
  if (!v || v.version !== 1 || !Array.isArray(v.marks) || v.marks.length > 5000 || !v.scales || typeof v.scales !== 'object') throw new Error('This drawing markup record is not supported.');
  if (v.archived !== undefined && typeof v.archived !== 'boolean') throw new Error('Invalid drawing list status.');
  for (const m of v.marks) {
    if (!['pen','line','rectangle','highlight','text','distance','area','perimeter','callout','stamp'].includes(m.kind) || !Number.isInteger(m.page) || m.page < 1 || !Array.isArray(m.points) || !m.points.length || m.points.length>20000 || typeof m.id!=='string' || typeof m.author!=='string' || !['Review','As-built'].includes(m.layer) || typeof m.createdAt!=='string' || !Number.isFinite(Date.parse(m.createdAt)) || m.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || !/^#[0-9a-f]{6}$/i.test(m.color) || typeof m.text !== 'string' || (m.rotation !== undefined && !Number.isFinite(m.rotation))) throw new Error('Invalid drawing markup.');
    if (m.kind === 'callout' && m.points.length !== 2) throw new Error('An arrow comment needs two points.');
    if (m.kind === 'distance' && (m.points.length !== 2 || (m.dimensionOffset !== undefined && (!Number.isFinite(m.dimensionOffset) || Math.abs(m.dimensionOffset)>100000)))) throw new Error('Invalid distance dimension.');
    if (m.calibration && (!isMeasurement(m.kind) || !Number.isFinite(m.calibration.unitsPerPoint) || m.calibration.unitsPerPoint <= 0 || !SCALE_UNITS.includes(m.calibration.unit))) throw new Error('Invalid measurement calibration.');
    if (m.kind === 'stamp' && (!m.stamp || !REVIEW_STATUSES.includes(m.stamp.status) || typeof m.stamp.reviewer !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.stamp.date) || !Number.isFinite(m.stamp.width) || m.stamp.width < 100 || m.stamp.width > 600)) throw new Error('Invalid review stamp.');
  }
  for (const s of Object.values(v.scales)) if (!Number.isFinite(s.unitsPerPoint) || s.unitsPerPoint <= 0 || !SCALE_UNITS.includes(s.unit) || (s.displayUnit !== undefined && !MEASUREMENT_UNITS.includes(s.displayUnit))) throw new Error('Invalid page scale.');
  if (v.pageOrder && (!Array.isArray(v.pageOrder) || v.pageOrder.some(n => !Number.isInteger(n) || n < 1) || new Set(v.pageOrder).size !== v.pageOrder.length)) throw new Error('Invalid drawing page order.');
  return v;
}
