import type { Job, ShopDrawing } from './estimator-data';
import { excelWriter } from './job-accounting-workbook';
import { downloadFile } from './save-pdf-to-device';
import { drawingRecord } from './shop-drawing-workflow';

const columns = [
  ['SD number', 11], ['Rev.', 6], ['Version', 9], ['Description', 32],
  ['Vendor / fabricator', 18], ['Recipient / reviewer', 18], ['Status', 18],
  ['Requested', 12], ['Received', 12], ['Submitted', 12], ['Due', 12], ['Returned', 12],
] as const;

function calendarDate(value: string | undefined) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

const cellText = (value: unknown) => typeof value === "string" ? value : "";

function values(number: string, revision: number, current: boolean, drawing: Partial<ShopDrawing>) {
  return [
    number, revision, current ? 'Current' : 'Prior', cellText(drawing.title),
    cellText(drawing.vendorName), cellText(drawing.consultant), cellText(drawing.status),
    calendarDate(drawing.requestedDate), calendarDate(drawing.receivedDate), calendarDate(drawing.submittedDate),
    calendarDate(drawing.dueDate), calendarDate(drawing.returnedDate),
  ];
}

function wrapLineCount(text: string, width: number) {
  const words = text.trim().split(/\s+/);
  let lines = 1, lineLength = 0;
  for (const word of words) {
    if (lineLength && lineLength + word.length + 1 > width) {
      lines++;
      lineLength = 0;
    }
    lineLength += (lineLength ? 1 : 0) + word.length;
    while (lineLength > width) { lines++; lineLength -= width; }
  }
  return lines;
}

const green = 'FF103D31';
const white = 'FFFFFFFF';
const paleGreen = 'FFE7F5EE';
const ink = 'FF18212B';
const subtle = 'FF53685E';
const border = 'FFD7E3DD';

export async function downloadShopDrawingLog(job: Job, client: string) {
  const ExcelJS = await excelWriter();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'John Gordon Construction';
  workbook.title = 'Shop Drawing Log';
  const sheet = workbook.addWorksheet('Shop Drawing Log', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
    pageSetup: {
      orientation: 'landscape', paperSize: 1, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.45, header: 0.15, footer: 0.2 },
    },
  });
  for (const [index, [, width]] of columns.entries()) sheet.getColumn(index + 1).width = width;

  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium' }).format(new Date());
  const project = job.portalJobName || job.project;
  const header = [
    ['SHOP DRAWING LOG', 17, 30, green, white],
    [[job.jobNumber && 'Job ' + job.jobNumber, project].filter(Boolean).join(' · '), 12, 25, paleGreen, ink],
    [[client, 'Exported ' + date].filter(Boolean).join(' · '), 10, 21, white, subtle],
  ] as const;
  header.forEach(([value, size, height, background, color], index) => {
    const row = index + 1;
    sheet.mergeCells(row, 1, row, columns.length);
    const cell = sheet.getCell(row, 1);
    cell.value = value;
    cell.font = { name: 'Arial', size, bold: row < 3, color: { argb: color } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: background } };
    cell.alignment = { vertical: 'middle', indent: 1, wrapText: true };
    sheet.getRow(row).height = Math.max(height, wrapLineCount(value, 130) * (size + 3));
  });

  const heading = sheet.getRow(4);
  heading.values = columns.map(([label]) => label);
  heading.height = 26;
  heading.eachCell((cell: any) => {
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: green } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });

  const drawings = [...(job.shopDrawings ?? [])].sort((a, b) => a.number.localeCompare(b.number, 'en-CA', { numeric: true }));
  drawings.forEach((drawing, index) => {
    const previous = [...drawing.revisions].sort((a, b) => b.revision - a.revision);
    const rows = [
      values(drawing.number, drawing.revision, true, drawing),
      ...previous.map(revision => {
        const snapshot = drawingRecord(revision.snapshot);
        return values(cellText(snapshot.number) || drawing.number, revision.revision, false, snapshot);
      }),
    ];
    rows.forEach((rowValues, revisionIndex) => {
      const row = sheet.addRow(rowValues);
      const background = index % 2 === 0 ? white : 'FFF2F7F4';
      let lines = 1;
      for (const [columnIndex, [, width]] of columns.entries()) {
        const cell = row.getCell(columnIndex + 1);
        const value = rowValues[columnIndex];
        cell.font = { name: 'Arial', size: 10, bold: revisionIndex === 0 && columnIndex < 3, color: { argb: ink } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: background } };
        cell.border = { bottom: { style: 'thin', color: { argb: border } } };
        cell.alignment = { vertical: 'middle', horizontal: columnIndex === 1 || columnIndex >= 7 ? 'center' : 'left', wrapText: true };
        if (value instanceof Date) cell.numFmt = 'mmm d, yy';
        if (typeof value === 'string') lines = Math.max(lines, wrapLineCount(value, Math.max(3, width - 2)));
      }
      row.height = Math.min(409, Math.max(20, lines * 13 + 5));
    });
  });

  sheet.autoFilter = { from: 'A4', to: 'L' + sheet.rowCount };
  sheet.pageSetup.printTitlesRow = '1:4';
  sheet.pageSetup.printArea = 'A1:L' + sheet.rowCount;
  sheet.headerFooter.oddFooter = '&LJohn Gordon Construction&RPage &P of &N';
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  if (bytes[0] !== 80 || bytes[1] !== 75) throw new Error('The shop drawing log could not be generated.');
  const name = job.jobNumber ? 'Job ' + job.jobNumber + ' - Shop Drawing Log.xlsx' : 'Shop Drawing Log.xlsx';
  downloadFile(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-'));
}
