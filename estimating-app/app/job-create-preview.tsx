import { useEffect, useRef, useState, type ComponentType } from "react";
import { quoteTotals, type AppState, type Client, type Quote } from "../lib/estimator-data";
import { jobManagerIdentity } from "../lib/job-manager-names";

type Option = { id: string; label: string; detail?: string };
interface PickerProps {
  value: string; options: Option[]; disabled?: boolean; placeholder: string; ariaLabel: string;
  allowCustom?: boolean; onChange?: (value: string) => void; onSelect: (option: Option) => void;
  addLabel?: string; onAdd?: (value: string) => void;
}
interface Draft {
  quoteId: string; jobName: string; clientId: string; site: string; address: string; attention: string;
  clientReference: string; jobType: "Contract" | "T&M"; value: string; subcontractors: "Yes" | "No";
  jobDate: string; startDate: string; targetEndDate: string; manager: string; documents: string; notes: string;
}
type ClientDraft = { mode: "client" | "site" | "attention"; name: string; site: string; address: string; attention: string };
const key = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-CA");
const localDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// Display only. This must never reserve a number or become the issuing algorithm.
function suggestedNumber(jobs: AppState["jobs"], date: string) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) return "Assigned after approval";
  const prefix = date.slice(2, 4);
  const used = jobs.map((job) => job.jobNumber.trim()).filter((number) => /^\d{5}$/.test(number) && number.startsWith(prefix));
  const highest = Math.max(Number(prefix) * 1000, ...used.map(Number));
  return highest % 1000 === 999 ? "Confirm next number with accounting" : String(highest + 1).padStart(5, "0");
}

