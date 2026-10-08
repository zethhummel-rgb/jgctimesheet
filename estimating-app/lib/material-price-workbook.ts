import { Inflate } from "fflate";
import { suggestSupplierDivision, type SupplierParseResult } from "./supplier-price-parser";

export interface MaterialWorkbookParseSummary {
  result: SupplierParseResult;
  blankPriceCount: number;
  duplicateNameCount: number;
  headerRow: number;
  materialColumn: string;
  priceColumn: string;
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripXml(value: string) {
  return decodeXml(value.replace(/<[^>]+>/g, ""));
}

function xmlText(file: Uint8Array | undefined) {
  return file ? new TextDecoder().decode(file) : "";
}

function sharedStrings(xml: string) {
  return [...xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((part) => stripXml(part[1])).join(""),
  );
}

function columnFromReference(reference: string) {
  return reference.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "";
}

function cellValue(cellXml: string, type: string, strings: string[]) {
  if (type === "inlineStr") {
    return [...cellXml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => stripXml(match[1])).join("");
  }
  const value = cellXml.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (type === "s") return strings[Number(value)] ?? "";
  if (type === "str") return stripXml(value);
  return value.trim();
}

function worksheetRows(xml: string, strings: string[]) {
  return [...xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)].map((rowMatch, index) => {
    const rowNumber = Number(rowMatch[1].match(/\br="(\d+)"/)?.[1] ?? index + 1);
    const cells = new Map<string, string>();
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const reference = cellMatch[1].match(/\br="([A-Z]+\d+)"/i)?.[1] ?? "";
      const column = columnFromReference(reference);
      if (!column) continue;
      const type = cellMatch[1].match(/\bt="([^"]+)"/)?.[1] ?? "n";
      cells.set(column, cellValue(cellMatch[2], type, strings));
    }
    return { rowNumber, cells };
  });
}

function normalizedHeader(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeMaterialName(value: string) {
  let normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/×/g, "x");
  for (let index = 0; index < 3; index += 1) normalized = normalized.replace(/(\d)\s*x\s*(?=\d)/g, "$1x");
  return normalized.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function materialIdentity(name: string) {
  return `NAME-${normalizeMaterialName(name).replace(/\s+/g, "-").slice(0, 140)}`;
}

function numberFromCell(value: string) {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned || !/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function findWorksheetWithHeaders(files: Record<string, Uint8Array>, strings: string[]) {
  const sheetNames = Object.keys(files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort();
  for (const sheetName of sheetNames) {
    const rows = worksheetRows(xmlText(files[sheetName]), strings);
    for (const row of rows.slice(0, 80)) {
      let materialColumn = "";
      let priceColumn = "";
      for (const [column, value] of row.cells) {
        const header = normalizedHeader(value);
        if (["material name", "product material", "material", "product name"].includes(header)) materialColumn = column;
        if (header === "price" || header.startsWith("price before hst") || header.startsWith("price unit")) priceColumn = column;
      }
      if (materialColumn && priceColumn) return { rows, headerRow: row.rowNumber, materialColumn, priceColumn };
    }
  }
  return null;
}

// An .xlsx file is a compressed bundle, and a tiny bundle can be built to unpack to gigabytes. Only the parts
// the price import reads are unpacked, and reading stops once they pass a size no real price sheet reaches.
export const WORKBOOK_MAX_UNPACKED_BYTES = 40 * 1024 * 1024;
const WORKBOOK_MAX_ENTRIES = 5000;
const WORKBOOK_PART = /^(\[Content_Types\]\.xml|xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml)$/i;
const NOT_A_WORKBOOK = "This file is not a readable Excel .xlsx workbook.";
const WORKBOOK_TOO_LARGE = "This workbook is too large to import. Save the price sheet on its own and try again.";
class WorkbookTooLarge extends Error {}

function inflateWithin(data: Uint8Array, limit: number) {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > limit) throw new WorkbookTooLarge(WORKBOOK_TOO_LARGE);
    chunks.push(chunk);
  });
  const step = 16 * 1024;
  for (let offset = 0; offset < data.length; offset += step) inflater.push(data.subarray(offset, offset + step), offset + step >= data.length);
  const output = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) { output.set(chunk, position); position += chunk.length; }
  return output;
}

