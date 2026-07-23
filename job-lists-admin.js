(function () {
  "use strict";

  const state = {
    client: null,
    user: null,
    profile: null,
    worker: null,
    lists: [],
    members: [],
    items: [],
    reminders: [],
    jobs: [],
    tab: "open",
    channel: null,
    refreshTimer: null,
    reminderExpiryTimer: null,
    selectedListId: ""
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
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }
    return new Intl.DateTimeFormat("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function refreshIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
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

  function membersFor(listId) {
    return state.members.filter(function (member) {
      return member.list_id === listId;
    });
  }

  function itemsFor(listId) {
    return state.items
      .filter(function (item) { return item.list_id === listId; })
      .sort(function (a, b) {
        return Number(a.position || 0) - Number(b.position || 0);
      });
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
        sent_at: list.reminder_sent_at || null
      }]
      : [];
  }

  function renderIdentity() {
    const name = state.profile && state.profile.display_name
      || state.worker && state.worker.display
      || state.worker && state.worker.key
      || "";
    elements.currentUser.textContent = name ? "Signed in as: " + name : "";
  }

  function renderJobFilter() {
    const current = elements.job.value;
    const unique = new Map();
    state.lists.forEach(function (list) {
      unique.set(list.job_number, list.job_number + " - " + list.job_name);
    });
    elements.job.innerHTML = '<option value="">All jobs</option>'
      + Array.from(unique.entries()).sort(function (a, b) {
        return a[0].localeCompare(b[0], undefined, { numeric: true });
      }).map(function (entry) {
        return '<option value="' + escapeHtml(entry[0]) + '">' + escapeHtml(entry[1]) + "</option>";
      }).join("");
    if (unique.has(current)) {
      elements.job.value = current;
    }
  }

  function renderStats() {
    const active = state.lists.filter(function (list) { return !list.deleted_at; });
    elements.openCount.textContent = active.filter(function (list) { return list.status === "open"; }).length;
    elements.completedCount.textContent = active.filter(function (list) { return list.status === "completed"; }).length;
    elements.deletedCount.textContent = state.lists.filter(function (list) { return list.deleted_at; }).length;
    const activeIds = new Set(active.filter(function (list) {
      return list.status === "open";
    }).map(function (list) { return list.id; }));
    elements.dueCount.textContent = state.reminders.filter(function (reminder) {
      const reminderTime = new Date(reminder.reminder_at).getTime();
      return activeIds.has(reminder.list_id)
        && !reminder.sent_at
        && !Number.isNaN(reminderTime)
        && reminderTime <= Date.now();
    }).length;
  }

  function listMatchesTab(list) {
    if (state.tab === "deleted") {
      return Boolean(list.deleted_at);
    }
    return !list.deleted_at && list.status === state.tab;
  }

  function renderRows() {
    const query = String(elements.search.value || "").trim().toLowerCase();
    const jobNumber = elements.job.value;
    const visible = state.lists.filter(function (list) {
      if (!listMatchesTab(list) || jobNumber && list.job_number !== jobNumber) {
        return false;
      }
      if (!query) {
        return true;
      }
      const memberText = membersFor(list.id).map(function (member) { return member.display_name; }).join(" ");
      const itemText = itemsFor(list.id).map(function (item) { return item.item_text; }).join(" ");
      return [list.title, list.job_number, list.job_name, list.created_by_name, memberText, itemText]
        .join(" ").toLowerCase().includes(query);
    });

    if (!visible.length) {
      elements.rows.innerHTML = '<tr><td colspan="7" class="jgc-empty-state">No matching job notes found.</td></tr>';
      return;
    }

    elements.rows.innerHTML = visible.map(function (list) {
      const listItems = itemsFor(list.id);
      const done = listItems.filter(function (item) { return item.completed; }).length;
      const members = membersFor(list.id);
      const upcomingReminders = remindersFor(list.id);
      const reminder = upcomingReminders.length
        ? (upcomingReminders.length > 1 ? upcomingReminders.length + " reminders; Next " : "")
          + formatDateTime(upcomingReminders[0].reminder_at)
        : "-";
      return "<tr>"
        + "<td><strong>" + escapeHtml(list.title) + "</strong><small>Created by " + escapeHtml(list.created_by_name) + "</small></td>"
        + "<td><strong>" + escapeHtml(list.job_number) + "</strong><small>" + escapeHtml(list.job_name) + "</small></td>"
        + "<td>" + done + " / " + listItems.length + "</td>"
        + "<td>" + members.length + "</td>"
        + "<td>" + escapeHtml(reminder) + "</td>"
        + "<td>" + escapeHtml(formatDateTime(list.updated_at)) + "</td>"
        + '<td><button class="jgc-button" type="button" data-job-list-admin-view="' + escapeHtml(list.id) + '">View</button></td>'
        + "</tr>";
    }).join("");
  }

  function renderAll() {
    renderStats();
    renderJobFilter();
    renderRows();
    refreshIcons();
  }

  function scheduleReminderExpiryRefresh() {
    window.clearTimeout(state.reminderExpiryTimer);
    const now = Date.now();
    const futureTimes = state.reminders
      .map(function (reminder) { return new Date(reminder.reminder_at).getTime(); })
      .filter(function (reminderTime) {
        return !Number.isNaN(reminderTime) && reminderTime > now;
      })
      .sort(function (a, b) { return a - b; });
    if (!futureTimes.length) {
      return;
    }

    state.reminderExpiryTimer = window.setTimeout(function () {
      renderAll();
      scheduleReminderExpiryRefresh();
    }, Math.min(futureTimes[0] - now + 1000, 2147483647));
  }

  async function openDetails(listId) {
    const list = state.lists.find(function (entry) { return entry.id === listId; });
    if (!list) {
      showNotice("That job note is no longer available.", "error");
      return;
    }
    state.selectedListId = list.id;
    const listItems = itemsFor(list.id);
    const done = listItems.filter(function (item) { return item.completed; }).length;
    const members = membersFor(list.id);
    const reminders = remindersFor(list.id);

    elements.modalTitle.textContent = list.title;
    elements.modalSubtitle.textContent = list.job_number + " - " + list.job_name;
    elements.details.innerHTML = '<div class="job-list-admin-details">'
      + '<div class="job-list-admin-detail"><strong>Status</strong><span>'
      + escapeHtml(list.deleted_at ? "Deleted" : list.status === "completed" ? "Completed" : "Open") + "</span></div>"
      + '<div class="job-list-admin-detail"><strong>Progress</strong><span>' + done + " of " + listItems.length + " complete</span></div>"
      + '<div class="job-list-admin-detail"><strong>Creator</strong><span>' + escapeHtml(list.created_by_name) + "</span></div>"
      + '<div class="job-list-admin-detail"><strong>Last activity</strong><span>' + escapeHtml(formatDateTime(list.updated_at))
      + " by " + escapeHtml(list.last_edited_by_name || list.created_by_name) + "</span></div>"
      + '<div class="job-list-admin-detail"><strong>Reminders</strong><span>'
      + (reminders.length
        ? '<span class="job-list-reminder-list">' + reminders.map(function (reminder) {
          return '<span class="job-list-reminder-chip"><i data-lucide="bell"></i> '
            + escapeHtml(formatDateTime(reminder.reminder_at)) + "</span>";
        }).join("") + "</span>"
        : "None")
      + "</span></div>"
      + '<div class="job-list-admin-detail"><strong>Tagged employees</strong><span>'
      + escapeHtml(members.map(function (member) { return member.display_name; }).join(", ") || "None") + "</span></div>"
      + "</div>"
      + '<section class="jgc-section"><h3 class="jgc-section-title">Items</h3><ul class="job-list-items">'
      + (listItems.length ? listItems.map(function (item) {
        return '<li class="job-list-check ' + (item.completed ? "is-complete" : "") + '">'
          + '<span class="job-list-check-box">' + (item.completed ? "X" : "") + "</span>"
          + '<span class="job-list-check-text">' + escapeHtml(item.item_text) + "</span></li>";
      }).join("") : '<li class="job-list-muted">No items.</li>') + "</ul></section>"
      + '<section class="jgc-section"><h3 class="jgc-section-title">Recent Activity</h3><div id="jobListActivity" class="job-list-muted">Loading activity...</div></section>';

    const actionButtons = [];
    if (!list.deleted_at) {
      actionButtons.push('<a class="jgc-button" href="job-lists.html?list=' + encodeURIComponent(list.id) + '"><i data-lucide="pencil"></i> Manage Note</a>');
      actionButtons.push('<button class="jgc-button" type="button" data-job-list-admin-action="status">'
        + (list.status === "completed" ? '<i data-lucide="rotate-ccw"></i> Reopen' : '<i data-lucide="check-circle"></i> Complete') + "</button>");
      actionButtons.push('<button class="jgc-button jgc-button--danger" type="button" data-job-list-admin-action="delete"><i data-lucide="trash-2"></i> Delete</button>');
    } else {
      actionButtons.push('<button class="jgc-button" type="button" data-job-list-admin-action="restore"><i data-lucide="rotate-ccw"></i> Restore</button>');
      actionButtons.push('<button class="jgc-button jgc-button--danger" type="button" data-job-list-admin-action="permanent"><i data-lucide="trash-2"></i> Delete Permanently</button>');
    }
    elements.actions.innerHTML = actionButtons.join("");
    elements.modal.hidden = false;
    document.body.style.overflow = "hidden";
    refreshIcons();

    const activityResult = await state.client.from("job_list_activity")
      .select("*")
      .eq("list_id", list.id)
      .order("created_at", { ascending: false })
      .limit(30);
    const activityElement = byId("jobListActivity");
    if (!activityElement) {
      return;
    }
    if (activityResult.error) {
      activityElement.textContent = "Activity could not be loaded.";
      return;
    }
    const activity = activityResult.data || [];
    activityElement.innerHTML = activity.length
      ? '<ul class="job-list-activity">' + activity.map(function (entry) {
        return "<li><strong>" + escapeHtml(String(entry.action || "").replace(/_/g, " ")) + "</strong>"
          + "<small>" + escapeHtml(entry.actor_name || "Portal user") + " - " + escapeHtml(formatDateTime(entry.created_at)) + "</small></li>";
      }).join("") + "</ul>"
      : "No activity recorded.";
  }

  function closeModal() {
    elements.modal.hidden = true;
    document.body.style.overflow = "";
    state.selectedListId = "";
  }

  async function runAction(action) {
    const list = state.lists.find(function (entry) { return entry.id === state.selectedListId; });
    if (!list) {
      return;
    }
    let result;
    if (action === "status") {
      result = await state.client.from("job_lists")
        .update({ status: list.status === "completed" ? "open" : "completed" })
        .eq("id", list.id);
    } else if (action === "delete") {
      if (!window.confirm('Delete "' + list.title + '"? It can be restored from the Deleted tab.')) {
        return;
      }
      result = await state.client.from("job_lists")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", list.id);
    } else if (action === "restore") {
      result = await state.client.from("job_lists")
        .update({ deleted_at: null })
        .eq("id", list.id);
    } else if (action === "permanent") {
      const confirmation = window.prompt('Type the note name to permanently delete it:\n' + list.title);
      if (confirmation !== list.title) {
        if (confirmation !== null) {
          showNotice("The note name did not match. Nothing was deleted.", "error");
        }
        return;
      }
      result = await state.client.from("job_lists").delete().eq("id", list.id);
    }
    if (result && result.error) {
      showNotice(result.error.message || "The job note could not be updated.", "error");
      return;
    }
    closeModal();
    await refreshData();
    showNotice(action === "restore"
      ? "Job note restored."
      : action === "permanent"
        ? "Job note permanently deleted."
        : "Job note updated.");
  }

  async function refreshData() {
    elements.refresh.disabled = true;
    showNotice("");
    try {
      const results = await Promise.all([
        state.client.from("job_lists").select("*").order("updated_at", { ascending: false }),
        state.client.from("job_list_members").select("*"),
        state.client.from("job_list_items").select("*").order("position"),
        state.client.from("job_list_reminders").select("*").order("reminder_at")
      ]);
      const failed = results.find(function (result) { return result.error; });
      if (failed) {
        throw failed.error;
      }
      state.lists = results[0].data || [];
      state.members = results[1].data || [];
      state.items = results[2].data || [];
      state.reminders = results[3].data || [];
      renderAll();
      scheduleReminderExpiryRefresh();
    } catch (error) {
      showNotice(error && error.message || "Job Notes could not be loaded.", "error");
    } finally {
      elements.refresh.disabled = false;
    }
  }

  function scheduleRefresh() {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(refreshData, 250);
  }

  function subscribeRealtime() {
    state.channel = state.client.channel("job-lists-admin-" + state.user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_lists" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_list_members" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_list_items" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "job_list_reminders" }, scheduleRefresh)
      .subscribe();
  }

  function bindEvents() {
    elements.refresh.addEventListener("click", refreshData);
    elements.search.addEventListener("input", renderRows);
    elements.job.addEventListener("change", renderRows);
    elements.rows.addEventListener("click", function (event) {
      const button = event.target.closest("[data-job-list-admin-view]");
      if (button) {
        openDetails(button.dataset.jobListAdminView);
      }
    });
    elements.modalClose.addEventListener("click", closeModal);
    elements.modal.addEventListener("click", function (event) {
      if (event.target === elements.modal) {
        closeModal();
      }
    });
    elements.actions.addEventListener("click", function (event) {
      const button = event.target.closest("[data-job-list-admin-action]");
      if (button) {
        runAction(button.dataset.jobListAdminAction);
      }
    });
    document.querySelectorAll("[data-job-list-admin-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.tab = button.dataset.jobListAdminTab;
        document.querySelectorAll("[data-job-list-admin-tab]").forEach(function (tab) {
          tab.classList.toggle("active", tab === button);
        });
        renderRows();
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !elements.modal.hidden) {
        closeModal();
      }
    });
  }

  function collectElements() {
    elements.currentUser = byId("jobListsAdminCurrentUser");
    elements.notice = byId("jobListsAdminNotice");
    elements.refresh = byId("jobListsAdminRefresh");
    elements.openCount = byId("jobListsOpenCount");
    elements.completedCount = byId("jobListsCompletedCount");
    elements.deletedCount = byId("jobListsDeletedCount");
    elements.dueCount = byId("jobListsDueCount");
    elements.search = byId("jobListsAdminSearch");
    elements.job = byId("jobListsAdminJob");
    elements.rows = byId("jobListsAdminRows");
    elements.modal = byId("jobListsAdminModal");
    elements.modalClose = byId("jobListsAdminModalClose");
    elements.modalTitle = byId("jobListsAdminModalTitle");
    elements.modalSubtitle = byId("jobListsAdminModalSubtitle");
    elements.details = byId("jobListsAdminDetails");
    elements.actions = byId("jobListsAdminActions");
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
    const profileResult = await state.client.from("profiles")
      .select("id,email,display_name,worker_key,role,account_status")
      .eq("id", state.user.id)
      .single();
    if (profileResult.error) {
      showNotice(profileResult.error.message, "error");
      return;
    }
    state.profile = profileResult.data;
    if (String(state.profile.role || "").toLowerCase() !== "admin") {
      window.location.href = "home.html";
      return;
    }
    renderIdentity();
    await refreshData();
    subscribeRealtime();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
