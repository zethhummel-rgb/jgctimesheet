(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const param = new URLSearchParams(location.search).get("prepared");
  let draft = null, busy = false, admin = false, savedSnapshot = "";
  const draftId = param && param !== "new" ? param : crypto.randomUUID();
  // The shared picker is a UI helper; the original input holds the actual job.
  // Do not serialize its "__manual__" option as a second Project / Job field.
  function markJobPicker() {
    const select = document.querySelector(".jgc-project-job-select");
    if (select) select.dataset.inspectionSkip = "true";
  }
  const pickerObserver = new MutationObserver(markJobPicker);
  pickerObserver.observe($("jsaField1").closest(".field"), { childList: true, subtree: true });
  markJobPicker();
  window.JgcPreparedJsa = { isPrepared: Boolean(param), activate };
  if (param) {
    $("jsaPreparation").hidden = false;
    $("jsaSignoffChoiceSection").hidden = true;
    document.querySelectorAll("#jsaPreparation button").forEach(b => b.disabled = true);
  }

  function status(message) { $("jsaDraftStatus").textContent = message; }
  function snapshot() {
    markJobPicker();
    return JSON.stringify({ fields: collectFields(), rows: collectTableRows(), crew: [...selectedCrewMembers.values()], manual: [...manualCrewMembers.values()] });
  }
  function lockDraft(locked) {
    document.querySelectorAll("#jsaPreparation button").forEach(b => b.disabled = locked || Boolean(draft && draft.activated_at));
    $("jsaDraftPdf").disabled = locked;
    $("jsaDraftPrint").disabled = locked;
  }
  async function payload() {
    markJobPicker();
    syncCrewSignOffField();
    const built = await buildInspectionRecord("JSA", getCurrentWorker());
    delete built.record.id;
    delete built.record.form_data.offline_submission_id;
    // Presets and planned crew are ordinary editable form data, not assignments.
    return { record: built.record, crew: [...selectedCrewMembers.values()], manual: [...manualCrewMembers.values()] };
  }
  async function persist() {
    if (!admin) throw new Error("Admin access is required.");
    if (!navigator.onLine) throw new Error("Connect to the internet to save this prepared JSA.");
    const sourceSnapshot = snapshot();
    const value = await payload();
    const result = await inspectionSupabaseClient.rpc("save_prepared_jsa", { p_id: draftId, p_revision: draft ? draft.revision : 0, p_payload: value });
    if (result.error) throw result.error;
    draft = result.data;
    savedSnapshot = sourceSnapshot;
    history.replaceState(null, "", "jsa.html?prepared=" + encodeURIComponent(draft.id));
    return draft;
  }
  async function run(action) {
    if (busy) return;
    busy = true; lockDraft(true);
    const controls = [...document.querySelectorAll(".grid input, .grid select, .checklist input, #jsaTable textarea, #jsaTable button, .signoff input, .signoff select, .signoff button, .jsa-row-actions button, #jsaLibrary input, #jsaLibrary button")];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => control.disabled = true);
    try { await action(); }
    catch (error) { status(error.message || "The JSA could not be saved. Your entries are still here."); }
    finally {
      if (!draft?.activated_at) controls.forEach((control, i) => control.disabled = disabled[i]);
      busy = false; lockDraft(false);
    }
  }
  function restore(value) {
    const record = value.record;
    const fields = record.form_data.fields || [];
    document.querySelectorAll(".grid input, .grid select, .checklist input").forEach(input => {
      if (input.dataset.inspectionSkip === "true") return;
      const found = fields.find(f => f.label === getFieldLabel(input));
      if (!found) return;
      if (input.type === "checkbox") input.checked = found.value === "Yes";
      else { input.value = found.value || ""; input.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    selectedCrewMembers.clear(); manualCrewMembers.clear();
    (value.crew || []).forEach(worker => selectedCrewMembers.set(getCrewWorkerKey(worker), worker));
    (value.manual || []).forEach(name => manualCrewMembers.set(getManualCrewKey(name), name));
    renderApprovedCrewSelect(); renderSelectedCrewMembers(); renderManualCrewMembers(); syncCrewSignOffField();
    $("tableBody").replaceChildren();
    (record.form_data.rows || []).forEach(row => insertRow(row.cells || []));
    if (!$("tableBody").children.length) addRow();
    const select = document.querySelector(".jgc-project-job-select");
    if (select) {
      const field = $("jsaField1");
      select.value = [...select.options].some(o => o.value === field.value) ? field.value : "__manual__";
      field.hidden = select.value !== "__manual__";
    }
  }
  function insertRow(cells) {
    addRow();
    const fields = $("tableBody").lastElementChild.querySelectorAll("textarea");
    fields.forEach((f, i) => { f.value = cells[i] || ""; });
    return fields[0];
  }
  function validate() {
    document.querySelectorAll(".jsa-required").forEach(f => { f.classList.remove("jsa-required"); f.removeAttribute("aria-invalid"); });
    const required = [$("jsaField1"), $("jsaField3")];
    $("tableBody").querySelectorAll("tr").forEach(row => {
      const fields = [...row.querySelectorAll("textarea")];
      if (fields.some(f => f.value.trim())) required.push(...fields);
    });
    if (!collectTableRows().length) required.push(...$("tableBody").querySelectorAll("textarea"));
    const missing = required.filter(f => !f.value.trim());
    missing.forEach(f => { f.classList.add("jsa-required"); f.setAttribute("aria-invalid", "true"); });
    if (missing.length || !collectTableRows().length) {
      status("Project, date, and a task with hazards and controls are required before activation.");
      const first = missing[0];
      if (first?.hidden) document.querySelector(".jgc-project-job-select")?.focus();
      else first?.focus();
      return false;
    }
    return true;
  }
  async function activate(mode) {
    if (busy || !admin || !validate()) return;
    await run(async () => {
      if (!draft || savedSnapshot !== snapshot()) await persist();
      const record = draft.payload.record;
      const names = safetyAckParseManualAttendees(getInspectionFieldValue(record.form_data.fields, /Crew Sign Off/i), "");
      const creator = getCurrentWorker();
      names.push({ name: creator.display || creator.key, company: "John Gordon Construction" });
      const profiles = await safetyAckLoadApprovedProfiles(inspectionSupabaseClient);
      if (!profiles.length) throw new Error("The employee directory could not be verified. Try activation again when it is available.");
      if ([...selectedCrewMembers.values()].some(worker => !safetyAckFindEmployeeMatch(worker.display_name || getCrewWorkerKey(worker), profiles))) {
        throw new Error("An intended employee is no longer approved. Review the crew before activating this JSA.");
      }
      const attendees = safetyAckBuildAttendeesFromNames(names, profiles, { defaultCompany: "" });
      const result = await inspectionSupabaseClient.rpc("activate_prepared_jsa", { p_id: draft.id, p_revision: draft.revision, p_mode: mode, p_attendees: attendees });
      if (result.error) throw result.error;
      draft = result.data.draft;
      showActive(result.data.record, result.data.acknowledgements, true);
      status("Active / Assigned. Complete the existing sign-off process below.");
    });
  }
  function showActive(record, acknowledgements, openMode) {
    $("jsaPreparationTitle").textContent = "Active / Assigned";
    $("jsaPreparationHelp").textContent = "This JSA has been issued. Sign-off and acknowledgments follow the existing process.";
    document.querySelectorAll(".grid input, .grid select, .checklist input, #jsaTable textarea, #jsaTable button, .signoff input, .signoff select, .signoff button, .jsa-row-actions button").forEach(f => f.disabled = true);
    $("jsaLibrary").hidden = true;
    $("jsaSignoffChoiceSection").hidden = false;
    jsaPostSaveRecord = record; jsaPostSaveRows = acknowledgements;
    if (openMode) {
      selectJsaAcknowledgementMode(draft.acknowledgement_mode);
      showJsaSafetyQrAfterSave(record, acknowledgements);
    }
    savedSnapshot = snapshot(); lockDraft(false);
  }
  async function exportDraft(print) {
    // Open while inside the click gesture so browsers allow the print preview.
    const target = print ? window.open("about:blank", "_blank") : null;
    if (print && !target) { status("Allow the print preview window, or download the PDF to print it."); return; }
    await run(async () => {
      try {
        if (!draft?.activated_at) await persist();
        const record = draft.activated_at ? jsaPostSaveRecord : draft.payload.record;
        const opts = { prepared: !draft.activated_at, acknowledgements: draft.activated_at ? jsaPostSaveRows : [] };
        const doc = await JgcJsaPdf.create(record, opts);
        if (print) { doc.autoPrint(); const url = doc.output("bloburl"); target.location.href = url; setTimeout(() => URL.revokeObjectURL(url), 300000); }
        else doc.save(`jsa-${draft.activated_at ? "" : "prepared-"}${record.inspection_date || "draft"}.pdf`);
        status(draft.activated_at ? "Active JSA exported." : "Draft saved and exported. No crew assigned or notified.");
      } catch (error) { if (target) target.close(); throw error; }
    });
  }

  // Built-in presets plus admin-created library items; inserted text is always a copy.
  const CUSTOM_CACHE = "jgcJsaCustomLibrary:v1";
  let customPresets = [];
  try { customPresets = JSON.parse(localStorage.getItem(CUSTOM_CACHE) || "[]"); } catch (_) { customPresets = []; }
  const allPresets = () => JgcJsaPresets.concat(customPresets);
  function toCustomPreset(item) {
    return { id: "custom:" + item.id, source: "custom", category: item.category, task: item.task, hazards: item.hazards || [], controls: item.controls || [] };
  }
  async function loadCustomPresets() {
    try {
      const result = await inspectionSupabaseClient.from("jsa_library_items").select("id,category,task,hazards,controls").is("archived_at", null).order("task");
      if (result.error) throw result.error;
      customPresets = result.data.map(toCustomPreset);
      try { localStorage.setItem(CUSTOM_CACHE, JSON.stringify(customPresets)); } catch (_) { /* cache is optional */ }
      renderCategories(); searchPresets();
    } catch (error) { console.warn("Custom JSA library items could not load; showing built-in presets.", error); }
  }
  function renderCategories() {
    const select = $("jsaPresetCategory"), current = select.value;
    const categories = [...new Set(JgcJsaPresetCategories.concat(customPresets.map(p => p.category)))];
    select.innerHTML = '<option value="">All categories</option>' + categories.map(c => `<option value="${escapeJsaHtml(c)}">${escapeJsaHtml(c)}</option>`).join("");
    select.value = categories.includes(current) ? current : "";
  }

  let selectedPreset = null;
  function searchPresets() {
    const words = $("jsaPresetSearch").value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const category = $("jsaPresetCategory").value;
    const matches = allPresets().filter(p => (!category || p.category === category) && words.every(w => [p.task, p.category, ...p.hazards, ...p.controls].join(" ").toLowerCase().includes(w)));
    const groups = [...new Set(matches.map(p => p.category))];
    $("jsaPresetResults").innerHTML = matches.length ? groups.map(group => `<section class="jsa-preset-group" aria-label="${escapeJsaHtml(group)}"><h3>${escapeJsaHtml(group)}</h3><div>${matches.filter(p => p.category === group).map(p => `<button type="button" data-preset="${escapeJsaHtml(p.id)}" aria-pressed="${selectedPreset?.id === p.id}">${escapeJsaHtml(p.task)}${p.source === "custom" ? ' <span class="jsa-preset-badge">JGC custom</span>' : ""}</button>`).join("")}</div></section>`).join("") : "<p>No presets found. Add a blank row for your task.</p>";
    $("jsaPresetCount").textContent = `${matches.length} of ${allPresets().length} library tasks shown.`;
  }
  $("jsaPresetSearch").addEventListener("input", searchPresets);
  $("jsaPresetCategory").addEventListener("change", searchPresets);
  $("jsaPresetResults").addEventListener("click", event => {
    const button = event.target.closest("[data-preset]"); if (!button) return;
    selectedPreset = allPresets().find(p => p.id === button.dataset.preset); searchPresets();
    $("jsaPresetDetail").innerHTML = `<h3>${escapeJsaHtml(selectedPreset.task)}</h3><div class="jsa-preset-options">${[["hazards", "Hazards"], ["controls", "Controls / PPE"]].map(([key, title]) => `<fieldset><legend>${title}</legend>${selectedPreset[key].map((text, index) => `<label><input type="checkbox" checked data-inspection-skip="true" data-preset-part="${key}" value="${index}"><span>${escapeJsaHtml(text)}</span></label>`).join("")}</fieldset>`).join("")}</div><div class="actions"><button type="button" id="jsaInsertPreset">Insert task</button></div>`;
  });
  $("jsaPresetDetail").addEventListener("click", event => {
    if (event.target.id !== "jsaInsertPreset" || !selectedPreset) return;
    const selected = key => [...document.querySelectorAll(`[data-preset-part="${key}"]:checked`)].map(f => selectedPreset[key][Number(f.value)]).join("\n");
    const empty = [...$("tableBody").children].find(row => [...row.querySelectorAll("textarea")].every(f => !f.value.trim()));
    const cells = [selectedPreset.task, selected("hazards"), selected("controls")];
    let first;
    if (empty) { const fields = empty.querySelectorAll("textarea"); fields.forEach((f, i) => f.value = cells[i]); first = fields[0]; }
    else first = insertRow(cells);
    $("jsaLibrary").open = false; first.focus(); first.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  renderCategories();
  searchPresets();
  loadCustomPresets();

  $("jsaSaveDraft").onclick = () => run(async () => { await persist(); status("Draft saved. No crew assigned or notified."); });
  $("jsaDraftPdf").onclick = () => { if (!busy) void exportDraft(false); };
  $("jsaDraftPrint").onclick = () => { if (!busy) void exportDraft(true); };
  $("jsaActivate").onclick = () => {
    if (!validate()) return;
    $("jsaSignoffChoiceSection").hidden = false;
    $("jsaAcknowledgementChoiceStatus").textContent = "Review the work date and intended crew, then choose the existing sign-off method to activate and assign this JSA.";
    $("jsaSignoffChoiceSection").scrollIntoView({ behavior: "smooth" });
  };
  window.addEventListener("beforeunload", event => {
    if (param && admin && !draft?.activated_at && savedSnapshot !== snapshot()) { event.preventDefault(); event.returnValue = ""; }
  });
  (async () => {
    const result = await inspectionSupabaseClient.rpc("is_admin");
    admin = !result.error && result.data === true;
    $("jsaLibraryManage").hidden = !admin;
    if (!param) { $("jsaAdminEntry").hidden = !admin; return; }
    if (!admin) { document.querySelector(".container").textContent = "Prepared JSAs are available to approved administrators only."; return; }
    await window.jsaCrewReady;
    if (param !== "new") {
      const loaded = await inspectionSupabaseClient.from("jsa_preparations").select("*").eq("id", draftId).single();
      if (loaded.error) throw loaded.error;
      draft = loaded.data; restore(draft.payload);
      if (draft.activated_at) {
        const recordResult = await inspectionSupabaseClient.from("inspection_records").select("*").eq("id", draft.record_id).single();
        if (recordResult.error) throw recordResult.error;
        const rows = await safetyAckLoadForRecords(inspectionSupabaseClient, "jsa", draft.record_id);
        showActive(recordResult.data, rows, false);
      }
    }
    $("jsaCrewTitle").textContent = draft?.activated_at ? "3. Assigned crew" : "3. Intended crew — not yet assigned";
    savedSnapshot = snapshot(); lockDraft(false);
  })().catch(error => { status("Could not open this draft: " + error.message); });
}());
