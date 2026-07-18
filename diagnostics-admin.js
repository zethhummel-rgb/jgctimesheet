(function() {
  "use strict";

  const state = {
    client: null,
    user: null,
    profile: null,
    events: [],
    view: "issues",
    loading: false
  };
  const elements = {};

  const RECENT_SOURCES = [
    { table: "previous_timesheet_weeks", fields: "id,worker_name,week_label,total_hours,submitted_at", time: "submitted_at", label: "Timesheet", actor: "worker_name", record: "week_label", url: "admin.html?tab=timesheets" },
    { table: "work_orders", fields: "id,wo_number,work_order_date,job_number,job_name,status,created_by_name,created_at,updated_at", time: "updated_at", label: "Work order", actor: "created_by_name", record: "wo_number", url: function(row) { return "work-orders.html?wo=" + encodeURIComponent(row.id); } },
    { table: "digital_purchase_orders", fields: "id,po_number,order_date,job_number,job_name,workflow_status,email_status,creator_name,last_edited_by_name,created_at,updated_at", time: "updated_at", label: "Purchase order", actor: "last_edited_by_name", fallbackActor: "creator_name", record: "po_number", prefix: "PO-", url: function(row) { return "purchase-orders-admin.html?po=" + encodeURIComponent(row.id); } },
    { table: "inspection_records", fields: "id,worker_display_name,worker_name,inspection_type,inspection_date,title,created_at", time: "created_at", label: "Inspection", actor: "worker_display_name", fallbackActor: "worker_name", record: "title", url: "admin.html?tab=inspections" },
    { table: "vehicle_inspection_records", fields: "id,driver_name,inspection_type,inspection_date,vehicle_name,status,created_at,updated_at", time: "updated_at", label: "Vehicle inspection", actor: "driver_name", record: "vehicle_name", url: "admin.html?tab=inspections" },
    { table: "vacation_requests", fields: "id,worker_display_name,worker_name,request_date,start_date,end_date,status,created_at,updated_at", time: "updated_at", label: "Vacation request", actor: "worker_display_name", fallbackActor: "worker_name", record: "start_date", url: "admin.html?tab=vacation" },
    { table: "tasks", fields: "id,title,status,assigned_to_name,created_by_name,created_at,updated_at", time: "updated_at", label: "Task", actor: "created_by_name", record: "title", url: "admin.html?tab=tasks" },
    { table: "daily_site_reports", fields: "id,worker_display_name,worker_name,report_date,project,created_at,updated_at", time: "updated_at", label: "Daily site report", actor: "worker_display_name", fallbackActor: "worker_name", record: "project", url: "admin.html?tab=reports" }
  ];

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function titleCase(value) {
    return String(value || "system")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, function(letter) { return letter.toUpperCase(); });
  }

  function formatDateTime(value) {
    const date = new Date(value || "");
    return Number.isNaN(date.getTime()) ? String(value || "") : date.toLocaleString();
  }

  function showNotice(message, kind) {
    if (!elements.notice) return;
    elements.notice.hidden = !message;
    elements.notice.textContent = message || "";
    elements.notice.className = "diagnostics-notice jgc-notice" + (kind === "error" ? " error jgc-notice--danger" : "");
  }

  function updateIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function readLocalJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function normalizeEvent(event) {
    const value = event || {};
    return {
      id: String(value.id || ""),
      occurred_at: value.occurred_at || value.created_at || new Date().toISOString(),
      created_at: value.created_at || value.occurred_at || new Date().toISOString(),
      severity: ["error", "warning", "info"].includes(value.severity) ? value.severity : "info",
      category: value.category || "system",
      event_type: value.event_type || "portal_event",
      source: value.source || "portal",
      message: value.message || "Portal event",
      details: value.details && typeof value.details === "object" ? value.details : {},
      actor_name: value.actor_name || "",
      page_url: value.page_url || "",
      record_table: value.record_table || "",
      record_id: value.record_id || "",
      related_url: value.related_url || "",
      resolved_at: value.resolved_at || null,
      central: value.central !== false
    };
  }

  async function loadCentralEvents() {
    const result = await state.client
      .from("portal_diagnostics")
      .select("id,created_at,occurred_at,severity,category,event_type,source,message,details,actor_name,page_url,record_table,record_id,related_url,resolved_at,resolved_by")
      .order("occurred_at", { ascending: false })
      .limit(1000);
    if (result.error) throw result.error;
    return (result.data || []).map(normalizeEvent);
  }

  async function loadPoFailures() {
    const result = await state.client
      .from("digital_purchase_orders")
      .select("id,po_number,order_date,job_number,job_name,supplier_name,workflow_status,email_status,receipt_status,email_last_error,pdf_storage_path,creator_name,submitted_by_name,updated_at")
      .order("updated_at", { ascending: false })
      .limit(400);
    if (result.error) throw result.error;

    const events = [];
    (result.data || []).forEach(function(po) {
      const label = "PO-" + po.po_number;
      const relatedUrl = "purchase-orders-admin.html?po=" + encodeURIComponent(po.id);
      if (po.email_status === "failed") {
        events.push(normalizeEvent({
          id: "po-email:" + po.id,
          occurred_at: po.updated_at,
          severity: "error",
          category: "email",
          event_type: "digital_po_email_failed",
          source: "digital_purchase_orders",
          message: label + " email delivery failed",
          actor_name: po.submitted_by_name || po.creator_name,
          record_table: "digital_purchase_orders",
          record_id: po.id,
          related_url: relatedUrl,
          details: { error: po.email_last_error || "No delivery error was saved.", job_number: po.job_number, job_name: po.job_name, supplier: po.supplier_name },
          central: false
        }));
      }
      if (po.receipt_status === "cleanup_failed") {
        events.push(normalizeEvent({
          id: "po-cleanup:" + po.id,
          occurred_at: po.updated_at,
          severity: "error",
          category: "storage",
          event_type: "digital_po_storage_cleanup_failed",
          source: "digital_purchase_orders",
          message: label + " temporary storage cleanup failed",
          actor_name: po.submitted_by_name || po.creator_name,
          record_table: "digital_purchase_orders",
          record_id: po.id,
          related_url: relatedUrl,
          details: { job_number: po.job_number, job_name: po.job_name, supplier: po.supplier_name },
          central: false
        }));
      }
      if (po.workflow_status === "submitted" && !po.pdf_storage_path && !["not_ready", "cancelled"].includes(po.email_status)) {
        events.push(normalizeEvent({
          id: "po-pdf:" + po.id,
          occurred_at: po.updated_at,
          severity: "error",
          category: "pdf",
          event_type: "digital_po_pdf_missing",
          source: "digital_purchase_orders",
          message: label + " is submitted without a stored PDF",
          actor_name: po.submitted_by_name || po.creator_name,
          record_table: "digital_purchase_orders",
          record_id: po.id,
          related_url: relatedUrl,
          details: { email_status: po.email_status, job_number: po.job_number, job_name: po.job_name },
          central: false
        }));
      }
    });
    return events;
  }

  async function loadGoogleSyncFailures() {
    const result = await state.client
      .from("vacation_requests")
      .select("id,worker_display_name,worker_name,start_date,end_date,google_sync_status,google_sync_error,updated_at,created_at")
      .not("google_sync_error", "is", null)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (result.error) throw result.error;
    return (result.data || []).filter(function(item) {
      return String(item.google_sync_error || "").trim();
    }).map(function(item) {
      return normalizeEvent({
        id: "vacation-sync:" + item.id,
        occurred_at: item.updated_at || item.created_at,
        severity: "error",
        category: "sync",
        event_type: "vacation_google_sync_failed",
        source: "vacation_requests",
        message: "Vacation calendar sync failed for " + (item.worker_display_name || item.worker_name || "employee"),
        actor_name: item.worker_display_name || item.worker_name,
        record_table: "vacation_requests",
        record_id: item.id,
        related_url: "admin.html?tab=vacation",
        details: { error: item.google_sync_error, start_date: item.start_date, end_date: item.end_date, status: item.google_sync_status },
        central: false
      });
    });
  }

  async function loadRecentSaveFallbacks() {
    const settled = await Promise.allSettled(RECENT_SOURCES.map(function(config) {
      return state.client.from(config.table).select(config.fields).order(config.time, { ascending: false }).limit(20);
    }));
    const events = [];
    settled.forEach(function(result, index) {
      const config = RECENT_SOURCES[index];
      if (result.status !== "fulfilled" || result.value.error) {
        console.warn("Recent diagnostics source could not load: " + config.table, result.status === "fulfilled" ? result.value.error : result.reason);
        return;
      }
      (result.value.data || []).forEach(function(row) {
        const recordValue = row[config.record];
        const recordLabel = config.prefix ? config.prefix + recordValue : recordValue;
        const actor = row[config.actor] || row[config.fallbackActor] || "";
        const relatedUrl = typeof config.url === "function" ? config.url(row) : config.url;
        events.push(normalizeEvent({
          id: "live-save:" + config.table + ":" + row.id,
          occurred_at: row[config.time],
          severity: "info",
          category: "save",
          event_type: config.table + "_recent",
          source: config.table,
          message: config.label + " saved" + (recordLabel ? ": " + recordLabel : ""),
          actor_name: actor,
          record_table: config.table,
          record_id: row.id,
          related_url: relatedUrl,
          details: row,
          central: false
        }));
      });
    });
    return events;
  }

  function loadLocalEvents() {
    const events = [];
    const queue = readLocalJson("jgcDiagnosticsQueue", []);
    (Array.isArray(queue) ? queue : []).forEach(function(item) {
      events.push(normalizeEvent(Object.assign({}, item, {
        id: "local-queue:" + (item.client_event_id || item.id || Math.random()),
        source: (item.source || "portal") + " (this device, waiting to sync)",
        central: false
      })));
    });

    const backups = readLocalJson("jgcBackupHistory", []);
    (Array.isArray(backups) ? backups : []).forEach(function(item, index) {
      const status = String(item.status || item.supabase || "Unknown");
      const failed = /fail|unverified|not ready/i.test(status);
      events.push(normalizeEvent({
        id: "local-backup:" + index + ":" + (item.fileName || "backup"),
        occurred_at: item.inspectedAt || item.createdAt || new Date(0).toISOString(),
        severity: failed ? "error" : "info",
        category: "backup",
        event_type: "backup_inspected_local",
        source: "This browser",
        message: "Backup inspection " + status + ": " + (item.fileName || "backup"),
        details: item,
        central: false
      }));
    });

    if (typeof window.getJgcSyncState === "function") {
      const syncStates = window.getJgcSyncState();
      Object.keys(syncStates || {}).forEach(function(source) {
        const item = syncStates[source] || {};
        if (item.status !== "error" && !item.pending) return;
        events.push(normalizeEvent({
          id: "local-sync:" + source,
          occurred_at: item.updatedAt,
          severity: item.status === "error" ? "error" : "warning",
          category: "sync",
          event_type: "local_sync_state",
          source: source + " (this device)",
          message: item.message || (item.pending + " items waiting to sync"),
          details: item,
          central: false
        }));
      });
    }
    return events;
  }

  function dedupeEvents(events) {
    const exact = new Set();
    const centralRecords = new Set(events.filter(function(item) {
      return item.central && item.category === "save" && item.record_table && item.record_id;
    }).map(function(item) {
      return item.record_table + ":" + item.record_id;
    }));
    return events.filter(function(item) {
      if (!item.central && item.category === "save" && centralRecords.has(item.record_table + ":" + item.record_id)) {
        return false;
      }
      const key = [item.id, item.category, item.event_type, item.record_table, item.record_id, item.message].join("|");
      if (exact.has(key)) return false;
      exact.add(key);
      return true;
    }).sort(function(a, b) {
      return new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
    });
  }

  async function loadData() {
    if (state.loading) return;
    state.loading = true;
    elements.refreshButton.disabled = true;
    showNotice("Loading diagnostics...");
    try {
      if (typeof window.flushJgcDiagnostics === "function") {
        await window.flushJgcDiagnostics();
      }
      const results = await Promise.allSettled([
        loadCentralEvents(),
        loadPoFailures(),
        loadGoogleSyncFailures(),
        loadRecentSaveFallbacks()
      ]);
      const events = loadLocalEvents();
      const labels = ["central diagnostics", "purchase order failures", "calendar sync failures", "recent saves"];
      results.forEach(function(result, index) {
        if (result.status === "fulfilled") {
          events.push.apply(events, result.value || []);
        } else {
          console.warn("Could not load " + labels[index] + ".", result.reason);
          if (typeof window.logJgcDiagnostic === "function") {
            window.logJgcDiagnostic({
              severity: "error",
              category: "admin",
              event_type: "diagnostics_source_load_failed",
              source: "diagnostics-admin",
              message: "Could not load " + labels[index] + ".",
              details: { error: result.reason && result.reason.message || String(result.reason || "") }
            });
          }
        }
      });
      state.events = dedupeEvents(events);
      elements.updatedAt.textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      showNotice("");
      render();
    } catch (error) {
      showNotice(error.message || "Diagnostics could not be loaded.", "error");
    } finally {
      state.loading = false;
      elements.refreshButton.disabled = false;
    }
  }

  function viewMatches(event) {
    if (state.view === "issues") return event.severity !== "info" && !event.resolved_at;
    if (state.view === "activity") return event.category === "save";
    if (state.view === "backups") return event.category === "backup";
    return true;
  }

  function filteredEvents() {
    const search = String(elements.search.value || "").trim().toLowerCase();
    const category = elements.category.value;
    const severity = elements.severity.value;
    const status = elements.status.value;
    const days = Number(elements.date.value || 7);
    const cutoff = Date.now() - days * 86400000;
    return state.events.filter(function(event) {
      const haystack = [event.message, event.actor_name, event.source, event.page_url, event.record_table, event.record_id, JSON.stringify(event.details || {})].join(" ").toLowerCase();
      const occurred = new Date(event.occurred_at).getTime();
      return viewMatches(event)
        && (!search || haystack.includes(search))
        && (!category || event.category === category)
        && (!severity || event.severity === severity)
        && (!status || (status === "resolved" ? Boolean(event.resolved_at) : !event.resolved_at))
        && (!Number.isFinite(occurred) || occurred >= cutoff);
    });
  }

  function renderSummary() {
    const openIssues = state.events.filter(function(item) { return item.severity !== "info" && !item.resolved_at; });
    const syncFailures = openIssues.filter(function(item) { return item.category === "sync"; }).length;
    const deliveryFailures = openIssues.filter(function(item) { return item.category === "email" || item.category === "pdf"; }).length;
    const storageFailures = openIssues.filter(function(item) { return item.category === "storage"; }).length;
    const latestBackup = state.events.find(function(item) { return item.category === "backup"; });
    const latestFailed = latestBackup && latestBackup.severity === "error";
    elements.summary.innerHTML = [
      '<div class="diagnostics-metric ' + (openIssues.length ? "error" : "") + '"><strong>' + openIssues.length + '</strong><span>Open issues</span></div>',
      '<div class="diagnostics-metric ' + (syncFailures ? "warning" : "") + '"><strong>' + syncFailures + '</strong><span>Failed or waiting syncs</span></div>',
      '<div class="diagnostics-metric ' + (deliveryFailures ? "error" : "") + '"><strong>' + deliveryFailures + '</strong><span>Email / PDF failures</span></div>',
      '<div class="diagnostics-metric ' + (storageFailures ? "error" : "") + '"><strong>' + storageFailures + '</strong><span>Storage-link / cleanup errors</span></div>',
      '<div class="diagnostics-metric ' + (latestFailed ? "error" : "") + '"><strong>' + (latestBackup ? escapeHtml(latestBackup.severity === "error" ? "Failed" : "OK") : "-") + '</strong><span>' + (latestBackup ? "Latest backup: " + escapeHtml(formatDateTime(latestBackup.occurred_at)) : "No backup result recorded") + '</span></div>'
    ].join("");
  }

  function renderRow(event) {
    const details = event.details && Object.keys(event.details).length
      ? '<details class="diagnostics-details"><summary>Details</summary><pre>' + escapeHtml(JSON.stringify(event.details, null, 2)) + '</pre></details>'
      : "";
    const statusClass = event.resolved_at ? "resolved" : event.severity;
    const statusText = event.resolved_at ? "Resolved" : titleCase(event.severity);
    const source = [event.actor_name, event.source].filter(Boolean).map(escapeHtml).join('<br><span class="diagnostics-source">') + (event.actor_name && event.source ? "</span>" : "");
    const actions = [];
    if (event.related_url) {
      actions.push('<a class="jgc-button" href="' + escapeHtml(event.related_url) + '"><i data-lucide="external-link"></i> Open</a>');
    }
    if (event.central && event.severity !== "info") {
      actions.push('<button class="jgc-button jgc-button--secondary" type="button" data-resolve-id="' + escapeHtml(event.id) + '" data-resolve-value="' + (event.resolved_at ? "open" : "resolved") + '"><i data-lucide="' + (event.resolved_at ? "rotate-ccw" : "check") + '"></i> ' + (event.resolved_at ? "Reopen" : "Resolve") + '</button>');
    }
    return '<tr class="is-' + escapeHtml(event.severity) + '">' +
      '<td data-label="When">' + escapeHtml(formatDateTime(event.occurred_at)) + '</td>' +
      '<td data-label="Category"><span class="diagnostics-category">' + escapeHtml(titleCase(event.category)) + '</span></td>' +
      '<td data-label="Event"><div class="diagnostics-event-title">' + escapeHtml(event.message) + '</div><div class="diagnostics-event-meta">' + escapeHtml(titleCase(event.event_type)) + (event.page_url ? " | " + escapeHtml(event.page_url) : "") + '</div>' + details + '</td>' +
      '<td data-label="Employee / Source">' + (source || "-") + '</td>' +
      '<td data-label="Status"><span class="diagnostics-badge ' + escapeHtml(statusClass) + '">' + escapeHtml(statusText) + '</span></td>' +
      '<td data-label="Actions"><div class="diagnostics-actions">' + actions.join("") + '</div></td>' +
      '</tr>';
  }

  function render() {
    renderSummary();
    const events = filteredEvents();
    elements.body.innerHTML = events.map(renderRow).join("");
    elements.empty.hidden = events.length > 0;
    elements.body.closest("table").hidden = events.length === 0;
    updateIcons();
  }

  async function setResolved(id, nextValue) {
    const values = nextValue === "resolved"
      ? { resolved_at: new Date().toISOString(), resolved_by: state.user.id }
      : { resolved_at: null, resolved_by: null };
    const result = await state.client.from("portal_diagnostics").update(values).eq("id", id);
    if (result.error) throw result.error;
    const item = state.events.find(function(event) { return event.id === id; });
    if (item) {
      item.resolved_at = values.resolved_at;
    }
    render();
  }

  function bindEvents() {
    elements.refreshButton.addEventListener("click", loadData);
    [elements.search, elements.category, elements.severity, elements.status, elements.date].forEach(function(input) {
      input.addEventListener(input.tagName === "INPUT" ? "input" : "change", render);
    });
    document.querySelectorAll("[data-diagnostics-view]").forEach(function(button) {
      button.addEventListener("click", function() {
        state.view = button.dataset.diagnosticsView;
        document.querySelectorAll("[data-diagnostics-view]").forEach(function(item) {
          const active = item === button;
          item.classList.toggle("active", active);
          item.classList.toggle("secondary", !active);
        });
        elements.status.value = state.view === "issues" ? "open" : "";
        render();
      });
    });
    elements.body.addEventListener("click", function(event) {
      const button = event.target.closest("[data-resolve-id]");
      if (!button) return;
      button.disabled = true;
      setResolved(button.dataset.resolveId, button.dataset.resolveValue).catch(function(error) {
        showNotice(error.message || "The diagnostic status could not be changed.", "error");
      }).finally(function() {
        button.disabled = false;
      });
    });
  }

  function captureElements() {
    Object.assign(elements, {
      currentUser: byId("diagnosticsCurrentUser"),
      notice: byId("diagnosticsNotice"),
      refreshButton: byId("diagnosticsRefreshButton"),
      updatedAt: byId("diagnosticsUpdatedAt"),
      summary: byId("diagnosticsSummary"),
      search: byId("diagnosticsSearch"),
      category: byId("diagnosticsCategory"),
      severity: byId("diagnosticsSeverity"),
      status: byId("diagnosticsStatus"),
      date: byId("diagnosticsDate"),
      body: byId("diagnosticsBody"),
      empty: byId("diagnosticsEmpty")
    });
  }

  async function initialize() {
    captureElements();
    bindEvents();
    updateIcons();
    state.client = createJgcSupabaseClient();
    if (!state.client) {
      showNotice("Supabase is not available.", "error");
      return;
    }
    try {
      const sessionResult = await state.client.auth.getSession();
      state.user = sessionResult.data && sessionResult.data.session ? sessionResult.data.session.user : null;
      if (!state.user) {
        window.location.href = "index.html";
        return;
      }
      const profileResult = await state.client
        .from("profiles")
        .select("id,email,display_name,role,account_status")
        .eq("id", state.user.id)
        .single();
      if (profileResult.error || !profileResult.data || profileResult.data.role !== "admin" || profileResult.data.account_status !== "approved") {
        alert("Portal Diagnostics is only available to approved administrators.");
        window.location.href = "home.html";
        return;
      }
      state.profile = profileResult.data;
      elements.currentUser.textContent = "Signed in as: " + (state.profile.display_name || state.profile.email || "Administrator");
      await loadData();
    } catch (error) {
      showNotice(error.message || "Portal Diagnostics could not be loaded.", "error");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
