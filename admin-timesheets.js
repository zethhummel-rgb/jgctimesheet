const ADMIN_SUBMITTED_TIMESHEET_BATCH_SIZE = 5;
const ADMIN_TIMESHEET_RESUBMIT_RECIPIENTS = [
    "zeth@johngordonconstruction.com",
    "darlene@johngordonconstruction.com"
];
const submittedTimesheetVisibleCounts = {};
const submittedTimesheetOpenWorkers = new Set();
let submittedTimesheetFinalPanelOpen = false;

function getSubmittedTimesheetWorkerKey(workerName) {
    return normalizeWorkerName(workerName) || "unknown worker";
}

function getSubmittedTimesheetWorkerLabel(workerName) {
    const workerKey = getSubmittedTimesheetWorkerKey(workerName);
    const account = accounts.find((item) => [item.worker_key, item.display_name, item.email]
        .map(normalizeWorkerName)
        .includes(workerKey));

    return account && account.display_name ? account.display_name : workerName || "Unknown Worker";
}

function groupSubmittedTimesheetsByEmployee(rows) {
    const groupsByWorker = {};

    rows.forEach((week) => {
        const workerKey = getSubmittedTimesheetWorkerKey(week.worker_name);

        if (!groupsByWorker[workerKey]) {
            groupsByWorker[workerKey] = {
                key: workerKey,
                name: getSubmittedTimesheetWorkerLabel(week.worker_name),
                weeks: []
            };
        }

        groupsByWorker[workerKey].weeks.push(week);
    });

    return Object.values(groupsByWorker).sort((a, b) => a.name.localeCompare(b.name));
}

