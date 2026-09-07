import { useRef, useState } from "react";
import { parseJobWorkbook, type JobWorkbook, type ParsedJobWorkbook } from "../lib/job-workbook-import";

interface ImportJobReference { id: string; jobNumber: string; jobName: string }
export interface JobImportPreview {
  insertCount: number;
  updateCount: number;
  activeCount: number;
  inactiveCount: number;
  missingJobs: ImportJobReference[];
  protectedMissingJobs: ImportJobReference[];
  snapshot: string;
}
interface ImportResponse { preview?: JobImportPreview; message?: string; error?: string }
interface ExcelReader { Workbook: new () => JobWorkbook & { xlsx: { load(bytes: ArrayBuffer): Promise<unknown> } } }
let excelReaderPromise: Promise<ExcelReader> | null = null;

function loadJobExcelReader(): Promise<ExcelReader> {
  const readerWindow = window as Window & { ExcelJS?: ExcelReader };
  if (readerWindow.ExcelJS) return Promise.resolve(readerWindow.ExcelJS);
  if (excelReaderPromise) return excelReaderPromise;
  excelReaderPromise = new Promise<ExcelReader>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => failed(), 20_000);
    const failed = () => {
      window.clearTimeout(timer);
      script.remove();
      excelReaderPromise = null;
      reject(new Error("The Excel reader could not be loaded. Check the connection and try again."));
    };
    script.src = new URL("../vendor/exceljs.min.js?v=1", window.location.href).href;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      if (readerWindow.ExcelJS) resolve(readerWindow.ExcelJS);
      else failed();
    };
    script.onerror = failed;
    document.head.appendChild(script);
  });
  return excelReaderPromise;
}

