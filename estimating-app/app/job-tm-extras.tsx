import { useEffect, useRef, useState } from "react";
import type { Job } from "../lib/estimator-data";
import "./job-tm-extras.css";

interface ExtraWorkOrder {
  id: string;
  wo_number: string;
  work_order_date: string;
  status: string;
  hours: number;
  created_by_name: string;
}
interface JobExtra {
  id: string;
  code: string;
  description: string;
  active: boolean;
  hours: number;
  submitted_hours: number;
  work_orders: ExtraWorkOrder[];
}
interface ExtraEditor { id: string | null; description: string; active: boolean; requestId: string }
interface LabourCostBucket { hours: number; loaded_cost: number; missing_rate_hours: number }
interface ExtraCosting {
  original: LabourCostBucket;
  extras: (LabourCostBucket & { id: string })[];
  unallocated: LabourCostBucket;
  total: LabourCostBucket;
  unpriced_manual_wo_hours: number;
}
interface ExtrasReport { extras: JobExtra[]; costing: ExtraCosting }

const hours = (value: number) => Number(value || 0).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const woStatus = (value: string) => value === "submitted" ? "Submitted" : value === "ready_for_submission" ? "Awaiting submission" : "Draft";
const dollars = (value: number) => Number(value).toLocaleString("en-CA", { style: "currency", currency: "CAD" });

export function JobLabourCostBreakdown({ job, refreshKey, onRefresh }: { job: Job; refreshKey: string; onRefresh: () => void }) {
  const [report, setReport] = useState<ExtrasReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);

  async function refresh() {
    const generation = ++request.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/job-tm-extras?jobNumber=" + encodeURIComponent(job.jobNumber));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The labour breakdown could not be loaded.");
      if (!data.costing?.total || !Array.isArray(data.costing.extras)) throw new Error("The labour breakdown is not available yet.");
      if (generation === request.current) setReport(data);
    } catch (failure) {
      if (generation === request.current) { setReport(null); setError(failure instanceof Error ? failure.message : "The labour breakdown could not be loaded."); }
    } finally {
      if (generation === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (job.portalJobId) void refresh();
    return () => { request.current++; };
  }, [job.portalJobId, job.jobNumber, refreshKey]);

  if (!job.portalJobId) return null;
  const costing = report?.costing;
  const manualLabour = job.costs.filter(entry => entry.type === "Labour");
  const manualLabourCost = manualLabour.reduce((sum, entry) => sum + entry.preTaxAmount, 0);
  const manualLabourHours = manualLabour.reduce((sum, entry) => sum + (entry.hours || 0), 0);
  const otherActual = job.costs.filter(entry => entry.type !== "Commitment" && entry.type !== "Labour").reduce((sum, entry) => sum + entry.preTaxAmount, 0);
  return <section className="panel tm-cost-breakdown" aria-label="Labour cost breakdown">
    <div className="panel-heading"><div><span className="eyebrow">JOB COSTS</span><h2>Labour cost breakdown</h2><p>Regular job labour and T&amp;M Extras, with each timesheet cost counted once.</p></div>
      <button type="button" className="button secondary compact" disabled={loading} onClick={() => { onRefresh(); void refresh(); }}>Refresh breakdown</button>
    </div>
    {loading && <p className="tm-extras-footnote" role="status">Loading labour costs…</p>}
    {error && <p className="tm-extras-message" role="alert">Unavailable: {error}</p>}
    {costing && <>
      <div className="tm-cost-table-wrap"><table className="tm-cost-table">
        <thead><tr><th scope="col">Labour</th><th scope="col">Hours</th><th scope="col">Cost</th></tr></thead>
        <tbody>
          <tr><th scope="row">Regular job labour</th><td>{hours(costing.original.hours)}</td><td>{dollars(costing.original.loaded_cost)}</td></tr>
          {costing.extras.map(extra => { const detail = report.extras.find(item => item.id === extra.id); return <tr key={extra.id} className="tm-cost-extra"><th scope="row">{detail ? `${detail.code} — ${detail.description}` : "T&M Extra"}</th><td>{hours(extra.hours)}</td><td>{dollars(extra.loaded_cost)}</td></tr>; })}
          {(costing.unallocated.hours !== 0 || costing.unallocated.loaded_cost !== 0) && <tr className="tm-cost-warning"><th scope="row">Needs allocation</th><td>{hours(costing.unallocated.hours)}</td><td>{dollars(costing.unallocated.loaded_cost)}</td></tr>}
          {(manualLabourCost !== 0 || manualLabourHours !== 0) && <tr><th scope="row">Entered labour adjustments</th><td>{hours(manualLabourHours)}</td><td>{dollars(manualLabourCost)}</td></tr>}
          <tr className="tm-cost-total"><th scope="row">Total labour including extras</th><td>{hours(costing.total.hours + manualLabourHours)}</td><td>{dollars(costing.total.loaded_cost + manualLabourCost)}</td></tr>
          {otherActual !== 0 && <tr><th scope="row">Other entered costs</th><td>—</td><td>{dollars(otherActual)}</td></tr>}
          <tr className="tm-cost-grand-total"><th scope="row">Total actual cost including extras</th><td>—</td><td>{dollars(costing.total.loaded_cost + manualLabourCost + otherActual)}</td></tr>
        </tbody>
      </table></div>
      {(costing.unallocated.hours !== 0 || costing.unallocated.loaded_cost !== 0) && <p className="tm-extras-footnote">Some timesheet hours appear on WOs with different Extras selections. These stay in the total under Needs allocation until the WO selections are corrected.</p>}
      {costing.total.missing_rate_hours > 0 && <p className="tm-extras-message" role="status">{hours(costing.total.missing_rate_hours)} h have no payroll rate. Costs shown are incomplete until those rates are entered.</p>}
      {costing.unpriced_manual_wo_hours > 0 && <p className="tm-extras-footnote">{hours(costing.unpriced_manual_wo_hours)} manual WO hours are tracked in T&amp;M Extras but have no payroll cost. They are not added to this cost breakdown.</p>}
      <p className="tm-extras-footnote">Includes submitted and current timesheets. Existing entered costs stay included; POs remain separate commitments.</p>
    </>}
  </section>;
}

