import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AppState, Quote } from "./estimator-data";
import { quoteTotals } from "./estimator-data";
import { proposalCostBreakdownRows } from "./proposal-cost-breakdown";
import { proposalTextLines, proposalTextRuns, type ProposalTextRun } from "./proposal-rich-text";

const PAGE = { width: 612, height: 792, margin: 46 };
const green = rgb(0.07, 0.43, 0.28);
const dark = rgb(0.05, 0.17, 0.14);
const grey = rgb(0.35, 0.42, 0.46);

function safeName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const result: string[] = [];
  for (const paragraph of String(text || "").split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || !current) current = candidate;
      else { result.push(current); current = word; }
    }
    if (current) result.push(current);
  }
  return result;
}

export async function createProposalPdf(state: AppState, quote: Quote, logoBytes?: Uint8Array | null) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const boldItalic = await pdf.embedFont(StandardFonts.HelveticaBoldOblique);
  let page: PDFPage = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - PAGE.margin;
  const newPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - PAGE.margin;
    return page;
  };
  const ensure = (height: number) => { if (y - height < PAGE.margin) newPage(); };
  const text = (value: string, x: number, size = 9, font = regular, color = dark) => {
    page.drawText(value, { x, y, size, font, color });
  };
  const paragraph = (value: string, options: { x?: number; width?: number; size?: number; font?: PDFFont; gap?: number } = {}) => {
    const x = options.x ?? PAGE.margin;
    const width = options.width ?? PAGE.width - PAGE.margin * 2;
    const size = options.size ?? 9;
    const font = options.font ?? regular;
    const wrapped = wrap(value, font, size, width);
    ensure(wrapped.length * (size + 3) + (options.gap ?? 7));
    wrapped.forEach((line) => { text(line, x, size, font); y -= size + 3; });
    y -= options.gap ?? 7;
  };
  const richParagraph = (value: string, options: { x?: number; width?: number; size?: number; gap?: number; prefix?: string; forceBold?: boolean } = {}) => {
    const x = options.x ?? PAGE.margin;
    const width = options.width ?? PAGE.width - PAGE.margin * 2;
    const baseSize = options.size ?? 9;
    const runs: ProposalTextRun[] = [
      ...(options.prefix ? [{ text: options.prefix, style: { bold: options.forceBold ?? false, italic: false, underline: false, size: "normal" as const } }] : []),
      ...proposalTextRuns(value).map((run) => ({ ...run, style: { ...run.style, bold: options.forceBold || run.style.bold } })),
    ];
    const fontFor = (run: ProposalTextRun) => run.style.bold && run.style.italic ? boldItalic : run.style.bold ? bold : run.style.italic ? italic : regular;
    const sizeFor = (run: ProposalTextRun) => baseSize * (run.style.size === "large" ? 1.22 : run.style.size === "small" ? 0.82 : 1);
    const rows: ProposalTextRun[][] = [[]];
    let rowWidth = 0;
    const pushRow = () => { if (rows.at(-1)?.length || rows.length === 0) rows.push([]); rowWidth = 0; };
    runs.forEach((run) => {
      run.text.split(/(\n|\s+)/).filter((piece) => piece !== "").forEach((piece) => {
        if (piece === "\n") { pushRow(); return; }
        const pieceRun = { ...run, text: piece };
        const pieceWidth = fontFor(pieceRun).widthOfTextAtSize(piece, sizeFor(pieceRun));
        const isOnlySpace = /^\s+$/.test(piece);
        if (!isOnlySpace && rowWidth > 0 && rowWidth + pieceWidth > width) pushRow();
        if (!(isOnlySpace && rowWidth === 0)) {
          rows.at(-1)?.push(pieceRun);
          rowWidth += pieceWidth;
        }
      });
    });
    while (rows.length > 1 && rows.at(-1)?.length === 0) rows.pop();
    const rowHeights = rows.map((row) => Math.max(baseSize + 3, ...row.map((run) => sizeFor(run) + 3)));
    ensure(rowHeights.reduce((sum, height) => sum + height, 0) + (options.gap ?? 7));
    rows.forEach((row, rowIndex) => {
      let currentX = x;
      const placedRuns = row.map((run) => {
        const runFont = fontFor(run);
        const runSize = sizeFor(run);
        const runWidth = runFont.widthOfTextAtSize(run.text, runSize);
        const placedRun = { run, runFont, runSize, runWidth, x: currentX };
        currentX += runWidth;
        return placedRun;
      });
      placedRuns.forEach(({ run, runFont, runSize, runWidth, x: runX }) => {
        if (!run.style.highlight) return;
        const fullFontHeight = runFont.heightAtSize(runSize, { descender: true });
        const ascenderHeight = runFont.heightAtSize(runSize, { descender: false });
        const descenderHeight = Math.max(0, fullFontHeight - ascenderHeight);
        const verticalPadding = Math.max(1, runSize * 0.18);
        page.drawRectangle({
          x: runX - 1,
          y: y - descenderHeight - verticalPadding,
          width: runWidth + 2,
          height: fullFontHeight + verticalPadding * 2,
          color: run.style.highlight === "green" ? rgb(0.78, 0.94, 0.84) : rgb(1, 0.94, 0.45),
        });
      });
      placedRuns.forEach(({ run, runFont, runSize, runWidth, x: runX }) => {
        page.drawText(run.text, { x: runX, y, size: runSize, font: runFont, color: dark });
        if (run.style.underline && run.text.trim()) page.drawLine({ start: { x: runX, y: y - 1.5 }, end: { x: runX + runWidth, y: y - 1.5 }, thickness: 0.65, color: dark });
      });
      y -= rowHeights[rowIndex];
    });
    y -= options.gap ?? 7;
  };
  const heading = (number: string, title: string) => {
    ensure(29);
    page.drawRectangle({ x: PAGE.margin, y: y - 16, width: 22, height: 22, color: green });
    page.drawText(number, { x: PAGE.margin + 5, y: y - 9, size: 8, font: bold, color: rgb(1, 1, 1) });
    page.drawText(title, { x: PAGE.margin + 31, y: y - 8, size: 13, font: bold, color: dark });
    y -= 28;
  };

  try {
    let resolvedLogoBytes = logoBytes ?? null;
    if (!resolvedLogoBytes && typeof fetch !== "undefined") {
      const response = await fetch("./jgc-logo-transparent.png");
      if (response.ok) resolvedLogoBytes = new Uint8Array(await response.arrayBuffer());
    }
    if (resolvedLogoBytes) {
      let logo;
      try {
        logo = await pdf.embedPng(resolvedLogoBytes);
      } catch {
        logo = await pdf.embedJpg(resolvedLogoBytes);
      }
      const scale = Math.min(285 / logo.width, 72 / logo.height);
      page.drawImage(logo, { x: (PAGE.width - logo.width * scale) / 2, y: y - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
    }
  } catch { /* Text header remains available if the logo cannot load. */ }
  text(state.settings.companyPhone || "(613) 932-1293", PAGE.margin, 8, bold);
  text(state.settings.companyAddress || "830 Campbell St. Unit 3", PAGE.width - PAGE.margin - 145, 8, bold);
  y -= 82;
  page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 2, color: green });
  y -= 24;
  text(quote.customerQuoteType === "Budget Quote" ? "BUDGET QUOTE" : "PROPOSAL", PAGE.margin, 18, bold);
  text(`${quote.number} · Revision ${quote.revision}`, PAGE.width - PAGE.margin - 150, 9, bold, green);
  y -= 28;
  const client = state.clients.find((item) => item.id === quote.clientId);
  const projectAddress = quote.address?.trim() || client?.sites.find((site) => site.label.trim().toLocaleLowerCase() === quote.site.trim().toLocaleLowerCase())?.address?.trim() || "";
  const drawMetaPair = (left: [string, string], right?: [string, string]) => {
    const values = [left, right].filter(Boolean) as Array<[string, string]>;
    const widths = right ? [245, 245] : [PAGE.width - PAGE.margin * 2];
    const wrapped = values.map(([, value], index) => wrap(value, bold, 9, widths[index]));
    const rowHeight = 22 + Math.max(...wrapped.map((valueLines) => valueLines.length)) * 10;
    ensure(rowHeight);
    values.forEach(([label], column) => {
      const x = PAGE.margin + column * 270;
      page.drawText(label, { x, y, size: 7, font: bold, color: grey });
      wrapped[column].forEach((line, lineIndex) => page.drawText(line, { x, y: y - 13 - lineIndex * 10, size: 9, font: bold, color: dark }));
    });
    y -= rowHeight;
  };
  const quoteDate = new Date(quote.quoteDate + "T12:00:00").toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
  drawMetaPair(["PREPARED FOR", client?.name || "Client not selected"], ["QUOTE DATE", quoteDate]);
  drawMetaPair(["ATTENTION", quote.proposalAttention || client?.contact || "Not recorded"], ["ADDRESS", projectAddress || "Not recorded"]);
  drawMetaPair(["PROJECT", [quote.site, quote.project].filter(Boolean).join("\n") || "Project not named"]);
  paragraph(state.settings.proposalIntro, { gap: 6 });
  heading("01", "Project Scope — Scope of Work");
  const scope = proposalTextLines(quote.proposalScope ?? "").length ? proposalTextLines(quote.proposalScope ?? "") : quote.lines.filter((line) => line.included).map((line) => line.description).filter(Boolean);
  scope.forEach((item, index) => richParagraph(item, { prefix: `${index + 1}.  `, x: PAGE.margin + 8, width: PAGE.width - PAGE.margin * 2 - 8, gap: 2 }));
  ensure(27);
  page.drawText("02", { x: PAGE.margin, y, size: 7, font: bold, color: green });
  page.drawText("Notes", { x: PAGE.margin + 22, y, size: 10, font: bold, color: dark });
  y -= 18;
  proposalTextLines(quote.proposalNotes ?? "").forEach((item) => richParagraph(item, { prefix: "•  ", x: PAGE.margin + 8, width: PAGE.width - PAGE.margin * 2 - 8, size: 7, gap: 1 }));
  if (quote.inclusions) richParagraph(quote.inclusions, { prefix: "Included: ", size: 7, gap: 3 });
  if (quote.exclusions) richParagraph(quote.exclusions, { prefix: "Excluded: ", size: 8, forceBold: true, gap: 6 });

  const totals = quoteTotals(quote);
  const costBreakdownRows = proposalCostBreakdownRows(state, quote);
  if (quote.proposalShowCostBreakdown && costBreakdownRows.length) {
    heading("03", "Cost Breakdown");
    costBreakdownRows.forEach((row) => {
      const labelLines = wrap(row.label, regular, 9, PAGE.width - PAGE.margin * 2 - 125);
      const rowHeight = Math.max(19, labelLines.length * 11 + 5);
      ensure(rowHeight);
      labelLines.forEach((labelLine, lineIndex) => page.drawText(labelLine, { x: PAGE.margin + 8, y: y - lineIndex * 11, size: 9, font: regular, color: dark }));
      page.drawText(`$${row.amount.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, { x: PAGE.width - PAGE.margin - 95, y, size: 9, font: bold, color: dark });
      y -= rowHeight;
    });
  }
  const lumpSumHeight = 72;
  ensure(lumpSumHeight + 14);
  page.drawRectangle({ x: PAGE.margin, y: y - lumpSumHeight, width: PAGE.width - PAGE.margin * 2, height: lumpSumHeight, color: rgb(0.94, 0.98, 0.96), borderColor: green, borderWidth: 1 });
  page.drawText("LUMP SUM PROPOSAL", { x: PAGE.margin + 16, y: y - 19, size: 8, font: bold, color: green });
  page.drawText("Complete the Scope of Work above in a good and workmanlike manner.", { x: PAGE.margin + 16, y: y - 39, size: 8, font: regular, color: dark });
  page.drawText(`$${totals.subtotal.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, { x: PAGE.width - PAGE.margin - 140, y: y - 27, size: 17, font: bold, color: dark });
  page.drawText("HST Extra", { x: PAGE.width - PAGE.margin - 140, y: y - 48, size: 8, font: bold, color: green });
  y -= lumpSumHeight + 14;
  heading("04", "Terms");
  richParagraph(quote.terms, { size: 8, gap: 4 });
  paragraph("Any change in the work or price must be made in writing. HST Extra.", { size: 8, font: bold, gap: 8 });
  ensure(84);
  text("ACCEPTANCE", PAGE.margin, 13, bold);
  y -= 18;
  paragraph("The undersigned authorizes John Gordon Construction to complete the work described above and agrees to pay the proposal amount according to these terms.", { size: 8, gap: 10 });
  page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.margin + 210, y }, thickness: 0.7, color: grey });
  page.drawLine({ start: { x: PAGE.width - PAGE.margin - 150, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 0.7, color: grey });
  page.drawText("Signature / accepted by", { x: PAGE.margin, y: y - 9, size: 7, font: regular, color: grey });
  page.drawText("Date", { x: PAGE.width - PAGE.margin - 150, y: y - 9, size: 7, font: regular, color: grey });

  // Keep the printed acceptance lines while also exposing real AcroForm fields.
  // This lets a customer tap or click the proposal in a desktop or mobile PDF
  // reader and type their acceptance and date. PDF signing/markup tools can
  // still place a handwritten signature over the same signature area.
  const acceptanceFieldKey = String(quote.id || quote.number || "quote").replace(/[^a-zA-Z0-9_-]/g, "_");
  const form = pdf.getForm();
  const signatureField = form.createTextField(`jgc_acceptance_signature_${acceptanceFieldKey}`);
  signatureField.setMaxLength(100);
  signatureField.addToPage(page, {
    x: PAGE.margin,
    y: y + 2,
    width: 210,
    height: 16,
    font: regular,
    textColor: dark,
    backgroundColor: rgb(1, 1, 1),
    borderWidth: 0,
  });
  signatureField.setFontSize(10);
  signatureField.updateAppearances(regular);
  const dateField = form.createTextField(`jgc_acceptance_date_${acceptanceFieldKey}`);
  dateField.setMaxLength(24);
  dateField.addToPage(page, {
    x: PAGE.width - PAGE.margin - 150,
    y: y + 2,
    width: 150,
    height: 16,
    font: regular,
    textColor: dark,
    backgroundColor: rgb(1, 1, 1),
    borderWidth: 0,
  });
  dateField.setFontSize(10);
  dateField.updateAppearances(regular);

  return pdf.save();
}

export async function downloadProposalPdf(state: AppState, quote: Quote) {
  const bytes = await createProposalPdf(state, quote);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "application/pdf" });
  const filename = `${safeName(`${quote.number} - ${quote.project || "Proposal"}`)}.pdf`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.rel = "noopener";
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
