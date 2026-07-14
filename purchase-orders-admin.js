(function() {
  "use strict";

  const state = {
    client: null,
    user: null,
    profile: null,
    orders: [],
    items: [],
    links: [],
    workOrders: [],
    devices: [],
    blocks: [],
    profiles: [],
    approvedWorkers: [],
    activeOrderId: "",
    tab: "orders"
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

  function formatPoNumber(value) {
    return window.JgcPurchaseOrderPdf.formatPoNumber(value);
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
      return "-";
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Toronto"
    }).format(date);
  }

  function label(value) {
    const labels = {
      ready_to_submit: "Ready to Submit",
      partially_received: "Partially Received",
      fully_received: "Fully Received",
      not_ready: "Not Ready",
      cleanup_failed: "Cleanup Failed",
      uploaded_temp: "Uploaded Temporarily"
    };
    return labels[value] || String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function updateIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function showNotice(message, kind) {
    elements.notice.textContent = message || "";
    elements.notice.className = "po-notice" + (kind ? " " + kind : "");
    elements.notice.hidden = !message;
  }

  function getOrderItems(id) {
    return state.items.filter((item) => item.po_id === id).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  }

  async function getFunctionErrorMessage(error) {
    const response = error && error.context;
    if (response && typeof response.json === "function") {
      try {
        const payload = await response.json();
        if (payload && payload.error) return payload.error;
      } catch (_) {
        // Use Supabase's message when the response has no JSON payload.
      }
    }
    return (error && error.message) || "Purchase order action failed.";
  }

  function getOrderLink(id) {
    return state.links.find((link) => link.po_id === id) || null;
  }

  function getWorkOrderName(id) {
    const workOrder = state.workOrders.find((item) => item.id === id);
    return workOrder ? workOrder.wo_number : "-";
  }

  function getProfile(id) {
    return state.profiles.find((profile) => profile.id === id) || null;
  }

  function renderSummary() {
    const failed = state.orders.filter((order) => order.email_status === "failed" || order.receipt_status === "cleanup_failed").length;
    const pendingDevices = state.devices.filter((device) => device.status === "pending").length;
    const lowBlocks = state.blocks.filter((block) => block.status === "active" && Number(block.range_end) - Number(block.next_number) + 1 <= 25).length;
    elements.summary.innerHTML = `
      <div class="po-metric"><strong>${state.orders.length}</strong><span>Digital POs</span></div>
      <div class="po-metric"><strong>${failed}</strong><span>Email / cleanup failures</span></div>
      <div class="po-metric"><strong>${pendingDevices}</strong><span>Pending devices</span></div>
      <div class="po-metric"><strong>${lowBlocks}</strong><span>Low number blocks</span></div>
    `;
  }

  function renderOrders() {
    const search = elements.search.value.trim().toLowerCase();
    const status = elements.statusFilter.value;
    const date = elements.dateFilter.value;
    const orders = state.orders.filter((order) => {
      const haystack = [
        formatPoNumber(order.po_number),
        order.job_number,
        order.job_name,
        order.supplier_name,
        order.creator_name,
        order.last_edited_by_name,
        order.workflow_status,
        order.email_status
      ].join(" ").toLowerCase();
      return (!search || haystack.includes(search)) &&
        (!date || order.order_date === date) &&
        (!status || order.workflow_status === status || order.email_status === status || order.receipt_status === status);
    });

    elements.ordersBody.innerHTML = orders.map((order) => {
      const link = getOrderLink(order.id);
      const statusClass = order.workflow_status === "cancelled" || order.email_status === "failed" ? "danger" : "green";
      return `
        <tr>
          <td><strong>${escapeText(formatPoNumber(order.po_number))}</strong><br><span class="po-badge ${statusClass}">${escapeText(label(order.workflow_status))}</span></td>
          <td>${escapeText(formatDate(order.order_date))}</td>
          <td>${escapeText(order.job_number)}<br>${escapeText(order.job_name)}</td>
          <td>${escapeText(order.supplier_name || "-")}</td>
          <td>${escapeText(order.creator_name)}${order.last_edited_by_name ? `<br><span style="color:#b9c9bd;">Edited by: ${escapeText(order.last_edited_by_name)}</span>` : ""}</td>
          <td>${escapeText(label(order.workflow_status))}<br><span style="color:#b9c9bd;">Rev. ${escapeText(order.revision)}</span></td>
          <td>${escapeText(label(order.email_status))}${order.receipt_status === "cleanup_failed" ? '<br><span class="po-badge danger">Cleanup Failed</span>' : ""}</td>
          <td>${escapeText(link ? getWorkOrderName(link.work_order_id) : "-")}</td>
          <td><button type="button" data-view-order="${escapeText(order.id)}"><i data-lucide="folder-open"></i> View</button></td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="9">No purchase orders found.</td></tr>';
    updateIcons();
  }

  function renderDevices() {
    elements.devicesBody.innerHTML = state.devices.map((device) => {
      const profile = getProfile(device.profile_id);
      const blocks = state.blocks.filter((block) => block.device_id === device.id);
      const remaining = blocks.reduce((total, block) => total + Math.max(Number(block.range_end) - Number(block.next_number) + 1, 0), 0);
      const blockText = blocks.length
        ? blocks.map((block) => `${formatPoNumber(block.range_start)} to ${formatPoNumber(block.range_end)} (${label(block.status)})`).join("<br>")
        : "No block assigned";
      const canAssign = device.status !== "revoked" && profile && profile.can_create_digital_pos && profile.account_status === "approved";
      return `
        <tr>
          <td>${escapeText(profile ? profile.display_name : device.profile_id)}<br><span style="color:#b9c9bd;">${escapeText(profile && profile.email || "")}</span></td>
          <td>${escapeText(device.device_label)}<br><span style="color:#b9c9bd;">Requested ${escapeText(formatDateTime(device.requested_at))}</span></td>
          <td><span class="po-badge ${device.status === "active" ? "green" : (device.status === "revoked" ? "danger" : "warning")}">${escapeText(label(device.status))}</span></td>
          <td>${escapeText(formatDateTime(device.lease_expires_at))}</td>
          <td>${blockText}</td>
          <td><span class="po-badge ${remaining <= 25 ? "warning" : "green"}">${remaining}</span></td>
          <td>
            <div class="po-inline-actions">
              ${canAssign ? `<button type="button" data-assign-block="${escapeText(device.id)}"><i data-lucide="plus"></i> Add Block #</button>` : ""}
              ${device.status === "active" ? `<button class="secondary" type="button" data-renew-device="${escapeText(device.id)}"><i data-lucide="refresh-cw"></i> Renew</button>` : ""}
              ${device.status !== "revoked" ? `<button class="danger" type="button" data-revoke-device="${escapeText(device.id)}"><i data-lucide="ban"></i> Revoke</button>` : ""}
            </div>
          </td>
        </tr>
      `;
    }).join("") || '<tr><td colspan="7">No PO devices registered.</td></tr>';
    updateIcons();
  }

  async function loadData() {
    showNotice("Loading purchase order administration...");
    const results = await Promise.all([
      state.client.from("digital_purchase_orders").select("*").order("created_at", { ascending: false }).limit(2000),
      state.client.from("digital_po_items").select("*").order("sort_order"),
      state.client.from("digital_po_work_order_links").select("*"),
      state.client.from("work_orders").select("id,wo_number,job_id,work_order_date").order("work_order_date", { ascending: false }).limit(2000),
      state.client.from("digital_po_devices").select("*").order("requested_at", { ascending: false }),
      state.client.from("digital_po_number_blocks").select("*").order("range_start"),
      state.client.from("profiles").select("id,email,display_name,worker_key,role,account_status,can_create_digital_pos").order("display_name"),
      state.client.from("work_order_labour_workers").select("id,profile_id,display_name,worker_key,approved").eq("approved", true).order("display_name")
    ]);
    const error = results.find((result) => result.error);
    if (error) {
      throw error.error;
    }
    state.orders = results[0].data || [];
    state.items = results[1].data || [];
    state.links = results[2].data || [];
    state.workOrders = results[3].data || [];
    state.devices = results[4].data || [];
    state.blocks = results[5].data || [];
    state.profiles = results[6].data || [];
    state.approvedWorkers = (results[7].data || []).filter((worker) => worker.profile_id);
    renderSummary();
    renderOrders();
    renderDevices();
    showNotice("");
  }

  async function loadHistory(poId) {
    const result = await state.client
      .from("digital_po_audit_log")
      .select("id,event_type,actor_name,details,created_at")
      .eq("po_id", poId)
      .order("created_at", { ascending: false })
      .limit(200);
    return result.error ? [] : result.data || [];
  }

  async function openOrderDetails(id) {
    const order = state.orders.find((item) => item.id === id);
    if (!order) {
      return;
    }
    state.activeOrderId = id;
    const items = getOrderItems(id);
    const history = await loadHistory(id);
    const link = getOrderLink(id);
    elements.detailsTitle.textContent = formatPoNumber(order.po_number);
    elements.detailsContent.innerHTML = `
      <div class="po-form-grid">
        <div><strong>Date</strong><br>${escapeText(formatDate(order.order_date))}</div>
        <div><strong>Job</strong><br>${escapeText(order.job_number + " - " + order.job_name)}</div>
        <div><strong>Supplier</strong><br>${escapeText(order.supplier_name || "-")}</div>
        <div><strong>Creator</strong><br>${escapeText(order.creator_name)}</div>
        <div><strong>Last Edited By</strong><br>${escapeText(order.last_edited_by_name || "Not edited")}</div>
        <div><strong>Submitted by</strong><br>${escapeText(order.submitted_by_name || "Not submitted")}</div>
        <div><strong>Work Order</strong><br>${escapeText(link ? getWorkOrderName(link.work_order_id) : "Not linked")}</div>
        <div><strong>Workflow</strong><br><span class="po-badge green">${escapeText(label(order.workflow_status))}</span></div>
        <div><strong>Email / Receipt</strong><br>${escapeText(label(order.email_status))} / ${escapeText(label(order.receipt_status))}</div>
      </div>
      ${order.email_last_error ? `<div class="po-notice error">${escapeText(order.email_last_error)}</div>` : ""}
      <section class="po-section-band">
        <div class="po-inline-actions" style="margin-top:10px;">
          <button class="secondary" type="button" data-admin-action="pdf"><i data-lucide="file-text"></i> View PDF</button>
          ${order.workflow_status === "submitted" && order.email_status === "pending" ? '<button type="button" data-admin-action="submit-early"><i data-lucide="send"></i> Submit Early</button>' : ""}
          ${order.email_status === "failed" || order.receipt_status === "cleanup_failed" ? '<button type="button" data-admin-action="retry"><i data-lucide="send"></i> Retry Delivery</button>' : ""}
          ${["submitted", "partially_received", "fully_received", "closed", "cancelled"].includes(order.workflow_status) ? '<button class="secondary" type="button" data-admin-action="reopen"><i data-lucide="unlock"></i> Reopen</button>' : ""}
          ${order.workflow_status === "submitted" ? '<button class="secondary" type="button" data-admin-action="partial">Partially Received</button><button class="secondary" type="button" data-admin-action="full">Fully Received</button>' : ""}
          ${["submitted", "partially_received", "fully_received"].includes(order.workflow_status) ? '<button class="secondary" type="button" data-admin-action="close">Close</button>' : ""}
          ${!["cancelled", "closed"].includes(order.workflow_status) ? '<button class="danger" type="button" data-admin-action="cancel"><i data-lucide="ban"></i> Cancel</button>' : ""}
          <button class="danger" type="button" data-admin-action="delete-test"><i data-lucide="trash-2"></i> Delete PO</button>
        </div>
      </section>
      <section class="po-section-band">
        <h3>Materials</h3>
        <div class="po-table-wrap">
          <table class="po-table" style="min-width:420px;">
            <thead><tr><th>Qty Ordered</th><th>Description</th></tr></thead>
            <tbody>${items.map((item) => `<tr><td>${escapeText(item.quantity_ordered)}</td><td>${escapeText(item.description)}</td></tr>`).join("") || '<tr><td colspan="2">No material rows.</td></tr>'}</tbody>
          </table>
        </div>
      </section>
      <section class="po-section-band">
        <h3>Audit History</h3>
        <div class="po-history-list">
          ${history.map((event) => `<div class="po-history-item"><strong>${escapeText(label(event.event_type))}</strong><span>${escapeText(event.actor_name)} | ${escapeText(formatDateTime(event.created_at))}</span></div>`).join("") || '<div class="po-list-empty">No history found.</div>'}
        </div>
      </section>
    `;
    elements.detailsModal.hidden = false;
    updateIcons();
  }

  async function runOrderAction(action) {
    const order = state.orders.find((item) => item.id === state.activeOrderId);
    if (!order) {
      return;
    }
    try {
      let result;
      if (action === "pdf") {
        await window.JgcPurchaseOrderPdf.view(Object.assign({}, order, { items: getOrderItems(order.id) }));
        return;
      }
      if (action === "retry") {
        result = await state.client.rpc("digital_po_admin_retry_email", { p_po_id: order.id });
        state.client.functions.invoke("send-digital-po-email", { body: { source: "admin_retry", po_id: order.id } }).catch(() => {});
      } else if (action === "submit-early") {
        if (!confirm("Submit " + formatPoNumber(order.po_number) + " early? It will be emailed to the office now.")) {
          return;
        }
        result = await state.client.rpc("digital_po_admin_submit_early", { p_po_id: order.id });
        if (!result.error) {
          const emailResult = await state.client.functions.invoke("send-digital-po-email", { body: { source: "admin_submit_early", po_id: order.id } });
          if (emailResult.error) {
            throw emailResult.error;
          }
        }
      } else if (action === "delete-test") {
        const poNumber = formatPoNumber(order.po_number);
        const confirmation = prompt("Testing only: permanently delete " + poNumber + " and all of its records? Type " + poNumber + " or just " + order.po_number + " to confirm.");
        if (confirmation === null) {
          return;
        }
        const normalizedConfirmation = confirmation.trim().replace(/^PO[-\s]?/i, "");
        if (normalizedConfirmation !== String(order.po_number)) {
          throw new Error("PO number did not match. Nothing was deleted.");
        }
        result = await state.client.functions.invoke("send-digital-po-email", {
          body: {
            action: "admin_delete_test_po",
            po_id: order.id,
            confirmation: confirmation.trim()
          }
        });
      } else if (action === "reopen") {
        if (!confirm("Reopen " + formatPoNumber(order.po_number) + " for editing?")) {
          return;
        }
        result = await state.client.rpc("digital_po_admin_reopen", { p_po_id: order.id });
      } else if (action === "cancel") {
        if (!confirm("Cancel " + formatPoNumber(order.po_number) + "? The number and history will remain.")) {
          return;
        }
        result = await state.client.rpc("digital_po_cancel", {
          p_po_id: order.id,
          p_expected_revision: order.revision
        });
      } else {
        const statusMap = { partial: "partially_received", full: "fully_received", close: "closed" };
        result = await state.client.rpc("digital_po_set_completion_status", {
          p_po_id: order.id,
          p_status: statusMap[action]
        });
      }
      if (result && result.error) {
        throw new Error(await getFunctionErrorMessage(result.error));
      }
      elements.detailsModal.hidden = true;
      await loadData();
      showNotice(
        action === "submit-early"
          ? "Purchase order submitted early and queued for immediate email delivery."
          : (action === "delete-test" ? "Purchase order permanently deleted." : "Purchase order updated.")
      );
    } catch (error) {
      showNotice(error.message || "Purchase order action failed.", "error");
    }
  }

  function nextAvailableRangeStart() {
    const maxEnd = state.blocks.reduce((max, block) => Math.max(max, Number(block.range_end || 0)), 29999);
    return Math.max(30000, maxEnd + 1);
  }

  function openBlockModal(deviceId) {
    const start = nextAvailableRangeStart();
    elements.blockDeviceId.value = deviceId;
    elements.blockStart.value = start;
    elements.blockEnd.value = start + 499;
    elements.blockLeaseDays.value = 30;
    elements.blockModal.hidden = false;
  }

  async function assignBlock() {
    const start = Number(elements.blockStart.value);
    const end = Number(elements.blockEnd.value);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 30000 || end < start) {
      showNotice("Enter a valid PO number block beginning at 30000 or higher.", "error");
      return;
    }
    if (!confirm("Assign " + formatPoNumber(start) + " through " + formatPoNumber(end) + " to this device? Ranges cannot be reused.")) {
      return;
    }
    elements.assignBlockButton.disabled = true;
    try {
      const result = await state.client.rpc("digital_po_admin_assign_block", {
        p_device_id: elements.blockDeviceId.value,
        p_range_start: start,
        p_range_end: end,
        p_lease_days: Number(elements.blockLeaseDays.value || 30)
      });
      if (result.error) {
        throw result.error;
      }
      elements.blockModal.hidden = true;
      await loadData();
      showNotice("PO number block assigned.");
    } catch (error) {
      showNotice(error.message || "Number block could not be assigned.", "error");
    } finally {
      elements.assignBlockButton.disabled = false;
    }
  }

  async function renewDevice(id) {
    try {
      const result = await state.client.rpc("digital_po_admin_renew_device", {
        p_device_id: id,
        p_lease_days: 30
      });
      if (result.error) {
        throw result.error;
      }
      await loadData();
      showNotice("Device lease renewed for 30 days.");
    } catch (error) {
      showNotice(error.message || "Device lease could not be renewed.", "error");
    }
  }

  async function revokeDevice(id) {
    if (!confirm("Revoke this PO device? Unused numbers in its blocks will never be reassigned.")) {
      return;
    }
    try {
      const result = await state.client.rpc("digital_po_admin_revoke_device", { p_device_id: id });
      if (result.error) {
        throw result.error;
      }
      await loadData();
      showNotice("PO device revoked.");
    } catch (error) {
      showNotice(error.message || "PO device could not be revoked.", "error");
    }
  }

  function bindEvents() {
    elements.refreshButton.addEventListener("click", loadData);
    elements.search.addEventListener("input", renderOrders);
    elements.statusFilter.addEventListener("change", renderOrders);
    elements.dateFilter.addEventListener("change", renderOrders);
    elements.ordersBody.addEventListener("click", (event) => {
      const button = event.target.closest("[data-view-order]");
      if (button) {
        openOrderDetails(button.dataset.viewOrder);
      }
    });
    elements.devicesBody.addEventListener("click", (event) => {
      const blockButton = event.target.closest("[data-assign-block]");
      const renewButton = event.target.closest("[data-renew-device]");
      const revokeButton = event.target.closest("[data-revoke-device]");
      if (blockButton) {
        openBlockModal(blockButton.dataset.assignBlock);
      } else if (renewButton) {
        renewDevice(renewButton.dataset.renewDevice);
      } else if (revokeButton) {
        revokeDevice(revokeButton.dataset.revokeDevice);
      }
    });
    elements.detailsContent.addEventListener("click", (event) => {
      const button = event.target.closest("[data-admin-action]");
      if (button) {
        runOrderAction(button.dataset.adminAction);
      }
    });
    document.querySelectorAll("[data-close-modal]").forEach((button) => {
      button.addEventListener("click", () => { byId(button.dataset.closeModal).hidden = true; });
    });
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.tab = button.dataset.adminTab;
        elements.ordersView.hidden = state.tab !== "orders";
        elements.devicesView.hidden = state.tab !== "devices";
        document.querySelectorAll("[data-admin-tab]").forEach((tab) => {
          tab.classList.toggle("active", tab === button);
          tab.classList.toggle("secondary", tab !== button);
        });
      });
    });
    elements.assignBlockButton.addEventListener("click", assignBlock);
    [elements.detailsModal, elements.blockModal].forEach((modal) => {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) {
          modal.hidden = true;
        }
      });
    });
  }

  function captureElements() {
    Object.assign(elements, {
      currentUser: byId("poAdminCurrentUser"),
      notice: byId("poAdminNotice"),
      refreshButton: byId("poAdminRefreshButton"),
      summary: byId("poAdminSummary"),
      ordersView: byId("poAdminOrdersView"),
      devicesView: byId("poAdminDevicesView"),
      search: byId("poAdminSearch"),
      statusFilter: byId("poAdminStatusFilter"),
      dateFilter: byId("poAdminDateFilter"),
      ordersBody: byId("poAdminOrdersBody"),
      devicesBody: byId("poAdminDevicesBody"),
      detailsModal: byId("poAdminDetailsModal"),
      detailsTitle: byId("poAdminDetailsTitle"),
      detailsContent: byId("poAdminDetailsContent"),
      blockModal: byId("poBlockModal"),
      blockDeviceId: byId("poBlockDeviceId"),
      blockStart: byId("poBlockStart"),
      blockEnd: byId("poBlockEnd"),
      blockLeaseDays: byId("poBlockLeaseDays"),
      assignBlockButton: byId("poAssignBlockButton")
    });
  }

  async function initialize() {
    captureElements();
    bindEvents();
    updateIcons();
    state.client = createJgcSupabaseClient();
    const worker = requireJgcWorker();
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
        alert("Purchase Order Admin is only available to approved administrators.");
        window.location.href = "purchase-orders.html";
        return;
      }
      state.profile = profileResult.data;
      elements.currentUser.textContent = "Signed in as: " + (state.profile.display_name || worker.display || worker.key || "");
      await loadData();
      const requestedId = new URLSearchParams(window.location.search).get("po");
      if (requestedId) {
        openOrderDetails(requestedId);
      }
    } catch (error) {
      showNotice(error.message || "Purchase Order Admin could not be loaded.", "error");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
