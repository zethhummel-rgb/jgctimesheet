let editingAdminVacationRequestId = "";

function formatVacationStatus(status) {
    const value = String(status || "pending");
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function makeVacationDate(value) {
    return value ? new Date(value + "T00:00:00") : null;
}

function dateIsInsideRequest(request, date) {
    const start = makeVacationDate(request.start_date);
    const end = makeVacationDate(request.end_date);

    return start && end && start.getTime() <= date.getTime() && date.getTime() <= end.getTime();
}

function formatVacationMonthTitle(date) {
    return date.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
}

function changeVacationCalendarMonth(offset) {
    vacationCalendarMonth = new Date(vacationCalendarMonth.getFullYear(), vacationCalendarMonth.getMonth() + offset, 1);
    renderVacationCalendar();
}

function renderVacationCalendar() {
    const calendar = document.getElementById("adminVacationCalendar");
    const title = document.getElementById("adminVacationCalendarTitle");

    if (!calendar || !title) {
        return;
    }

    const year = vacationCalendarMonth.getFullYear();
    const month = vacationCalendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let html = dayNames.map((day) => `<div class="calendar-head">${day}</div>`).join("");

    title.textContent = formatVacationMonthTitle(firstDay);

    for (let i = 0; i < firstDay.getDay(); i++) {
        html += '<div class="calendar-day"></div>';
    }

    for (let day = 1; day <= lastDay.getDate(); day++) {
        const date = new Date(year, month, day);
        const matches = vacationRequests
            .filter((request) => dateIsInsideRequest(request, date))
            .sort((a, b) => String(a.worker_display_name || a.worker_name || "").localeCompare(String(b.worker_display_name || b.worker_name || "")));
        const pastClass = date < today ? "past" : "";
        const requestHtml = matches.slice(0, 4).map((request) => `
            <div class="calendar-request ${escapeHtml(request.status || "pending")}">
                <span class="schedule-sync-dot ${getJgcScheduleSyncClass(request) === "synced" ? "synced" : "unsynced"}" title="${escapeHtml(getJgcScheduleSyncLabel(request))}"></span>
                ${escapeHtml(request.worker_display_name || request.worker_name)}
            </div>
        `).join("");
        const moreHtml = matches.length > 4 ? `<div class="small">+${matches.length - 4} more</div>` : "";

        html += `
            <div class="calendar-day ${pastClass}">
                <div class="day-number">${day}</div>
                ${requestHtml}
                ${moreHtml}
            </div>
        `;
    }

    calendar.innerHTML = html;
}

function renderAdminVacationTable(rows) {
    if (!rows.length) {
        return '<p class="jgc-archive__empty">No vacation requests in this section.</p>';
    }

    return `
        <div class="table-wrap jgc-table-wrap">
            <table class="jgc-table">
                <thead>
                    <tr>
                        <th>Dates</th>
                        <th>Days</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Notes</th>
                        <th>Admin Note</th>
                        <th>Actions</th>
                        <th>Delete</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map((request) => {
                        const isEditingDates = editingAdminVacationRequestId === request.id;
                        return `
                        <tr>
                            <td>
                                ${isEditingDates ? `
                                    <div class="jgc-field" style="min-width:230px;">
                                        <label class="jgc-label" for="adminVacationStart-${escapeHtml(request.id)}">First Day Off</label>
                                        <input class="jgc-input" id="adminVacationStart-${escapeHtml(request.id)}" type="date" value="${escapeHtml(request.start_date || "")}">
                                        <label class="jgc-label" for="adminVacationEnd-${escapeHtml(request.id)}">Last Day Off</label>
                                        <input class="jgc-input" id="adminVacationEnd-${escapeHtml(request.id)}" type="date" value="${escapeHtml(request.end_date || "")}">
                                        <label class="jgc-label" for="adminVacationReturn-${escapeHtml(request.id)}">Return To Work</label>
                                        <input class="jgc-input" id="adminVacationReturn-${escapeHtml(request.id)}" type="date" value="${escapeHtml(request.return_date || "")}">
                                        <div class="actions jgc-table-actions" style="margin-top:8px;">
                                            <button type="button" class="jgc-button" onclick="saveAdminApprovedVacationDates('${escapeHtml(request.id)}')">Save Dates</button>
                                            <button type="button" class="secondary jgc-button jgc-button--secondary" onclick="cancelAdminVacationDateEdit()">Cancel</button>
                                        </div>
                                    </div>
                                ` : `
                                    ${escapeHtml(request.start_date)} to ${escapeHtml(request.end_date)}
                                    ${request.return_date ? '<br>Return: ' + escapeHtml(request.return_date) : ""}
                                `}
                            </td>
                            <td>${Number(request.total_days || 0).toFixed(1)}</td>
                            <td>${escapeHtml(request.request_type)}</td>
                            <td><span class="jgc-badge ${request.status === "approved" ? "jgc-badge--success" : request.status === "denied" ? "jgc-badge--danger" : "jgc-badge--warning"}">${escapeHtml(formatVacationStatus(request.status))}</span></td>
                            <td>${escapeHtml(request.reason || "")}</td>
                            <td>
                                <textarea class="jgc-textarea" id="vacationNote-${escapeHtml(request.id)}" rows="3" placeholder="Optional note">${escapeHtml(request.admin_note || "")}</textarea>
                                ${request.reviewed_by ? '<div class="small">Reviewed by ' + escapeHtml(request.reviewed_by) + ' on ' + escapeHtml(formatDate(request.reviewed_at)) + '</div>' : ""}
                            </td>
                            <td>
                                <div class="actions jgc-table-actions">
                                    ${request.status === "approved" && !isEditingDates ? `<button type="button" class="secondary jgc-button jgc-button--secondary" onclick="beginAdminVacationDateEdit('${escapeHtml(request.id)}')">Edit Approved Dates</button>` : ""}
                                    <button type="button" class="jgc-button" onclick="reviewVacationRequest('${escapeHtml(request.id)}', 'approved')">Approve</button>
                                    <button type="button" class="secondary jgc-button jgc-button--secondary" onclick="reviewVacationRequest('${escapeHtml(request.id)}', 'denied')">Deny</button>
                                </div>
                            </td>
                            <td><button type="button" class="delete-button jgc-button jgc-button--danger" onclick="deleteVacationRequest('${escapeHtml(request.id)}')">Delete</button></td>
                        </tr>
                    `;}).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function beginAdminVacationDateEdit(id) {
    const request = vacationRequests.find((item) => item.id === id);

    if (!request || request.status !== "approved") {
        alert("Only an approved vacation request can be edited here.");
        return;
    }

    editingAdminVacationRequestId = id;
    renderVacationRequests();
    const input = document.getElementById("adminVacationStart-" + id);
    if (input) {
        input.focus();
        input.scrollIntoView({ behavior: "smooth", block: "center" });
    }
}

function cancelAdminVacationDateEdit() {
    editingAdminVacationRequestId = "";
    renderVacationRequests();
}

async function saveAdminApprovedVacationDates(id) {
    const request = vacationRequests.find((item) => item.id === id);
    const startInput = document.getElementById("adminVacationStart-" + id);
    const endInput = document.getElementById("adminVacationEnd-" + id);
    const returnInput = document.getElementById("adminVacationReturn-" + id);
    const startDate = startInput ? startInput.value : "";
    const endDate = endInput ? endInput.value : "";
    const returnDate = returnInput ? returnInput.value : "";

    if (!request || request.status !== "approved") {
        alert("This approved vacation request could not be found.");
        return;
    }

    if (!startDate || !endDate || endDate < startDate) {
        alert("Choose a valid first and last day off.");
        return;
    }

    if (returnDate && returnDate <= endDate) {
        alert("Return to work must be after the last day off.");
        return;
    }

    const confirmed = confirm(
        "Update this approved vacation to " + startDate + " through " + endDate + "?\n\n" +
        "The employee's live and submitted vacation timesheet rows will be corrected automatically."
    );

    if (!confirmed) {
        return;
    }

    const { data: updateResult, error } = await supabaseClient.rpc("update_approved_vacation_request_dates", {
        p_request_id: id,
        p_start_date: startDate,
        p_end_date: endDate,
        p_return_date: returnDate || null
    });

    if (error) {
        alert("This approved vacation could not be updated. " + (error.message || ""));
        return;
    }

    const updatedRequest = updateResult && updateResult.request ? updateResult.request : null;

    if (!updatedRequest) {
        alert("The vacation dates were saved, but the updated request could not be reloaded. Refresh and check the dates.");
        return;
    }

    editingAdminVacationRequestId = "";
    vacationRequests = vacationRequests.map((item) => item.id === id ? updatedRequest : item);

    if (typeof syncJgcScheduleEventToGoogle === "function") {
        await syncJgcScheduleEventToGoogle(supabaseClient, buildAdminVacationGoogleEvent(updatedRequest), "upsert");
    }

    await createVacationDecisionAnnouncement(updatedRequest);
    await loadAllAdminData();
    renderVacationCalendar();
    renderVacationRequests();
    alert("Approved vacation dates and timesheet vacation rows were updated.");
}

function getVacationWorkerGroupKey(request) {
    return normalizeWorkerName(request.worker_display_name || request.worker_name) || "unknown employee";
}

function groupVacationRequestsByWorker(rows) {
    const groupsByWorker = new Map();

    rows.forEach((request) => {
        const workerKey = getVacationWorkerGroupKey(request);

        if (!groupsByWorker.has(workerKey)) {
            groupsByWorker.set(workerKey, {
                key: workerKey,
                name: request.worker_display_name || request.worker_name || "Unknown Employee",
                requests: []
            });
        }

        groupsByWorker.get(workerKey).requests.push(request);
    });

    return Array.from(groupsByWorker.values()).sort((a, b) => a.name.localeCompare(b.name));
}

let vacationLazyGroupRows = new Map();

function loadVacationEmployeeGroup(details) {
    if (!details || !details.open) {
        return;
    }

    const body = details.querySelector("[data-vacation-lazy-body]");

    if (!body || body.dataset.loaded === "true") {
        return;
    }

    const rows = vacationLazyGroupRows.get(details.dataset.vacationWorker) || [];
    body.innerHTML = renderAdminVacationTable(rows);
    body.dataset.loaded = "true";
}

function renderVacationEmployeeGroups(rows, openGroups, openFilteredGroups) {
    const groups = groupVacationRequestsByWorker(rows);
    vacationLazyGroupRows = new Map(groups.map((group) => [group.key, group.requests]));

    return `<div class="jgc-archive-list">${groups.map((group) => {
        const isOpen = openFilteredGroups || openGroups.has(group.key);
        const pendingCount = group.requests.filter((request) => String(request.status || "pending").toLowerCase() === "pending").length;
        const requestLabel = group.requests.length + " request" + (group.requests.length === 1 ? "" : "s");
        const countLabel = pendingCount ? requestLabel + " | " + pendingCount + " pending" : requestLabel;

        return `
            <details class="jgc-archive" data-vacation-worker="${escapeHtml(group.key)}"${isOpen ? " open" : ""} ontoggle="loadVacationEmployeeGroup(this)">
                <summary>
                    <span class="jgc-archive__title">${escapeHtml(group.name)}</span>
                    <span class="jgc-archive__count">${escapeHtml(countLabel)}</span>
                </summary>
                <div class="jgc-archive__body" data-vacation-lazy-body data-loaded="${isOpen ? "true" : "false"}">${isOpen ? renderAdminVacationTable(group.requests) : ""}</div>
            </details>
        `;
    }).join("")}</div>`;
}

function renderVacationRequests() {
    const workerFilter = document.getElementById("vacationWorkerFilter").value.trim().toLowerCase();
    const statusFilter = document.getElementById("vacationStatusFilter").value;
    const list = document.getElementById("vacationList");
    const filtered = vacationRequests.filter((request) => {
        const worker = String(request.worker_display_name || request.worker_name || "").toLowerCase();
        const status = String(request.status || "pending");
        return (!workerFilter || worker.includes(workerFilter)) && (!statusFilter || status === statusFilter);
    });

    if (!filtered.length) {
        renderVacationCalendar();
        list.innerHTML = '<div class="jgc-empty-state">No vacation requests found.</div>';
        return;
    }

    renderVacationCalendar();
    const openGroups = new Set(Array.from(list.querySelectorAll("details[data-vacation-worker][open]"))
        .map((details) => details.dataset.vacationWorker));
    const filtersActive = Boolean(workerFilter || statusFilter);
    list.innerHTML = renderVacationEmployeeGroups(filtered, openGroups, filtersActive);
}

async function reviewVacationRequest(id, status) {
    const request = vacationRequests.find((item) => item.id === id);

    if (!request) {
        alert("This vacation request could not be found.");
        return;
    }

    const confirmed = confirm((status === "approved" ? "Approve" : "Deny") + " this vacation request?");

    if (!confirmed) {
        return;
    }

    const noteField = document.getElementById("vacationNote-" + id);
    const adminNote = noteField ? noteField.value.trim() : "";
    const { data, error } = await supabaseClient
        .from("vacation_requests")
        .update({
            status,
            admin_note: adminNote,
            reviewed_by: currentWorkerDisplay,
            reviewed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq("id", id)
        .select()
        .single();

    if (error) {
        alert("This vacation request could not be updated. " + (error.message || ""));
        return;
    }

    vacationRequests = vacationRequests.map((item) => item.id === id ? data : item);
    await createVacationDecisionAnnouncement(data);

    if (String(status || "").toLowerCase() === "approved") {
        await syncJgcScheduleEventToGoogle(supabaseClient, buildAdminVacationGoogleEvent(data), "upsert");
    } else if (request.google_event_id) {
        await syncJgcScheduleEventToGoogle(supabaseClient, buildAdminVacationGoogleEvent(request), "delete");
    }

    await loadAllAdminData();
    renderVacationCalendar();
    renderVacationRequests();
}

function getAccountForVacationRequest(request) {
    const requestName = normalizeWorkerName(request && request.worker_name);
    const requestDisplay = normalizeWorkerName(request && request.worker_display_name);

    return accounts.find((account) => {
        const accountKey = normalizeWorkerName(account.worker_key);
        const accountDisplay = normalizeWorkerName(account.display_name);
        const accountEmail = normalizeWorkerName(account.email);
        return Boolean(
            requestName &&
            (requestName === accountKey || requestName === accountDisplay || requestName === accountEmail)
        ) || Boolean(
            requestDisplay &&
            (requestDisplay === accountKey || requestDisplay === accountDisplay || requestDisplay === accountEmail)
        );
    });
}

async function createVacationDecisionAnnouncement(request) {
    if (!request || !supabaseClient) {
        return;
    }

    const account = getAccountForVacationRequest(request);
    const decision = String(request.status || "").toLowerCase() === "approved" ? "Approved" : "Denied";
    const workerName = request.worker_display_name || request.worker_name || "";
    const targetWorkerName = normalizeWorkerName(account && (account.worker_key || account.display_name) || request.worker_name || workerName);
    const targetWorkerEmail = account && account.email ? account.email : "";
    const title = "Vacation Request " + decision;
    const bodyLines = [
        "Your vacation request has been " + decision.toLowerCase() + ".",
        "",
        "Dates: " + (request.start_date || "") + " to " + (request.end_date || ""),
        "Requested Days: " + Number(request.total_days || 0).toFixed(1),
        "Request Type: " + (request.request_type || "")
    ];

    if (request.admin_note) {
        bodyLines.push("");
        bodyLines.push("Admin Note:");
        bodyLines.push(request.admin_note);
    }

    bodyLines.push("");
    bodyLines.push("Reviewed by: " + (request.reviewed_by || currentWorkerDisplay || "Admin"));

    const record = {
        title,
        body: bodyLines.join("\n"),
        created_by: currentUserId || null,
        created_by_name: currentWorkerDisplay,
        expires_at: null,
        is_active: true,
        target_worker_name: targetWorkerName || null,
        target_worker_email: targetWorkerEmail || null,
        source_type: "vacation_request",
        source_id: request.id
    };

    const { data: existing } = await supabaseClient
        .from("announcements")
        .select("id")
        .eq("source_type", "vacation_request")
        .eq("source_id", request.id)
        .maybeSingle();

    if (existing && existing.id) {
        await supabaseClient
            .from("announcements")
            .update({
                title: record.title,
                body: record.body,
                created_by: record.created_by,
                created_by_name: record.created_by_name,
                is_active: true,
                target_worker_name: record.target_worker_name,
                target_worker_email: record.target_worker_email
            })
            .eq("id", existing.id);
        return;
    }

    await supabaseClient
        .from("announcements")
        .insert(record);
}

async function deleteVacationRequest(id) {
    const request = vacationRequests.find((item) => item.id === id);

    if (!request) {
        alert("This vacation request could not be found.");
        return;
    }

    const confirmed = confirm("Delete this vacation request for " + (request.worker_display_name || request.worker_name) + "?");

    if (!confirmed) {
        return;
    }

    if (request.google_event_id) {
        await syncJgcScheduleEventToGoogle(supabaseClient, buildAdminVacationGoogleEvent(request), "delete");
    }

    const { error } = await supabaseClient
        .from("vacation_requests")
        .delete()
        .eq("id", id);

    if (error) {
        alert("This vacation request could not be deleted. " + (error.message || ""));
        return;
    }

    vacationRequests = vacationRequests.filter((item) => item.id !== id);
    if (editingAdminVacationRequestId === id) {
        editingAdminVacationRequestId = "";
    }
    renderVacationCalendar();
    renderVacationRequests();
}
