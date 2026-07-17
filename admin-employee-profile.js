function getEmployeeProfileAccounts() {
    return accounts
        .filter((account) => account.display_name || account.worker_key || account.email)
        .slice()
        .sort((a, b) => String(a.display_name || a.worker_key || a.email || "").localeCompare(String(b.display_name || b.worker_key || b.email || "")));
}

function getEmployeeAccountKey(account) {
    return normalizeWorkerName(account && (account.worker_key || account.display_name || account.email || ""));
}

function getEmployeeAccountDisplay(account) {
    return account && (account.display_name || account.worker_key || account.email || "Unknown Employee");
}

function renderEmployeeProfileOptions() {
    const select = document.getElementById("employeeProfileSelect");

    if (!select) {
        return;
    }

    const previousValue = select.value;
    const searchInput = document.getElementById("employeeProfileSearch");
    const search = searchInput ? searchInput.value.trim().toLowerCase() : "";
    const employeeAccounts = getEmployeeProfileAccounts().filter((account) => {
        const text = [
            account.display_name || "",
            account.worker_key || "",
            account.email || "",
            account.position || "",
            account.department || ""
        ].join(" ").toLowerCase();

        return !search || text.includes(search);
    });

    select.innerHTML = employeeAccounts.length
        ? employeeAccounts.map((account) => {
            const key = getEmployeeAccountKey(account);
            const detail = account.position || account.department || account.email || "";
            return `<option value="${escapeHtml(key)}">${escapeHtml(getEmployeeAccountDisplay(account) + (detail ? " - " + detail : ""))}</option>`;
        }).join("")
        : '<option value="">No employees found</option>';

    if (previousValue && employeeAccounts.some((account) => getEmployeeAccountKey(account) === previousValue)) {
        select.value = previousValue;
    }
}

function getSelectedEmployeeProfileAccount() {
    const select = document.getElementById("employeeProfileSelect");
    const employeeAccounts = getEmployeeProfileAccounts();
    const selectedKey = select && select.value ? select.value : getEmployeeAccountKey(employeeAccounts[0]);
    return employeeAccounts.find((account) => getEmployeeAccountKey(account) === selectedKey) || employeeAccounts[0] || null;
}

async function refreshEmployeeProfileAccount(account) {
    if (!supabaseClient || !account || !account.id) {
        return account;
    }

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("id,email,display_name,worker_key,role,account_status,created_at,approved_at,deactivated_at,phone,emergency_contact,address,position,department,hire_date,employment_type,supervisor,employee_id,avatar_path,last_login_at,last_portal_activity")
        .eq("id", account.id)
        .single();

    if (error || !data) {
        if (error) {
            logAdminLoadError("refresh employee profile", error);
        }

        return account;
    }

    accounts = accounts.map((item) => item.id === data.id ? { ...item, ...data } : item);
    return data;
}

function getEmployeeInitials(name) {
    const parts = String(name || "JGC").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "JGC";
}

