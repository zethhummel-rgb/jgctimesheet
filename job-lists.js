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
    reminders: [],
    tab: "open",
    online: navigator.onLine,
    channel: null,
    refreshTimer: null,
    reminderExpiryTimer: null,
    editingItemIds: [],
    editingReminders: [],
    autosavePromise: null,
    autosaveQueued: false,
    autosaveRevision: 0,
    viewerOnly: false,
    editorEditable: false,
    editorCanToggle: false,
    pendingCompletionOnClose: null,
    openJobGroups: new Set()
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

  function formatDate(value) {
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
      year: "numeric"
    }).format(date);
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

  function setAutosaveStatus(message, status) {
    if (!elements.autosaveStatus) {
      return;
    }
    elements.autosaveStatus.textContent = message || "Changes save at each step";
    elements.autosaveStatus.classList.toggle("is-saving", status === "saving");
    elements.autosaveStatus.classList.toggle("is-saved", status === "saved");
    elements.autosaveStatus.classList.toggle("is-error", status === "error");
  }

  function editorDraftKey(listId) {
    return cacheKey("editorDraft:" + (listId || "new"));
  }

  function captureEditorDraft() {
    return {
      title: String(elements.title.value || "").trim(),
      jobId: elements.job.value || "",
      memberIds: Array.from(elements.memberGrid.querySelectorAll('input[type="checkbox"]:checked')).map(function (input) {
        return input.value;
      }),
      items: readItemEditor(),
      reminders: state.editingReminders.map(function (reminder) {
        return Object.assign({}, reminder);
      }),
      savedAt: new Date().toISOString()
    };
  }

  function storeEditorDraft(snapshot, listId) {
    saveJson(editorDraftKey(listId == null ? elements.listId.value : listId), snapshot || captureEditorDraft());
  }

  function clearEditorDraft(listId) {
    try {
      localStorage.removeItem(editorDraftKey(listId));
    } catch (error) {
      console.warn("Job Note editor draft could not be cleared.", error);
    }
  }

  function upsertStateRow(rows, row) {
    const index = rows.findIndex(function (entry) { return entry.id === row.id; });
    if (index >= 0) {
      rows[index] = row;
    } else {
      rows.push(row);
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

  function applyChecklistStatus(list) {
    if (!list) {
      return false;
    }
    const listItems = itemsFor(list.id);
    const nextStatus = listItems.length && listItems.every(function (item) {
      return Boolean(item.completed);
    }) ? "completed" : "open";
    if (list.status === nextStatus) {
      return false;
    }
    list.status = nextStatus;
    list.updated_at = new Date().toISOString();
    return true;
  }

  function remindersFor(listId, includeExpired) {
    const now = Date.now();
    const reminders = state.reminders
      .filter(function (reminder) {
        const reminderTime = new Date(reminder.reminder_at).getTime();
        return reminder.list_id === listId
          && !Number.isNaN(reminderTime)
          && (includeExpired || reminderTime > now);
      })
      .sort(function (a, b) {
        return new Date(a.reminder_at).getTime() - new Date(b.reminder_at).getTime();
      });

    if (reminders.length || includeExpired) {
      return reminders;
    }

    const list = state.lists.find(function (entry) { return entry.id === listId; });
    const legacyTime = list && new Date(list.reminder_at).getTime();
    return list && list.reminder_at && !Number.isNaN(legacyTime) && legacyTime > now
      ? [{
        id: "legacy:" + list.id,
        list_id: list.id,
        reminder_at: list.reminder_at,
        sent_at: list.reminder_sent_at || null,
        legacy: true
      }]
      : [];
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
      reminders: state.reminders,
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
    state.reminders = Array.isArray(cached.reminders) ? cached.reminders : [];
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
    renderOptionsSummary();
  }

  function renderOptionsSummary() {
    if (!elements.optionsSummary) {
      return;
    }
    const tagged = elements.memberGrid
      ? elements.memberGrid.querySelectorAll('input[type="checkbox"]:checked').length
      : 0;
    const reminders = state.editingReminders.length;
    const parts = [];
    if (tagged) {
      parts.push(tagged + " tagged");
    }
    if (reminders) {
      parts.push(reminders + " reminder" + (reminders === 1 ? "" : "s"));
    }
    elements.optionsSummary.textContent = parts.join(" | ");
  }

  function jobGroupKey(list) {
    const jobId = String(list.job_id || "").trim();
    if (jobId) {
      return "job:" + jobId;
    }
    return "manual:" + String(list.job_name || "").trim().toLowerCase()
      + "|" + String(list.job_number || "").trim().toLowerCase();
  }

  function rememberOpenJobGroups() {
    Array.from(elements.cards.querySelectorAll("[data-job-list-job-group]")).forEach(function (group) {
      const key = group.dataset.jobListJobGroup;
      if (group.open) {
        state.openJobGroups.add(key);
      } else {
        state.openJobGroups.delete(key);
      }
    });
  }

  function renderNoteCard(list) {
    const listItems = itemsFor(list.id);
    const previewItem = listItems.find(function (item) { return !item.completed; }) || listItems[0];
    const preview = previewItem
      ? previewItem.item_text
      : "No checklist items yet";
    const creatorName = String(list.created_by_name || list.last_edited_by_name || "Unknown").trim();
    const createdDate = formatDate(list.created_at || list.updated_at);
    const canDelete = canControl(list);

    return '<article class="job-list-note-row ' + (list.status === "completed" ? "is-completed" : "") + '">'
      + '<span class="job-list-note-copy"><strong>' + escapeHtml(list.title) + "</strong>"
      + '<span class="job-list-note-preview">' + escapeHtml(preview) + "</span>"
      + '<span class="job-list-note-details">Created by ' + escapeHtml(creatorName)
      + (createdDate ? " &bull; " + escapeHtml(createdDate) : "") + "</span></span>"
      + '<span class="job-list-note-actions">'
      + '<button class="jgc-button job-list-note-open" type="button" data-job-list-open="' + escapeHtml(list.id) + '"'
      + ' aria-label="Open note: ' + escapeHtml(list.title) + '">Open</button>'
      + (canDelete
        ? '<button class="jgc-button jgc-button--danger job-list-note-delete" type="button"'
          + ' data-job-list-delete="' + escapeHtml(list.id) + '"'
          + ' aria-label="Delete note: ' + escapeHtml(list.title) + '" title="Delete note">'
          + '<i data-lucide="trash-2" aria-hidden="true"></i><span>Delete</span></button>'
        : "")
      + "</span></article>";
  }

  function renderCards() {
    rememberOpenJobGroups();
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

    const grouped = new Map();
    visible.forEach(function (list) {
      const key = jobGroupKey(list);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(list);
    });

    const groups = Array.from(grouped.entries()).sort(function (left, right) {
      const leftList = left[1][0];
      const rightList = right[1][0];
      return String(leftList.job_name || "").localeCompare(String(rightList.job_name || ""), undefined, { sensitivity: "base" })
        || String(leftList.job_number || "").localeCompare(String(rightList.job_number || ""), undefined, { numeric: true });
    });

    const groupHtml = groups.map(function (entry) {
      const key = entry[0];
      const lists = entry[1].slice().sort(function (left, right) {
        return new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime();
      });
      const job = lists[0];
      const jobName = String(job.job_name || "").trim() || "Job name not entered";
      const jobNumber = String(job.job_number || "").trim();
      const noteCount = lists.length;
      const shouldOpen = state.openJobGroups.has(key) || Boolean(query || jobId);

      return '<details class="job-list-job-group" data-job-list-job-group="' + escapeHtml(key) + '"'
        + (shouldOpen ? " open" : "") + ">"
        + '<summary class="job-list-job-summary">'
        + '<div class="job-list-job-heading"><h2>' + escapeHtml(jobName) + "</h2>"
        + (jobNumber ? "<p>Job " + escapeHtml(jobNumber) + "</p>" : "") + "</div>"
        + '<div class="job-list-job-summary-meta">'
        + '<span class="jgc-badge jgc-badge--success">' + noteCount + " note" + (noteCount === 1 ? "" : "s") + "</span>"
        + '<span class="job-list-job-toggle" aria-hidden="true"></span></div>'
        + "</summary>"
        + '<div class="job-list-job-body"><div class="job-list-job-cards">'
        + lists.map(renderNoteCard).join("")
        + "</div></div></details>";
    }).join("");
    elements.cards.innerHTML = '<section class="job-list-browser" aria-labelledby="jobListBrowserTitle">'
      + '<h2 id="jobListBrowserTitle" class="job-list-browser-title">Jobs</h2>'
      + '<div class="job-list-job-directory">' + groupHtml + "</div></section>";
    refreshIcons();
  }

  function renderItemEditor(items, disabled) {
    state.editingItemIds = (items || []).map(function (item) { return item.id || ""; });
    elements.itemEditor.innerHTML = (items || []).map(function (item, index) {
      return '<div class="job-list-item-edit-row ' + (item.completed ? "is-complete" : "") + '"'
        + ' data-job-list-item-completed="' + (item.completed ? "true" : "false") + '">'
        + '<button class="job-list-edit-bullet" type="button" data-job-list-edit-toggle="' + index + '"'
        + (state.editorCanToggle ? "" : " disabled")
        + ' aria-label="' + escapeHtml(item.completed ? "Mark line incomplete" : "Mark line complete") + '"'
        + ' aria-pressed="' + (item.completed ? "true" : "false") + '"></button>'
        + '<label class="job-list-item-quantity"><span>Qty</span>'
        + '<input data-job-list-item-quantity="' + index + '" type="number" min="0" step="0.001" inputmode="decimal" autocomplete="off"'
        + ' placeholder="-" aria-label="Quantity for line ' + (index + 1) + '"'
        + (disabled ? " disabled" : "") + ' value="' + escapeHtml(item.quantity !== null && item.quantity !== undefined ? item.quantity : "") + '"></label>'
        + '<textarea class="job-list-line-input" data-job-list-item-input="' + index + '" maxlength="240" rows="1"'
        + ' placeholder="' + (index ? "Add another item" : "Start typing") + '"'
        + (disabled ? " disabled" : "") + ">" + escapeHtml(item.item_text || "") + "</textarea>"
        + '<button class="jgc-button jgc-button--danger" type="button" data-job-list-remove-item="' + index + '"'
        + (disabled ? " hidden" : "") + ' aria-label="Remove item" title="Remove item">X</button>'
        + "</div>";
    }).join("");
    elements.itemEditor.querySelectorAll("[data-job-list-item-input]").forEach(autoSizeItemInput);
  }

  function readItemEditor() {
    return Array.from(elements.itemEditor.querySelectorAll("[data-job-list-item-input]")).map(function (input, index) {
      const id = state.editingItemIds[index] || "";
      const row = input.closest(".job-list-item-edit-row");
      return {
        id: id,
        item_text: String(input.value || "").trim(),
        quantity: (function () {
          const quantityInput = elements.itemEditor.querySelector('[data-job-list-item-quantity="' + index + '"]');
          const raw = String(quantityInput && quantityInput.value || "").trim();
          return raw ? raw : null;
        }()),
        position: index,
        completed: Boolean(row && row.dataset.jobListItemCompleted === "true")
      };
    });
  }

  function autoSizeItemInput(input) {
    if (!input) {
      return;
    }
    input.style.height = "auto";
    input.style.height = Math.min(Math.max(input.scrollHeight, 46), 180) + "px";
  }

  function renderReminderEditor(disabled) {
    const now = Date.now();
    state.editingReminders = state.editingReminders
      .filter(function (reminder) {
        const reminderTime = new Date(reminder.reminder_at).getTime();
        return !Number.isNaN(reminderTime) && reminderTime > now;
      })
      .sort(function (a, b) {
        return new Date(a.reminder_at).getTime() - new Date(b.reminder_at).getTime();
      });

    elements.reminderChips.innerHTML = state.editingReminders.map(function (reminder, index) {
      return '<span class="job-list-reminder-chip" data-job-list-reminder-chip>'
        + '<i data-lucide="bell"></i><span>' + escapeHtml(formatDateTime(reminder.reminder_at)) + "</span>"
        + (disabled ? "" : '<button class="job-list-reminder-remove" type="button"'
          + ' data-job-list-remove-reminder="' + index + '" aria-label="Remove reminder" title="Remove reminder">X</button>')
        + "</span>";
    }).join("");
    renderOptionsSummary();
    refreshIcons();
  }

  function scheduleReminderExpiryRefresh() {
    window.clearTimeout(state.reminderExpiryTimer);
    const now = Date.now();
    const futureTimes = state.reminders.concat(state.editingReminders)
      .map(function (reminder) { return new Date(reminder.reminder_at).getTime(); })
      .filter(function (reminderTime) {
        return !Number.isNaN(reminderTime) && reminderTime > now;
      })
      .sort(function (a, b) { return a - b; });

    if (!futureTimes.length) {
      return;
    }

    const delay = Math.min(futureTimes[0] - now + 1000, 2147483647);
    state.reminderExpiryTimer = window.setTimeout(function () {
      if (!elements.modal.hidden) {
        renderReminderEditor(elements.reminder.disabled);
      }
      renderCards();
      scheduleReminderExpiryRefresh();
    }, delay);
  }

  function addReminderFromInput(saveAfter) {
    const reminderAt = fromLocalInput(elements.reminder.value);
    if (!reminderAt) {
      return false;
    }
    const reminderTime = new Date(reminderAt).getTime();
    if (reminderTime <= Date.now()) {
      showNotice("Choose a reminder time in the future.", "error");
      return false;
    }
    if (state.editingReminders.some(function (reminder) {
      return new Date(reminder.reminder_at).getTime() === reminderTime;
    })) {
      showNotice("That reminder has already been added.", "error");
      return false;
    }

    state.editingReminders.push({
      id: "",
      list_id: elements.listId.value || "",
      reminder_at: reminderAt,
      sent_at: null
    });
    elements.reminder.value = "";
    showNotice("");
    renderReminderEditor(false);
    scheduleReminderExpiryRefresh();
    if (saveAfter !== false) {
      queueCheckpointSave();
    }
    return true;
  }

  function removeReminder(index) {
    state.editingReminders.splice(index, 1);
    renderReminderEditor(false);
    scheduleReminderExpiryRefresh();
    queueCheckpointSave();
  }

  function openModal(listId) {
    const list = listId ? state.lists.find(function (entry) { return entry.id === listId; }) : null;
    const controller = !list || canControl(list);
    const editable = controller && (!list || list.status === "open");
    state.pendingCompletionOnClose = null;
    state.viewerOnly = !controller;
    state.editorEditable = editable;
    state.editorCanToggle = Boolean((list && controller) || (!list && editable));
    elements.form.reset();
    elements.listId.value = list ? list.id : "";
    const savedDraft = readJson(editorDraftKey(list ? list.id : ""), null);
    elements.title.value = savedDraft && editable ? savedDraft.title || "" : list ? list.title : "";
    elements.job.value = savedDraft && editable ? savedDraft.jobId || "" : list ? list.job_id || "" : "";
    elements.reminder.value = "";
    state.editingReminders = savedDraft && editable && Array.isArray(savedDraft.reminders)
      ? savedDraft.reminders.map(function (reminder) { return Object.assign({}, reminder); })
      : list
      ? remindersFor(list.id).map(function (reminder) { return Object.assign({}, reminder); })
      : [];
    elements.modalTitle.textContent = String(elements.title.value || "").trim() || "New Job Note";
    elements.accessLine.textContent = controller
      ? (list && list.status === "completed"
        ? "Uncheck an item to reopen this note, or use Reopen Note for full editing."
        : "Tagged employees can edit this note and its reminder.")
      : "You can view and check items. Tagged employees manage the note.";

    const selectedIds = savedDraft && editable && Array.isArray(savedDraft.memberIds)
      ? savedDraft.memberIds
      : list
      ? membersFor(list.id).map(function (member) { return member.profile_id; })
      : state.user ? [state.user.id] : [];
    renderMemberSelector(selectedIds, !editable);
    renderItemEditor(
      savedDraft && editable && Array.isArray(savedDraft.items) && savedDraft.items.length
        ? savedDraft.items
        : list ? itemsFor(list.id) : [{ item_text: "" }],
      !editable
    );
    renderReminderEditor(!editable);
    elements.options.open = false;

    elements.title.disabled = !editable;
    elements.job.disabled = !editable || Boolean(list);
    elements.reminder.disabled = !editable;
    elements.addReminder.disabled = !editable;
    elements.addItem.hidden = !editable;
    elements.save.hidden = !editable;
    elements.complete.hidden = !controller || !list;
    elements.deleteButton.hidden = !controller || !list;
    elements.complete.innerHTML = list && list.status === "completed"
      ? '<i data-lucide="rotate-ccw"></i> Reopen Note'
      : '<i data-lucide="check-circle"></i> Complete Note';

    elements.modal.hidden = false;
    document.body.style.overflow = "hidden";
    setAutosaveStatus(
      savedDraft && editable ? "Saved device draft restored" : "Changes save at each step",
      savedDraft && editable ? "saved" : ""
    );
    scheduleReminderExpiryRefresh();
    refreshIcons();
    window.setTimeout(function () {
      const firstField = list ? elements.itemEditor.querySelector("[data-job-list-item-input]") : elements.title;
      if (firstField && editable) {
        firstField.focus();
      }
    }, 0);
  }

  function closeModal() {
    const pendingCompletion = state.pendingCompletionOnClose;
    state.pendingCompletionOnClose = null;
    elements.modal.hidden = true;
    document.body.style.overflow = "";
    state.editorEditable = false;
    state.editorCanToggle = false;
    setAutosaveStatus("Changes save at each step", "");
    if (pendingCompletion) {
      renderCards();
      showNotice(pendingCompletion.offline
        ? "All items are checked. Job note completed and waiting to sync."
        : "All items are checked. Job note completed.");
      if (!pendingCompletion.offline) {
        refreshData().catch(function (error) {
          showNotice(error && error.message || "The completed note could not be refreshed.", "error");
        });
      }
    }
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

  async function syncMembers(list, selectedIds) {
    const checked = new Set(selectedIds || []);
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
      })).select("*");
      if (addResult.error) {
        throw addResult.error;
      }
      (addResult.data || []).forEach(function (member) {
        upsertStateRow(state.members, member);
      });
    }
    if (toRemove.length) {
      const removeResult = await state.client.from("job_list_members")
        .delete()
        .in("id", toRemove.map(function (member) { return member.id; }));
      if (removeResult.error) {
        throw removeResult.error;
      }
      const removedIds = new Set(toRemove.map(function (member) { return member.id; }));
      state.members = state.members.filter(function (member) { return !removedIds.has(member.id); });
    }
  }

  async function syncItems(list, editorItems, requireItem) {
    const edited = (editorItems || []).filter(function (item) { return item.item_text; });
    if (requireItem && !edited.length) {
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
          .update({ item_text: item.item_text, quantity: item.quantity, position: item.position })
          .eq("id", item.id);
        if (result.error) {
          throw result.error;
        }
        const savedItem = state.items.find(function (entry) { return entry.id === item.id; });
        if (savedItem) {
          savedItem.item_text = item.item_text;
          savedItem.quantity = item.quantity;
          savedItem.position = item.position;
        }
      }
    }
    if (toInsert.length) {
      const result = await state.client.from("job_list_items").insert(toInsert.map(function (item) {
        return {
          list_id: list.id,
          item_text: item.item_text,
          quantity: item.quantity,
          position: item.position,
          created_by: state.user.id
        };
      })).select("*");
      if (result.error) {
        throw result.error;
      }
      for (const inserted of result.data || []) {
        const desired = toInsert.find(function (item) {
          return Number(item.position) === Number(inserted.position);
        });
        if (desired && desired.completed) {
          const toggleResult = await state.client.rpc("toggle_job_list_item", {
            p_item_id: inserted.id,
            p_completed: true
          });
          if (toggleResult.error) {
            throw toggleResult.error;
          }
          const toggled = Array.isArray(toggleResult.data) ? toggleResult.data[0] : toggleResult.data;
          if (toggled) {
            Object.assign(inserted, toggled);
          } else {
            inserted.completed = true;
          }
        }
        upsertStateRow(state.items, inserted);
        const currentInput = elements.itemEditor.querySelector(
          '[data-job-list-item-input="' + Number(inserted.position) + '"]'
        );
        if (desired && currentInput && String(currentInput.value || "").trim() === desired.item_text) {
          state.editingItemIds[Number(inserted.position)] = inserted.id;
        }
      }
    }
    if (toDelete.length) {
      const result = await state.client.from("job_list_items")
        .delete()
        .in("id", toDelete.map(function (item) { return item.id; }));
      if (result.error) {
        throw result.error;
      }
      const deletedIds = new Set(toDelete.map(function (item) { return item.id; }));
      state.items = state.items.filter(function (item) { return !deletedIds.has(item.id); });
    }
  }

  async function syncReminders(list, editorReminders) {
    const now = Date.now();
    const desiredReminders = editorReminders || [];
    const existing = state.reminders.filter(function (reminder) {
      const reminderTime = new Date(reminder.reminder_at).getTime();
      return reminder.list_id === list.id
        && !Number.isNaN(reminderTime)
        && reminderTime > now;
    });
    const keptIds = new Set(desiredReminders.map(function (reminder) {
      return reminder.id && !String(reminder.id).startsWith("legacy:") ? reminder.id : "";
    }).filter(Boolean));
    const toDelete = existing.filter(function (reminder) {
      return !keptIds.has(reminder.id);
    });
    const toInsert = desiredReminders.filter(function (reminder) {
      return !reminder.id || String(reminder.id).startsWith("legacy:");
    });

    if (toDelete.length) {
      const deleteResult = await state.client.from("job_list_reminders")
        .delete()
        .in("id", toDelete.map(function (reminder) { return reminder.id; }));
      if (deleteResult.error) {
        throw deleteResult.error;
      }
      const deletedIds = new Set(toDelete.map(function (reminder) { return reminder.id; }));
      state.reminders = state.reminders.filter(function (reminder) { return !deletedIds.has(reminder.id); });
    }
    if (toInsert.length) {
      const insertResult = await state.client.from("job_list_reminders").insert(toInsert.map(function (reminder) {
        return {
          list_id: list.id,
          reminder_at: reminder.reminder_at,
          created_by: state.user.id
        };
      })).select("*");
      if (insertResult.error) {
        throw insertResult.error;
      }
      (insertResult.data || []).forEach(function (reminder) {
        upsertStateRow(state.reminders, reminder);
        const current = state.editingReminders.find(function (entry) {
          return new Date(entry.reminder_at).getTime() === new Date(reminder.reminder_at).getTime();
        });
        if (current) {
          Object.assign(current, reminder);
        }
      });
    }
  }

  async function persistEditor(options) {
    const settings = options || {};
    const snapshot = settings.snapshot || captureEditorDraft();
    const revision = settings.revision == null ? state.autosaveRevision : settings.revision;
    const manual = Boolean(settings.manual);
    const closeAfter = Boolean(settings.closeAfter);
    const originalListId = elements.listId.value;
    const existing = originalListId
      ? state.lists.find(function (list) { return list.id === originalListId; })
      : null;
    const job = state.jobs.find(function (entry) { return entry.id === snapshot.jobId; });

    storeEditorDraft(snapshot, originalListId);

    if (existing && !canControl(existing)) {
      const message = "Only tagged employees and admins can edit this note.";
      setAutosaveStatus(message, "error");
      if (manual) {
        showNotice(message, "error");
      }
      return false;
    }
    if (!snapshot.title || !job) {
      const message = "Add a note name and choose a job to sync";
      setAutosaveStatus(message, "");
      if (manual) {
        showNotice("Enter a note name and select a job.", "error");
      }
      return false;
    }
    if (manual && !snapshot.items.some(function (item) { return item.item_text; })) {
      setAutosaveStatus("Add at least one checklist line", "error");
      showNotice("Add at least one item.", "error");
      return false;
    }
    if (!state.online) {
      setAutosaveStatus("Saved on this device - waiting for internet", "saved");
      if (manual) {
        showNotice("This draft is saved on this device. Connect to the internet before closing it.", "error");
      }
      return false;
    }

    setAutosaveStatus("Saving...", "saving");
    if (manual) {
      showNotice("");
    }

    try {
      let list = existing;
      if (existing) {
        const result = await state.client.from("job_lists")
          .update({ title: snapshot.title })
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
          title: snapshot.title,
          created_by: state.user.id
        }).select("*").single();
        if (result.error) {
          throw result.error;
        }
        list = result.data;
        elements.listId.value = list.id;
        clearEditorDraft("");
        storeEditorDraft(snapshot, list.id);
      }

      upsertStateRow(state.lists, list);
      await syncMembers(list, snapshot.memberIds);
      await syncItems(list, snapshot.items, manual);
      await syncReminders(list, snapshot.reminders);

      if (!existing || manual) {
        await addActivity(list.id, existing ? "list_updated" : "list_created", {
          title: snapshot.title,
          job_number: job.job_number,
          reminders: snapshot.reminders.map(function (reminder) { return reminder.reminder_at; })
        });
      }

      if (revision === state.autosaveRevision) {
        clearEditorDraft(list.id);
      }
      saveCache();
      renderCards();
      scheduleReminderExpiryRefresh();
      setAutosaveStatus("Saved", "saved");

      if (closeAfter) {
        closeModal();
        showNotice(existing ? "Job note updated." : "Job note created.");
      }
      return true;
    } catch (error) {
      storeEditorDraft(snapshot, elements.listId.value || originalListId);
      const message = error && error.message || "The job note could not be saved.";
      setAutosaveStatus("Not synced - use Save & Close to retry", "error");
      if (manual) {
        showNotice(message, "error");
      } else {
        console.warn("Job Note checkpoint save failed.", error);
      }
      return false;
    }
  }

  function queueCheckpointSave() {
    if (!state.editorEditable || elements.modal.hidden) {
      return Promise.resolve(false);
    }
    state.autosaveRevision += 1;
    storeEditorDraft(captureEditorDraft(), elements.listId.value);

    if (state.autosavePromise) {
      state.autosaveQueued = true;
      setAutosaveStatus("Saving...", "saving");
      return state.autosavePromise;
    }

    state.autosavePromise = (async function () {
      let saved = false;
      do {
        state.autosaveQueued = false;
        const revision = state.autosaveRevision;
        const snapshot = captureEditorDraft();
        saved = await persistEditor({ snapshot: snapshot, revision: revision });
      } while (state.autosaveQueued && state.editorEditable && !elements.modal.hidden);
      return saved;
    })().finally(function () {
      state.autosavePromise = null;
    });

    return state.autosavePromise;
  }

  async function saveList(event) {
    event.preventDefault();
    if (elements.reminder.value && !addReminderFromInput(false)) {
      return;
    }
    if (state.autosavePromise) {
      await state.autosavePromise;
    }

    state.autosaveRevision += 1;
    elements.save.disabled = true;
    const snapshot = captureEditorDraft();
    storeEditorDraft(snapshot, elements.listId.value);
    try {
      await persistEditor({
        snapshot: snapshot,
        revision: state.autosaveRevision,
        manual: true,
        closeAfter: true
      });
    } finally {
      elements.save.disabled = false;
    }
  }

  async function closeEditor() {
    if (state.editorEditable) {
      await queueCheckpointSave();
    }
    closeModal();
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

  async function deleteList(listId) {
    const targetListId = listId || elements.listId.value;
    const list = state.lists.find(function (entry) { return entry.id === targetListId; });
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
    if (elements.listId.value === list.id) {
      closeModal();
    }
    await refreshData();
    showNotice("Job note deleted.");
  }

  async function toggleItem(itemId) {
    const item = state.items.find(function (entry) { return entry.id === itemId; });
    if (!item) {
      return false;
    }
    const list = state.lists.find(function (entry) { return entry.id === item.list_id; });
    if (!list || (list.status !== "open" && !item.completed)) {
      showNotice("Reopen this completed note before changing its items.", "error");
      return false;
    }
    const previousListStatus = list.status;
    const completed = !item.completed;
    item.completed = completed;
    item.completed_at = completed ? new Date().toISOString() : null;
    item.completed_by_name = completed
      ? state.profile && state.profile.display_name || state.worker.display || ""
      : "";
    applyChecklistStatus(list);
    const statusChanged = list.status !== previousListStatus;
    if (!statusChanged || list.status !== "completed") {
      renderCards();
    }
    saveCache();

    if (!state.online) {
      enqueueToggle(item.id, completed);
      updateStatusBadges();
      if (statusChanged) {
        if (list.status === "completed") {
          state.pendingCompletionOnClose = { offline: true };
          setAutosaveStatus("All items checked. Close this note to move it to Completed.", "saved");
        } else {
          state.pendingCompletionOnClose = null;
          closeModal();
          showNotice("Job note reopened and waiting to sync.");
        }
      }
      return statusChanged;
    }

    const result = await state.client.rpc("toggle_job_list_item", {
      p_item_id: item.id,
      p_completed: completed
    });
    if (result.error) {
      item.completed = !completed;
      list.status = previousListStatus;
      renderCards();
      saveCache();
      showNotice(result.error.message || "The item could not be updated.", "error");
      return false;
    }
    const savedItem = Array.isArray(result.data) ? result.data[0] : result.data;
    Object.assign(item, savedItem || {});
    applyChecklistStatus(list);
    saveCache();
    if (!statusChanged || list.status !== "completed") {
      renderCards();
    }
    if (statusChanged) {
      if (list.status === "completed") {
        state.pendingCompletionOnClose = { offline: false };
        setAutosaveStatus("All items checked. Close this note to move it to Completed.", "saved");
      } else {
        state.pendingCompletionOnClose = null;
        closeModal();
        await refreshData();
        showNotice("Job note reopened.");
      }
    }
    return statusChanged;
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
      } else {
        const item = state.items.find(function (candidate) {
          return candidate.id === entry.itemId;
        });
        const savedItem = Array.isArray(result.data) ? result.data[0] : result.data;
        if (item) {
          Object.assign(item, savedItem || { completed: entry.completed });
          applyChecklistStatus(state.lists.find(function (list) {
            return list.id === item.list_id;
          }));
        }
      }
    }
    setToggleQueue(remaining);
    saveCache();
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
        state.client.from("job_list_items").select("*").order("position"),
        state.client.from("job_list_reminders").select("*").order("reminder_at")
      ]);
      const errorResult = results.find(function (result) { return result.error; });
      if (errorResult) {
        throw errorResult.error;
      }
      state.lists = results[0].data || [];
      state.members = results[1].data || [];
      state.items = results[2].data || [];
      state.reminders = results[3].data || [];
      saveCache();
      await flushToggleQueue();
      renderCards();
      updateStatusBadges();
      scheduleReminderExpiryRefresh();
    } catch (error) {
      loadCache();
      renderCards();
      updateStatusBadges();
      scheduleReminderExpiryRefresh();
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
      .on("postgres_changes", { event: "*", schema: "public", table: "job_list_reminders" }, scheduleRefresh)
      .subscribe();
  }

  function addBlankItem() {
    const items = readItemEditor();
    items.push({ item_text: "", completed: false });
    renderItemEditor(items, false);
    queueCheckpointSave();
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
    queueCheckpointSave();
  }

  function insertBlankItemAfter(index) {
    const items = readItemEditor();
    items.splice(index + 1, 0, { item_text: "", completed: false });
    renderItemEditor(items, false);
    queueCheckpointSave();
    const next = elements.itemEditor.querySelector('[data-job-list-item-input="' + (index + 1) + '"]');
    if (next) {
      next.focus();
    }
  }

  async function toggleEditorItem(index) {
    const items = readItemEditor();
    const item = items[index];
    if (!item || !state.editorCanToggle) {
      return;
    }
    if (item.id) {
      const statusChanged = await toggleItem(item.id);
      if (statusChanged && !state.pendingCompletionOnClose) {
        return;
      }
      const current = state.items.find(function (entry) { return entry.id === item.id; });
      item.completed = Boolean(current && current.completed);
      if (statusChanged) {
        renderItemEditor(items, !state.editorEditable);
        setAutosaveStatus("All items checked. Close this note to move it to Completed.", "saved");
        return;
      }
    } else {
      item.completed = !item.completed;
    }
    renderItemEditor(items, !state.editorEditable);
    queueCheckpointSave();
    const input = elements.itemEditor.querySelector('[data-job-list-item-input="' + index + '"]');
    if (input && state.editorEditable) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function handleItemEditorKeydown(event) {
    const input = event.target.closest("[data-job-list-item-input]");
    if (!input || input.disabled) {
      return;
    }
    const index = Number(input.dataset.jobListItemInput);
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      insertBlankItemAfter(index);
      return;
    }
    if (event.key === "Backspace" && !input.value && readItemEditor().length > 1) {
      event.preventDefault();
      const focusIndex = Math.max(0, index - 1);
      const items = readItemEditor();
      items.splice(index, 1);
      renderItemEditor(items, false);
      queueCheckpointSave();
      const previous = elements.itemEditor.querySelector('[data-job-list-item-input="' + focusIndex + '"]');
      if (previous) {
        previous.focus();
        previous.setSelectionRange(previous.value.length, previous.value.length);
      }
    }
  }

  function bindEvents() {
    elements.newButton.addEventListener("click", function () { openModal(""); });
    elements.syncButton.addEventListener("click", refreshData);
    elements.closeButton.addEventListener("click", closeEditor);
    elements.modal.addEventListener("click", function (event) {
      if (event.target === elements.modal) {
        closeEditor();
      }
    });
    elements.form.addEventListener("submit", saveList);
    elements.addItem.addEventListener("click", addBlankItem);
    elements.addReminder.addEventListener("click", addReminderFromInput);
    elements.reminder.addEventListener("change", function () {
      if (elements.reminder.value) {
        addReminderFromInput();
      }
    });
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
      const deleteButton = event.target.closest("[data-job-list-delete]");
      const open = event.target.closest("[data-job-list-open]");
      if (toggle) {
        toggleItem(toggle.dataset.jobListToggle);
      } else if (deleteButton) {
        deleteList(deleteButton.dataset.jobListDelete);
      } else if (open) {
        openModal(open.dataset.jobListOpen);
      }
    });

    elements.itemEditor.addEventListener("click", function (event) {
      const removeButton = event.target.closest("[data-job-list-remove-item]");
      const toggleButton = event.target.closest("[data-job-list-edit-toggle]");
      if (removeButton) {
        removeItem(Number(removeButton.dataset.jobListRemoveItem));
      } else if (toggleButton) {
        toggleEditorItem(Number(toggleButton.dataset.jobListEditToggle));
      }
    });
    elements.itemEditor.addEventListener("keydown", handleItemEditorKeydown);
    elements.itemEditor.addEventListener("input", function (event) {
      if (event.target.matches("[data-job-list-item-input]")) {
        autoSizeItemInput(event.target);
      }
    });
    elements.itemEditor.addEventListener("focusout", function (event) {
      if (event.target.matches("[data-job-list-item-input]")) {
        queueCheckpointSave();
      }
    });
    elements.memberGrid.addEventListener("change", function () {
      renderOptionsSummary();
      queueCheckpointSave();
    });
    elements.title.addEventListener("input", function () {
      elements.modalTitle.textContent = String(elements.title.value || "").trim() || "New Job Note";
    });
    elements.title.addEventListener("blur", queueCheckpointSave);
    elements.job.addEventListener("change", queueCheckpointSave);
    elements.options.addEventListener("toggle", function () {
      if (elements.options.open) {
        queueCheckpointSave();
      }
    });
    elements.reminderChips.addEventListener("click", function (event) {
      const button = event.target.closest("[data-job-list-remove-reminder]");
      if (button) {
        removeReminder(Number(button.dataset.jobListRemoveReminder));
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
        closeEditor();
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
    elements.options = byId("jobListOptions");
    elements.optionsSummary = byId("jobListOptionsSummary");
    elements.form = byId("jobListForm");
    elements.listId = byId("jobListId");
    elements.title = byId("jobListTitle");
    elements.job = byId("jobListJob");
    elements.reminder = byId("jobListReminder");
    elements.addReminder = byId("jobListAddReminder");
    elements.reminderChips = byId("jobListReminderChips");
    elements.memberGrid = byId("jobListMembers");
    elements.itemEditor = byId("jobListItemEditor");
    elements.addItem = byId("jobListAddItem");
    elements.autosaveStatus = byId("jobListAutosaveStatus");
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
    scheduleReminderExpiryRefresh();

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
