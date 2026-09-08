import { useEffect, useRef, useState } from "react";
import { accountingBase64ToBytes, accountingBytesToBase64, accountingFileHash, type AccountingExportPlan, type AccountingExportPreview, type AccountingExportRow } from "../lib/job-accounting-export";

interface SavedVersion { id: string; cycle: number; version: number; file_name: string; file_sha256: string; exported_by_name: string; exported_at: string; summary: AccountingExportPlan["summary"]; rows?: AccountingExportRow[]; file_base64?: string }
interface ExportState { cycle: number; nextVersion: number; latestExportId: string | null; lastResetAt: string | null; lastResetBy: string | null }
interface DownloadRequest { id: string; downloaded_by_name: string; requested_at: string }
const pendingKey = "jgc-job-accounting-pending-version";
const resetKey = "jgc-job-accounting-pending-reset";
const pendingReset = {
  get: (): Record<string, unknown> | null => { try { return JSON.parse(sessionStorage.getItem(resetKey) || "null"); } catch { return null; } },
  set: (body: Record<string, unknown>) => { try { sessionStorage.setItem(resetKey, JSON.stringify(body)); } catch { /* The in-memory request remains retryable. */ } },
  clear: () => { try { sessionStorage.removeItem(resetKey); } catch { /* History remains durable. */ } },
};
const pending = { get: () => { try { return sessionStorage.getItem(pendingKey); } catch { return null; } }, set: (id: string) => { try { sessionStorage.setItem(pendingKey, id); } catch { /* History is still durable on the server. */ } }, clear: () => { try { sessionStorage.removeItem(pendingKey); } catch { /* Private-mode storage can be unavailable. */ } } };
const when = (value: string) => new Date(value).toLocaleString("en-CA", { timeZone: "America/Toronto" });
const labels = { white: "Active", green: "Ready to invoice", yellow: "Previously handed off", red: "Cancelled" };
async function request(body?: Record<string, unknown>, query = "") {
  const response = await fetch(`/api/job-accounting-export${query}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || "The accounting history could not be reached. Please retry."), { status: response.status });
  return result;
}

export function JobAccountingPanel({ workspaceSaved }: { workspaceSaved: boolean }) {
  const [history, setHistory] = useState<SavedVersion[]>([]), [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false), running = useRef(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  const [preview, setPreview] = useState<AccountingExportPreview | null>(null), [plan, setPlan] = useState<AccountingExportPlan | null>(null);
  const [selected, setSelected] = useState<SavedVersion | null>(null), [requests, setRequests] = useState<DownloadRequest[]>([]), [requestCount, setRequestCount] = useState(0);
  const [rowPage, setRowPage] = useState(0);
  const saveBody = useRef<Record<string, unknown> | null>(null);
  const resetBody = useRef<Record<string, unknown> | null>(pendingReset.get());
  const [exportState, setExportState] = useState<ExportState | null>(null);
  const [resetOpen, setResetOpen] = useState(Boolean(resetBody.current)), [confirmation, setConfirmation] = useState("");
  async function loadHistory(append = false) {
    const result = await request(undefined, `?offset=${append ? history.length : 0}`);
    setHistory((current) => append ? [...current, ...result.history] : result.history); setCount(result.count);
    setExportState(result.state);
  }
  useEffect(() => { void loadHistory().catch((cause) => setError(cause.message)); }, []);
  async function action(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : "The download could not be completed."); }
    finally { running.current = false; setBusy(false); }
  }
  async function viewVersion(id: string, moreRequests = false) {
    const result = await request(undefined, `?id=${encodeURIComponent(id)}&offset=${moreRequests ? requests.length : 0}`);
    setSelected(result.record); setPreview(null); setPlan(null); setRowPage(0);
    setRequests((current) => moreRequests ? [...current, ...result.requests] : result.requests); setRequestCount(result.requestCount);
  }
  async function downloadVersion(record: SavedVersion) {
    const result = await request({ action: "download", exportId: record.id, requestId: crypto.randomUUID() });
    const bytes = accountingBase64ToBytes(result.record.file_base64);
    if (await accountingFileHash(bytes) !== result.record.file_sha256) throw new Error("The downloaded file failed its integrity check. The saved version has not changed.");
    const href = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const anchor = document.createElement("a"); anchor.href = href; anchor.download = result.record.file_name;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(href), 60_000);
    setMessage(`Version ${record.version} download requested. The original file is kept in Download history. This does not confirm that it was copied into the accounting master.`);
    try { await viewVersion(record.id); }
    catch { setError("The download was requested, but its history could not refresh. Use Refresh history to check the saved log."); }
  }
  async function prepare() {
    if (resetBody.current) { setResetOpen(true); throw new Error("Retry the pending reset first so its result can be confirmed before creating another version."); }
    // Resolve an uncertain previous save before offering a new version.
    const id = pending.get();
    if (id) {
      try { await viewVersion(id); pending.clear(); saveBody.current = null; setMessage("Your previous version was saved. Use Download this version to retrieve the original file."); return; }
      catch (cause) { if ((cause as { status?: number }).status !== 404) throw cause; pending.clear(); }
    }
    const result = await request({ action: "preview" });
    setPreview(result.preview); setPlan(result.plan); setSelected(null); setRowPage(0); saveBody.current = null;
  }
  async function save() {
    if (!preview || !plan || !workspaceSaved) return;
    if (!saveBody.current) {
      const { buildJobAccountingWorkbook } = await import("../lib/job-accounting-workbook");
      const bytes = await buildJobAccountingWorkbook(preview, plan);
      saveBody.current = { action: "save", id: crypto.randomUUID(), preview, fileBase64: accountingBytesToBase64(bytes), fileSha256: await accountingFileHash(bytes) };
    }
    pending.set(String(saveBody.current.id));
    const saved = await request(saveBody.current);
    pending.clear(); saveBody.current = null; setPreview(null); setPlan(null);
    setHistory((current) => [saved.record, ...current.filter((record) => record.id !== saved.record.id)]);
    try { await loadHistory(); } catch { setCount((current) => current + (saved.reused ? 0 : 1)); }
    try { await downloadVersion(saved.record); }
    catch (cause) { throw new Error(`Version ${saved.record.version} is safely saved in Download history, but the browser download did not complete. Download that version again. ${cause instanceof Error ? cause.message : ""}`); }
  }
  async function resetDownloads() {
    if (!workspaceSaved || confirmation !== "RESET TO V1") return;
    if (!resetBody.current) {
      if (!exportState?.latestExportId) return;
      resetBody.current = { action: "reset", id: crypto.randomUUID(), expectedCycle: exportState.cycle, expectedExportId: exportState.latestExportId, confirmation };
      pendingReset.set(resetBody.current);
    }
    try { await request(resetBody.current); }
    catch (cause) {
      if ([400, 403, 409].includes((cause as { status: number }).status)) {
        resetBody.current = null; pendingReset.clear(); await loadHistory();
      }
      throw cause;
    }
    resetBody.current = null; pendingReset.clear(); pending.clear(); saveBody.current = null;
    setPreview(null); setPlan(null); setSelected(null); setResetOpen(false); setConfirmation("");
    setMessage("Reset completed. The next download starts at V1. Ready-to-invoice jobs will be green again; original master yellow rows stay yellow. Earlier runs remain in history. No jobs or imports were changed.");
    try { await loadHistory(); } catch { setError("The reset completed, but history could not refresh. Refresh history before creating another download."); setExportState(null); }
  }
  const rows = selected?.rows ?? plan?.rows ?? [];
  const summary = selected?.summary ?? plan?.summary;
  return <section className="panel job-accounting-panel" aria-label="Accounting job-list downloads">
    <div className="panel-heading"><div><span className="eyebrow">ACCOUNTING HAND-OFF</span><h3>Accounting job-list download</h3><p>All active, ready-to-invoice, previously handed-off and cancelled jobs in the master-list layout. Your existing Excel upload stays in use.</p></div>
      <button className="button primary compact" disabled={busy || !workspaceSaved} onClick={() => void action(prepare)}>Download accounting job list</button></div>
    <div className="job-accounting-body">
      <p className="job-accounting-legend">{(Object.keys(labels) as Array<keyof typeof labels>).map((color) => <span key={color} className={`accounting-chip accounting-${color}`}>{labels[color]}</span>)}</p>
      <p>Yellow means previously handed to accounting, or yellow in the starting master—not proof of invoicing. Old versions keep their original colours.</p>
      <p>Pricing comes from the starting master, with accepted Estimate Desk pricing and approved extras used for linked jobs.</p>
      <div className="job-accounting-actions">
        {exportState && <span>Next download: V{exportState.nextVersion} · Run {exportState.cycle}</span>}
        <button className="button secondary compact" disabled={busy || !workspaceSaved || (!exportState?.latestExportId && !resetBody.current)} onClick={() => { setResetOpen(true); setConfirmation(""); }}>Reset downloads to V1</button>
      </div>
      {exportState?.lastResetAt && <p>Last reset: {when(exportState.lastResetAt)} · {exportState.lastResetBy}. Earlier runs are kept in history.</p>}
      {resetOpen && <div className="job-accounting-preview" role="region" aria-label="Confirm accounting reset">
        <h4>Start accounting downloads again at V1?</h4>
        <p>This resets hand-off tracking only. Ready-to-invoice jobs become green again. Rows already yellow in the starting master stay yellow. All old Excel versions and download logs are kept in earlier runs.</p>
        <p>It does not change jobs, pricing, the master reference or the Excel uploader.</p>
        <label className="field job-accounting-reset-field">Type RESET TO V1 to confirm<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} /></label>
        <div className="job-accounting-actions"><button className="button secondary compact" disabled={busy || Boolean(resetBody.current)} onClick={() => { setResetOpen(false); setConfirmation(""); }}>Keep current versions</button>
          <button className="button primary compact" disabled={busy || !workspaceSaved || confirmation !== "RESET TO V1"} onClick={() => void action(resetDownloads)}>{resetBody.current ? "Retry confirmed reset" : "Confirm reset to V1"}</button></div>
      </div>}
      {!workspaceSaved && <p role="status">Wait for the workspace changes to save before creating a download.</p>}
      {busy && <p role="status">Working… Please keep this page open.</p>}
      {error && <p className="job-accounting-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {(preview || selected) && <div className="job-accounting-preview">
        <div className="job-accounting-actions"><h4>{selected ? `Saved version ${selected.version}` : `Preview version ${preview!.version}`}</h4>
          {selected ? <button className="button secondary compact" disabled={busy} onClick={() => void action(() => downloadVersion(selected))}>Download this version</button> : <>
            <button className="button secondary compact" disabled={busy} onClick={() => void action(prepare)}>Refresh preview</button>
            <button className="button primary compact" disabled={busy || !workspaceSaved || !rows.length} onClick={() => void action(save)}>Create version {preview!.version} &amp; download</button>
          </>}
          <button className="button secondary compact" disabled={busy} onClick={() => { setPreview(null); setPlan(null); setSelected(null); }}>Close preview</button></div>
        <p>{summary?.total ?? 0} rows · {summary?.green ?? 0} green · {summary?.yellow ?? 0} yellow · {summary?.red ?? 0} red · {summary?.white ?? 0} white</p>
        <p>Run {selected?.cycle ?? preview?.cycle ?? 1}{selected && exportState && selected.cycle !== exportState.cycle ? " · Previous run — original file preserved" : ""}</p>
        {preview && <p>{preview.version === 1 ? `Starting colours from ${preview.sourceName}, with current job changes.` : "Creating a version records the accounting hand-off. Re-download an old version from history without advancing colours."} All four accounting groups, years and managers are included regardless of the job-list filters.</p>}
        {Boolean(summary?.reviewInactive) && <p className="job-accounting-error">{summary!.reviewInactive} inactive jobs have no confirmed billing status and are excluded. Review them and use Close Project or Cancel Job as appropriate.</p>}
        {Boolean(summary?.missingFromPortal) && <p>{summary!.missingFromPortal} retained source rows are not in the current portal. They are retained in this accounting file only.</p>}
        {!rows.length ? <p>No jobs with a confirmed accounting status are available yet.</p> : <>
          <div className="job-accounting-table-wrap"><table className="job-accounting-table"><thead><tr><th>Job #</th><th>Job name</th><th>Accounting status</th><th>Change / source</th></tr></thead><tbody>
            {rows.slice(rowPage * 20, rowPage * 20 + 20).map((row) => <tr key={row.jobNumber}><td>{row.jobNumber}</td><td>{String(row.cells[0] ?? "")}</td><td><span className={`accounting-chip accounting-${row.color}`}>{labels[row.color]}</span></td><td>{row.change}</td></tr>)}
          </tbody></table></div>
          <div className="job-accounting-actions"><button className="button secondary compact" disabled={!rowPage} onClick={() => setRowPage(rowPage - 1)}>Previous rows</button><span>Rows {rowPage * 20 + 1}–{Math.min(rows.length, rowPage * 20 + 20)} of {rows.length}</span><button className="button secondary compact" disabled={(rowPage + 1) * 20 >= rows.length} onClick={() => setRowPage(rowPage + 1)}>Next rows</button></div>
        </>}
        {selected && <div><h4>Download requests for version {selected.version} ({requestCount})</h4><p>Requests are recorded when the saved file is sent to the browser. They do not confirm a local save or an accounting import.</p>
          <ul className="job-accounting-request-list">{requests.map((entry) => <li key={entry.id}>{when(entry.requested_at)} · {entry.downloaded_by_name}</li>)}</ul>
          {requests.length < requestCount && <button className="button secondary compact" disabled={busy} onClick={() => void action(() => viewVersion(selected.id, true))}>Earlier download requests</button>}
        </div>}
      </div>}
      <details className="job-accounting-history"><summary>Download history &amp; previous versions ({count})</summary>
        <p>Every saved Excel version is kept with its date, creator and original contents. Viewing or downloading it again does not change any job status.</p>
        <button className="button secondary compact" disabled={busy} onClick={() => void action(() => loadHistory())}>Refresh history</button>
        {!history.length ? <p>No accounting job-list versions have been saved yet.</p> : <div className="job-accounting-table-wrap"><table className="job-accounting-table"><thead><tr><th>Version</th><th>Created (Toronto)</th><th>Created by</th><th>Rows</th><th>Actions</th></tr></thead><tbody>
          {history.map((record) => <tr key={record.id}><td>v{record.version}<br /><small>Run {record.cycle ?? 1}{exportState && (record.cycle ?? 1) !== exportState.cycle ? " · Previous run" : ""}</small></td><td>{when(record.exported_at)}</td><td>{record.exported_by_name}</td><td>{record.summary.total}</td><td><div className="job-accounting-actions"><button className="button secondary compact" disabled={busy} onClick={() => void action(() => viewVersion(record.id))}>View v{record.version} &amp; log</button><button className="button secondary compact" disabled={busy} onClick={() => void action(() => downloadVersion(record))}>Download v{record.version}</button></div></td></tr>)}
        </tbody></table></div>}
        {history.length < count && <button className="button secondary compact" disabled={busy} onClick={() => void action(() => loadHistory(true))}>Older versions</button>}
      </details>
    </div>
  </section>;
}
