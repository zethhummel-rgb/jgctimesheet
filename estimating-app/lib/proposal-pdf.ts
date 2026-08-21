import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { AppState, Quote } from "./estimator-data";
import { lineBuildUpTotals, lineDirectCost, lineSellPrice, quoteTotals } from "./estimator-data";

const PAGE = { width: 612, height: 792, margin: 46 };
const green = rgb(0.07, 0.43, 0.28);
const dark = rgb(0.05, 0.17, 0.14);
const grey = rgb(0.35, 0.42, 0.46);

function safeName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
}

function lines(text: string) {
  return String(text || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
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
  const scope = lines(quote.proposalScope ?? "").length ? lines(quote.proposalScope ?? "") : quote.lines.filter((line) => line.included).map((line) => line.description).filter(Boolean);
  scope.forEach((item, index) => paragraph(`${index + 1}.  ${item}`, { x: PAGE.margin + 8, width: PAGE.width - PAGE.margin * 2 - 8, gap: 2 }));
  ensure(27);
  page.drawText("02", { x: PAGE.margin, y, size: 7, font: bold, color: green });
  page.drawText("Notes", { x: PAGE.margin + 22, y, size: 10, font: bold, color: dark });
  y -= 18;
  lines(quote.proposalNotes ?? "").forEach((item) => paragraph(`•  ${item}`, { x: PAGE.margin + 8, width: PAGE.width - PAGE.margin * 2 - 8, size: 7, gap: 1 }));
  if (quote.inclusions) paragraph(`Included: ${quote.inclusions}`, { size: 7, font: regular, gap: 3 });
  if (quote.exclusions) paragraph(`Excluded: ${quote.exclusions}`, { size: 8, font: bold, gap: 6 });

  const totals = quoteTotals(quote);
  if (quote.proposalShowCostBreakdown) {
    heading("03", "Cost Breakdown");
    const direct = { Labour: 0, Materials: 0, Subcontractors: 0, Other: 0 };
    const sell = { ...direct };
    quote.lines.filter((line) => line.included).forEach((line) => {
      const lineDirect = lineDirectCost(line);
      const factor = lineDirect > 0 ? lineSellPrice(line, quote.defaultMarkup) / lineDirect : 0;
      const add = (key: keyof typeof direct, value: number) => { direct[key] += value; sell[key] += value * factor; };
      if (line.costBuildUp) {
        const built = lineBuildUpTotals(line);
        add("Labour", built.labour * line.quantity); add("Materials", built.materials * line.quantity);
        add("Subcontractors", built.subcontractors * line.quantity); add("Other", built.other * line.quantity);
      } else if (line.costType === "Labour") add("Labour", lineDirect);
      else if (line.costType === "Material") add("Materials", lineDirect);
      else if (line.costType === "Sub / Vendor") add("Subcontractors", lineDirect);
      else add("Other", lineDirect);
    });
    const values = quote.proposalBreakdownIncludesMarkup === false ? direct : sell;
    Object.entries(values).filter(([, value]) => value > 0).forEach(([label, value]) => {
      ensure(19); text(label, PAGE.margin + 8, 9); page.drawText(`$${value.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, { x: PAGE.width - PAGE.margin - 95, y, size: 9, font: bold, color: dark }); y -= 19;
    });
    if (quote.proposalBreakdownIncludesMarkup === false) {
      text("Markup", PAGE.margin + 8, 9); page.drawText(`$${totals.profit.toLocaleString("en-CA", { minimumFractionDigits: 2 })}`, { x: PAGE.width - PAGE.margin - 95, y, size: 9, font: bold, color: dark }); y -= 19;
    }
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
  paragraph(quote.terms, { size: 8, gap: 4 });
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
