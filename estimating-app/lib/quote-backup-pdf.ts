import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import {
  buildUpItemTotal,
  effectiveUnitCost,
  lineBuildUpTotals,
  lineDirectCost,
  lineSellPrice,
  quoteTotals,
  type AppState,
  type Quote,
  type QuoteCostBuildUpItem,
  type QuoteLine,
} from "./estimator-data";
import { createProposalPdf } from "./proposal-pdf";
import { createPurchaseOrderPdf, purchaseOrderTotals } from "./purchase-order-pdf";

export interface QuoteBackupReviewItem {
  key: string;
  message: string;
}

export interface QuoteBackupReview {
  blockers: QuoteBackupReviewItem[];
  warnings: QuoteBackupReviewItem[];
  unresolvedWarnings: QuoteBackupReviewItem[];
}

export interface QuoteBackupPdfOptions {
  state: AppState;
  quote: Quote;
  review: QuoteBackupReview;
  logoBytes?: Uint8Array | null;
  exportedAt?: Date;
}

export interface InternalEstimatePdfOptions {
  state: AppState;
  quote: Quote;
  logoBytes?: Uint8Array | null;
  exportedAt?: Date;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = 46;

const colour = {
  navy: rgb(0.047, 0.149, 0.247),
  blue: rgb(0.145, 0.388, 0.62),
  green: rgb(0.075, 0.55, 0.36),
  paleBlue: rgb(0.93, 0.965, 0.985),
  paleGreen: rgb(0.92, 0.975, 0.945),
  paleAmber: rgb(1, 0.965, 0.86),
  paleRed: rgb(0.995, 0.93, 0.92),
  slate: rgb(0.29, 0.36, 0.42),
  muted: rgb(0.48, 0.54, 0.59),
  line: rgb(0.82, 0.86, 0.89),
  light: rgb(0.975, 0.982, 0.988),
  white: rgb(1, 1, 1),
  red: rgb(0.67, 0.16, 0.12),
  amber: rgb(0.68, 0.43, 0.04),
};

function ascii(value: unknown) {
  return String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
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

function percent(value: number, digits = 1) {
  return `${(Number.isFinite(value) ? value * 100 : 0).toFixed(digits)}%`;
}

function shortDate(value: string) {
  if (!value) return "Not recorded";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return ascii(value);
  return parsed.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function nonBlankLines(value?: string) {
  return (value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function proposalStyleName(quote: Quote) {
  if (quote.proposalStyle === "section-summary") return "Section Summary";
  if (quote.proposalStyle === "detailed") return "Detailed Breakdown";
  return "JGC Classic - Lump Sum";
}

function customerScopeLines(quote: Quote) {
  const written = nonBlankLines(quote.proposalScope);
  if (written.length) return written;
  return quote.lines
    .filter((line) => line.description.trim() && line.included)
    .map((line) => line.description.trim());
}

function sectionSummaries(quote: Quote) {
  const groups = new Map<string, { descriptions: string[]; total: number }>();
  quote.lines
    .filter((line) => line.description.trim() && line.included)
    .forEach((line) => {
      const key = line.section.trim() || "General";
      const current = groups.get(key) ?? { descriptions: [], total: 0 };
      current.descriptions.push(line.description.trim());
      current.total += lineSellPrice(line, quote.defaultMarkup);
      groups.set(key, current);
    });
  return [...groups.entries()].map(([section, value]) => ({ section, ...value }));
}

function divisionBreakdown(quote: Quote) {
  const groups = new Map<string, { rows: number; directCost: number; bidPrice: number }>();
  quote.lines.filter((line) => line.included).forEach((line) => {
    const division = line.division?.trim() || "Div 01 – General Requirements";
    const current = groups.get(division) ?? { rows: 0, directCost: 0, bidPrice: 0 };
    current.rows += 1;
    current.directCost += lineDirectCost(line);
    current.bidPrice += lineSellPrice(line, quote.defaultMarkup);
    groups.set(division, current);
  });
  return [...groups.entries()].map(([division, values]) => ({ division, ...values })).sort((left, right) => left.division.localeCompare(right.division, "en-CA", { numeric: true }));
}

function shortDivision(value?: string) {
  const match = (value ?? "").match(/(?:Div|Division)\s+(\d+)/i);
  return match ? `Div ${match[1]}` : value?.trim() || "Div 01";
}

function divisionNumber(value?: string) {
  const match = (value ?? "").match(/(?:Div|Division)\s+(\d+)/i);
  return (match?.[1] ?? "01").padStart(2, "0");
}

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "JGC Quote";
}

function splitLongWord(word: string, font: PDFFont, size: number, maxWidth: number) {
  const parts: string[] = [];
  let current = "";
  for (const character of word) {
    const candidate = current + character;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      parts.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number) {
  const sourceLines = ascii(value).split(/\r?\n/);
  const lines: string[] = [];
  sourceLines.forEach((sourceLine) => {
    if (!sourceLine.trim()) {
      lines.push("");
      return;
    }
    const words = sourceLine.trim().split(/\s+/).flatMap((word) => (
      font.widthOfTextAtSize(word, size) > maxWidth ? splitLongWord(word, font, size, maxWidth) : [word]
    ));
    let current = "";
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });
    if (current) lines.push(current);
  });
  return lines.length ? lines : [""];
}

type TableColumn = {
  label: string;
  width: number;
  align?: "left" | "right" | "center";
  emphasis?: "green";
};

class BackupPdfBuilder {
  private page!: PDFPage;
  private y = 0;
  private section = "";
  private sectionSubtitle = "";
  private ownedPages: Array<{ page: PDFPage; section: string }> = [];

  constructor(
    private document: PDFDocument,
    private regular: PDFFont,
    private bold: PDFFont,
    private state: AppState,
    private quote: Quote,
    private logo: PDFImage | null,
    private exportedAt: Date,
    private documentLabel = "Complete Quote Backup",
  ) {}

  startSection(section: string, subtitle: string) {
    this.section = section;
    this.sectionSubtitle = subtitle;
    this.addPage(false);
  }

  private addPage(continuation: boolean) {
    this.page = this.document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.ownedPages.push({ page: this.page, section: this.section });
    this.drawHeader();
    this.page.drawText(ascii(this.section.toUpperCase()), {
      x: MARGIN,
      y: 690,
      size: 8,
      font: this.bold,
      color: colour.blue,
    });
    this.page.drawText(ascii(continuation ? `${this.section} - continued` : this.section), {
      x: MARGIN,
      y: 665,
      size: continuation ? 17 : 23,
      font: this.bold,
      color: colour.navy,
    });
    if (!continuation && this.sectionSubtitle) {
      this.page.drawText(ascii(this.sectionSubtitle), {
        x: MARGIN,
        y: 646,
        size: 8.5,
        font: this.regular,
        color: colour.muted,
      });
      this.y = 625;
    } else {
      this.y = 640;
    }
  }

  private drawHeader() {
    if (this.logo) {
      const scale = Math.min(108 / this.logo.width, 42 / this.logo.height);
      this.page.drawImage(this.logo, {
        x: MARGIN,
        y: 728,
        width: this.logo.width * scale,
        height: this.logo.height * scale,
      });
    } else {
      this.page.drawText(ascii(this.state.settings.companyName || "John Gordon Construction Inc."), {
        x: MARGIN,
        y: 748,
        size: 14,
        font: this.bold,
        color: colour.navy,
      });
    }
    const companyLines = [
      this.state.settings.companyPhone || "(613) 932-1293",
      this.state.settings.companyAddress || "830 Campbell St. Unit 3",
      `${this.state.settings.companyCity || "Cornwall, Ontario"} ${this.state.settings.companyPostalCode || "K6H 6L7"}`,
    ];
    companyLines.forEach((line, index) => {
      const text = ascii(line);
      this.page.drawText(text, {
        x: PAGE_WIDTH - MARGIN - this.regular.widthOfTextAtSize(text, 7.5),
        y: 755 - index * 11,
        size: 7.5,
        font: this.regular,
        color: colour.slate,
      });
    });
    this.page.drawLine({ start: { x: MARGIN, y: 717 }, end: { x: PAGE_WIDTH - MARGIN, y: 717 }, thickness: 1.5, color: colour.green });
    this.page.drawText(ascii(`${this.quote.number}  |  Revision ${this.quote.revision}  |  ${this.quote.project || "Project not named"}`), {
      x: MARGIN,
      y: 705,
      size: 7.5,
      font: this.regular,
      color: colour.muted,
    });
  }

  ensureSpace(height: number) {
    if (this.y - height >= BOTTOM) return false;
    this.addPage(true);
    return true;
  }

  gap(amount = 8) {
    this.y -= amount;
  }

  subheading(value: string) {
    this.ensureSpace(26);
    this.page.drawText(ascii(value.toUpperCase()), { x: MARGIN, y: this.y, size: 8.5, font: this.bold, color: colour.blue });
    this.page.drawLine({ start: { x: MARGIN, y: this.y - 5 }, end: { x: PAGE_WIDTH - MARGIN, y: this.y - 5 }, thickness: 0.7, color: colour.line });
    this.y -= 20;
  }

  paragraph(value: string, options: { size?: number; colour?: ReturnType<typeof rgb>; indent?: number; gapAfter?: number; bold?: boolean } = {}) {
    const size = options.size ?? 9;
    const lineHeight = size + 3;
    const indent = options.indent ?? 0;
    const font = options.bold ? this.bold : this.regular;
    const textLines = wrapText(value || "Not recorded", font, size, CONTENT_WIDTH - indent);
    textLines.forEach((line) => {
      this.ensureSpace(lineHeight + 2);
      this.page.drawText(line, { x: MARGIN + indent, y: this.y, size, font, color: options.colour ?? colour.slate });
      this.y -= lineHeight;
    });
    this.y -= options.gapAfter ?? 7;
  }

  labelledParagraph(label: string, value: string) {
    this.ensureSpace(30);
    this.page.drawText(ascii(label.toUpperCase()), { x: MARGIN, y: this.y, size: 7.5, font: this.bold, color: colour.blue });
    this.y -= 14;
    this.paragraph(value || "Not recorded", { size: 8.8, gapAfter: 10 });
  }

  list(items: string[], options: { numbered?: boolean; status?: (index: number) => string; size?: number } = {}) {
    if (!items.length) {
      this.paragraph("None recorded.");
      return;
    }
    items.forEach((item, index) => {
      const prefix = options.numbered ? `${index + 1}.` : "-";
      const status = options.status?.(index);
      const text = status ? `${item} [${status}]` : item;
      const size = options.size ?? 8.8;
      const wrapped = wrapText(text, this.regular, size, CONTENT_WIDTH - 20);
      wrapped.forEach((line, lineIndex) => {
        this.ensureSpace(size + 5);
        if (lineIndex === 0) this.page.drawText(prefix, { x: MARGIN + 2, y: this.y, size, font: this.bold, color: colour.navy });
        this.page.drawText(line, { x: MARGIN + 20, y: this.y, size, font: this.regular, color: colour.slate });
        this.y -= size + 3;
      });
      this.y -= 3;
    });
    this.y -= 3;
  }

  keyValueGrid(items: Array<[string, string]>) {
    const columnWidth = (CONTENT_WIDTH - 14) / 2;
    for (let index = 0; index < items.length; index += 2) {
      const row = items.slice(index, index + 2);
      const wrapped = row.map(([, value]) => wrapText(value || "Not recorded", this.bold, 9.2, columnWidth - 20));
      const rowHeight = Math.max(44, ...wrapped.map((lines) => 23 + lines.length * 10));
      this.ensureSpace(rowHeight + 6);
      row.forEach(([label, value], columnIndex) => {
        const x = MARGIN + columnIndex * (columnWidth + 14);
        this.page.drawRectangle({ x, y: this.y - rowHeight, width: columnWidth, height: rowHeight, color: colour.light, borderColor: colour.line, borderWidth: 0.6 });
        this.page.drawText(ascii(label.toUpperCase()), { x: x + 10, y: this.y - 13, size: 6.8, font: this.bold, color: colour.muted });
        wrapText(value || "Not recorded", this.bold, 9.2, columnWidth - 20).forEach((line, lineIndex) => {
          this.page.drawText(line, { x: x + 10, y: this.y - 28 - lineIndex * 10, size: 9.2, font: this.bold, color: colour.navy });
        });
      });
      this.y -= rowHeight + 6;
    }
  }

  callout(title: string, body: string, tone: "blue" | "green" | "amber" | "red" = "blue") {
    const fill = tone === "green" ? colour.paleGreen : tone === "amber" ? colour.paleAmber : tone === "red" ? colour.paleRed : colour.paleBlue;
    const accent = tone === "green" ? colour.green : tone === "amber" ? colour.amber : tone === "red" ? colour.red : colour.blue;
    const lines = wrapText(body, this.regular, 8.5, CONTENT_WIDTH - 24);
    const height = 31 + lines.length * 11;
    this.ensureSpace(height + 8);
    this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: CONTENT_WIDTH, height, color: fill, borderColor: accent, borderWidth: 0.8 });
    this.page.drawText(ascii(title), { x: MARGIN + 12, y: this.y - 17, size: 8.5, font: this.bold, color: accent });
    lines.forEach((line, index) => this.page.drawText(line, { x: MARGIN + 12, y: this.y - 33 - index * 11, size: 8.5, font: this.regular, color: colour.slate }));
    this.y -= height + 10;
  }

  table(columns: TableColumn[], rows: string[][], options: { fontSize?: number; rowTone?: (index: number) => "normal" | "amber" | "blue" | "green"; gapBeforeRow?: (index: number) => number } = {}) {
    const fontSize = options.fontSize ?? 7.6;
    const lineHeight = fontSize + 2.2;
    const drawHeader = () => {
      const height = 19;
      this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: columns.reduce((sum, column) => sum + column.width, 0), height, color: colour.navy });
      let x = MARGIN;
      columns.forEach((column) => {
        if (column.emphasis === "green") {
          this.page.drawRectangle({ x, y: this.y - height, width: column.width, height, color: colour.green });
        }
        this.page.drawText(ascii(column.label.toUpperCase()), { x: x + 4, y: this.y - 13, size: 6.3, font: this.bold, color: colour.white });
        x += column.width;
      });
      this.y -= height;
    };
    drawHeader();
    rows.forEach((row, rowIndex) => {
      const wrapped = columns.map((column, columnIndex) => wrapText(row[columnIndex] ?? "", this.regular, fontSize, column.width - 8));
      const height = Math.max(20, 8 + Math.max(...wrapped.map((lines) => lines.length)) * lineHeight);
      const gapBefore = options.gapBeforeRow?.(rowIndex) ?? 0;
      if (this.ensureSpace(height + gapBefore + 2)) drawHeader();
      else this.y -= gapBefore;
      const tone = options.rowTone?.(rowIndex) ?? "normal";
      const fill = tone === "amber" ? colour.paleAmber : tone === "blue" ? colour.paleBlue : tone === "green" ? colour.paleGreen : rowIndex % 2 ? colour.light : colour.white;
      const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
      this.page.drawRectangle({ x: MARGIN, y: this.y - height, width: totalWidth, height, color: fill, borderColor: colour.line, borderWidth: 0.35 });
      let x = MARGIN;
      columns.forEach((column, columnIndex) => {
        const emphasized = column.emphasis === "green";
        if (emphasized) {
          this.page.drawRectangle({ x, y: this.y - height, width: column.width, height, color: colour.paleGreen, borderColor: colour.green, borderWidth: 0.55 });
        }
        wrapped[columnIndex].forEach((line, lineIndex) => {
          const font = emphasized || columnIndex === 0 ? this.bold : this.regular;
          const textWidth = font.widthOfTextAtSize(line, fontSize);
          const textX = column.align === "right" ? x + column.width - 4 - textWidth : column.align === "center" ? x + (column.width - textWidth) / 2 : x + 4;
          this.page.drawText(line, { x: textX, y: this.y - 12 - lineIndex * lineHeight, size: fontSize, font, color: emphasized ? colour.navy : colour.slate });
        });
        x += column.width;
      });
      this.y -= height;
    });
    this.y -= 10;
  }

  totalsBox(items: Array<[string, string]>, highlightIndex = items.length - 1) {
    const width = 235;
    const x = PAGE_WIDTH - MARGIN - width;
    const rowHeight = 21;
    const height = items.length * rowHeight;
    this.ensureSpace(height + 10);
    items.forEach(([label, value], index) => {
      const y = this.y - (index + 1) * rowHeight;
      const highlighted = index === highlightIndex;
      this.page.drawRectangle({ x, y, width, height: rowHeight, color: highlighted ? colour.navy : (index % 2 ? colour.light : colour.white), borderColor: colour.line, borderWidth: 0.4 });
      this.page.drawText(ascii(label), { x: x + 8, y: y + 7, size: highlighted ? 8 : 7.5, font: highlighted ? this.bold : this.regular, color: highlighted ? colour.white : colour.slate });
      const safeValue = ascii(value);
      this.page.drawText(safeValue, { x: x + width - 8 - (highlighted ? this.bold : this.regular).widthOfTextAtSize(safeValue, highlighted ? 8 : 7.5), y: y + 7, size: highlighted ? 8 : 7.5, font: highlighted ? this.bold : this.regular, color: highlighted ? colour.white : colour.navy });
    });
    this.y -= height + 12;
  }

  finish() {
    const pages = this.document.getPages();
    this.ownedPages.forEach(({ page, section }) => {
      const index = pages.indexOf(page);
      if (index < 0) return;
      page.drawLine({ start: { x: MARGIN, y: 34 }, end: { x: PAGE_WIDTH - MARGIN, y: 34 }, thickness: 0.5, color: colour.line });
      page.drawText(ascii(`${this.quote.number} - ${this.documentLabel} - ${section}`), { x: MARGIN, y: 21, size: 6.8, font: this.regular, color: colour.muted });
      const pageNumber = `Page ${index + 1} of ${pages.length}`;
      page.drawText(pageNumber, { x: PAGE_WIDTH - MARGIN - this.regular.widthOfTextAtSize(pageNumber, 6.8), y: 21, size: 6.8, font: this.regular, color: colour.muted });
    });
  }
}

