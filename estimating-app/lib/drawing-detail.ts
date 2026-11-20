import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist';
import { RFI_PHOTO_MAX_EDGE } from './rfi-photos';

export interface DrawingDetail {
  pdf: PDFDocumentProxy;
  sourcePage: number;
  viewport: PageViewport;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pixelsWide: number;
  pixelsHigh: number;
  markup: string;
}

const svgNamespace = 'http://www.w3.org/2000/svg';
const paintProperties = ['color', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'font-family', 'font-size', 'font-weight', 'paint-order', 'text-anchor', 'opacity'];

// A standalone SVG image doesn't inherit the viewer stylesheet. Copy the visible ink,
// including text underneath an open comment editor, and omit editing controls.
function copyInk(element: SVGElement): SVGElement {
  const copy = element.cloneNode(false) as SVGElement;
  const paint = getComputedStyle(element);
  for (const property of paintProperties) copy.style.setProperty(property, paint.getPropertyValue(property));
  if (element.classList.contains('drawing-comment-display')) copy.style.opacity = '1';
  for (const child of element.childNodes) {
    if (child instanceof SVGElement) {
      if (!child.matches('foreignObject, .drawing-dimension-hit, .drawing-stamp-frame, .drawing-stamp-resize, .drawing-stamp-choice-hit')) copy.append(copyInk(child));
    } else if (child.nodeType === Node.TEXT_NODE) copy.append(child.cloneNode());
  }
  return copy;
}

export function captureDrawingDetail(stage: HTMLElement, viewport: PageViewport, pdf: PDFDocumentProxy, sourcePage: number, label: string): DrawingDetail {
  const overlay = stage.querySelector<SVGSVGElement>('.drawing-overlay');
  if (!overlay) throw new Error('Wait for the drawing page to open and try again.');
  const sheet = overlay.getBoundingClientRect();
  const bounds = stage.getBoundingClientRect();
  const left = bounds.left + stage.clientLeft, top = bounds.top + stage.clientTop;
  const startX = Math.max(left, sheet.left), startY = Math.max(top, sheet.top);
  const endX = Math.min(left + stage.clientWidth, sheet.right), endY = Math.min(top + stage.clientHeight, sheet.bottom);
  if (endX <= startX || endY <= startY) throw new Error('Pan the drawing into view before taking a detail.');
  const xScale = viewport.width / sheet.width, yScale = viewport.height / sheet.height;
  const x = (startX - sheet.left) * xScale, y = (startY - sheet.top) * yScale;
  const width = (endX - startX) * xScale, height = (endY - startY) * yScale;
  const density = Math.min(2, RFI_PHOTO_MAX_EDGE / Math.max(width, height));
  const pixelsWide = Math.max(1, Math.round(width * density)), pixelsHigh = Math.max(1, Math.round(height * density));
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('width', String(pixelsWide));
  svg.setAttribute('height', String(pixelsHigh));
  svg.setAttribute('viewBox', [x, y, width, height].join(' '));
  svg.setAttribute('preserveAspectRatio', 'none');
  for (const mark of overlay.querySelectorAll<SVGElement>('[data-detail-ink]')) svg.append(copyInk(mark));
  return { pdf, sourcePage, viewport, label, x, y, width, height, pixelsWide, pixelsHigh,
    markup: svg.childElementCount ? new XMLSerializer().serializeToString(svg) : '' };
}

export async function renderDrawingDetail(detail: DrawingDetail, canvas: HTMLCanvasElement, signal: AbortSignal) {
  const page = await detail.pdf.getPage(detail.sourcePage);
  if (signal.aborted) return;
  const sx = canvas.width / detail.width, sy = canvas.height / detail.height;
  // Render straight into the clipped canvas so a zoomed construction sheet needs only the pixels in the detail.
  const task = page.render({ canvas, viewport: detail.viewport, background: 'white',
    transform: [sx, 0, 0, sy, -detail.x * sx, -detail.y * sy] });
  const cancel = () => task.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try { await task.promise; }
  finally { signal.removeEventListener('abort', cancel); }
  if (!detail.markup || signal.aborted) return;
  const url = URL.createObjectURL(new Blob([detail.markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!signal.aborted) canvas.getContext('2d')!.drawImage(image, 0, 0);
  } finally { URL.revokeObjectURL(url); }
}
