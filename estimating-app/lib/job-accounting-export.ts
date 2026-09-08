/** Accounting hand-off only. Never read by the operational job importer. */
export type AccountingCell = string | number | null | { date: string };
export type AccountingColor = "white" | "green" | "yellow" | "red";
export interface AccountingSourceJob {
  jobNumber: string; jobName: string; active: boolean; cancelledAt: string | null;
  statusChangedAt: string | null; projectManager: string; jobType: string;
  customer: string; site: string; address: string; startDate: string | null;
  targetEndDate: string | null; price: number | null; extras: number | null;
  acceptedAt: string | null; customerPo: string; quoteReference: string;
}
export interface AccountingMasterRow { jobNumber: string; color: AccountingColor; cells: AccountingCell[] }
export interface AccountingExportRow extends AccountingMasterRow {
  changed: boolean; change: string; customer: string; site: string; address: string; targetEndDate: string;
}
export interface AccountingExportPreview {
  version: number; previousExportId: string | null; sourceSnapshot: AccountingSourceJob[];
  previousSnapshot: AccountingSourceJob[]; previousRows: AccountingExportRow[];
  baselineSnapshot: AccountingSourceJob[]; masterRows: AccountingMasterRow[];
  sourceName: string; sourceSha256: string; trackingStartedAt: string;
}
export interface AccountingExportPlan {
  rows: AccountingExportRow[];
  summary: { total: number; green: number; yellow: number; red: number; white: number; changed: number; reviewInactive: number; missingFromPortal: number };
}
const key = (number: string) => number.trim().toLowerCase();
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const dateCell = (date: string | null): AccountingCell => date ? { date: date.slice(0, 10) } : null;
const manager = (name: string) => /^(ZH|Zeth Hummel)$/i.test(name.trim()) ? "ZH" : /^(JV|Jeff Vandrish)$/i.test(name.trim()) ? "JV" : name;

export function planJobAccountingExport(preview: AccountingExportPreview): AccountingExportPlan {
  const current = new Map(preview.sourceSnapshot.map((row) => [key(row.jobNumber), row]));
  const baseline = new Map(preview.baselineSnapshot.map((row) => [key(row.jobNumber), row]));
  const previous = new Map(preview.previousSnapshot.map((row) => [key(row.jobNumber), row]));
  const master = new Map(preview.masterRows.map((row) => [key(row.jobNumber), row]));
  const oldRows = new Map(preview.previousRows.map((row) => [key(row.jobNumber), row]));
  if (current.size !== preview.sourceSnapshot.length || master.size !== preview.masterRows.length) throw new Error("Duplicate job numbers need review before exporting.");
  const first = !preview.previousExportId;
  const rows: AccountingExportRow[] = [];
  let reviewInactive = 0, missingFromPortal = 0;
  for (const number of new Set([...master.keys(), ...current.keys()])) {
    const job = current.get(number), seed = baseline.get(number), before = previous.get(number), original = master.get(number), old = oldRows.get(number);
    const changed = stable(job ?? null) !== stable(before ?? null);
    // Imports intentionally do not record the invoicing meaning of a colour.
    // Only an explicit status action can supersede the supplied master meaning.
    const explicitStatus = Boolean(job && (!seed || job.statusChangedAt !== seed.statusChangedAt || job.cancelledAt !== seed.cancelledAt));
    let color: AccountingColor | null = original?.color ?? (job?.active ? "white" : null);
    if (job && explicitStatus) color = job.active ? "white" : job.cancelledAt ? "red" : job.statusChangedAt ? "green" : null;
    else if (job && seed && job.active !== seed.active) {
      color = job.active ? "white" : null;
    }
    if (!color) { reviewInactive++; continue; }
    // A new close/reopen/close cycle is a fresh green hand-off, even if its end
    // state and hours match the last download. Detail-only edits stay yellow.
    const newClosure = Boolean(job && before && (job.statusChangedAt !== before.statusChangedAt || job.active !== before.active || job.cancelledAt !== before.cancelledAt));
    if (color === "green" && !first && !newClosure && old && (old.color === "green" || old.color === "yellow")) color = "yellow";
    const initiallyColoured = first && original && original.color !== "white";
    if (!initiallyColoured && !changed && color !== "yellow") continue;
    // Unchanged active projects do not belong in the hand-off; retain yellow.
    const cells: AccountingCell[] = original ? original.cells.map((cell) => cell && typeof cell === "object" ? { ...cell } : cell) : Array(16).fill(null);
    cells[5] = job?.jobNumber ?? original!.jobNumber;
    if (job) {
      const replace = (field: keyof AccountingSourceJob, column: number, value: AccountingCell) => {
        if (!original || !seed || stable(job[field]) !== stable(seed[field])) cells[column] = value;
      };
      replace("jobName", 0, job.jobName);
      replace("projectManager", 7, manager(job.projectManager));
      replace("jobType", 10, job.jobType);
      replace("startDate", 8, dateCell(job.startDate));
      // A linked accepted estimate is authoritative for its price and approved
      // extras, including estimates already present when tracking was enabled.
      // Imported-only jobs retain the pricing from the supplied master.
      if (job.price !== null || !original) cells[9] = job.price;
      if (job.extras !== null || !original) cells[11] = job.extras;
      if (!original || !seed || job.customerPo !== seed.customerPo || job.quoteReference !== seed.quoteReference) cells[6] = job.customerPo || job.quoteReference || null;
      if (!original && job.acceptedAt) cells[13] = dateCell(job.acceptedAt);
      // Closing a project is not proof of the physical completion date. Leave
      // Date Completed as supplied; never substitute the target end date.
    }
    if (!job) missingFromPortal++;
    rows.push({ jobNumber: String(cells[5]), color, cells, changed: Boolean(changed || initiallyColoured),
      change: initiallyColoured ? "Starting master workbook" : !job ? "Retained master row; not in current portal" : !before ? "New job" : newClosure ? job.active ? "Project reopened" : job.cancelledAt ? "Job cancelled" : "Project closed" : changed ? "Job details updated" : "Previously handed to accounting",
      customer: job?.customer ?? "", site: job?.site ?? "", address: job?.address ?? "", targetEndDate: job?.targetEndDate ?? "" });
  }
  rows.sort((a, b) => a.jobNumber.localeCompare(b.jobNumber, "en-CA", { numeric: true }));
  return { rows, summary: { total: rows.length, green: rows.filter((r) => r.color === "green").length,
    yellow: rows.filter((r) => r.color === "yellow").length, red: rows.filter((r) => r.color === "red").length,
    white: rows.filter((r) => r.color === "white").length, changed: rows.filter((r) => r.changed).length, reviewInactive, missingFromPortal } };
}

export function accountingExportFilename(version: number) { return `JGC Accounting Job List - v${String(version).padStart(4, "0")}.xlsx`; }
export async function accountingFileHash(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function accountingBytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function accountingBase64ToBytes(encoded: string) { return Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0)); }