function estimateVendorDetails(state: AppState, line: QuoteLine) {
  const vendor = line.vendorId ? state.vendors.find((item) => item.id === line.vendorId)?.name : line.vendorName?.trim() ?? "";
  return [vendor, line.vendorReference].filter(Boolean).join(" / ");
}

function addDetailsPage(builder: BackupPdfBuilder, state: AppState, quote: Quote, exportedAt: Date) {
  const client = state.clients.find((item) => item.id === quote.clientId);
  const totals = quoteTotals(quote);
  builder.startSection("Details", "Quote information, customer record, commercial settings and written scope.");
  builder.keyValueGrid([
    ["Quote", `${quote.number} - Revision ${quote.revision}`],
    ["Status", quote.status],
    ["Client", client?.name || "Client not selected"],
    ["Project", quote.project || "Project not named"],
    ["Site", quote.site || "Not recorded"],
    ["Reference", quote.reference || "Not recorded"],
    ["Prepared by", quote.preparedBy || "JGC Estimating"],
    ["Quote date", shortDate(quote.quoteDate)],
    ["Valid until", shortDate(quote.validUntil)],
    ["Proposal style", proposalStyleName(quote)],
  ]);
  builder.callout("Complete backup", `Exported ${exportedAt.toLocaleString("en-CA")}. ${quote.quoteType}; ${percent(quote.defaultMarkup)} markup; ${percent(quote.targetMargin)} target margin; ${quote.taxName} ${percent(quote.taxRate, 0)} ${quote.proposalTaxDisplay === "breakdown" ? "shown" : "extra"}; current total ${money(totals.total)}. A machine-data snapshot is attached for future recovery.`, "green");
  builder.subheading("Written quote details");
  builder.labelledParagraph("Scope summary", quote.scopeSummary);
  builder.labelledParagraph("Inclusions", quote.inclusions);
  builder.labelledParagraph("Exclusions", quote.exclusions);
  builder.labelledParagraph("Terms", quote.terms);
  builder.labelledParagraph("Internal notes", quote.internalNotes);
  if (quote.acceptedBy || quote.customerPo || quote.lostReason) {
    builder.subheading("Outcome");
    builder.keyValueGrid([
      ["Accepted by", quote.acceptedBy || "Not recorded"],
      ["Customer PO", quote.customerPo || "Not recorded"],
      ["Won date", shortDate(quote.wonAt)],
      ["Lost reason", quote.lostReason || "Not recorded"],
    ]);
  }
}

