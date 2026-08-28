import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AppState, Quote } from "./estimator-data";
import { lineSellPrice, quoteTotals } from "./estimator-data";
import { proposalCostBreakdownRows } from "./proposal-cost-breakdown";
import { proposalTextLines, proposalTextPlain, proposalTextRuns, type ProposalTextRun } from "./proposal-rich-text";

const PAGE = { width: 612, height: 792, margin: 30 };
const green = rgb(0.07, 0.43, 0.28);
const dark = rgb(0.05, 0.17, 0.14);
const grey = rgb(0.35, 0.42, 0.46);
const line = rgb(0.82, 0.87, 0.89);
const panel = rgb(0.965, 0.978, 0.982);
const bluePanel = rgb(0.955, 0.975, 0.985);
const greenPanel = rgb(0.94, 0.98, 0.96);

function safeName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
}

function pdfSafeText(value: unknown) {
  return String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    .replace(/\u00a0/g, " ")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e\n\r\t]/g, "");
}

function money(value: number) {
  const amount = Number.isFinite(value) ? value : 0;
  return `$${amount.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dollarsInWords(value: number): string {
  const belowTwenty = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const underThousand = (amount: number): string => {
    if (amount < 20) return belowTwenty[amount];
    if (amount < 100) return `${tens[Math.floor(amount / 10)]}${amount % 10 ? `-${belowTwenty[amount % 10]}` : ""}`;
    return `${belowTwenty[Math.floor(amount / 100)]} Hundred${amount % 100 ? ` ${underThousand(amount % 100)}` : ""}`;
  };
  const whole = Math.max(0, Math.round(value));
  if (whole < 1000) return underThousand(whole);
  if (whole < 1_000_000) return `${underThousand(Math.floor(whole / 1000))} Thousand${whole % 1000 ? ` ${underThousand(whole % 1000)}` : ""}`;
  return `${underThousand(Math.floor(whole / 1_000_000))} Million${whole % 1_000_000 ? ` ${dollarsInWords(whole % 1_000_000)}` : ""}`;
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const result: string[] = [];
  for (const paragraph of pdfSafeText(text).split(/\r?\n/)) {
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
    page.drawText(pdfSafeText(value), { x, y, size, font, color });
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
      ...proposalTextRuns(value).map((run) => ({ ...run, text: pdfSafeText(run.text), style: { ...run.style, bold: options.forceBold || run.style.bold } })),
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
  const rightText = (value: string, right: number, baseline: number, size = 9, font = regular, color = dark) => {
    const safeValue = pdfSafeText(value);
    page.drawText(safeValue, { x: right - font.widthOfTextAtSize(safeValue, size), y: baseline, size, font, color });
  };
  const formatDate = (value: string) => {
    if (!value) return "Not recorded";
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
  };
  const sectionHeader = (number: string, eyebrow: string, title: string) => {
    ensure(34);
    page.drawRectangle({ x: PAGE.margin, y: y - 25, width: 25, height: 25, color: dark });
    page.drawText(number, { x: PAGE.margin + 7, y: y - 16, size: 7, font: bold, color: rgb(1, 1, 1) });
    page.drawText(eyebrow, { x: PAGE.margin + 35, y: y - 8, size: 6.2, font: bold, color: green });
    page.drawText(title, { x: PAGE.margin + 35, y: y - 23, size: 12, font: bold, color: dark });
    y -= 34;
  };

  let logoDrawn = false;
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
      const scale = Math.min(165 / logo.width, 45 / logo.height);
      const logoWidth = logo.width * scale;
      const logoHeight = logo.height * scale;
      page.drawImage(logo, { x: (PAGE.width - logoWidth) / 2, y: y - logoHeight, width: logoWidth, height: logoHeight });
      y -= logoHeight + 8;
      logoDrawn = true;
    }
  } catch { /* The text company name below remains if the image is unavailable. */ }
  if (!logoDrawn) {
    const companyName = state.settings.companyName || "John Gordon Construction";
    page.drawText(companyName, { x: (PAGE.width - bold.widthOfTextAtSize(companyName, 14)) / 2, y: y - 14, size: 14, font: bold, color: dark });
    y -= 28;
  }

  const phone = state.settings.companyPhone || "(613) 932-1293";
  const fax = state.settings.companyFax || "(613) 937-3656";
  const companyAddress = state.settings.companyAddress || "830 Campbell St. Unit 3";
  const companyLocation = [state.settings.companyCity || "Cornwall, Ontario", state.settings.companyPostalCode || "K6H 6L7"].filter(Boolean).join(" ");
  page.drawText("GENERAL CONTRACTOR", { x: PAGE.margin, y: y - 6, size: 5.5, font: bold, color: green });
  const phoneBlockX = PAGE.width / 2 - 52;
  page.drawText(phone, { x: phoneBlockX, y: y - 4, size: 6.5, font: bold, color: dark });
  page.drawText("PHONE", { x: phoneBlockX + 8, y: y - 12, size: 4.5, font: bold, color: grey });
  page.drawText(fax, { x: phoneBlockX + 66, y: y - 4, size: 6.5, font: bold, color: dark });
  page.drawText("FAX", { x: phoneBlockX + 82, y: y - 12, size: 4.5, font: bold, color: grey });
  rightText(companyAddress, PAGE.width - PAGE.margin, y - 3, 5.5, regular, grey);
  rightText(companyLocation, PAGE.width - PAGE.margin, y - 12, 5.5, regular, grey);
  y -= 22;
  page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 2.2, color: dark });

  const titleHeight = 49;
  page.drawText(quote.customerQuoteType === "Budget Quote" ? "BUDGET QUOTATION" : "QUOTATION", { x: PAGE.margin, y: y - 15, size: 5.8, font: bold, color: green });
  page.drawText(quote.customerQuoteType === "Budget Quote" ? "Budget Quote" : "Proposal", { x: PAGE.margin, y: y - 34, size: 17, font: bold, color: dark });
  const quoteCardWidth = 126;
  page.drawRectangle({ x: PAGE.width - PAGE.margin - quoteCardWidth, y: y - 39, width: quoteCardWidth, height: 34, color: panel });
  page.drawRectangle({ x: PAGE.width - PAGE.margin - quoteCardWidth, y: y - 39, width: 3, height: 34, color: green });
  page.drawText("QUOTE NUMBER", { x: PAGE.width - PAGE.margin - quoteCardWidth + 11, y: y - 15, size: 5.2, font: bold, color: grey });
  page.drawText(quote.number, { x: PAGE.width - PAGE.margin - quoteCardWidth + 11, y: y - 26, size: 7.8, font: bold, color: dark });
  page.drawText(`Revision ${quote.revision}`, { x: PAGE.width - PAGE.margin - quoteCardWidth + 11, y: y - 35, size: 5.5, font: regular, color: grey });
  y -= titleHeight;
  page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 0.65, color: line });
  y -= 12;

  const client = state.clients.find((item) => item.id === quote.clientId);
  const projectAddress = quote.address?.trim() || client?.sites.find((site) => site.label.trim().toLocaleLowerCase() === quote.site.trim().toLocaleLowerCase())?.address?.trim() || "";
  const metaHeight = 60;
  const metaX = PAGE.margin;
  const metaWidth = PAGE.width - PAGE.margin * 2;
  const metaColumns = [0.23, 0.29, 0.29, 0.19];
  const meta = [
    { label: "PREPARED FOR", strong: client?.name || "Client not selected", detail: quote.proposalAttention || client?.contact ? `Attention: ${quote.proposalAttention || client?.contact}` : "" },
    { label: "ADDRESS", strong: projectAddress || "Not recorded", detail: "" },
    { label: "PROJECT", strong: quote.site || "Site name not recorded", detail: [quote.project || "Project not named", quote.reference ? `Reference: ${quote.reference}` : ""].filter(Boolean).join("\n") },
    { label: "QUOTE DATE", strong: formatDate(quote.quoteDate), detail: `Valid until ${formatDate(quote.validUntil)}` },
  ];
  page.drawRectangle({ x: metaX, y: y - metaHeight, width: metaWidth, height: metaHeight, color: panel, borderColor: line, borderWidth: 0.8 });
  let metaOffset = 0;
  meta.forEach((item, index) => {
    const columnWidth = metaWidth * metaColumns[index];
    const columnX = metaX + metaOffset + 10;
    if (index > 0) page.drawLine({ start: { x: metaX + metaOffset, y: y - 10 }, end: { x: metaX + metaOffset, y: y - metaHeight + 10 }, thickness: 0.6, color: line });
    page.drawText(item.label, { x: columnX, y: y - 14, size: 5.2, font: bold, color: green });
    const strongLines = wrap(item.strong, bold, 7.2, columnWidth - 18).slice(0, 2);
    strongLines.forEach((value, lineIndex) => page.drawText(value, { x: columnX, y: y - 27 - lineIndex * 8, size: 7.2, font: bold, color: dark }));
    const detailStart = y - 27 - strongLines.length * 8;
    wrap(item.detail, regular, 5.8, columnWidth - 18).slice(0, 2).forEach((value, lineIndex) => page.drawText(value, { x: columnX, y: detailStart - lineIndex * 7, size: 5.8, font: regular, color: grey }));
    metaOffset += columnWidth;
  });
  y -= metaHeight + 13;

  paragraph(state.settings.proposalIntro, { x: PAGE.margin + 2, width: metaWidth - 4, size: 7.2, gap: 9 });
  if (quote.scopeSummary) paragraph(quote.scopeSummary, { x: PAGE.margin + 2, width: metaWidth - 4, size: 7.2, font: bold, gap: 9 });

  sectionHeader("01", "PROJECT SCOPE", "Scope of Work");
  const scope = proposalTextLines(quote.proposalScope ?? "").length ? proposalTextLines(quote.proposalScope ?? "") : quote.lines.filter((item) => item.included).map((item) => item.description).filter(Boolean);
  scope.forEach((item, index) => {
    const itemLines = Math.max(1, wrap(proposalTextPlain(item), regular, 8.2, metaWidth - 46).length);
    const rowHeight = Math.max(28, itemLines * 10 + 14);
    ensure(rowHeight);
    const rowTop = y;
    const contentBaseline = rowTop - 9;
    page.drawCircle({ x: PAGE.margin + 13, y: rowTop - 7, size: 8, color: bluePanel });
    const number = String(index + 1);
    page.drawText(number, { x: PAGE.margin + 13 - bold.widthOfTextAtSize(number, 6.2) / 2, y: contentBaseline - 0.5, size: 6.2, font: bold, color: green });
    y = contentBaseline;
    richParagraph(item, { x: PAGE.margin + 32, width: metaWidth - 40, size: 8.2, gap: 3 });
    y = Math.min(y, rowTop - rowHeight);
    page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 0.55, color: line });
  });
  y -= 8;

  const notes = proposalTextLines(quote.proposalNotes ?? "");
  const notesLineCount = Math.max(1, notes.reduce((sum, item) => sum + Math.max(1, wrap(proposalTextPlain(item), regular, 7.2, metaWidth - 55).length), 0));
  const clarificationLineCount = (quote.inclusions ? Math.max(1, wrap(proposalTextPlain(quote.inclusions), regular, 6.8, (metaWidth - 42) / 2).length) : 0) + (quote.exclusions ? Math.max(1, wrap(proposalTextPlain(quote.exclusions), regular, 6.8, (metaWidth - 42) / 2).length) : 0);
  const notesHeight = Math.max(67, 38 + notesLineCount * 10 + (clarificationLineCount ? 18 + Math.ceil(clarificationLineCount / 2) * 9 : 0));
  ensure(notesHeight + 12);
  const notesTop = y;
  page.drawRectangle({ x: PAGE.margin, y: y - notesHeight, width: metaWidth, height: notesHeight, color: panel });
  page.drawRectangle({ x: PAGE.margin, y: y - notesHeight, width: 3, height: notesHeight, color: green });
  sectionHeader("02", "ASSUMPTIONS & CLARIFICATIONS", "Notes");
  if (notes.length) {
    notes.forEach((item) => {
      page.drawCircle({ x: PAGE.margin + 18, y: y + 3, size: 2.3, color: green });
      richParagraph(item, { x: PAGE.margin + 30, width: metaWidth - 44, size: 7.2, gap: 1.5 });
    });
  } else {
    page.drawText("No additional project notes recorded.", { x: PAGE.margin + 17, y, size: 7, font: regular, color: grey });
    y -= 12;
  }
  if (quote.inclusions || quote.exclusions) {
    y -= 3;
    page.drawLine({ start: { x: PAGE.margin + 17, y }, end: { x: PAGE.width - PAGE.margin - 17, y }, thickness: 0.55, color: line });
    y -= 11;
    const clarificationWidth = (metaWidth - 52) / 2;
    if (quote.inclusions) {
      page.drawText("INCLUDED", { x: PAGE.margin + 17, y, size: 5.5, font: bold, color: green });
      y -= 10;
      richParagraph(quote.inclusions, { x: PAGE.margin + 17, width: clarificationWidth, size: 6.8, gap: 0 });
    }
    if (quote.exclusions) {
      const exclusionX = PAGE.margin + 31 + clarificationWidth;
      page.drawText("EXCLUDED", { x: exclusionX, y: y + 10, size: 5.5, font: bold, color: dark });
      const savedY = y;
      richParagraph(quote.exclusions, { x: exclusionX, width: clarificationWidth, size: 6.8, forceBold: true, gap: 0 });
      y = Math.min(y, savedY);
    }
  }
  y = Math.min(y, notesTop - notesHeight - 12);

  const totals = quoteTotals(quote);
  const optional = quote.lines.filter((item) => item.classification === "Optional" && !item.included);
  if (optional.length) {
    const optionalHeight = 30 + optional.reduce((sum, item) => sum + Math.max(20, wrap(item.description, regular, 7.5, metaWidth - 125).length * 9 + 7), 0);
    ensure(optionalHeight + 12);
    const optionalTop = y;
    page.drawRectangle({ x: PAGE.margin, y: y - optionalHeight, width: metaWidth, height: optionalHeight, color: panel, borderColor: line, borderWidth: 0.8 });
    page.drawText("OPTIONAL WORK — NOT INCLUDED", { x: PAGE.margin + 14, y: y - 18, size: 7.5, font: bold, color: green });
    y -= 31;
    optional.forEach((item) => {
      const itemTop = y;
      wrap(item.description, regular, 7.5, metaWidth - 125).forEach((value, lineIndex) => page.drawText(value, { x: PAGE.margin + 14, y: itemTop - lineIndex * 9, size: 7.5, font: regular, color: dark }));
      rightText(money(lineSellPrice(item, quote.defaultMarkup)), PAGE.width - PAGE.margin - 14, y, 7.5, bold, dark);
      y -= Math.max(20, wrap(item.description, regular, 7.5, metaWidth - 125).length * 9 + 7);
    });
    y = Math.min(y, optionalTop - optionalHeight - 12);
  }

  const costBreakdownRows = proposalCostBreakdownRows(state, quote);
  if (quote.proposalShowCostBreakdown && costBreakdownRows.length) {
    const breakdownHeight = 33 + costBreakdownRows.reduce((sum, row) => sum + Math.max(18, wrap(row.label, regular, 7.5, metaWidth - 125).length * 9 + 6), 0) + 23;
    ensure(breakdownHeight + 12);
    const breakdownTop = y;
    page.drawRectangle({ x: PAGE.margin, y: y - breakdownHeight, width: metaWidth, height: breakdownHeight, color: panel, borderColor: line, borderWidth: 0.8 });
    page.drawText("COST BREAKDOWN", { x: PAGE.margin + 14, y: y - 19, size: 9.5, font: bold, color: dark });
    y -= 34;
    costBreakdownRows.forEach((row) => {
      const labelLines = wrap(row.label, regular, 7.5, metaWidth - 125);
      labelLines.forEach((value, lineIndex) => page.drawText(value, { x: PAGE.margin + 14, y: y - lineIndex * 9, size: 7.5, font: regular, color: dark }));
      rightText(money(row.amount), PAGE.width - PAGE.margin - 14, y, 7.5, bold, dark);
      y -= Math.max(18, labelLines.length * 9 + 6);
    });
    page.drawLine({ start: { x: PAGE.margin + 14, y: y + 4 }, end: { x: PAGE.width - PAGE.margin - 14, y: y + 4 }, thickness: 1.5, color: green });
    page.drawText("Proposal total", { x: PAGE.margin + 14, y: y - 10, size: 8.5, font: bold, color: dark });
    rightText(money(totals.subtotal), PAGE.width - PAGE.margin - 14, y - 10, 8.5, bold, dark);
    y = breakdownTop - breakdownHeight - 12;
  }

  const lumpSumHeight = 67;
  ensure(lumpSumHeight + 13);
  page.drawRectangle({ x: PAGE.margin, y: y - lumpSumHeight, width: metaWidth, height: lumpSumHeight, color: greenPanel, borderColor: rgb(0.72, 0.86, 0.78), borderWidth: 0.9 });
  page.drawRectangle({ x: PAGE.margin, y: y - lumpSumHeight, width: 4, height: lumpSumHeight, color: green });
  page.drawText("LUMP SUM PROPOSAL", { x: PAGE.margin + 17, y: y - 19, size: 7.2, font: bold, color: green });
  page.drawText("Complete the Scope of Work above in a good and workmanlike manner.", { x: PAGE.margin + 17, y: y - 36, size: 7, font: regular, color: dark });
  const words = `${dollarsInWords(totals.subtotal)} Dollars`;
  wrap(words, regular, 5.8, metaWidth - 185).slice(0, 2).forEach((value, index) => page.drawText(value, { x: PAGE.margin + 17, y: y - 51 - index * 7, size: 5.8, font: regular, color: grey }));
  rightText(money(totals.subtotal), PAGE.width - PAGE.margin - 17, y - 29, 17, bold, dark);
  rightText("HST EXTRA", PAGE.width - PAGE.margin - 17, y - 46, 7, bold, green);
  y -= lumpSumHeight + 13;

  const termsPlain = proposalTextPlain(quote.terms || "");
  const termsHeight = Math.max(48, 28 + Math.max(1, wrap(termsPlain, regular, 6.6, metaWidth - 28).length) * 8);
  ensure(termsHeight + 12);
  const termsTop = y;
  page.drawRectangle({ x: PAGE.margin, y: y - termsHeight, width: metaWidth, height: termsHeight, color: panel, borderColor: line, borderWidth: 0.8 });
  page.drawText("Terms", { x: PAGE.margin + 14, y: y - 17, size: 7.5, font: bold, color: dark });
  y -= 30;
  richParagraph(quote.terms, { x: PAGE.margin + 14, width: metaWidth - 28, size: 6.6, gap: 0 });
  y = Math.min(y, termsTop - termsHeight - 11);

  // Keep the signoff and customer acceptance block together. If a longer
  // proposal needs another page, it should not leave the signoff orphaned.
  ensure(43 + 67 + 16);
  const signoffTop = y;
  page.drawText("Respectfully submitted,", { x: PAGE.width - PAGE.margin - 135, y: y - 7, size: 5.8, font: regular, color: grey });
  page.drawText(state.settings.signatoryName || quote.preparedBy || "JGC Estimating", { x: PAGE.width - PAGE.margin - 135, y: y - 19, size: 6.8, font: bold, color: dark });
  page.drawText("John Gordon Construction", { x: PAGE.width - PAGE.margin - 135, y: y - 28, size: 5.5, font: regular, color: green });
  page.drawLine({ start: { x: PAGE.width - PAGE.margin - 135, y: y - 32 }, end: { x: PAGE.width - PAGE.margin, y: y - 32 }, thickness: 0.6, color: grey });
  y = signoffTop - 43;

  const acceptanceHeight = 67;
  ensure(acceptanceHeight + 16);
  const acceptanceTop = y;
  page.drawRectangle({ x: PAGE.margin, y: y - acceptanceHeight, width: metaWidth, height: acceptanceHeight, color: bluePanel, borderColor: rgb(0.75, 0.84, 0.89), borderWidth: 0.8 });
  const acceptanceTitle = "ACCEPTANCE";
  page.drawText(acceptanceTitle, { x: (PAGE.width - bold.widthOfTextAtSize(acceptanceTitle, 9)) / 2, y: y - 17, size: 9, font: bold, color: dark });
  const acceptanceCopy = "You are hereby authorized to furnish all materials and labour to complete the work mentioned in the above proposal. The undersigned agrees to pay the amount stated in this proposal according to the terms herein.";
  wrap(acceptanceCopy, regular, 5.8, metaWidth - 28).slice(0, 2).forEach((value, index) => page.drawText(value, { x: PAGE.margin + 14, y: y - 29 - index * 7, size: 5.8, font: regular, color: grey }));
  const fieldY = y - 58;
  const fieldGap = 16;
  const fieldWidths = [220, 180, metaWidth - 220 - 180 - fieldGap * 2 - 28];
  const fieldXs = [PAGE.margin + 14, PAGE.margin + 14 + fieldWidths[0] + fieldGap, PAGE.margin + 14 + fieldWidths[0] + fieldGap + fieldWidths[1] + fieldGap];
  ["SIGNATURE", "PRINT NAME", "DATE"].forEach((label, index) => {
    page.drawLine({ start: { x: fieldXs[index], y: fieldY }, end: { x: fieldXs[index] + fieldWidths[index], y: fieldY }, thickness: 0.6, color: grey });
    page.drawText(label, { x: fieldXs[index], y: fieldY - 7, size: 4.8, font: regular, color: grey });
  });

  // The three visible lines are also real AcroForm fields, so customers can
  // type into the same acceptance area on desktop or mobile PDF readers.
  const acceptanceFieldKey = String(quote.id || quote.number || "quote").replace(/[^a-zA-Z0-9_-]/g, "_");
  const form = pdf.getForm();
  const addAcceptanceField = (name: string, index: number, maxLength: number) => {
    const field = form.createTextField(`${name}_${acceptanceFieldKey}`);
    field.setMaxLength(maxLength);
    field.addToPage(page, {
      x: fieldXs[index],
      y: fieldY + 2,
      width: fieldWidths[index],
      height: 13,
      font: regular,
      textColor: dark,
      backgroundColor: rgb(1, 1, 1),
      borderWidth: 0,
    });
    field.setFontSize(8);
    field.updateAppearances(regular);
    return field;
  };
  addAcceptanceField("jgc_acceptance_signature", 0, 100);
  addAcceptanceField("jgc_acceptance_print_name", 1, 100);
  addAcceptanceField("jgc_acceptance_date", 2, 24);
  y = acceptanceTop - acceptanceHeight - 12;

  ensure(12);
  page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.width - PAGE.margin, y }, thickness: 0.5, color: line });
  y -= 9;
  page.drawText("John Gordon Construction Inc.", { x: PAGE.margin, y, size: 5.2, font: bold, color: dark });
  const preparedBy = `Prepared by ${quote.preparedBy || "JGC Estimating"}`;
  page.drawText(preparedBy, { x: (PAGE.width - regular.widthOfTextAtSize(preparedBy, 5.2)) / 2, y, size: 5.2, font: regular, color: grey });
  rightText(`Quote ${quote.number} · Rev ${quote.revision}`, PAGE.width - PAGE.margin, y, 5.2, regular, grey);

  return pdf.save();
}

export async function downloadProposalPdf(state: AppState, quote: Quote, requestedFilename?: string) {
  const bytes = await createProposalPdf(state, quote);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: "application/pdf" });
  const defaultFilename = `${quote.number} - Rev ${quote.revision} - ${quote.project || "Proposal"}`;
  const filenameBase = (requestedFilename?.trim() || defaultFilename).replace(/\.pdf$/i, "");
  const filename = `${safeName(filenameBase) || safeName(defaultFilename)}.pdf`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.rel = "noopener";
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
