(function () {
  "use strict";
  const W = window.JGCWriteUps;
  const $ = id => document.getElementById(id);
  const client = createJgcSupabaseClient();
  const state = { rows: [], employees: [], jobs: [], editing: null, current: null, loading: false };

  const torontoToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const jobLabel = job => [job.job_number, job.customer, job.job_name, job.job_type].filter(Boolean).join(" — ");
  const status = text => { $("writeupsStatus").textContent = text; };
  const show = view => {
    $("writeupsStatus").hidden = view !== "list";
    $("writeupsControls").hidden = view !== "list";
    $("writeupForm").hidden = view !== "form";
    $("writeupDetail").hidden = view !== "detail";
  };

  async function pages(query) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const result = await query().range(offset, offset + 499);
      if (result.error) throw result.error;
      rows.push(...result.data);
      if (result.data.length < 500) return rows;
    }
  }

  function renderList() {
    const term = $("writeupsSearch").value.trim().toLowerCase();
    const filter = $("writeupsFilter").value;
    const rows = state.rows.filter(row => (filter === "all" || (filter === "open" ? row.status === "draft" || row.status === "sent" : row.status === filter))
      && [row.employee_name, (row.categories || []).map(W.label).join(" ")].join(" ").toLowerCase().includes(term));
    $("writeupsList").innerHTML = rows.length ? rows.map(row => `<article class="jgc-record-row writeup-record">
      <div class="writeup-record-date"><strong>${W.escape(W.formatDate(row.incident_date))}</strong><small>Version ${row.current_version}</small></div>
      <div class="writeup-record-main"><h3>${W.escape(row.employee_name)}</h3><p>${W.escape((row.categories || []).map(W.label).join(", "))}</p></div>
      <div class="jgc-table-actions">${W.badge(row.status)}<button type="button" class="jgc-button jgc-button--secondary" data-open="${W.escape(row.id)}">Open</button></div></article>`).join("") : '<p class="jgc-empty-state">No write-ups match this view.</p>';
    status(`${rows.length} write-up${rows.length === 1 ? "" : "s"} shown.`);
  }

  async function loadList() {
    if (state.loading) return;
    state.loading = true; $("writeupsRefresh").disabled = true; status("Loading write-ups…");
    try {
      state.rows = await pages(() => client.from("employee_writeups").select("*").order("updated_at", { ascending: false }).order("id"));
      renderList();
    } catch (error) { status("Could not load write-ups. " + (error.message || "")); }
    finally { state.loading = false; $("writeupsRefresh").disabled = false; }
  }

  async function loadPickers() {
    const [employees, jobs] = await Promise.all([
      pages(() => client.from("profiles").select("id,display_name,email,worker_key,role,account_status").eq("account_status", "approved").order("display_name").order("id")),
      pages(() => client.from("jobs").select("id,job_number,customer,job_name,job_type,active").eq("active", true).order("job_number", { ascending: false }).order("id"))
    ]);
    state.employees = employees.filter(p => String(p.role || "").toLowerCase() !== "subcontractor");
    state.jobs = jobs;
    $("writeupJobList").innerHTML = jobs.map(job => `<option value="${W.escape(jobLabel(job))}"></option>`).join("");
  }

  function setLocationMode(mode) {
    document.querySelectorAll('[name="writeupLocationMode"]').forEach(input => { input.checked = input.value === mode; });
    $("writeupJobField").hidden = mode !== "job";
    $("writeupLocationLabel").innerHTML = mode === "job" ? 'Area on site <span class="writeups-optional">optional</span>' : "Location *";
    $("writeupLocation").placeholder = mode === "job" ? "For example: mezzanine, east stairwell" : "Address, site or building";
  }

  function openForm(record) {
    state.editing = record;
    const payload = record?.version.payload || {};
    const sent = record && record.writeup.status !== "draft";
    const employees = state.employees.slice();
    if (record && !employees.some(e => e.id === record.writeup.employee_profile_id)) employees.unshift({ id: record.writeup.employee_profile_id, display_name: record.writeup.employee_name });
    $("writeupEmployee").innerHTML = '<option value="">Choose an employee</option>' + employees.map(e => `<option value="${W.escape(e.id)}">${W.escape(e.display_name || e.email)}</option>`).join("");
    $("writeupEmployee").value = record?.writeup.employee_profile_id || "";
    $("writeupEmployee").disabled = Boolean(sent);
    $("writeupCategories").innerHTML = W.CATEGORIES.map(([key, text]) => `<label class="writeup-chip"><input type="checkbox" value="${key}" ${(payload.categories || []).includes(key) ? "checked" : ""}><span>${W.escape(text)}</span></label>`).join("");
    $("writeupCustom").value = payload.custom_issue || "";
    $("writeupCustomField").hidden = !(payload.categories || []).includes("other");
    $("writeupDate").value = payload.incident_date || torontoToday();
    $("writeupDate").max = torontoToday();
    $("writeupTime").value = payload.incident_time || "";
    setLocationMode(payload.location_mode || "job");
    $("writeupJob").value = payload.job ? jobLabel(payload.job) : "";
    $("writeupLocation").value = payload.location || "";
    $("writeupDescription").value = payload.description || "";
    $("writeupAction").value = payload.action_taken || "";
    $("writeupExpectations").value = payload.expectations || "";
    $("writeupFollowDate").value = payload.follow_up_date || "";
    $("writeupFollowNotes").value = payload.follow_up_notes || "";
    $("writeupChange").value = "";
    $("writeupChangeField").hidden = !sent;
    $("writeupDraft").hidden = Boolean(sent);
    $("writeupSend").textContent = sent ? "Send correction to employee" : "Send to employee";
    $("writeupFormTitle").textContent = sent ? `Correct write-up (creates version ${record.writeup.current_version + 1})` : record ? "Edit draft write-up" : "New write-up";
    $("writeupFormError").hidden = true;
    show("form");
    $("writeupEmployee").disabled ? $("writeupDescription").focus() : $("writeupEmployee").focus();
  }

  function collect() {
    const mode = document.querySelector('[name="writeupLocationMode"]:checked').value;
    const job = mode === "job" ? state.jobs.find(j => jobLabel(j) === $("writeupJob").value.trim()) || (state.editing?.version.payload.job && jobLabel(state.editing.version.payload.job) === $("writeupJob").value.trim() ? state.editing.version.payload.job : null) : null;
    const categories = [...$("writeupCategories").querySelectorAll("input:checked")].map(input => input.value);
    const payload = {
      categories,
      custom_issue: categories.includes("other") ? $("writeupCustom").value.trim() : "",
      incident_date: $("writeupDate").value,
      incident_time: $("writeupTime").value,
      location_mode: mode,
      job: job ? { id: job.id, job_number: job.job_number, customer: job.customer || "", job_name: job.job_name || "", job_type: job.job_type || "" } : null,
      location: $("writeupLocation").value.trim(),
      description: $("writeupDescription").value.trim(),
      action_taken: $("writeupAction").value.trim(),
      expectations: $("writeupExpectations").value.trim(),
      follow_up_date: $("writeupFollowDate").value,
      follow_up_notes: $("writeupFollowNotes").value.trim()
    };
    const problems = [];
    if (!$("writeupEmployee").value) problems.push(["writeupEmployee", "Choose the employee."]);
    if (!categories.length) problems.push(["writeupCategories", "Choose at least one issue type."]);
    if (categories.includes("other") && !payload.custom_issue) problems.push(["writeupCustom", "Describe the custom issue."]);
    if (!payload.incident_date) problems.push(["writeupDate", "Enter the incident date."]);
    else if (payload.incident_date > torontoToday()) problems.push(["writeupDate", "The incident date cannot be in the future."]);
    if (mode === "job" && !job) problems.push(["writeupJob", "Select a job from the list, or choose Enter a location."]);
    if (mode === "manual" && !payload.location) problems.push(["writeupLocation", "Enter the location."]);
    if (!payload.description) problems.push(["writeupDescription", "Enter the factual description."]);
    if (!payload.action_taken) problems.push(["writeupAction", "Enter the action taken."]);
    if (!payload.expectations) problems.push(["writeupExpectations", "Enter the corrective expectations."]);
    return { payload, problems };
  }

  function showProblems(problems) {
    document.querySelectorAll("#writeupForm [aria-invalid]").forEach(el => el.removeAttribute("aria-invalid"));
    problems.forEach(([id]) => $(id).setAttribute("aria-invalid", "true"));
    $("writeupFormError").textContent = problems.map(p => p[1]).join(" ");
    $("writeupFormError").hidden = !problems.length;
    if (problems.length) ($(problems[0][0]).querySelector?.("input") || $(problems[0][0])).focus();
  }

  async function notifyEmployee(writeup, version, repeat) {
    const person = state.employees.find(e => e.id === writeup.employee_profile_id) || { id: writeup.employee_profile_id, display_name: writeup.employee_name };
    // Push text can show on a lock screen, so it stays generic; details open only after sign-in.
    const result = await createJgcPortalNotifications(client, "employee_writeup", [{ profile_id: person.id, email: person.email || "", worker_key: person.worker_key || "", display_name: person.display_name || "", role: person.role === "admin" ? "admin" : "worker" }], {
      title: "Document to review",
      message: "A document has been shared with you to review and acknowledge in the Portal.",
      link_url: "employee-writeups.html?id=" + encodeURIComponent(writeup.id),
      source_table: "employee_writeups",
      source_id: writeup.id,
      dedupe_key_prefix: `employee_writeup:${writeup.id}:v${version}` + (repeat ? ":" + Date.now() : "")
    });
    return result && result.ok !== false && !result.skipped;
  }

  async function save(send) {
    const { payload, problems } = collect();
    const record = state.editing;
    const sent = record && record.writeup.status !== "draft";
    if (sent && !$("writeupChange").value.trim()) problems.push(["writeupChange", "Explain what changed."]);
    showProblems(problems);
    if (problems.length) return;
    const buttons = [$("writeupSend"), $("writeupDraft"), $("writeupCancel")];
    buttons.forEach(b => { b.disabled = true; });
    const id = record?.writeup.id || crypto.randomUUID();
    try {
      const result = await client.rpc("save_employee_writeup", { p_id: id, p_expected_version: record ? record.writeup.current_version : 0, p_employee: $("writeupEmployee").value, p_payload: payload, p_send: send, p_change_note: $("writeupChange").value.trim() });
      if (result.error) throw result.error;
      let note = send ? "Sent to the employee." : "Draft saved.";
      if (send && result.data.notify) note = await notifyEmployee(result.data.writeup, result.data.version.version, false) ? "Sent. The employee was notified." : "Saved and sent, but the notification could not be created. Use Notify employee again.";
      await openDetail(id, note);
      loadList();
    } catch (error) {
      showProblems([]);
      $("writeupFormError").textContent = error.code === "40001" ? "This write-up changed elsewhere. Go back and reopen it before saving." : error.message || "The write-up could not be saved.";
      $("writeupFormError").hidden = false;
    } finally { buttons.forEach(b => { b.disabled = false; }); }
  }

  async function openDetail(id, message) {
    show("detail");
    $("writeupDetailBody").innerHTML = "<p>Loading…</p>";
    $("writeupDetailActions").innerHTML = "";
    $("writeupDetailStatus").textContent = message || "";
    try {
      const record = await W.load(client, id);
      if (!record) { $("writeupDetailBody").innerHTML = "<p>This write-up could not be found.</p>"; return; }
      state.current = record;
      history.replaceState(null, "", "employee-writeups-admin.html?id=" + encodeURIComponent(id));
      $("writeupDetailTitle").textContent = "Write-up — " + record.writeup.employee_name;
      $("writeupDetailBody").innerHTML = W.reportHtml(record);
      const s = record.writeup.status;
      const actions = [['download', "Download PDF", "jgc-button"]];
      if (s === "draft") actions.push(["edit", "Edit draft", "jgc-button jgc-button--secondary"]);
      if (s === "sent" || s === "acknowledged") actions.push(["edit", "Correct & resend", "jgc-button jgc-button--secondary"]);
      if (s === "sent") actions.push(["notify", "Notify employee again", "jgc-button jgc-button--secondary"]);
      if (s !== "voided") actions.push(["void", "Void", "jgc-button jgc-button--danger"]);
      $("writeupDetailActions").innerHTML = actions.map(([key, text, cls]) => `<button type="button" data-action="${key}" class="${cls}">${text}</button>`).join("");
      $("writeupDetailTitle").focus?.();
    } catch (error) { $("writeupDetailBody").innerHTML = `<p>Could not load this write-up. ${W.escape(error.message || "")}</p>`; }
  }

  function backToList() {
    history.replaceState(null, "", "employee-writeups-admin.html");
    state.current = null; show("list"); renderList();
  }

  $("writeupDetailActions").addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    if (!button || !state.current) return;
    const record = state.current;
    if (button.dataset.action === "download") {
      button.disabled = true;
      try { await W.download(record); } catch (error) { $("writeupDetailStatus").textContent = error.message; } finally { button.disabled = false; }
    } else if (button.dataset.action === "edit") openForm(record);
    else if (button.dataset.action === "notify") {
      button.disabled = true;
      $("writeupDetailStatus").textContent = await notifyEmployee(record.writeup, record.version.version, true) ? "The employee was notified again." : "The notification could not be created.";
      button.disabled = false;
    } else if (button.dataset.action === "void") {
      $("writeupVoidReason").value = ""; $("writeupVoidError").hidden = true;
      $("writeupVoidDialog").showModal(); $("writeupVoidReason").focus();
    }
  });

  $("writeupVoidConfirm").addEventListener("click", async () => {
    const reason = $("writeupVoidReason").value.trim();
    if (!reason) { $("writeupVoidError").textContent = "Enter the reason for voiding."; $("writeupVoidError").hidden = false; $("writeupVoidReason").focus(); return; }
    $("writeupVoidConfirm").disabled = true;
    try {
      const result = await client.rpc("void_employee_writeup", { p_id: state.current.writeup.id, p_reason: reason });
      if (result.error) throw result.error;
      $("writeupVoidDialog").close();
      await openDetail(state.current.writeup.id, "Write-up voided.");
      loadList();
    } catch (error) { $("writeupVoidError").textContent = error.message || "Could not void this write-up."; $("writeupVoidError").hidden = false; }
    finally { $("writeupVoidConfirm").disabled = false; }
  });

  $("writeupCategories").addEventListener("change", () => {
    $("writeupCustomField").hidden = !$("writeupCategories").querySelector('input[value="other"]:checked');
  });
  document.querySelectorAll('[name="writeupLocationMode"]').forEach(input => input.addEventListener("change", () => setLocationMode(input.value)));
  $("writeupForm").addEventListener("submit", event => { event.preventDefault(); save(true); });
  $("writeupDraft").addEventListener("click", () => save(false));
  $("writeupCancel").addEventListener("click", () => state.current && state.editing ? openDetail(state.current.writeup.id) : backToList());
  $("writeupBack").addEventListener("click", backToList);
  $("writeupNew").addEventListener("click", () => { state.current = null; openForm(null); });
  $("writeupsRefresh").addEventListener("click", loadList);
  $("writeupsSearch").addEventListener("input", renderList);
  $("writeupsFilter").addEventListener("change", renderList);
  $("writeupsList").addEventListener("click", event => { const open = event.target.closest("[data-open]"); if (open) openDetail(open.dataset.open); });

  (async () => {
    const access = await client.rpc("is_admin");
    if (access.error || access.data !== true) { status("Employee write-ups are available to approved administrators only."); return; }
    show("list");
    await Promise.all([loadList(), loadPickers().catch(error => status("Employees or jobs could not load. " + (error.message || "")))]);
    const id = new URLSearchParams(location.search).get("id");
    if (id) openDetail(id);
  })().catch(() => status("Sign in as an approved administrator to open employee write-ups."));
}());
