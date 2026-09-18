/** Accounting hand-off only. Never read by the operational job importer. */
export type AccountingCell = string | number | null | { date: string };
export type AccountingColor = "white" | "green" | "yellow" | "red" | "blue";
export interface AccountingSourceJob {
  jobNumber: string; jobName: string; active: boolean; cancelledAt: string | null;
  invoiceReviewAt?: string | null;
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
  cycle: number;
  version: number; previousExportId: string | null; sourceSnapshot: AccountingSourceJob[];
  previousSnapshot: AccountingSourceJob[]; previousRows: AccountingExportRow[];
  baselineSnapshot: AccountingSourceJob[]; masterRows: AccountingMasterRow[];
  sourceName: string; sourceSha256: string; trackingStartedAt: string;
}
export interface AccountingExportPlan {
  rows: AccountingExportRow[];
  summary: { total: number; green: number; yellow: number; red: number; white: number; blue: number; changed: number; reviewInactive: number; missingFromPortal: number };
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
  let missingFromPortal = 0;
  for (const number of new Set([...master.keys(), ...current.keys(), ...oldRows.keys(), ...previous.keys(), ...baseline.keys()])) {
    const job = current.get(number), seed = baseline.get(number), before = previous.get(number), original = master.get(number), old = oldRows.get(number);
    // Legacy saved snapshots omit invoiceReviewAt; null is the same state.
    const comparable = (row: AccountingSourceJob | undefined) => row ? { ...row, invoiceReviewAt: row.invoiceReviewAt ?? null } : null;
    const changed = stable(comparable(job)) !== stable(comparable(before));
    // Compare against the last saved download, not the original import, so a
    // newly inactive job is green once and existing inactive jobs are yellow.
    const newClosure = Boolean(job && before && (job.statusChangedAt !== before.statusChangedAt || job.active !== before.active || job.cancelledAt !== before.cancelledAt || (job.invoiceReviewAt ?? null) !== (before.invoiceReviewAt ?? null)));
    const newlyInactive = Boolean(job && !job.active && (
      before?.active
      || (newClosure && job.statusChangedAt)
      || (!before && job.statusChangedAt && Date.parse(job.statusChangedAt) >= Date.parse(preview.trackingStartedAt))
    ));
    const explicitStatus = Boolean(job && (!seed || job.statusChangedAt !== seed.statusChangedAt || job.cancelledAt !== seed.cancelledAt || (job.invoiceReviewAt ?? null) !== (seed.invoiceReviewAt ?? null)));
    let color: AccountingColor = old?.color ?? original?.color ?? "yellow";
    if (job) {
      color = job.active ? "white"
        : job.cancelledAt ? "red"
        : job.invoiceReviewAt ? "blue"
        : !explicitStatus && original?.color === "red" ? "red"
        : !explicitStatus && original?.color === "blue" ? "blue"
        : newlyInactive ? "green" : "yellow";
    }
    // Retained historical rows also advance after their first hand-off.
    if ((color === "green" || color === "blue") && !first && !newClosure && old && (old.color === color || old.color === "yellow")) color = "yellow";
    const initiallyColoured = first && original && original.color !== "white";
    // Every project belongs in each download, even when unchanged.
    // Retain previously exported rows if they later disappear from the portal.
    const retained = !job ? before ?? seed : undefined;
    const source = job ?? retained;
    const reference = original ?? (!job ? old : undefined);
    const cells: AccountingCell[] = reference ? reference.cells.map((cell) => cell && typeof cell === "object" ? { ...cell } : cell) : Array(16).fill(null);
    cells[5] = source?.jobNumber ?? reference!.jobNumber;
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
    if (!job && !reference && retained) {
      cells[0] = retained.jobName;
      cells[6] = retained.customerPo || retained.quoteReference || null;
      cells[7] = manager(retained.projectManager);
      cells[8] = dateCell(retained.startDate);
      cells[9] = retained.price;
      cells[10] = retained.jobType;
      cells[11] = retained.extras;
      cells[13] = dateCell(retained.acceptedAt);
      color = retained.cancelledAt ? "red" : retained.active ? "white" : "yellow";
    }
    if (!job) missingFromPortal++;
    rows.push({ jobNumber: String(cells[5]), color, cells, changed: Boolean(changed || initiallyColoured),
      change: newClosure ? job!.active ? "Project reopened" : job!.cancelledAt ? "Job cancelled" : job!.invoiceReviewAt ? "Closed - discuss invoicing" : before?.invoiceReviewAt ? "Discussion resolved - ready to invoice" : "Project closed" : initiallyColoured ? "Starting master workbook" : !job ? "Retained source row; not in current portal" : !before ? "New job" : changed ? "Job details updated" : ({ white: "Active project", green: "Ready to invoice", red: "Cancelled job", yellow: "Previously handed to accounting", blue: "Closed - discuss invoicing" }[color]),
      customer: source?.customer ?? old?.customer ?? "", site: source?.site ?? old?.site ?? "", address: source?.address ?? old?.address ?? "", targetEndDate: source?.targetEndDate ?? old?.targetEndDate ?? "" });
  }
  rows.sort((a, b) => a.jobNumber.localeCompare(b.jobNumber, "en-CA", { numeric: true }));
  return { rows, summary: { total: rows.length, green: rows.filter((r) => r.color === "green").length,
    yellow: rows.filter((r) => r.color === "yellow").length, red: rows.filter((r) => r.color === "red").length,
    white: rows.filter((r) => r.color === "white").length, blue: rows.filter((r) => r.color === "blue").length, changed: rows.filter((r) => r.changed).length, reviewInactive: 0, missingFromPortal } };
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
