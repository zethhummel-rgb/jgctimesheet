import { StandardFonts, rgb, type PDFDocument, type PDFFont } from 'pdf-lib';
import { markedDrawingPdf } from './drawing-pdf';
import type { DrawingContent } from './drawing-model';
import type { TransmittalDetails } from '../src/shop-drawing-transmittals-api';

interface Cover {
  jobNumber: string;
  project: string;
  client: string;
  drawingNumber: string;
  title: string;
  vendor: string;
  details: Omit<TransmittalDetails, 'byte_count'>;
}

const green = rgb(.06, .23, .19);
const ink = rgb(.10, .16, .14);
const muted = rgb(.30, .38, .34);
const line = rgb(.78, .83, .80);

function wrap(value: string, font: PDFFont, size: number, width: number): string[] {
  const result: string[] = [];
  for (const paragraph of value.replace(/\t/g, ' ').split(/\r?\n/)) {
    let current = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const next = current ? current + ' ' + word : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        current = next;
        continue;
      }
      if (current) result.push(current);
      current = '';
      for (const char of word) {
        if (font.widthOfTextAtSize(current + char, size) > width) {
          result.push(current);
          current = '';
        }
        current += char;
      }
    }
    result.push(current);
  }
  return result;
}

async function addCover(pdf: PDFDocument, cover: Cover) {
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const response = await fetch(new URL('jgc-logo-transparent.png', document.baseURI));
  if (!response.ok) throw new Error('The JGC logo could not load. Retry creating the transmittal.');
  const logo = await pdf.embedPng(await response.arrayBuffer());
  const details = cover.details;
  pdf.setTitle('Shop Drawing Transmittal - ' + details.reference);
  pdf.setSubject(cover.drawingNumber + ' - Revision ' + details.revision);
  const left = 46, width = 520;
  let page = pdf.addPage([612, 792]);
  let y = 0;

  function write(text: string, x: number, at: number, size: number, font = normal, color = ink) {
    page.drawText(text, { x, y: at, size, font, color });
  }

  function header(continued: boolean) {
    const scaled = logo.scaleToFit(150, 47);
    page.drawImage(logo, { x: left, y: 716, ...scaled });
    write('SHOP DRAWING TRANSMITTAL', 258, 742, 17, bold, green);
    write(details.reference + (continued ? '  /  CONTINUED' : ''), 258, 722, 10, normal, muted);
    page.drawLine({ start: { x: left, y: 697 }, end: { x: left + width, y: 697 }, thickness: 2, color: green });
    write('JOHN GORDON CONSTRUCTION', left, 36, 8, bold, muted);
    write('TRANSMITTAL', 495, 36, 8, normal, muted);
    y = 670;
  }

  function ensureSpace(points: number) {
    if (y - points >= 59) return;
    page = pdf.addPage([612, 792]);
    header(true);
  }

  function row(fields: Array<[string, string]>) {
    const gap = 22;
    const column = (width - (fields.length - 1) * gap) / fields.length;
    const text = fields.map(([, value]) => wrap(value, normal, 11, column));
    const height = 27 + Math.max(...text.map(lines => lines.length)) * 14;
    ensureSpace(height);
    fields.forEach(([label], i) => {
      const x = left + i * (column + gap);
      write(label.toUpperCase(), x, y, 8, bold, muted);
      text[i].forEach((value, index) => write(value, x, y - 17 - index * 14, 11));
    });
    y -= height;
  }

  function section(title: string) {
    ensureSpace(44);
    page.drawRectangle({ x: left, y: y - 7, width, height: 23, color: rgb(.91, .95, .92) });
    write(title, left + 10, y + 1, 10, bold, green);
    y -= 28;
  }

  try {
    header(false);
    row([['Transmitted to', details.recipient], ['Date', details.transmittal_date]]);
    row([['Project', cover.project], ['Job number', cover.jobNumber || '—']]);
    if (cover.client) row([['Client', cover.client]]);
    section('SHOP DRAWING');
    row([['Drawing number', cover.drawingNumber], ['Revision', String(details.revision)]]);
    row([['Description', cover.title]]);
    if (cover.vendor) row([['Vendor / fabricator', cover.vendor]]);
    section('JGC REVIEW');
    row([['Review decision', details.review_status], ['Review date', details.review_date]]);
    row([['Reviewed by', details.reviewer], ['Drawing sheets attached', String(details.page_count)]]);
    row([['Source PDF', details.source_name]]);
    if (details.notes) {
      section('TRANSMITTAL NOTES');
      for (const text of wrap(details.notes, normal, 11, width)) {
        ensureSpace(16);
        write(text, left, y, 11);
        y -= 16;
      }
    }
    page.drawLine({ start: { x: left, y: 50 }, end: { x: left + width, y: 50 }, thickness: 1, color: line });
  } catch (error) {
    if (error instanceof Error && error.message.includes('cannot encode')) {
      throw new Error('The transmittal contains characters the PDF font cannot print. Edit the text and retry.');
    }
    throw error;
  }
}

export function shopDrawingTransmittalPdf(source: Uint8Array, content: DrawingContent, cover: Cover) {
  return markedDrawingPdf(source, content, undefined, pdf => addCover(pdf, cover));
}
