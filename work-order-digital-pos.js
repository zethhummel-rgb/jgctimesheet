(function() {
  "use strict";

  const state = {
    rows: [],
    initialized: false,
    loading: false
  };

  function escapeText(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatPoNumber(value) {
    return "PO-" + String(value || "").replace(/^PO-/i, "");
  }

  function formatDate(value) {
    const parts = String(value || "").split("-").map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
      return String(value || "");
    }
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC"
    }).format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12)));
  }

  function statusLabel(value) {
    return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function currentWorkOrderId() {
    return typeof editingWorkOrderId !== "undefined" ? editingWorkOrderId : null;
  }

  function canManageDigitalPos() {
    const record = typeof worker !== "undefined" ? worker : getCurrentWorkerRecord();
    const role = String(record && record.role || "").toLowerCase();
    return role === "admin" || role === "supervisor";
  }

  function render() {
    const availableList = document.getElementById("digitalPoAvailableList");
    const linkedList = document.getElementById("digitalPoLinkedList");
    const linkedWrap = document.getElementById("digitalPoLinkedWrap");
    const addButton = document.getElementById("addSelectedDigitalPosButton");
    const workOrderId = currentWorkOrderId();
    const available = state.rows.filter((row) => !row.linked_work_order_id);
    const linked = state.rows.filter((row) => row.linked_work_order_id === workOrderId);

    availableList.innerHTML = available.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Select</th><th>Digital Portal PO</th><th>Supplier</th><th>Date</th><th>Created / Assigned</th><th>Materials</th><th>Receipt</th><th>Status</th></tr></thead>
          <tbody>
            ${available.map((row) => `
              <tr>
                <td><input type="checkbox" data-digital-po-id="${escapeText(row.id)}" aria-label="Select ${escapeText(formatPoNumber(row.po_number))}"></td>
                <td><strong>${escapeText(formatPoNumber(row.po_number))}</strong></td>
                <td>${escapeText(row.supplier_name || "-")}</td>
                <td>${escapeText(formatDate(row.order_date))}</td>
                <td>${escapeText(row.creator_name || "-")}<br><span class="small">${escapeText(row.assigned_name || "Not assigned")}</span></td>
                <td>${escapeText(row.material_count || 0)}</td>
                <td>${row.receipt_attached ? "Yes" : "No"}</td>
                <td>${escapeText(statusLabel(row.workflow_status))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    ` : '<div class="small">No unlinked digital POs found for this job and date.</div>';

    addButton.disabled = !available.length || !workOrderId;
    linkedWrap.hidden = !linked.length;
    linkedList.innerHTML = linked.map((row) => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid rgba(99,205,107,.28);padding:10px;margin-top:7px;border-radius:6px;">
        <span><strong>Digital Portal ${escapeText(formatPoNumber(row.po_number))}</strong> | ${escapeText(row.supplier_name || "-")} | ${escapeText(formatDate(row.order_date))}</span>
        <div class="actions">
          ${typeof isAdmin !== "undefined" && isAdmin ? `<button type="button" class="secondary" data-open-digital-po="${escapeText(row.id)}">View</button>` : ""}
          <button type="button" class="delete-button" data-unlink-digital-po="${escapeText(row.id)}">Unlink</button>
        </div>
      </div>
    `).join("");
  }

  async function refresh() {
    if (!state.initialized || state.loading) {
      return;
    }
    const section = document.getElementById("digitalPoWorkOrderSection");
    const status = document.getElementById("digitalPoWorkOrderStatus");
    const jobId = document.getElementById("woJob").value;
    const date = document.getElementById("digitalPoWorkOrderDate").value;

    if (!canManageDigitalPos()) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    if (!navigator.onLine) {
      status.textContent = "Digital PO linking is available when online.";
      state.rows = [];
      render();
      return;
    }
    if (!jobId || !date) {
      status.textContent = "Select a job and date.";
      state.rows = [];
      render();
      return;
    }

    state.loading = true;
    status.textContent = "Loading digital POs...";
    try {
      const result = await supabaseClient.rpc("digital_po_work_order_options", {
        p_job_id: jobId,
        p_order_date: date,
        p_work_order_id: currentWorkOrderId() || null
      });
      if (result.error) {
        throw result.error;
      }
      state.rows = result.data || [];
      render();
      status.textContent = currentWorkOrderId()
        ? state.rows.length + " digital PO" + (state.rows.length === 1 ? "" : "s") + " found."
        : "Save the Work Order before linking selected digital POs.";
    } catch (error) {
      state.rows = [];
      render();
      status.textContent = "Digital POs could not be loaded: " + (error.message || "Unknown error");
    } finally {
      state.loading = false;
    }
  }

  async function linkSelected() {
    const status = document.getElementById("digitalPoWorkOrderStatus");
    const ids = Array.from(document.querySelectorAll("[data-digital-po-id]:checked")).map((input) => input.dataset.digitalPoId);
    const workOrderId = currentWorkOrderId();
    if (!workOrderId) {
      status.textContent = "Save the Work Order before linking digital POs.";
      return;
    }
    if (!ids.length) {
      status.textContent = "Select at least one digital PO.";
      return;
    }

    const result = await supabaseClient.rpc("digital_po_link_work_orders", {
      p_work_order_id: workOrderId,
      p_po_ids: ids
    });
    if (result.error) {
      status.textContent = "Digital POs could not be linked: " + result.error.message;
      return;
    }
    status.textContent = String(result.data && result.data.linked || 0) + " digital PO(s) linked.";
    await refresh();
  }

  async function unlink(poId) {
    if (!confirm("Unlink this Digital Portal PO from the Work Order?")) {
      return;
    }
    const result = await supabaseClient.rpc("digital_po_unlink_work_order", { p_po_id: poId });
    if (result.error) {
      document.getElementById("digitalPoWorkOrderStatus").textContent = "Digital PO could not be unlinked: " + result.error.message;
      return;
    }
    await refresh();
  }

  function useWorkOrderDate() {
    const source = document.getElementById("woDate");
    const target = document.getElementById("digitalPoWorkOrderDate");
    if (source && target) {
      target.value = source.value || "";
    }
    refresh();
  }

  function reset() {
    state.rows = [];
    useWorkOrderDate();
  }

  function getLinked() {
    const workOrderId = currentWorkOrderId();
    return state.rows.filter((row) => row.linked_work_order_id === workOrderId);
  }

  function initialize() {
    const section = document.getElementById("digitalPoWorkOrderSection");
    if (!section) {
      return;
    }
    state.initialized = true;
    document.getElementById("digitalPoWorkOrderDate").value = document.getElementById("woDate").value || "";
    document.getElementById("digitalPoWorkOrderDate").addEventListener("change", refresh);
    document.getElementById("refreshDigitalPoOptionsButton").addEventListener("click", refresh);
    document.getElementById("addSelectedDigitalPosButton").addEventListener("click", linkSelected);
    document.getElementById("digitalPoLinkedList").addEventListener("click", (event) => {
      const unlinkButton = event.target.closest("[data-unlink-digital-po]");
      const openButton = event.target.closest("[data-open-digital-po]");
      if (unlinkButton) {
        unlink(unlinkButton.dataset.unlinkDigitalPo);
      } else if (openButton) {
        window.location.href = "purchase-orders-admin.html?po=" + encodeURIComponent(openButton.dataset.openDigitalPo);
      }
    });
    window.addEventListener("online", refresh);
    window.setTimeout(refresh, 500);
  }

  window.jgcDigitalPoWorkOrder = {
    refresh,
    reset,
    useWorkOrderDate,
    getLinked
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