function addEstimatePage(builder: BackupPdfBuilder, state: AppState, quote: Quote, includeBuiltUpWorksheets = true) {
  const totals = quoteTotals(quote);
  builder.startSection("Estimate", "Internal quantities, direct costs, markup and customer pricing.");
  const columns: TableColumn[] = [
    { label: "#", width: 18, align: "center" },
    { label: "Division", width: 32, align: "center" },
    { label: "Description / vendor", width: 170 },
    { label: "Class", width: 52 },
    { label: "Qty / unit", width: 46, align: "right" },
    { label: "Unit cost", width: 57, align: "right", emphasis: "green" },
    { label: "Direct", width: 55, align: "right" },
    { label: "Markup", width: 42, align: "right" },
    { label: "Sell", width: 60, align: "right" },
  ];
  const orderedLines = quote.lines
    .map((line, originalIndex) => ({ line, originalIndex }))
    .sort((left, right) => Number(right.line.costType === "Sub / Vendor") - Number(left.line.costType === "Sub / Vendor") || left.originalIndex - right.originalIndex);
  const vendorCount = orderedLines.filter(({ line }) => line.costType === "Sub / Vendor").length;
  const rows = orderedLines.map(({ line, originalIndex }) => {
    const vendorDetails = line.costType === "Sub / Vendor" ? estimateVendorDetails(state, line) : "";
    return [
      String(originalIndex + 1),
      divisionNumber(line.division),
      `${line.description || "Unnamed line"}${vendorDetails ? `\n${vendorDetails}` : ""}`,
      line.included ? (line.classification === "Optional" ? "Optional - selected" : line.classification) : (line.classification === "Optional" ? "Optional - not selected" : `${line.classification} - excluded`),
      `${line.quantity.toLocaleString("en-CA", { maximumFractionDigits: 2 })} ${line.unit}`,
      money(effectiveUnitCost(line)),
      money(lineDirectCost(line)),
      percent(line.markupOverride ?? quote.defaultMarkup, 0),
      money(lineSellPrice(line, quote.defaultMarkup)),
    ];
  });
  builder.table(columns, rows, {
    fontSize: 6.9,
    rowTone: (index) => index < vendorCount ? "blue" : "green",
    gapBeforeRow: (index) => vendorCount > 0 && vendorCount < orderedLines.length && index === vendorCount ? 10 : 0,
  });
  builder.totalsBox([
    ["Included direct cost", money(totals.directCost)],
    ["Gross profit", money(totals.profit)],
    ["Pre-tax quote", money(totals.subtotal)],
    [`${quote.taxName} ${percent(quote.taxRate, 0)}`, money(totals.tax)],
    ["Customer total", money(totals.total)],
  ]);
  const builtUpLines = includeBuiltUpWorksheets ? quote.lines.filter((line) => line.costBuildUp) : [];
  if (builtUpLines.length) {
    builder.subheading("Built-up item worksheets");
    builtUpLines.forEach((line) => {
      const lineNumber = quote.lines.indexOf(line) + 1;
      const buildUpTotals = lineBuildUpTotals(line);
      builder.subheading(`Line ${lineNumber}: ${line.description || "Unnamed built-up item"}`);
      builder.table(
        [
          { label: "Type", width: 48 },
          { label: "Description / source", width: 214 },
          { label: "Qty / unit", width: 75, align: "right" },
          { label: "Unit cost", width: 85, align: "right" },
          { label: "Total", width: 90, align: "right" },
        ],
        (line.costBuildUp?.items ?? []).map((item) => [
          item.kind,
          `${item.description || "Unnamed cost row"}${item.source ? `\n${item.source}` : item.priceSourceSnapshot ? `\n${item.priceSourceSnapshot.supplierName} · saved ${item.priceSourceSnapshot.effectiveDate || "without date"}` : ""}`,
          `${item.quantity.toLocaleString("en-CA", { maximumFractionDigits: 2 })} ${item.unit}`,
          money(item.unitCost),
          money(buildUpItemTotal(item)),
        ]),
        { fontSize: 7 },
      );
      builder.totalsBox([
        ["Labour", money(buildUpTotals.labour)],
        ["Materials", money(buildUpTotals.materials)],
        ["Subcontractors", money(buildUpTotals.subcontractors)],
        ["Other direct costs", money(buildUpTotals.other)],
        ["Built-up unit cost", money(buildUpTotals.total)],
        [`Main line direct cost (${line.quantity} ${line.unit})`, money(lineDirectCost(line))],
      ]);
    });
  }
  if (totals.optional > 0) builder.callout("Unselected optional work", `${money(totals.optional)} is available but not included in the customer total.`, "amber");
  builder.callout("Pricing snapshot", "All amounts shown here are the values stored on this quote at the time of export. Price Book changes do not rewrite these lines.");
}

