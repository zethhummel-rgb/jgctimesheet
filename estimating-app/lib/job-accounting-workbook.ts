import { type AccountingCell, type AccountingExportPlan, type AccountingExportPreview } from "./job-accounting-export";

let loading: Promise<any> | null = null;
async function excelWriter(): Promise<any> {
  const host = window as Window & { ExcelJS?: any };
  if (host.ExcelJS) return host.ExcelJS;
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const failed = () => { clearTimeout(timer); script.remove(); loading = null; reject(new Error("The Excel writer could not load. No download version was saved. Please retry.")); };
    const timer = setTimeout(failed, 20_000);
    script.src = new URL("../vendor/exceljs.min.js?v=1", window.location.href).href;
    script.onload = () => { clearTimeout(timer); host.ExcelJS ? resolve(host.ExcelJS) : failed(); };
    script.onerror = failed;
    document.head.appendChild(script);
  });
  return loading;
}
const colors = { white: "FFFFFFFF", green: "FF92D050", yellow: "FFFFFF00", red: "FFFF0000", blue: "FF9BC2E6" };
const excelValue = (value: AccountingCell) => value && typeof value === "object" ? new Date(`${value.date.slice(0, 10)}T00:00:00Z`) : value;
const states = { white: "Active", green: "Closed - ready to invoice", yellow: "Previously handed to accounting", red: "Cancelled", blue: "Closed - discuss invoicing" };
// Measured from the supplied master: Arial 10 pt, 12.75 pt standard rows.
// Keep entries single-line like that workbook; do not auto-grow the job list.
const masterRowHeight = 12.75;

/** Runtime Excel generation uses the Portal's existing bundled ExcelJS library.
 * Literal cell values (never formulas/links) prevent spreadsheet formula injection. */
