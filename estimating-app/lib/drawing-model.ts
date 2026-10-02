export type Point = { x: number; y: number };
export type MarkKind = 'pen' | 'line' | 'rectangle' | 'highlight' | 'text' | 'distance' | 'area' | 'perimeter';
export type Mark = { id: string; page: number; kind: MarkKind; points: Point[]; color: string; text: string; rotation?: number; author: string; createdAt: string; layer: 'Review' | 'As-built' };
export type Scale = { unitsPerPoint: number; unit: 'ft' | 'm'; reference: Point[]; knownLength: number };
export type DrawingContent = { version: 1; marks: Mark[]; scales: Record<string, Scale> };
export const emptyDrawing = (): DrawingContent => ({ version: 1, marks: [], scales: {} });
export const length = (points: Point[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
export const area = (points: Point[]) => Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
export function calibrate(points: Point[], knownLength: number, unit: Scale['unit']): Scale {
  const span = length(points);
  if (points.length !== 2 || span < 1 || !Number.isFinite(knownLength) || knownLength <= 0) throw new Error('Draw a reference line and enter a positive known length.');
  return { unitsPerPoint: knownLength / span, unit, reference: points, knownLength };
}
export function measurement(mark: Mark, scale?: Scale): string {
  if (!scale) return 'Set page scale';
  const value = mark.kind === 'area' ? area(mark.points) * scale.unitsPerPoint ** 2 : length(mark.kind==='perimeter'?[...mark.points,mark.points[0]]:mark.points) * scale.unitsPerPoint;
  if (mark.kind === 'area') return `${value.toFixed(2)} ${scale.unit === 'ft' ? 'sq ft' : 'sq m'}`;
  if (scale.unit === 'm') return `${value.toFixed(3)} m`;
  const inches = Math.round(value * 12 * 16) / 16;
  const feet = Math.floor(inches / 12), rest = Math.round((inches - feet * 12) * 16) / 16;
  return `${feet} ft ${rest} in`;
}
export const isMeasurement = (kind: string) => ['distance', 'area', 'perimeter'].includes(kind);
export function validateContent(value: unknown): DrawingContent {
  const v = value as DrawingContent;
  if (!v || v.version !== 1 || !Array.isArray(v.marks) || v.marks.length > 5000 || !v.scales || typeof v.scales !== 'object') throw new Error('This drawing markup record is not supported.');
  for (const m of v.marks) {
    if (!['pen','line','rectangle','highlight','text','distance','area','perimeter'].includes(m.kind) || !Number.isInteger(m.page) || m.page < 1 || !Array.isArray(m.points) || !m.points.length || m.points.length>20000 || typeof m.id!=='string' || typeof m.author!=='string' || !['Review','As-built'].includes(m.layer) || typeof m.createdAt!=='string' || !Number.isFinite(Date.parse(m.createdAt)) || m.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || !/^#[0-9a-f]{6}$/i.test(m.color) || typeof m.text !== 'string') throw new Error('Invalid drawing markup.');
  }
  for (const s of Object.values(v.scales)) if (!Number.isFinite(s.unitsPerPoint) || s.unitsPerPoint <= 0 || !['ft','m'].includes(s.unit)) throw new Error('Invalid page scale.');
  return v;
}
