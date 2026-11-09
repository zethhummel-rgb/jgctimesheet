
import { useEffect, useRef, useState } from "react";
interface BillingRequest {
  id: string; requested_at: string; requested_by_name: string; cancelled_at: string | null;
  cancelled_by_name: string | null; exported_at: string | null; export_cycle: number | null;
  export_version: number | null; export_color: string | null;
}
export async function requestProgressBilling(jobId: string, requestId: string, action = "request"): Promise<BillingRequest> {
  const response = await fetch("/api/job-progress-billing", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jobId,requestId,action})});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The billing request could not be saved.");
  return result.request;
}
const when = (value: string) => new Date(value).toLocaleString("en-CA",{timeZone:"America/Toronto",dateStyle:"medium",timeStyle:"short"});
export function JobProgressBilling({jobId, active, canManage, revision, requesting, onRequest}: {
  jobId: string; active: boolean; canManage: boolean; revision: number; requesting: boolean; onRequest: () => void;
}) {
  const [rows,setRows] = useState<BillingRequest[]>([]), [count,setCount] = useState(0);
  const [busy,setBusy] = useState(false), [error,setError] = useState("");
  const sequence = useRef(0);
  async function load(append = false) {
    const version = ++sequence.current;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/job-progress-billing?jobId=${encodeURIComponent(jobId)}&offset=${append ? rows.length : 0}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Billing history could not be loaded.");
      if (version !== sequence.current) return;
      setRows(previous => append ? [...previous,...result.requests] : result.requests); setCount(result.count);
    } catch (e) { if (version === sequence.current) setError(e instanceof Error ? e.message : "Billing history could not be loaded."); }
    finally { if (version === sequence.current) setBusy(false); }
  }
  useEffect(() => {
    setRows([]); setCount(0);
    if (jobId && canManage) void load();
    return () => { ++sequence.current; };
  },[jobId,revision,canManage]);
  async function cancel(row: BillingRequest) {
    if (!window.confirm("Cancel this progress billing request? Its date and history will be kept.")) return;
    setBusy(true); setError("");
    try { await requestProgressBilling(jobId,row.id,"cancel"); await load(); }
    catch(e) { setError(e instanceof Error ? e.message : "The request could not be cancelled."); setBusy(false); }
  }
  const pending = rows.some(r => !r.cancelled_at && !r.exported_at);
  return <section className="panel" aria-label="Progress billing history">
    <div className="panel-heading"><div><span className="eyebrow">ACCOUNTING</span><h2>Progress Billing</h2>
      <p>Request an interim invoice while the job stays active.</p></div>
      {canManage && active && <button className="button secondary job-progress-action" disabled={!jobId || busy || requesting || pending} onClick={onRequest}>
        {requesting ? "Saving..." : pending ? "Requested for next export" : "Request progress billing"}</button>}
    </div>
    <div className="progress-billing-body">
      <p>Orange in the next new accounting export, then white while this job stays active. Closed jobs follow their green or blue billing status.</p>
      <p>Request times are shown in Toronto time. Exported requests still need accounting to issue an invoice.</p>
      {!canManage ? <p>Administrator access is required to view billing requests.</p> : !jobId ? <p>Link this job to the Portal to use progress billing.</p> : <>
        <div><button className="button secondary compact" disabled={busy || requesting} onClick={() => void load()}>Refresh billing history</button></div>
        {error && <p role="alert">{error}</p>}
        {busy && <p role="status">Loading billing history...</p>}
        {!busy && !error && !rows.length && <p>No progress billing requests yet.</p>}
        <ol className="progress-billing-log">{rows.map(row => <li key={row.id}>
          <div><strong>{when(row.requested_at)}</strong><span>Requested by {row.requested_by_name}</span>
            {row.cancelled_at ? <small>Cancelled {when(row.cancelled_at)} by {row.cancelled_by_name}</small>
              : row.exported_at ? <small>{row.export_color === "orange" ? "Included" : "Closed-job status used"} in export V{row.export_version} (cycle {row.export_cycle}) on {when(row.exported_at)}</small>
              : <small>{active ? "Will be orange in the next new accounting export." : "The next export will use this job's closed status."}</small>}
          </div>
          <div><span className={`accounting-chip ${!row.cancelled_at && !row.exported_at ? "accounting-orange" : ""}`}>
            {row.cancelled_at ? "Cancelled" : row.exported_at ? "Passed to accounting" : "Pending export"}</span>
            {!row.cancelled_at && !row.exported_at && <button className="button secondary compact" disabled={busy || requesting} onClick={() => void cancel(row)}>Cancel request</button>}
          </div>
        </li>)}</ol>
        {rows.length < count && <button className="button secondary compact" disabled={busy} onClick={() => void load(true)}>Older billing requests</button>}
      </>}
    </div>
  </section>;
}
