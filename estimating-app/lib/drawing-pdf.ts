import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { isMeasurement, measurement, type DrawingContent } from './drawing-model';
export async function markedDrawingPdf(source: Uint8Array, content: DrawingContent): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source.slice()), font = await pdf.embedFont(StandardFonts.Helvetica);
  // Fail visibly for unsupported text rather than silently dropping comments.
  const supported = (text: string) => { try { font.encodeText(text); return text; } catch { throw new Error('PDF export supports Latin text. Please replace unsupported characters in the markup text before exporting.'); } };
  for (const mark of content.marks) {
    const page = pdf.getPage(mark.page - 1), pts = mark.points, color = rgb(parseInt(mark.color.slice(1,3),16)/255,parseInt(mark.color.slice(3,5),16)/255,parseInt(mark.color.slice(5,7),16)/255);
    if (['rectangle','highlight'].includes(mark.kind) && pts.length > 1) page.drawRectangle({ x: Math.min(pts[0].x,pts[1].x), y: Math.min(pts[0].y,pts[1].y), width: Math.abs(pts[1].x-pts[0].x), height: Math.abs(pts[1].y-pts[0].y), borderColor: mark.kind==='highlight'?undefined:color, borderWidth: mark.kind==='highlight'?0:1.5, color: mark.kind==='highlight'?color:undefined, opacity: mark.kind==='highlight'?.25:1 });
    else if (mark.kind !== 'text') {
      const points = ['area','perimeter'].includes(mark.kind) ? [...pts,pts[0]] : pts;
      for(let i=1;i<points.length;i++) page.drawLine({ start: points[i-1], end: points[i], color, thickness: 1.5 });
    }
    const label = mark.kind === 'text' ? mark.text : isMeasurement(mark.kind) ? measurement(mark,content.scales[String(mark.page)]) : '';
    if (label) {
      // Respect the PDF's intrinsic rotation, so labels read in the displayed page orientation.
      const { degrees } = await import('pdf-lib');
      page.drawText(supported(label),{ x: pts[0].x, y: pts[0].y, size: 10, lineHeight: 12, font, color, rotate: degrees(mark.rotation??page.getRotation().angle) });
    }
  }
  pdf.setSubject('JGC drawing markups / as-built record');
  return pdf.save();
}