function addBreakdownPages(builder: BackupPdfBuilder, quote: Quote) {
  const builtUpLines = quote.lines.filter((line) => line.costBuildUp);
  builtUpLines.forEach((line, index) => {
    const lineNumber = quote.lines.indexOf(line) + 1;
    const totals = lineBuildUpTotals(line);
    const markup = line.markupOverride ?? quote.defaultMarkup;
    builder.startSection(
      line.description || `Built-up item ${index + 1}`,
      `Internal cost worksheet - estimate line ${lineNumber} - item ${index + 1} of ${builtUpLines.length}.`,
    );
    builder.keyValueGrid([
      ["Division", line.division || "Not assigned"],
      ["Main quantity", `${line.quantity.toLocaleString("en-CA", { maximumFractionDigits: 2 })} ${line.unit}`],
      ["Cost type", line.costType],
      ["Proposal class", line.included ? line.classification : `${line.classification} - excluded`],
    ]);
    const groups: Array<{ kind: QuoteCostBuildUpItem["kind"]; title: string }> = [
      { kind: "Labour", title: "Labour" },
      { kind: "Material", title: "Materials" },
      { kind: "Subcontractor", title: "Subcontractors / vendors" },
      { kind: "Other", title: "Equipment / other direct costs" },
    ];
    groups.forEach(({ kind, title }) => {
      const items = line.costBuildUp?.items.filter((item) => (
        item.kind === kind
        && (!!item.description.trim() || !!item.source.trim() || item.quantity > 0 || item.unitCost > 0)
      )) ?? [];
      if (!items.length) return;
      builder.subheading(title);
      builder.table(
        [
          { label: "Description / source", width: 244 },
          { label: kind === "Labour" ? "Hours" : "Quantity", width: 65, align: "right" },
          { label: "Unit", width: 63 },
          { label: kind === "Labour" ? "Rate" : "Unit cost", width: 78, align: "right" },
          { label: "Total", width: 82, align: "right" },
        ],
        items.map((item) => [
          `${item.description || "Unnamed cost row"}${item.source ? `\n${item.source}` : item.priceSourceSnapshot ? `\n${item.priceSourceSnapshot.supplierName}` : ""}`,
          item.quantity.toLocaleString("en-CA", { maximumFractionDigits: 2 }),
          item.unit,
          money(item.unitCost),
          money(buildUpItemTotal(item)),
        ]),
        { fontSize: 7.2 },
      );
    });
    builder.totalsBox([
      ["Labour", money(totals.labour)],
      ["Materials", money(totals.materials)],
      ["Subcontractors", money(totals.subcontractors)],
      ["Equipment / other", money(totals.other)],
      ["Built-up unit cost", money(totals.total)],
      ["Direct cost", money(lineDirectCost(line))],
      ["Markup", percent(markup)],
      ["Final selling price", money(lineSellPrice(line, quote.defaultMarkup))],
    ]);
    if (line.internalScope) builder.labelledParagraph("Scope / assumptions", line.internalScope);
    if (line.internalNote) builder.labelledParagraph("Internal note", line.internalNote);
  });
}