function makeProfilePhotoFileName(fileName) {
    return String(fileName || "profile-photo")
        .toLowerCase()
        .replace(/[^a-z0-9.]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "profile-photo";
}

function getProfilePhotoExtension(fileName) {
    const match = String(fileName || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
}

function getProfilePhotoContentType(file) {
    if (file && file.type) {
        return file.type;
    }

    const extension = getProfilePhotoExtension(file && file.name);

    if (extension === "jpg" || extension === "jpeg") {
        return "image/jpeg";
    }

    if (extension === "png") {
        return "image/png";
    }

    if (extension === "webp") {
        return "image/webp";
    }

    if (extension === "heic") {
        return "image/heic";
    }

    if (extension === "heif") {
        return "image/heif";
    }

    return "image/jpeg";
}

function isProfilePhotoFile(file) {
    if (!file) {
        return false;
    }

    const type = String(file.type || "").toLowerCase();
    const extension = getProfilePhotoExtension(file.name);

    return type.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(extension);
}

function getProfilePhotoUrl(path) {
    if (!path) {
        return "";
    }

    const result = supabaseClient.storage
        .from("profile-photos")
        .getPublicUrl(path);

    return result && result.data ? result.data.publicUrl : "";
}

function getProfileAvatarHtml(account, employeeName) {
    const photoUrl = getProfilePhotoUrl(account && account.avatar_path);
    return photoUrl
        ? '<img src="' + escapeHtml(photoUrl) + '" alt="Profile photo">'
        : escapeHtml(getEmployeeInitials(employeeName));
}

function employeeMatchesValue(account, value) {
    const text = normalizeWorkerName(value || "");
    const accountKey = getEmployeeAccountKey(account);
    const displayKey = normalizeWorkerName(account && account.display_name);
    const emailKey = normalizeWorkerName(account && account.email);

    return Boolean(text && (text === accountKey || text === displayKey || text === emailKey));
}

function employeeMatchesAny(account, item, fields) {
    return fields.some((field) => employeeMatchesValue(account, item && item[field]));
}

function profileDateValue(value) {
    if (!value) {
        return null;
    }

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function isDateInCurrentMonth(value) {
    const date = profileDateValue(value);
    const now = new Date();
    return Boolean(date && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth());
}

function isDateInCurrentYear(value) {
    const date = profileDateValue(value);
    const now = new Date();
    return Boolean(date && date.getFullYear() === now.getFullYear());
}

function getEmployeeProfileTimesheetEntries(account) {
    const rows = [];

    liveTimesheetEntries
        .filter((entry) => employeeMatchesAny(account, entry, ["worker_name", "user"]))
        .forEach((entry) => {
            rows.push({
                source: "Live",
                date: getLiveTimesheetEntryDate(entry),
                day: entry.day_of_week || "",
                job: entry.job_name || "",
                jobNumber: entry.job_number || "",
                type: getAdminTimesheetEntryType(entry),
                note: getAdminTimesheetLeaveNote(entry),
                hours: Number(entry.hours || 0),
                savedAt: entry.created_at || entry.updated_at || ""
            });
        });

    timesheets
        .filter((week) => employeeMatchesAny(account, week, ["worker_name"]))
        .forEach((week) => {
            (Array.isArray(week.entries) ? week.entries : []).forEach((entry) => {
                rows.push({
                    source: "Submitted",
                    date: getTimesheetEntryDate(entry),
                    day: getTimesheetEntryValue(entry, "day", "day_of_week", ""),
                    job: getTimesheetEntryValue(entry, "jobName", "job_name", ""),
                    jobNumber: getTimesheetEntryValue(entry, "jobNumber", "job_number", ""),
                    type: getAdminTimesheetEntryType(entry),
                    note: getAdminTimesheetLeaveNote(entry),
                    hours: Number(getTimesheetEntryValue(entry, "hours", "hours", 0)),
                    savedAt: week.submitted_at || week.created_at || ""
                });
            });
        });

    return rows.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
}

function getEmployeeProfileEntryType(entry) {
    return entry && entry.type ? entry.type : getAdminTimesheetEntryType(entry);
}

function getEmployeeProfileEntryLabel(entry) {
    const type = getEmployeeProfileEntryType(entry);

    if (type === "sick") {
        return "Sick Day";
    }

    if (type === "vacation") {
        return "Vacation Day";
    }

    if (type === "civic_holiday") {
        return "Civic Holiday";
    }

    return "Work";
}

function sumEmployeeHours(entries, predicate) {
    return entries
        .filter((entry) => getEmployeeProfileEntryType(entry) === "work")
        .filter(predicate)
        .reduce((total, entry) => total + Number(entry.hours || 0), 0);
}

function getEmployeeCurrentWeekRange() {
    const start = makeLocalDate(getCurrentWeekStartForSummary());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

function isDateInRange(value, start, end) {
    const date = profileDateValue(value);
    return Boolean(date && date >= start && date <= end);
}

function getEmployeeProfileVacationRequests(account) {
    return vacationRequests
        .filter((request) => employeeMatchesAny(account, request, ["worker_name", "worker_display_name"]))
        .sort((a, b) => String(b.created_at || b.start_date || "").localeCompare(String(a.created_at || a.start_date || "")));
}

function getEmployeeProfileCertificates(account) {
    return certificates
        .filter((certificate) => employeeMatchesAny(account, certificate, ["worker_name"]))
        .sort((a, b) => String(a.expiry_date || "9999-12-31").localeCompare(String(b.expiry_date || "9999-12-31")));
}

function getEmployeeProfileInspections(account) {
    const standardRows = inspections
        .filter((inspection) => employeeMatchesAny(account, inspection, ["worker_name", "worker_display_name"]))
        .map((inspection) => ({ ...inspection, employee_profile_type: inspection.inspection_type || "" }));
    const vehicleRows = vehicleInspections
        .filter((inspection) => employeeMatchesAny(account, inspection, ["driver_employee_key", "driver_name"]))
        .map((inspection) => ({
            ...inspection,
            inspection_type: inspection.inspection_type || "Vehicle / Trailer",
            employee_profile_type: [
                inspection.inspection_type || "Vehicle / Trailer",
                inspection.vehicle_license_plate || inspection.vehicle_name || ""
            ].filter(Boolean).join(" - ")
        }));

    return standardRows.concat(vehicleRows)
        .sort((a, b) => String(b.created_at || b.inspection_date || "").localeCompare(String(a.created_at || a.inspection_date || "")));
}

function getEmployeeProfileDailyReports(account) {
    return dailySiteReports
        .filter((report) => employeeMatchesAny(account, report, ["worker_name", "worker_display_name"]))
        .sort((a, b) => String(b.created_at || b.report_date || "").localeCompare(String(a.created_at || a.report_date || "")));
}

function getEmployeeProfileToolboxAttendance(account) {
    return toolboxAttendance
        .filter((ack) => employeeMatchesAny(account, ack, ["worker_name", "worker_display_name"]))
        .sort((a, b) => String(b.created_at || b.acknowledged_at || "").localeCompare(String(a.created_at || a.acknowledged_at || "")));
}

function getEmployeeProfileAnnouncementReceipts(account) {
    return announcementAcknowledgements
        .filter((receipt) => receipt.worker_id === account.id || employeeMatchesAny(account, receipt, ["worker_name", "worker_email"]))
        .sort((a, b) => String(b.read_at || b.created_at || "").localeCompare(String(a.read_at || a.created_at || "")));
}

function getEmployeeProfileEquipment(account) {
    return equipmentItems
        .filter((item) => employeeMatchesAny(account, item, ["operator_name"]))
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function getEmployeeProfileWorkOrders(account) {
    const employeeLabour = workOrderLabourRows.filter((row) => employeeMatchesAny(account, row, ["worker_key", "employee_name"]));
    const ids = new Set(employeeLabour.map((row) => row.work_order_id));

    return workOrders
        .filter((wo) => ids.has(wo.id))
        .map((wo) => ({
            ...wo,
            employeeLabour: employeeLabour.filter((row) => row.work_order_id === wo.id)
        }))
        .sort((a, b) => String(b.work_order_date || b.created_at || "").localeCompare(String(a.work_order_date || a.created_at || "")));
}

function getLatestEmployeeProfileActivity(items, fields) {
    const dates = [];

    items.forEach((item) => {
        fields.forEach((field) => {
            const date = profileDateValue(item && item[field]);

            if (date) {
                dates.push(date);
            }
        });
    });

    if (!dates.length) {
        return "";
    }

    return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}

function getLatestEmployeeProfileDate(values) {
    const dates = values
        .map(profileDateValue)
        .filter(Boolean);

    if (!dates.length) {
        return "";
    }

    return new Date(Math.max(...dates.map((date) => date.getTime()))).toISOString();
}

function renderEmployeeProfileTile(title, value, detail, tab) {
    const action = tab
        ? (String(tab).endsWith(".html") ? ` onclick="window.location.href='${escapeHtml(tab)}'"` : ` onclick="openAdminSummaryTile('${tab}')"` )
        : " disabled";

    return `
        <button type="button" class="profile-tile"${action}>
            <h4>${escapeHtml(title)}</h4>
            <div class="profile-number">${escapeHtml(String(value))}</div>
            <div class="small">${escapeHtml(detail || "")}</div>
        </button>
    `;
}

function renderEmployeeProfileTable(columns, rows, emptyText) {
    if (!rows.length) {
        return `<div class="small">${escapeHtml(emptyText)}</div>`;
    }

    return `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            ${columns.map((column) => `<td>${escapeHtml(column.value(row))}</td>`).join("")}
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function getEmployeeProfileSickRows(account) {
    return buildAdminSickDayRows()
        .filter((row) => employeeMatchesValue(account, row.worker))
        .sort((a, b) => {
            const dateDifference = (b.date ? b.date.getTime() : 0) - (a.date ? a.date.getTime() : 0);
            return dateDifference || String(b.submitted || "").localeCompare(String(a.submitted || ""));
        });
}

function setEmployeeProfileSickStatus(message, isError) {
    const status = document.getElementById("employeeProfileSickStatus");

    if (!status) {
        return;
    }

    status.textContent = message || "";
    status.style.color = isError ? "#ffb4a8" : "";
}

function renderEmployeeProfileSickDays(rows) {
    const tableHtml = rows.length
        ? `
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
                        ${rows.map((row) => `
                            <tr>
                                <td>${row.date ? escapeHtml(formatTimesheetPdfDate(row.date)) : ""}</td>
                                <td>${escapeHtml(row.day || "")}</td>
                                <td>${escapeHtml(row.reason || "")}</td>
                                <td>${escapeHtml(row.status || "")}</td>
                                <td>${escapeHtml(formatDate(row.submitted))}</td>
                                <td><button type="button" class="delete-button" onclick="deleteAdminSickDay('${escapeHtml(row.id)}')">Delete</button></td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `
        : '<div class="small">No sick days found for this employee.</div>';

    return `
        <details class="profile-edit-drawer">
            <summary>Add Sick Day</summary>
            <div class="form-grid" style="margin-top:10px;">
                <div>
                    <label>Sick Date</label>
                    <input id="employeeProfileSickDate" type="date">
                </div>
                <div>
                    <label>Reason / Note</label>
                    <input id="employeeProfileSickReason" placeholder="Example: Sick, headache, appointment">
                </div>
            </div>
            <div class="actions" style="margin-top:10px;">
                <button type="button" onclick="addEmployeeProfileSickDay()">Add Sick Day</button>
            </div>
            <div id="employeeProfileSickStatus" class="small" style="margin-top:8px;"></div>
        </details>
        ${tableHtml}
    `;
}

async function addEmployeeProfileSickDay() {
    if (!supabaseClient) {
        setEmployeeProfileSickStatus("Supabase is not available. Sick day could not be saved.", true);
        return;
    }

    const account = getSelectedEmployeeProfileAccount();
    const workerKey = getAdminSickDayWorkerKey(account);
    const dateInput = document.getElementById("employeeProfileSickDate");
    const reasonInput = document.getElementById("employeeProfileSickReason");
    const dateValue = dateInput ? dateInput.value : "";
    const reason = reasonInput ? reasonInput.value.trim() : "";

    if (!workerKey || !dateValue) {
        setEmployeeProfileSickStatus("Choose a sick date.", true);
        return;
    }

    if (hasAdminSickDayForDate(workerKey, dateValue)) {
        setEmployeeProfileSickStatus("This employee already has a sick day saved for this date.", true);
        return;
    }

    const selectedDate = makeLocalDate(dateValue);

    if (Number.isNaN(selectedDate.getTime())) {
        setEmployeeProfileSickStatus("Choose a valid sick date.", true);
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

    setEmployeeProfileSickStatus("Saving sick day...");

    const { data, error } = await supabaseClient
        .from("timesheet_entries")
        .insert(row)
        .select()
        .single();

    if (error) {
        setEmployeeProfileSickStatus("Sick day could not be saved: " + error.message, true);
        return;
    }

    if (data) {
        liveTimesheetEntries = [data].concat(liveTimesheetEntries);
    }

    if (dateInput) {
        dateInput.value = "";
    }

    if (reasonInput) {
        reasonInput.value = "";
    }

    renderTimesheets();
    renderSickDays();
    renderEmployeeProfile();
    renderPortalSummary();
}

async function renderEmployeeProfile() {
    const hero = document.getElementById("employeeProfileHero");
    const dashboard = document.getElementById("employeeProfileDashboard");

    if (!hero || !dashboard) {
        return;
    }

    renderEmployeeProfileOptions();

    let account = getSelectedEmployeeProfileAccount();

    if (!account) {
        hero.innerHTML = '<div class="profile-avatar">JGC</div><div><h3>No employees found</h3><div class="small">Approve employee accounts to build profile dashboards.</div></div>';
        dashboard.innerHTML = "";
        return;
    }

    const selectedId = account.id;
    account = await refreshEmployeeProfileAccount(account);
    renderEmployeeProfileOptions();
    const select = document.getElementById("employeeProfileSelect");

    if (select && selectedId) {
        select.value = getEmployeeAccountKey(account);
    }

    const employeeName = getEmployeeAccountDisplay(account);
    const status = account.account_status || "unknown";
    const timesheetEntries = getEmployeeProfileTimesheetEntries(account);
    const vacationRows = getEmployeeProfileVacationRequests(account);
    const certificateRows = getEmployeeProfileCertificates(account);
    const inspectionRows = getEmployeeProfileInspections(account);
    const dailyReportRows = getEmployeeProfileDailyReports(account);
    const toolboxRows = getEmployeeProfileToolboxAttendance(account);
    const announcementRows = getEmployeeProfileAnnouncementReceipts(account);
    const equipmentRows = getEmployeeProfileEquipment(account);
    const workOrderRows = getEmployeeProfileWorkOrders(account);
    const sickRows = getEmployeeProfileSickRows(account);
    const weekRange = getEmployeeCurrentWeekRange();
    const hoursThisWeek = sumEmployeeHours(timesheetEntries, (entry) => isDateInRange(entry.date, weekRange.start, weekRange.end));
    const hoursThisMonth = sumEmployeeHours(timesheetEntries, (entry) => isDateInCurrentMonth(entry.date));
    const hoursThisYear = sumEmployeeHours(timesheetEntries, (entry) => isDateInCurrentYear(entry.date));
    const sickMonth = timesheetEntries.filter((entry) => getEmployeeProfileEntryType(entry) === "sick" && isDateInCurrentMonth(entry.date)).length;
    const sickYear = timesheetEntries.filter((entry) => getEmployeeProfileEntryType(entry) === "sick" && isDateInCurrentYear(entry.date)).length;
    const vacationMonth = timesheetEntries.filter((entry) => getEmployeeProfileEntryType(entry) === "vacation" && isDateInCurrentMonth(entry.date)).length;
    const vacationYear = timesheetEntries.filter((entry) => getEmployeeProfileEntryType(entry) === "vacation" && isDateInCurrentYear(entry.date)).length;
    const pendingVacations = vacationRows.filter((request) => String(request.status || "").toLowerCase() === "pending");
    const approvedVacations = vacationRows.filter((request) => String(request.status || "").toLowerCase() === "approved");
    const activeCertificates = certificateRows.filter((certificate) => getCertificateStatus(certificate.expiry_date) === "Valid" || getCertificateStatus(certificate.expiry_date) === "No Expiry");
    const expiringCertificates = certificateRows.filter((certificate) => getCertificateStatus(certificate.expiry_date) === "Expiring Soon");
    const expiredCertificates = certificateRows.filter((certificate) => getCertificateStatus(certificate.expiry_date) === "Expired");
    const inspectionsThisMonth = inspectionRows.filter((inspection) => isDateInCurrentMonth(inspection.inspection_date || inspection.created_at)).length;
    const dailyReportsThisMonth = dailyReportRows.filter((report) => isDateInCurrentMonth(report.report_date || report.created_at)).length;
    const workOrdersCompletedThisWeek = workOrderRows.filter((wo) =>
        isDateInRange(wo.work_order_date || wo.submitted_at || wo.created_at, weekRange.start, weekRange.end) &&
        wo.employeeLabour.some((row) => row.complete)
    ).length;
    const toolboxCompleted = toolboxRows.filter((ack) => ack.acknowledged_at).length;
    const toolboxOutstanding = toolboxRows.filter((ack) => !ack.acknowledged_at).length;
    const announcementReadIds = new Set(announcementRows.map((receipt) => receipt.announcement_id));
    const unreadAnnouncements = announcements.filter((announcement) => !announcementReadIds.has(announcement.id)).length;
    const lastTimesheet = timesheets
        .filter((week) => employeeMatchesAny(account, week, ["worker_name"]))
        .sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")))[0];
    const profileLogin = getLatestEmployeeProfileDate([
        account.last_login_at,
        account.last_portal_activity
    ]);

    hero.innerHTML = `
        <div class="profile-avatar">${getProfileAvatarHtml(account, employeeName)}</div>
        <div>
            <h3>${escapeHtml(employeeName)}</h3>
            <span class="profile-status-pill">${escapeHtml(capitalizeWords(status))}</span>
            <div class="profile-contact-grid">
                <div class="profile-fact"><span class="profile-fact-icon">@</span><div><strong>Email</strong><div class="small">${escapeHtml(account.email || "Not added")}</div></div></div>
                <div class="profile-fact"><span class="profile-fact-icon">PH</span><div><strong>Phone</strong><div class="small">${escapeHtml(account.phone || "Not added")}</div></div></div>
                <div class="profile-fact"><span class="profile-fact-icon">EM</span><div><strong>Emergency Contact</strong><div class="small">${escapeHtml(account.emergency_contact || "Not added")}</div></div></div>
                <div class="profile-fact"><span class="profile-fact-icon">AD</span><div><strong>Address</strong><div class="small">${escapeHtml(account.address || "Not added")}</div></div></div>
                <div class="profile-fact"><span class="profile-fact-icon">POS</span><div><strong>Position</strong><div class="small">${escapeHtml(account.position || "Not added")}</div></div></div>
                <div class="profile-fact"><span class="profile-fact-icon">DEP</span><div><strong>Department</strong><div class="small">${escapeHtml(account.department || "Not added")}</div></div></div>
                <div class="profile-fact"><span class="profile-fact-icon">LOG</span><div><strong>Last Login</strong><div class="small">${escapeHtml(profileLogin ? formatDate(profileLogin) : "Not logged yet")}</div></div></div>
            </div>
        </div>
    `;

    populateEmployeeProfileEditForm(account);

    dashboard.innerHTML = `
        <div class="profile-grid">
            ${renderEmployeeProfileTile("Hours This Week", hoursThisWeek.toFixed(2), "Live and submitted work hours", "timesheets")}
            ${renderEmployeeProfileTile("Hours This Month", hoursThisMonth.toFixed(2), "Work hours this month", "timesheets")}
            ${renderEmployeeProfileTile("Hours This Year", hoursThisYear.toFixed(2), "Work hours this year", "timesheets")}
            ${renderEmployeeProfileTile("Sick Days", sickMonth + " / " + sickYear, "This month / this year")}
            ${renderEmployeeProfileTile("Vacation Days", vacationMonth + " / " + vacationYear, "This month / this year", "vacation")}
            ${renderEmployeeProfileTile("Pending Vacation", pendingVacations.length, "Requests waiting for review", "vacation")}
            ${renderEmployeeProfileTile("Certificates", activeCertificates.length, "Active certificates", "certificates")}
            ${renderEmployeeProfileTile("Expiring / Expired", expiringCertificates.length + " / " + expiredCertificates.length, "Certificates needing attention", "certificates")}
            ${renderEmployeeProfileTile("Inspections", inspectionsThisMonth, "Completed this month", "inspections")}
            ${renderEmployeeProfileTile("Daily Reports", dailyReportsThisMonth, "Submitted this month", "reports")}
            ${renderEmployeeProfileTile("Work Orders", workOrdersCompletedThisWeek, "Completed this week", "workOrders")}
            ${renderEmployeeProfileTile("Toolbox Talks", toolboxCompleted + " / " + toolboxOutstanding, "Completed / outstanding", "reports")}
            ${renderEmployeeProfileTile("Announcements", announcementRows.length + " / " + unreadAnnouncements, "Read / unread", "noticePolicy")}
            ${renderEmployeeProfileTile("Equipment", equipmentRows.length, "Assigned equipment or vehicles", "equipment")}
            ${renderEmployeeProfileTile("Last Login", profileLogin ? formatDate(profileLogin) : "Not logged yet", "Most recent successful login")}
        </div>

        <div class="profile-two-column profile-section">
            <div class="profile-panel">
                <div class="profile-panel-header"><h3>Vacation Requests</h3><button type="button" onclick="openAdminSummaryTile('vacation')">View All</button></div>
                ${renderEmployeeProfileTable([
                    { label: "Dates", value: (row) => (row.start_date || "") + (row.end_date && row.end_date !== row.start_date ? " to " + row.end_date : "") },
                    { label: "Status", value: (row) => formatVacationStatus(row.status) },
                    { label: "Type", value: (row) => row.leave_type || row.vacation_type || "" }
                ], vacationRows.slice(0, 8), "No vacation requests found.")}
            </div>
            <div class="profile-panel">
                <div class="profile-panel-header"><h3>Certificates</h3><button type="button" onclick="openAdminSummaryTile('certificates')">View All</button></div>
                ${renderEmployeeProfileTable([
                    { label: "Certificate", value: (row) => row.certificate_name || "" },
                    { label: "Expiry", value: (row) => row.expiry_date || "No expiry" },
                    { label: "Status", value: (row) => getCertificateStatus(row.expiry_date) }
                ], certificateRows.slice(0, 8), "No certificates found.")}
            </div>
        </div>

        <div class="profile-two-column profile-section">
            <div class="profile-panel">
                <div class="profile-panel-header"><h3>Sick Days</h3><button type="button" onclick="openAdminSummaryTile('timesheets')">View Timesheets</button></div>
                <div class="small" style="margin-bottom:8px;"><strong>This Month:</strong> ${escapeHtml(String(sickMonth))} &nbsp; <strong>This Year:</strong> ${escapeHtml(String(sickYear))}</div>
                ${renderEmployeeProfileSickDays(sickRows.slice(0, 12))}
            </div>
            <div class="profile-panel">
                <div class="profile-panel-header"><h3>Attendance Summary</h3><button type="button" onclick="openAdminSummaryTile('vacation')">Vacation</button></div>
                ${renderEmployeeProfileTable([
                    { label: "Type", value: (row) => row.type },
                    { label: "This Month", value: (row) => row.month },
                    { label: "This Year", value: (row) => row.year }
                ], [
                    { type: "Sick Days", month: sickMonth, year: sickYear },
                    { type: "Vacation Days", month: vacationMonth, year: vacationYear }
                ], "No attendance records found.")}
            </div>
        </div>

        <div class="profile-two-column profile-section">
            <div class="profile-panel">
                <div class="profile-panel-header"><h3>Timesheets</h3><button type="button" onclick="openAdminSummaryTile('timesheets')">View All</button></div>
                <div class="small" style="margin-bottom:8px;"><strong>Last Timesheet Submitted:</strong> ${escapeHtml(lastTimesheet ? formatDate(lastTimesheet.submitted_at) : "None")}</div>
                ${renderEmployeeProfileTable([
                    { label: "Date", value: (row) => row.date ? formatTimesheetPdfDate(row.date) : "" },
                    { label: "Entry", value: (row) => row.job || getEmployeeProfileEntryLabel(row) },
                    { label: "Hours", value: (row) => Number(row.hours || 0).toFixed(2) },
                    { label: "Source", value: (row) => row.source }
                ], timesheetEntries.slice(0, 10), "No timesheet history found.")}
            </div>
            <div class="profile-panel">
                <div class="profile-panel-header"><h3>Inspections</h3><button type="button" onclick="openAdminSummaryTile('inspections')">View All</button></div>
                ${renderEmployeeProfileTable([
                    { label: "Date", value: (row) => formatDate(row.inspection_date || row.created_at) },
                    { label: "Type", value: (row) => row.employee_profile_type || row.inspection_type || "" },
                    { label: "Saved", value: (row) => formatDate(row.created_at) }
                ], inspectionRows.slice(0, 10), "No inspections found.")}
            </div>
        </div>

        <div class="profile-two-column profile-section">
            <div class="profile-panel">
                <div class="profile-panel-header"><h3>Daily Reports</h3><button type="button" onclick="openAdminSummaryTile('reports')">View All</button></div>
                ${renderEmployeeProfileTable([
                    { label: "Date", value: (row) => formatDate(row.report_date || row.created_at) },
                    { label: "Project", value: (row) => row.project || "" },
                    { label: "Saved", value: (row) => formatDate(row.created_at) }
                ], dailyReportRows.slice(0, 8), "No daily reports found.")}
            </div>
            <div class="profile-panel">
                <div class="profile-panel-header"><h3>Work Orders</h3><button type="button" onclick="openAdminSummaryTile('workOrders')">View All</button></div>
                ${renderEmployeeProfileTable([
                    { label: "WO #", value: (row) => row.wo_number || "" },
                    { label: "Date", value: (row) => formatDate(row.work_order_date || row.created_at) },
                    { label: "Job", value: (row) => [row.job_number, row.job_name].filter(Boolean).join(" - ") },
                    { label: "Hours", value: (row) => row.employeeLabour.reduce((total, labour) => total + Number(labour.hours || 0), 0).toFixed(2) }
                ], workOrderRows.slice(0, 8), "No Work Orders found.")}
            </div>
        </div>

        <div class="profile-two-column profile-section">
            <div class="profile-panel">
                <div class="profile-panel-header"><h3>Toolbox Talks</h3><button type="button" onclick="openAdminSummaryTile('reports')">View All</button></div>
                ${renderEmployeeProfileTable([
                    { label: "Talk", value: (row) => row.talk_title || row.toolbox_talk_title || row.title || "" },
                    { label: "Status", value: (row) => row.acknowledged_at ? "Acknowledged" : "Outstanding" },
                    { label: "Date", value: (row) => formatDate(row.acknowledged_at || row.created_at) }
                ], toolboxRows.slice(0, 8), "No toolbox talk records found.")}
            </div>
            <div class="profile-panel">
                <div class="profile-panel-header"><h3>Announcements</h3><button type="button" onclick="openAdminSummaryTile('noticePolicy')">View All</button></div>
                ${renderEmployeeProfileTable([
                    { label: "Announcement", value: (row) => row.announcement_title || row.title || row.announcement_id || "" },
                    { label: "Read", value: (row) => row.read_at ? "Read" : "Unread" },
                    { label: "Date", value: (row) => formatDate(row.read_at || row.created_at) }
                ], announcementRows.slice(0, 8), "No announcement reads found.")}
            </div>
        </div>

        <div class="profile-two-column profile-section">
            <div class="profile-panel">
                <div class="profile-panel-header"><h3>Equipment</h3><button type="button" onclick="openAdminSummaryTile('equipment')">View All</button></div>
                ${renderEmployeeProfileTable([
                    { label: "Name", value: (row) => row.name || "" },
                    { label: "ID", value: (row) => row.identification_number || "" },
                    { label: "Expiry", value: (row) => row.yearly_inspection_expiry || "" }
                ], equipmentRows.slice(0, 8), "No assigned equipment found.")}
            </div>
        </div>
    `;
}

function populateEmployeeProfileEditForm(account) {
    const fields = {
        profileDisplayName: account.display_name || "",
        profileEmployeeId: account.employee_id || "",
        profileEmail: account.email || "",
        profilePhone: account.phone || "",
        profilePosition: account.position || "",
        profileDepartment: account.department || "",
        profileHireDate: account.hire_date || "",
        profileEmploymentType: account.employment_type || "",
        profileSupervisor: account.supervisor || "",
        profileEmergencyContact: account.emergency_contact || "",
        profileAddress: account.address || ""
    };

    Object.keys(fields).forEach((id) => {
        const field = document.getElementById(id);

        if (field) {
            field.value = fields[id];
        }
    });

    const status = document.getElementById("employeeProfileSaveStatus");

    if (status) {
        status.textContent = "";
    }

    const photoInput = document.getElementById("profilePhotoFile");

    if (photoInput) {
        photoInput.value = "";
    }

    const drawer = document.querySelector("#employeeProfileEditSection .profile-edit-drawer");

    if (drawer) {
        drawer.open = false;
    }
}

async function uploadAdminProfilePhoto(account) {
    const fileInput = document.getElementById("profilePhotoFile");
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;

    if (!file) {
        return account.avatar_path || "";
    }

    if (!account.id) {
        throw new Error("This employee account does not have a profile id for photo uploads.");
    }

    if (!isProfilePhotoFile(file)) {
        throw new Error("Profile photo must be an image file.");
    }

    if (file.size > 5 * 1024 * 1024) {
        throw new Error("Profile photo must be under 5 MB.");
    }

    const filePath = account.id + "/" + Date.now() + "-" + makeProfilePhotoFileName(file.name);
    const { error } = await supabaseClient.storage
        .from("profile-photos")
        .upload(filePath, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: getProfilePhotoContentType(file)
        });

    if (error) {
        throw error;
    }

    return filePath;
}

async function saveEmployeeProfileDetails() {
    const account = getSelectedEmployeeProfileAccount();
    const status = document.getElementById("employeeProfileSaveStatus");

    if (!account) {
        alert("Select an employee first.");
        return;
    }

    if (status) {
        status.textContent = "Saving employee details...";
    }

    let data;
    let error;

    try {
        const avatarPath = await uploadAdminProfilePhoto(account);
        const values = {
            display_name: document.getElementById("profileDisplayName").value.trim(),
            employee_id: document.getElementById("profileEmployeeId").value.trim(),
            email: document.getElementById("profileEmail").value.trim(),
            phone: document.getElementById("profilePhone").value.trim(),
            position: document.getElementById("profilePosition").value.trim(),
            department: document.getElementById("profileDepartment").value.trim(),
            hire_date: document.getElementById("profileHireDate").value || null,
            employment_type: document.getElementById("profileEmploymentType").value.trim(),
            supervisor: document.getElementById("profileSupervisor").value.trim(),
            emergency_contact: document.getElementById("profileEmergencyContact").value.trim(),
            address: document.getElementById("profileAddress").value.trim(),
            avatar_path: avatarPath || null
        };

        const result = await supabaseClient
            .from("profiles")
            .update(values)
            .eq("id", account.id)
            .select("id,email,display_name,worker_key,role,account_status,created_at,approved_at,deactivated_at,phone,emergency_contact,address,position,department,hire_date,employment_type,supervisor,employee_id,avatar_path,last_login_at,last_portal_activity")
            .single();

        data = result.data;
        error = result.error;
    } catch (uploadError) {
        error = uploadError;
    }

    if (error) {
        if (status) {
            status.textContent = "Employee details could not be saved: " + (error.message || error);
        }
        return;
    }

    accounts = accounts.map((item) => item.id === account.id ? data : item);
    renderEmployeeProfileOptions();
    const select = document.getElementById("employeeProfileSelect");

    if (select) {
        select.value = getEmployeeAccountKey(data);
    }

    renderEmployeeProfile();

    if (status) {
        status.textContent = "Employee details saved.";
    }
}
