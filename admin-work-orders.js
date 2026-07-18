function getAdminWorkOrderStatusLabel(status) {
    if (status === "ready_for_submission") {
        return "Ready For Submission";
    }

    return capitalizeWords(status || "draft");
}

function parseAdminWorkOrderLocalDate(value) {
    const parts = String(value || "").split("-").map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
        return null;
    }
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function getAdminFollowingMonday(workOrderDateValue) {
    const date = parseAdminWorkOrderLocalDate(workOrderDateValue);
    if (!date) {
        return null;
    }

    const monday = new Date(date);
    const daysUntilMonday = (8 - monday.getDay()) % 7 || 7;
    monday.setDate(monday.getDate() + daysUntilMonday);
    monday.setHours(8, 0, 0, 0);
    return monday;
}

function formatAdminWorkOrderGateTime(date) {
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const period = hours >= 12 ? "PM" : "AM";
    const displayHour = hours % 12 || 12;
    return displayHour + ":" + minutes + " " + period;
}

function isAdminWorkOrderPendingSubmission(wo) {
    const waitingFor = Array.isArray(wo && wo.waiting_for) ? wo.waiting_for : [];
    return Boolean(wo && wo.status === "ready_for_submission" && wo.labour_complete && !waitingFor.length && !wo.locked);
}

function getAdminPendingSubmissionDateLabel(wo) {
    const monday = getAdminFollowingMonday(wo && wo.work_order_date);
    return monday
        ? monday.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) + " " + formatAdminWorkOrderGateTime(monday)
        : "Monday";
}

function getAdminWorkOrderStatusText(wo) {
    if (wo && wo.locked && wo.status !== "submitted") {
        return "Submitting";
    }

    if (isAdminWorkOrderPendingSubmission(wo)) {
        return "Pending Submission " + getAdminPendingSubmissionDateLabel(wo);
    }

    const label = getAdminWorkOrderStatusLabel(wo && wo.status);
    const submittedDate = wo && wo.submitted_at ? formatDate(wo.submitted_at) : "";

    if ((wo && wo.status) === "submitted" && submittedDate) {
        return label + " - " + submittedDate;
    }

    return label;
}

function isAdminWorkOrderSubmittedForManagement(wo) {
    return Boolean(wo && wo.status === "submitted");
}

function setAdminWorkOrderManagementView(view) {
    adminWorkOrderManagementView = view === "submitted" ? "submitted" : "active";
    renderAdminWorkOrders();
}

function updateAdminWorkOrderManagementTabs() {
    const activeButton = document.getElementById("adminWoActiveTabButton");
    const submittedButton = document.getElementById("adminWoSubmittedTabButton");

    if (activeButton) {
        activeButton.classList.toggle("active", adminWorkOrderManagementView === "active");
        activeButton.setAttribute("aria-selected", String(adminWorkOrderManagementView === "active"));
    }

    if (submittedButton) {
        submittedButton.classList.toggle("active", adminWorkOrderManagementView === "submitted");
        submittedButton.setAttribute("aria-selected", String(adminWorkOrderManagementView === "submitted"));
    }
}

function getAdminWorkOrderLabourRows(id) {
    return workOrderLabourRows.filter((row) => row.work_order_id === id);
}

function getAdminWorkOrderPoCount(id) {
    return workOrderPurchaseOrders.filter((row) => row.work_order_id === id).length + Number(adminWorkOrderDigitalPoCounts[id] || 0);
}

function setAdminWorkOrderEditorHeight(value) {
    const frame = document.getElementById("adminWorkOrderEditorFrame");
    const height = Math.ceil(Number(value));

    if (!frame || !Number.isFinite(height) || height < 1) {
        return;
    }

    const nextHeight = Math.max(720, Math.min(height + 4, 50000));
    const currentHeight = parseFloat(frame.style.height || "0");

    if (!Number.isFinite(currentHeight) || Math.abs(currentHeight - nextHeight) > 2) {
        frame.style.height = nextHeight + "px";
    }
}