/** A deliberately isolated rehearsal: no workspace setter, API, storage or save callback. */
export function JobCreatePreview({ state, manager, Picker, onClose }: {
  state: AppState; manager: string; Picker: ComponentType<PickerProps>; onClose: () => void;
}) {
  const [clients, setClients] = useState(state.clients);
  const [draft, setDraft] = useState<Draft>({
    quoteId: "", jobName: "", clientId: "", site: "", address: "", attention: "", clientReference: "",
    jobType: "Contract", value: "", subcontractors: "No", jobDate: localDate(), startDate: "", targetEndDate: "",
    manager: jobManagerIdentity(manager).label || manager, documents: "", notes: "",
  });
  const [clientDraft, setClientDraft] = useState<ClientDraft | null>(null);
  const [checked, setChecked] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const linkedQuote = state.quotes.find((quote) => quote.id === draft.quoteId);
  const client = clients.find((item) => item.id === draft.clientId);
  const availableQuotes = state.quotes.filter((quote) => quote.documentKind !== "Change Notice" && quote.status === "Finished" && !state.jobs.some((job) => job.quoteId === quote.id));
  const managers = Array.from(new Set([manager, ...state.jobs.map((job) => job.projectManager || "")].map((name) => jobManagerIdentity(name).label || name).filter(Boolean))).sort();
  const update = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft((current) => ({ ...current, [field]: value }));

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLInputElement>("#new-job-name")?.focus();
    return () => { document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, []);

  useEffect(() => {
    if (!clientDraft) dialog.current?.querySelector<HTMLInputElement>("#new-job-name")?.focus();
  }, [clientDraft]);

  const errors: Partial<Record<keyof Draft, string>> = {};
  if (!draft.jobName.trim()) errors.jobName = "Enter a job name / scope.";
  if (!client) errors.clientId = "Select a client or add one to this preview.";
  if (!draft.jobDate) errors.jobDate = "Choose a job date.";
  if (!draft.manager) errors.manager = "Choose a project manager.";
  if (draft.jobType === "Contract" && !draft.value.trim()) errors.value = "Enter the contract value or select a finished quote.";
  if (draft.value.trim() && (!Number.isFinite(Number(draft.value)) || Number(draft.value) < 0)) errors.value = "Enter a valid amount of zero or more.";
  if (draft.startDate && draft.targetEndDate && draft.targetEndDate < draft.startDate) errors.targetEndDate = "Target completion cannot be before the start date.";
  if (draft.documents.trim()) {
    try { if (new URL(draft.documents).protocol !== "https:") errors.documents = "Use a secure https:// document link."; }
    catch { errors.documents = "Enter a complete https:// document link."; }
  }
  const possibleDuplicates = state.jobs.filter((job) => {
    if (job.status !== "Active" || job.portalActive === false || job.cancelledAt || !draft.jobName.trim()) return false;
    if (![job.project, job.portalJobName || ""].some((name) => key(name) === key(draft.jobName))) return false;
    if (client && job.clientId !== client.id && key(job.portalCustomer || "") !== key(client.name)) return false;
    let source: Quote | undefined = state.quotes.find((quote) => quote.id === job.quoteId);
    try { if (job.acceptedQuoteSnapshot) source = JSON.parse(job.acceptedQuoteSnapshot); } catch { /* Use the linked quote if an old snapshot is unavailable. */ }
    const reference = source?.customerPo || "";
    return !reference.trim() || !draft.clientReference.trim() || key(reference) === key(draft.clientReference);
  });
  const selectQuote = (id: string) => {
    const quote = availableQuotes.find((item) => item.id === id);
    if (!quote) return;
    setDraft((current) => ({ ...current, quoteId: quote.id, jobName: quote.project, clientId: quote.clientId,
      site: quote.site, address: quote.address || "", attention: quote.proposalAttention || "",
      clientReference: quote.customerPo || "", value: String(quoteTotals(quote).subtotal), jobType: "Contract",
      subcontractors: quote.lines.some((line) => line.included && line.costType === "Sub / Vendor") ? "Yes" : "No",
    }));
  };
  const openClient = (mode: ClientDraft["mode"], value: string) => {
    if (mode !== "client" && !client) return;
    setClientDraft({ mode, name: mode === "client" ? value : client?.name || "",
      site: mode === "site" ? value : mode === "client" ? "" : draft.site,
      address: mode === "client" || mode === "site" ? "" : draft.address,
      attention: mode === "attention" ? value : mode === "client" ? "" : draft.attention });
  };
  const inlineError = (field: keyof Draft) => checked && errors[field] ? <small className="job-preview-error" role="alert">{errors[field]}</small> : null;

  return <div className="modal-layer job-preview-layer" onKeyDown={(event) => {
    if (clientDraft) return;
    if (event.key === "Escape") {
      // First Escape dismisses a picker; it must not also discard this form.
      if ((event.target as HTMLElement).getAttribute("aria-expanded") === "true") return;
      event.stopPropagation(); onClose();
    }
    trapPreviewFocus(event, dialog.current);
  }}>
    <section ref={dialog} className="modal-card job-preview-modal" role="dialog" aria-modal={clientDraft ? undefined : true} aria-labelledby="job-preview-title" inert={clientDraft ? true : undefined}>
      <header><div><span className="eyebrow">PREVIEW · AWAITING APPROVAL</span><h2 id="job-preview-title">New job</h2></div><button type="button" aria-label="Close job preview" onClick={onClose}>×</button></header>
      <form noValidate onSubmit={(event) => { event.preventDefault(); setChecked(true); }}>
        <p className="job-preview-notice">Try the form without saving. No jobs, clients or numbers are created; closing clears this preview.</p>
        <div className="job-preview-grid">
          <label className="field full"><span>Job name / scope <b>*</b></span><input id="new-job-name" value={draft.jobName} onChange={(event) => update("jobName", event.target.value)} aria-invalid={checked && !!errors.jobName} placeholder="e.g. Sump pump inspections" maxLength={300} />{inlineError("jobName")}</label>
          <div className="field full job-preview-quote"><span>Fill from a finished quote <em>Optional · preview only</em></span><Picker value={linkedQuote?.number || ""} options={availableQuotes.map((quote) => ({ id: quote.id, label: quote.number, detail: `${quote.project} · ${clients.find((item) => item.id === quote.clientId)?.name || ""} · Rev ${quote.revision}` }))} placeholder="Search quote #, client or project" ariaLabel="Preview linked quote" onSelect={(option) => selectQuote(option.id)} />
            {linkedQuote ? <small>{linkedQuote.project} · Rev {linkedQuote.revision} <button type="button" className="back-button" onClick={() => update("quoteId", "")}>Unlink preview</button></small> : <small>Leave blank for a job without a quote. The existing “Make into job” action is unchanged.</small>}
          </div>
          <div className="field"><span>Client <b>*</b></span><Picker value={client?.name || ""} options={clients.map((item) => ({ id: item.id, label: item.name })).sort((a, b) => a.label.localeCompare(b.label))} placeholder="Search or add a client" ariaLabel="New job client" onSelect={(option) => setDraft((current) => ({ ...current, clientId: option.id, site: "", address: "", attention: "", quoteId: "", value: "", clientReference: "", subcontractors: "No" }))} onAdd={(value) => openClient("client", value)} addLabel="Add new client" />{inlineError("clientId")}</div>
          <div className="field"><span>Attention / contact</span><Picker value={draft.attention} options={(client?.contacts || []).map((contact) => ({ id: contact.id, label: contact.name, detail: [contact.email, contact.phone].filter(Boolean).join(" · ") }))} disabled={!client} placeholder={client ? "Search or add a contact" : "Select a client first"} ariaLabel="New job attention" onSelect={(option) => update("attention", option.label)} onAdd={(value) => openClient("attention", value)} addLabel="Add new attention" /></div>
          <div className="field"><span>Site name</span><Picker value={draft.site} options={(client?.sites || []).map((site) => ({ id: site.id, label: site.label, detail: site.address }))} disabled={!client} placeholder={client ? "Search or add a site" : "Select a client first"} ariaLabel="New job site" onSelect={(option) => setDraft((current) => ({ ...current, site: option.label, address: client?.sites.find((site) => site.id === option.id)?.address || "" }))} onAdd={(value) => openClient("site", value)} addLabel="Add new site" /></div>
          <label className="field"><span>Site address</span><input value={draft.address} onChange={(event) => update("address", event.target.value)} /></label>
          <label className="field"><span>Next job # <em>Preview only</em></span><input readOnly value={suggestedNumber(state.jobs, draft.jobDate)} /><small>Based on the job-date year and loaded list. Not reserved.</small></label>
          <label className="field"><span>Client PO#/WO# <em>Optional</em></span><input value={draft.clientReference} onChange={(event) => update("clientReference", event.target.value)} maxLength={150} /></label>
          <label className="field"><span>Job type <b>*</b></span><select value={draft.jobType} onChange={(event) => update("jobType", event.target.value as Draft["jobType"])}><option>Contract</option><option>T&amp;M</option></select></label>
          <label className="field"><span>Job value <em>Before tax{draft.jobType === "T&M" ? " · optional" : ""}</em></span><input inputMode="decimal" value={draft.value} readOnly={!!linkedQuote} onChange={(event) => update("value", event.target.value)} aria-invalid={checked && !!errors.value} placeholder={draft.jobType === "T&M" ? "No fixed value" : "Enter amount"} />{linkedQuote && <small>From quote Rev {linkedQuote.revision}. Unlink the preview to enter an amount freely.</small>}{inlineError("value")}</label>
          <label className="field"><span>Subcontractors</span><select value={draft.subcontractors} onChange={(event) => update("subcontractors", event.target.value as Draft["subcontractors"])}><option>No</option><option>Yes</option></select><small>Yes tells accounting to expect a subcontractor invoice.</small></label>
          <label className="field"><span>Project manager <b>*</b></span><select value={draft.manager} onChange={(event) => update("manager", event.target.value)} aria-invalid={checked && !!errors.manager}><option value="">Choose a manager</option>{managers.map((name) => <option key={name}>{name}</option>)}</select>{inlineError("manager")}</label>
          <label className="field"><span>Job date <b>*</b></span><input type="date" value={draft.jobDate} onChange={(event) => update("jobDate", event.target.value)} aria-invalid={checked && !!errors.jobDate} />{inlineError("jobDate")}</label>
          <label className="field"><span>Start date <em>Optional</em></span><input type="date" value={draft.startDate} onChange={(event) => update("startDate", event.target.value)} /></label>
          <label className="field"><span>Target completion <em>Optional</em></span><input type="date" value={draft.targetEndDate} onChange={(event) => update("targetEndDate", event.target.value)} aria-invalid={checked && !!errors.targetEndDate} />{inlineError("targetEndDate")}</label>
          {possibleDuplicates.length > 0 && <div className="job-preview-warning full" role="status"><strong>Check similar active jobs: {possibleDuplicates.map((job) => job.jobNumber).join(", ")}</strong><p>The name matches and the Client PO#/WO# is the same or not recorded. A different recorded PO#/WO# is a separate job. Closed jobs are ignored; this is only a warning.</p></div>}
          <details className="job-preview-more full"><summary>More details</summary><div className="job-preview-grid">
            <label className="field full"><span>Project documents link</span><input type="url" value={draft.documents} onChange={(event) => update("documents", event.target.value)} aria-invalid={checked && !!errors.documents} placeholder="https://…" />{inlineError("documents")}</label>
            <label className="field full"><span>Internal notes</span><textarea rows={3} value={draft.notes} onChange={(event) => update("notes", event.target.value)} /></label>
          </div></details>
        </div>
        {checked && <p className={Object.keys(errors).length ? "job-preview-error job-preview-check" : "job-preview-notice"} role="status">{Object.keys(errors).length ? Object.values(errors).join(" ") : "Details checked. This is still a preview; nothing has been saved."}</p>}
        <footer><button type="button" className="button secondary" onClick={onClose}>Close preview</button><button type="submit" className="button secondary">Check details</button><button type="button" className="button primary" disabled title="Job creation is disabled until approval">Create job — awaiting approval</button></footer>
      </form>
    </section>
    {clientDraft && <PreviewClientDialog draft={clientDraft} clients={clients} selectedClient={client} onClose={() => setClientDraft(null)} onApply={(nextClient, site, address, attention) => {
      setClients((current) => current.some((item) => item.id === nextClient.id) ? current.map((item) => item.id === nextClient.id ? nextClient : item) : [...current, nextClient]);
      setDraft((current) => ({ ...current, clientId: nextClient.id, site, address, attention,
        ...(current.clientId !== nextClient.id ? { quoteId: "", value: "", clientReference: "", subcontractors: "No" as const } : {}) }));
      setClientDraft(null);
    }} />}
  </div>;
}

function trapPreviewFocus(event: React.KeyboardEvent, dialog: HTMLElement | null) {
  if (event.key !== "Tab" || !dialog) return;
  const fields = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')).filter((element) => element.getClientRects().length);
  if (event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1)?.focus(); }
  else if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0]?.focus(); }
}

