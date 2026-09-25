(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const client = createJgcSupabaseClient();
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NEW_CATEGORY = "__new__";
  let items = [], editing = null, loading = false;

  // Task names are compared ignoring case, punctuation and filler words so near-duplicates are caught.
  const STOP = new Set(["and", "or", "the", "a", "an", "of", "to", "for", "with", "on", "in", "work", "working"]);
  const normal = text => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // Light stemming so "trench"/"trenching" and "install"/"installation" count as the same word.
  const stem = w => w.replace(/(ations?|ings?|ers?|ies|es|s)$/, "").replace(/(.)\1$/, "$1");
  const words = text => new Set(normal(text).split(" ").filter(w => w && !STOP.has(w)).map(stem).filter(w => w.length > 1));
  function similarity(a, b) {
    const x = words(a), y = words(b);
    if (!x.size || !y.size) return 0;
    const shared = [...x].filter(w => y.has(w)).length;
    return shared / Math.min(x.size, y.size);
  }
  function libraryEntries(excludeId) {
    return JgcJsaPresets.map(p => ({ task: p.task, category: p.category, where: "built-in" }))
      .concat(items.filter(i => !i.archived_at && i.id !== excludeId).map(i => ({ task: i.task, category: i.category, where: "custom" })));
  }
  function duplicateCheck() {
    const task = $("libraryTask").value.trim();
    const entries = libraryEntries(editing?.id);
    const exact = task ? entries.find(e => normal(e.task) === normal(task)) : null;
    const similar = task && !exact ? entries.filter(e => similarity(task, e.task) >= 0.67) : [];
    const box = $("libraryDuplicates");
    if (exact) {
      box.innerHTML = `<strong>Already in the library:</strong> “${escape(exact.task)}” (${escape(exact.where)}, ${escape(exact.category)}). Edit that task instead, or use a clearer name.`;
    } else if (similar.length) {
      box.innerHTML = `<strong>Similar tasks already in the library:</strong><ul>${similar.slice(0, 6).map(e => `<li>${escape(e.task)} <small>(${escape(e.where)}, ${escape(e.category)})</small></li>`).join("")}</ul>`;
    }
    if (!exact && !similar.length) box.innerHTML = "";
    box.hidden = !exact && !similar.length;
    box.dataset.kind = exact ? "exact" : similar.length ? "similar" : "";
    $("libraryConfirmField").hidden = !similar.length;
    if (!similar.length) $("libraryConfirm").checked = false;
    return { exact, similar };
  }

  const status = text => { $("libraryStatus").textContent = text; };
  const show = view => { $("libraryControls").hidden = view !== "list"; $("libraryForm").hidden = view !== "form"; };
  const lines = value => value.split(/\r?\n/).map(s => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);

  function renderList() {
    const view = $("libraryView").value;
    const term = $("librarySearch").value.trim().toLowerCase();
    const matches = entry => !term || [entry.task, entry.category, ...(entry.hazards || []), ...(entry.controls || [])].join(" ").toLowerCase().includes(term);
    if (view === "system") {
      const rows = JgcJsaPresets.filter(matches);
      const groups = [...new Set(rows.map(p => p.category))];
      $("libraryList").innerHTML = groups.map(g => `<section class="library-group"><h2>${escape(g)}</h2><ul>${rows.filter(p => p.category === g).map(p => `<li><strong>${escape(p.task)}</strong><small>${p.hazards.length} hazards · ${p.controls.length} controls</small></li>`).join("")}</ul></section>`).join("") || '<p class="library-empty">No built-in presets match.</p>';
      status(`${rows.length} built-in preset${rows.length === 1 ? "" : "s"} shown. Built-in presets are maintained with the Portal and cannot be edited here.`);
      return;
    }
    const rows = items.filter(i => (view === "archived") === Boolean(i.archived_at)).filter(matches);
    $("libraryList").innerHTML = rows.map(item => `<article class="library-card">
      <div><h2>${escape(item.task)}</h2><p>${escape(item.category)}</p><small>${item.hazards.length} hazards · ${item.controls.length} controls · updated ${escape(new Date(item.updated_at).toLocaleDateString("en-CA"))}</small></div>
      <div class="actions">${item.archived_at
        ? `<button type="button" class="library-btn library-btn--secondary" data-restore="${escape(item.id)}">Restore</button>`
        : `<button type="button" class="library-btn library-btn--secondary" data-edit="${escape(item.id)}">Edit</button><button type="button" class="library-btn library-btn--danger" data-archive="${escape(item.id)}">Archive</button>`}</div></article>`).join("") || `<p class="library-empty">${view === "archived" ? "No archived custom tasks." : "No custom tasks yet. Use New custom task to add one."}</p>`;
    status(`${rows.length} custom task${rows.length === 1 ? "" : "s"} shown.`);
  }

  async function load() {
    if (loading) return;
    loading = true; $("libraryRefresh").disabled = true;
    try {
      const result = await client.from("jsa_library_items").select("*").order("task");
      if (result.error) throw result.error;
      items = result.data;
      renderList();
    } catch (error) { status("Custom tasks could not load. " + (error.message || "")); }
    finally { loading = false; $("libraryRefresh").disabled = false; }
  }

  function openForm(item) {
    editing = item;
    const categories = [...new Set(JgcJsaPresetCategories.concat(items.map(i => i.category)))];
    $("libraryCategory").innerHTML = '<option value="">Choose a category</option>' + categories.map(c => `<option value="${escape(c)}">${escape(c)}</option>`).join("") + `<option value="${NEW_CATEGORY}">New category…</option>`;
    $("libraryCategory").value = item?.category || "";
    $("libraryNewCategory").value = "";
    $("libraryNewCategoryField").hidden = true;
    $("libraryTask").value = item?.task || "";
    $("libraryHazards").value = (item?.hazards || []).join("\n");
    $("libraryControlsInput").value = (item?.controls || []).join("\n");
    $("libraryConfirm").checked = false;
    $("libraryFormError").hidden = true;
    $("libraryFormTitle").textContent = item ? "Edit custom task" : "New custom task";
    duplicateCheck();
    show("form");
    $("libraryCategory").focus();
  }

  async function save() {
    const category = $("libraryCategory").value === NEW_CATEGORY ? $("libraryNewCategory").value.trim() : $("libraryCategory").value;
    const task = $("libraryTask").value.trim();
    const hazards = lines($("libraryHazards").value), controls = lines($("libraryControlsInput").value);
    const { exact, similar } = duplicateCheck();
    const problems = [];
    if (!category) problems.push("Choose or enter a category.");
    if (!task) problems.push("Enter the task name.");
    if (exact) problems.push("This task is already in the library.");
    if (similar.length && !$("libraryConfirm").checked) problems.push("Confirm this is different from the similar tasks listed.");
    if (!hazards.length) problems.push("Enter at least one hazard.");
    if (!controls.length) problems.push("Enter at least one control or PPE item.");
    $("libraryFormError").textContent = problems.join(" ");
    $("libraryFormError").hidden = !problems.length;
    if (problems.length) return;
    $("librarySave").disabled = true;
    try {
      const result = await client.rpc("save_jsa_library_item", { p_id: editing?.id || crypto.randomUUID(), p_revision: editing ? editing.revision : 0, p_category: category, p_task: task, p_hazards: hazards, p_controls: controls });
      if (result.error) throw result.error;
      await load();
      show("list");
      status(`Saved “${task}”. It now appears in every JSA's library search.`);
    } catch (error) {
      $("libraryFormError").textContent = error.code === "40001" ? "This task changed elsewhere. Cancel and reopen it before saving." : error.message || "The task could not be saved.";
      $("libraryFormError").hidden = false;
    } finally { $("librarySave").disabled = false; }
  }

  async function setArchived(id, archived) {
    const item = items.find(i => i.id === id);
    if (archived && !window.confirm(`Archive “${item.task}”? It will no longer appear in JSA library searches. Existing JSAs keep their text.`)) return;
    const result = await client.rpc("archive_jsa_library_item", { p_id: id, p_archived: archived });
    if (result.error) { status(result.error.message || "The task could not be updated."); return; }
    await load();
    status(archived ? `Archived “${item.task}”.` : `Restored “${item.task}”.`);
  }

  $("libraryList").addEventListener("click", event => {
    const edit = event.target.closest("[data-edit]"), archive = event.target.closest("[data-archive]"), restore = event.target.closest("[data-restore]");
    if (edit) openForm(items.find(i => i.id === edit.dataset.edit));
    if (archive) setArchived(archive.dataset.archive, true);
    if (restore) setArchived(restore.dataset.restore, false);
  });
  $("libraryCategory").addEventListener("change", () => {
    $("libraryNewCategoryField").hidden = $("libraryCategory").value !== NEW_CATEGORY;
    if (!$("libraryNewCategoryField").hidden) $("libraryNewCategory").focus();
  });
  $("libraryTask").addEventListener("input", duplicateCheck);
  $("libraryForm").addEventListener("submit", event => { event.preventDefault(); save(); });
  $("libraryCancel").addEventListener("click", () => { show("list"); renderList(); });
  $("libraryNew").addEventListener("click", () => openForm(null));
  $("libraryRefresh").addEventListener("click", load);
  $("librarySearch").addEventListener("input", renderList);
  $("libraryView").addEventListener("change", renderList);

  (async () => {
    const access = await client.rpc("is_admin");
    if (access.error || access.data !== true) { status("The JSA library is managed by approved administrators only."); return; }
    show("list");
    await load();
  })().catch(() => status("Sign in as an approved administrator to manage the JSA library."));
}());
