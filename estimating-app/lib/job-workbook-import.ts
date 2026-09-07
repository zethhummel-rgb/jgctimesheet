/** The official job-list workbook is an input, never an instruction or a new database. */
export interface JobImportRecord {
  jobNumber: string;
  jobName: string;
  projectManager: string;
  jobType: string;
  active: boolean;
}

interface WorkbookColor { argb?: string; rgb?: string; indexed?: number; theme?: number }
interface WorkbookFill { type?: string; pattern?: string; fgColor?: WorkbookColor; bgColor?: WorkbookColor }
export interface JobWorkbookCell { value?: unknown; numFmt?: string; fill?: WorkbookFill }
export interface JobWorkbookRow {
  number?: number;
  fill?: WorkbookFill;
  getCell(column: number): JobWorkbookCell;
}
export interface JobWorkbook {
  worksheets: Array<{ name: string; eachRow(options: { includeEmpty: boolean }, callback: (row: JobWorkbookRow, rowNumber: number) => void): void }>;
}
export interface ParsedJobWorkbook {
  records: JobImportRecord[];
  sheetNames: string[];
  ignoredSheetNames: string[];
  skippedCancelled: number;
  skippedIncomplete: number;
  highlightedInactive: number;
  warnings: string[];
  errors: string[];
}

export const MAX_JOB_IMPORT_RECORDS = 10_000;
export const jobImportNumberKey = (value: string) => value.trim().toLocaleLowerCase("en-CA");
const headerKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function isJobImportSheet(name: string, currentYear = new Date().getFullYear()): boolean {
  const match = name.match(/\b(20\d{2})\b/);
  return Boolean(match && Number(match[1]) >= 2025 && Number(match[1]) <= currentYear);
}

function scalarValue(value: unknown): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("contains an invalid number");
    return value;
  }
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return String(value);
  if (typeof value !== "object" || value instanceof Date) throw new Error("contains an unsupported cell value");
  const cell = value as Record<string, unknown>;
  if ("error" in cell) throw new Error(`contains an Excel error (${String(cell.error)})`);
  if ("formula" in cell || "sharedFormula" in cell) {
    if (!Object.prototype.hasOwnProperty.call(cell, "result") || cell.result === undefined || cell.result === null) {
      throw new Error("has a formula without a saved result. Recalculate and save the workbook in Excel first");
    }
    return scalarValue(cell.result);
  }
  if (Array.isArray(cell.richText)) return cell.richText.map((part) => String((part as { text?: unknown }).text ?? "")).join("").trim();
  if (cell.text !== undefined) return scalarValue(cell.text);
  throw new Error("contains an unsupported cell value");
}

/** Keep job identifiers as text, including Excel's simple leading-zero masks. */
export function jobWorkbookCellText(cell: JobWorkbookCell, identifier = false): string {
  const value = scalarValue(cell.value);
  if (identifier && typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("must be a text identifier or a whole number that Excel can preserve exactly");
    const mask = String(cell.numFmt ?? "").split(";")[0].trim();
    if (/^0{2,}$/.test(mask)) return String(value).padStart(mask.length, "0");
  }
  return String(value).trim();
}

function cleanRepeatedText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  const words = text.split(" ").filter(Boolean);
  for (let size = 1; size <= Math.floor(words.length / 2); size++) {
    if (words.length % size) continue;
    const pattern = words.slice(0, size).join(" ");
    if (words.every((word, index) => word.toLowerCase() === words[index % size].toLowerCase())) return pattern;
  }
  return text;
}