export function JobTmExtras({ job }: { job: Job }) {
  const [extras, setExtras] = useState<JobExtra[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<ExtraEditor | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const request = useRef(0);
  const saveGuard = useRef(false);

  async function refresh() {
    const generation = ++request.current;
    setLoading(true);
    try {
      const response = await fetch("/api/job-tm-extras?jobNumber=" + encodeURIComponent(job.jobNumber));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Extras could not be loaded.");
      if (request.current === generation) { setExtras(data.extras || []); setMessage(""); }
    } catch (error) {
      if (request.current === generation) setMessage(error instanceof Error ? error.message : "Extras could not be loaded.");
    } finally {
      if (request.current === generation) setLoading(false);
    }
  }

  useEffect(() => {
    if (job.portalJobId) void refresh();
    else setLoading(false);
    return () => { request.current++; };
  }, [job.portalJobId, job.jobNumber]);

  function startEditor(extra?: JobExtra) {
    setMessage("");
    setEditor({ id: extra?.id || null, description: extra?.description || "", active: extra?.active ?? true, requestId: crypto.randomUUID() });
  }

  async function save(draft: ExtraEditor) {
    if (saveGuard.current || !draft.description.trim()) return;
    saveGuard.current = true;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/job-tm-extras", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobNumber: job.jobNumber, description: draft.description.trim(), extraId: draft.id, active: draft.active, requestId: draft.requestId })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "This extra could not be saved.");
      setEditor(null);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This extra could not be saved.");
    } finally {
      saveGuard.current = false;
      setSaving(false);
    }
  }

  if (!job.portalJobId) return <section className="tm-extras panel"><h2>T&amp;M Extras</h2><p>Connect this job to the Portal job list to add extras and track Work Order hours.</p></section>;

  return <section className="tm-extras" aria-label="T&M Extras">
    <header className="tm-extras-heading">
      <div><p className="eyebrow">ADDITIONAL WORK</p><h2>T&amp;M Extras</h2><p>Add an extra for this job, then select it when preparing a Work Order. Each WO contributes all its labour hours to the selected extra.</p></div>
      <div className="tm-extras-actions">
        <button className="button secondary" disabled={loading || saving} onClick={() => void refresh()}>Refresh hours</button>
        <button className="button primary" disabled={saving || !!editor} onClick={() => startEditor()}>Add extra</button>
      </div>
    </header>
    {message && <p className="tm-extras-message" role="alert">{message}</p>}
    {editor && <form className="tm-extra-editor panel" onSubmit={event => { event.preventDefault(); void save(editor); }}>
      <h3>{editor.id ? "Edit extra" : "New extra"}</h3>
      {!editor.id && <p>Assigned the next available code when saved, starting at X1 for each job.</p>}
      <label className="field"><span>Description</span><textarea aria-label="Description" required maxLength={1000} rows={3} value={editor.description} onChange={event => setEditor({ ...editor, description: event.target.value })} disabled={saving} placeholder="Chip up flooring tiles" autoFocus /></label>
      <div className="tm-extras-actions">
        <button className="button primary" disabled={saving || !editor.description.trim()}>{saving ? "Saving…" : "Save extra"}</button>
        <button className="button secondary" type="button" disabled={saving} onClick={() => setEditor(null)}>Cancel</button>
      </div>
    </form>}
    {loading && <p role="status">Loading extras and Work Order hours…</p>}
    {!loading && !extras.length && !message && <div className="panel tm-extras-empty"><h3>No extras added yet</h3><p>Add the first extra to make it available on this job’s Work Orders.</p></div>}
    {!!extras.length && <div className="panel tm-extras-register">
      <table className="data-table">
        <thead><tr><th>Extra</th><th>Description</th><th>Work orders</th><th>Total hours</th><th>Submitted hours</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{extras.map(extra => <tr key={extra.id}>
          <td data-label="Extra"><strong>{extra.code}</strong></td>
          <td data-label="Description">{extra.description}</td>
          <td data-label="Work orders"><button className="button secondary compact" aria-expanded={expanded === extra.id} onClick={() => setExpanded(expanded === extra.id ? null : extra.id)}>{extra.work_orders.length} WOs</button></td>
          <td data-label="Total hours">{hours(extra.hours)} h</td>
          <td data-label="Submitted hours">{hours(extra.submitted_hours)} h</td>
          <td data-label="Status"><span className="pill">{extra.active ? "Open" : "Closed"}</span></td>
          <td data-label="Actions"><div className="tm-extras-actions">
            <button className="button secondary compact" disabled={saving || !!editor} onClick={() => startEditor(extra)}>Edit</button>
            <button className="button secondary compact" disabled={saving || !!editor} onClick={() => void save({ id: extra.id, description: extra.description, active: !extra.active, requestId: crypto.randomUUID() })}>{extra.active ? "Close extra" : "Reopen extra"}</button>
          </div></td>
        </tr>)}</tbody>
      </table>
      <p className="tm-extras-footnote">Total hours include saved drafts and submitted WOs, using their timesheet and manual labour entries. Closing an extra removes it from new WO selections and keeps its history here.</p>
    </div>}
    {extras.filter(extra => extra.id === expanded).map(extra => <section className="panel tm-extra-detail" key={extra.id} aria-label={"Work orders for " + extra.code}>
      <header className="tm-extras-heading"><h3>Work orders for {extra.code}</h3><button className="button secondary compact" onClick={() => setExpanded(null)}>Close list</button></header>
      {!extra.work_orders.length && <p>No Work Orders are linked to this extra yet.</p>}
      {extra.work_orders.map(wo => <div className="tm-extra-wo" key={wo.id}>
        <div><a href={"../work-orders.html?wo=" + encodeURIComponent(wo.id)} target="_blank" rel="noreferrer">{wo.wo_number}</a><small>{wo.work_order_date} · {wo.created_by_name}</small></div>
        <span>{woStatus(wo.status)}</span><strong>{hours(wo.hours)} h</strong>
      </div>)}
    </section>)}
  </section>;
}