function renderSubmittedTimesheetTable(rows) {
    if (!rows.length) {
        return '<div class="small">No finalized submitted timesheets found.</div>';
    }

    return `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr><th>Week</th><th>Total Hours</th><th>Submitted</th><th>Note</th><th>Actions</th></tr>
                </thead>
                <tbody>
                    ${rows.map((week) => `
                        <tr>
                            <td>${escapeHtml(week.week_label)}</td>
                            <td>${Number(week.total_hours || 0).toFixed(2)}</td>
                            <td>${escapeHtml(formatDate(week.submitted_at))}</td>
                            <td>${escapeHtml(week.note || "")}</td>
                            <td>
                                <div class="actions">
                                    <button type="button" class="secondary" onclick="viewSubmittedTimesheetHours('${escapeHtml(week.id)}')">View Hours</button>
                                    <button type="button" class="secondary" onclick="editSubmittedTimesheet('${escapeHtml(week.id)}')">Edit</button>
                                    <button type="button" onclick="resubmitSubmittedTimesheet('${escapeHtml(week.id)}')">Resubmit</button>
                                    <button type="button" class="delete-button" onclick="deleteSubmittedTimesheet('${escapeHtml(week.id)}')">Delete</button>
                                </div>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function trackSubmittedTimesheetGroup(details) {
    if (!details || details.dataset.autoOpen === "true") {
        return;
    }

    const workerKey = details.dataset.submittedWorkerKey;
    if (details.open) {
        submittedTimesheetOpenWorkers.add(workerKey);
    } else {
        submittedTimesheetOpenWorkers.delete(workerKey);
    }
}

function trackFinalSubmittedTimesheetPanel(details) {
    if (!details || details.dataset.autoOpen === "true") {
        return;
    }

    submittedTimesheetFinalPanelOpen = details.open;
}

function loadMoreSubmittedTimesheets(button) {
    const workerKey = button && button.dataset.submittedWorkerKey;
    if (!workerKey) {
        return;
    }

    submittedTimesheetVisibleCounts[workerKey] = (submittedTimesheetVisibleCounts[workerKey] || ADMIN_SUBMITTED_TIMESHEET_BATCH_SIZE) + ADMIN_SUBMITTED_TIMESHEET_BATCH_SIZE;
    submittedTimesheetOpenWorkers.add(workerKey);
    submittedTimesheetFinalPanelOpen = true;
    renderTimesheets();
}

function renderSubmittedTimesheetEmployeeGroups(rows, filter) {
    const groups = groupSubmittedTimesheetsByEmployee(rows);

    if (!groups.length) {
        return '<div class="small">No finalized submitted timesheets found.</div>';
    }

    return groups.map((group) => {
        const visibleCount = submittedTimesheetVisibleCounts[group.key] || ADMIN_SUBMITTED_TIMESHEET_BATCH_SIZE;
        const visibleWeeks = group.weeks.slice(0, visibleCount);
        const remaining = Math.max(0, group.weeks.length - visibleWeeks.length);
        const totalHours = group.weeks.reduce((total, week) => total + Number(week.total_hours || 0), 0);
        const autoOpen = Boolean(filter);
        const isOpen = autoOpen || submittedTimesheetOpenWorkers.has(group.key);

        return `
            <details class="timesheet-worker-group" data-submitted-worker-key="${escapeHtml(group.key)}" data-auto-open="${autoOpen}" ontoggle="trackSubmittedTimesheetGroup(this)"${isOpen ? " open" : ""}>
                <summary>
                    <span>
                        ${escapeHtml(group.name)}
                        <span class="timesheet-worker-meta">${group.weeks.length} submitted week${group.weeks.length === 1 ? "" : "s"} - ${totalHours.toFixed(2)} total hrs</span>
                    </span>
                    <span class="timesheet-worker-count" title="Submitted weeks">${group.weeks.length}</span>
                </summary>
                <div class="timesheet-worker-body">
                    ${renderSubmittedTimesheetTable(visibleWeeks)}
                    ${remaining ? `
                        <div class="actions timesheet-admin-actions--load-more">
                            <button type="button" class="secondary" data-submitted-worker-key="${escapeHtml(group.key)}" onclick="loadMoreSubmittedTimesheets(this)">Load ${Math.min(remaining, ADMIN_SUBMITTED_TIMESHEET_BATCH_SIZE)} more</button>
                            <span class="small">Showing ${visibleWeeks.length} of ${group.weeks.length} submitted weeks</span>
                        </div>
                    ` : ""}
                </div>
            </details>
        `;
    }).join("");
}

function renderTimesheets() {
    renderAdminTimeEntryOptions();

    const filter = document.getElementById("timesheetWorkerFilter").value.trim().toLowerCase();
    const list = document.getElementById("timesheetsList");
    const filtered = timesheets.filter((week) => !filter || String(week.worker_name || "").toLowerCase().includes(filter));
    const autoOpen = Boolean(filter);
    const submittedWeeksHtml = `
        <details class="timesheet-worker-group" data-final-submitted-timesheets data-auto-open="${autoOpen}" ontoggle="trackFinalSubmittedTimesheetPanel(this)"${autoOpen || submittedTimesheetFinalPanelOpen ? " open" : ""}>
            <summary>
                <span>
                    Final Submitted Timesheets
                    <span class="timesheet-worker-meta">${filtered.length} submitted week${filtered.length === 1 ? "" : "s"}</span>
                </span>
                <span class="timesheet-worker-count" title="Submitted weeks">${filtered.length}</span>
            </summary>
            <div class="timesheet-worker-body">
                ${renderSubmittedTimesheetEmployeeGroups(filtered, filter)}
            </div>
        </details>
    `;

    list.innerHTML = `
        ${renderLiveTimesheetEntries(filter)}
        ${submittedWeeksHtml}
    `;
}

function getAdminTimesheetEntryType(entry) {
    const explicitType = getTimesheetEntryValue(entry, "entryType", "entry_type", "");
    const jobName = String(getTimesheetEntryValue(entry, "jobName", "job_name", "") || "").toLowerCase();

    if (explicitType) {
        return explicitType;
    }

    if (jobName.includes("sick day")) {
        return "sick";
    }

    if (jobName.includes("vacation day")) {
        return "vacation";
    }

    if (jobName.includes("civic holiday") || jobName.includes("holiday")) {
        return "civic_holiday";
    }

    return "work";
}

function getAdminTimesheetLeaveNote(entry) {
    return getTimesheetEntryValue(entry, "leaveNote", "leave_note", "") || "";
}

function getAdminTimesheetLeaveType(entry) {
    return getTimesheetEntryValue(entry, "leaveType", "leave_type", "") || "";
}

function getAdminTimesheetEntryLabel(entry) {
    const type = getAdminTimesheetEntryType(entry);
    const leaveType = getAdminTimesheetLeaveType(entry);
    const leaveTypeLabel = leaveType === "half_day" ? "Half Day" : capitalizeWords(leaveType);

    if (type === "sick") {
        return "Sick Day";
    }

    if (type === "vacation") {
        return "Vacation Day" + (leaveType ? " - " + leaveTypeLabel : "");
    }

    if (type === "civic_holiday") {
        return "Civic Holiday";
    }

    return "Work";
}

function getAdminSpecialEntryJobName(entryType, leaveType) {
    if (entryType === "sick") {
        return "Sick";
    }

    if (entryType === "vacation") {
        return "Vacation Day" + (leaveType ? " - " + (leaveType === "half_day" ? "Half Day" : capitalizeWords(leaveType)) : "");
    }

    if (entryType === "civic_holiday") {
        return "Civic Holiday";
    }

    return "";
}

function capitalizeWords(value) {
    return String(value || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getAdminSickDayWorkerKey(account) {
    return normalizeWorkerName(account && (account.worker_key || account.display_name || account.email || ""));
}

function getAdminSickDayWorkerLabel(account) {
    const name = account && (account.display_name || account.worker_key || account.email || "Unknown Employee");
    const detail = account && account.email && account.email !== name ? " - " + account.email : "";
    return name + detail;
}

function renderAdminTimeEntryWorkerOptions() {
    const select = document.getElementById("adminTimeEntryWorker");

    if (!select) {
        return;
    }

    const previousValue = select.value;
    const approvedAccounts = getApprovedAccounts()
        .filter((account) => getAdminSickDayWorkerKey(account))
        .slice()
        .sort((a, b) => getAdminSickDayWorkerLabel(a).localeCompare(getAdminSickDayWorkerLabel(b)));

    select.innerHTML = approvedAccounts.length
        ? approvedAccounts.map((account) => {
            const key = getAdminSickDayWorkerKey(account);
            return `<option value="${escapeHtml(key)}">${escapeHtml(getAdminSickDayWorkerLabel(account))}</option>`;
        }).join("")
        : '<option value="">No approved employees found</option>';

    if (previousValue && approvedAccounts.some((account) => getAdminSickDayWorkerKey(account) === previousValue)) {
        select.value = previousValue;
    }
}

function renderAdminTimeEntryJobOptions() {
    const select = document.getElementById("adminTimeEntryJob");

    if (!select) {
        return;
    }

    const previousValue = select.value;
    const activeJobs = jobs
        .filter((job) => job.active !== false)
        .slice()
        .sort((a, b) => String(a.job_number || "").localeCompare(String(b.job_number || ""), undefined, { numeric: true }));

    select.innerHTML = '<option value="">Manual / no job selected</option>' + activeJobs.map((job) => {
        const number = String(job.job_number || "").trim();
        const name = String(job.job_name || "").trim();
        return '<option value="' + escapeHtml(job.id) + '">' + escapeHtml((number ? number + " - " : "") + name) + '</option>';
    }).join("");

    if (previousValue && activeJobs.some((job) => String(job.id) === previousValue)) {
        select.value = previousValue;
    }
}

function renderAdminTimeEntryOptions() {
    renderAdminTimeEntryWorkerOptions();
    renderAdminTimeEntryJobOptions();

    const dateInput = document.getElementById("adminTimeEntryDate");
    if (dateInput && !dateInput.value) {
        dateInput.value = formatAdminScheduleDateValue(new Date());
    }

    handleAdminTimeEntryTypeChange();
}

function getDigitsOnlyAdminTimesheetJobNumber(value) {
    return String(value || "").replace(/\D/g, "");
}

function isValidAdminTimesheetWorkJobNumber(value) {
    const jobNumber = String(value || "").trim();
    return !jobNumber || /^\d+$/.test(jobNumber);
}

function sanitizeAdminTimesheetJobNumberInput(input, entryTypeId) {
    const entryTypeInput = document.getElementById(entryTypeId);

    if (input && (!entryTypeInput || (entryTypeInput.value || "work") === "work")) {
        input.value = getDigitsOnlyAdminTimesheetJobNumber(input.value);
    }
}

function updateLiveTimesheetJobNumberMode() {
    const entryTypeInput = document.getElementById("liveTimesheetEntryType");
    const jobNumberInput = document.getElementById("liveTimesheetJobNumber");

    if (!entryTypeInput || !jobNumberInput) {
        return;
    }

    const isWork = (entryTypeInput.value || "work") === "work";
    jobNumberInput.inputMode = isWork ? "numeric" : "text";

    if (isWork) {
        jobNumberInput.setAttribute("pattern", "[0-9]*");
    } else {
        jobNumberInput.removeAttribute("pattern");
    }
}

function fillAdminTimeEntryJob() {
    const select = document.getElementById("adminTimeEntryJob");
    const job = select ? jobs.find((item) => item.id === select.value) : null;

    if (!job) {
        return;
    }

    document.getElementById("adminTimeEntryJobName").value = job.job_name || "";
    document.getElementById("adminTimeEntryJobNumber").value = getDigitsOnlyAdminTimesheetJobNumber(job.job_number);
}

function handleAdminTimeEntryDateChange() {
    setAdminTimeEntryStatus("");
}

function handleAdminTimeEntryTypeChange() {
    const typeInput = document.getElementById("adminTimeEntryType");

    if (!typeInput) {
        return;
    }

    const entryType = typeInput.value || "work";
    const vacationType = document.getElementById("adminTimeEntryLeaveType");
    const leaveType = vacationType ? vacationType.value : "";
    const isWork = entryType === "work";
    const needsClock = isWork || (entryType === "vacation" && leaveType === "half_day");

    document.querySelectorAll("[data-admin-time-work]").forEach((element) => {
        element.hidden = !isWork;
    });
    document.querySelectorAll("[data-admin-time-vacation]").forEach((element) => {
        element.hidden = entryType !== "vacation";
    });
    document.querySelectorAll("[data-admin-time-clock]").forEach((element) => {
        element.hidden = !needsClock;
    });
}

function resetAdminTimeEntryForm() {
    const workerSelect = document.getElementById("adminTimeEntryWorker");
    const dateInput = document.getElementById("adminTimeEntryDate");
    const typeInput = document.getElementById("adminTimeEntryType");
    const leaveTypeInput = document.getElementById("adminTimeEntryLeaveType");
    const jobSelect = document.getElementById("adminTimeEntryJob");

    if (dateInput) {
        dateInput.value = formatAdminScheduleDateValue(new Date());
    }
    if (typeInput) {
        typeInput.value = "work";
    }
    if (leaveTypeInput) {
        leaveTypeInput.value = "paid";
    }
    if (jobSelect) {
        jobSelect.value = "";
    }

    ["adminTimeEntryJobName", "adminTimeEntryJobNumber", "adminTimeEntryNote"].forEach((id) => {
        const input = document.getElementById(id);
        if (input) {
            input.value = "";
        }
    });

    const timeIn = document.getElementById("adminTimeEntryTimeIn");
    const timeOut = document.getElementById("adminTimeEntryTimeOut");
    const lunch = document.getElementById("adminTimeEntryLunch");
    const night = document.getElementById("adminTimeEntryNight");

    if (timeIn) {
        timeIn.value = "07:00";
    }
    if (timeOut) {
        timeOut.value = "15:30";
    }
    if (lunch) {
        lunch.checked = true;
    }
    if (night) {
        night.checked = false;
    }

    if (workerSelect && workerSelect.options.length) {
        workerSelect.selectedIndex = Math.max(workerSelect.selectedIndex, 0);
    }

    handleAdminTimeEntryTypeChange();
    setAdminTimeEntryStatus("");
}

function setAdminTimeEntryStatus(message, isError) {
    const status = document.getElementById("adminTimeEntryStatus");

    if (!status) {
        return;
    }

    status.textContent = message || "";
    status.style.color = isError ? "#b42318" : "";
}

function getAdminTimeEntryAdminName() {
    return currentWorkerDisplay || worker.display || worker.key || currentWorker || "Admin";
}

function getAdminTimeEntryDateForRow(row) {
    const date = getLiveTimesheetEntryDate(row);
    return date && !Number.isNaN(date.getTime()) ? formatAdminScheduleDateValue(date) : "";
}

function getAdminTimeEntryMinutes(value) {
    const parts = String(value || "").slice(0, 5).split(":").map(Number);

    if (parts.length !== 2 || parts.some((part) => Number.isNaN(part))) {
        return null;
    }

    return parts[0] * 60 + parts[1];
}

function isAdminTimedTimesheetRow(row) {
    return row && (row.entry_type === "work" || (row.entry_type === "vacation" && row.leave_type === "half_day"));
}

function doAdminTimeWindowsOverlap(first, second) {
    const firstStart = getAdminTimeEntryMinutes(first.time_in);
    let firstEnd = getAdminTimeEntryMinutes(first.time_out);
    const secondStart = getAdminTimeEntryMinutes(second.time_in);
    let secondEnd = getAdminTimeEntryMinutes(second.time_out);

    if (firstStart === null || firstEnd === null || secondStart === null || secondEnd === null) {
        return false;
    }

    if (firstEnd <= firstStart) {
        firstEnd += 24 * 60;
    }
    if (secondEnd <= secondStart) {
        secondEnd += 24 * 60;
    }

    return firstStart < secondEnd && firstEnd > secondStart;
}

function getAdminTimeEntryOverlap(row) {
    if (!isAdminTimedTimesheetRow(row)) {
        return null;
    }

    const rowDate = getAdminTimeEntryDateForRow(row);
    const rowWorker = normalizeWorkerName(row.worker_name);

    return liveTimesheetEntries.find((entry) =>
        normalizeWorkerName(entry.worker_name) === rowWorker &&
        getAdminTimeEntryDateForRow(entry) === rowDate &&
        isAdminTimedTimesheetRow(entry) &&
        doAdminTimeWindowsOverlap(entry, row)
    ) || null;
}

function getAdminTimeEntryDuplicate(row) {
    const rowDate = getAdminTimeEntryDateForRow(row);
    const rowWorker = normalizeWorkerName(row.worker_name);
    const rowJobName = normalizeWorkerName(row.job_name);
    const rowJobNumber = normalizeWorkerName(row.job_number);
    const rowType = normalizeWorkerName(row.entry_type || "work");
    const rowLeaveType = normalizeWorkerName(row.leave_type || "");

    return liveTimesheetEntries.find((entry) => {
        const entryType = normalizeWorkerName(entry.entry_type || "work");
        const sameWorkerDateType = normalizeWorkerName(entry.worker_name) === rowWorker &&
            getAdminTimeEntryDateForRow(entry) === rowDate &&
            entryType === rowType;

        if (!sameWorkerDateType) {
            return false;
        }

        if (rowType !== "work") {
            return normalizeWorkerName(entry.leave_type || "") === rowLeaveType;
        }

        return normalizeWorkerName(entry.job_name) === rowJobName &&
            normalizeWorkerName(entry.job_number) === rowJobNumber &&
            String(entry.time_in || "").slice(0, 5) === String(row.time_in || "").slice(0, 5) &&
            String(entry.time_out || "").slice(0, 5) === String(row.time_out || "").slice(0, 5) &&
            Math.abs(Number(entry.hours || 0) - Number(row.hours || 0)) < 0.005;
    }) || null;
}

function isMissingAdminTimeAuditColumnError(error) {
    const text = [
        error && error.message,
        error && error.details,
        error && error.hint
    ].join(" ").toLowerCase();

    return text.includes("schema cache") && (
        text.includes("admin_entered_by") ||
        text.includes("admin_entered_at") ||
        text.includes("admin_entry_note")
    );
}

function buildAdminTimeEntryRow() {
    const workerKey = document.getElementById("adminTimeEntryWorker").value;
    const dateValue = document.getElementById("adminTimeEntryDate").value;
    const entryType = document.getElementById("adminTimeEntryType").value || "work";
    const leaveType = entryType === "vacation" ? document.getElementById("adminTimeEntryLeaveType").value || "paid" : "";
    const note = document.getElementById("adminTimeEntryNote").value.trim();
    const selectedDate = makeLocalDate(dateValue);

    if (!workerKey || !dateValue || Number.isNaN(selectedDate.getTime())) {
        return { error: "Choose an employee and valid date." };
    }

    const weekStartDate = getAdminTimesheetWeekStartForDate(selectedDate);
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekStartDate.getDate() + 6);

    const timeIn = document.getElementById("adminTimeEntryTimeIn").value;
    const timeOut = document.getElementById("adminTimeEntryTimeOut").value;
    const tookLunch = document.getElementById("adminTimeEntryLunch").checked;
    const nightWork = document.getElementById("adminTimeEntryNight").checked;
    const needsClock = entryType === "work" || (entryType === "vacation" && leaveType === "half_day");
    let jobName = document.getElementById("adminTimeEntryJobName").value.trim();
    let jobNumber = document.getElementById("adminTimeEntryJobNumber").value.trim();
    let hours = 0.01;

    if (entryType === "work") {
        if (!jobName || !timeIn || !timeOut) {
            return { error: "For work hours, fill in job name, time in, and time out." };
        }

        if (!isValidAdminTimesheetWorkJobNumber(jobNumber)) {
            return { error: "Job Number can contain numbers only. Leave it blank for Shop work." };
        }

        hours = calculateAdminTimesheetHours(timeIn, timeOut, tookLunch);

        if (hours <= 0) {
            return { error: "The time in/time out does not create any hours." };
        }
    } else {
        jobName = getAdminSpecialEntryJobName(entryType, leaveType);
        jobNumber = note || jobName;

        if (entryType === "vacation" && !leaveType) {
            return { error: "Choose the vacation type." };
        }

        if (needsClock) {
            if (!timeIn || !timeOut) {
                return { error: "Choose time in and time out for the half-day vacation." };
            }

            hours = calculateAdminTimesheetHours(timeIn, timeOut, false);

            if (hours <= 0) {
                return { error: "The half-day vacation time does not create any hours." };
            }
        }
    }

    return {
        row: {
            worker_name: workerKey,
            week_start: formatAdminScheduleDateValue(weekStartDate),
            week_end: formatTimesheetPdfDate(weekEndDate),
            job_name: jobName,
            job_number: jobNumber,
            day_of_week: getTimesheetDayNames()[selectedDate.getDay()],
            time_in: needsClock ? timeIn : (entryType === "sick" ? "07:00" : "00:00"),
            time_out: needsClock ? timeOut : (entryType === "sick" ? "12:00" : "00:00"),
            hours,
            took_lunch: entryType === "work" ? tookLunch : false,
            night_work: entryType === "work" ? nightWork : false,
            entry_type: entryType,
            leave_type: entryType === "vacation" ? leaveType : "",
            leave_note: note
        },
        note
    };
}

async function addAdminTimeEntryToTimesheet() {
    if (!supabaseClient) {
        setAdminTimeEntryStatus("Supabase is not available. Time could not be saved.", true);
        return;
    }

    const buildResult = buildAdminTimeEntryRow();

    if (buildResult.error) {
        setAdminTimeEntryStatus(buildResult.error, true);
        return;
    }

    const row = buildResult.row;
    const duplicate = getAdminTimeEntryDuplicate(row);

    if (duplicate) {
        setAdminTimeEntryStatus("Duplicate blocked. This employee already has the same entry saved for that date.", true);
        return;
    }

    const overlap = getAdminTimeEntryOverlap(row);

    if (overlap) {
        setAdminTimeEntryStatus("Overlapping time blocked. This employee already has time saved during that window.", true);
        return;
    }

    const auditValues = {
        admin_entered_by: getAdminTimeEntryAdminName(),
        admin_entered_at: new Date().toISOString(),
        admin_entry_note: buildResult.note || ""
    };

    setAdminTimeEntryStatus("Saving employee time...");

    let result = await supabaseClient
        .from("timesheet_entries")
        .insert({ ...row, ...auditValues })
        .select()
        .single();
    let auditSaved = true;

    if (result.error && isMissingAdminTimeAuditColumnError(result.error)) {
        auditSaved = false;
        result = await supabaseClient
            .from("timesheet_entries")
            .insert(row)
            .select()
            .single();
    }

    if (result.error) {
        setAdminTimeEntryStatus("Employee time could not be saved: " + result.error.message, true);
        return;
    }

    if (result.data) {
        liveTimesheetEntries = [result.data].concat(liveTimesheetEntries);
    }

    resetAdminTimeEntryForm();
    setAdminTimeEntryStatus(
        "Employee time saved." + (auditSaved ? "" : " Run supabase-timesheet-admin-entry-audit.sql to save admin audit fields too."),
        !auditSaved
    );
    renderTimesheets();
    renderSickDays();
    renderEmployeeProfile();
    renderPortalSummary();
}

function renderAdminSickDayWorkerOptions() {
    const select = document.getElementById("adminSickDayWorker");

    if (!select) {
        return;
    }

    const previousValue = select.value;
    const approvedAccounts = getApprovedAccounts()
        .filter((account) => getAdminSickDayWorkerKey(account))
        .slice()
        .sort((a, b) => getAdminSickDayWorkerLabel(a).localeCompare(getAdminSickDayWorkerLabel(b)));

    select.innerHTML = approvedAccounts.length
        ? approvedAccounts.map((account) => {
            const key = getAdminSickDayWorkerKey(account);
            return `<option value="${escapeHtml(key)}">${escapeHtml(getAdminSickDayWorkerLabel(account))}</option>`;
        }).join("")
        : '<option value="">No approved employees found</option>';

    if (previousValue && approvedAccounts.some((account) => getAdminSickDayWorkerKey(account) === previousValue)) {
        select.value = previousValue;
    }

    const dateInput = document.getElementById("adminSickDayDate");
    if (dateInput && !dateInput.value) {
        dateInput.value = formatAdminScheduleDateValue(new Date());
    }
}

function getAdminTimesheetWeekStartForDate(date) {
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
}

function hasAdminSickDayForDate(workerKey, dateValue) {
    const selectedDate = makeLocalDate(dateValue);
    const selectedDateText = formatAdminScheduleDateValue(selectedDate);

    return buildAdminSickDayRows().some((row) =>
        normalizeWorkerName(row.worker) === normalizeWorkerName(workerKey) &&
        row.date &&
        formatAdminScheduleDateValue(row.date) === selectedDateText
    );
}

function setAdminSickDayStatus(message, isError) {
    const status = document.getElementById("adminSickDayStatus");

    if (!status) {
        return;
    }

    status.textContent = message || "";
    status.style.color = isError ? "#b42318" : "";
}

async function addAdminSickDayToTimesheet() {
    if (!supabaseClient) {
        setAdminSickDayStatus("Supabase is not available. Sick day could not be saved.", true);
        return;
    }

    const workerSelect = document.getElementById("adminSickDayWorker");
    const dateInput = document.getElementById("adminSickDayDate");
    const reasonInput = document.getElementById("adminSickDayReason");
    const workerKey = workerSelect ? workerSelect.value : "";
    const dateValue = dateInput ? dateInput.value : "";
    const reason = reasonInput ? reasonInput.value.trim() : "";

    if (!workerKey || !dateValue) {
        setAdminSickDayStatus("Choose an employee and sick date.", true);
        return;
    }

    if (hasAdminSickDayForDate(workerKey, dateValue)) {
        setAdminSickDayStatus("That employee already has a sick day saved for this date.", true);
        return;
    }

    const selectedDate = makeLocalDate(dateValue);

    if (Number.isNaN(selectedDate.getTime())) {
        setAdminSickDayStatus("Choose a valid sick date.", true);
        return;
    }

    const weekStartDate = getAdminTimesheetWeekStartForDate(selectedDate);
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekStartDate.getDate() + 6);
    const row = {
        worker_name: workerKey,
        week_start: formatAdminScheduleDateValue(weekStartDate),
        week_end: formatTimesheetPdfDate(weekEndDate),
        job_name: "Sick",
        job_number: reason || "Sick",
        day_of_week: getTimesheetDayNames()[selectedDate.getDay()],
        time_in: "07:00",
        time_out: "12:00",
        hours: 0.01,
        took_lunch: false,
        night_work: false,
        entry_type: "sick",
        leave_type: "",
        leave_note: ""
    };

    setAdminSickDayStatus("Saving sick day...");

    const { data, error } = await supabaseClient
        .from("timesheet_entries")
        .insert(row)
        .select()
        .single();

    if (error) {
        setAdminSickDayStatus("Sick day could not be saved: " + error.message, true);
        return;
    }

    if (data) {
        liveTimesheetEntries = [data].concat(liveTimesheetEntries);
    }

    if (reasonInput) {
        reasonInput.value = "";
    }

    setAdminSickDayStatus("Sick day saved to " + workerKey + "'s timesheet.");
    renderTimesheets();
    renderSickDays();
    renderEmployeeProfile();
    renderPortalSummary();
}

function buildAdminSickDayRows() {
    const liveRows = liveTimesheetEntries
        .filter((entry) => getAdminTimesheetEntryType(entry) === "sick")
        .map((entry) => ({
            id: entry.id || "",
            source: "live",
            worker: entry.worker_name || "",
            day: entry.day_of_week || "",
            date: getLiveTimesheetEntryDate(entry),
            reason: getAdminTimesheetLeaveNote(entry) || entry.job_number || "",
            status: "Current Week",
            submitted: entry.created_at || ""
        }));

    const submittedRows = [];

    timesheets.forEach((week) => {
        const entries = Array.isArray(week.entries) ? week.entries : [];

        entries
            .map((entry, index) => ({ entry, index }))
            .filter((item) => getAdminTimesheetEntryType(item.entry) === "sick")
            .forEach((item) => {
                const entry = item.entry;
                submittedRows.push({
                    id: week.id + "::" + item.index,
                    source: "submitted",
                    weekId: week.id,
                    entryIndex: item.index,
                    worker: week.worker_name || getTimesheetEntryValue(entry, "user", "worker_name", ""),
                    day: getTimesheetEntryValue(entry, "day", "day_of_week", ""),
                    date: getTimesheetEntryDateFromEntry(entry),
                    reason: getAdminTimesheetLeaveNote(entry) || getTimesheetEntryValue(entry, "jobNumber", "job_number", ""),
                    status: "Submitted",
                    submitted: week.submitted_at || ""
                });
            });
    });

    return liveRows.concat(submittedRows).sort((a, b) => {
        const workerDifference = String(a.worker).localeCompare(String(b.worker));

        if (workerDifference !== 0) {
            return workerDifference;
        }

        return String(b.submitted || "").localeCompare(String(a.submitted || ""));
    });
}

function getTimesheetEntryDateFromEntry(entry) {
    const weekStart = getTimesheetEntryValue(entry, "weekStartValue", "week_start", "");
    const day = getTimesheetEntryValue(entry, "day", "day_of_week", "");

    if (!weekStart || !day) {
        return null;
    }

    const date = makeLocalDate(weekStart);
    const dayIndex = getTimesheetDayNames().indexOf(day);

    if (dayIndex < 0 || Number.isNaN(date.getTime())) {
        return null;
    }

    date.setDate(date.getDate() + dayIndex);
    return date;
}

function renderSickDays() {
    const list = document.getElementById("sickDaysList");

    if (!list) {
        return;
    }

    renderAdminSickDayWorkerOptions();

    const filter = document.getElementById("sickDaysWorkerFilter").value.trim().toLowerCase();
    const rows = buildAdminSickDayRows().filter((row) => !filter || String(row.worker || "").toLowerCase().includes(filter));

    if (!rows.length) {
        list.innerHTML = '<div class="small">No sick days found yet.</div>';
        return;
    }

    const workers = [...new Set(rows.map((row) => row.worker || "Unknown Worker"))];

    list.innerHTML = workers.map((worker) => {
        const workerRows = rows.filter((row) => (row.worker || "Unknown Worker") === worker);

        return `
            <h3>${escapeHtml(worker)} - ${workerRows.length} sick day${workerRows.length === 1 ? "" : "s"}</h3>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Day</th>
                            <th>Reason</th>
                            <th>Status</th>
                            <th>Saved / Submitted</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${workerRows.map((row) => `
                            <tr>
                                <td>${row.date ? escapeHtml(formatTimesheetPdfDate(row.date)) : ""}</td>
                                <td>${escapeHtml(row.day)}</td>
                                <td>${escapeHtml(row.reason)}</td>
                                <td>${escapeHtml(row.status)}</td>
                                <td>${escapeHtml(formatDate(row.submitted))}</td>
                                <td><button type="button" class="delete-button" onclick="deleteAdminSickDay('${escapeHtml(row.id)}')">Delete</button></td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }).join("");
}

async function deleteAdminSickDay(rowId) {
    const row = buildAdminSickDayRows().find((item) => item.id === rowId);

    if (!row) {
        alert("Sick day could not be found.");
        return;
    }

    const confirmed = confirm("Delete this sick day?\n\n" + row.worker + " - " + row.day + "\n" + (row.reason || ""));

    if (!confirmed) {
        return;
    }

    if (row.source === "live") {
        const { error } = await supabaseClient
            .from("timesheet_entries")
            .delete()
            .eq("id", row.id);

        if (error) {
            alert("Sick day could not be deleted.");
            return;
        }

        liveTimesheetEntries = liveTimesheetEntries.filter((entry) => entry.id !== row.id);
        renderTimesheets();
        renderSickDays();
        renderEmployeeProfile();
        renderPortalSummary();
        return;
    }

    const week = timesheets.find((item) => item.id === row.weekId);

    if (!week || !Array.isArray(week.entries)) {
        alert("Submitted sick day could not be found.");
        return;
    }

    const entries = week.entries.filter((entry, index) => index !== row.entryIndex);
    const totalHours = entries.reduce((total, entry) => total + Number(getTimesheetEntryValue(entry, "hours", "hours", 0)), 0);
    const { error } = await supabaseClient
        .from("previous_timesheet_weeks")
        .update({
            entries,
            total_hours: totalHours
        })
        .eq("id", row.weekId);

    if (error) {
        alert("Submitted sick day could not be deleted.");
        return;
    }

    week.entries = entries;
    week.total_hours = totalHours;
    renderTimesheets();
    renderSickDays();
    renderEmployeeProfile();
    renderPortalSummary();
}

async function loadLiveTimesheetEntries() {
    const list = document.getElementById("timesheetsList");

    if (list) {
        list.textContent = "Refreshing live timesheet entries...";
    }

    const { data, error } = await supabaseClient
        .from("timesheet_entries")
        .select("*")
        .order("week_start", { ascending: false })
        .order("created_at", { ascending: false });

    if (error) {
        if (list) {
            list.textContent = "Live timesheet entries could not be loaded.";
        }
        return;
    }

    liveTimesheetEntries = data || [];
    renderTimesheets();
    renderSickDays();
}

function getLiveTimesheetEntryDate(entry) {
    const weekStart = entry.week_start || "";
    const day = entry.day_of_week || "";

    if (!weekStart || !day) {
        return null;
    }

    const date = makeLocalDate(weekStart);
    const dayIndex = getTimesheetDayNames().indexOf(day);

    if (dayIndex < 0 || Number.isNaN(date.getTime())) {
        return null;
    }

    if (date.getDay() !== 0 && getTimesheetDayNames()[date.getDay()] === day) {
        return date;
    }

    date.setDate(date.getDate() + dayIndex);
    return date;
}

function formatAdminLiveTimesheetWeekLabel(weekStart) {
    if (!weekStart) {
        return "Week not set";
    }

    const startDate = makeLocalDate(weekStart);

    if (Number.isNaN(startDate.getTime())) {
        return weekStart;
    }

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    return "Week of " + formatTimesheetPdfDate(startDate) + " to " + formatTimesheetPdfDate(endDate);
}

function getAdminLiveTimesheetWeekLabel(weekStart) {
    const startDate = makeLocalDate(weekStart);

    if (!weekStart || Number.isNaN(startDate.getTime())) {
        return weekStart || "Week not set";
    }

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    return formatTimesheetPdfDate(startDate) + " to " + formatTimesheetPdfDate(endDate);
}

function getAdminLiveTimesheetWeekRows(worker, weekStart) {
    const workerKey = normalizeWorkerName(worker);

    return liveTimesheetEntries.filter((entry) => {
        return normalizeWorkerName(entry.worker_name) === workerKey && String(entry.week_start || "") === String(weekStart || "");
    });
}

function getAdminLiveTimesheetMissingWeekdays(entries) {
    const requiredDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    const coveredDays = new Set((entries || []).map((entry) => entry.day_of_week).filter(Boolean));
    return requiredDays.filter((day) => !coveredDays.has(day));
}

function getAdminTimesheetLongDays(entries) {
    const dailyHours = new Map();

    (entries || []).forEach((entry) => {
        const entryType = getAdminTimesheetEntryType(entry);
        const isTimedEntry = entryType === "work" || (entryType === "vacation" && getAdminTimesheetLeaveType(entry) === "half_day");

        if (!isTimedEntry) {
            return;
        }

        const day = String(getTimesheetEntryValue(entry, "day", "day_of_week", "") || "").trim();

        if (!day) {
            return;
        }

        const hours = Number(getTimesheetEntryValue(entry, "hours", "hours", 0)) || 0;
        dailyHours.set(day, (dailyHours.get(day) || 0) + hours);
    });

    return getTimesheetEmailDayOrder().map((day) => ({
        day,
        hours: dailyHours.get(day) || 0
    })).filter((item) => item.hours > 14);
}

function confirmAdminTimesheetLongDays(entries, worker) {
    const longDays = getAdminTimesheetLongDays(entries);

    if (!longDays.length) {
        return true;
    }

    const details = longDays.map((item) => item.day + ": " + item.hours.toFixed(2) + " hours").join("\n");

    return confirm(
        "The timesheet for " + worker + " has more than 14 hours recorded in one day:\n\n" +
        details +
        "\n\nAre these hours correct?\n\nSelect OK to continue submitting, or Cancel to review the entries."
    );
}

function getSubmittedTimesheetWeekStart(week) {
    const entries = week && Array.isArray(week.entries) ? week.entries : [];
    const firstEntry = entries.find((entry) => getTimesheetEntryValue(entry, "weekStartValue", "week_start", ""));
    return firstEntry ? String(getTimesheetEntryValue(firstEntry, "weekStartValue", "week_start", "")) : "";
}

function isAdminLiveTimesheetWeekSubmitted(worker, weekStart) {
    const workerKey = normalizeWorkerName(worker);
    const weekLabel = getAdminLiveTimesheetWeekLabel(weekStart);

    return timesheets.some((week) => {
        if (normalizeWorkerName(week.worker_name) !== workerKey) {
            return false;
        }

        const submittedWeekStart = getSubmittedTimesheetWeekStart(week);
        return submittedWeekStart
            ? submittedWeekStart === weekStart
            : String(week.week_label || "") === weekLabel;
    });
}

function canAdminSubmitLiveTimesheetWeek(worker, weekStart) {
    const entries = getAdminLiveTimesheetWeekRows(worker, weekStart);
    return Boolean(entries.length) &&
        !getAdminLiveTimesheetMissingWeekdays(entries).length &&
        !isAdminLiveTimesheetWeekSubmitted(worker, weekStart);
}

function renderAdminLiveTimesheetSubmitButton(worker, weekStart) {
    if (!canAdminSubmitLiveTimesheetWeek(worker, weekStart)) {
        return "";
    }

    return `
        <button type="button" data-worker="${escapeHtml(worker)}" data-week-start="${escapeHtml(weekStart)}" onclick="submitAdminLiveTimesheetWeek(this)">
            Submit Timesheet
        </button>
    `;
}

function convertAdminLiveEntryForArchive(entry) {
    const startDate = makeLocalDate(entry.week_start);

    return {
        id: entry.id,
        user: entry.worker_name,
        weekStartValue: entry.week_start,
        weekStart: Number.isNaN(startDate.getTime()) ? entry.week_start : formatTimesheetPdfDate(startDate),
        weekEnd: entry.week_end,
        jobName: entry.job_name,
        jobNumber: entry.job_number,
        day: entry.day_of_week,
        timeIn: entry.time_in ? String(entry.time_in).slice(0, 5) : "00:00",
        timeOut: entry.time_out ? String(entry.time_out).slice(0, 5) : "00:00",
        hours: Number(entry.hours || 0),
        tookLunch: Boolean(entry.took_lunch),
        nightWork: Boolean(entry.night_work),
        entryType: entry.entry_type || "",
        leaveType: entry.leave_type || "",
        leaveNote: entry.leave_note || entry.admin_entry_note || "",
        vacationRequestId: entry.vacation_request_id || ""
    };
}

function getAdminTimesheetSubmissionRecipients(worker) {
    const recipients = ADMIN_TIMESHEET_RESUBMIT_RECIPIENTS.slice();
    const workerKey = normalizeWorkerName(worker);
    const account = accounts.find((item) => [item.worker_key, item.display_name, item.email]
        .map(normalizeWorkerName)
        .includes(workerKey));
    const employeeEmail = String(account && account.email || "").trim().toLowerCase();

    if (employeeEmail && !recipients.some((email) => email.toLowerCase() === employeeEmail)) {
        recipients.push(employeeEmail);
    }

    return recipients;
}

async function submitAdminLiveTimesheetWeek(button) {
    const worker = button && button.dataset.worker || "";
    const weekStart = button && button.dataset.weekStart || "";
    const liveEntries = getAdminLiveTimesheetWeekRows(worker, weekStart);
    const missingWeekdays = getAdminLiveTimesheetMissingWeekdays(liveEntries);

    if (!worker || !weekStart || !liveEntries.length) {
        alert("This live timesheet could not be found. Refresh the entries and try again.");
        return;
    }

    if (missingWeekdays.length) {
        alert("This timesheet is not ready to submit. Missing: " + missingWeekdays.join(", ") + ".");
        renderTimesheets();
        return;
    }

    if (isAdminLiveTimesheetWeekSubmitted(worker, weekStart)) {
        alert("This timesheet has already been submitted.");
        renderTimesheets();
        return;
    }

    if (!confirmAdminTimesheetLongDays(liveEntries, worker)) {
        return;
    }

    const noteResponse = prompt(
        "Add a note for " + worker + "'s weekly timesheet before submitting.\n\nLeave it blank if there is nothing to add.",
        ""
    );

    if (noteResponse === null || !confirm("Submit this completed timesheet for " + worker + "?")) {
        return;
    }

    const originalButtonText = button.textContent;
    button.disabled = true;
    button.textContent = "Submitting...";

    const entries = liveEntries.map(convertAdminLiveEntryForArchive);
    const weekLabel = getAdminLiveTimesheetWeekLabel(weekStart);
    const totalHours = entries.reduce((total, entry) => total + Number(entry.hours || 0), 0);
    const note = noteResponse.trim();
    const archivePayload = {
        worker_name: worker,
        week_label: weekLabel,
        entries,
        total_hours: totalHours,
        note
    };

    try {
        const { data: savedWeek, error: insertError } = await supabaseClient
            .from("previous_timesheet_weeks")
            .insert(archivePayload)
            .select("*")
            .single();

        if (insertError) {
            throw insertError;
        }

        const { error: deleteError } = await supabaseClient
            .from("timesheet_entries")
            .delete()
            .eq("worker_name", worker)
            .eq("week_start", weekStart);

        const archivedWeek = Object.assign({
            submitted_at: new Date().toISOString()
        }, archivePayload, savedWeek || {});
        timesheets = [archivedWeek].concat(timesheets);
        liveTimesheetEntries = liveTimesheetEntries.filter((entry) => {
            return !(normalizeWorkerName(entry.worker_name) === normalizeWorkerName(worker) && String(entry.week_start || "") === weekStart);
        });
        renderTimesheets();

        const subject = "Timesheet - " + worker + " - " + weekLabel;
        const body = buildAdminTimesheetEmailBody(archivedWeek, totalHours);
        const pdfHtml = buildAdminTimesheetPdfHtml(archivedWeek, totalHours);

        try {
            await fetch(TIMESHEET_EMAIL_SCRIPT_URL, {
                method: "POST",
                mode: "no-cors",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify({
                    to: getAdminTimesheetSubmissionRecipients(worker).join(","),
                    subject,
                    body,
                    text: body,
                    pdfHtml,
                    pdfFileName: "timesheet-" + makeSafeEmailFileName(worker + "-" + weekLabel) + ".pdf",
                    worker,
                    weekLabel,
                    source: "admin_submit"
                })
            });
        } catch (emailError) {
            alert("The timesheet was submitted, but the email could not be sent.");
            return;
        }

        if (deleteError) {
            alert("The timesheet was submitted, but its live entries could not be cleared. Refresh the page before making changes.");
            return;
        }

        alert("Timesheet submitted for " + worker + ".");
    } catch (error) {
        alert("This timesheet could not be submitted. Please refresh and try again.");
        button.disabled = false;
        button.textContent = originalButtonText;
    }
}

function getAdminLiveGroupedKey(row) {
    return [
        row.weekStart || "",
        row.day || "",
        row.jobName || "",
        row.jobNumber || "",
        getAdminTimesheetEntryLabel(row),
        row.leaveNote || ""
    ].map((value) => String(value || "").trim().toLowerCase()).join("||");
}

function groupAdminLiveTimesheetRows(rows) {
    const groups = [];
    const byKey = new Map();

    rows.forEach((row) => {
        const key = getAdminLiveGroupedKey(row);
        let group = byKey.get(key);

        if (!group) {
            group = {
                ...row,
                rows: [],
                hours: 0,
                lunch: false,
                nightWork: false
            };
            byKey.set(key, group);
            groups.push(group);
        }

        group.rows.push(row);
        group.hours += Number(row.hours || 0);
        group.lunch = group.lunch || row.lunch;
        group.nightWork = group.nightWork || row.nightWork;
    });

    return groups.map((group) => ({
        ...group,
        adminEnteredBy: Array.from(new Set(group.rows.map((row) => row.adminEnteredBy).filter(Boolean))).join(", "),
        timeText: group.rows
            .map((row) => row.entryType === "work" || row.leaveType === "half_day" ? row.timeIn + " - " + row.timeOut : "")
            .filter(Boolean)
            .join("; ")
    }));
}

function sortAdminLiveWeekStarts(weekStarts, currentWeekStart) {
    return weekStarts.slice().sort((a, b) => {
        if (a === currentWeekStart && b !== currentWeekStart) {
            return -1;
        }

        if (b === currentWeekStart && a !== currentWeekStart) {
            return 1;
        }

        const aIsFuture = String(a || "") > String(currentWeekStart || "");
        const bIsFuture = String(b || "") > String(currentWeekStart || "");

        if (aIsFuture !== bIsFuture) {
            return aIsFuture ? 1 : -1;
        }

        return aIsFuture
            ? String(a || "").localeCompare(String(b || ""))
            : String(b || "").localeCompare(String(a || ""));
    });
}

function isAdminLeaveTimesheetEntry(row) {
    const type = getAdminTimesheetEntryType(row);
    return type === "sick" || type === "vacation" || type === "civic_holiday";
}

function renderLiveTimesheetEntries(filter) {
    const rows = liveTimesheetEntries
        .filter((entry) => !filter || String(entry.worker_name || "").toLowerCase().includes(filter))
        .map((entry) => ({
            id: entry.id || "",
            worker: entry.worker_name || "",
            weekStart: entry.week_start || "",
            day: entry.day_of_week || "",
            date: getLiveTimesheetEntryDate(entry),
            jobName: entry.job_name || "",
            jobNumber: entry.job_number || "",
            entryType: entry.entry_type || "work",
            leaveType: entry.leave_type || "",
            leaveNote: entry.leave_note || entry.admin_entry_note || "",
            adminEnteredBy: entry.admin_entered_by || "",
            adminEnteredAt: entry.admin_entered_at || "",
            timeIn: String(entry.time_in || "").slice(0, 5),
            timeOut: String(entry.time_out || "").slice(0, 5),
            lunch: Boolean(entry.took_lunch),
            nightWork: Boolean(entry.night_work),
            hours: Number(entry.hours || 0),
            createdAt: entry.created_at || ""
        }));
    const currentWeekStart = getCurrentWeekStartForSummary();

    rows.sort((a, b) => {
        const workerDifference = String(a.worker).localeCompare(String(b.worker));

        if (workerDifference !== 0) {
            return workerDifference;
        }

        const weekDifference = String(b.weekStart).localeCompare(String(a.weekStart));

        if (weekDifference !== 0) {
            return weekDifference;
        }

        const dayDifference = getTimesheetDayNames().indexOf(a.day) - getTimesheetDayNames().indexOf(b.day);

        if (dayDifference !== 0) {
            return dayDifference;
        }

        return String(a.timeIn).localeCompare(String(b.timeIn));
    });

    const currentRows = rows.filter((row) => row.weekStart === currentWeekStart);
    const olderRows = rows.filter((row) => row.weekStart !== currentWeekStart && !isAdminLeaveTimesheetEntry(row));

    function renderWorkerGroups(groupRows, options) {
        const settings = options || {};
        const workers = [...new Set(groupRows.map((row) => row.worker || "Unknown Worker"))];

        return workers.map((worker) => {
            const workerRows = groupRows.filter((row) => (row.worker || "Unknown Worker") === worker);
            const summaryRows = settings.older ? workerRows : workerRows.filter((row) => row.weekStart === currentWeekStart);
            const workerTotal = summaryRows.reduce((total, row) => total + row.hours, 0);
            const submittedDayCount = new Set(summaryRows.map((row) => row.day).filter(Boolean)).size;
            const workerMeta = settings.older
                ? workerRows.length + " older entr" + (workerRows.length === 1 ? "y" : "ies") + " - " + workerTotal.toFixed(2) + " hrs"
                : workerTotal.toFixed(2) + " hrs saved this week - " + submittedDayCount + " day" + (submittedDayCount === 1 ? "" : "s") + " submitted";
            const workerCount = settings.older ? 1 : submittedDayCount;
            const workerCountTitle = settings.older ? "Worker with older live entries" : "Submitted days";
            const weekStarts = sortAdminLiveWeekStarts([...new Set(workerRows.map((row) => row.weekStart || ""))], currentWeekStart);

            return `
                <details class="timesheet-worker-group" ${filter || settings.open ? "open" : ""}>
                    <summary>
                        <span>
                            ${escapeHtml(worker)}
                            <span class="timesheet-worker-meta">${escapeHtml(workerMeta)}</span>
                        </span>
                        <span class="timesheet-worker-count" title="${escapeHtml(workerCountTitle)}">${workerCount}</span>
                    </summary>
                    <div class="timesheet-worker-body">
                        ${weekStarts.map((weekStart) => {
                            const weekRows = workerRows.filter((row) => (row.weekStart || "") === weekStart);
                            const weekTotal = weekRows.reduce((total, row) => total + row.hours, 0);
                            const days = getTimesheetDayNames().filter((day) => weekRows.some((row) => row.day === day));

                            return `
                                <div class="timesheet-live-week-heading">
                                    <div class="timesheet-live-week-title">
                                        ${escapeHtml(formatAdminLiveTimesheetWeekLabel(weekStart))} - ${weekTotal.toFixed(2)} hrs
                                    </div>
                                    ${renderAdminLiveTimesheetSubmitButton(worker, weekStart)}
                                </div>
                                ${days.map((day) => {
                                    const dayRows = weekRows.filter((row) => row.day === day);
                                    const dayTotal = dayRows.reduce((total, row) => total + row.hours, 0);
                                    const dayDate = dayRows.find((row) => row.date);
                                    const groupedDayRows = groupAdminLiveTimesheetRows(dayRows);

                                    return `
                                        <div class="timesheet-live-day-title">
                                            ${escapeHtml(day)}${dayDate && dayDate.date ? " - " + escapeHtml(formatTimesheetPdfDate(dayDate.date)) : ""} - ${dayTotal.toFixed(2)} hrs
                                        </div>
                                        <div class="table-wrap">
                                            <table>
                                                <thead>
                                                    <tr>
                                                        <th>Job</th>
                                                        <th>Job Number</th>
                                                        <th>Type</th>
                                                        <th>Reason / Note</th>
                                                        <th>Time</th>
                                                        <th>Lunch</th>
                                                        <th>Night</th>
                                                        <th>Hours</th>
                                                        <th>Week Start</th>
                                                        <th>Entered By</th>
                                                        <th>Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    ${groupedDayRows.map((row) => `
                                                        <tr>
                                                            <td>${escapeHtml(row.jobName)}</td>
                                                            <td>${escapeHtml(row.jobNumber)}</td>
                                                            <td>${escapeHtml(getAdminTimesheetEntryLabel(row))}</td>
                                                            <td>${escapeHtml(row.leaveNote || "")}</td>
                                                            <td>${escapeHtml(row.timeText || "")}</td>
                                                            <td>${row.lunch ? "Yes" : "No"}</td>
                                                            <td>${row.nightWork ? "Yes" : "No"}</td>
                                                            <td>${row.hours.toFixed(2)}</td>
                                                            <td>${escapeHtml(row.weekStart)}</td>
                                                            <td>${escapeHtml(row.adminEnteredBy || "-")}</td>
                                                            <td>
                                                                <div class="actions">
                                                                    ${row.rows.map((entryRow, index) => `
                                                                        <button type="button" class="secondary" onclick="editLiveTimesheetEntry('${escapeHtml(entryRow.id)}')">Edit${row.rows.length > 1 ? " " + (index + 1) : ""}</button>
                                                                        <button type="button" class="delete-button" onclick="deleteLiveTimesheetEntry('${escapeHtml(entryRow.id)}')">Delete${row.rows.length > 1 ? " " + (index + 1) : ""}</button>
                                                                    `).join("")}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    `).join("")}
                                                </tbody>
                                            </table>
                                        </div>
                                    `;
                                }).join("")}
                            `;
                        }).join("")}
                    </div>
                </details>
            `;
        }).join("");
    }

    const currentHtml = currentRows.length
        ? renderWorkerGroups(currentRows)
        : '<div class="small timesheet-admin-copy--empty">No current-week live entries found.</div>';
    const olderWorkerCount = new Set(olderRows.map((row) => row.worker || "Unknown Worker")).size;
    notifyOlderTimesheetEntries(olderRows, olderWorkerCount);
    const olderHtml = olderRows.length
        ? `
            <details class="timesheet-worker-group" ${filter ? "open" : ""}>
                <summary>
                    <span>
                        Older Unsubmitted Work Entries
                        <span class="timesheet-worker-meta">${olderWorkerCount} worker${olderWorkerCount === 1 ? "" : "s"} with prior-week work entries</span>
                    </span>
                    <span class="timesheet-worker-count" title="Workers with older live entries">${olderWorkerCount}</span>
                </summary>
                <div class="timesheet-worker-body">
                    <div class="small timesheet-admin-copy--compact">These are old work rows still sitting in live timesheets. Old vacation, sick, and holiday rows are hidden here because those are tracked in the Vacation and leave admin sections.</div>
                    ${renderWorkerGroups(olderRows, { older: true, open: Boolean(filter) })}
                </div>
            </details>
        `
        : "";
    return `
        <h3>Live Entries Before Weekly Submit</h3>
        <div class="small timesheet-admin-copy--compact">Main employee panels show only the current week. Older work rows are collapsed below for cleanup; older vacation, sick, and holiday placeholders stay in the data but are not shown here.</div>
        ${currentHtml}
        ${olderHtml}
    `;
}

function notifyOlderTimesheetEntries(olderRows, olderWorkerCount) {
    if (!olderRows.length || !olderWorkerCount || typeof createJgcPortalNotifications !== "function") {
        return;
    }

    const todayKey = new Date().toISOString().slice(0, 10);
    const workerNames = Array.from(new Set(olderRows.map((row) => row.worker || "Unknown Worker"))).sort();
    const notificationKey = "older-live:" + todayKey + ":" + workerNames.join("|");

    if (timesheetMissingNotificationKeys.has(notificationKey)) {
        return;
    }

    timesheetMissingNotificationKeys.add(notificationKey);
    createJgcPortalNotifications(supabaseClient, "timesheet_missing", [{ role: "supervisor" }, { role: "admin" }], {
        title: "Older timesheet cleanup needed",
        message: olderWorkerCount + " worker" + (olderWorkerCount === 1 ? "" : "s") + " have prior-week work entries still sitting live.",
        link_url: "admin.html?tab=timesheets",
        source_table: "timesheet_entries",
        source_id: notificationKey,
        dedupe_key_prefix: "timesheet_missing:" + notificationKey,
        metadata: {
            worker_count: olderWorkerCount,
            workers: workerNames,
            row_count: olderRows.length
        }
    }).catch((error) => {
        console.warn("Timesheet cleanup notification could not be created.", error);
    });
}

function editLiveTimesheetEntry(id) {
    const entry = liveTimesheetEntries.find((item) => item.id === id);

    if (!entry) {
        alert("Live timesheet entry could not be found.");
        return;
    }

    editingLiveTimesheetEntryId = id;
    renderLiveTimesheetEditPanel(entry);
    document.getElementById("timesheetEditPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteLiveTimesheetEntry(id) {
    const entry = liveTimesheetEntries.find((item) => item.id === id);

    if (!entry) {
        alert("Live timesheet entry could not be found.");
        return;
    }

    const confirmed = confirm(
        "Delete this live timesheet entry?\n\n" +
        (entry.worker_name || "") + " - " +
        (entry.day_of_week || "") + " - " +
        (entry.job_name || "")
    );

    if (!confirmed) {
        return;
    }

    const { error } = await supabaseClient
        .from("timesheet_entries")
        .delete()
        .eq("id", id);

    if (error) {
        alert("Live entry could not be deleted.");
        return;
    }

    if (editingLiveTimesheetEntryId === id) {
        cancelLiveTimesheetEntryEdit();
    }

    liveTimesheetEntries = liveTimesheetEntries.filter((item) => item.id !== id);
    renderTimesheets();
    renderSickDays();
}

function renderLiveTimesheetEditPanel(entry) {
    const panel = document.getElementById("timesheetEditPanel");
    const entryType = entry.entry_type || "work";
    const dayOptions = getTimesheetDayNames().map((day) => {
        return '<option value="' + escapeHtml(day) + '"' + (entry.day_of_week === day ? " selected" : "") + ">" + escapeHtml(day) + "</option>";
    }).join("");
    const typeOptions = [
        ["work", "Work"],
        ["sick", "Sick Day"],
        ["vacation", "Vacation Day"],
        ["civic_holiday", "Civic Holiday"]
    ].map(([value, label]) => '<option value="' + value + '"' + (entryType === value ? " selected" : "") + ">" + label + "</option>").join("");

    panel.hidden = false;
    panel.innerHTML = `
        <h3>Edit Live Timesheet Entry</h3>
        <div class="small timesheet-admin-copy">${escapeHtml(entry.worker_name || "")}</div>
        <div class="announcement-grid">
            <div>
                <label>Week Start</label>
                <input id="liveTimesheetWeekStart" type="date" value="${escapeHtml(entry.week_start || "")}">
            </div>
            <div>
                <label>Day</label>
                <select id="liveTimesheetDay">${dayOptions}</select>
            </div>
            <div>
                <label>Entry Type</label>
                <select id="liveTimesheetEntryType" onchange="updateLiveTimesheetJobNumberMode()">${typeOptions}</select>
            </div>
            <div>
                <label>Vacation Type</label>
                <select id="liveTimesheetLeaveType">
                    <option value="">None</option>
                    <option value="paid" ${entry.leave_type === "paid" ? "selected" : ""}>Paid</option>
                    <option value="unpaid" ${entry.leave_type === "unpaid" ? "selected" : ""}>Unpaid</option>
                    <option value="half_day" ${entry.leave_type === "half_day" ? "selected" : ""}>Half Day</option>
                </select>
            </div>
            <div>
                <label>Job Name</label>
                <input id="liveTimesheetJobName" value="${escapeHtml(entry.job_name || "")}">
            </div>
            <div>
                <label>Job Number</label>
                <input id="liveTimesheetJobNumber" value="${escapeHtml(entry.job_number || "")}" oninput="sanitizeAdminTimesheetJobNumberInput(this, 'liveTimesheetEntryType')">
            </div>
            <div>
                <label>Time In</label>
                <input id="liveTimesheetTimeIn" type="time" step="1800" value="${escapeHtml(String(entry.time_in || "").slice(0, 5))}">
            </div>
            <div>
                <label>Time Out</label>
                <input id="liveTimesheetTimeOut" type="time" step="1800" value="${escapeHtml(String(entry.time_out || "").slice(0, 5))}">
            </div>
            <div class="full">
                <label>Reason / Note</label>
                <textarea id="liveTimesheetLeaveNote" rows="3">${escapeHtml(entry.leave_note || "")}</textarea>
            </div>
            <label><input id="liveTimesheetLunch" type="checkbox" ${entry.took_lunch ? "checked" : ""}> Lunch</label>
            <label><input id="liveTimesheetNight" type="checkbox" ${entry.night_work ? "checked" : ""}> Night Work</label>
        </div>
        <div class="actions timesheet-admin-actions--top">
            <button type="button" onclick="saveLiveTimesheetEntryEdit()">Save Live Entry</button>
            <button type="button" class="secondary" onclick="cancelLiveTimesheetEntryEdit()">Cancel</button>
        </div>
        <div id="liveTimesheetEditStatus" class="small timesheet-admin-status"></div>
    `;

    updateLiveTimesheetJobNumberMode();
}

async function saveLiveTimesheetEntryEdit() {
    const entry = liveTimesheetEntries.find((item) => item.id === editingLiveTimesheetEntryId);

    if (!entry) {
        alert("Live timesheet entry could not be found.");
        return;
    }

    const weekStart = document.getElementById("liveTimesheetWeekStart").value;
    const day = document.getElementById("liveTimesheetDay").value;
    const entryType = document.getElementById("liveTimesheetEntryType").value || "work";
    const leaveType = document.getElementById("liveTimesheetLeaveType").value || "";
    const leaveNote = document.getElementById("liveTimesheetLeaveNote").value.trim();
    const jobName = document.getElementById("liveTimesheetJobName").value.trim();
    const jobNumber = document.getElementById("liveTimesheetJobNumber").value.trim();
    const timeIn = document.getElementById("liveTimesheetTimeIn").value;
    const timeOut = document.getElementById("liveTimesheetTimeOut").value;
    const tookLunch = document.getElementById("liveTimesheetLunch").checked;
    const nightWork = document.getElementById("liveTimesheetNight").checked;
    const status = document.getElementById("liveTimesheetEditStatus");

    if (!weekStart || !day) {
        alert("Fill in week and day.");
        return;
    }

    if (entryType === "work" && (!jobName || !timeIn || !timeOut)) {
        alert("Fill in week, day, job name, time in, and time out.");
        return;
    }

    if (entryType === "work" && !isValidAdminTimesheetWorkJobNumber(jobNumber)) {
        alert("Job Number can contain numbers only. Leave it blank for Shop work.");
        document.getElementById("liveTimesheetJobNumber").focus();
        return;
    }

    if (entryType === "vacation" && !leaveType) {
        alert("Choose Paid or Unpaid for vacation.");
        return;
    }

    if (entryType === "vacation" && leaveType === "half_day" && (!timeIn || !timeOut)) {
        alert("Choose time in and time out for the half vacation day.");
        return;
    }

    status.textContent = "Saving live entry...";

    const weekEndDate = makeLocalDate(weekStart);
    weekEndDate.setDate(weekEndDate.getDate() + 6);

    const values = {
        week_start: weekStart,
        week_end: formatTimesheetPdfDate(weekEndDate),
        day_of_week: day,
        job_name: entryType === "work" ? jobName : getAdminSpecialEntryJobName(entryType, leaveType),
        job_number: entryType === "work" ? jobNumber : (leaveNote || getAdminSpecialEntryJobName(entryType, leaveType)),
        time_in: entryType === "sick" ? "07:00" : (entryType === "work" || (entryType === "vacation" && leaveType === "half_day") ? timeIn : "00:00"),
        time_out: entryType === "sick" ? "12:00" : (entryType === "work" || (entryType === "vacation" && leaveType === "half_day") ? timeOut : "00:00"),
        took_lunch: entryType === "work" ? tookLunch : false,
        night_work: entryType === "work" ? nightWork : false,
        hours: entryType === "work" ? calculateAdminTimesheetHours(timeIn, timeOut, tookLunch) : (entryType === "vacation" && leaveType === "half_day" ? calculateAdminTimesheetHours(timeIn, timeOut, false) : 0.01),
        entry_type: entryType,
        leave_type: entryType === "vacation" ? leaveType : "",
        leave_note: entryType === "sick" ? "" : leaveNote
    };

    const { data, error } = await supabaseClient
        .from("timesheet_entries")
        .update(values)
        .eq("id", editingLiveTimesheetEntryId)
        .select()
        .single();

    if (error) {
        status.textContent = "Live entry could not be saved.";
        return;
    }

    liveTimesheetEntries = liveTimesheetEntries.map((item) => item.id === editingLiveTimesheetEntryId ? data : item);
    cancelLiveTimesheetEntryEdit();
    renderTimesheets();
    renderSickDays();
}

function cancelLiveTimesheetEntryEdit() {
    editingLiveTimesheetEntryId = "";
    const panel = document.getElementById("timesheetEditPanel");
    panel.hidden = true;
    panel.innerHTML = "";
}

function makeLocalDate(dateString) {
    const parts = String(dateString || "").split("-");
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatTimesheetPdfDate(date) {
    return date.toLocaleDateString("en-CA", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function getTimesheetDayNames() {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
}

function getTimesheetEntryValue(entry, camelName, snakeName, fallback) {
    return entry && entry[camelName] !== undefined ? entry[camelName] : entry && entry[snakeName] !== undefined ? entry[snakeName] : fallback;
}

function getTimesheetEntryDate(entry) {
    const weekStart = getTimesheetEntryValue(entry, "weekStartValue", "week_start", "");
    const day = getTimesheetEntryValue(entry, "day", "day_of_week", "");

    if (!weekStart || !day) {
        return null;
    }

    const dayIndex = getTimesheetDayNames().indexOf(day);

    if (dayIndex < 0) {
        return null;
    }

    const date = /^\d{4}-\d{2}-\d{2}$/.test(weekStart)
        ? makeLocalDate(weekStart)
        : new Date(weekStart);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    date.setDate(date.getDate() + dayIndex);
    return date;
}

function getTimesheetEmailDayOrder() {
    return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
}

function sortTimesheetEntriesForEmail(entries) {
    const dayOrder = getTimesheetEmailDayOrder();

    return entries.slice().sort((a, b) => {
        const dayA = getTimesheetEntryValue(a, "day", "day_of_week", "");
        const dayB = getTimesheetEntryValue(b, "day", "day_of_week", "");
        const dayDifference = dayOrder.indexOf(dayA) - dayOrder.indexOf(dayB);

        if (dayDifference !== 0) {
            return dayDifference;
        }

        const jobA = getTimesheetEntryValue(a, "jobName", "job_name", "");
        const jobB = getTimesheetEntryValue(b, "jobName", "job_name", "");
        const jobDifference = jobA.localeCompare(jobB);

        if (jobDifference !== 0) {
            return jobDifference;
        }

        return String(getTimesheetEntryValue(a, "timeIn", "time_in", "")).localeCompare(String(getTimesheetEntryValue(b, "timeIn", "time_in", "")));
    });
}

function getTimesheetEmailDayHeading(day, entries) {
    const entryDate = entries.length ? getTimesheetEntryDate(entries[0]) : null;
    return entryDate ? day + " - " + formatTimesheetPdfDate(entryDate) : day;
}

function getTimesheetEntriesByEmailDay(entries) {
    const sortedEntries = sortTimesheetEntriesForEmail(entries);

    return getTimesheetEmailDayOrder().map((day) => {
        const dayEntries = sortedEntries.filter((entry) => getTimesheetEntryValue(entry, "day", "day_of_week", "") === day);

        if (!dayEntries.length) {
            return null;
        }

        return {
            day,
            heading: getTimesheetEmailDayHeading(day, dayEntries),
            entries: dayEntries,
            table: getAdminTimesheetEmailTableRows(dayEntries)
        };
    }).filter(Boolean);
}

function padTimesheetCell(value, width) {
    const text = String(value || "");
    return text.length > width ? text.slice(0, width - 1) + "." : text + " ".repeat(width - text.length);
}

function getAdminTimesheetEmailTableRows(entries) {
    const columns = [
        { label: "Job / Day", width: 22 },
        { label: "Job #", width: 8 },
        { label: "Type", width: 16 },
        { label: "Note", width: 18 },
        { label: "Lunch", width: 7 },
        { label: "Night", width: 7 },
        { label: "Time", width: 13 },
        { label: "Hours", width: 6 }
    ];
    const header = columns.map((column) => padTimesheetCell(column.label, column.width)).join(" | ");
    const divider = columns.map((column) => "-".repeat(column.width)).join("-+-");
    const rows = entries.map((entry) => {
        const timeIn = String(getTimesheetEntryValue(entry, "timeIn", "time_in", "")).slice(0, 5);
        const timeOut = String(getTimesheetEntryValue(entry, "timeOut", "time_out", "")).slice(0, 5);
        const values = [
            getTimesheetEntryValue(entry, "jobName", "job_name", ""),
            getTimesheetEntryValue(entry, "jobNumber", "job_number", ""),
            getAdminTimesheetEntryLabel(entry),
            getAdminTimesheetLeaveNote(entry),
            getTimesheetEntryValue(entry, "tookLunch", "took_lunch", false) ? "Yes" : "No",
            getTimesheetEntryValue(entry, "nightWork", "night_work", false) ? "Yes" : "No",
            getAdminTimesheetEntryType(entry) === "work" || getAdminTimesheetLeaveType(entry) === "half_day" ? timeIn + "-" + timeOut : "",
            Number(getTimesheetEntryValue(entry, "hours", "hours", 0)).toFixed(2)
        ];

        return values.map((value, index) => padTimesheetCell(value, columns[index].width)).join(" | ");
    });

    return { header, divider, rows };
}

function getAdminTimesheetTotalHours(week) {
    if (week.total_hours !== undefined && week.total_hours !== null) {
        return Number(week.total_hours);
    }

    return (Array.isArray(week.entries) ? week.entries : []).reduce((total, entry) => total + Number(getTimesheetEntryValue(entry, "hours", "hours", 0)), 0);
}

function calculateAdminTimesheetHours(inTime, outTime, tookLunch) {
    if (!inTime || !outTime) {
        return 0;
    }

    const start = new Date("1970-01-01T" + inTime + ":00");
    const end = new Date("1970-01-01T" + outTime + ":00");
    let diff = (end - start) / 1000 / 60 / 60;

    if (diff < 0) {
        diff += 24;
    }

    if (tookLunch) {
        diff -= 0.5;
    }

    return Math.max(diff, 0);
}

function getAdminTimesheetWeekStart(week) {
    const entries = Array.isArray(week.entries) ? week.entries : [];
    const firstEntry = entries.find((entry) => getTimesheetEntryValue(entry, "weekStartValue", "week_start", ""));

    if (firstEntry) {
        return getTimesheetEntryValue(firstEntry, "weekStartValue", "week_start", "");
    }

    const weekStartText = String(week.week_label || "").split(" to ")[0];
    const parsed = new Date(weekStartText);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function getAdminTimesheetWeekEnd(week, weekStart) {
    const entries = Array.isArray(week.entries) ? week.entries : [];
    const firstEntry = entries.find((entry) => getTimesheetEntryValue(entry, "weekEnd", "week_end", ""));

    if (firstEntry) {
        return getTimesheetEntryValue(firstEntry, "weekEnd", "week_end", "");
    }

    if (!weekStart) {
        return "";
    }

    const endDate = makeLocalDate(weekStart);
    endDate.setDate(endDate.getDate() + 6);
    return formatTimesheetPdfDate(endDate);
}

function normalizeAdminTimesheetEntry(entry, week) {
    const weekStart = getTimesheetEntryValue(entry, "weekStartValue", "week_start", "") || getAdminTimesheetWeekStart(week);
    const weekEnd = getTimesheetEntryValue(entry, "weekEnd", "week_end", "") || getAdminTimesheetWeekEnd(week, weekStart);
    const timeIn = String(getTimesheetEntryValue(entry, "timeIn", "time_in", "")).slice(0, 5);
    const timeOut = String(getTimesheetEntryValue(entry, "timeOut", "time_out", "")).slice(0, 5);
    const tookLunch = Boolean(getTimesheetEntryValue(entry, "tookLunch", "took_lunch", false));

    return {
        user: week.worker_name,
        weekStartValue: weekStart,
        weekStart: getTimesheetEntryValue(entry, "weekStart", "week_start_label", weekStart ? formatTimesheetPdfDate(makeLocalDate(weekStart)) : ""),
        weekEnd,
        jobName: getTimesheetEntryValue(entry, "jobName", "job_name", ""),
        jobNumber: getTimesheetEntryValue(entry, "jobNumber", "job_number", ""),
        day: getTimesheetEntryValue(entry, "day", "day_of_week", ""),
        timeIn,
        timeOut,
        hours: Number(getTimesheetEntryValue(entry, "hours", "hours", calculateAdminTimesheetHours(timeIn, timeOut, tookLunch))).toFixed(2),
        tookLunch,
        nightWork: Boolean(getTimesheetEntryValue(entry, "nightWork", "night_work", false)),
        entryType: getAdminTimesheetEntryType(entry),
        leaveType: getAdminTimesheetLeaveType(entry),
        leaveNote: getAdminTimesheetLeaveNote(entry),
        vacationRequestId: getTimesheetEntryValue(entry, "vacationRequestId", "vacation_request_id", "")
    };
}

function getAdminTimeOptions(selectedValue) {
    let options = '<option value="">Select</option>';

    for (let hour = 0; hour < 24; hour++) {
        for (let minute of [0, 30]) {
            const value = String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
            options += '<option value="' + value + '"' + (value === selectedValue ? " selected" : "") + ">" + value + "</option>";
        }
    }

    return options;
}

function editSubmittedTimesheet(id) {
    const week = timesheets.find((item) => item.id === id);

    if (!week) {
        alert("Submitted timesheet could not be found.");
        return;
    }

    editingTimesheetId = id;
    renderTimesheetEditPanel(week);
    document.getElementById("timesheetEditPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function getAdminTimesheetEntryDate(week, entry) {
    const weekStart = getAdminTimesheetWeekStart(week);
    const day = getTimesheetEntryValue(entry, "day", "day_of_week", "");
    const dayOffset = getTimesheetDayNames().indexOf(day);

    if (!weekStart || dayOffset < 0) {
        return "";
    }

    const date = makeLocalDate(weekStart);
    date.setDate(date.getDate() + dayOffset);
    return formatTimesheetPdfDate(date);
}

function viewSubmittedTimesheetHours(id) {
    const week = timesheets.find((item) => item.id === id);

    if (!week) {
        alert("Submitted timesheet could not be found.");
        return;
    }

    const panel = document.getElementById("timesheetViewPanel");
    const entries = Array.isArray(week.entries) ? week.entries : [];
    const totalHours = getAdminTimesheetTotalHours(week);

    panel.hidden = false;
    panel.innerHTML = `
        <h3>Submitted Timesheet Hours</h3>
        <div class="small"><strong>${escapeHtml(week.worker_name || "")}</strong> - ${escapeHtml(week.week_label || "")}</div>
        <div class="table-wrap timesheet-admin-table">
            <table>
                <thead>
                    <tr><th>Date</th><th>Day</th><th>Job / Site</th><th>Job #</th><th>Type</th><th>Time</th><th>Lunch</th><th>Night</th><th>Hours</th></tr>
                </thead>
                <tbody>
                    ${entries.length ? entries.map((entry) => {
                        const timeIn = String(getTimesheetEntryValue(entry, "timeIn", "time_in", "")).slice(0, 5);
                        const timeOut = String(getTimesheetEntryValue(entry, "timeOut", "time_out", "")).slice(0, 5);
                        const entryType = getAdminTimesheetEntryType(entry);
                        const isTimedEntry = entryType === "work" || getAdminTimesheetLeaveType(entry) === "half_day";
                        return `
                            <tr>
                                <td>${escapeHtml(getAdminTimesheetEntryDate(week, entry))}</td>
                                <td>${escapeHtml(getTimesheetEntryValue(entry, "day", "day_of_week", ""))}</td>
                                <td>${escapeHtml(getTimesheetEntryValue(entry, "jobName", "job_name", ""))}</td>
                                <td>${escapeHtml(getTimesheetEntryValue(entry, "jobNumber", "job_number", ""))}</td>
                                <td>${escapeHtml(getAdminTimesheetEntryLabel(entry))}</td>
                                <td>${isTimedEntry ? escapeHtml(timeIn + (timeOut ? " - " + timeOut : "")) : ""}</td>
                                <td>${getTimesheetEntryValue(entry, "tookLunch", "took_lunch", false) ? "Yes" : "No"}</td>
                                <td>${getTimesheetEntryValue(entry, "nightWork", "night_work", false) ? "Yes" : "No"}</td>
                                <td>${Number(getTimesheetEntryValue(entry, "hours", "hours", 0)).toFixed(2)}</td>
                            </tr>
                        `;
                    }).join("") : '<tr><td colspan="9">No saved entries were found for this submission.</td></tr>'}
                </tbody>
            </table>
        </div>
        <div class="small timesheet-admin-total"><strong>Total Hours:</strong> ${totalHours.toFixed(2)}</div>
        ${week.note ? '<div class="small timesheet-admin-note"><strong>Note:</strong> ' + escapeHtml(week.note) + '</div>' : ""}
        <div class="actions timesheet-admin-actions--top">
            <button type="button" class="secondary" onclick="closeSubmittedTimesheetHours()">Close</button>
        </div>
    `;

    panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeSubmittedTimesheetHours() {
    const panel = document.getElementById("timesheetViewPanel");
    panel.hidden = true;
    panel.innerHTML = "";
}

function renderTimesheetEditPanel(week) {
    const panel = document.getElementById("timesheetEditPanel");
    const entries = (Array.isArray(week.entries) ? week.entries : []).map((entry) => normalizeAdminTimesheetEntry(entry, week));

    panel.hidden = false;
    panel.innerHTML = `
        <h3>Edit Submitted Timesheet</h3>
        <div class="small"><strong>${escapeHtml(week.worker_name || "")}</strong> - ${escapeHtml(week.week_label || "")}</div>
        <label class="timesheet-admin-field-label">Admin Note</label>
        <textarea id="adminTimesheetNote">${escapeHtml(week.note || "")}</textarea>
        <div class="table-wrap timesheet-admin-table">
            <table class="timesheet-edit-table">
                <thead>
                    <tr>
                        <th>Day</th>
                        <th>Type</th>
                        <th>Vacation</th>
                        <th>Job Name</th>
                        <th>Job #</th>
                        <th>Note</th>
                        <th>Time In</th>
                        <th>Time Out</th>
                        <th>Lunch</th>
                        <th>Night</th>
                        <th>Hours</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="adminTimesheetEditRows">
                    ${entries.map((entry) => getTimesheetEditRowHtml(entry)).join("")}
                </tbody>
            </table>
        </div>
        <div class="actions timesheet-admin-actions--top">
            <button type="button" onclick="addAdminTimesheetEditRow()">Add Entry</button>
            <button type="button" onclick="saveSubmittedTimesheetEdits()">Save Changes</button>
            <button type="button" class="secondary" onclick="cancelSubmittedTimesheetEdit()">Cancel</button>
        </div>
        <div id="timesheetEditStatus" class="small timesheet-admin-status"></div>
    `;
}

function getTimesheetEditRowHtml(entry) {
    const dayOptions = getTimesheetDayNames().map((day) => {
        return '<option value="' + day + '"' + (entry.day === day ? " selected" : "") + ">" + day + "</option>";
    }).join("");
    const typeOptions = [
        ["work", "Work"],
        ["sick", "Sick Day"],
        ["vacation", "Vacation Day"],
        ["civic_holiday", "Civic Holiday"]
    ].map(([value, label]) => '<option value="' + value + '"' + ((entry.entryType || "work") === value ? " selected" : "") + ">" + label + "</option>").join("");

    return `
        <tr>
            <td><select data-field="day"><option value="">Day</option>${dayOptions}</select></td>
            <td><select data-field="entryType">${typeOptions}</select></td>
            <td>
                <select data-field="leaveType">
                    <option value="">None</option>
                    <option value="paid"${entry.leaveType === "paid" ? " selected" : ""}>Paid</option>
                    <option value="unpaid"${entry.leaveType === "unpaid" ? " selected" : ""}>Unpaid</option>
                    <option value="half_day"${entry.leaveType === "half_day" ? " selected" : ""}>Half Day</option>
                </select>
            </td>
            <td>
                <input class="job-name-input" data-field="jobName" value="${escapeHtml(entry.jobName || "")}">
                <input type="hidden" data-field="vacationRequestId" value="${escapeHtml(entry.vacationRequestId || "")}">
            </td>
            <td><input data-field="jobNumber" value="${escapeHtml(entry.jobNumber || "")}"></td>
            <td><input data-field="leaveNote" value="${escapeHtml(entry.leaveNote || "")}"></td>
            <td><select data-field="timeIn">${getAdminTimeOptions(entry.timeIn || "")}</select></td>
            <td><select data-field="timeOut">${getAdminTimeOptions(entry.timeOut || "")}</select></td>
            <td><input type="checkbox" data-field="tookLunch"${entry.tookLunch ? " checked" : ""}></td>
            <td><input type="checkbox" data-field="nightWork"${entry.nightWork ? " checked" : ""}></td>
            <td><input data-field="hours" type="number" step="0.25" min="0" value="${Number(entry.hours || 0).toFixed(2)}"></td>
            <td><button type="button" class="delete-button" onclick="removeAdminTimesheetEditRow(this)">Delete</button></td>
        </tr>
    `;
}

function addAdminTimesheetEditRow() {
    const week = timesheets.find((item) => item.id === editingTimesheetId);

    if (!week) {
        return;
    }

    document.getElementById("adminTimesheetEditRows").insertAdjacentHTML("beforeend", getTimesheetEditRowHtml(normalizeAdminTimesheetEntry({}, week)));
}

function removeAdminTimesheetEditRow(button) {
    button.closest("tr").remove();
}

function collectAdminTimesheetEntries(week) {
    const rows = Array.from(document.querySelectorAll("#adminTimesheetEditRows tr"));
    const weekStart = getAdminTimesheetWeekStart(week);
    const weekEnd = getAdminTimesheetWeekEnd(week, weekStart);

    return rows.map((row) => {
        const getValue = (field) => {
            const input = row.querySelector('[data-field="' + field + '"]');
            return input ? input.value.trim() : "";
        };
        const getChecked = (field) => {
            const input = row.querySelector('[data-field="' + field + '"]');
            return input ? input.checked : false;
        };
        const tookLunch = getChecked("tookLunch");
        const entryType = getValue("entryType") || "work";
        const leaveType = getValue("leaveType");
        const leaveNote = getValue("leaveNote");
        const timeIn = getValue("timeIn");
        const timeOut = getValue("timeOut");
        const calculatedHours = calculateAdminTimesheetHours(timeIn, timeOut, tookLunch);
        const enteredHours = Number(getValue("hours"));
        const hours = Number.isFinite(enteredHours) && enteredHours > 0 ? enteredHours : calculatedHours;

        return {
            user: week.worker_name,
            weekStartValue: weekStart,
            weekStart: weekStart ? formatTimesheetPdfDate(makeLocalDate(weekStart)) : "",
            weekEnd,
            jobName: entryType === "work" ? getValue("jobName") : getAdminSpecialEntryJobName(entryType, leaveType),
            jobNumber: entryType === "work" ? getValue("jobNumber") : leaveNote,
            day: getValue("day"),
            timeIn: entryType === "work" || (entryType === "vacation" && leaveType === "half_day") ? timeIn : "00:00",
            timeOut: entryType === "work" || (entryType === "vacation" && leaveType === "half_day") ? timeOut : "00:00",
            hours: entryType === "work" ? Number(hours || 0).toFixed(2) : (entryType === "vacation" && leaveType === "half_day" ? Number(hours || 0).toFixed(2) : "0.00"),
            tookLunch: entryType === "work" ? tookLunch : false,
            nightWork: entryType === "work" ? getChecked("nightWork") : false,
            entryType,
            leaveType: entryType === "vacation" ? leaveType : "",
            leaveNote,
            vacationRequestId: entryType === "vacation" ? getValue("vacationRequestId") : ""
        };
    }).filter((entry) => entry.day || entry.jobName || entry.leaveNote || Number(entry.hours) > 0);
}

async function saveSubmittedTimesheetEdits() {
    const week = timesheets.find((item) => item.id === editingTimesheetId);

    if (!week) {
        alert("Submitted timesheet could not be found.");
        return;
    }

    const entries = collectAdminTimesheetEntries(week);

    if (!entries.length) {
        alert("Add at least one timesheet entry before saving.");
        return;
    }

    const invalid = entries.find((entry) => {
        if (!entry.day || !entry.jobName) {
            return true;
        }

        if (entry.entryType === "work") {
            return !entry.timeIn || !entry.timeOut;
        }

        if (entry.entryType === "vacation") {
            return !entry.leaveType || (entry.leaveType === "half_day" && (!entry.timeIn || !entry.timeOut));
        }

        return false;
    });

    if (invalid) {
        alert("Each entry needs the required fields for its type. Vacation needs Paid or Unpaid, and work needs time in/out.");
        return;
    }

    const totalHours = entries.reduce((total, entry) => total + Number(entry.hours || 0), 0);
    const note = document.getElementById("adminTimesheetNote").value.trim();
    document.getElementById("timesheetEditStatus").textContent = "Saving changes...";

    const { error } = await supabaseClient
        .from("previous_timesheet_weeks")
        .update({
            entries,
            total_hours: totalHours,
            note
        })
        .eq("id", week.id);

    if (error) {
        document.getElementById("timesheetEditStatus").textContent = "Timesheet could not be saved.";
        return;
    }

    week.entries = entries;
    week.total_hours = totalHours;
    week.note = note;
    cancelSubmittedTimesheetEdit();
    renderTimesheets();
}

function cancelSubmittedTimesheetEdit() {
    editingTimesheetId = "";
    const panel = document.getElementById("timesheetEditPanel");
    panel.hidden = true;
    panel.innerHTML = "";
}

function buildAdminTimesheetEmailBody(week, totalHours) {
    const lines = [
        "Worker: " + (week.worker_name || ""),
        "Week: " + (week.week_label || ""),
        "",
        "Timesheet Entries:",
        ""
    ];

    for (const group of getTimesheetEntriesByEmailDay(Array.isArray(week.entries) ? week.entries : [])) {
        lines.push(group.heading);
        lines.push(group.table.header);
        lines.push(group.table.divider);

        for (const row of group.table.rows) {
            lines.push(row);
        }

        lines.push("");
        lines.push("");
    }

    lines.push("Total Hours: " + totalHours.toFixed(2));

    if (week.note) {
        lines.push("");
        lines.push("Note:");
        lines.push(week.note);
    }

    return lines.join("\n");
}

function buildAdminTimesheetPdfHtml(week, totalHours) {
    const entries = Array.isArray(week.entries) ? week.entries : [];
    const dayOrder = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayLabels = dayOrder.map((day) => {
        const entry = entries.find((item) => getTimesheetEntryValue(item, "day", "day_of_week", "") === day);
        const date = entry ? getTimesheetEntryDate(entry) : null;
        return day.slice(0, 3) + (date ? "<small>" + escapeHtml(formatTimesheetPdfDate(date).replace(", " + date.getFullYear(), "")) + "</small>" : "");
    });
    const grouped = new Map();
    const workDays = new Set(entries
        .filter((entry) => getAdminTimesheetEntryType(entry) === "work")
        .map((entry) => getTimesheetEntryValue(entry, "day", "day_of_week", "")));

    entries.forEach((entry) => {
        const entryDay = getTimesheetEntryValue(entry, "day", "day_of_week", "");
        const entryHours = Number(getTimesheetEntryValue(entry, "hours", "hours", 0));

        if (getAdminTimesheetEntryType(entry) !== "work" &&
            getAdminTimesheetLeaveType(entry) !== "half_day" &&
            entryHours <= 0.011 &&
            workDays.has(entryDay)) {
            return;
        }

        const jobName = String(getTimesheetEntryValue(entry, "jobName", "job_name", "Unassigned")).trim() || "Unassigned";
        const jobNumber = String(getTimesheetEntryValue(entry, "jobNumber", "job_number", "")).trim();
        const typeLabel = getAdminTimesheetEntryLabel(entry);
        const groupKey = [jobNumber.toLowerCase(), jobName.toLowerCase(), typeLabel.toLowerCase()].join("|");

        if (!grouped.has(groupKey)) {
            grouped.set(groupKey, {
                jobName,
                jobNumber,
                typeLabel,
                notes: new Set(),
                shifts: {
                    Day: Array(7).fill(0),
                    Night: Array(7).fill(0)
                },
                leaveMarkers: {
                    Day: Array(7).fill(""),
                    Night: Array(7).fill("")
                }
            });
        }

        const group = grouped.get(groupKey);
        const dayIndex = dayOrder.indexOf(entryDay);
        const shift = getTimesheetEntryValue(entry, "nightWork", "night_work", false) ? "Night" : "Day";
        const entryNote = String(getAdminTimesheetLeaveNote(entry) || "").trim();

        if (dayIndex >= 0) {
            const isFullDayLeavePlaceholder = getAdminTimesheetEntryType(entry) !== "work" &&
                getAdminTimesheetLeaveType(entry) !== "half_day" &&
                entryHours <= 0.011;

            if (isFullDayLeavePlaceholder) {
                group.leaveMarkers[shift][dayIndex] = "Off";
            } else {
                group.shifts[shift][dayIndex] += entryHours;
            }
        }
        if (entryNote) {
            group.notes.add(entryNote);
        }
    });

    let dayHours = 0;
    let nightHours = 0;
    const rows = [];
    const entryNotes = new Set();

    Array.from(grouped.values())
        .sort((a, b) => {
            const firstDayA = a.shifts.Day.concat(a.shifts.Night).reduce((earliest, value, index) => {
                return value > 0 ? Math.min(earliest, index % 7) : earliest;
            }, 7);
            const firstDayB = b.shifts.Day.concat(b.shifts.Night).reduce((earliest, value, index) => {
                return value > 0 ? Math.min(earliest, index % 7) : earliest;
            }, 7);
            return firstDayA - firstDayB ||
                (a.jobNumber + " " + a.jobName).localeCompare(b.jobNumber + " " + b.jobName);
        })
        .forEach((group) => {
            group.notes.forEach((entryNote) => {
                entryNotes.add(entryNote);
            });

            ["Day", "Night"].forEach((shift) => {
                const hours = group.shifts[shift];
                const leaveMarkers = group.leaveMarkers[shift];
                const rowTotal = hours.reduce((sum, value) => sum + value, 0);

                if (rowTotal <= 0 && !leaveMarkers.some(Boolean)) {
                    return;
                }

                if (shift === "Night") {
                    nightHours += rowTotal;
                } else {
                    dayHours += rowTotal;
                }

                rows.push(`
                    <tr class="${shift === "Night" ? "night-row" : ""}"${shift === "Night" ? ' style="background-color:#e3e5e4;"' : ""}>
                        <td class="job-cell"><strong>${escapeHtml(group.jobName)}</strong>${group.typeLabel ? "<small>" + escapeHtml(group.typeLabel) + "</small>" : ""}</td>
                        <td class="job-number-cell">${escapeHtml(group.jobNumber)}</td>
                        <td class="shift-cell">${shift}</td>
                        ${hours.map((value, index) => {
                            const displayValue = leaveMarkers[index] || (value ? value.toFixed(2) : "");
                            return "<td class=\"hours-cell\">" + escapeHtml(displayValue) + "</td>";
                        }).join("")}
                        <td class="hours-cell total-cell">${rowTotal > 0 ? rowTotal.toFixed(2) : ""}</td>
                    </tr>
                `);
            });
        });
    const noteLines = [];

    if (week.note) {
        noteLines.push(String(week.note).trim());
    }
    entryNotes.forEach((entryNote) => {
        if (!noteLines.some((existingNote) => existingNote.toLowerCase() === entryNote.toLowerCase())) {
            noteLines.push(entryNote);
        }
    });

    return `
        <!doctype html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                @page { size: Letter portrait; margin: 0.45in; }
                * { box-sizing: border-box; }
                body { margin: 0; font-family: Arial, sans-serif; color: #17231d; font-size: 13px; }
                .header { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; gap: 18px; border-bottom: 3px solid #178b45; padding-bottom: 10px; margin-bottom: 16px; }
                h1, .employee-name { color: #176f3a; font-size: 26px; line-height: 1.08; margin: 0 0 5px; font-weight: bold; }
                .subtitle, .employee-label { color: #526158; font-size: 11px; font-weight: bold; text-transform: uppercase; }
                .employee-meta { text-align: right; }
                .week { color: #526158; font-size: 13px; margin-top: 7px; }
                table { width: 100%; border-collapse: collapse; table-layout: fixed; }
                thead { display: table-header-group; }
                tr { break-inside: avoid; page-break-inside: avoid; }
                th, td { border: 1px solid #718078; padding: 8px 5px; font-size: 12.5px; line-height: 1.2; vertical-align: middle; }
                th { background: #123d24; color: #fff; text-align: center; }
                th small { display: block; font-size: 10px; font-weight: normal; margin-top: 2px; }
                td small { display: block; font-size: 11px; line-height: 1.15; font-weight: normal; margin-top: 3px; }
                .job-cell small { color: #526158; }
                .job-number-cell, .shift-cell, .hours-cell { text-align: center; }
                .job-number-cell, .shift-cell { font-weight: bold; }
                .job-col { width: 26.6%; }
                .job-number-col { width: 8.8%; }
                .shift-col { width: 7%; }
                .day-col { width: 7%; }
                .total-col { width: 8.6%; }
                .total-cell { background: #e3f2e8; font-weight: bold; }
                .night-row, .night-row td {
                    background-color: #e3e5e4 !important;
                    border-color: #8b928e;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .night-row .total-cell { background-color: #d7dad8 !important; }
                .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 14px; break-inside: avoid; page-break-inside: avoid; }
                .summary-box { min-width: 0; border: 1px solid #718078; border-radius: 4px; padding: 10px 12px; background: #123d24; color: #fff; font-size: 12px; font-weight: bold; text-transform: uppercase; }
                .summary-box strong { display: block; color: #fff; font-size: 24px; line-height: 1; margin-top: 7px; }
                .summary-box.night { background: #f1f3f2; color: #17231d; }
                .summary-box.night strong { color: #17231d; }
                .summary-box.week { background: #176f3a; }
                .note { margin-top: 14px; padding: 11px 12px; border: 1px solid #718078; border-radius: 4px; min-height: 82px; font-size: 13.5px; break-inside: avoid; page-break-inside: avoid; }
                .note-title { color: #176f3a; font-size: 12px; font-weight: bold; margin-bottom: 8px; text-transform: uppercase; }
                .note-empty { color: #6b756f; }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <h1>John Gordon Construction</h1>
                    <div class="subtitle">Weekly Employee Timesheet</div>
                </div>
                <div class="employee-meta">
                    <div class="employee-name">${escapeHtml(week.worker_name || "")}</div>
                    <div class="employee-label">Employee</div>
                    <div class="week"><b>Week:</b> ${escapeHtml(week.week_label || "")}</div>
                </div>
            </div>
            <table>
                <colgroup>
                    <col class="job-col">
                    <col class="job-number-col">
                    <col class="shift-col">
                    ${dayOrder.map(() => '<col class="day-col">').join("")}
                    <col class="total-col">
                </colgroup>
                <thead>
                    <tr>
                        <th class="job-cell">Job Name</th>
                        <th class="job-number-cell">Job #</th>
                        <th class="shift-cell">Shift</th>
                        ${dayLabels.map((label) => "<th class=\"hours-cell\">" + label + "</th>").join("")}
                        <th class="hours-cell">Total</th>
                    </tr>
                </thead>
                <tbody>${rows.join("")}</tbody>
            </table>
            <div class="summary">
                <div class="summary-box">Day Hours<strong>${dayHours.toFixed(2)}</strong></div>
                <div class="summary-box night">Night Hours<strong>${nightHours.toFixed(2)}</strong></div>
                <div class="summary-box week">Weekly Total<strong>${totalHours.toFixed(2)}</strong></div>
            </div>
            <div class="note">
                <div class="note-title">Notes</div>
                ${noteLines.length ? noteLines.map((noteLine) => "<div>" + escapeHtml(noteLine) + "</div>").join("") : '<div class="note-empty">No notes provided.</div>'}
            </div>
        </body>
        </html>
    `;
}

function makeSafeEmailFileName(value) {
    return String(value || "timesheet")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

async function resubmitSubmittedTimesheet(id) {
    const week = timesheets.find((item) => item.id === id);

    if (!week || !Array.isArray(week.entries) || !week.entries.length) {
        alert("This submitted timesheet has no entries to resubmit.");
        return;
    }

    if (!confirm("Resubmit this timesheet for " + week.worker_name + " - " + week.week_label + "?")) {
        return;
    }

    const totalHours = getAdminTimesheetTotalHours(week);
    const subject = "Timesheet - " + week.worker_name + " - " + week.week_label;
    const body = buildAdminTimesheetEmailBody(week, totalHours);
    const pdfHtml = buildAdminTimesheetPdfHtml(week, totalHours);

    try {
        await fetch(TIMESHEET_EMAIL_SCRIPT_URL, {
            method: "POST",
            mode: "no-cors",
            headers: {
                "Content-Type": "text/plain;charset=utf-8"
            },
            body: JSON.stringify({
                to: ADMIN_TIMESHEET_RESUBMIT_RECIPIENTS.join(","),
                subject,
                body,
                text: body,
                pdfHtml,
                pdfFileName: "timesheet-" + makeSafeEmailFileName(week.worker_name + "-" + week.week_label) + ".pdf",
                worker: week.worker_name,
                weekLabel: week.week_label,
                source: "admin_resubmit"
            })
        });

        alert("Timesheet resubmitted.");
    } catch (error) {
        alert("Timesheet could not be resubmitted.");
    }
}

async function deleteSubmittedTimesheet(id) {
    const week = timesheets.find((item) => item.id === id);

    if (!week) {
        alert("Submitted timesheet could not be found.");
        return;
    }

    if (!confirm("Delete this submitted timesheet for " + week.worker_name + " - " + week.week_label + "?")) {
        return;
    }

    const { error } = await supabaseClient
        .from("previous_timesheet_weeks")
        .delete()
        .eq("id", id);

    if (error) {
        alert("Timesheet could not be deleted.");
        return;
    }

    timesheets = timesheets.filter((item) => item.id !== id);
    renderTimesheets();
}