export async function buildJobAccountingWorkbook(preview: AccountingExportPreview, plan: AccountingExportPlan): Promise<Uint8Array> {
  const ExcelJS = await excelWriter();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "JGC Estimate Desk";
  const versionLabel = `Version ${preview.version}`;
  workbook.title = `Accounting Job List ${versionLabel}`;
  const groups = new Map<string, typeof plan.rows>();
  for (const row of plan.rows) {
    const year = /^(\d{2})\d/.exec(row.jobNumber)?.[1];
    const sheetName = year ? String(2000 + Number(year)) : "Other jobs";
    groups.set(sheetName, [...(groups.get(sheetName) ?? []), row]);
  }
  for (const [year, rows] of [...groups].sort(([a], [b]) => b.localeCompare(a))) {
    const sheet = workbook.addWorksheet(year, { views: [{ state: "frozen", ySplit: 2 }], properties: { defaultRowHeight: masterRowHeight }, pageSetup: { orientation: "landscape", paperSize: 5, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const widths = [8.43, 8.43, 8.43, 8.43, 17.71, 10, 17, 10, 12, 14, 12, 12, 9, 32, 15, 9];
    widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.mergeCells("A1:E2");
    sheet.getCell("A1").value = "Job Name";
    const headings = ["Job No", "PO No", "Est By", "Start", "Price", "Type", "Extras", "Subs", "Date", "Date Completed", "NEW"];
    headings.forEach((label, index) => { const column = index + 6; sheet.mergeCells(1, column, 2, column); sheet.getCell(1, column).value = label; });
    for (let r = 1; r <= 2; r++) for (let c = 1; c <= 16; c++) {
      const cell = sheet.getCell(r, c);
      cell.font = { name: "Arial", size: 10, color: { argb: "FF000000" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EBD8" } };
      sheet.getRow(r).height = masterRowHeight;
    }
    for (let index = 0; index < rows.length; index++) {
      const source = rows[index], number = index + 3;
      sheet.mergeCells(number, 1, number, 5);
      source.cells.forEach((value, col) => {
        // Job names span A:E; merged slave cells must not overwrite the name.
        if (col > 0 && col < 5) return;
        const cell = sheet.getCell(number, col + 1);
        cell.value = excelValue(value);
        cell.font = { name: "Arial", size: 10, color: { argb: "FF000000" } };
        cell.alignment = { vertical: "bottom", wrapText: false, horizontal: col === 0 ? "left" : [9, 11].includes(col) ? "right" : "center" };
        if (col === 5 || col === 6) { cell.value = value == null ? null : String(value); cell.numFmt = "@"; }
        if ([9, 11].includes(col)) cell.numFmt = '"$"#,##0.00;("$"#,##0.00)';
        if ([8, 13, 14].includes(col) && value && typeof value === "object") cell.numFmt = col === 13 ? "dddd mmmm d, yyyy" : "mmm d, yyyy";
      });
      for (let col = 1; col <= 16; col++) {
        const cell = sheet.getCell(number, col);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors[source.color] } };
        cell.border = { bottom: { style: "dotted", color: { argb: "FF595959" } }, right: { style: "dotted", color: { argb: "FF595959" } } };
      }
      sheet.getRow(number).height = masterRowHeight;
    }
    const footer = rows.length + 5;
    [
      `JGC Accounting Job List - ${versionLabel}. Starting reference: ${preview.sourceName}.`,
      "Green: closed, ready to invoice. Red: cancelled. White: active project (including unchanged jobs).",
      "Blue: closed - discuss invoicing with accounting. Blue and green become yellow on the next download.",
      "Yellow: previously handed to accounting, or already yellow in the starting master. Not confirmation of an invoice.",
      "This download does not replace or update the uploaded master list. Copy reviewed changes into the accounting master.",
      "Blank fields were not supplied. Date Completed is preserved from the master; closing a job does not invent a completion date.",
    ].forEach((line, index) => { sheet.mergeCells(footer + index, 1, footer + index, 16); const cell = sheet.getCell(footer + index, 1); cell.value = line; cell.font = { name: "Arial", size: 10, color: { argb: "FF000000" } }; cell.alignment = { wrapText: false, vertical: "bottom" }; sheet.getRow(footer + index).height = masterRowHeight; });
    sheet.pageSetup.printTitlesRow = "1:2";
    sheet.pageSetup.printArea = `A1:P${footer + 5}`;
    sheet.headerFooter.oddFooter = `&C${versionLabel} | Page &P of &N`;
  }
  const details = workbook.addWorksheet("Download details", { views: [{ state: "frozen", ySplit: 5 }], properties: { defaultRowHeight: masterRowHeight } });
  [12, 38, 39, 32, 32, 48, 18].forEach((width, index) => { details.getColumn(index + 1).width = width; });
  details.mergeCells("A1:G1"); details.getCell("A1").value = `Accounting job-list download - ${versionLabel}`;
  details.mergeCells("A2:G2"); details.getCell("A2").value = `Reference: ${preview.sourceName}. SHA-256: ${preview.sourceSha256}`;
  details.mergeCells("A3:G3"); details.getCell("A3").value = `${plan.summary.total} jobs: ${plan.summary.white} active, ${plan.summary.green} ready to invoice, ${plan.summary.blue} discuss invoicing, ${plan.summary.yellow} previously handed off, ${plan.summary.red} cancelled. Saved versions never change.`;
  details.mergeCells("A4:G4"); details.getCell("A4").value = `${plan.summary.reviewInactive} inactive rows need billing-status review. ${plan.summary.missingFromPortal} retained source rows are not in the portal. No job is deleted by this download.`;
  details.getRow(5).values = ["Job No", "Accounting status", "Change / source", "Client", "Site", "Address", "Target end date"];
  for (const row of plan.rows) details.addRow([row.jobNumber, states[row.color], row.change, row.customer || null, row.site || null, row.address || null, row.targetEndDate ? new Date(`${row.targetEndDate}T00:00:00Z`) : null]);
  details.eachRow((row: any, number: number) => { row.height = masterRowHeight; row.eachCell((cell: any) => {
    cell.font = { name: "Arial", size: 10, bold: number === 1 || number === 5, color: { argb: "FF000000" } };
    cell.alignment = { vertical: "bottom", wrapText: false };
    if (number === 5) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2EBD8" } };
  }); });
  details.getColumn(7).numFmt = "mmm d, yyyy";
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  if (!bytes.length || bytes[0] !== 80 || bytes[1] !== 75) throw new Error("The Excel file was not generated. No version was saved.");
  return bytes;
}