function openAdminWorkOrderEditor(id) {
    const wo = workOrders.find((item) => String(item.id) === String(id));
    const panel = document.getElementById("adminWorkOrderEditorPanel");
    const frame = document.getElementById("adminWorkOrderEditorFrame");
    const title = document.getElementById("adminWorkOrderEditorTitle");
    const status = document.getElementById("adminWorkOrderEditorStatus");

    if (!wo || !panel || !frame) {
        alert("Work Order could not be found.");
        return;
    }

    if (title) {
        title.textContent = (wo.locked || wo.status === "submitted") ? "View Work Order" : "Edit Work Order";
    }

    if (status) {
        status.textContent = [wo.wo_number, wo.job_number, wo.job_name].filter(Boolean).join(" - ");
    }

    panel.hidden = false;
    frame.style.height = "720px";
    frame.src = "work-orders.html?embedded=1&admin=1&wo=" + encodeURIComponent(id);
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function refreshAdminWorkOrderEditor() {
    const frame = document.getElementById("adminWorkOrderEditorFrame");

    if (frame && frame.src) {
        frame.src = frame.src;
    }
}

async function closeAdminWorkOrderEditor() {
    const panel = document.getElementById("adminWorkOrderEditorPanel");
    const frame = document.getElementById("adminWorkOrderEditorFrame");

    if (frame) {
        frame.removeAttribute("src");
        frame.style.height = "720px";
    }

    if (panel) {
        panel.hidden = true;
    }

    await loadAdminWorkOrders();
}

function renderAdminWorkOrderTable(rows) {
    return `
        <div class="table-wrap admin-wo-management-table jgc-table-wrap">
            <table class="jgc-table">
                <thead>
                    <tr>
                        <th>WO #</th>
                        <th>Date</th>
                        <th>Attention</th>
                        <th>Job</th>
                        <th>Creator</th>
                        <th>Status</th>
                        <th>Labour</th>
                        <th>POs</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((wo) => {
                        const labour = getAdminWorkOrderLabourRows(wo.id);
                        const completeCount = labour.filter((row) => row.complete).length;
                        const isLocked = Boolean(wo.locked || wo.status === "submitted");
                        const isPendingSubmission = isAdminWorkOrderPendingSubmission(wo);
                        const statusClass = escapeHtml(wo.status || "draft");
                        return `
                            <tr>
                                <td>${escapeHtml(wo.wo_number || "")}</td>
                                <td>${escapeHtml(wo.work_order_date || "")}</td>
                                <td>${escapeHtml(wo.customer || "")}</td>
                                <td>${escapeHtml([wo.job_number, wo.job_name].filter(Boolean).join(" - "))}</td>
                                <td>${escapeHtml(wo.created_by_name || wo.supervisor_name || "-")}</td>
                                <td><span class="pill jgc-badge ${wo.status === "submitted" ? "jgc-badge--info" : wo.status === "ready_for_submission" ? "jgc-badge--warning" : "jgc-badge--success"} ${statusClass} ${isPendingSubmission ? "pending-submission" : ""}">${escapeHtml(getAdminWorkOrderStatusText(wo))}</span></td>
                                <td>${labour.length ? completeCount + " / " + labour.length : "-"}</td>
                                <td>${getAdminWorkOrderPoCount(wo.id)}</td>
                                <td>
                                    <div class="actions jgc-table-actions">
                                        <button type="button" class="secondary jgc-button jgc-button--secondary" onclick="openAdminWorkOrderEditor('${escapeHtml(wo.id)}')">${isLocked ? "View" : "Edit"}</button>
                                        ${!isLocked && String(wo.status || "").toLowerCase() === "ready_for_submission" ? `<button type="button" class="secondary jgc-button jgc-button--secondary" onclick="moveAdminWorkOrderToDraft('${escapeHtml(wo.id)}')">Move to Draft</button>` : ""}
                                        <button type="button" class="delete-button jgc-button jgc-button--danger" onclick="deleteAdminWorkOrder('${escapeHtml(wo.id)}')">Delete</button>
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function renderAdminPastWorkOrderGroups(rows, hasActiveFilter) {
    const list = document.getElementById("adminWorkOrdersList");
    const openGroups = new Set(Array.from(list.querySelectorAll("details[open][data-archive-key]"), (details) => details.dataset.archiveKey));
    const groups = window.JgcAdminHousekeeping?.groupByMonth(
        rows,
        (wo) => wo.submitted_at || wo.work_order_date || wo.created_at
    ) || [{ key: "past", label: "Past Work Orders", items: rows }];

    return `<div class="jgc-archive-list">${groups.map((group) => {
        const isOpen = hasActiveFilter || openGroups.has(group.key);
        return `
            <details class="jgc-archive" data-archive-key="${escapeHtml(group.key)}"${isOpen ? " open" : ""}>
                <summary>
                    <span class="jgc-archive__title">${escapeHtml(group.label)}</span>
                    <span class="jgc-archive__count">${group.items.length} WO${group.items.length === 1 ? "" : "s"}</span>
                </summary>
                <div class="jgc-archive__body">${renderAdminWorkOrderTable(group.items)}</div>
            </details>
        `;
    }).join("")}</div>`;
}

function renderAdminWorkOrders() {
    const summary = document.getElementById("adminWorkOrdersSummary");
    const list = document.getElementById("adminWorkOrdersList");
    const listStatus = document.getElementById("adminWorkOrderListStatus");

    if (!summary || !list) {
        return;
    }

    const search = (document.getElementById("adminWorkOrderSearch")?.value || "").trim().toLowerCase();
    const statusFilter = document.getElementById("adminWorkOrderStatus")?.value || "";
    const dateFilter = document.getElementById("adminWorkOrderDate")?.value || "";
    const submitted = workOrders.filter((wo) => String(wo.status || "").toLowerCase() === "submitted").length;
    const ready = workOrders.filter((wo) => String(wo.status || "").toLowerCase() === "ready_for_submission").length;
    const draft = workOrders.filter((wo) => String(wo.status || "").toLowerCase() === "draft" || !wo.status).length;
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    sixMonthsAgo.setHours(0, 0, 0, 0);
    const retainedSixMonths = workOrders.filter((wo) => {
        const date = profileDateValue(wo.submitted_at || wo.work_order_date || wo.created_at);
        return date && date >= sixMonthsAgo;
    }).length;

    const filtered = workOrders.filter((wo) => {
        const labour = getAdminWorkOrderLabourRows(wo.id);
        const text = [
            wo.wo_number,
            wo.customer,
            wo.customer_po_number,
            wo.job_number,
            wo.job_name,
            wo.status,
            wo.created_by_name,
            wo.supervisor_name,
            labour.map((row) => row.employee_name).join(" ")
        ].join(" ").toLowerCase();
        const isSubmitted = isAdminWorkOrderSubmittedForManagement(wo);

        return (!search || text.includes(search)) &&
            (adminWorkOrderManagementView === "submitted" ? isSubmitted : !isSubmitted) &&
            (!statusFilter || String(wo.status || "draft") === statusFilter) &&
            (!dateFilter || wo.work_order_date === dateFilter);
    });

    updateAdminWorkOrderManagementTabs();

    summary.innerHTML = `
        <div class="summary-grid">
            <div class="summary-tile"><h3>Total Work Orders</h3><div class="summary-value">${workOrders.length}</div><div class="summary-detail">All saved records</div></div>
            <div class="summary-tile"><h3>Draft</h3><div class="summary-value">${draft}</div><div class="summary-detail">Still being built</div></div>
            <div class="summary-tile"><h3>Ready</h3><div class="summary-value">${ready}</div><div class="summary-detail">Waiting for labour or final submit</div></div>
            <div class="summary-tile"><h3>Submitted</h3><div class="summary-value">${submitted}</div><div class="summary-detail">Locked and emailed</div></div>
            <div class="summary-tile"><h3>Last 6 Months</h3><div class="summary-value">${retainedSixMonths}</div><div class="summary-detail">Stored online after job list changes</div></div>
        </div>
    `;

    if (listStatus) {
        listStatus.textContent = filtered.length + " " + (adminWorkOrderManagementView === "submitted" ? "past" : "active") + " work order" + (filtered.length === 1 ? "" : "s") + " shown.";
    }

    if (!filtered.length) {
        list.innerHTML = '<div class="small" style="margin-top:12px;">No ' + (adminWorkOrderManagementView === "submitted" ? "past" : "active") + ' Work Orders found.</div>';
        return;
    }

    const hasActiveFilter = Boolean(search || statusFilter || dateFilter);
    list.innerHTML = adminWorkOrderManagementView === "submitted"
        ? renderAdminPastWorkOrderGroups(filtered, hasActiveFilter)
        : renderAdminWorkOrderTable(filtered);
}

async function moveAdminWorkOrderToDraft(id) {
    const wo = workOrders.find((item) => item.id === id);

    if (!wo || wo.locked || String(wo.status || "").toLowerCase() === "submitted") {
        alert("Submitted Work Orders are locked.");
        return;
    }

    const { error } = await supabaseClient
        .from("work_orders")
        .update({
            status: "draft",
            locked: false,
            updated_at: new Date().toISOString()
        })
        .eq("id", id);

    if (error) {
        alert("Work Order could not be moved to draft: " + (error.message || ""));
        return;
    }

    workOrders = workOrders.map((item) => item.id === id ? { ...item, status: "draft", locked: false, updated_at: new Date().toISOString() } : item);
    renderAdminWorkOrders();
    renderPortalSummary();
}

function setWorkOrderLabourWorkerStatus(message) {
    const status = document.getElementById("workOrderLabourWorkerStatus");
    if (status) {
        status.textContent = message || "";
    }
}

function getWorkOrderLabourWorkerKey(name) {
    const normalized = normalizeWorkerName(name);
    return normalized || String(name || "").trim().toLowerCase();
}

function renderWorkOrderLabourWorkers() {
    const list = document.getElementById("workOrderLabourWorkerList");
    const countBadge = document.getElementById("woLabourWorkerCountBadge");

    if (!list) {
        return;
    }

    const sorted = [...workOrderLabourWorkers].sort((a, b) =>
        String(a.display_name || "").localeCompare(String(b.display_name || ""))
    );
    const approvedCount = sorted.filter((workerRow) => workerRow.approved).length;
    if (countBadge) {
        countBadge.textContent = `${approvedCount}/${sorted.length}`;
    }

    if (!sorted.length) {
        list.innerHTML = `
            <div>No WO labour workers found.</div>
            <div class="small">Add names manually or approve portal accounts to build this list.</div>
        `;
        return;
    }

    list.innerHTML = `
        <div class="small" style="margin-bottom:8px;">${approvedCount} approved of ${sorted.length} total WO labour workers.</div>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Approved</th>
                        <th>Name</th>
                        <th>Source</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${sorted.map((workerRow) => `
                        <tr>
                            <td>
                                <input
                                    type="checkbox"
                                    style="width:auto;"
                                    ${workerRow.approved ? "checked" : ""}
                                    onchange="toggleWorkOrderLabourWorker('${escapeHtml(workerRow.id)}', this.checked)"
                                >
                            </td>
                            <td>${escapeHtml(workerRow.display_name || "")}</td>
                            <td>${workerRow.profile_id ? "Portal account" : "Manual WO name"}</td>
                            <td>
                                <button type="button" class="secondary" onclick="editWorkOrderLabourWorker('${escapeHtml(workerRow.id)}')">Edit</button>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

async function loadWorkOrderLabourWorkers() {
    const { data, error } = await supabaseClient
        .from("work_order_labour_workers")
        .select("*")
        .order("display_name", { ascending: true });

    if (error) {
        setWorkOrderLabourWorkerStatus("WO labour workers could not be loaded: " + error.message);
        return;
    }

    workOrderLabourWorkers = data || [];
    renderWorkOrderLabourWorkers();
    setWorkOrderLabourWorkerStatus("WO labour workers refreshed.");
}

async function addWorkOrderLabourWorker() {
    const input = document.getElementById("woLabourWorkerName");
    const displayName = (input?.value || "").trim();

    if (!displayName) {
        setWorkOrderLabourWorkerStatus("Enter a worker name first.");
        return;
    }

    const workerKey = getWorkOrderLabourWorkerKey(displayName);
    const { error } = await supabaseClient
        .from("work_order_labour_workers")
        .upsert({
            display_name: displayName,
            worker_key: workerKey,
            approved: true,
            updated_at: new Date().toISOString()
        }, { onConflict: "worker_key" });

    if (error) {
        setWorkOrderLabourWorkerStatus("Worker could not be saved: " + error.message);
        return;
    }

    input.value = "";
    setWorkOrderLabourWorkerStatus(displayName + " is approved for WO labour.");
    await loadWorkOrderLabourWorkers();
}

async function toggleWorkOrderLabourWorker(id, approved) {
    const { error } = await supabaseClient
        .from("work_order_labour_workers")
        .update({
            approved,
            updated_at: new Date().toISOString()
        })
        .eq("id", id);

    if (error) {
        setWorkOrderLabourWorkerStatus("Worker approval could not be updated: " + error.message);
        await loadWorkOrderLabourWorkers();
        return;
    }

    workOrderLabourWorkers = workOrderLabourWorkers.map((workerRow) =>
        workerRow.id === id ? { ...workerRow, approved } : workerRow
    );
    renderWorkOrderLabourWorkers();
    setWorkOrderLabourWorkerStatus("WO labour worker approval updated.");
}

async function editWorkOrderLabourWorker(id) {
    const workerRow = workOrderLabourWorkers.find((item) => item.id === id);

    if (!workerRow) {
        alert("WO labour worker could not be found.");
        return;
    }

    const nextName = prompt("Update WO labour worker name:", workerRow.display_name || "");

    if (nextName === null) {
        return;
    }

    const displayName = nextName.trim();

    if (!displayName) {
        alert("Worker name cannot be blank.");
        return;
    }

    const updatePayload = {
        display_name: displayName,
        updated_at: new Date().toISOString()
    };

    if (!workerRow.profile_id) {
        updatePayload.worker_key = getWorkOrderLabourWorkerKey(displayName);
    }

    const { error } = await supabaseClient
        .from("work_order_labour_workers")
        .update(updatePayload)
        .eq("id", id);

    if (error) {
        setWorkOrderLabourWorkerStatus("Worker name could not be updated: " + error.message);
        return;
    }

    workOrderLabourWorkers = workOrderLabourWorkers.map((item) =>
        item.id === id ? { ...item, ...updatePayload } : item
    );
    renderWorkOrderLabourWorkers();
    setWorkOrderLabourWorkerStatus("WO labour worker name updated.");
}

async function deleteAdminWorkOrder(id) {
    const wo = workOrders.find((item) => item.id === id);

    if (!wo) {
        alert("Work Order could not be found.");
        return;
    }

    const label = wo.wo_number || [wo.job_number, wo.job_name].filter(Boolean).join(" - ") || "this Work Order";
    const confirmed = confirm("Delete Work Order " + label + "? This is permanent and should only be used for testing or cleanup.");

    if (!confirmed) {
        return;
    }

    const childTables = [
        "work_order_purchase_orders",
        "work_order_labour",
        "work_order_equipment",
        "work_order_rentals",
        "work_order_materials",
        "work_order_misc_invoices",
        "work_order_travel"
    ];

    const childDeletes = await Promise.all(childTables.map((table) =>
        supabaseClient.from(table).delete().eq("work_order_id", id)
    ));
    const childError = childDeletes.find((result) => result.error);

    if (childError) {
        alert("Work Order details could not be deleted: " + childError.error.message);
        return;
    }

    const { error } = await supabaseClient
        .from("work_orders")
        .delete()
        .eq("id", id);

    if (error) {
        alert("Work Order could not be deleted: " + error.message);
        return;
    }

    if (typeof clearJgcNotificationsForSource === "function") {
        await clearJgcNotificationsForSource("work_orders", id, supabaseClient);
    }

    workOrders = workOrders.filter((item) => item.id !== id);
    workOrderLabourRows = workOrderLabourRows.filter((row) => row.work_order_id !== id);
    workOrderPurchaseOrders = workOrderPurchaseOrders.filter((row) => row.work_order_id !== id);
    renderAdminWorkOrders();
    renderEmployeeProfile();
    renderPortalSummary();
}

async function loadAdminWorkOrders() {
    const [workOrderResult, labourResult, poResult, equipmentResult, travelResult, workerResult, digitalPoLinkResult] = await Promise.all([
        supabaseClient.from("work_orders").select("*").order("work_order_date", { ascending: false }).order("created_at", { ascending: false }),
        supabaseClient.from("work_order_labour").select("*").order("employee_name", { ascending: true }),
        supabaseClient.from("work_order_purchase_orders").select("*").order("sort_order", { ascending: true }),
        supabaseClient.from("work_order_equipment").select("*"),
        supabaseClient.from("work_order_travel").select("*"),
        supabaseClient.from("work_order_labour_workers").select("*").order("display_name", { ascending: true }),
        supabaseClient.from("digital_po_work_order_links").select("work_order_id,po_id")
    ]);

    workOrders = workOrderResult.data || [];
    workOrderLabourRows = labourResult.data || [];
    workOrderPurchaseOrders = poResult.data || [];
    workOrderEquipmentRows = equipmentResult.data || [];
    workOrderTravelRows = travelResult.data || [];
    workOrderLabourWorkers = workerResult.data || [];
    adminWorkOrderDigitalPoCounts = {};

    if (!digitalPoLinkResult.error) {
        adminWorkOrderDigitalPoCounts = (digitalPoLinkResult.data || []).reduce((counts, link) => {
            counts[link.work_order_id] = Number(counts[link.work_order_id] || 0) + 1;
            return counts;
        }, {});
    } else if (workOrders.length) {
        const { data: digitalPoCountRows, error: digitalPoCountError } = await supabaseClient.rpc("digital_po_work_order_counts", {
            p_work_order_ids: workOrders.map((workOrder) => workOrder.id)
        });

        if (!digitalPoCountError) {
            adminWorkOrderDigitalPoCounts = (digitalPoCountRows || []).reduce((counts, row) => {
                counts[row.work_order_id] = Number(row.po_count || 0);
                return counts;
            }, {});
        } else {
            console.warn("Admin digital PO counts could not be loaded.", digitalPoLinkResult.error, digitalPoCountError);
        }
    }
    renderAdminWorkOrders();
    renderWorkOrderLabourWorkers();
    renderJobDashboard();
    renderEmployeeProfile();
    renderPortalSummary();
}

window.addEventListener("message", (event) => {
    const frame = document.getElementById("adminWorkOrderEditorFrame");

    if (event.origin !== window.location.origin || !event.data || !frame || event.source !== frame.contentWindow) {
        return;
    }

    if (event.data.type === "jgc-work-order-frame-height") {
        setAdminWorkOrderEditorHeight(event.data.height);
    } else if (event.data.type === "jgc-work-order-updated") {
        loadAdminWorkOrders();
    }
});