function addReviewPage(builder: BackupPdfBuilder, quote: Quote, review: QuoteBackupReview) {
  const totals = quoteTotals(quote);
  const included = quote.lines.filter((line) => line.included);
  const costTypes = ["Sub / Vendor", "Labour", "Material", "Labour & Materials", "Equipment / Other"];
  const sections = [...new Set(included.map((line) => line.section.trim() || "General"))];
  builder.startSection("Review", "Pricing reconciliation, margin, scope breakdown and readiness checks.");
  builder.keyValueGrid([
    ["Included lines", String(included.length)],
    ["Unselected options", money(totals.optional)],
    ["Direct cost", money(totals.directCost)],
    ["Pre-tax quote", money(totals.subtotal)],
    ["Gross profit", money(totals.profit)],
    ["Gross margin", percent(totals.margin)],
    ["Applied markup", percent(totals.markup)],
    ["Customer total", money(totals.total)],
  ]);
  builder.subheading("Cost breakdown");
  builder.table(
    [{ label: "Cost type", width: 280 }, { label: "Direct cost", width: 126, align: "right" }, { label: "Share", width: 126, align: "right" }],
    costTypes.map((type) => {
      const amount = included.filter((line) => line.costType === type).reduce((sum, line) => sum + lineDirectCost(line), 0);
      return [type, money(amount), percent(totals.directCost ? amount / totals.directCost : 0)];
    }),
  );
  builder.subheading("Section summary");
  builder.table(
    [{ label: "Section", width: 310 }, { label: "Direct cost", width: 111, align: "right" }, { label: "Sell price", width: 111, align: "right" }],
    sections.map((section) => {
      const lines = included.filter((line) => (line.section.trim() || "General") === section);
      return [section, money(lines.reduce((sum, line) => sum + lineDirectCost(line), 0)), money(lines.reduce((sum, line) => sum + lineSellPrice(line, quote.defaultMarkup), 0))];
    }),
  );
  builder.subheading("Readiness checks");
  if (!review.blockers.length && !review.warnings.length) {
    builder.callout("Ready to finish", "All current estimate, customer-scope and pricing checks passed when this backup was created.", "green");
  } else {
    if (review.blockers.length) {
    builder.callout(`${review.blockers.length} blocking item${review.blockers.length === 1 ? "" : "s"}`, "These items must be corrected before the quote can be finished.", "red");
      builder.list(review.blockers.map((item) => item.message));
    }
    if (review.warnings.length) {
      builder.callout(`${review.warnings.length} review warning${review.warnings.length === 1 ? "" : "s"}`, "Warnings may be acknowledged after the estimator confirms they are intentional.", "amber");
      builder.list(review.warnings.map((item) => item.message), { status: (index) => quote.acknowledgedWarnings[review.warnings[index].key] ? "Reviewed" : "Open" });
    }
  }
}