function PreviewClientDialog({ draft, clients, selectedClient, onClose, onApply }: {
  draft: ClientDraft; clients: Client[]; selectedClient?: Client; onClose: () => void;
  onApply: (client: Client, site: string, address: string, attention: string) => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>(draft.mode === "site" ? '[name="site"]' : draft.mode === "attention" ? '[name="attention"]' : '[name="name"]')?.focus();
    return () => { previous?.focus(); };
  }, [draft.mode]);
  return <div className="modal-layer job-preview-client-layer" onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") onClose(); trapPreviewFocus(event, dialog.current); }}>
    <section ref={dialog} className="modal-card job-preview-modal job-preview-client-modal" role="dialog" aria-modal="true" aria-labelledby="job-preview-client-title">
      <header><div><span className="eyebrow">PREVIEW ONLY</span><h2 id="job-preview-client-title">{draft.mode === "client" ? "Add new client" : draft.mode === "site" ? "Add new site" : "Add new attention"}</h2></div><button type="button" aria-label="Close client preview" onClick={onClose}>×</button></header>
      <form onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const value = (name: string) => String(data.get(name) || "").trim();
        const name = value("name"), attention = value("attention"), site = value("site"), address = value("address");
        const existing = draft.mode === "client" ? clients.find((item) => key(item.name) === key(name)) : selectedClient;
        const next: Client = existing ? { ...existing, sites: [...existing.sites], contacts: [...(existing.contacts || [])] } : { id: `preview-client-${crypto.randomUUID()}`, name, contact: attention, email: value("email"), phone: value("phone"), sites: [], contacts: [], notes: "" };
        if (site) {
          const saved = next.sites.find((item) => key(item.label) === key(site));
          next.sites = saved ? next.sites.map((item) => item.id === saved.id ? { ...item, address: address || item.address } : item) : [...next.sites, { id: `preview-site-${crypto.randomUUID()}`, label: site, address }];
        }
        if (attention) {
          const saved = next.contacts?.find((item) => key(item.name) === key(attention));
          const contact = { id: saved?.id || `preview-contact-${crypto.randomUUID()}`, name: attention, role: value("role") || saved?.role || "", email: value("email") || saved?.email || "", phone: value("phone") || saved?.phone || "", extension: value("extension") || saved?.extension || "" };
          next.contacts = saved ? next.contacts?.map((item) => item.id === saved.id ? contact : item) : [...(next.contacts || []), contact];
        }
        onApply(next, site, address || next.sites.find((item) => key(item.label) === key(site))?.address || "", attention);
      }}>
        <p className="job-preview-notice">These details stay in this preview only. Your saved client list will not change.</p>
        <div className="job-preview-grid">
          <label className="field full"><span>Client name <b>*</b></span><input name="name" defaultValue={draft.name} readOnly={draft.mode !== "client"} required /></label>
          <label className="field"><span>Attention name{draft.mode === "attention" && <b> *</b>}</span><input name="attention" defaultValue={draft.attention} required={draft.mode === "attention"} /></label>
          <label className="field"><span>Role / department</span><input name="role" /></label>
          <label className="field"><span>Email</span><input name="email" type="email" /></label>
          <label className="field"><span>Phone</span><input name="phone" type="tel" /></label>
          <label className="field"><span>Extension</span><input name="extension" inputMode="numeric" /></label>
          <label className="field"><span>Site name{draft.mode === "site" && <b> *</b>}</span><input name="site" defaultValue={draft.site} required={draft.mode === "site"} /></label>
          <label className="field full"><span>Address</span><input name="address" defaultValue={draft.address} /></label>
        </div>
        <footer><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary">Use in preview</button></footer>
      </form>
    </section>
  </div>;
}
