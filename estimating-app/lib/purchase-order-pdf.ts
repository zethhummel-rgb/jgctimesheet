import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { AppState, Job, PurchaseOrder } from "./estimator-data";

export interface PurchaseOrderPdfOptions {
  state: AppState;
  job: Job;
  purchaseOrder: PurchaseOrder;
  logoBytes?: Uint8Array | null;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const colour = {
  navy: rgb(0.047, 0.149, 0.247),
  blue: rgb(0.145, 0.388, 0.62),
  green: rgb(0.075, 0.55, 0.36),
  paleBlue: rgb(0.93, 0.965, 0.985),
  paleGreen: rgb(0.92, 0.975, 0.945),
  slate: rgb(0.29, 0.36, 0.42),
  muted: rgb(0.48, 0.54, 0.59),
  line: rgb(0.82, 0.86, 0.89),
  light: rgb(0.975, 0.982, 0.988),
  white: rgb(1, 1, 1),
};

function ascii(value: unknown) {
  return String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e\n\r\t]/g, "");
}

function money(value: number) {
  const amount = Number.isFinite(value) ? value : 0;
  return `$${amount.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(value: string) {
  if (!value) return "Not recorded";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return ascii(value);
  return parsed.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
}

function safeFilenamePart(value: unknown, fallback: string) {
  const cleaned = ascii(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return cleaned || fallback;
}

export function purchaseOrderPdfFilename(options: PurchaseOrderPdfOptions) {
  const poNumber = safeFilenamePart(options.purchaseOrder.number || options.job.jobNumber, "Unnumbered");
  const vendor = safeFilenamePart(options.purchaseOrder.vendorName, "Subcontractor");
  const project = safeFilenamePart(options.job.project, "Project");
  const filename = `JGC-PO-${poNumber} - ${vendor} - ${project}`.slice(0, 180).replace(/[. ]+$/g, "");
  return `${filename}.pdf`;
}

function wrapText(font: PDFFont, text: string, size: number, width: number) {
  const words = ascii(text).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${line} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

function drawRight(page: PDFPage, font: PDFFont, text: string, size: number, x: number, y: number, width: number, color = colour.slate) {
  const safe = ascii(text);
  page.drawText(safe, { x: x + width - font.widthOfTextAtSize(safe, size), y, size, font, color });
}

function drawFittedText(page: PDFPage, font: PDFFont, text: string, size: number, x: number, y: number, width: number, color = colour.slate, minimumSize = 6.5) {
  let safe = ascii(text);
  const measured = font.widthOfTextAtSize(safe, size);
  const fittedSize = measured > width ? Math.max(minimumSize, size * width / measured) : size;
  while (safe.length > 1 && font.widthOfTextAtSize(safe, fittedSize) > width) {
    safe = `${safe.slice(0, -2).trimEnd()}...`;
  }
  page.drawText(safe, { x, y, size: fittedSize, font, color });
}

function drawLabelValue(page: PDFPage, regular: PDFFont, bold: PDFFont, label: string, value: string, x: number, y: number, width: number) {
  page.drawText(ascii(label).toUpperCase(), { x, y, size: 7, font: bold, color: colour.muted });
  const lines = wrapText(bold, value || "-", 9.5, width);
  lines.slice(0, 2).forEach((line, index) => page.drawText(line, { x, y: y - 14 - index * 11, size: 9.5, font: index === 0 ? bold : regular, color: colour.navy }));
}

function pageFooter(page: PDFPage, regular: PDFFont, bold: PDFFont, pageNumber: number) {
  page.drawLine({ start: { x: MARGIN, y: 30 }, end: { x: PAGE_WIDTH - MARGIN, y: 30 }, thickness: 0.6, color: colour.line });
  page.drawText("John Gordon Construction Inc. | Purchase Order", { x: MARGIN, y: 17, size: 7.5, font: bold, color: colour.muted });
  drawRight(page, regular, `Page ${pageNumber}`, 7.5, PAGE_WIDTH - MARGIN - 80, 17, 80, colour.muted);
}

function drawHeader(page: PDFPage, regular: PDFFont, bold: PDFFont, logo: PDFImage | null, state: AppState, po: PurchaseOrder, pageNumber: number) {
  if (logo) {
    const scale = Math.min(200 / logo.width, 56 / logo.height);
    page.drawImage(logo, { x: MARGIN, y: 706, width: logo.width * scale, height: logo.height * scale });
  } else {
    page.drawText("JOHN GORDON", { x: MARGIN, y: 744, size: 17, font: bold, color: colour.navy });
    page.drawText("CONSTRUCTION", { x: MARGIN, y: 727, size: 11, font: bold, color: colour.green });
  }

  const companyLines = [
    state.settings.companyPhone ? `Phone: ${state.settings.companyPhone}` : "",
    state.settings.companyFax ? `Fax: ${state.settings.companyFax}` : "",
    state.settings.companyAddress ?? "",
    [state.settings.companyCity, state.settings.companyPostalCode].filter(Boolean).join(" "),
  ].filter(Boolean);
  companyLines.forEach((line, index) => drawRight(page, regular, line, 8, PAGE_WIDTH - MARGIN - 220, 750 - index * 11, 220, colour.slate));

  page.drawText("PURCHASE ORDER", { x: MARGIN, y: 675, size: 23, font: bold, color: colour.navy });
  page.drawRectangle({ x: PAGE_WIDTH - MARGIN - 205, y: 666, width: 205, height: 34, color: colour.navy });
  page.drawText("PO NUMBER", { x: PAGE_WIDTH - MARGIN - 193, y: 687, size: 7, font: bold, color: colour.paleBlue });
  page.drawText(ascii(po.number || "Not assigned"), { x: PAGE_WIDTH - MARGIN - 193, y: 673, size: 13, font: bold, color: colour.white });

  if (pageNumber > 1) page.drawText("CONTINUED", { x: MARGIN, y: 659, size: 8, font: bold, color: colour.blue });
}

export function purchaseOrderTotals(purchaseOrder: PurchaseOrder) {
  const subtotal = Math.round(purchaseOrder.lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0) * 100) / 100;
  const hst = Math.round(subtotal * (Number(purchaseOrder.taxRate) || 0) * 100) / 100;
  return { subtotal, hst, total: Math.round((subtotal + hst) * 100) / 100 };
}

export async function createPurchaseOrderPdf(options: PurchaseOrderPdfOptions) {
  const { state, job, purchaseOrder: po } = options;
  const document = await PDFDocument.create();
  document.setTitle(`Purchase Order ${po.number}`);
  document.setAuthor(state.settings.companyName);
  document.setSubject(`${job.jobNumber} - ${job.project}`);
  document.setCreator("JGC Estimate Desk");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (options.logoBytes?.length) {
    try {
      logo = await document.embedJpg(options.logoBytes);
    } catch {
      try {
        logo = await document.embedPng(options.logoBytes);
      } catch {
        logo = null;
      }
    }
  }

  const quote = state.quotes.find((item) => item.id === job.quoteId);
  const client = state.clients.find((item) => item.id === job.clientId);
  const totals = purchaseOrderTotals(po);
  let pageNumber = 1;
  let page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(page, regular, bold, logo, state, po, pageNumber);
  pageFooter(page, regular, bold, pageNumber);

  page.drawRectangle({ x: MARGIN, y: 623, width: CONTENT_WIDTH, height: 29, color: colour.paleGreen, borderColor: colour.green, borderWidth: 0.7 });
  page.drawText("IMPORTANT", { x: MARGIN + 12, y: 635, size: 7.5, font: bold, color: colour.green });
  page.drawText("The purchase order number must appear on all invoices and documents relating to this order.", { x: MARGIN + 79, y: 634, size: 8.5, font: regular, color: colour.slate });

  // Keep the final metadata value comfortably above the panel border. The PO
  // date baseline is at y=506, so the former y=507 panel floor clipped it.
  page.drawRectangle({ x: MARGIN, y: 500, width: 254, height: 108, color: colour.light, borderColor: colour.line, borderWidth: 0.7 });
  page.drawRectangle({ x: MARGIN + 266, y: 500, width: 266, height: 108, color: colour.light, borderColor: colour.line, borderWidth: 0.7 });
  page.drawText("TO", { x: MARGIN + 12, y: 590, size: 8, font: bold, color: colour.blue });
  const vendorTextWidth = 230;
  const vendorLines = wrapText(bold, po.vendorName || "Subcontractor not recorded", 12, vendorTextWidth).slice(0, 2);
  vendorLines.forEach((line, index) => page.drawText(line, { x: MARGIN + 12, y: 571 - index * 13, size: 12, font: bold, color: colour.navy }));
  const vendorContactY = 554 - Math.max(0, vendorLines.length - 1) * 13;
  [po.vendorContact, po.vendorEmail, po.vendorPhone].filter(Boolean).slice(0, 3).forEach((line, index) => drawFittedText(page, regular, line, 8.5, MARGIN + 12, vendorContactY - index * 11, vendorTextWidth, colour.slate));

  drawLabelValue(page, regular, bold, "Job name", job.project, MARGIN + 278, 590, 242);
  drawLabelValue(page, regular, bold, "Client / location", `${client?.name ?? "Client not recorded"}${quote?.site ? ` - ${quote.site}` : ""}`, MARGIN + 278, 553, 242);
  drawLabelValue(page, regular, bold, "PO date", shortDate(po.issueDate), MARGIN + 278, 520, 242);

  const detailY = 458;
  const detailWidth = CONTENT_WIDTH / 5;
  [
    ["Vendor quote", po.vendorQuoteNumber || "Not recorded"],
    ["Ship by", po.shipBy || "Your Means"],
    ["Ship via", po.shipVia || "Your Means"],
    ["F.O.B.", po.fob || "Job Site"],
    ["Ship to", po.shipTo || quote?.site || "Job Site"],
  ].forEach(([label, value], index) => {
    const x = MARGIN + index * detailWidth;
    page.drawRectangle({ x, y: detailY, width: detailWidth, height: 39, color: colour.paleBlue, borderColor: colour.line, borderWidth: 0.5 });
    page.drawText(label.toUpperCase(), { x: x + 8, y: detailY + 25, size: 6.5, font: bold, color: colour.muted });
    const fitted = wrapText(regular, value, 8, detailWidth - 16)[0] || "-";
    page.drawText(fitted, { x: x + 8, y: detailY + 10, size: 8, font: bold, color: colour.navy });
  });

  const columns = [
    { label: "QTY", x: MARGIN, width: 46, align: "center" },
    { label: "UNIT", x: MARGIN + 46, width: 52, align: "center" },
    { label: "DESCRIPTION", x: MARGIN + 98, width: 258, align: "left" },
    { label: "UNIT PRICE", x: MARGIN + 356, width: 82, align: "right" },
    { label: "AMOUNT", x: MARGIN + 438, width: 94, align: "right" },
  ] as const;

  const drawTableHeader = (target: PDFPage, y: number) => {
    target.drawRectangle({ x: MARGIN, y: y - 21, width: CONTENT_WIDTH, height: 21, color: colour.navy });
    columns.forEach((column) => {
      const text = column.label;
      const width = bold.widthOfTextAtSize(text, 7);
      const x = column.align === "right" ? column.x + column.width - width - 8 : column.align === "center" ? column.x + (column.width - width) / 2 : column.x + 8;
      target.drawText(text, { x, y: y - 14, size: 7, font: bold, color: colour.white });
    });
    return y - 21;
  };

  let y = drawTableHeader(page, 443);
  for (const [index, line] of po.lines.entries()) {
    const descriptionLines = wrapText(regular, line.description || "Subcontractor work", 9, columns[2].width - 16);
    const sourceText = line.sourceReference ? `Vendor quote: ${line.sourceReference}` : "Vendor quote not recorded";
    const sourceLines = wrapText(regular, sourceText, 7.5, columns[2].width - 16);
    const rowHeight = Math.max(36, 12 + descriptionLines.length * 11 + sourceLines.length * 9);
    if (y - rowHeight < 145) {
      pageNumber += 1;
      page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawHeader(page, regular, bold, logo, state, po, pageNumber);
      pageFooter(page, regular, bold, pageNumber);
      y = drawTableHeader(page, 640);
    }
    page.drawRectangle({ x: MARGIN, y: y - rowHeight, width: CONTENT_WIDTH, height: rowHeight, color: index % 2 ? colour.light : colour.white, borderColor: colour.line, borderWidth: 0.5 });
    columns.slice(1).forEach((column) => page.drawLine({ start: { x: column.x, y }, end: { x: column.x, y: y - rowHeight }, thickness: 0.4, color: colour.line }));
    const qty = Number(line.quantity || 0).toLocaleString("en-CA", { maximumFractionDigits: 2 });
    const qtyWidth = regular.widthOfTextAtSize(qty, 9);
    page.drawText(qty, { x: columns[0].x + (columns[0].width - qtyWidth) / 2, y: y - 21, size: 9, font: regular, color: colour.slate });
    const unit = ascii(line.unit || "LS");
    const unitWidth = regular.widthOfTextAtSize(unit, 9);
    page.drawText(unit, { x: columns[1].x + (columns[1].width - unitWidth) / 2, y: y - 21, size: 9, font: regular, color: colour.slate });
    descriptionLines.forEach((text, lineIndex) => page.drawText(text, { x: columns[2].x + 8, y: y - 18 - lineIndex * 11, size: 9, font: lineIndex === 0 ? bold : regular, color: colour.navy }));
    sourceLines.forEach((text, sourceIndex) => page.drawText(text, { x: columns[2].x + 8, y: y - 20 - descriptionLines.length * 11 - sourceIndex * 9, size: 7.5, font: regular, color: colour.muted }));
    drawRight(page, regular, money(line.unitCost), 9, columns[3].x, y - 21, columns[3].width - 8, colour.slate);
    drawRight(page, bold, money(line.amount), 9, columns[4].x, y - 21, columns[4].width - 8, colour.navy);
    y -= rowHeight;
  }

  if (y < 165) {
    pageNumber += 1;
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(page, regular, bold, logo, state, po, pageNumber);
    pageFooter(page, regular, bold, pageNumber);
    y = 625;
  }

  const totalsX = PAGE_WIDTH - MARGIN - 230;
  const totalsRows = [
    ["Subtotal", money(totals.subtotal)],
    [`${(po.taxRate * 100).toFixed(po.taxRate * 100 % 1 ? 1 : 0)}% HST`, money(totals.hst)],
    ["TOTAL", money(totals.total)],
  ];
  totalsRows.forEach(([label, value], index) => {
    const rowY = y - 30 - index * 27;
    page.drawRectangle({ x: totalsX, y: rowY, width: 230, height: 27, color: index === 2 ? colour.navy : colour.light, borderColor: colour.line, borderWidth: 0.5 });
    page.drawText(label, { x: totalsX + 10, y: rowY + 9, size: index === 2 ? 9 : 8, font: bold, color: index === 2 ? colour.white : colour.slate });
    drawRight(page, bold, value, index === 2 ? 11 : 9, totalsX + 92, rowY + (index === 2 ? 8 : 9), 128, index === 2 ? colour.white : colour.navy);
  });

  const notesY = y - 122;
  page.drawText("PURCHASE ORDER NOTES", { x: MARGIN, y: notesY + 18, size: 7, font: bold, color: colour.muted });
  const noteLines = wrapText(regular, po.notes || "The purchase order number must appear on all invoices and documents relating to this order.", 8.5, 275);
  noteLines.slice(0, 4).forEach((line, index) => page.drawText(line, { x: MARGIN, y: notesY + 4 - index * 10, size: 8.5, font: regular, color: colour.slate }));
  page.drawText("AUTHORIZED BY", { x: MARGIN, y: notesY - 48, size: 7, font: bold, color: colour.muted });
  page.drawText(ascii(po.authorizedBy || state.settings.signatoryName || "Authorized representative"), { x: MARGIN, y: notesY - 65, size: 10, font: bold, color: colour.navy });
  page.drawText(shortDate(po.issueDate), { x: MARGIN + 205, y: notesY - 65, size: 9, font: regular, color: colour.slate });
  page.drawLine({ start: { x: MARGIN, y: notesY - 70 }, end: { x: MARGIN + 330, y: notesY - 70 }, thickness: 0.6, color: colour.line });

  return document.save();
}

export async function downloadPurchaseOrderPdf(options: PurchaseOrderPdfOptions) {
  let logoBytes = options.logoBytes ?? null;
  if (!logoBytes && typeof fetch !== "undefined") {
    try {
      const response = await fetch("./jgc-logo-transparent.png");
      if (response.ok) logoBytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      logoBytes = null;
    }
  }
  const bytes = await createPurchaseOrderPdf({ ...options, logoBytes });
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = purchaseOrderPdfFilename(options);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