async function importRequest(body: Record<string, unknown>): Promise<ImportResponse> {
  const response = await fetch("/api/job-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as ImportResponse;
  if (!response.ok) throw new Error(result.error || "The job import could not be completed. No changes have been confirmed.");
  return result;
}

/** Preview-only until the administrator explicitly confirms the reviewed changes. */
export function JobImportPanel({ onImported }: { onImported: () => void | Promise<void> }) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [parsed, setParsed] = useState<ParsedJobWorkbook | null>(null);
  const [preview, setPreview] = useState<JobImportPreview | null>(null);
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState<"reading" | "preview" | "applying" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deactivateMissing, setDeactivateMissing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const resetReview = () => { setPreview(null); setDeactivateMissing(false); setConfirmed(false); setError(""); setMessage(""); };
  const clearFile = () => {
    resetReview(); setParsed(null); setFilename("");
    if (fileInput.current) fileInput.current.value = "";
  };
  const requestPreview = async (workbook: ParsedJobWorkbook) => {
    resetReview();
    setBusy("preview");
    try {
      const result = await importRequest({ action: "preview", records: workbook.records });
      if (!result.preview?.snapshot || !Array.isArray(result.preview.missingJobs) || !Array.isArray(result.preview.protectedMissingJobs)) throw new Error("The Portal did not return a complete preview. Nothing has been imported.");
      setPreview(result.preview);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The import preview could not be loaded.");
    } finally { setBusy(null); }
  };
  const readFile = async (file?: File) => {
    resetReview(); setParsed(null); setFilename("");
    if (!file) return;
    setFilename(file.name);
    if (!/\.xlsx$/i.test(file.name)) { setError("Choose an .xlsx Excel job-list workbook."); return; }
    if (file.size > 25 * 1024 * 1024) { setError("This workbook exceeds the 25 MB job-list upload limit."); return; }
    setBusy("reading");
    try {
      const ExcelJS = await loadJobExcelReader();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const result = parseJobWorkbook(workbook);
      setParsed(result);
      if (result.errors.length) { setBusy(null); return; }
      await requestPreview(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "This workbook could not be read. Open and save it as .xlsx in Excel, then try again.");
      setBusy(null);
    }
  };
  const applyImport = async () => {
    if (!parsed || !preview || parsed.errors.length || !confirmed || busy) return;
    setBusy("applying"); setError(""); setMessage("");
    try {
      const result = await importRequest({
        action: "apply", records: parsed.records, expectedSnapshot: preview.snapshot,
        deactivateMissingJobIds: deactivateMissing ? preview.missingJobs.map((job) => job.id) : [],
      });
      // A successful write must never be offered for retry if only the following refresh fails.
      clearFile();
      setMessage(result.message || "Job list imported. Existing job IDs and linked Portal records have been retained.");
      try { await onImported(); }
      catch { setError("The import was saved, but the job list could not refresh. Use Refresh jobs; do not import again just to refresh."); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The import failed. Refresh the preview before trying again.");
      setPreview(null); setConfirmed(false); setDeactivateMissing(false);
    } finally { setBusy(null); }
  };

  return <section className="panel form-panel job-import-panel" aria-labelledby="job-import-heading" aria-busy={Boolean(busy)} style={{ minWidth: 0, overflowWrap: "anywhere" }}>
    <div className="panel-heading"><div><span className="eyebrow">OFFICIAL PORTAL JOB LIST</span><h2 id="job-import-heading">Import Excel job list</h2><p>Review the workbook before saving. Existing job numbers and their connected timesheets, POs and Work Orders are retained.</p></div></div>
    <div className="form-grid" style={{ padding: "1rem", gap: "1rem" }}>
      <label className="field full"><span>Excel workbook (.xlsx)</span><input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={Boolean(busy)} onChange={(event) => void readFile(event.target.files?.[0])} aria-label="Excel job-list workbook" />
        <small>Tabs from 2025 through the current year. Job name: A–E. Job number: F. Project manager: H. Contract / T&amp;M: K. Red rows are excluded; other highlighted rows are inactive.</small>
      </label>
      {filename && <div className="field full"><strong style={{ overflowWrap: "anywhere" }}>{filename}</strong><div className="quote-primary-actions"><button className="button secondary compact" type="button" disabled={Boolean(busy)} onClick={clearFile}>Clear selected file</button>{parsed && !parsed.errors.length && <button className="button secondary compact" type="button" disabled={Boolean(busy)} onClick={() => void requestPreview(parsed)}>Refresh import preview</button>}</div></div>}
      {busy && <p className="field full" role="status">{busy === "reading" ? "Reading workbook…" : busy === "preview" ? "Comparing with the current Portal job list…" : "Saving the reviewed job-list changes…"}</p>}
      {error && <div className="estimating-boundary-note has-warning field full" role="alert">{error}</div>}
      {message && <div className="estimating-boundary-note field full" role="status">{message}</div>}
      {parsed && Boolean(parsed.errors.length) && <div className="estimating-boundary-note has-warning field full" role="alert"><strong>Nothing has been imported. Fix these workbook issues first:</strong><ul>{parsed.errors.slice(0, 25).map((issue, index) => <li key={index}>{issue}</li>)}</ul>{parsed.errors.length > 25 && <p>{parsed.errors.length - 25} additional issues need correction.</p>}</div>}
      {parsed && Boolean(parsed.warnings.length) && <div className="field full"><strong>Workbook notes</strong><ul>{parsed.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
      {parsed && !parsed.errors.length && <details className="field full"><summary>Review {parsed.records.length} workbook jobs ({parsed.sheetNames.join(", ")})</summary><div className="data-table-wrap" style={{ maxHeight: "24rem", overflow: "auto" }}><table className="data-table"><thead><tr><th>Job #</th><th>Job name</th><th>Project manager</th><th>Type</th><th>Import status</th></tr></thead><tbody>{parsed.records.map((job) => <tr key={job.jobNumber}><td data-label="Job #">{job.jobNumber}</td><td data-label="Job name">{job.jobName}</td><td data-label="Project manager">{job.projectManager || "Not set"}</td><td data-label="Type">{job.jobType || "Not set"}</td><td data-label="Import status">{job.active ? "Active" : "Inactive"}</td></tr>)}</tbody></table></div></details>}
      {preview && <div className="field full" data-testid="job-import-preview">
        <h3>Changes to review</h3>
        <p>{preview.insertCount} new jobs · {preview.updateCount} existing jobs updated · {preview.activeCount} active and {preview.inactiveCount} inactive workbook jobs.</p>
        <p>Customer details, addresses, schedules and document links are kept. No job is deleted.</p>
        {Boolean(preview.protectedMissingJobs.length) && <details><summary>{preview.protectedMissingJobs.length} quote-linked job(s) missing from this workbook will stay unchanged</summary><ul>{preview.protectedMissingJobs.map((job) => <li key={job.id}>{job.jobNumber} — {job.jobName}</li>)}</ul></details>}
        {Boolean(preview.missingJobs.length) && <div className="estimating-boundary-note has-warning" style={{ display: "block", marginTop: "1rem" }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: ".6rem" }}><input type="checkbox" checked={deactivateMissing} disabled={Boolean(busy)} onChange={(event) => { setDeactivateMissing(event.target.checked); setConfirmed(false); }} style={{ width: "1rem", height: "1rem", minHeight: 0, flexShrink: 0, marginTop: ".2rem" }} /><span>Also mark these {preview.missingJobs.length} missing jobs inactive. This hides them from employee job selectors but keeps their records.</span></label>
          <details><summary>Review jobs missing from the workbook</summary><ul>{preview.missingJobs.map((job) => <li key={job.id}>{job.jobNumber} — {job.jobName}</li>)}</ul></details>
          {!deactivateMissing && <p>Leave unchecked to keep every missing job unchanged.</p>}
        </div>}
        <label style={{ display: "flex", alignItems: "flex-start", gap: ".6rem", marginTop: "1rem" }}><input type="checkbox" checked={confirmed} disabled={Boolean(busy)} onChange={(event) => setConfirmed(event.target.checked)} style={{ width: "1rem", height: "1rem", minHeight: 0, flexShrink: 0, marginTop: ".2rem" }} /><span>I have reviewed the job names and active/inactive changes above.</span></label>
        <div className="quote-primary-actions" style={{ marginTop: "1rem" }}><button className="button primary" type="button" disabled={!confirmed || Boolean(busy)} onClick={() => void applyImport()}>Confirm and import {parsed?.records.length ?? 0} {parsed?.records.length === 1 ? "job" : "jobs"}</button></div>
      </div>}
    </div>
  </section>;
}
