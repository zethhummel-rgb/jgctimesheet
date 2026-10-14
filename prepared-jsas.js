(function () {
  "use strict";
  const client = window.supabase.createClient("https://xnrljkkszoimegfivlya.supabase.co", "sb_publishable_k_m_R-jzMnsnHhNY_OHwJA_cbO1qO58");
  const $ = id => document.getElementById(id);
  const escape = value => String(value || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let rows = [], loading = false, deleting = false;
  function render() {
    const term = $("preparedSearch").value.trim().toLowerCase(), filter = $("preparedFilter").value;
    const filtered = rows.filter(row => (filter === "all" || (filter === "active") === Boolean(row.activated_at)) && JSON.stringify(row.payload).toLowerCase().includes(term));
    $("preparedList").innerHTML = filtered.map(row => {
      const record = row.payload.record || {}, fields = record.form_data?.fields || [];
      const project = fields.find(f => f.label === "Project / Job")?.value || "Project not entered";
      const crew = fields.find(f => /Workers Onsite|Crew Sign Off/i.test(f.label))?.value || "Workers Onsite not selected";
      const deleteButton = !row.activated_at && !row.record_id ? `<button type="button" class="jgc-button jgc-button--danger" data-delete-prepared="${escape(row.id)}"${deleting ? " disabled" : ""}>Delete</button>` : "";
      return `<article class="prepared-jsa-card"><div class="jsa-section-heading"><h2>${escape(project)}</h2><span class="prepared-jsa-state">${row.activated_at ? "Worker sign-off" : "Prepared"}</span></div><p>Work date: ${escape(record.inspection_date || "Not entered")}</p><p>${escape(crew)}</p><div class="actions jgc-actions"><a class="jgc-button jgc-button--secondary" href="jsa.html?prepared=${encodeURIComponent(row.id)}">${row.activated_at ? "Open active JSA" : "Edit / PDF / activate"}</a>${deleteButton}</div></article>`;
    }).join("");
    $("preparedStatus").textContent = filtered.length ? `${filtered.length} JSA${filtered.length === 1 ? "" : "s"}` : "No JSAs match this view.";
  }
  async function load() {
    if (loading || deleting) return; loading = true; $("preparedRefresh").disabled = true;
    $("preparedStatus").textContent = "Loading prepared JSAs…";
    try {
      const all = [];
      for (let offset = 0; ; offset += 200) {
        const result = await client.from("jsa_preparations").select("*").order("updated_at", { ascending: false }).order("id").range(offset, offset + 199);
        if (result.error) throw result.error;
        all.push(...result.data); if (result.data.length < 200) break;
      }
      rows = all; render();
    } catch (error) { $("preparedStatus").textContent = "Could not load prepared JSAs. " + error.message; }
    finally { loading = false; $("preparedRefresh").disabled = false; }
  }
  $("preparedList").onclick = async event => {
    const button = event.target.closest("[data-delete-prepared]");
    if (!button || loading || deleting) return;
    const row = rows.find(item => item.id === button.dataset.deletePrepared);
    if (!row || row.activated_at || row.record_id) return;
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
  (async () => {
    const result = await client.rpc("is_admin");
    if (result.error || result.data !== true) { $("preparedStatus").textContent = "Prepared JSAs are available to approved administrators only."; return; }
    $("preparedJsaControls").hidden = false; await load();
  })().catch(() => { $("preparedStatus").textContent = "Sign in as an approved administrator to open prepared JSAs."; });
}());
