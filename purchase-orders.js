(function() {
  "use strict";

  const DB_NAME = "jgc-digital-purchase-orders";
  const DB_VERSION = 1;
  const META_STORE = "meta";
  const DRAFT_STORE = "drafts";
  const RECEIPT_STORE = "receipts";
  const TEMP_BUCKET = "digital-po-temp";
  const EDITABLE_STATUSES = new Set(["draft", "assigned", "opened", "ready_to_submit"]);

  const state = {
    db: null,
    client: null,
    worker: null,
    user: null,
    profile: null,
    deviceToken: "",
    deviceContext: null,
    jobs: [],
    workers: [],
    serverRecords: [],
    drafts: [],
    activeId: "",
    listTab: "all",
    pendingReceipt: null,
    receiptPreviewUrl: "",
    syncing: false,
    initialized: false
  };

  const elements = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeText(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : value;
  }

  function localDateValue() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = {};
    parts.forEach((part) => { values[part.type] = part.value; });
    return values.year + "-" + values.month + "-" + values.day;
  }

  function formatDate(value) {
    if (!value) {
      return "";
    }
    const parts = String(value).split("-").map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
      return String(value);
    }
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    }).format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12)));
  }

  function formatDateTime(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Toronto"
    }).format(date);
  }

  function formatPoNumber(value) {
    if (window.JgcPurchaseOrderPdf) {
      return window.JgcPurchaseOrderPdf.formatPoNumber(value);
    }
    return value ? "PO-" + String(value).replace(/^PO-/i, "") : "PO-PENDING";
  }

  function statusLabel(value) {
    const labels = {
      draft: "Draft",
      assigned: "Assigned",
      opened: "Opened",
      ready_to_submit: "Ready to Submit",
      submitted: "Submitted",
      partially_received: "Partially Received",
      fully_received: "Fully Received",
      closed: "Closed",
      cancelled: "Cancelled",
      pending: "Email Pending",
      sending: "Email Sending",
      emailed: "Emailed",
      failed: "Email Failed",
      not_ready: "Not Submitted",
      pending_sync: "Pending Sync",
      offline_draft: "Offline Draft"
    };
    return labels[value] || String(value || "Draft").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function showNotice(message, kind) {
    elements.notice.textContent = message || "";
    elements.notice.className = "po-notice" + (kind ? " " + kind : "");
    elements.notice.hidden = !message;
  }

  function updateIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
  }

  function transactionToPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was cancelled."));
    });
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(DRAFT_STORE)) {
          const drafts = db.createObjectStore(DRAFT_STORE, { keyPath: "id" });
          drafts.createIndex("updated_local_at", "updated_local_at");
        }
        if (!db.objectStoreNames.contains(RECEIPT_STORE)) {
          db.createObjectStore(RECEIPT_STORE, { keyPath: "po_id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Offline PO storage could not be opened."));
    });
  }

  async function idbGet(storeName, key) {
    const transaction = state.db.transaction(storeName, "readonly");
    return requestToPromise(transaction.objectStore(storeName).get(key));
  }

  async function idbGetAll(storeName) {
    const transaction = state.db.transaction(storeName, "readonly");
    return requestToPromise(transaction.objectStore(storeName).getAll());
  }

  async function idbPut(storeName, value) {
    const transaction = state.db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    await transactionToPromise(transaction);
    return value;
  }

  async function idbDelete(storeName, key) {
    const transaction = state.db.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).delete(key);
    await transactionToPromise(transaction);
  }

  async function getMeta(key, fallback) {
    const record = await idbGet(META_STORE, key);
    return record ? record.value : fallback;
  }

  async function setMeta(key, value) {
    await idbPut(META_STORE, { key, value });
    return value;
  }

  async function getOrCreateDeviceToken() {
    let token = await getMeta("device_token", "");
    if (!token) {
      token = crypto.randomUUID();
      await setMeta("device_token", token);
    }
    return token;
  }

  function cacheKeyForUser(name) {
    const id = state.user && state.user.id ? state.user.id : "anonymous";
    return name + ":" + id;
  }

  async function loadOfflineState() {
    state.profile = await getMeta(cacheKeyForUser("profile"), null);
    state.jobs = await getMeta("cache:jobs", []);
    state.workers = await getMeta("cache:po-workers", []);
    state.deviceContext = await getMeta(cacheKeyForUser("device_context"), null);
    state.serverRecords = await getMeta(cacheKeyForUser("server_records"), []);
    state.drafts = await idbGetAll(DRAFT_STORE);
  }

  function mergeDeviceContext(serverContext) {
    if (!serverContext || !serverContext.registered) {
      return serverContext;
    }
    const local = state.deviceContext && state.deviceContext.device_id === serverContext.device_id
      ? state.deviceContext
      : null;
    const localBlocks = new Map(((local && local.blocks) || []).map((block) => [block.id, block]));
    serverContext.blocks = (serverContext.blocks || []).map((block) => {
      const cached = localBlocks.get(block.id);
      const nextNumber = Math.max(Number(block.next_number || block.range_start), Number(cached && cached.next_number || 0));
      return Object.assign({}, block, {
        next_number: nextNumber,
        remaining: Math.max(Number(block.range_end) - nextNumber + 1, 0)
      });
    });
    return serverContext;
  }

  async function loadProfileOnline() {
    const result = await state.client
      .from("profiles")
      .select("id,email,display_name,worker_key,role,account_status,can_create_digital_pos")
      .eq("id", state.user.id)
      .single();
    if (result.error) {
      throw result.error;
    }
    state.profile = result.data;
    await setMeta(cacheKeyForUser("profile"), state.profile);
    renderIdentity();
  }

  function renderIdentity() {
    elements.currentUser.textContent = "Signed in as: " + (state.profile && state.profile.display_name || state.worker.display || state.worker.key || "");
  }

  async function loadReferencesOnline() {
    const results = await Promise.all([
      state.client.from("jobs").select("id,job_number,job_name,active").eq("active", true).order("job_number"),
      state.client.from("work_order_labour_workers").select("id,profile_id,display_name,worker_key,approved").eq("approved", true).order("display_name")
    ]);

    if (!results[0].error) {
      state.jobs = results[0].data || [];
      await setMeta("cache:jobs", state.jobs);
    }
    if (!results[1].error) {
      state.workers = (results[1].data || []).filter((worker) => worker.profile_id);
      await setMeta("cache:po-workers", state.workers);
    }
  }

  async function refreshDeviceContext() {
    if (!navigator.onLine || !state.profile || !state.profile.can_create_digital_pos) {
      renderDeviceState();
      return;
    }
    const result = await state.client.rpc("digital_po_get_device_context", {
      p_device_token: state.deviceToken
    });
    if (result.error) {
      throw result.error;
    }
    state.deviceContext = mergeDeviceContext(result.data);
    await setMeta(cacheKeyForUser("device_context"), state.deviceContext);
    renderDeviceState();
  }

  async function registerDevice() {
    if (!navigator.onLine) {
      showNotice("Connect to the internet to register this device.", "warning");
      return;
    }
    elements.registerDeviceButton.disabled = true;
    try {
      const label = [navigator.platform || "Portal", navigator.userAgent.includes("Mobile") ? "mobile" : "computer"].join(" - ");
      const result = await state.client.rpc("digital_po_register_device", {
        p_device_token: state.deviceToken,
        p_device_label: label
      });
      if (result.error) {
        throw result.error;
      }
      await refreshDeviceContext();
      showNotice("This device is awaiting an admin number block.", "warning");
    } catch (error) {
      showNotice(error.message || "Device registration failed.", "error");
    } finally {
      elements.registerDeviceButton.disabled = false;
    }
  }

  function deviceCanCreate() {
    const context = state.deviceContext;
    if (!state.profile || !state.profile.can_create_digital_pos || !context || !context.registered) {
      return false;
    }
    if (context.device_status !== "active" || !context.lease_expires_at || new Date(context.lease_expires_at) <= new Date()) {
      return false;
    }
    return (context.blocks || []).some((block) =>
      block.status === "active" && Number(block.next_number) <= Number(block.range_end)
    );
  }

  function renderDeviceState() {
    const profileCanCreate = Boolean(state.profile && state.profile.can_create_digital_pos);
    const context = state.deviceContext;
    elements.newButton.disabled = !deviceCanCreate();
    elements.devicePanel.hidden = true;
    elements.rangeBadge.hidden = true;

    if (!profileCanCreate) {
      return;
    }

    if (!context || !context.registered) {
      elements.devicePanel.hidden = false;
      elements.deviceTitle.textContent = "Register this PO device";
      elements.deviceMessage.textContent = "An admin will assign its PO number block after registration.";
      elements.registerDeviceButton.hidden = false;
      return;
    }

    if (context.device_status === "pending") {
      elements.devicePanel.hidden = false;
      elements.deviceTitle.textContent = "Device approval pending";
      elements.deviceMessage.textContent = "Waiting for an admin to assign a PO number block.";
      elements.registerDeviceButton.hidden = true;
      return;
    }

    if (context.device_status === "revoked") {
      elements.devicePanel.hidden = false;
      elements.deviceTitle.textContent = "PO device revoked";
      elements.deviceMessage.textContent = "This device cannot issue new PO numbers.";
      elements.registerDeviceButton.hidden = true;
      return;
    }

    const leaseExpired = !context.lease_expires_at || new Date(context.lease_expires_at) <= new Date();
    const remaining = (context.blocks || []).reduce((total, block) => total + Math.max(Number(block.range_end) - Number(block.next_number) + 1, 0), 0);
    elements.rangeBadge.hidden = false;
    elements.rangeBadge.textContent = remaining + " PO number" + (remaining === 1 ? "" : "s") + " available";
    elements.rangeBadge.className = "po-badge " + (remaining <= 25 ? "warning" : "green");

    if (leaseExpired || remaining === 0) {
      elements.devicePanel.hidden = false;
      elements.deviceTitle.textContent = leaseExpired ? "Offline authorization expired" : "PO number block exhausted";
      elements.deviceMessage.textContent = leaseExpired
        ? "Connect and refresh this device before issuing another PO."
        : "An admin must assign another PO number block.";
      elements.registerDeviceButton.hidden = true;
    }
  }

  async function loadServerRecords() {
    if (!navigator.onLine) {
      return;
    }
    const poResult = await state.client
      .from("digital_purchase_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (poResult.error) {
      throw poResult.error;
    }

    const records = poResult.data || [];
    const ids = records.map((record) => record.id);
    let items = [];
    if (ids.length) {
      const itemResult = await state.client
        .from("digital_po_items")
        .select("*")
        .in("po_id", ids)
        .order("sort_order");
      if (itemResult.error) {
        throw itemResult.error;
      }
      items = itemResult.data || [];
    }

    state.serverRecords = records.map((record) => Object.assign({}, record, {
      items: items.filter((item) => item.po_id === record.id)
    }));
    await setMeta(cacheKeyForUser("server_records"), state.serverRecords);

    for (const record of state.serverRecords) {
      if (record.receipt_status === "deleted") {
        await idbDelete(RECEIPT_STORE, record.id).catch(() => {});
      }
    }
  }

  function getDraft(id) {
    return state.drafts.find((draft) => draft.id === id) || null;
  }

  function getServerRecord(id) {
    return state.serverRecords.find((record) => record.id === id) || null;
  }

  function getCombinedRecords() {
    const records = new Map();
    state.serverRecords.forEach((record) => records.set(record.id, {
      id: record.id,
      po: record,
      items: record.items || [],
      dirty: false,
      pending_submit: false,
      pending_cancel: false,
      source: "server"
    }));
    state.drafts.forEach((draft) => {
      const server = records.get(draft.id);
      if (draft.dirty || draft.pending_submit || draft.pending_cancel || !server) {
        records.set(draft.id, Object.assign({}, draft, { source: "local" }));
      }
    });
    return Array.from(records.values()).sort((a, b) => {
      const aTime = new Date(a.po.updated_at || a.updated_local_at || a.po.client_created_at || 0).getTime();
      const bTime = new Date(b.po.updated_at || b.updated_local_at || b.po.client_created_at || 0).getTime();
      return bTime - aTime;
    });
  }

  function compositeStatus(record) {
    if (record.pending_cancel) {
      return "pending_sync";
    }
    if (record.pending_submit || record.dirty) {
      return navigator.onLine ? "pending_sync" : "offline_draft";
    }
    if (record.po.email_status === "failed" || record.po.email_status === "emailed") {
      return record.po.email_status;
    }
    return record.po.workflow_status || "draft";
  }

  function renderList() {
    const search = elements.search.value.trim().toLowerCase();
    const status = elements.statusFilter.value;
    const profileId = state.user && state.user.id;
    const records = getCombinedRecords().filter((record) => {
      const po = record.po;
      const inTab = state.listTab === "assigned"
        ? po.assigned_profile_id === profileId
        : po.creator_profile_id === profileId;
      const currentStatus = compositeStatus(record);
      const haystack = [
        formatPoNumber(po.po_number),
        po.supplier_name,
        po.job_number,
        po.job_name,
        po.creator_name,
        po.assigned_name,
        currentStatus
      ].join(" ").toLowerCase();
      return inTab && (!search || haystack.includes(search)) && (!status || currentStatus === status || po.workflow_status === status);
    });

    if (!records.length) {
      elements.list.innerHTML = '<div class="po-list-empty">No purchase orders found.</div>';
      return;
    }

    elements.list.innerHTML = records.map((record) => {
      const po = record.po;
      const currentStatus = compositeStatus(record);
      const cssClass = po.workflow_status === "cancelled" ? "cancelled" : (record.dirty || record.pending_submit ? "pending" : "");
      const itemCount = (record.items || []).length;
      return `
        <article class="po-record ${cssClass}">
          <div class="po-record-header">
            <div>
              <div class="po-record-number">${escapeText(formatPoNumber(po.po_number))}</div>
              <div class="po-record-title">${escapeText(po.supplier_name || "Supplier not entered")}</div>
            </div>
            <span class="po-badge ${currentStatus === "failed" || currentStatus === "cancelled" ? "danger" : (currentStatus === "pending_sync" || currentStatus === "offline_draft" ? "warning" : "green")}">${escapeText(statusLabel(currentStatus))}</span>
          </div>
          <div class="po-record-meta">
            <span><strong>Job:</strong> ${escapeText([po.job_number, po.job_name].filter(Boolean).join(" - "))}</span>
            <span><strong>Date:</strong> ${escapeText(formatDate(po.order_date))}</span>
            <span><strong>Created by:</strong> ${escapeText(po.creator_name || "")}</span>
            <span><strong>Assigned to:</strong> ${escapeText(po.assigned_name || "Not assigned")}</span>
            <span><strong>Materials:</strong> ${itemCount} ${po.receipt_attached ? " | Receipt attached" : ""}</span>
          </div>
          <div class="po-record-actions">
            <button type="button" data-po-open="${escapeText(record.id)}"><i data-lucide="folder-open"></i> Open</button>
            <button type="button" class="secondary" data-po-pdf="${escapeText(record.id)}"><i data-lucide="file-text"></i> PDF</button>
          </div>
        </article>
      `;
    }).join("");
    updateIcons();
  }

  function renderReferenceOptions() {
    const currentJob = elements.job.value;
    elements.job.innerHTML = '<option value="">Select job</option>' + state.jobs.map((job) =>
      `<option value="${escapeText(job.id)}">${escapeText(job.job_number + " - " + job.job_name)}</option>`
    ).join("");
    elements.job.value = currentJob;

    const currentAssigned = elements.assignedTo.value;
    elements.assignedTo.innerHTML = '<option value="">Not assigned</option>' + state.workers.map((worker) =>
      `<option value="${escapeText(worker.profile_id)}">${escapeText(worker.display_name || worker.worker_key)}</option>`
    ).join("");
    elements.assignedTo.value = currentAssigned;
  }

  function addMaterialRow(item) {
    const isBlankRow = !item || Object.keys(item).length === 0;
    const row = document.createElement("div");
    row.className = "po-material-tile";
    row.dataset.itemId = item && item.id ? item.id : crypto.randomUUID();
    row.innerHTML = `
      <div>
        <label>Qty Ordered</label>
        <input data-item-field="quantity_ordered" type="number" min="0" step="0.001" inputmode="decimal" autocomplete="off" value="${escapeText(item && item.quantity_ordered !== null && item.quantity_ordered !== undefined ? item.quantity_ordered : "")}">
      </div>
      <div class="description">
        <label>Material Description</label>
        <input data-item-field="description" maxlength="1000" autocomplete="off" value="${escapeText(item && item.description || "")}">
      </div>
      <div class="remove-wrap">
        <button class="icon-button danger" type="button" data-remove-item title="Remove material row" aria-label="Remove material row">X</button>
      </div>
    `;
    elements.materialList.appendChild(row);
    if (isBlankRow) {
      row.querySelectorAll("input").forEach((input) => { input.value = ""; });
    }
    updateIcons();
  }

  function collectMaterialRows() {
    return Array.from(elements.materialList.querySelectorAll(".po-material-tile")).map((row) => {
      const value = (field) => {
        const input = row.querySelector('[data-item-field="' + field + '"]');
        return input ? input.value.trim() : "";
      };
      return {
        id: row.dataset.itemId || crypto.randomUUID(),
        quantity_ordered: value("quantity_ordered"),
        description: value("description")
      };
    }).filter((item) => item.description || item.quantity_ordered);
  }

  function getRecord(id) {
    return getCombinedRecords().find((record) => record.id === id) || null;
  }

  function clearReceiptPreview() {
    if (state.receiptPreviewUrl) {
      URL.revokeObjectURL(state.receiptPreviewUrl);
      state.receiptPreviewUrl = "";
    }
    elements.receiptPreview.textContent = "No receipt attached";
  }

  async function renderReceiptPreview(poId) {
    clearReceiptPreview();
    const receipt = poId ? await idbGet(RECEIPT_STORE, poId) : state.pendingReceipt;
    if (!receipt || !receipt.blob) {
      return;
    }
    state.receiptPreviewUrl = URL.createObjectURL(receipt.blob);
    elements.receiptPreview.innerHTML = `<img src="${escapeText(state.receiptPreviewUrl)}" alt="Receipt preview"><span>${escapeText(receipt.name || "receipt.jpg")}<br>${Math.round(receipt.blob.size / 1024)} KB</span>`;
  }

  function isAdmin() {
    return Boolean(state.profile && state.profile.role === "admin");
  }

  function canManageAssignment(po) {
    return Boolean(po && state.user && (po.creator_profile_id === state.user.id || isAdmin()));
  }

  function setFormLocked(locked, po) {
    const editableInputs = elements.form.querySelectorAll("input:not(#poId):not(#poRevision), select, textarea");
    editableInputs.forEach((input) => { input.disabled = locked; });
    elements.addItemButton.disabled = locked;
    elements.materialList.querySelectorAll("button").forEach((button) => { button.disabled = locked; });
    elements.saveButton.hidden = locked;
    elements.submitButton.hidden = locked;

    if (!locked && po && !canManageAssignment(po)) {
      elements.assignedTo.disabled = true;
      elements.job.disabled = true;
    }
    elements.cancelButton.hidden = !(po && po.id && state.user && (po.creator_profile_id === state.user.id || isAdmin()) && po.workflow_status !== "cancelled" && po.workflow_status !== "closed");
  }

  async function openForm(id) {
    showNotice("");
    state.pendingReceipt = null;
    const record = id ? getRecord(id) : null;
    const po = record ? clone(record.po) : {
      id: "",
      po_number: null,
      revision: null,
      order_date: localDateValue(),
      job_id: "",
      supplier_id: "",
      supplier_name: "",
      assigned_profile_id: "",
      notes: "",
      workflow_status: "draft",
      email_status: "not_ready",
      creator_profile_id: state.user.id,
      creator_name: state.profile.display_name
    };

    state.activeId = po.id || "";
    elements.id.value = po.id || "";
    elements.revision.value = po.revision || "";
    elements.numberDisplay.textContent = po.po_number ? formatPoNumber(po.po_number) : "Number assigned on first save";
    elements.orderDate.value = po.order_date || localDateValue();
    renderReferenceOptions();
    elements.job.value = po.job_id || "";
    elements.supplierName.value = po.supplier_name || "";
    elements.assignedTo.value = po.assigned_profile_id || "";
    elements.notes.value = po.notes || "";
    elements.materialList.innerHTML = "";
    const items = record && record.items && record.items.length ? record.items : [{}];
    items.forEach(addMaterialRow);
    elements.receiptInput.value = "";
    await renderReceiptPreview(po.id);

    const currentStatus = record ? compositeStatus(record) : "draft";
    elements.formStatusBadge.textContent = statusLabel(currentStatus);
    elements.formStatusBadge.className = "po-badge " + (currentStatus === "failed" || currentStatus === "cancelled" ? "danger" : (currentStatus === "pending_sync" || currentStatus === "offline_draft" ? "warning" : "green"));
    const locked = Boolean(po.id && !EDITABLE_STATUSES.has(po.workflow_status));
    setFormLocked(locked, po);

    elements.listView.hidden = true;
    elements.formView.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
    updateIcons();

    if (po.id && navigator.onLine && po.assigned_profile_id === state.user.id && po.workflow_status === "assigned") {
      const result = await state.client.rpc("digital_po_mark_opened", { p_po_id: po.id });
      if (!result.error && result.data) {
        await updateServerRecord(result.data, record.items || []);
        elements.revision.value = result.data.revision;
        elements.formStatusBadge.textContent = statusLabel(result.data.workflow_status);
      }
    }
    if (po.id) {
      loadHistory(po.id);
    } else {
      elements.historySection.hidden = true;
    }
  }

  function closeForm() {
    state.activeId = "";
    state.pendingReceipt = null;
    clearReceiptPreview();
    elements.formView.hidden = true;
    elements.listView.hidden = false;
    renderList();
  }

  async function loadHistory(poId) {
    elements.historySection.hidden = false;
    elements.historyList.innerHTML = '<div class="po-list-empty">Loading history...</div>';
    if (!navigator.onLine) {
      elements.historyList.innerHTML = '<div class="po-list-empty">History is available when online.</div>';
      return;
    }
    const result = await state.client
      .from("digital_po_audit_log")
      .select("id,event_type,actor_name,details,created_at")
      .eq("po_id", poId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (result.error) {
      elements.historyList.innerHTML = '<div class="po-list-empty">History could not be loaded.</div>';
      return;
    }
    elements.historyList.innerHTML = (result.data || []).map((event) => `
      <div class="po-history-item">
        <strong>${escapeText(statusLabel(event.event_type))}</strong>
        <span>${escapeText(event.actor_name || "System")} | ${escapeText(formatDateTime(event.created_at))}</span>
      </div>
    `).join("") || '<div class="po-list-empty">No history entries.</div>';
  }

  async function allocateDraftNumber() {
    const transaction = state.db.transaction([META_STORE], "readwrite");
    const store = transaction.objectStore(META_STORE);
    const key = cacheKeyForUser("device_context");
    const saved = await requestToPromise(store.get(key));
    const context = clone(saved && saved.value ? saved.value : state.deviceContext);

    if (!context || context.device_status !== "active" || !context.lease_expires_at || new Date(context.lease_expires_at) <= new Date()) {
      transaction.abort();
      throw new Error("This device does not have a valid offline PO authorization lease.");
    }

    const block = (context.blocks || []).find((item) => item.status === "active" && Number(item.next_number) <= Number(item.range_end));
    if (!block) {
      transaction.abort();
      throw new Error("No PO numbers remain on this device. Ask an admin for another block.");
    }

    const number = Number(block.next_number);
    block.next_number = number + 1;
    block.remaining = Math.max(Number(block.range_end) - block.next_number + 1, 0);
    if (block.next_number > Number(block.range_end)) {
      block.status = "exhausted";
    }
    store.put({ key, value: context });
    await transactionToPromise(transaction);
    state.deviceContext = context;
    renderDeviceState();
    return {
      po_number: number,
      number_block_id: block.id,
      device_id: context.device_id,
      device_token: state.deviceToken
    };
  }

  function collectFormData() {
    const job = state.jobs.find((item) => item.id === elements.job.value);
    return {
      order_date: elements.orderDate.value,
      job_id: elements.job.value,
      job_number: job ? job.job_number : "",
      job_name: job ? job.job_name : "",
      supplier_id: null,
      supplier_name: elements.supplierName.value.trim(),
      assigned_profile_id: elements.assignedTo.value || null,
      notes: elements.notes.value.trim(),
      items: collectMaterialRows()
    };
  }

  async function saveDraftLocally(options) {
    const settings = options || {};
    const formData = collectFormData();
    if (!formData.order_date || !formData.job_id) {
      throw new Error("Date and job are required before the first draft can be saved.");
    }

    let record = state.activeId ? getRecord(state.activeId) : null;
    let po = record ? clone(record.po) : null;
    let assignedDirty = false;

    if (!po || !po.id) {
      if (!deviceCanCreate()) {
        throw new Error("This device is not ready to issue a digital PO number.");
      }
      const issued = await allocateDraftNumber();
      const now = new Date().toISOString();
      po = {
        id: crypto.randomUUID(),
        po_number: issued.po_number,
        number_block_id: issued.number_block_id,
        device_id: issued.device_id,
        device_token: issued.device_token,
        creator_profile_id: state.user.id,
        creator_name: state.profile.display_name,
        assigned_profile_id: null,
        assigned_name: null,
        workflow_status: "draft",
        email_status: "not_ready",
        receipt_status: "none",
        receipt_attached: false,
        origin: navigator.onLine ? "online" : "offline",
        client_created_at: now,
        created_at: now,
        revision: null
      };
      state.activeId = po.id;
      elements.id.value = po.id;
      elements.numberDisplay.textContent = formatPoNumber(po.po_number);
      assignedDirty = Boolean(formData.assigned_profile_id);
    } else if (canManageAssignment(po)) {
      assignedDirty = String(po.assigned_profile_id || "") !== String(formData.assigned_profile_id || "");
    }

    po.order_date = formData.order_date;
    po.job_id = formData.job_id;
    po.job_number = formData.job_number;
    po.job_name = formData.job_name;
    po.supplier_id = formData.supplier_id;
    po.supplier_name = formData.supplier_name;
    po.notes = formData.notes;
    po.updated_at = new Date().toISOString();

    const draft = {
      id: po.id,
      po,
      items: formData.items,
      dirty: true,
      assignment_dirty: assignedDirty || Boolean(record && record.assignment_dirty),
      desired_assigned_profile_id: formData.assigned_profile_id,
      pending_submit: Boolean(settings.submit || (record && record.pending_submit)),
      pending_cancel: Boolean(record && record.pending_cancel),
      updated_local_at: new Date().toISOString()
    };
    await idbPut(DRAFT_STORE, draft);
    const index = state.drafts.findIndex((item) => item.id === draft.id);
    if (index >= 0) {
      state.drafts[index] = draft;
    } else {
      state.drafts.push(draft);
    }

    if (state.pendingReceipt && state.pendingReceipt.blob) {
      await idbPut(RECEIPT_STORE, Object.assign({}, state.pendingReceipt, { po_id: po.id }));
      state.pendingReceipt = null;
    }
    renderList();
    return draft;
  }

  async function updateServerRecord(po, items) {
    const record = Object.assign({}, po, { items: items || [] });
    const index = state.serverRecords.findIndex((item) => item.id === po.id);
    if (index >= 0) {
      state.serverRecords[index] = record;
    } else {
      state.serverRecords.unshift(record);
    }
    await setMeta(cacheKeyForUser("server_records"), state.serverRecords);
  }

  async function persistDraft(draft) {
    await idbPut(DRAFT_STORE, draft);
    const index = state.drafts.findIndex((item) => item.id === draft.id);
    if (index >= 0) {
      state.drafts[index] = draft;
    } else {
      state.drafts.push(draft);
    }
  }

  async function uploadSubmissionFiles(draft) {
    const pdfData = Object.assign({}, draft.po, {
      items: draft.items,
      submitted_by_name: state.profile.display_name
    });
    const pdfBlob = await window.JgcPurchaseOrderPdf.createBlob(pdfData);
    const pdfPath = draft.id + "/current/po.pdf";
    const pdfResult = await state.client.storage.from(TEMP_BUCKET).upload(pdfPath, pdfBlob, {
      upsert: true,
      contentType: "application/pdf",
      cacheControl: "0"
    });
    if (pdfResult.error) {
      throw pdfResult.error;
    }

    const receipt = await idbGet(RECEIPT_STORE, draft.id);
    let receiptPath = null;
    if (receipt && receipt.blob) {
      receiptPath = draft.id + "/current/receipt.jpg";
      const receiptResult = await state.client.storage.from(TEMP_BUCKET).upload(receiptPath, receipt.blob, {
        upsert: true,
        contentType: "image/jpeg",
        cacheControl: "0"
      });
      if (receiptResult.error) {
        throw receiptResult.error;
      }
    }
    return {
      pdfPath,
      receiptPath,
      receiptName: receipt ? receipt.name : null
    };
  }

  async function submitSyncedDraft(draft) {
    if (!draft.po.supplier_name || !(draft.items || []).some((item) => item.description)) {
      throw new Error("Supplier and at least one material description are required before submission.");
    }
    const files = await uploadSubmissionFiles(draft);
    const result = await state.client.rpc("digital_po_submit", {
      p_po_id: draft.id,
      p_expected_revision: draft.po.revision,
      p_pdf_storage_path: files.pdfPath,
      p_receipt_storage_path: files.receiptPath,
      p_receipt_original_filename: files.receiptName
    });
    if (result.error) {
      throw result.error;
    }

    draft.po = result.data;
    draft.dirty = false;
    draft.pending_submit = false;
    draft.assignment_dirty = false;
    draft.updated_local_at = new Date().toISOString();
    await persistDraft(draft);
    await updateServerRecord(result.data, draft.items);

    state.client.functions.invoke("send-digital-po-email", {
      body: { source: "portal", po_id: draft.id }
    }).catch(() => {});
    return draft;
  }

  async function syncDraft(id) {
    let draft = getDraft(id);
    if (!draft || !navigator.onLine) {
      return draft;
    }

    if (draft.dirty) {
      const saveResult = await state.client.rpc("digital_po_save", {
        p_order: draft.po,
        p_items: draft.items || [],
        p_expected_revision: draft.po.revision || null
      });
      if (saveResult.error) {
        throw saveResult.error;
      }
      draft.po = saveResult.data;
      draft.dirty = false;
      await persistDraft(draft);
      await updateServerRecord(draft.po, draft.items);
    }

    if (draft.assignment_dirty) {
      const assignResult = await state.client.rpc("digital_po_assign", {
        p_po_id: draft.id,
        p_assigned_profile_id: draft.desired_assigned_profile_id || null,
        p_expected_revision: draft.po.revision
      });
      if (assignResult.error) {
        throw assignResult.error;
      }
      draft.po = assignResult.data;
      draft.assignment_dirty = false;
      await persistDraft(draft);
      await updateServerRecord(draft.po, draft.items);
    }

    if (draft.pending_cancel) {
      const cancelResult = await state.client.rpc("digital_po_cancel", {
        p_po_id: draft.id,
        p_expected_revision: draft.po.revision
      });
      if (cancelResult.error) {
        throw cancelResult.error;
      }
      draft.po = cancelResult.data;
      draft.pending_cancel = false;
      await persistDraft(draft);
      await updateServerRecord(draft.po, draft.items);
      state.client.functions.invoke("send-digital-po-email", {
        body: { action: "cancellation_notification", po_id: draft.id }
      }).catch(() => {});
    } else if (draft.pending_submit) {
      await submitSyncedDraft(draft);
    }

    return draft;
  }

  async function syncAll(options) {
    const settings = options || {};
    if (state.syncing || !navigator.onLine) {
      updateSyncBadge();
      return;
    }
    state.syncing = true;
    updateSyncBadge();
    const failures = [];
    try {
      await loadProfileOnline();
      await loadReferencesOnline();
      await refreshDeviceContext();
      state.drafts = await idbGetAll(DRAFT_STORE);
      for (const draft of state.drafts.filter((item) => item.dirty || item.assignment_dirty || item.pending_submit || item.pending_cancel)) {
        try {
          await syncDraft(draft.id);
        } catch (error) {
          failures.push(formatPoNumber(draft.po.po_number) + ": " + (error.message || "Sync failed"));
        }
      }
      await loadServerRecords();
      state.drafts = await idbGetAll(DRAFT_STORE);
      renderReferenceOptions();
      renderList();
      if (failures.length) {
        showNotice(failures.join(" | "), "error");
      } else if (settings.showSuccess) {
        showNotice("Purchase orders are synced.");
      }
    } catch (error) {
      showNotice(error.message || "Purchase order sync failed.", "error");
    } finally {
      state.syncing = false;
      updateSyncBadge();
    }
  }

  function updateNetworkBadge() {
    elements.networkBadge.textContent = navigator.onLine ? "Online" : "Offline";
    elements.networkBadge.className = "po-badge " + (navigator.onLine ? "green" : "warning");
  }

  function updateSyncBadge() {
    const pending = state.drafts.filter((draft) => draft.dirty || draft.assignment_dirty || draft.pending_submit || draft.pending_cancel).length;
    if (state.syncing) {
      elements.syncBadge.textContent = "Syncing";
      elements.syncBadge.className = "po-badge info";
    } else if (pending) {
      elements.syncBadge.textContent = pending + " pending";
      elements.syncBadge.className = "po-badge warning";
    } else {
      elements.syncBadge.textContent = "Synced";
      elements.syncBadge.className = "po-badge green";
    }
  }

  async function handleSave(event) {
    event.preventDefault();
    elements.saveButton.disabled = true;
    try {
      const draft = await saveDraftLocally();
      showNotice(navigator.onLine ? "Saving purchase order..." : formatPoNumber(draft.po.po_number) + " saved offline.");
      if (navigator.onLine) {
        await syncDraft(draft.id);
        state.drafts = await idbGetAll(DRAFT_STORE);
        await loadServerRecords();
        showNotice(formatPoNumber(draft.po.po_number) + " saved.");
        await openForm(draft.id);
      } else {
        elements.formStatusBadge.textContent = "Offline Draft";
        elements.formStatusBadge.className = "po-badge warning";
      }
    } catch (error) {
      showNotice(error.message || "PO could not be saved.", "error");
    } finally {
      elements.saveButton.disabled = false;
      updateSyncBadge();
    }
  }

  async function handleSubmit() {
    elements.submitButton.disabled = true;
    try {
      const data = collectFormData();
      if (!data.supplier_name || !data.items.some((item) => item.description)) {
        throw new Error("Supplier and at least one material description are required before submission.");
      }
      if (!confirm("Submit this purchase order? It will lock and email the PDF to the office.")) {
        return;
      }
      const draft = await saveDraftLocally({ submit: true });
      if (!navigator.onLine) {
        showNotice(formatPoNumber(draft.po.po_number) + " is pending sync and will submit when online.", "warning");
        elements.formStatusBadge.textContent = "Pending Sync";
        elements.formStatusBadge.className = "po-badge warning";
        return;
      }
      showNotice("Submitting " + formatPoNumber(draft.po.po_number) + "...");
      await syncDraft(draft.id);
      state.drafts = await idbGetAll(DRAFT_STORE);
      await loadServerRecords();
      showNotice(formatPoNumber(draft.po.po_number) + " submitted. Email delivery is queued.");
      await openForm(draft.id);
    } catch (error) {
      showNotice(error.message || "PO could not be submitted.", "error");
    } finally {
      elements.submitButton.disabled = false;
      updateSyncBadge();
    }
  }

  async function handleCancel() {
    const record = state.activeId ? getRecord(state.activeId) : null;
    if (!record || !confirm("Cancel " + formatPoNumber(record.po.po_number) + "? Its number and history will be retained.")) {
      return;
    }
    try {
      let draft = getDraft(record.id) || {
        id: record.id,
        po: clone(record.po),
        items: clone(record.items || []),
        dirty: false,
        assignment_dirty: false,
        pending_submit: false,
        updated_local_at: new Date().toISOString()
      };
      draft.pending_cancel = true;
      draft.pending_submit = false;
      await persistDraft(draft);
      if (navigator.onLine) {
        await syncDraft(draft.id);
        await loadServerRecords();
        state.drafts = await idbGetAll(DRAFT_STORE);
        showNotice(formatPoNumber(record.po.po_number) + " cancelled.");
        await openForm(record.id);
      } else {
        showNotice("Cancellation is pending sync.", "warning");
        closeForm();
      }
    } catch (error) {
      showNotice(error.message || "PO could not be cancelled.", "error");
    }
    updateSyncBadge();
  }

  async function handleViewPdf(id) {
    const record = id ? getRecord(id) : null;
    const displayedNumber = elements.numberDisplay.textContent.match(/PO-(\d+)/i);
    const data = record
      ? Object.assign({}, record.po, { items: record.items || [] })
      : Object.assign({}, collectFormData(), {
          po_number: displayedNumber ? Number(displayedNumber[1]) : null,
          creator_name: state.profile.display_name,
          items: collectMaterialRows()
        });
    try {
      await window.JgcPurchaseOrderPdf.view(data);
    } catch (error) {
      showNotice(error.message || "PO PDF could not be opened.", "error");
    }
  }

  async function compressReceipt(file) {
    if (!file || !file.type.startsWith("image/")) {
      throw new Error("Select a receipt image.");
    }
    const image = typeof createImageBitmap === "function"
      ? await createImageBitmap(file)
      : await loadReceiptImage(file);
    const maxDimension = 1800;
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (typeof image.close === "function") {
      image.close();
    }
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Receipt compression failed.")), "image/jpeg", 0.78);
    });
    if (blob.size > 10 * 1024 * 1024) {
      throw new Error("The compressed receipt is still larger than 10 MB.");
    }
    return { blob, name: file.name || "receipt.jpg", original_type: file.type, captured_at: new Date().toISOString() };
  }

  function loadReceiptImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Receipt image could not be opened."));
      };
      image.src = url;
    });
  }

  async function handleReceiptChange() {
    const file = elements.receiptInput.files && elements.receiptInput.files[0];
    if (!file) {
      return;
    }
    try {
      const receipt = await compressReceipt(file);
      if (state.activeId) {
        await idbPut(RECEIPT_STORE, Object.assign({}, receipt, { po_id: state.activeId }));
      } else {
        state.pendingReceipt = receipt;
      }
      await renderReceiptPreview(state.activeId);
      showNotice("Receipt attached locally.");
    } catch (error) {
      elements.receiptInput.value = "";
      showNotice(error.message || "Receipt could not be prepared.", "error");
    }
  }

  function bindEvents() {
    elements.registerDeviceButton.addEventListener("click", registerDevice);
    elements.refreshDeviceButton.addEventListener("click", () => syncAll({ showSuccess: true }));
    elements.newButton.addEventListener("click", () => openForm(""));
    elements.syncButton.addEventListener("click", () => syncAll({ showSuccess: true }));
    elements.closeFormButton.addEventListener("click", closeForm);
    elements.form.addEventListener("submit", handleSave);
    elements.submitButton.addEventListener("click", handleSubmit);
    elements.cancelButton.addEventListener("click", handleCancel);
    elements.pdfButton.addEventListener("click", () => handleViewPdf(state.activeId));
    elements.addItemButton.addEventListener("click", () => addMaterialRow());
    elements.materialList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-remove-item]");
      if (!button) {
        return;
      }
      const rows = elements.materialList.querySelectorAll(".po-material-tile");
      if (rows.length === 1) {
        rows[0].querySelectorAll("input").forEach((input) => { input.value = ""; });
      } else {
        button.closest(".po-material-tile").remove();
      }
    });
    elements.receiptInput.addEventListener("change", handleReceiptChange);
    elements.search.addEventListener("input", renderList);
    elements.statusFilter.addEventListener("change", renderList);
    document.querySelectorAll("[data-po-list-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.listTab = button.dataset.poListTab;
        document.querySelectorAll("[data-po-list-tab]").forEach((tab) => {
          tab.classList.toggle("active", tab === button);
          tab.classList.toggle("secondary", tab !== button);
        });
        renderList();
      });
    });
    elements.list.addEventListener("click", (event) => {
      const openButton = event.target.closest("[data-po-open]");
      const pdfButton = event.target.closest("[data-po-pdf]");
      if (openButton) {
        openForm(openButton.dataset.poOpen);
      } else if (pdfButton) {
        handleViewPdf(pdfButton.dataset.poPdf);
      }
    });
    window.addEventListener("online", () => {
      updateNetworkBadge();
      syncAll();
    });
    window.addEventListener("offline", () => {
      updateNetworkBadge();
      updateSyncBadge();
      renderDeviceState();
    });
    window.addEventListener("focus", () => {
      if (navigator.onLine && state.initialized) {
        syncAll();
      }
    });
  }

  function captureElements() {
    Object.assign(elements, {
      currentUser: byId("poCurrentUser"),
      networkBadge: byId("poNetworkBadge"),
      syncBadge: byId("poSyncBadge"),
      rangeBadge: byId("poRangeBadge"),
      notice: byId("poNotice"),
      devicePanel: byId("poDevicePanel"),
      deviceTitle: byId("poDeviceTitle"),
      deviceMessage: byId("poDeviceMessage"),
      registerDeviceButton: byId("poRegisterDeviceButton"),
      refreshDeviceButton: byId("poRefreshDeviceButton"),
      newButton: byId("poNewButton"),
      syncButton: byId("poSyncButton"),
      listView: byId("poListView"),
      formView: byId("poFormView"),
      search: byId("poSearch"),
      statusFilter: byId("poStatusFilter"),
      list: byId("poList"),
      form: byId("poForm"),
      id: byId("poId"),
      revision: byId("poRevision"),
      numberDisplay: byId("poNumberDisplay"),
      formStatusBadge: byId("poFormStatusBadge"),
      closeFormButton: byId("poCloseFormButton"),
      orderDate: byId("poOrderDate"),
      job: byId("poJob"),
      supplierName: byId("poSupplierName"),
      assignedTo: byId("poAssignedTo"),
      notes: byId("poNotes"),
      addItemButton: byId("poAddItemButton"),
      materialList: byId("poMaterialList"),
      receiptInput: byId("poReceiptInput"),
      receiptPreview: byId("poReceiptPreview"),
      historySection: byId("poHistorySection"),
      historyList: byId("poHistoryList"),
      saveButton: byId("poSaveButton"),
      submitButton: byId("poSubmitButton"),
      pdfButton: byId("poPdfButton"),
      cancelButton: byId("poCancelButton")
    });
  }

  async function initialize() {
    captureElements();
    bindEvents();
    updateIcons();
    updateNetworkBadge();

    state.client = createJgcSupabaseClient();
    state.worker = requireJgcWorker();
    if (!state.client) {
      showNotice("Supabase is not available.", "error");
      return;
    }

    try {
      state.db = await openDatabase();
      const sessionResult = await state.client.auth.getSession();
      state.user = sessionResult.data && sessionResult.data.session ? sessionResult.data.session.user : null;
      if (!state.user) {
        window.location.href = "index.html";
        return;
      }
      state.deviceToken = await getOrCreateDeviceToken();
      await loadOfflineState();
      renderIdentity();
      renderReferenceOptions();
      renderDeviceState();
      renderList();
      updateSyncBadge();

      if (navigator.onLine) {
        await syncAll();
      }

      state.initialized = true;
      const requestedId = new URLSearchParams(window.location.search).get("po");
      if (requestedId && getRecord(requestedId)) {
        await openForm(requestedId);
      }
    } catch (error) {
      showNotice(error.message || "Purchase Orders could not be loaded.", "error");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
