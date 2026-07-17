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

    list.innerHTML = `
        <div class="table-wrap jgc-table-wrap">
            <table class="jgc-table">
                <thead>
                    <tr>
                        <th>Worker</th>
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
                    ${filtered.map((request) => `
                        <tr>
                            <td>${escapeHtml(request.worker_display_name || request.worker_name)}</td>
                            <td>
                                ${escapeHtml(request.start_date)} to ${escapeHtml(request.end_date)}
                                ${request.return_date ? '<br>Return: ' + escapeHtml(request.return_date) : ""}
                            </td>
                            <td>${Number(request.total_days || 0).toFixed(1)}</td>
                            <td>${escapeHtml(request.request_type)}</td>
                            <td><span class="jgc-badge ${request.status === "approved" ? "jgc-badge--success" : request.status === "denied" ? "jgc-badge--danger" : "jgc-badge--warning"}">${escapeHtml(formatVacationStatus(request.status))}</span></td>
                            <td>${escapeHtml(request.reason || "")}</td>
                            <td>
                                <textarea class="jgc-textarea" id="vacationNote-${request.id}" rows="3" placeholder="Optional note">${escapeHtml(request.admin_note || "")}</textarea>
                                ${request.reviewed_by ? '<div class="small">Reviewed by ' + escapeHtml(request.reviewed_by) + ' on ' + escapeHtml(formatDate(request.reviewed_at)) + '</div>' : ""}
                            </td>
                            <td>
                                <div class="actions jgc-table-actions">
                                    <button type="button" class="jgc-button" onclick="reviewVacationRequest('${escapeHtml(request.id)}', 'approved')">Approve</button>
                                    <button type="button" class="secondary jgc-button jgc-button--secondary" onclick="reviewVacationRequest('${escapeHtml(request.id)}', 'denied')">Deny</button>
                                </div>
                            </td>
                            <td><button type="button" class="delete-button jgc-button jgc-button--danger" onclick="deleteVacationRequest('${escapeHtml(request.id)}')">Delete</button></td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
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
    renderVacationCalendar();
    renderVacationRequests();
}