function addDivisionsPage(builder: BackupPdfBuilder, quote: Quote) {
  const totals = quoteTotals(quote);
  const divisions = divisionBreakdown(quote);
  builder.startSection("Divisions", "Internal construction-division breakdown for bid forms. All amounts reconcile to the included pre-tax quote.");
  builder.keyValueGrid([
    ["Included estimate rows", String(quote.lines.filter((line) => line.included).length)],
    ["Used divisions", String(divisions.length)],
    ["Direct cost", money(totals.directCost)],
    ["Pre-tax bid total", money(totals.subtotal)],
  ]);
  builder.subheading("Bid price by division");
  builder.table(
    [
      { label: "Division", width: 260 },
      { label: "Rows", width: 42, align: "right" },
      { label: "Direct cost", width: 75, align: "right" },
      { label: "Markup / profit", width: 75, align: "right" },
      { label: "Bid price", width: 80, align: "right" },
    ],
    divisions.map((division) => [division.division, String(division.rows), money(division.directCost), money(division.bidPrice - division.directCost), money(division.bidPrice)]),
  );
  builder.totalsBox([
    ["Direct cost", money(totals.directCost)],
    ["Markup / gross profit", money(totals.profit)],
    ["Pre-tax bid total", money(totals.subtotal)],
  ]);
  builder.callout("Assignment source", "Change a row's division on the Estimate tab. Price Book items bring their saved division into new estimate rows automatically.");
}

function addProposalPage(builder: BackupPdfBuilder, state: AppState, quote: Quote) {
  const client = state.clients.find((item) => item.id === quote.clientId);
  const totals = quoteTotals(quote);
  const style = quote.proposalStyle ?? "jgc-classic";
  const required = quote.lines.filter((line) => line.included);
  const optional = quote.lines.filter((line) => line.classification === "Optional" && !line.included);
  builder.startSection("Proposal", `Customer-facing ${proposalStyleName(quote)} proposal. Internal costs and vendor details are intentionally hidden.`);
  builder.keyValueGrid([
    ["Prepared for", client?.name || "Client not selected"],
    ["Attention", quote.proposalAttention || client?.contact || "Not recorded"],
    ["Address", quote.address || "Not recorded"],
    ["Quote date", `${shortDate(quote.quoteDate)} - Valid until ${shortDate(quote.validUntil)}`],
    ["Project", `${quote.site || "Site name not recorded"}\n${quote.project || "Project not named"}`],
  ]);
  builder.gap(12);
  builder.paragraph(state.settings.proposalIntro);

  const proposalNotes = nonBlankLines(quote.proposalNotes);
  if (style === "jgc-classic") {
    builder.subheading("01  Scope of Work");
    builder.list(customerScopeLines(quote), { numbered: true });
    builder.subheading("02  Notes");
    builder.list(proposalNotes.length ? proposalNotes : ["No additional project notes recorded."], { size: 7.2 });
    builder.paragraph(`Included: ${quote.inclusions || "As specifically listed in the Scope of Work."}`, { size: 7.2, gapAfter: 3 });
    builder.paragraph(`Excluded: ${quote.exclusions || "No exclusions recorded."}`, { size: 7.2, gapAfter: 7, bold: true });
  } else if (style === "section-summary") {
    builder.subheading("Scope and pricing by section");
    builder.table(
      [{ label: "Section / phase", width: 402 }, { label: "Amount", width: 130, align: "right" }],
      sectionSummaries(quote).map((section) => [`${section.section}\n${section.descriptions.join("; ")}`, money(section.total)]),
      { fontSize: 8 },
    );
  } else {
    builder.subheading("Scope and pricing");
    builder.table(
      [{ label: "Description", width: 342 }, { label: "Qty / unit", width: 80, align: "right" }, { label: "Amount", width: 110, align: "right" }],
      required.map((line) => [`${line.description}${line.customerNote ? `\n${line.customerNote}` : ""}`, `${line.quantity.toLocaleString("en-CA", { maximumFractionDigits: 2 })} ${line.unit}`, money(lineSellPrice(line, quote.defaultMarkup))]),
      { fontSize: 8 },
    );
  }

  if (optional.length) {
    builder.subheading(`${style === "jgc-classic" ? "03  " : ""}Optional work - not included`);
    builder.table(
      [{ label: "Description", width: 402 }, { label: "Amount", width: 130, align: "right" }],
      optional.map((line) => [line.description, money(lineSellPrice(line, quote.defaultMarkup))]),
    );
  }

  if (style === "jgc-classic") {
    const taxCopy = (quote.proposalTaxDisplay ?? "extra") === "extra"
      ? `${money(totals.subtotal)} plus ${quote.taxName}`
      : `${money(totals.total)} including ${quote.taxName}`;
    builder.callout("LUMP SUM PROPOSAL", `${taxCopy}\n${dollarsInWords(totals.subtotal)} Dollars before tax. Complete the Scope of Work above in a good and workmanlike manner.`, "blue");
  } else {
    if (proposalNotes.length) {
      builder.subheading("Notes");
      builder.list(proposalNotes);
    }
    builder.labelledParagraph("Inclusions", quote.inclusions || "As specifically listed above.");
    builder.labelledParagraph("Exclusions", quote.exclusions || "No exclusions recorded.");
    builder.totalsBox((quote.proposalTaxDisplay ?? "extra") === "extra" ? [
      ["Proposal amount", money(totals.subtotal)],
      [`${quote.taxName}`, "Extra"],
    ] : [
      ["Subtotal", money(totals.subtotal)],
      [`${quote.taxName} ${percent(quote.taxRate, 0)}`, money(totals.tax)],
      ["Proposal total", money(totals.total)],
    ]);
  }
  builder.callout("Terms and acceptance", `Any changes in the work or price must be made in writing. ${quote.terms}\nInvoices are due on receipt. A service charge of 2% per month applies after 30 days.\nACCEPTANCE: You are hereby authorized to furnish all materials and labour described in this proposal.\nAuthorized signature: ____________________    Print name: ____________________    Date: __________`, "blue");
}

