(function () {
  "use strict";
  const client = window.supabase.createClient("https://xnrljkkszoimegfivlya.supabase.co", "sb_publishable_k_m_R-jzMnsnHhNY_OHwJA_cbO1qO58");
  const $ = id => document.getElementById(id);
  const escape = value => String(value || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let rows = [], loading = false, deleting = false, authorized = false, admin = false;
  const preparationStatus = window.JgcJsaPreparationStatus;
  if (new URLSearchParams(location.search).get("view") === "previous") $("preparedFilter").value = "previous";
  function render() {
    const term = $("preparedSearch").value.trim().toLowerCase(), filter = $("preparedFilter").value;
    const filtered = rows.filter(row => {
      const past = preparationStatus.isNotActivated(row);
      const active = !row.worker_record_id && Boolean(row.activated_at || row.record_id);
      const matches = filter === "all" || (filter === "previous" ? past : filter === "active" ? active : !past && !active);
      return matches && JSON.stringify(row.payload).toLowerCase().includes(term);
    }).sort((a, b) => filter === "previous" ? String(b.payload.record?.inspection_date || "").localeCompare(String(a.payload.record?.inspection_date || "")) : 0);
    $("preparedList").innerHTML = filtered.map(row => {
      const record = row.payload.record || {}, fields = record.form_data?.fields || [];
      const project = fields.find(f => f.label === "Project / Job")?.value || "Project not entered";
      const crew = fields.find(f => /Workers Onsite|Crew Sign Off/i.test(f.label))?.value || "Workers Onsite not selected";
      const past = preparationStatus.isNotActivated(row);
      const deleteButton = !row.worker_record_id && !row.activated_at && !row.record_id ? `<button type="button" class="jgc-button jgc-button--danger" data-delete-prepared="${escape(row.id)}"${deleting ? " disabled" : ""}>Delete</button>` : "";
      const href = row.worker_record_id ? "jsa.html?record=" + encodeURIComponent(row.worker_record_id) : "jsa.html?prepared=" + encodeURIComponent(row.id);
      const label = row.worker_record_id ? "Open / PDF" : past ? "Open / PDF" : row.activated_at || row.record_id ? "Open active JSA" : "Edit / PDF / activate";
      return `<article class="prepared-jsa-card"><div class="jsa-section-heading"><h2>${escape(project)}</h2><span class="prepared-jsa-state">${past ? "Not activated" : row.activated_at || row.record_id ? "Worker sign-off" : "Prepared"}</span></div><p>Work date: ${escape(record.inspection_date || "Not entered")}</p><p>${escape(crew)}</p><div class="actions jgc-actions"><a class="jgc-button jgc-button--secondary" href="${href}">${label}</a>${deleteButton}</div></article>`;
    }).join("");
    $("preparedStatus").textContent = filtered.length ? `${filtered.length} JSA${filtered.length === 1 ? "" : "s"}` : "No JSAs match this view.";
  }
  async function loadStaffPreparations() {
    const workflows = [];
    for (let offset = 0; ; offset += 200) {
      const result = await client.from("jsa_worker_workflows").select("record_id,valid_date")
        .eq("prepared_in_advance", true).is("requested_at", null).is("completed_at", null)
        .gte("valid_date", preparationStatus.today()).order("valid_date").order("record_id").range(offset, offset + 199);
      if (result.error) throw result.error;
      workflows.push(...(result.data || []));
      if ((result.data || []).length < 200) break;
    }
    const records = [];
    for (let offset = 0; offset < workflows.length; offset += 100) {
      const ids = workflows.slice(offset, offset + 100).map(item => item.record_id);
      const result = await client.from("inspection_records").select("id,inspection_type,inspection_date,title,form_data,worker_display_name")
        .in("id", ids).eq("inspection_type", "JSA");
      if (result.error) throw result.error;
      records.push(...(result.data || []));
    }
    return records.map(record => ({ id: record.id, worker_record_id: record.id, payload: { record } }));
  }
  async function load() {
    if (loading || deleting) return; loading = true; $("preparedRefresh").disabled = true;
    $("preparedStatus").textContent = "Loading prepared JSAs…";
    try {
      const all = [];
      if (admin) {
        for (let offset = 0; ; offset += 200) {
          const result = await client.from("jsa_preparations").select("*").order("updated_at", { ascending: false }).order("id").range(offset, offset + 199);
          if (result.error) throw result.error;
          all.push(...result.data); if (result.data.length < 200) break;
        }
      }
      const staff = await loadStaffPreparations();
      const linked = new Set(all.map(row => row.record_id).filter(Boolean));
      rows = all.concat(staff.filter(row => !linked.has(row.worker_record_id))); render();
    } catch (error) { $("preparedStatus").textContent = "Could not load prepared JSAs. " + error.message; }
    finally { loading = false; $("preparedRefresh").disabled = false; }
  }
  $("preparedList").onclick = async event => {
    const button = event.target.closest("[data-delete-prepared]");
    if (!button || loading || deleting) return;
    const row = rows.find(item => item.id === button.dataset.deletePrepared);
    if (!row || row.worker_record_id || row.activated_at || row.record_id) return;
    const record = row.payload.record || {};
    const project = (record.form_data?.fields || []).find(field => field.label === "Project / Job")?.value || "Project not entered";
    if (!confirm(`Delete this unused prepared JSA?\n\n${project}\nWork date: ${record.inspection_date || "Not entered"}\n\nThis cannot be undone.`)) return;
    deleting = true; button.disabled = true; $("preparedRefresh").disabled = true;
    $("preparedStatus").textContent = "Deleting prepared JSA…";
    try {
      const result = await client.rpc("delete_prepared_jsa", { p_id: row.id, p_revision: row.revision });
      if (result.error) throw result.error;
      if (result.data !== true) throw new Error("Deletion was not confirmed. Refresh the list and try again.");
      rows = rows.filter(item => item.id !== row.id); render();
      $("preparedStatus").textContent = "Prepared JSA deleted.";
    } catch (error) { $("preparedStatus").textContent = "Could not delete prepared JSA. " + error.message; }
    finally {
      deleting = false; $("preparedRefresh").disabled = false;
      $("preparedList").querySelectorAll("[data-delete-prepared]").forEach(item => { item.disabled = false; });
    }
  };
  $("preparedSearch").oninput = render; $("preparedFilter").onchange = render; $("preparedRefresh").onclick = load;
  preparationStatus.onDayChange(() => { if (authorized) void load(); });
  (async () => {
    const result = await client.rpc("is_admin");
    if (result.error) throw result.error;
    admin = result.data === true;
    authorized = true; $("preparedJsaControls").hidden = false; await load();
  })().catch(() => { $("preparedStatus").textContent = "Sign in with an approved JGC account to open prepared JSAs."; });
}());