function colorHex(color: WorkbookColor): string {
  // Excel's standard indexed palette includes bright red at indexes 2 and 10.
  if (color.indexed === 2 || color.indexed === 10) return "FF0000";
  const value = String(color.argb ?? color.rgb ?? "").replace(/^#/, "").toUpperCase();
  return value.length === 8 ? value.slice(2) : value;
}

function isRedFill(fill?: WorkbookFill): boolean {
  if (!fill || fill.pattern === "none") return false;
  return [fill.fgColor, fill.bgColor].some((color) => {
    if (!color) return false;
    const hex = colorHex(color);
    if (!/^[0-9A-F]{6}$/.test(hex)) return false;
    const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    if (maximum === minimum || maximum !== red) return false;
    const hue = (60 * ((green - blue) / (maximum - minimum)) + 360) % 360;
    return hue <= 20 || hue >= 340;
  });
}

function isHighlightedFill(fill?: WorkbookFill): boolean {
  if (!fill || fill.pattern === "none") return false;
  const colors = [fill.fgColor, fill.bgColor].filter((color): color is WorkbookColor => Boolean(color));
  if (colors.some((color) => {
    const value = String(color.argb ?? color.rgb ?? color.indexed ?? color.theme ?? "").toUpperCase();
    return Boolean(value && !["FFFFFF", "FFFFFFFF", "000000", "FF000000", "64", "65", "0"].includes(value));
  })) return true;
  return Boolean(fill.type && fill.type !== "none" && fill.pattern && fill.pattern !== "none" && !colors.length);
}

export function validateJobImportRecords(records: readonly unknown[]): string[] {
  const errors: string[] = [];
  if (!records.length) errors.push("No valid jobs found. Check job names in columns A–E and job numbers in column F.");
  if (records.length > MAX_JOB_IMPORT_RECORDS) errors.push(`The workbook exceeds the ${MAX_JOB_IMPORT_RECORDS.toLocaleString("en-CA")} job import limit.`);
  const seen = new Set<string>();
  for (const [index, candidate] of records.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      errors.push(`Job row ${index + 1} is not a valid job record.`);
      continue;
    }
    const row = candidate as Record<string, unknown>;
    for (const [field, maximum] of [["jobNumber", 100], ["jobName", 300], ["projectManager", 150], ["jobType", 60]] as const) {
      const value = row[field];
      if (typeof value !== "string" || value.length > maximum || /[\u0000-\u001F\u007F]/.test(value)) errors.push(`Job row ${index + 1}: ${field} is invalid or exceeds ${maximum} characters.`);
    }
    if (typeof row.jobNumber !== "string" || !row.jobNumber.trim() || typeof row.jobName !== "string" || !row.jobName.trim()) errors.push(`Job row ${index + 1} needs a job number and name.`);
    if (typeof row.active !== "boolean") errors.push(`Job row ${index + 1} has an invalid active status.`);
    const key = typeof row.jobNumber === "string" ? jobImportNumberKey(row.jobNumber) : "";
    if (key && seen.has(key)) errors.push(`Duplicate job number “${row.jobNumber}”. Keep one row for that job before importing.`);
    seen.add(key);
  }
  return [...new Set(errors)];
}

export function parseJobWorkbook(workbook: JobWorkbook, currentYear = new Date().getFullYear()): ParsedJobWorkbook {
  const result: ParsedJobWorkbook = { records: [], sheetNames: [], ignoredSheetNames: [], skippedCancelled: 0, skippedIncomplete: 0, highlightedInactive: 0, warnings: [], errors: [] };
  const origins = new Map<string, string>();
  const worksheets = workbook.worksheets.filter((sheet) => {
    const included = isJobImportSheet(sheet.name, currentYear);
    (included ? result.sheetNames : result.ignoredSheetNames).push(sheet.name);
    return included;
  });
  if (!worksheets.length) {
    result.errors.push(`No ${2025}–${currentYear} tabs found in this Excel file.`);
    return result;
  }
  for (const sheet of worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const origin = `${sheet.name}, row ${rowNumber || row.number || "?"}`;
      try {
        const fills = [row.fill, ...Array.from({ length: 11 }, (_, index) => row.getCell(index + 1).fill)];
        if (fills.some(isRedFill)) { result.skippedCancelled++; return; }
        const jobNumber = jobWorkbookCellText(row.getCell(6), true);
        const seenNameParts = new Set<string>();
        const parts = Array.from({ length: 5 }, (_, index) => cleanRepeatedText(jobWorkbookCellText(row.getCell(index + 1))))
          .filter((part) => {
            const key = headerKey(part);
            if (!part || seenNameParts.has(key)) return false;
            seenNameParts.add(key);
            return true;
          });
        const jobName = cleanRepeatedText(parts.join(" "));
        if (["jobno", "jobnumber"].includes(headerKey(jobNumber)) || headerKey(jobName) === "jobname") return;
        if (!jobNumber || !jobName) {
          if (jobNumber || jobName) result.skippedIncomplete++;
          return;
        }
        const active = !fills.some(isHighlightedFill);
        if (!active) result.highlightedInactive++;
        const record = { jobNumber, jobName, projectManager: jobWorkbookCellText(row.getCell(8)), jobType: jobWorkbookCellText(row.getCell(11)), active };
        const key = jobImportNumberKey(jobNumber);
        if (origins.has(key)) result.errors.push(`Duplicate job number “${jobNumber}” in ${origins.get(key)} and ${origin}. Resolve both rows before importing.`);
        else origins.set(key, origin);
        result.records.push(record);
      } catch (error) {
        result.errors.push(`${origin}: ${error instanceof Error ? error.message : "could not read this row"}.`);
      }
    });
  }
  result.records.sort((left, right) => left.jobNumber.localeCompare(right.jobNumber, "en-CA", { numeric: true }));
  result.errors = [...new Set([...result.errors, ...validateJobImportRecords(result.records)])];
  if (result.skippedCancelled) result.warnings.push(`${result.skippedCancelled} red-highlighted row(s) excluded as cancelled. Existing jobs are not deleted.`);
  if (result.skippedIncomplete) result.warnings.push(`${result.skippedIncomplete} incomplete row(s) skipped because the job number or name is missing.`);
  if (result.highlightedInactive) result.warnings.push(`${result.highlightedInactive} other highlighted job(s) will be inactive and hidden from employee job selectors.`);
  if (result.ignoredSheetNames.length) result.warnings.push(`Tabs outside ${2025}–${currentYear} were ignored: ${result.ignoredSheetNames.join(", ")}.`);
  return result;
}