function addHistoryPage(builder: BackupPdfBuilder, state: AppState, quote: Quote) {
  const activity = state.activity.filter((entry) => entry.quoteId === quote.id);
  const job = state.jobs.find((item) => item.quoteId === quote.id);
  builder.startSection("History", "Current status, frozen revisions, activity timeline and accepted-job handoff.");
  builder.subheading("Current version");
  builder.keyValueGrid([
    ["Revision", `R${quote.revision}`],
    ["Status", quote.status],
    ["Last changed", shortDate(quote.updatedAt)],
    ["Current total", money(quoteTotals(quote).total)],
    ["Finished", shortDate(quote.sentAt)],
    ["Won", shortDate(quote.wonAt)],
  ]);
  builder.subheading("Finished revisions");
  if (quote.revisions.length) {
    builder.table(
    [{ label: "Revision", width: 75 }, { label: "Status", width: 100 }, { label: "Finished", width: 177 }, { label: "Frozen total", width: 180, align: "right" }],
    [...quote.revisions].reverse().map((revision) => [`R${revision.revision}`, revision.status === "Sent" ? "Finished" : revision.status, shortDate(revision.issuedAt), money(revision.total)]),
    );
  } else {
  builder.paragraph("No finished revisions have been frozen yet.");
  }
  builder.subheading("Activity timeline");
  if (activity.length) {
    builder.table(
      [{ label: "Date", width: 115 }, { label: "Activity", width: 160 }, { label: "Detail", width: 257 }],
      activity.map((entry) => [shortDate(entry.createdAt), entry.title, entry.detail]),
      { fontSize: 7.6 },
    );
  } else {
    builder.paragraph("No activity has been recorded for this quote.");
  }
  if (job) {
    builder.subheading("Accepted job handoff");
    builder.keyValueGrid([
      ["Job", job.jobNumber],
      ["Job status", job.status],
      ["Accepted revenue", money(job.acceptedRevenue)],
      ["Original cost budget", money(job.originalCostBudget)],
    ]);
    const purchaseOrders = job.purchaseOrders ?? [];
    if (purchaseOrders.length) {
      builder.subheading("Purchase orders included in this backup");
      builder.table(
        [
          { label: "PO number", width: 105 },
          { label: "Subcontractor", width: 190 },
          { label: "Status", width: 75 },
          { label: "PO date", width: 87 },
          { label: "Pre-tax", width: 75, align: "right" },
        ],
        purchaseOrders.map((purchaseOrder) => [
          purchaseOrder.number || "Not assigned",
          purchaseOrder.vendorName || "Not recorded",
          purchaseOrder.status,
          shortDate(purchaseOrder.issueDate),
          money(purchaseOrderTotals(purchaseOrder).subtotal),
        ]),
        { fontSize: 7.3 },
      );
    }
  }
  builder.callout("Embedded recovery data", "The PDF contains an attached .jgcquote.json data snapshot with the complete quote, linked client, vendors, Price Book items, job record and activity history.", "green");
}

function backupSnapshot(state: AppState, quote: Quote, review: QuoteBackupReview, exportedAt: Date) {
  const vendorIds = new Set(quote.lines.map((line) => line.vendorId).filter(Boolean));
  const priceBookCodes = new Set(quote.lines.map((line) => line.priceBookCode).filter(Boolean));
  return {
    format: "JGC Estimate Desk Quote Backup",
    schemaVersion: 2,
    exportedAt: exportedAt.toISOString(),
    note: "Complete recoverable quote backup embedded inside the readable PDF.",
    quote,
    totals: quoteTotals(quote),
    review,
    client: state.clients.find((client) => client.id === quote.clientId) ?? null,
    vendors: state.vendors.filter((vendor) => vendorIds.has(vendor.id)),
    priceBookItems: state.priceBook.filter((item) => priceBookCodes.has(item.code)),
    job: state.jobs.find((job) => job.quoteId === quote.id) ?? null,
    activity: state.activity.filter((entry) => entry.quoteId === quote.id),
    company: {
      name: state.settings.companyName,
      phone: state.settings.companyPhone,
      fax: state.settings.companyFax,
      address: state.settings.companyAddress,
      city: state.settings.companyCity,
      postalCode: state.settings.companyPostalCode,
    },
  };
}

async function embedOptionalLogo(document: PDFDocument, logoBytes?: Uint8Array | null) {
  if (!logoBytes?.length) return null;
  try {
    return await document.embedPng(logoBytes);
  } catch {
    try {
      return await document.embedJpg(logoBytes);
    } catch {
      return null;
    }
  }
}