function readWorkbookParts(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 22 - 65535); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error(NOT_A_WORKBOOK);
  const count = view.getUint16(end + 10, true), directoryOffset = view.getUint32(end + 16, true);
  if (count > WORKBOOK_MAX_ENTRIES) throw new WorkbookTooLarge(WORKBOOK_TOO_LARGE);
  const files: Record<string, Uint8Array> = {}, names: string[] = [];
  let unpacked = 0;
  for (let index = 0, entry = directoryOffset; index < count; index += 1) {
    if (entry + 46 > end || view.getUint32(entry, true) !== 0x02014b50) throw new Error(NOT_A_WORKBOOK);
    const method = view.getUint16(entry + 10, true), compressedSize = view.getUint32(entry + 20, true);
    const nameLength = view.getUint16(entry + 28, true), extraLength = view.getUint16(entry + 30, true), commentLength = view.getUint16(entry + 32, true);
    const localHeader = view.getUint32(entry + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(entry + 46, entry + 46 + nameLength));
    entry += 46 + nameLength + extraLength + commentLength;
    names.push(name);
    if (!WORKBOOK_PART.test(name)) continue;
    if (localHeader + 30 > bytes.length || view.getUint32(localHeader, true) !== 0x04034b50) throw new Error(NOT_A_WORKBOOK);
    const start = localHeader + 30 + view.getUint16(localHeader + 26, true) + view.getUint16(localHeader + 28, true);
    if (start + compressedSize > bytes.length) throw new Error(NOT_A_WORKBOOK);
    const data = bytes.subarray(start, start + compressedSize);
    if (method === 0) {
      if (unpacked + data.length > WORKBOOK_MAX_UNPACKED_BYTES) throw new WorkbookTooLarge(WORKBOOK_TOO_LARGE);
      files[name] = data.slice();
    } else if (method === 8) {
      files[name] = data.length ? inflateWithin(data, WORKBOOK_MAX_UNPACKED_BYTES - unpacked) : new Uint8Array(0);
    } else throw new Error(NOT_A_WORKBOOK);
    unpacked += files[name].length;
  }
  return { files, names };
}

export function parseMaterialPriceWorkbook(bytes: Uint8Array): MaterialWorkbookParseSummary {
  let files: Record<string, Uint8Array>, names: string[];
  try {
    ({ files, names } = readWorkbookParts(bytes));
  } catch (error) {
    if (error instanceof WorkbookTooLarge) throw new Error(WORKBOOK_TOO_LARGE);
    throw new Error(NOT_A_WORKBOOK);
  }
  if (!files["[Content_Types].xml"] || !names.some((name) => name.startsWith("xl/worksheets/"))) {
    throw new Error("This file is not a valid Excel .xlsx workbook.");
  }
  const strings = sharedStrings(xmlText(files["xl/sharedStrings.xml"]));
  const located = findWorksheetWithHeaders(files, strings);
  if (!located) throw new Error('The workbook needs columns named "Material Name" and "Price". Their row position does not matter.');

  const byName = new Map<string, { name: string; price: number; sourceRow: number; warnings: string[] }>();
  let blankPriceCount = 0;
  let duplicateNameCount = 0;
  for (const row of located.rows) {
    if (row.rowNumber <= located.headerRow) continue;
    const name = (row.cells.get(located.materialColumn) ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const price = numberFromCell(row.cells.get(located.priceColumn) ?? "");
    if (price === null) {
      blankPriceCount += 1;
      continue;
    }
    const normalizedName = normalizeMaterialName(name);
    if (!normalizedName) continue;
    const current = byName.get(normalizedName);
    if (!current) {
      byName.set(normalizedName, { name, price, sourceRow: row.rowNumber, warnings: [] });
      continue;
    }
    duplicateNameCount += 1;
    if (Math.abs(current.price - price) > 0.001) current.warnings.push(`The material appears more than once with different prices (rows ${current.sourceRow} and ${row.rowNumber}).`);
  }
  if (!byName.size) throw new Error("No material rows with prices were found. Fill in the Price column and upload the completed workbook.");

  const rows = [...byName.values()].map((item) => ({
    sku: materialIdentity(item.name),
    productName: item.name,
    description: item.name,
    quantity: 1,
    rawUnit: "Each",
    unit: "Each",
    listPrice: null,
    netCost: item.price,
    lineTotal: item.price,
    discountPercent: null,
    page: item.sourceRow,
    confidence: 100,
    division: suggestSupplierDivision(item.name),
    warnings: item.warnings,
    occurrenceCount: 1,
  }));
  const warnings: string[] = [];
  if (blankPriceCount) warnings.push(`${blankPriceCount} material${blankPriceCount === 1 ? " has" : "s have"} no price and will be skipped.`);
  if (duplicateNameCount) warnings.push(`${duplicateNameCount} duplicate material-name occurrence${duplicateNameCount === 1 ? " was" : "s were"} consolidated by name.`);
  return {
    result: {
      parser: "material-xlsx",
      supplierName: "",
      detectedDate: "",
      validUntil: "",
      sourceSubtotal: null,
      extractedSubtotal: 0,
      occurrenceCount: rows.length + blankPriceCount + duplicateNameCount,
      duplicateCount: duplicateNameCount,
      rows,
      warnings,
    },
    blankPriceCount,
    duplicateNameCount,
    headerRow: located.headerRow,
    materialColumn: located.materialColumn,
    priceColumn: located.priceColumn,
  };
}
