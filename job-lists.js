(function () {
  "use strict";

  const state = {
    client: null,
    user: null,
    profile: null,
    worker: null,
    jobs: [],
    workers: [],
    lists: [],
    members: [],
    items: [],
    tab: "open",
    online: navigator.onLine,
    channel: null,
    refreshTimer: null,
    editingItemIds: [],
    viewerOnly: false
  };

  const elements = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDateTime(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return new Intl.DateTimeFormat("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function toLocalInput(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function fromLocalInput(value) {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function cacheKey(suffix) {
    return "jgcJobLists:" + (state.user && state.user.id || "unknown") + ":" + suffix;
  }

  function readJson(key, fallback) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      return saved == null ? fallback : saved;
    } catch (error) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn("Job Notes cache could not be saved.", error);
    }
  }

  function showNotice(message, type) {
    elements.notice.textContent = String(message || "");
    elements.notice.hidden = !message;
    elements.notice.classList.toggle("is-error", type === "error");
    if (type === "error") {
      elements.notice.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function isAdmin() {
    return state.profile && String(state.profile.role || "").toLowerCase() === "admin";
  }

  function membersFor(listId) {
    return state.members.filter(function (member) {
      return member.list_id === listId;
    });
  }

  function itemsFor(listId) {
    return state.items
      .filter(function (item) {
        return item.list_id === listId;
      })
      .sort(function (a, b) {
        return Number(a.position || 0) - Number(b.position || 0)
          || String(a.created_at || "").localeCompare(String(b.created_at || ""));
      });
  }

  function canControl(list) {
    if (!list || !state.user) {
      return false;
    }
    return isAdmin()
      || list.created_by === state.user.id
      || membersFor(list.id).some(function (member) {
        return member.profile_id === state.user.id;
      });
  }

  function saveCache() {
    saveJson(cacheKey("data"), {
      profile: state.profile,
      jobs: state.jobs,
      workers: state.workers,
      lists: state.lists,
      members: state.members,
      items: state.items,
      savedAt: new Date().toISOString()
    });
  }

  function loadCache() {
    const cached = readJson(cacheKey("data"), {});
    state.profile = cached.profile || state.profile;
    state.jobs = Array.isArray(cached.jobs) ? cached.jobs : [];
    state.workers = Array.isArray(cached.workers) ? cached.workers : [];
    state.lists = Array.isArray(cached.lists) ? cached.lists : [];
    state.members = Array.isArray(cached.members) ? cached.members : [];
    state.items = Array.isArray(cached.items) ? cached.items : [];
  }

  function getToggleQueue() {
    return readJson(cacheKey("toggleQueue"), []);
  }

  function setToggleQueue(queue) {
    saveJson(cacheKey("toggleQueue"), queue);
  }

  function enqueueToggle(itemId, completed) {
    const queue = getToggleQueue().filter(function (entry) {
      return entry.itemId !== itemId;
    });
    queue.push({
      itemId: itemId,
      completed: Boolean(completed),
      queuedAt: new Date().toISOString()
    });
    setToggleQueue(queue);
  }

  function updateStatusBadges() {
    elements.networkBadge.textContent = state.online ? "Online" : "Offline";
    elements.networkBadge.className = "jgc-badge " + (state.online ? "jgc-badge--success" : "jgc-badge--warning");
    const pending = getToggleQueue().length;
    elements.syncBadge.textContent = pending ? pending + " change" + (pending === 1 ? "" : "s") + " waiting" : "Synced";
    elements.syncBadge.className = "jgc-badge " + (pending ? "jgc-badge--warning" : "jgc-badge--success");
  }

  function renderIdentity() {
    const name = state.profile && state.profile.display_name
      || state.worker && state.worker.display
      || state.worker && state.worker.key
      || "";
    elements.currentUser.textContent = name ? "Signed in as: " + name : "";
  }

  function renderReferenceOptions() {
    const currentJobFilter = elements.jobFilter.value;
    const currentFormJob = elements.job.value;
    const jobOptions = state.jobs.map(function (job) {
      return '<option value="' + escapeHtml(job.id) + '">'
        + escapeHtml(job.job_number + " - " + job.job_name)
        + "</option>";
    }).join("");

    elements.jobFilter.innerHTML = '<option value="">All jobs</option>' + jobOptions;
    elements.job.innerHTML = '<option value="">Select a job</option>' + jobOptions;
    if (state.jobs.some(function (job) { return job.id === currentJobFilter; })) {
      elements.jobFilter.value = currentJobFilter;
    }
    if (state.jobs.some(function (job) { return job.id === currentFormJob; })) {
      elements.job.value = currentFormJob;
    }
  }

  function renderMemberSelector(selectedIds, disabled) {
    const selected = new Set(selectedIds || []);
    elements.memberGrid.innerHTML = state.workers.length
      ? state.workers.map(function (worker) {
        const locked = state.user && worker.profile_id === state.user.id;
        return '<label class="job-list-member-option">'
          + '<input type="checkbox" value="' + escapeHtml(worker.profile_id) + '"'
          + (selected.has(worker.profile_id) || locked ? " checked" : "")
          + (disabled || locked ? " disabled" : "") + ">"
          + '<span>' + escapeHtml(worker.display_name) + "</span>"
          + "</label>";
      }).join("")
      : '<div class="jgc-empty-state">No approved Work Order employees are available.</div>';
  }

  function renderCards() {
    const query = String(elements.search.value || "").trim().toLowerCase();
    const jobId = elements.jobFilter.value;
    const visible = state.lists.filter(function (list) {
      if (list.deleted_at || list.status !== state.tab) {
        return false;
      }
      if (jobId && list.job_id !== jobId) {
        return false;
      }
      if (!query) {
        return true;
      }
      const memberText = membersFor(list.id).map(function (member) { return member.display_name; }).join(" ");
      const itemText = itemsFor(list.id).map(function (item) { return item.item_text; }).join(" ");
      return [list.title, list.job_number, list.job_name, memberText, itemText]
        .join(" ").toLowerCase().includes(query);
    });

    if (!visible.length) {
      elements.cards.innerHTML = '<div class="jgc-empty-state">No ' + escapeHtml(state.tab) + " job notes found.</div>";
      return;
    }

    elements.cards.innerHTML = visible.map(function (list) {
      const listItems = itemsFor(list.id);
      const completed = listItems.filter(function (item) { return item.completed; }).length;
      const percent = listItems.length ? Math.round((completed / listItems.length) * 100) : 0;
      const controller = canControl(list);
      const reminder = list.reminder_at
        ? '<span class="job-list-reminder"><i data-lucide="bell"></i> ' + escapeHtml(formatDateTime(list.reminder_at)) + "</span>"
        : '<span>No reminder</span>';
      const memberHtml = membersFor(list.id).map(function (member) {
        return '<span class="job-list-member-chip">' + escapeHtml(member.display_name) + "</span>";
      }).join("");
      const itemHtml = listItems.length
        ? listItems.map(function (item) {
          return '<li><button class="job-list-check ' + (item.completed ? "is-complete" : "") + '"'
            + ' type="button" data-job-list-toggle="' + escapeHtml(item.id) + '"'
            + (list.status === "completed" ? " disabled" : "")
            + ' aria-pressed="' + (item.completed ? "true" : "false") + '">'
            + '<span class="job-list-check-box">' + (item.completed ? "X" : "") + "</span>"
            + '<span class="job-list-check-text">' + escapeHtml(item.item_text) + "</span>"
            + "</button></li>";
        }).join("")
        : '<li class="job-list-muted">No items added yet.</li>';

      return '<article class="job-list-card ' + (list.status === "completed" ? "is-completed" : "") + '">'
        + '<div class="job-list-card-header">'
        + '<div class="job-list-card-title"><h2>' + escapeHtml(list.title) + "</h2>"
        + "<p>" + escapeHtml(list.job_number + " - " + list.job_name) + "</p></div>"
        + '<span class="jgc-badge ' + (list.status === "completed" ? "" : "jgc-badge--success") + '">'
        + escapeHtml(list.status === "completed" ? "Completed" : "Open") + "</span></div>"
        + '<div class="job-list-card-meta">' + reminder + "<span>Created by " + escapeHtml(list.created_by_name) + "</span></div>"
        + '<div class="job-list-members">' + memberHtml + "</div>"
        + '<ul class="job-list-items">' + itemHtml + "</ul>"
        + '<div class="job-list-progress-line"><strong>' + completed + " of " + listItems.length + " done</strong><span>" + percent + "%</span></div>"
        + '<div class="job-list-progress"><span style="width:' + percent + '%"></span></div>'
        + '<div class="job-list-card-footer"><small>Updated ' + escapeHtml(formatDateTime(list.updated_at)) + " by "
        + escapeHtml(list.last_edited_by_name || list.created_by_name) + "</small>"
        + '<button class="jgc-button ' + (controller ? "" : "jgc-button--secondary") + '" type="button" data-job-list-open="'
        + escapeHtml(list.id) + '">' + (controller ? "Manage" : "View") + "</button></div>"
        + "</article>";
    }).join("");
    refreshIcons();
  }

  function renderItemEditor(items, disabled) {
    state.editingItemIds = (items || []).map(function (item) { return item.id || ""; });
    elements.itemEditor.innerHTML = (items || []).map(function (item, index) {
      return '<div class="job-list-item-edit-row">'
        + '<input class="jgc-input" data-job-list-item-input="' + index + '" maxlength="240" value="'
        + escapeHtml(item.item_text || "") + '" placeholder="Material or reminder item"' + (disabled ? " disabled" : "") + ">"
        + '<button class="jgc-button jgc-button--danger" type="button" data-job-list-remove-item="' + index + '"'
        + (disabled ? " hidden" : "") + ' aria-label="Remove item" title="Remove item">X</button>'
        + "</div>";
    }).join("");
  }

  function readItemEditor() {
    return Array.from(elements.itemEditor.querySelectorAll("[data-job-list-item-input]")).map(function (input, index) {
      return {
        id: state.editingItemIds[index] || "",
        item_text: String(input.value || "").trim(),
        position: index
      };
    });
  }

  function openModal(listId) {
    const list = listId ? state.lists.find(function (entry) { return entry.id === listId; }) : null;
    const controller = !list || canControl(list);
    const editable = controller && (!list || list.status === "open");
    state.viewerOnly = !controller;
    elements.form.reset();
    elements.listId.value = list ? list.id : "";
    elements.title.value = list ? list.title : "";
    elements.job.value = list ? list.job_id || "" : "";
    elements.reminder.value = list ? toLocalInput(list.reminder_at) : "";
    elements.modalTitle.textContent = list ? list.title : "New Job Note";
    elements.accessLine.textContent = controller
      ? (list && list.status === "completed"
        ? "Reopen this completed note before changing it."
        : "Tagged employees can edit this note and its reminder.")
      : "You can view and check items. Tagged employees manage the note.";

    const selectedIds = list
      ? membersFor(list.id).map(function (member) { return member.profile_id; })
      : state.user ? [state.user.id] : [];
    renderMemberSelector(selectedIds, !editable);
    renderItemEditor(list ? itemsFor(list.id) : [{ item_text: "" }], !editable);

    elements.title.disabled = !editable;
    elements.job.disabled = !editable || Boolean(list);
    elements.reminder.disabled = !editable;
    elements.addItem.hidden = !editable;
    elements.save.hidden = !editable;
    elements.complete.hidden = !controller || !list;
    elements.deleteButton.hidden = !controller || !list;
    elements.complete.innerHTML = list && list.status === "completed"
      ? '<i data-lucide="rotate-ccw"></i> Reopen Note'
      : '<i data-lucide="check-circle"></i> Complete Note';

    elements.modal.hidden = false;
    document.body.style.overflow = "hidden";
    refreshIcons();
  }

  function closeModal() {
    elements.modal.hidden = true;
    document.body.style.overflow = "";
  }

  async function addActivity(listId, action, details) {
    if (!state.client || !state.user) {
      return;
    }
    const result = await state.client.from("job_list_activity").insert({
      list_id: listId,
      action: action,
      actor_profile_id: state.user.id,
      actor_name: state.profile && state.profile.display_name || state.worker.display || "Portal user",
      details: details || {}
    });
    if (result.error) {
      console.warn("Job Note activity could not be recorded.", result.error);
    }
  }

  async function syncMembers(list) {
    const checked = new Set(Array.from(elements.memberGrid.querySelectorAll("input:checked")).map(function (input) {
      return input.value;
    }));
    checked.add(list.created_by);
    const existing = membersFor(list.id);
    const existingIds = new Set(existing.map(function (member) { return member.profile_id; }));
    const toAdd = Array.from(checked).filter(function (profileId) { return profileId && !existingIds.has(profileId); });
    const toRemove = existing.filter(function (member) {
      return member.profile_id !== list.created_by && !checked.has(member.profile_id);
    });

    if (toAdd.length) {
      const addResult = await state.client.from("job_list_members").insert(toAdd.map(function (profileId) {
        return { list_id: list.id, profile_id: profileId, added_by: state.user.id };
      }));
      if (addResult.error) {
        throw addResult.error;
      }
    }
    if (toRemove.length) {
      const removeResult = await state.client.from("job_list_members")
        .delete()
        .in("id", toRemove.map(function (member) { return member.id; }));
      if (removeResult.error) {
        throw removeResult.error;
      }
    }
  }

  async function syncItems(list) {
    const edited = readItemEditor().filter(function (item) { return item.item_text; });
    if (!edited.length) {
      throw new Error("Add at least one item.");
    }
    const existing = itemsFor(list.id);
    const editedIds = new Set(edited.map(function (item) { return item.id; }).filter(Boolean));
    const toDelete = existing.filter(function (item) { return !editedIds.has(item.id); });
    const toUpdate = edited.filter(function (item) { return item.id; });
    const toInsert = edited.filter(function (item) { return !item.id; });

    if (toUpdate.length) {
      for (const item of toUpdate) {
        const result = await state.client.from("job_list_items")
          .update({ item_text: item.item_text, position: item.position })
          .eq("id", item.id);
        if (result.error) {
          throw result.error;
        }
      }
    }
    if (toInsert.length) {
      const result = await state.client.from("job_list_items").insert(toInsert.map(function (item) {
        return {
          list_id: list.id,
          item_text: item.item_text,
          position: item.position,
          created_by: state.user.id
        };
      }));
      if (result.error) {
        throw result.error;
      }
    }
    if (toDelete.length) {
      const result = await state.client.from("job_list_items")
        .delete()
        .in("id", toDelete.map(function (item) { return item.id; }));
      if (result.error) {
        throw result.error;
      }
    }
  }

  async function saveList(event) {
    event.preventDefault();
    if (!state.online) {
      showNotice("Connect to the internet to create or edit a note. Item checkmarks still work offline.", "error");
      return;
    }
    const listId = elements.listId.value;
    const existing = listId ? state.lists.find(function (list) { return list.id === listId; }) : null;
    if (existing && !canControl(existing)) {
      showNotice("Only tagged employees and admins can edit this note.", "error");
      return;
    }
    const title = String(elements.title.value || "").trim();
    const job = state.jobs.find(function (entry) { return entry.id === elements.job.value; });
    const reminderAt = fromLocalInput(elements.reminder.value);
    if (!title || !job) {
      showNotice("Enter a note name and select a job.", "error");
      return;
    }
    if (reminderAt && new Date(reminderAt).getTime() <= Date.now()) {
      showNotice("Choose a reminder time in the future.", "error");
      return;
    }
    if (!readItemEditor().some(function (item) { return item.item_text; })) {
      showNotice("Add at least one item.", "error");
      return;
    }

    elements.save.disabled = true;
    showNotice("");
    try {
      let list = existing;
      if (existing) {
        const result = await state.client.from("job_lists")
          .update({ title: title, reminder_at: reminderAt })
          .eq("id", existing.id)
          .select("*")
          .single();
        if (result.error) {
          throw result.error;
        }
        list = result.data;
      } else {
        const result = await state.client.from("job_lists").insert({
          job_id: job.id,
          job_number: job.job_number,
          job_name: job.job_name,
          title: title,
          reminder_at: reminderAt,
          created_by: state.user.id
        }).select("*").single();
        if (result.error) {
          throw result.error;
        }
        list = result.data;
      }

      await syncMembers(list);
      await syncItems(list);
      await addActivity(list.id, existing ? "list_updated" : "list_created", {
        title: title,
        job_number: job.job_number,
        reminder_at: reminderAt
      });
      closeModal();
      await refreshData();
      showNotice(existing ? "Job note updated." : "Job note created.");
    } catch (error) {
      showNotice(error && error.message || "The job note could not be saved.", "error");
    } finally {
      elements.save.disabled = false;
    }
  }

  async function setListStatus() {
    const list = state.lists.find(function (entry) { return entry.id === elements.listId.value; });
    if (!list || !canControl(list) || !state.online) {
      showNotice("Connect to the internet to change this note.", "error");
      return;
    }
    const nextStatus = list.status === "completed" ? "open" : "completed";
    const result = await state.client.from("job_lists").update({ status: nextStatus }).eq("id", list.id);
    if (result.error) {
      showNotice(result.error.message, "error");
      return;
    }
    await addActivity(list.id, nextStatus === "completed" ? "list_completed" : "list_reopened");
    closeModal();
    await refreshData();
    showNotice(nextStatus === "completed" ? "Job note completed." : "Job note reopened.");
  }

  async function deleteList() {
    const list = state.lists.find(function (entry) { return entry.id === elements.listId.value; });
    if (!list || !canControl(list) || !state.online) {
      showNotice("Connect to the internet to delete this note.", "error");
      return;
    }
    if (!window.confirm('Delete "' + list.title + '"? An admin can restore it later.')) {
      return;
    }
    const result = await state.client.from("job_lists")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", list.id);
    if (result.error) {
      showNotice(result.error.message, "error");
      return;
    }
    await addActivity(list.id, "list_deleted");
    closeModal();
    await refreshData();
    showNotice("Job note deleted.");
  }

  async function toggleItem(itemId) {
    const item = state.items.find(function (entry) { return entry.id === itemId; });
    if (!item) {
      return;
    }
    const list = state.lists.find(function (entry) { return entry.id === item.list_id; });
    if (!list || list.status !== "open") {
      showNotice("Reopen this completed note before changing its items.", "error");
      return;
    }
    const completed = !item.completed;
    item.completed = completed;
    item.completed_at = completed ? new Date().toISOString() : null;
    item.completed_by_name = completed
      ? state.profile && state.profile.display_name || state.worker.display || ""
      : "";
    renderCards();
    saveCache();

    if (!state.online) {
      enqueueToggle(item.id, completed);
      updateStatusBadges();
      return;
    }

    const result = await state.client.rpc("toggle_job_list_item", {
      p_item_id: item.id,
      p_completed: completed
    });
    if (result.error) {
      item.completed = !completed;
      renderCards();
      saveCache();
      showNotice(result.error.message || "The item could not be updated.", "error");
      return;
    }
    Object.assign(item, result.data || {});
    saveCache();
    renderCards();
  }

  async function flushToggleQueue() {
    if (!state.online || !state.client) {
      return;
    }
    const queue = getToggleQueue();
    if (!queue.length) {
      updateStatusBadges();
      return;
    }
    const remaining = [];
    for (const entry of queue) {
      const result = await state.client.rpc("toggle_job_list_item", {
        p_item_id: entry.itemId,
        p_completed: entry.completed
      });
      if (result.error) {
        remaining.push(entry);
      }
    }
    setToggleQueue(remaining);
    updateStatusBadges();
    if (remaining.length) {
      showNotice(remaining.length + " offline change" + (remaining.length === 1 ? "" : "s") + " could not sync yet.", "error");
    }
  }

  async function loadProfileAndReferences() {
    const results = await Promise.all([
      state.client.from("profiles")
        .select("id,email,display_name,worker_key,role,account_status")
        .eq("id", state.user.id)
        .single(),
      state.client.from("jobs")
        .select("id,job_number,job_name,active")
        .eq("active", true)
        .order("job_number"),
      state.client.from("work_order_labour_workers")
        .select("id,profile_id,display_name,worker_key,approved")
        .eq("approved", true)
        .order("display_name")
    ]);
    if (results[0].error) {
      throw results[0].error;
    }
    state.profile = results[0].data;
    if (!results[1].error) {
      state.jobs = results[1].data || [];
    }
    if (!results[2].error) {
      state.workers = (results[2].data || []).filter(function (worker) { return worker.profile_id; });
    }
    renderIdentity();
    renderReferenceOptions();
  }

  async function refreshData() {
    if (!state.online || !state.client) {
      loadCache();
      renderIdentity();
      renderReferenceOptions();
      renderCards();
      updateStatusBadges();
      return;
    }
    elements.syncButton.disabled = true;
    try {
      const results = await Promise.all([
        state.client.from("job_lists").select("*").order("updated_at", { ascending: false }),
        state.client.from("job_list_members").select("*"),
        state.client.from("job_list_items").select("*").order("position")
      ]);
      const errorResult = results.find(function (result) { return result.error; });
      if (errorResult) {
        throw errorResult.error;
      }
      state.lists = results[0].data || [];
      state.members = results[1].data || [];
      state.items = results[2].data || [];
      saveCache();
      await flushToggleQueue();
      renderCards();
      updateStatusBadges();
    } catch (error) {
      loadCache();
      renderCards();
      updateStatusBadges();
      showNotice((error && error.message || "Job Notes could not be refreshed.") + " Showing saved device data.", "error");
    } finally {
      elements.syncButton.disabled = false;
    }
  }

  function scheduleRefresh() {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(refreshData, 250);
  }

  function subscribeRealtime() {
    if (!state.client || !state.user) {
      return;
    }
    state.channel = state.client.channel("job-lists-" + state.user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_lists" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_list_members" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_list_items" }, scheduleRefresh)
      .subscribe();
  }

  function addBlankItem() {
    const items = readItemEditor();
    items.push({ item_text: "" });
    renderItemEditor(items, false);
    const inputs = elements.itemEditor.querySelectorAll("[data-job-list-item-input]");
    if (inputs.length) {
      inputs[inputs.length - 1].focus();
    }
  }

  function removeItem(index) {
    const items = readItemEditor();
    if (items.length === 1) {
      items[0].item_text = "";
    } else {
      items.splice(index, 1);
    }
    renderItemEditor(items, false);
  }

  function bindEvents() {
    elements.newButton.addEventListener("click", function () { openModal(""); });
    elements.syncButton.addEventListener("click", refreshData);
    elements.closeButton.addEventListener("click", closeModal);
    elements.modal.addEventListener("click", function (event) {
      if (event.target === elements.modal) {
        closeModal();
      }
    });
    elements.form.addEventListener("submit", saveList);
    elements.addItem.addEventListener("click", addBlankItem);
    elements.complete.addEventListener("click", setListStatus);
    elements.deleteButton.addEventListener("click", deleteList);
    elements.search.addEventListener("input", renderCards);
    elements.jobFilter.addEventListener("change", renderCards);

    document.querySelectorAll("[data-job-list-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.tab = button.dataset.jobListTab;
        document.querySelectorAll("[data-job-list-tab]").forEach(function (tab) {
          tab.classList.toggle("active", tab === button);
        });
        renderCards();
      });
    });

    elements.cards.addEventListener("click", function (event) {
      const toggle = event.target.closest("[data-job-list-toggle]");
      const open = event.target.closest("[data-job-list-open]");
      if (toggle) {
        toggleItem(toggle.dataset.jobListToggle);
      } else if (open) {
        openModal(open.dataset.jobListOpen);
      }
    });

    elements.itemEditor.addEventListener("click", function (event) {
      const button = event.target.closest("[data-job-list-remove-item]");
      if (button) {
        removeItem(Number(button.dataset.jobListRemoveItem));
      }
    });

    window.addEventListener("online", async function () {
      state.online = true;
      updateStatusBadges();
      await loadProfileAndReferences();
      await refreshData();
    });
    window.addEventListener("offline", function () {
      state.online = false;
      updateStatusBadges();
      showNotice("You are offline. Saved notes remain available and item checkmarks will sync later.");
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !elements.modal.hidden) {
        closeModal();
      }
    });
  }

  function collectElements() {
    elements.currentUser = byId("jobListsCurrentUser");
    elements.notice = byId("jobListsNotice");
    elements.networkBadge = byId("jobListsNetworkBadge");
    elements.syncBadge = byId("jobListsSyncBadge");
    elements.newButton = byId("jobListsNewButton");
    elements.syncButton = byId("jobListsSyncButton");
    elements.search = byId("jobListsSearch");
    elements.jobFilter = byId("jobListsJobFilter");
    elements.cards = byId("jobListsCards");
    elements.modal = byId("jobListsModal");
    elements.closeButton = byId("jobListModalClose");
    elements.modalTitle = byId("jobListModalTitle");
    elements.accessLine = byId("jobListAccessLine");
    elements.form = byId("jobListForm");
    elements.listId = byId("jobListId");
    elements.title = byId("jobListTitle");
    elements.job = byId("jobListJob");
    elements.reminder = byId("jobListReminder");
    elements.memberGrid = byId("jobListMembers");
    elements.itemEditor = byId("jobListItemEditor");
    elements.addItem = byId("jobListAddItem");
    elements.save = byId("jobListSave");
    elements.complete = byId("jobListComplete");
    elements.deleteButton = byId("jobListDelete");
  }

  async function init() {
    collectElements();
    state.worker = typeof window.requireJgcWorker === "function"
      ? window.requireJgcWorker()
      : typeof requireJgcWorker === "function" ? requireJgcWorker() : null;
    state.client = typeof window.createJgcSupabaseClient === "function"
      ? window.createJgcSupabaseClient()
      : typeof createJgcSupabaseClient === "function" ? createJgcSupabaseClient() : null;
    bindEvents();
    updateStatusBadges();
    refreshIcons();

    if (!state.client) {
      showNotice("Supabase is not available.", "error");
      return;
    }
    const userResult = await state.client.auth.getUser();
    state.user = userResult && userResult.data && userResult.data.user;
    if (!state.user) {
      window.location.href = "index.html";
      return;
    }

    loadCache();
    renderIdentity();
    renderReferenceOptions();
    renderCards();

    try {
      if (state.online) {
        await loadProfileAndReferences();
        await refreshData();
      }
      subscribeRealtime();
      const requestedList = new URLSearchParams(window.location.search).get("list");
      if (requestedList && state.lists.some(function (list) { return list.id === requestedList; })) {
        openModal(requestedList);
      }
    } catch (error) {
      showNotice(error && error.message || "Job Notes could not be loaded.", "error");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