async function createInternalDocument(options: InternalEstimatePdfOptions, title: string, subject: string, documentLabel: string) {
  const exportedAt = options.exportedAt ?? new Date();
  const document = await PDFDocument.create();
  document.setTitle(`${options.quote.number} - ${title}`);
  document.setAuthor(options.state.settings.companyName || "John Gordon Construction Inc.");
  document.setSubject(subject);
  document.setKeywords(["JGC", "quote", "estimate", "internal"]);
  document.setCreator("JGC Estimate Desk");
  document.setProducer("JGC Estimate Desk");
  document.setCreationDate(exportedAt);
  document.setModificationDate(exportedAt);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedOptionalLogo(document, options.logoBytes);
  return {
    document,
    builder: new BackupPdfBuilder(document, regular, bold, options.state, options.quote, logo, exportedAt, documentLabel),
  };
}

export async function createEstimatePdf(options: InternalEstimatePdfOptions) {
  const { document, builder } = await createInternalDocument(
    options,
    "Internal Estimate",
    "Internal estimate line items, direct costs, markups, selling prices and totals",
    "Internal Estimate",
  );
  addEstimatePage(builder, options.state, options.quote, false);
  builder.finish();
  return document.save();
}

export async function createBreakdownPdf(options: InternalEstimatePdfOptions) {
  const { document, builder } = await createInternalDocument(
    options,
    "Built-Up Item Breakdown",
    "Internal built-up estimate worksheets for labour, materials, subcontractors and other direct costs",
    "Built-Up Breakdown",
  );
  addBreakdownPages(builder, options.quote);
  builder.finish();
  return document.save();
}

export async function createQuoteBackupPdf(options: QuoteBackupPdfOptions) {
  const exportedAt = options.exportedAt ?? new Date();
  const document = await PDFDocument.create();
  document.setTitle(`${options.quote.number} - Complete Quote Backup`);
  document.setAuthor(options.state.settings.companyName || "John Gordon Construction Inc.");
  document.setSubject("Details, Estimate, Review, Divisions, Proposal, History and Purchase Orders");
  document.setKeywords(["JGC", "quote", "estimate", "backup", "proposal", "purchase orders"]);
  document.setCreator("JGC Estimate Desk");
  document.setProducer("JGC Estimate Desk");
  document.setCreationDate(exportedAt);
  document.setModificationDate(exportedAt);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedOptionalLogo(document, options.logoBytes);
  const builder = new BackupPdfBuilder(document, regular, bold, options.state, options.quote, logo, exportedAt);
  addDetailsPage(builder, options.state, options.quote, exportedAt);
  addEstimatePage(builder, options.state, options.quote);
  addReviewPage(builder, options.quote, options.review);
  addDivisionsPage(builder, options.quote);

  // Copy the exact customer proposal pages into the backup. Keeping this on the
  // shared proposal renderer prevents the Proposal-only and backup downloads
  // from drifting apart as the customer document changes.
  const proposalBytes = await createProposalPdf(options.state, options.quote, options.logoBytes);
  const proposalDocument = await PDFDocument.load(proposalBytes);
  const proposalPages = await document.copyPages(proposalDocument, proposalDocument.getPageIndices());
  proposalPages.forEach((page) => document.addPage(page));

  addHistoryPage(builder, options.state, options.quote);

  // A complete backup also contains readable copies of every PO connected to
  // the accepted job. Draft, issued and void POs are all retained for audit and
  // redundancy, using the same renderer as the individual PO download.
  const job = options.state.jobs.find((item) => item.quoteId === options.quote.id);
  if (job) {
    for (const purchaseOrder of job.purchaseOrders ?? []) {
      const purchaseOrderBytes = await createPurchaseOrderPdf({
        state: options.state,
        job,
        purchaseOrder,
        logoBytes: options.logoBytes,
      });
      const purchaseOrderDocument = await PDFDocument.load(purchaseOrderBytes);
      const purchaseOrderPages = await document.copyPages(purchaseOrderDocument, purchaseOrderDocument.getPageIndices());
      purchaseOrderPages.forEach((page) => document.addPage(page));
    }
  }
  builder.finish();

  const attachmentName = `${safeFileName(`${options.quote.number} - ${options.quote.project || "Untitled"}`)} - Machine Data.jgcquote.json`;
  await document.attach(new TextEncoder().encode(JSON.stringify(backupSnapshot(options.state, options.quote, options.review, exportedAt), null, 2)), attachmentName, {
    mimeType: "application/json",
    description: "Complete JGC Estimate Desk recovery data",
    creationDate: exportedAt,
    modificationDate: exportedAt,
  });
  return document.save();
}

async function loadDownloadLogo(logoBytes?: Uint8Array | null) {
  if (logoBytes?.length || typeof fetch === "undefined") return logoBytes ?? null;
  try {
    const response = await fetch("./jgc-logo-transparent.png");
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadEstimatePdf(options: InternalEstimatePdfOptions) {
  const logoBytes = await loadDownloadLogo(options.logoBytes);
  const bytes = await createEstimatePdf({ ...options, logoBytes });
  downloadPdfBytes(bytes, `${safeFileName(`${options.quote.number} - ${options.quote.project || "Untitled"}`)} - Estimate.pdf`);
}

export async function downloadBreakdownPdf(options: InternalEstimatePdfOptions) {
  if (!options.quote.lines.some((line) => line.costBuildUp)) return;
  const logoBytes = await loadDownloadLogo(options.logoBytes);
  const bytes = await createBreakdownPdf({ ...options, logoBytes });
  downloadPdfBytes(bytes, `${safeFileName(`${options.quote.number} - ${options.quote.project || "Untitled"}`)} - Breakdown.pdf`);
}

export async function downloadQuoteBackupPdf(options: QuoteBackupPdfOptions) {
  const logoBytes = await loadDownloadLogo(options.logoBytes);
  const bytes = await createQuoteBackupPdf({ ...options, logoBytes });
  downloadPdfBytes(bytes, `${safeFileName(`${options.quote.number} - ${options.quote.project || "Untitled"}`)} - Complete Quote Backup.pdf`);
}
