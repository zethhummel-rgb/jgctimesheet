export interface PdfTextToken {
  text: string;
  x: number;
  y: number;
  width: number;
}

export type SupplierParserKind = "bmr-text" | "emard-ocr" | "material-xlsx";

export interface SupplierParsedRow {
  sku: string;
  productName: string;
  description: string;
  quantity: number;
  rawUnit: string;
  unit: string;
  listPrice: number | null;
  netCost: number;
  lineTotal: number;
  discountPercent: number | null;
  page: number;
  confidence: number;
  division: string;
  warnings: string[];
  occurrenceCount: number;
}

export interface SupplierParseResult {
  parser: SupplierParserKind;
  supplierName: string;
  detectedDate: string;
  validUntil: string;
  sourceSubtotal: number | null;
  extractedSubtotal: number;
  occurrenceCount: number;
  duplicateCount: number;
  rows: SupplierParsedRow[];
  warnings: string[];
}

interface TokenLine {
  y: number;
  tokens: PdfTextToken[];
  text: string;
}

function round(value: number, digits = 2) {
  const power = 10 ** digits;
  return Math.round((value + Number.EPSILON) * power) / power;
}

export function normalizeSupplierSku(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function mapSupplierUnit(rawUnit: string) {
  const unit = rawUnit.trim().toUpperCase().replace(/[.\s]/g, "");
  if (["EA", "EACH"].includes(unit)) return "Each";
  if (["PCS", "PC", "PIECE"].includes(unit)) return "Piece";
  if (["SHT", "SHEET"].includes(unit)) return "Sheet";
  if (["SQFT", "SF", "FT2"].includes(unit)) return "Sq.Ft.";
  if (["SQM", "M2"].includes(unit)) return "m2";
  if (["FT", "LF", "LNFT"].includes(unit) || /^\d+(?:\.\d+)?FT$/.test(unit)) return "Ln.Ft.";
  if (["M", "LM", "LNM"].includes(unit)) return "Ln.M.";
  if (["CUFT", "FT3"].includes(unit)) return "Cu.Ft.";
  if (["CUM", "M3"].includes(unit)) return "m3";
  if (["BDL", "BUNDLE"].includes(unit)) return "Bundle";
  if (["BX", "BOX"].includes(unit)) return "Box";
  if (["PK", "PACK"].includes(unit)) return "Pack";
  if (["RL", "ROLL"].includes(unit)) return "Roll";
  if (["BG", "BAG"].includes(unit)) return "Bag";
  if (["PL", "PAIL"].includes(unit)) return "Pail";
  return rawUnit.trim() || "Each";
}

export function suggestSupplierDivision(description: string) {
  const value = description.toLocaleLowerCase();
  if (/concrete|cement|mortar|grout|rebar|sonotube|forming/.test(value)) return "Division 03 – Concrete";
  if (/brick|block|masonry/.test(value)) return "Division 04 – Masonry";
  if (/steel|metal|angle|channel|fastener|bolt|screw|nail|anchor/.test(value)) return "Division 05 – Metals";
  if (/lumber|spruce|spf|plywood|osb|mdf|wood|trim|mould|stair tread/.test(value)) return "Division 06 – Wood, Plastics and Composites";
  if (/insulat|foam|vapou?r|roof|shingle|membrane|caulk|sealant/.test(value)) return "Division 07 – Thermal and Moisture Protection";
  if (/door|frame|lock|hinge|hardware|window/.test(value)) return "Division 08 – Openings";
  if (/drywall|gypsum|paint|primer|floor|tile|ceiling|compound/.test(value)) return "Division 09 – Finishes";
  if (/toilet|plumb|pipe|fitting|valve|faucet|drain/.test(value)) return "Division 22 – Plumbing";
  if (/duct|hvac|vent|heater/.test(value)) return "Division 23 – Heating, Ventilating and Air-Conditioning (HVAC)";
  if (/wire|electrical|receptacle|switch|breaker|conduit|light/.test(value)) return "Division 26 – Electrical";
  return "Div 01 – General Requirements";
}

function titleCaseProduct(value: string) {
  const keepUpper = new Set(["SPF", "PT", "KD", "OSB", "MDF", "PVC", "XPS", "EPS", "LVL", "PSL", "SDS", "ACQ"]);
  return value.split(/\s+/).filter(Boolean).map((word) => {
    const upper = word.toLocaleUpperCase();
    if (keepUpper.has(upper)) return upper;
    if (/^\d/.test(word)) return word.toLocaleLowerCase();
    return `${word.charAt(0).toLocaleUpperCase()}${word.slice(1).toLocaleLowerCase()}`;
  }).join(" ");
}

export function cleanSupplierProductName(description: string) {
  const raw = description
    .replace(/[_|]+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  const upper = raw.toLocaleUpperCase();
  const dimension = upper.match(/\b(\d+(?:[ .]\d+\/\d+|\/\d+)?)\s*X\s*(\d+(?:[ .]\d+\/\d+|\/\d+)?)\s*X\s*(\d+(?:[ .]\d+\/\d+|\/\d+)?)(?:\s*(?:FT|['"]|IN))?/);
  const isPressureTreated = /\bP\.?T\.?\b|PRESSURE\s*TREAT/.test(upper);
  const isSpf = /\bSPF\b|\bSPRUCE\b|\bSPR\b/.test(upper);
  if (dimension && (isPressureTreated || isSpf)) {
    const size = `${dimension[1]}x${dimension[2]}x${dimension[3]}`.replace(/\s+/g, " ").toLocaleLowerCase();
    const qualifiers: string[] = [];
    if (/\bSTUD\b/.test(upper)) qualifiers.push("Stud");
    else if (/\bSTAKE\b/.test(upper)) qualifiers.push("Stake");
    else if (/\bROUGH\b/.test(upper)) qualifiers.push("Rough");
    else if (/\bFENCE\b/.test(upper)) qualifiers.push("Fence");
    return `${size} ${isPressureTreated ? "PT" : "SPF"}${qualifiers.length ? ` ${qualifiers.join(" ")}` : ""}`;
  }
  return titleCaseProduct(
    raw
      .replace(/\([^)]*(?:PC|PCS|BDL|LIFT)[^)]*\)/gi, "")
      .replace(/\b#?\d\s*&\s*\d\b|\b#?\d\s*&\s*BTR\b|\bKD\b/gi, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function tokenLines(tokens: PdfTextToken[]) {
  const grouped = new Map<number, PdfTextToken[]>();
  tokens.forEach((token) => {
    if (!token.text.trim()) return;
    const key = Math.round(token.y * 2) / 2;
    grouped.set(key, [...(grouped.get(key) ?? []), token]);
  });
  return [...grouped.entries()]
    .sort(([left], [right]) => right - left)
    .map(([y, rowTokens]): TokenLine => {
      const ordered = rowTokens.sort((left, right) => left.x - right.x);
      return { y, tokens: ordered, text: ordered.map((token) => token.text.trim()).filter(Boolean).join(" ") };
    });
}

function parseDate(value: string) {
  const match = value.match(/(\d{2})-(\d{2})-(\d{2})/);
  if (!match) return "";
  return `20${match[3]}-${match[1]}-${match[2]}`;
}

function priceFromTokens(tokens: PdfTextToken[], minimumX: number, maximumX = Number.POSITIVE_INFINITY) {
  const value = tokens
    .filter((token) => token.x >= minimumX && token.x < maximumX)
    .map((token) => token.text.trim())
    .find((text) => /^\$?\d[\d,]*\.\d{2,3}$/.test(text));
  return value ? Number(value.replace(/[$,]/g, "")) : null;
}

function collapseRows(rows: SupplierParsedRow[]) {
  const unique = new Map<string, SupplierParsedRow>();
  let duplicateCount = 0;
  rows.forEach((row) => {
    const key = normalizeSupplierSku(row.sku);
    const current = unique.get(key);
    if (!current) {
      unique.set(key, row);
      return;
    }
    duplicateCount += 1;
    const conflict = Math.abs(current.netCost - row.netCost) > 0.001 || current.rawUnit !== row.rawUnit;
    const description = current.description.length >= row.description.length ? current.description : row.description;
    unique.set(key, {
      ...current,
      productName: cleanSupplierProductName(description),
      description,
      division: suggestSupplierDivision(description),
      confidence: Math.min(current.confidence, row.confidence),
      warnings: conflict ? [...new Set([...current.warnings, "Duplicate SKU has conflicting price or unit."])] : current.warnings,
      occurrenceCount: current.occurrenceCount + 1,
    });
  });
  return { rows: [...unique.values()], duplicateCount };
}

export function parseBmrPdfTokens(pages: PdfTextToken[][]): SupplierParseResult {
  const parsedRows: SupplierParsedRow[] = [];
  const warnings: string[] = [];
  let detectedDate = "";
  let validUntil = "";
  let sourceSubtotal: number | null = null;
  let pending: SupplierParsedRow | null = null;

  const flushPending = () => {
    if (!pending) return;
    if (!(pending.netCost > 0) && pending.listPrice !== null) {
      pending.netCost = pending.listPrice;
      pending.lineTotal = round(pending.quantity * pending.netCost);
    }
    if (pending.sku && pending.description && pending.netCost > 0) {
      pending.productName = cleanSupplierProductName(pending.description);
      pending.division = suggestSupplierDivision(pending.description);
      parsedRows.push(pending);
    }
    pending = null;
  };

  pages.forEach((tokens, pageIndex) => {
    tokenLines(tokens).forEach((line) => {
      if (!detectedDate && /\bDATE\b/i.test(line.text)) detectedDate = parseDate(line.text);
      if (!validUntil && /VALID UNTIL/i.test(line.text)) validUntil = parseDate(line.text);
      if (/\bsubtotal\b/i.test(line.text)) {
        const value = priceFromTokens(line.tokens, 500);
        if (value !== null) sourceSubtotal = value;
      }

      const skuToken = line.tokens.find((token) => token.x < 100 && /^[A-Z0-9][A-Z0-9-]{4,}$/i.test(token.text.trim()));
      const quantityDescription = line.tokens
        .filter((token) => token.x >= 140 && token.x < 425)
        .map((token) => token.text.trim())
        .filter(Boolean)
        .join(" ");
      const quantityMatch = quantityDescription.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
      let parsedDescription = quantityMatch?.[2].trim() ?? "";
      let rawUnit = line.tokens.filter((token) => token.x >= 420 && token.x < 455).map((token) => token.text.trim()).join("").trim();
      if (!rawUnit && parsedDescription) {
        const embeddedUnit = parsedDescription.match(/\s+(EA|PCS?|SHT|FT|RL|BX|PK|BDL|7FT)$/i);
        if (embeddedUnit) {
          rawUnit = embeddedUnit[1];
          parsedDescription = parsedDescription.slice(0, embeddedUnit.index).trim();
        }
      }
      const listPrice = priceFromTokens(line.tokens, 455, 535);
      const sameLineAmount = priceFromTokens(line.tokens, 535);

      if (skuToken && quantityMatch && rawUnit && listPrice !== null) {
        flushPending();
        const quantity = Number(quantityMatch[1]);
        const netUnitCost = sameLineAmount !== null && quantity > 0 ? sameLineAmount / quantity : 0;
        pending = {
          sku: skuToken.text.trim(),
          productName: cleanSupplierProductName(parsedDescription),
          description: parsedDescription,
          quantity,
          rawUnit,
          unit: mapSupplierUnit(rawUnit),
          listPrice,
          netCost: round(netUnitCost, 3),
          lineTotal: sameLineAmount ?? 0,
          discountPercent: sameLineAmount !== null && listPrice > 0 ? round((1 - netUnitCost / listPrice) * 100, 1) : null,
          page: pageIndex + 1,
          confidence: 100,
          division: suggestSupplierDivision(parsedDescription),
          warnings: [],
          occurrenceCount: 1,
        };
        if (sameLineAmount !== null) flushPending();
        return;
      }

      if (pending && /-\s*\d+(?:\.\d+)?%/.test(line.text)) {
        const discount = line.text.match(/-\s*(\d+(?:\.\d+)?)%/);
        const amount = priceFromTokens(line.tokens, 535);
        if (amount !== null && pending.quantity > 0) {
          pending.netCost = round(amount / pending.quantity, 3);
          pending.lineTotal = amount;
          pending.discountPercent = discount ? Number(discount[1]) : null;
          flushPending();
        }
        return;
      }

      if (pending && !/^-+$/.test(line.text) && !/Product|NET 60|Administration|QUOTE|VALID/i.test(line.text)) {
        const continuation = line.tokens.filter((token) => token.x >= 140 && token.x < 425).map((token) => token.text.trim()).filter(Boolean).join(" ");
        if (continuation && !/^\d/.test(continuation)) pending.description = `${pending.description} ${continuation}`.trim();
      }
    });
  });
  flushPending();

  const extractedSubtotal = round(parsedRows.reduce((sum, row) => sum + row.lineTotal, 0));
  if (sourceSubtotal !== null && Math.abs(sourceSubtotal - extractedSubtotal) > 0.02) {
    warnings.push(`Extracted total ${extractedSubtotal.toFixed(2)} does not match the printed subtotal ${Number(sourceSubtotal).toFixed(2)}.`);
  }
  const collapsed = collapseRows(parsedRows);
  return {
    parser: "bmr-text",
    supplierName: "BMR Cornwall-Perkins Home Centre Ltd.",
    detectedDate,
    validUntil,
    sourceSubtotal,
    extractedSubtotal,
    occurrenceCount: parsedRows.length,
    duplicateCount: collapsed.duplicateCount,
    rows: collapsed.rows,
    warnings,
  };
}

interface OcrWord {
  text: string;
  confidence: number;
  left: number;
  top: number;
  width: number;
  lineKey: string;
}

function parseOcrNumber(value: string) {
  const cleaned = value.toLocaleUpperCase().replace(/[$,]/g, "").replace(/O/g, "0").replace(/[^0-9.]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

export function parseEmardOcrTsv(tsv: string, page: number, imageWidth: number): SupplierParsedRow[] {
  const words: OcrWord[] = tsv.split(/\r?\n/).slice(1).map((line) => {
    const columns = line.split("\t");
    return {
      lineKey: `${columns[2]}-${columns[3]}-${columns[4]}`,
      left: Number(columns[6]),
      top: Number(columns[7]),
      width: Number(columns[8]),
      confidence: Number(columns[10]),
      text: columns.slice(11).join("\t").trim(),
    };
  }).filter((word) => word.text && Number.isFinite(word.left));

  const lines = new Map<string, OcrWord[]>();
  words.forEach((word) => lines.set(word.lineKey, [...(lines.get(word.lineKey) ?? []), word]));
  const result: SupplierParsedRow[] = [];
  [...lines.values()].sort((left, right) => left[0].top - right[0].top).forEach((lineWords) => {
    const ordered = lineWords.sort((left, right) => left.left - right.left);
    const inRange = (start: number, end: number) => ordered.filter((word) => (word.left + word.width / 2) / imageWidth >= start && (word.left + word.width / 2) / imageWidth < end);
    const skuWords = inRange(0.055, 0.22);
    const rawSku = skuWords.map((word) => word.text).join("").replace(/[^A-Za-z0-9.-]/g, "");
    if (!/^[A-Za-z0-9][A-Za-z0-9.-]{1,}$/.test(rawSku) || /^(Item|Whr|Description)$/i.test(rawSku)) return;
    const descriptionWords = inRange(0.20, 0.56);
    const description = descriptionWords.map((word) => word.text).join(" ").trim();
    const quantityText = inRange(0.54, 0.65).map((word) => word.text).join("");
    const rawUnit = inRange(0.63, 0.70).map((word) => word.text).join("").replace(/[^A-Za-z0-9/]/g, "");
    const unitPriceText = inRange(0.70, 0.84).map((word) => word.text).join("");
    const amountText = inRange(0.84, 0.99).map((word) => word.text).join("");
    const quantity = parseOcrNumber(quantityText) ?? 1;
    const unitPrice = parseOcrNumber(unitPriceText);
    const amount = parseOcrNumber(amountText);
    if (!description || unitPrice === null || !(unitPrice > 0)) return;
    const confidences = ordered.map((word) => word.confidence).filter(Number.isFinite);
    const confidence = confidences.length ? round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length, 1) : 0;
    const warnings: string[] = [];
    if (confidence < 80) warnings.push("Low OCR confidence - verify SKU, description and cost.");
    if (!rawUnit) warnings.push("Unit was not read clearly.");
    if (amount !== null && Math.abs(quantity * unitPrice - amount) > 0.05) warnings.push("Quantity x unit price does not match the printed amount.");
    result.push({
      sku: rawSku,
      productName: cleanSupplierProductName(description),
      description,
      quantity,
      rawUnit: rawUnit || "EA",
      unit: mapSupplierUnit(rawUnit || "EA"),
      listPrice: unitPrice,
      netCost: round(unitPrice, 3),
      lineTotal: amount ?? round(quantity * unitPrice),
      discountPercent: null,
      page,
      confidence,
      division: suggestSupplierDivision(description),
      warnings,
      occurrenceCount: 1,
    });
  });
  return result;
}

export function finishEmardOcr(rows: SupplierParsedRow[], metadata: {
  detectedDate?: string;
  validUntil?: string;
  sourceSubtotal?: number | null;
} = {}) {
  const sourceSubtotal = metadata.sourceSubtotal ?? null;
  const extractedSubtotal = round(rows.reduce((sum, row) => sum + row.lineTotal, 0));
  const warnings: string[] = [];
  if (sourceSubtotal !== null && Math.abs(sourceSubtotal - extractedSubtotal) > 0.05) {
    warnings.push(`OCR total ${extractedSubtotal.toFixed(2)} does not match the printed subtotal ${sourceSubtotal.toFixed(2)}. Review uncertain rows before applying.`);
  }
  const collapsed = collapseRows(rows);
  return {
    parser: "emard-ocr" as const,
    supplierName: "Emard Bros Lumber Co Ltd.",
    detectedDate: metadata.detectedDate ?? "",
    validUntil: metadata.validUntil ?? "",
    sourceSubtotal,
    extractedSubtotal,
    occurrenceCount: rows.length,
    duplicateCount: collapsed.duplicateCount,
    rows: collapsed.rows,
    warnings,
  } satisfies SupplierParseResult;
}
