function getLocalDateValue(date) {
    return date.toISOString().slice(0, 10);
}

function isSameLocalDay(value, dateValue) {
    if (!value) {
        return false;
    }

    return String(value).slice(0, 10) === dateValue;
}

function countRecentReportsToday(todayValue) {
    const dailyCount = dailySiteReports.filter((report) => isSameLocalDay(report.report_date || report.created_at, todayValue)).length;
    const incidentCount = incidentReports.filter((report) => isSameLocalDay(report.report_date || report.created_at, todayValue)).length;
    const accidentCount = accidentReports.filter((report) => isSameLocalDay(report.accident_date || report.created_at, todayValue)).length;
    const injuryCount = employeeInjuryReports.filter((report) => isSameLocalDay(report.accident_date || report.created_at, todayValue)).length;
    const toolboxCount = toolboxReports.filter((report) => isSameLocalDay(report.report_date || report.created_at, todayValue)).length;

    return dailyCount + incidentCount + accidentCount + injuryCount + toolboxCount;
}

function getAdminViewedKey(tab) {
    return "jgcAdminLastViewed_" + tab;
}

function initializeAdminSummaryBaselines() {
    const now = new Date().toISOString();

    ["jobDashboard", "employeeProfile", "timesheets", "inspections", "reports", "certificates", "vacation", "tasks", "workOrders", "adminTools", "noticePolicy", "jobs", "equipment", "contacts", "subcontractorsSuppliers", "backups", "accounts"].forEach((tab) => {
        const key = getAdminViewedKey(tab);

        if (!localStorage.getItem(key)) {
            localStorage.setItem(key, now);
        }
    });
}

function getAdminLastViewed(tab) {
    return localStorage.getItem(getAdminViewedKey(tab)) || "1970-01-01T00:00:00.000Z";
}

function markAdminTabViewed(tab) {
    localStorage.setItem(getAdminViewedKey(tab), new Date().toISOString());
    renderPortalSummary();
}

function openAdminSummaryTile(tab) {
    markAdminTabViewed(tab);
    showTab(tab);
}

function openAccountsFromSummary() {
    localStorage.setItem(getAdminViewedKey("accounts"), new Date().toISOString());
    window.location.href = "accounts.html";
}

function normalizeAdminGlobalSearchText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getAdminGlobalSearchDateAliases(value) {
    let date = null;

    if (value instanceof Date) {
        date = value;
    } else {
        const text = String(value || "").trim();
        const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
        const readableDate = /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/i.test(text);

        if (isoMatch) {
            date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
        } else if (readableDate) {
            const parsed = new Date(text);
            date = Number.isNaN(parsed.getTime()) ? null : parsed;
        }
    }

    if (!date || Number.isNaN(date.getTime())) {
        return "";
    }

    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear();
    const longMonth = date.toLocaleDateString("en-US", { month: "long" });
    const shortMonth = date.toLocaleDateString("en-US", { month: "short" });
    const weekday = date.toLocaleDateString("en-US", { weekday: "long" });

    return [
        longMonth + " " + day,
        longMonth + " " + day + " " + year,
        shortMonth + " " + day,
        shortMonth + " " + day + " " + year,
        month + "/" + day,
        month + "/" + day + "/" + year,
        year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0"),
        weekday
    ].join(" ");
}

function collectAdminGlobalSearchValues(value, output, depth) {
    if (value === null || value === undefined || depth > 6) {
        return;
    }

    if (value instanceof Date) {
        output.push(getAdminGlobalSearchDateAliases(value));
        return;
    }

    if (Array.isArray(value)) {
        value.forEach((item) => collectAdminGlobalSearchValues(item, output, depth + 1));
        return;
    }

    if (typeof value === "object") {
        Object.values(value).forEach((item) => collectAdminGlobalSearchValues(item, output, depth + 1));
        return;
    }

    const text = String(value);
    output.push(text);
    const dateAliases = getAdminGlobalSearchDateAliases(value);

    if (dateAliases) {
        output.push(dateAliases);
    }
}

function getAdminGlobalSearchValue(record, keys) {
    for (const key of keys || []) {
        const value = record && record[key];

        if (value !== null && value !== undefined && String(value).trim()) {
            return Array.isArray(value) ? value.join(", ") : String(value);
        }
    }

    return "";
}

function joinAdminGlobalSearchDetails(record, keys) {
    const values = [];

    (keys || []).forEach((key) => {
        const value = getAdminGlobalSearchValue(record, [key]);

        if (value && !values.includes(value)) {
            values.push(value);
        }
    });

    return values.slice(0, 4).join(" | ");
}

function formatAdminGlobalSearchPoNumber(value) {
    const normalized = String(value || "").trim().replace(/^po[-\s]*/i, "");
    return normalized ? "PO-" + normalized : "PO record";
}

function addAdminGlobalSearchCollection(index, config) {
    (config.records || []).forEach((record, recordIndex) => {
        const titleValue = typeof config.title === "function"
            ? config.title(record)
            : getAdminGlobalSearchValue(record, config.titleKeys);
        const detailValue = typeof config.detail === "function"
            ? config.detail(record)
            : joinAdminGlobalSearchDetails(record, config.detailKeys);
        const searchValues = [config.category, config.keywords || "", titleValue, detailValue];

        collectAdminGlobalSearchValues(record, searchValues, 0);

        if (typeof config.extraSearch === "function") {
            collectAdminGlobalSearchValues(config.extraSearch(record), searchValues, 0);
        }

        index.push({
            group: config.group || "",
            category: config.category,
            title: titleValue || config.category + " record",
            detail: detailValue,
            tab: config.tab,
            action: config.action || "",
            recordId: record.id || "",
            searchText: normalizeAdminGlobalSearchText(searchValues.join(" ")),
            sortDate: getAdminGlobalSearchValue(record, config.dateKeys || ["updated_at", "created_at"]),
            sourceIndex: recordIndex
        });
    });
}

function buildAdminGlobalSearchIndex() {
    const index = [];
    const collections = [
        { category: "Submitted Timesheet", records: timesheets, tab: "timesheets", action: "submitted_timesheet", keywords: "timesheet hours employee worker job site", titleKeys: ["worker_name"], detailKeys: ["week_label", "total_hours", "note"], dateKeys: ["submitted_at", "week_start", "created_at"], extraSearch: (week) => (week.entries || []).map((entry) => getAdminTimesheetEntryDate(week, entry)) },
        { category: "Live Timesheet", records: liveTimesheetEntries, tab: "timesheets", action: "live_timesheet", keywords: "timesheet hours employee worker job site", titleKeys: ["worker_name"], detailKeys: ["day_of_week", "job_name", "job_number", "hours"], dateKeys: ["week_start", "created_at"], extraSearch: (entry) => getLiveTimesheetEntryDate(entry) },
        { category: "Inspection", records: inspections, tab: "inspections", keywords: "inspection permit safety worker employee job site", titleKeys: ["worker_name", "completed_by", "inspection_type"], detailKeys: ["inspection_type", "job_number", "job_name", "location"], dateKeys: ["inspection_date", "created_at"] },
        { category: "Vehicle Inspection", records: vehicleInspections, tab: "inspections", keywords: "vehicle trailer inspection plate driver", titleKeys: ["driver_name", "worker_name", "vehicle_license_plate"], detailKeys: ["vehicle_license_plate", "trailer_1_license_plate", "inspection_type", "location"], dateKeys: ["inspection_date", "created_at"] },
        { category: "Certificate", records: certificates, tab: "certificates", keywords: "certificate training employee worker expiry", titleKeys: ["worker_name", "employee_name", "certificate_name"], detailKeys: ["certificate_type", "certificate_name", "expiry_date", "status"], dateKeys: ["expiry_date", "issued_date", "created_at"] },
        { category: "Certificate Alert", records: certificateNotifications, tab: "certificates", keywords: "certificate training expiry notification", titleKeys: ["worker_name", "certificate_name"], detailKeys: ["certificate_type", "expiry_date", "message"], dateKeys: ["expiry_date", "created_at"] },
        { category: "Vacation", records: vacationRequests, tab: "vacation", keywords: "vacation holiday leave employee worker", titleKeys: ["worker_display_name", "worker_name"], detailKeys: ["start_date", "end_date", "request_type", "status"], dateKeys: ["start_date", "end_date", "created_at"] },
        { category: "Schedule", records: scheduleEvents, tab: "summary", keywords: "schedule calendar appointment training job equipment vehicle", titleKeys: ["title", "job_name", "event_type"], detailKeys: ["event_date", "job_number", "location", "notes"], dateKeys: ["event_date", "created_at"] },
        { category: "Employee Profile", records: accounts, tab: "employeeProfile", keywords: "employee worker account profile phone email", titleKeys: ["display_name", "worker_key", "email"], detailKeys: ["email", "position", "department", "employee_id"], dateKeys: ["hire_date", "created_at"] },
        { category: "Announcement", records: announcements, tab: "noticePolicy", keywords: "announcement notice message", titleKeys: ["title", "subject"], detailKeys: ["description", "message", "created_by_name"], dateKeys: ["published_at", "created_at"] },
        { category: "Announcement Acknowledgement", records: announcementAcknowledgements, tab: "noticePolicy", keywords: "announcement notice acknowledgement employee worker", titleKeys: ["worker_name", "display_name", "employee_name"], detailKeys: ["announcement_title", "title", "status"], dateKeys: ["read_at", "acknowledged_at", "created_at"] },
        { category: "Policy", records: policies, tab: "noticePolicy", keywords: "policy document safety", titleKeys: ["title", "name"], detailKeys: ["category", "description"], dateKeys: ["published_at", "created_at"] },
        { category: "Toolbox Talk", records: toolboxTalks, tab: "reports", keywords: "toolbox talk safety meeting", titleKeys: ["title", "topic"], detailKeys: ["description", "job_number", "location"], dateKeys: ["talk_date", "created_at"] },
        { category: "Toolbox Report", records: toolboxReports, tab: "reports", keywords: "toolbox talk report safety employee worker", titleKeys: ["title", "worker_name", "completed_by_name"], detailKeys: ["topic", "job_number", "location"], dateKeys: ["report_date", "created_at"] },
        { category: "Toolbox Attendance", records: toolboxAttendance, tab: "reports", keywords: "toolbox talk attendance employee worker", titleKeys: ["attendee_name", "worker_name"], detailKeys: ["toolbox_talk_title", "company", "status"], dateKeys: ["acknowledged_at", "created_at"] },
        { category: "Daily Site Report", records: dailySiteReports, tab: "reports", keywords: "daily site report job project worker", titleKeys: ["job_name", "project", "worker_name"], detailKeys: ["job_number", "report_date", "location", "completed_by"], dateKeys: ["report_date", "created_at"] },
        { category: "Incident Report", records: incidentReports, tab: "reports", keywords: "incident near miss safety report employee worker job", titleKeys: ["incident_type", "worker_name", "reported_by"], detailKeys: ["job_number", "job_name", "location", "description"], dateKeys: ["report_date", "incident_date", "created_at"] },
        { category: "Accident Report", records: accidentReports, tab: "reports", keywords: "accident safety injury report employee worker job", titleKeys: ["injured_employee_name", "worker_name", "reported_by"], detailKeys: ["job_number", "job_name", "accident_location", "description"], dateKeys: ["accident_date", "created_at"] },
        { category: "Accident Acknowledgement", records: accidentAcknowledgements, tab: "reports", keywords: "accident acknowledgement employee worker", titleKeys: ["worker_display_name", "worker_name"], detailKeys: ["status", "note"], dateKeys: ["acknowledged_at", "created_at"] },
        { category: "Employee Injury", records: employeeInjuryReports, tab: "reports", keywords: "employee injury accident report worker job", titleKeys: ["employee_name", "employee_display", "worker_name"], detailKeys: ["job_number", "accident_location", "accident_description"], dateKeys: ["accident_date", "created_at"] },
        { category: "Injury Acknowledgement", records: employeeInjuryAcknowledgements, tab: "reports", keywords: "employee injury acknowledgement worker", titleKeys: ["worker_display_name", "worker_name"], detailKeys: ["status", "note"], dateKeys: ["acknowledged_at", "created_at"] },
        { category: "Safety Acknowledgement", records: safetyAcknowledgements, tab: "reports", keywords: "safety acknowledgement employee worker", titleKeys: ["attendee_name", "worker_name", "record_title"], detailKeys: ["record_type", "record_title", "project", "location"], dateKeys: ["record_date", "acknowledged_at", "created_at"] },
        { category: "Job", records: jobs, tab: "jobDashboard", keywords: "job job number project site", title: (record) => [getAdminGlobalSearchValue(record, ["job_number"]), getAdminGlobalSearchValue(record, ["job_name"])].filter(Boolean).join(" - "), detailKeys: ["address", "job_type", "project_manager"], dateKeys: ["updated_at", "created_at"] },
        { category: "Work Order", records: workOrders, tab: "workOrders", action: "work_order", keywords: "work order wo wo number job customer", title: (record) => "WO " + (getAdminGlobalSearchValue(record, ["wo_number", "work_order_number", "number"]) || getAdminGlobalSearchValue(record, ["job_name"]) || "record"), detailKeys: ["job_number", "job_name", "customer_name", "status"], dateKeys: ["work_order_date", "submitted_at", "created_at"] },
        { group: "Purchase Orders", category: "Purchase Order", records: digitalPurchaseOrders, tab: "summary", action: "digital_purchase_order", keywords: "purchase order po po number supplier creator submitter job materials", title: (record) => formatAdminGlobalSearchPoNumber(getAdminGlobalSearchValue(record, ["po_number"])), detailKeys: ["supplier_name", "job_number", "job_name", "workflow_status"], dateKeys: ["order_date", "created_at"] },
        { category: "Work Order Labour", records: workOrderLabourRows, tab: "workOrders", keywords: "work order wo labour employee worker hours", titleKeys: ["employee_name", "worker_name"], detailKeys: ["wo_number", "job_number", "hours", "description"], dateKeys: ["work_date", "created_at"] },
        { category: "Work Order PO", records: workOrderPurchaseOrders, tab: "workOrders", keywords: "work order wo purchase order po supplier", titleKeys: ["po_number", "purchase_order_number", "supplier"], detailKeys: ["wo_number", "job_number", "description", "amount"], dateKeys: ["po_date", "created_at"] },
        { category: "Work Order Equipment", records: workOrderEquipmentRows, tab: "workOrders", keywords: "work order wo equipment vehicle", titleKeys: ["equipment_name", "name"], detailKeys: ["wo_number", "job_number", "hours", "description"], dateKeys: ["work_date", "created_at"] },
        { category: "Work Order Travel", records: workOrderTravelRows, tab: "workOrders", keywords: "work order wo travel employee worker kilometres", titleKeys: ["employee_name", "worker_name"], detailKeys: ["wo_number", "job_number", "kilometres", "hours"], dateKeys: ["travel_date", "created_at"] },
        { category: "Work Order Worker", records: workOrderLabourWorkers, tab: "workOrders", keywords: "work order wo labour employee worker", titleKeys: ["display_name", "worker_key"], detailKeys: ["email", "approved"], dateKeys: ["updated_at", "created_at"] },
        { category: "Equipment / Vehicle", records: equipmentItems, tab: "equipment", keywords: "equipment vehicle trailer plate unit", titleKeys: ["name", "unit_number", "license_plate"], detailKeys: ["category", "license_plate", "unit_number", "serial_number"], dateKeys: ["yearly_inspection_expiry", "updated_at", "created_at"] },
        { category: "Equipment Alert", records: equipmentNotifications, tab: "equipment", keywords: "equipment vehicle expiry notification alert", titleKeys: ["equipment_name", "name", "message"], detailKeys: ["notification_type", "expiry_date", "status"], dateKeys: ["expiry_date", "created_at"] },
        { category: "Equipment Maintenance", records: equipmentMaintenanceLogs, tab: "equipment", keywords: "equipment vehicle maintenance service repair", titleKeys: ["equipment_name", "title", "service_type"], detailKeys: ["scheduled_date", "completed_date", "description", "status"], dateKeys: ["scheduled_date", "completed_date", "created_at"] },
        { category: "Contact", records: contacts, tab: "contacts", keywords: "contact company phone email", titleKeys: ["name", "company_name"], detailKeys: ["company", "role", "phone", "email"], dateKeys: ["updated_at", "created_at"] },
        { category: "Subcontractor / Supplier", records: subcontractorSuppliers, tab: "subcontractorsSuppliers", keywords: "subcontractor supplier rental service company contact", titleKeys: ["company_name", "name"], detailKeys: ["category", "phone", "email", "address"], dateKeys: ["updated_at", "created_at"] },
        { category: "Supplier Contact", records: subcontractorSupplierContacts, tab: "subcontractorsSuppliers", keywords: "subcontractor supplier contact company phone email", titleKeys: ["contact_name", "name"], detailKeys: ["company_name", "role", "phone", "email"], dateKeys: ["updated_at", "created_at"] },
        { category: "Subcontractor Activity", records: subcontractorActivity, tab: "summary", keywords: "subcontractor activity portal company user", titleKeys: ["company_name", "subcontractor_name", "display_name"], detailKeys: ["activity_type", "page_name", "email"], dateKeys: ["created_at"] },
        { category: "Task", records: adminGlobalSearchTasks, tab: "tasks", keywords: "task assignment employee worker job follow up", titleKeys: ["title"], detailKeys: ["job_number", "job_name", "assigned_to_name", "status"], dateKeys: ["due_date", "completed_at", "created_at"] }
    ];

    collections.forEach((config) => addAdminGlobalSearchCollection(index, config));
    return index;
}

async function ensureAdminGlobalSearchData() {
    if (adminGlobalSearchReady) {
        return;
    }

    if (adminGlobalSearchLoadPromise) {
        return adminGlobalSearchLoadPromise;
    }

    adminGlobalSearchLoadPromise = (async function() {
        while (adminDataLoading) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const hasFullData = ADMIN_ALLOWED_TABS.every((tab) => adminTabDataLoaded.has(tab));

        if (!hasFullData) {
            await loadAllAdminData();
        }

        const taskResult = await supabaseClient
            .from("tasks")
            .select("*")
            .order("created_at", { ascending: false });

        if (taskResult.error) {
            logAdminLoadError("global search tasks", taskResult.error);
        }

        adminGlobalSearchTasks = taskResult.data || [];
        adminGlobalSearchReady = true;
    })().finally(() => {
        adminGlobalSearchLoadPromise = null;
    });

    return adminGlobalSearchLoadPromise;
}

function parseAdminGlobalSearchDate(query) {
    const monthNumbers = {
        january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
        april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
        august: 8, aug: 8, september: 9, sep: 9, sept: 9,
        october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12
    };
    const clean = String(query || "")
        .toLowerCase()
        .replace(/(\d+)(st|nd|rd|th)\b/g, "$1")
        .replace(/[,']/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    let year = new Date().getFullYear();
    let month = 0;
    let day = 0;
    let match = clean.match(/^(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:\s+(\d{4}))?$/);

    if (match) {
        month = monthNumbers[match[1]];
        day = Number(match[2]);
        year = match[3] ? Number(match[3]) : year;
    } else {
        match = clean.match(/^(\d{1,2})\s+(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)(?:\s+(\d{4}))?$/);

        if (match) {
            day = Number(match[1]);
            month = monthNumbers[match[2]];
            year = match[3] ? Number(match[3]) : year;
        } else {
            match = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);

            if (match) {
                year = Number(match[1]);
                month = Number(match[2]);
                day = Number(match[3]);
            } else {
                match = clean.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);

                if (match) {
                    month = Number(match[1]);
                    day = Number(match[2]);
                    year = match[3] ? Number(match[3]) : year;
                    year = year < 100 ? 2000 + year : year;
                }
            }
        }
    }

    if (!year || !month || !day) {
        return null;
    }

    const date = new Date(year, month - 1, day);

    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }

    return {
        date,
        dateKey: year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0"),
        label: date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    };
}

function getAdminGlobalSearchDateKey(value) {
    if (!value) {
        return "";
    }

    if (value instanceof Date) {
        return formatAdminScheduleDateValue(value);
    }

    const text = String(value).trim();
    const dateOnlyMatch = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|T|\s)/);

    if (dateOnlyMatch && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
        return dateOnlyMatch[1];
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? "" : formatAdminScheduleDateValue(parsed);
}

function adminRecordMatchesDate(record, fields, dateKey) {
    return (fields || []).some((field) => getAdminGlobalSearchDateKey(record && record[field]) === dateKey);
}

function getAdminTimesheetEntryDateKey(week, entry) {
    const weekStart = getTimesheetEntryValue(entry, "weekStartValue", "week_start", "") || getAdminTimesheetWeekStart(week || {});
    const dayName = getTimesheetEntryValue(entry, "day", "day_of_week", "");
    const dayIndex = getTimesheetDayNames().indexOf(dayName);

    if (!weekStart || dayIndex < 0) {
        return "";
    }

    const date = makeLocalDate(weekStart);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    date.setDate(date.getDate() + dayIndex);
    return formatAdminScheduleDateValue(date);
}

function makeAdminDateSearchResult(group, category, title, detail, tab, options) {
    const settings = options || {};

    return {
        group,
        category,
        title: title || category,
        detail: detail || "",
        tab,
        action: settings.action || "",
        recordId: settings.recordId || "",
        sortDate: settings.sortDate || ""
    };
}

function buildAdminDateSearchResults(dateSearch) {
    const dateKey = dateSearch.dateKey;
    const results = [];
    const timeEntries = [];
    const seenTimeEntries = new Set();

    function addTimeEntry(entry, week, workerName, recordId, isSubmitted) {
        const entryDateKey = isSubmitted
            ? getAdminTimesheetEntryDateKey(week, entry)
            : getAdminGlobalSearchDateKey(getLiveTimesheetEntryDate(entry));

        if (entryDateKey !== dateKey) {
            return;
        }

        const entryId = getTimesheetEntryValue(entry, "id", "id", "");
        const timeIn = String(getTimesheetEntryValue(entry, "timeIn", "time_in", "")).slice(0, 5);
        const timeOut = String(getTimesheetEntryValue(entry, "timeOut", "time_out", "")).slice(0, 5);
        const jobName = getTimesheetEntryValue(entry, "jobName", "job_name", "") || getAdminTimesheetEntryLabel(entry);
        const jobNumber = getTimesheetEntryValue(entry, "jobNumber", "job_number", "");
        const hours = Number(getTimesheetEntryValue(entry, "hours", "hours", 0)) || 0;
        const entryType = getAdminTimesheetEntryType(entry);
        const dedupeKey = entryId || [workerName, jobName, jobNumber, timeIn, timeOut, hours, entryType].join("|").toLowerCase();

        if (seenTimeEntries.has(dedupeKey)) {
            return;
        }

        seenTimeEntries.add(dedupeKey);
        timeEntries.push({
            entry,
            workerName: workerName || getTimesheetEntryValue(entry, "user", "worker_name", "Unknown worker"),
            jobName,
            jobNumber,
            hours,
            timeIn,
            timeOut,
            entryType,
            recordId: recordId || entry.id || "",
            isSubmitted
        });
    }

    timesheets.forEach((week) => {
        (Array.isArray(week.entries) ? week.entries : []).forEach((entry) => {
            addTimeEntry(entry, week, week.worker_name || "", week.id || "", true);
        });
    });

    liveTimesheetEntries.forEach((entry) => {
        addTimeEntry(entry, null, entry.worker_name || "", "", false);
    });

    const workEntries = timeEntries.filter((item) => item.entryType === "work");
    const leaveEntries = timeEntries.filter((item) => item.entryType !== "work");

    workEntries.forEach((item) => {
        const jobLabel = [item.jobNumber, item.jobName].filter(Boolean).join(" - ") || "Job not listed";
        const timeLabel = item.timeIn || item.timeOut ? [item.timeIn, item.timeOut].filter(Boolean).join(" - ") : "Time not listed";
        results.push(makeAdminDateSearchResult(
            "Hours Worked",
            "Timesheet",
            item.workerName,
            jobLabel + " | " + timeLabel + " | " + item.hours.toFixed(2) + " hours",
            "timesheets",
            item.isSubmitted ? { action: "submitted_timesheet", recordId: item.recordId } : { action: "live_timesheet", recordId: item.recordId }
        ));
    });

    leaveEntries.forEach((item) => {
        results.push(makeAdminDateSearchResult(
            "Leave Entries",
            getAdminTimesheetEntryLabel(item.entry),
            item.workerName,
            (item.jobName || getAdminTimesheetEntryLabel(item.entry)) + (item.hours ? " | " + item.hours.toFixed(2) + " hours" : ""),
            "timesheets",
            item.isSubmitted ? { action: "submitted_timesheet", recordId: item.recordId } : { action: "live_timesheet", recordId: item.recordId }
        ));
    });

    const jobsWorked = new Map();
    workEntries.forEach((item) => {
        const key = normalizeAdminGlobalSearchText(item.jobNumber + " " + item.jobName) || "unlisted-job";

        if (!jobsWorked.has(key)) {
            jobsWorked.set(key, {
                jobNumber: item.jobNumber,
                jobName: item.jobName || "Job not listed",
                hours: 0,
                workers: new Set()
            });
        }

        const job = jobsWorked.get(key);
        job.hours += item.hours;
        job.workers.add(item.workerName);
    });

    jobsWorked.forEach((job) => {
        const workerNames = Array.from(job.workers).sort();
        results.push(makeAdminDateSearchResult(
            "Jobs Worked",
            "Job",
            [job.jobNumber, job.jobName].filter(Boolean).join(" - "),
            job.hours.toFixed(2) + " total hours | " + workerNames.length + " worker" + (workerNames.length === 1 ? "" : "s") + ": " + workerNames.join(", "),
            "jobDashboard"
        ));
    });

    const matchingWorkOrderIds = new Set();
    workOrders.forEach((workOrder) => {
        if (adminRecordMatchesDate(workOrder, ["work_order_date"], dateKey)) {
            matchingWorkOrderIds.add(String(workOrder.id || ""));
        }
    });

    workOrders.filter((workOrder) => matchingWorkOrderIds.has(String(workOrder.id || ""))).forEach((workOrder) => {
        const woNumber = getAdminGlobalSearchValue(workOrder, ["wo_number", "work_order_number", "number"]);
        results.push(makeAdminDateSearchResult(
            "Work Orders",
            "Work Order",
            "WO " + (woNumber || "record"),
            joinAdminGlobalSearchDetails(workOrder, ["job_number", "job_name", "customer_name", "status"]),
            "workOrders",
            { action: "work_order", recordId: workOrder.id || "" }
        ));
    });

    const matchingPurchaseOrders = digitalPurchaseOrders.filter((purchaseOrder) => {
        return adminRecordMatchesDate(purchaseOrder, ["order_date"], dateKey);
    });

    matchingPurchaseOrders.forEach((purchaseOrder) => {
        results.push(makeAdminDateSearchResult(
            "Purchase Orders",
            "Purchase Order",
            formatAdminGlobalSearchPoNumber(getAdminGlobalSearchValue(purchaseOrder, ["po_number"])),
            joinAdminGlobalSearchDetails(purchaseOrder, ["supplier_name", "job_number", "job_name", "workflow_status"]),
            "summary",
            { action: "digital_purchase_order", recordId: purchaseOrder.id || "", sortDate: purchaseOrder.order_date || "" }
        ));
    });

    function addMatchingRecords(records, config) {
        records.filter((record) => adminRecordMatchesDate(record, config.dateFields, dateKey)).forEach((record) => {
            const title = typeof config.title === "function"
                ? config.title(record)
                : getAdminGlobalSearchValue(record, config.titleKeys);
            results.push(makeAdminDateSearchResult(
                config.group,
                config.category,
                title || config.category,
                joinAdminGlobalSearchDetails(record, config.detailKeys),
                config.tab,
                config.action ? { action: config.action, recordId: record.id || "", sortDate: getAdminGlobalSearchValue(record, config.dateFields) } : { sortDate: getAdminGlobalSearchValue(record, config.dateFields) }
            ));
        });
    }

    addMatchingRecords(inspections, { group: "Inspections", category: "Inspection", tab: "inspections", titleKeys: ["worker_name", "completed_by", "inspection_type"], detailKeys: ["inspection_type", "job_number", "job_name", "location"], dateFields: ["inspection_date", "created_at"] });
    addMatchingRecords(vehicleInspections, { group: "Inspections", category: "Vehicle Inspection", tab: "inspections", titleKeys: ["driver_name", "worker_name", "vehicle_license_plate"], detailKeys: ["vehicle_license_plate", "trailer_1_license_plate", "inspection_type", "location"], dateFields: ["inspection_date", "created_at"] });

    addMatchingRecords(timesheets, { group: "Reports & Submissions", category: "Timesheet Submitted", tab: "timesheets", action: "submitted_timesheet", titleKeys: ["worker_name"], detailKeys: ["week_label", "total_hours", "note"], dateFields: ["submitted_at"] });
    addMatchingRecords(dailySiteReports, { group: "Reports & Submissions", category: "Daily Site Report", tab: "reports", titleKeys: ["job_name", "project", "worker_name"], detailKeys: ["job_number", "report_date", "location", "completed_by"], dateFields: ["report_date", "created_at"] });
    addMatchingRecords(incidentReports, { group: "Reports & Submissions", category: "Incident Report", tab: "reports", titleKeys: ["incident_type", "worker_name", "reported_by"], detailKeys: ["job_number", "job_name", "location", "description"], dateFields: ["incident_date", "report_date", "created_at"] });
    addMatchingRecords(accidentReports, { group: "Reports & Submissions", category: "Accident Report", tab: "reports", titleKeys: ["injured_employee_name", "worker_name", "reported_by"], detailKeys: ["job_number", "job_name", "accident_location"], dateFields: ["accident_date", "created_at"] });
    addMatchingRecords(employeeInjuryReports, { group: "Reports & Submissions", category: "Employee Injury", tab: "reports", titleKeys: ["employee_name", "employee_display", "worker_name"], detailKeys: ["job_number", "accident_location", "accident_description"], dateFields: ["accident_date", "created_at"] });
    addMatchingRecords(toolboxReports, { group: "Reports & Submissions", category: "Toolbox Report", tab: "reports", titleKeys: ["title", "worker_name", "completed_by_name"], detailKeys: ["topic", "job_number", "location"], dateFields: ["report_date", "created_at"] });
    addMatchingRecords(safetyAcknowledgements, { group: "Reports & Submissions", category: "Safety Acknowledgement", tab: "reports", titleKeys: ["attendee_name", "worker_name", "record_title"], detailKeys: ["record_type", "record_title", "project", "location"], dateFields: ["acknowledged_at"] });

    addMatchingRecords(scheduleEvents, { group: "Schedule & Tasks", category: "Schedule", tab: "summary", titleKeys: ["title", "job_name", "event_type"], detailKeys: ["event_date", "job_number", "location", "notes"], dateFields: ["event_date"] });
    addMatchingRecords(adminGlobalSearchTasks, { group: "Schedule & Tasks", category: "Task", tab: "tasks", titleKeys: ["title"], detailKeys: ["job_number", "job_name", "assigned_to_name", "status"], dateFields: ["due_date", "completed_at"] });

    vacationRequests.filter((request) => {
        const start = getAdminGlobalSearchDateKey(request.start_date);
        const end = getAdminGlobalSearchDateKey(request.end_date || request.start_date);
        return start && start <= dateKey && end >= dateKey;
    }).forEach((request) => {
        results.push(makeAdminDateSearchResult(
            "Schedule & Tasks",
            "Vacation",
            getAdminGlobalSearchValue(request, ["worker_display_name", "worker_name"]) || "Vacation",
            joinAdminGlobalSearchDetails(request, ["start_date", "end_date", "request_type", "status"]),
            "vacation"
        ));
    });

    const totalHours = workEntries.reduce((sum, item) => sum + item.hours, 0);
    return {
        results,
        summary: dateSearch.label + ": " + workEntries.length + " work entr" + (workEntries.length === 1 ? "y" : "ies") + ", " + totalHours.toFixed(2) + " hours, " + jobsWorked.size + " job" + (jobsWorked.size === 1 ? "" : "s") + ", " + matchingWorkOrderIds.size + " work order" + (matchingWorkOrderIds.size === 1 ? "" : "s") + ", " + matchingPurchaseOrders.length + " purchase order" + (matchingPurchaseOrders.length === 1 ? "" : "s") + "."
    };
}

function getAdminGlobalSearchGroup(item) {
    const category = String(item.category || "").toLowerCase();

    if (category.includes("timesheet")) return "Time & Attendance";
    if (category.includes("purchase order")) return "Purchase Orders";
    if (category.includes("work order") || category === "job") return "Jobs & Work Orders";
    if (category.includes("inspection")) return "Inspections";
    if (/report|toolbox|accident|injury|acknowledgement/.test(category)) return "Reports & Submissions";
    if (/employee|certificate|vacation/.test(category)) return "People & Leave";
    if (/equipment|vehicle/.test(category)) return "Equipment & Vehicles";
    if (/schedule|task/.test(category)) return "Schedule & Tasks";
    if (/announcement|policy|contact|supplier|subcontractor/.test(category)) return "Notices & Contacts";
    return "Other";
}

function renderAdminGlobalSearchGroupedResults(items, statusText, preferredOrder) {
    const status = document.getElementById("adminGlobalSearchStatus");
    const container = document.getElementById("adminGlobalSearchResults");
    const groups = new Map();

    items.forEach((item) => {
        const groupName = item.group || getAdminGlobalSearchGroup(item);
        if (!groups.has(groupName)) groups.set(groupName, []);
        groups.get(groupName).push(item);
    });

    const orderedNames = (preferredOrder || []).filter((name) => groups.has(name));
    Array.from(groups.keys()).forEach((name) => {
        if (!orderedNames.includes(name)) orderedNames.push(name);
    });

    adminGlobalSearchResults = [];
    status.textContent = statusText || (items.length ? items.length + " result" + (items.length === 1 ? "" : "s") : "No records found.");

    container.innerHTML = orderedNames.map((groupName, groupIndex) => {
        const groupItems = groups.get(groupName);
        const resultsId = "adminGlobalSearchGroupResults" + groupIndex;
        const rows = groupItems.map((item) => {
            const resultIndex = adminGlobalSearchResults.push(item) - 1;
            return `
                <div class="admin-global-search-result">
                    <div>
                        <div class="admin-global-search-result-category">${escapeHtml(item.category)}</div>
                        <div class="admin-global-search-result-title">${escapeHtml(item.title)}</div>
                        ${item.detail ? '<div class="admin-global-search-result-detail">' + escapeHtml(item.detail) + '</div>' : ""}
                    </div>
                    <button type="button" onclick="openAdminGlobalSearchResult(${resultIndex})">Open</button>
                </div>
            `;
        }).join("");

        return `
            <section class="admin-global-search-group">
                <button type="button" class="admin-global-search-group-header" aria-expanded="false" aria-controls="${resultsId}" onclick="toggleAdminGlobalSearchGroup(this)">
                    <span class="admin-global-search-group-title">${escapeHtml(groupName)}</span>
                    <span class="admin-global-search-group-count">${groupItems.length}</span>
                    <span class="admin-global-search-group-chevron" aria-hidden="true">&#9656;</span>
                </button>
                <div id="${resultsId}" class="admin-global-search-group-results" hidden>${rows}</div>
            </section>
        `;
    }).join("");
}

function toggleAdminGlobalSearchGroup(button) {
    const container = document.getElementById("adminGlobalSearchResults");
    const group = button && button.closest(".admin-global-search-group");
    const groupResults = group && group.querySelector(".admin-global-search-group-results");
    if (!container || !group || !groupResults) return;
    const shouldOpen = button.getAttribute("aria-expanded") !== "true";

    container.querySelectorAll(".admin-global-search-group-header").forEach((otherButton) => {
        otherButton.setAttribute("aria-expanded", "false");
        const otherGroup = otherButton.closest(".admin-global-search-group");
        const otherResults = otherGroup && otherGroup.querySelector(".admin-global-search-group-results");
        if (otherResults) otherResults.hidden = true;
    });

    if (shouldOpen) {
        button.setAttribute("aria-expanded", "true");
        groupResults.hidden = false;
    }
}

function renderAdminGlobalSearchResults(query) {
    const status = document.getElementById("adminGlobalSearchStatus");
    const container = document.getElementById("adminGlobalSearchResults");
    const normalizedQuery = normalizeAdminGlobalSearchText(query);
    const terms = normalizedQuery.split(" ").filter(Boolean);

    if (!terms.length) {
        status.textContent = "";
        container.innerHTML = "";
        adminGlobalSearchResults = [];
        return;
    }

    const dateSearch = parseAdminGlobalSearchDate(query);

    if (dateSearch) {
        const dateResults = buildAdminDateSearchResults(dateSearch);
        renderAdminGlobalSearchGroupedResults(dateResults.results, dateResults.summary, [
            "Hours Worked",
            "Jobs Worked",
            "Leave Entries",
            "Work Orders",
            "Purchase Orders",
            "Inspections",
            "Reports & Submissions",
            "Schedule & Tasks"
        ]);
        return;
    }

    const matches = adminGlobalSearchIndex
        .filter((item) => terms.every((term) => item.searchText.includes(term)))
        .map((item) => {
            const normalizedTitle = normalizeAdminGlobalSearchText(item.title);
            const normalizedCategory = normalizeAdminGlobalSearchText(item.category);
            const score = normalizedTitle.includes(normalizedQuery) ? 0 : (normalizedCategory.includes(normalizedQuery) ? 1 : 2);
            return Object.assign({ score }, item);
        })
        .sort((a, b) => a.score - b.score || String(b.sortDate || "").localeCompare(String(a.sortDate || "")));
    const visibleMatches = matches.slice(0, 100);
    const statusText = matches.length
        ? matches.length + " relevant result" + (matches.length === 1 ? "" : "s") + (matches.length > 100 ? " - showing the first 100" : "")
        : "No records found.";

    renderAdminGlobalSearchGroupedResults(visibleMatches, statusText, [
        "Time & Attendance",
        "Jobs & Work Orders",
        "Purchase Orders",
        "Inspections",
        "Reports & Submissions",
        "People & Leave",
        "Equipment & Vehicles",
        "Schedule & Tasks",
        "Notices & Contacts",
        "Other"
    ]);
}

async function searchAdminEverything() {
    const input = document.getElementById("adminGlobalSearchInput");
    const status = document.getElementById("adminGlobalSearchStatus");
    const button = document.getElementById("adminGlobalSearchButton");
    const query = input.value.trim();

    if (normalizeAdminGlobalSearchText(query).length < 2) {
        renderAdminGlobalSearchResults("");
        status.textContent = query ? "Enter at least 2 characters." : "";
        return;
    }

    status.textContent = adminGlobalSearchReady ? "Searching..." : "Loading portal records for search...";
    button.disabled = true;

    try {
        await ensureAdminGlobalSearchData();
        adminGlobalSearchIndex = buildAdminGlobalSearchIndex();
        const currentQuery = input.value.trim();

        if (normalizeAdminGlobalSearchText(currentQuery).length >= 2) {
            renderAdminGlobalSearchResults(currentQuery);
        }
    } catch (error) {
        console.error("Admin global search could not load.", error);
        status.textContent = "Search could not load portal records. Please try again.";
    } finally {
        button.disabled = false;
    }
}

function scheduleAdminGlobalSearch() {
    clearTimeout(adminGlobalSearchTimer);
    const query = document.getElementById("adminGlobalSearchInput").value.trim();

    if (normalizeAdminGlobalSearchText(query).length < 2) {
        renderAdminGlobalSearchResults("");
        return;
    }

    adminGlobalSearchTimer = setTimeout(searchAdminEverything, 350);
}

function handleAdminGlobalSearchKeydown(event) {
    if (event.key !== "Enter") {
        return;
    }

    event.preventDefault();
    clearTimeout(adminGlobalSearchTimer);
    searchAdminEverything();
}

function openAdminGlobalSearchResult(index) {
    const result = adminGlobalSearchResults[index];

    if (!result) {
        return;
    }

    if (result.action === "digital_purchase_order" && result.recordId) {
        window.location.href = "purchase-orders-admin.html?po=" + encodeURIComponent(result.recordId);
        return;
    }

    showTab(result.tab);

    if (result.action === "submitted_timesheet" && result.recordId) {
        setTimeout(() => viewSubmittedTimesheetHours(result.recordId), 0);
    }

    if (result.action === "live_timesheet" && result.recordId) {
        setTimeout(() => editLiveTimesheetEntry(result.recordId), 0);
    }

    if (result.action === "work_order" && result.recordId) {
        const workOrder = workOrders.find((item) => String(item.id) === String(result.recordId));

        if (workOrder) {
            adminWorkOrderManagementView = isAdminWorkOrderSubmittedForManagement(workOrder) ? "submitted" : "active";
        }

        setTimeout(() => {
            renderAdminWorkOrders();
            openAdminWorkOrderEditor(result.recordId);
        }, 0);
    }
}

function isNewForAdminTab(item, tab, fields) {
    const lastViewed = getAdminLastViewed(tab);
    const fieldList = fields || ["created_at", "updated_at", "submitted_at", "approved_at"];

    return fieldList.some((field) => item && item[field] && String(item[field]) > lastViewed);
}

function countNewForAdminTab(items, tab, fields) {
    return (items || []).filter((item) => isNewForAdminTab(item, tab, fields)).length;
}

function countEquipmentExpiryAlerts() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextThirty = new Date(today);
    nextThirty.setDate(today.getDate() + 30);

    return equipmentItems.filter((item) => {
        if (!item.yearly_inspection_expiry) {
            return false;
        }

        const expiry = new Date(item.yearly_inspection_expiry + "T00:00:00");
        return expiry >= today && expiry <= nextThirty;
    }).length;
}

function countPendingAccounts() {
    return accounts.filter((account) => {
        const status = String(account.account_status || "").toLowerCase();
        return status === "pending" || status === "requested" || status === "new" || status === "awaiting_approval";
    }).length;
}

function getCurrentWeekStartForSummary() {
    const now = new Date();
    const sunday = new Date(now);
    sunday.setDate(now.getDate() - now.getDay());
    sunday.setHours(0, 0, 0, 0);
    return sunday.toISOString().slice(0, 10);
}

function renderSummaryTile(tile) {
    const hasBadge = Number(tile.badgeCount || 0) > 0;
    const badgeLabel = hasBadge ? escapeHtml(String(tile.badgeCount) + " new update" + (Number(tile.badgeCount) === 1 ? "" : "s")) : "";

    return `
        <button type="button" class="summary-tile${hasBadge ? " has-summary-badge" : " no-summary-badge"}" onclick="${tile.action}">
            ${hasBadge ? '<span class="summary-badge" title="' + badgeLabel + '" aria-label="' + badgeLabel + '"></span>' : ""}
            <h3>${escapeHtml(tile.title)}</h3>
        </button>
    `;
}

function formatAdminScheduleDateValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
}

function makeAdminScheduleDate(value) {
    const parts = String(value || "").split("-");
    return parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(value);
}

function formatAdminScheduleTime(value) {
    if (!value) {
        return "";
    }

    const parts = String(value).slice(0, 5).split(":");
    const hour = Number(parts[0]);
    const minute = parts[1] || "00";
    const suffix = hour >= 12 ? "PM" : "AM";
    return String(hour % 12 || 12) + ":" + minute + " " + suffix;
}

function addMinutesToAdminScheduleTime(value, minutes) {
    const parts = String(value || "07:00").slice(0, 5).split(":");
    const baseMinutes = (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0) + minutes;
    const normalized = ((baseMinutes % 1440) + 1440) % 1440;
    return String(Math.floor(normalized / 60)).padStart(2, "0") + ":" + String(normalized % 60).padStart(2, "0");
}

function getAdminScheduleTimeRange(startValue, endValue) {
    const start = String(startValue || "").slice(0, 5) || "07:00";
    const end = String(endValue || "").slice(0, 5) || addMinutesToAdminScheduleTime(start, 30);
    return { start, end };
}

function getAdminScheduleType(event) {
    const type = String(event && event.event_type || "work").toLowerCase();
    return ["work", "vehicle", "training", "general"].includes(type) ? type : "work";
}

function getAdminScheduleTypeLabel(type) {
    const labels = {
        work: "Work",
        vehicle: "Equipment / Vehicle Appointment",
        training: "Training",
        general: "General",
        vacation: "Vacation"
    };
    return labels[type] || "Schedule";
}

function getAdminScheduleTypeStyle(type) {
    const styles = {
        work: "background:#c9f1d2;color:#0d351a;",
        vehicle: "background:#cfd8ff;color:#151d53;",
        training: "background:#f0ccff;color:#3a0d4e;",
        general: "background:#e2e8ee;color:#1d2a32;",
        vacation: "background:#ffe7a7;color:#3f2c00;"
    };
    return styles[type] || styles.general;
}

function applyAdminScheduleEventColors() {
    const colors = {
        work: { background: "#c9f1d2", color: "#0d351a" },
        vehicle: { background: "#cfd8ff", color: "#151d53" },
        training: { background: "#f0ccff", color: "#3a0d4e" },
        general: { background: "#e2e8ee", color: "#1d2a32" },
        vacation: { background: "#ffe7a7", color: "#3f2c00" }
    };

    Object.entries(colors).forEach(([type, palette]) => {
        document.querySelectorAll("#adminScheduleCalendar .admin-event-" + type).forEach((item) => {
            item.style.setProperty("background", palette.background, "important");
            item.style.setProperty("background-color", palette.background, "important");
            item.style.setProperty("color", palette.color, "important");
        });
    });
}

function getAdminScheduleTitle(event) {
    return event.title || event.job_name || event.location || getAdminScheduleTypeLabel(getAdminScheduleType(event));
}

function getAdminScheduleDuplicateName(event) {
    return normalizeWorkerName(getAdminScheduleTitle(event));
}

function isDuplicateAdminScheduleEvent(record, ignoreId) {
    const duplicateName = getAdminScheduleDuplicateName(record);
    const start = String(record.start_time || "").slice(0, 5);
    const end = String(record.end_time || "").slice(0, 5);

    return scheduleEvents.some((event) =>
        String(event.id || "") !== String(ignoreId || "") &&
        String(event.event_date || "") === String(record.event_date || "") &&
        String(event.start_time || "").slice(0, 5) === start &&
        String(event.end_time || "").slice(0, 5) === end &&
        getAdminScheduleDuplicateName(event) === duplicateName
    );
}

function getAdminScheduleTaggedNames(event) {
    const names = Array.isArray(event.employee_names) ? event.employee_names : [];
    const emails = Array.isArray(event.employee_emails) ? event.employee_emails : [];
    const seen = new Set();

    return names
        .concat(emails)
        .map((value) => String(value || "").trim())
        .filter((value) => {
            const key = normalizeWorkerName(value);

            if (!key || seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
}

function getAdminJobMilestones() {
    const portalJobs = typeof jobs !== "undefined" && Array.isArray(jobs) ? jobs : [];

    return portalJobs
        .filter((job) => job && job.active !== false)
        .flatMap((job) => {
            const jobNumber = String(job.job_number || "").trim();
            const jobName = String(job.job_name || "").trim();
            const jobLabel = [jobNumber ? "Job " + jobNumber : "", jobName].filter(Boolean).join(" - ") || "Job";
            const common = {
                job,
                jobNumber,
                jobName,
                jobLabel
            };
            const milestones = [];
            const startDate = String(job.start_date || "").slice(0, 10);
            const targetEndDate = String(job.target_end_date || "").slice(0, 10);

            if (startDate) {
                milestones.push({
                    ...common,
                    id: "job-start-" + String(job.id || jobNumber || jobName),
                    source: "job-milestone",
                    type: "job-start",
                    kindLabel: "Job start",
                    date: startDate,
                    sortTime: "00:00",
                    allDay: true,
                    title: "Job start - " + jobLabel
                });
            }

            if (targetEndDate) {
                milestones.push({
                    ...common,
                    id: "job-target-" + String(job.id || jobNumber || jobName),
                    source: "job-milestone",
                    type: "job-target",
                    kindLabel: "Target completion",
                    date: targetEndDate,
                    sortTime: "00:01",
                    allDay: true,
                    title: "Target completion - " + jobLabel
                });
            }

            return milestones;
        })
        .sort((a, b) =>
            String(a.date || "").localeCompare(String(b.date || "")) ||
            String(a.sortTime || "").localeCompare(String(b.sortTime || "")) ||
            String(a.jobNumber || "").localeCompare(String(b.jobNumber || ""), undefined, { numeric: true })
        );
}

function getAdminJobMilestonesForDate(dateValue) {
    return getAdminJobMilestones().filter((milestone) => milestone.date === dateValue);
}

function getAdminJobMilestoneMeta(milestone) {
    const job = milestone.job || {};

    return [
        job.customer || "",
        job.address || "",
        job.project_manager ? "Project Manager: " + job.project_manager : ""
    ].filter(Boolean).join(" | ");
}

function formatAdminAgendaDayHeader(value) {
    const date = makeAdminScheduleDate(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const dateValue = formatAdminScheduleDateValue(date);
    const prefix = dateValue === formatAdminScheduleDateValue(today)
        ? "Today"
        : dateValue === formatAdminScheduleDateValue(tomorrow)
            ? "Tomorrow"
            : date.toLocaleDateString("en-CA", { weekday: "short" });

    return prefix + " - " + date.toLocaleDateString("en-CA", {
        month: "short",
        day: "numeric"
    });
}

function getAdminVacationAgendaRange(request) {
    const start = makeAdminScheduleDate(request.start_date);
    const end = makeAdminScheduleDate(request.end_date || request.start_date);
    const startText = start.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
    const endText = end.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
    return startText === endText ? startText : startText + " to " + endText;
}

function buildAdminScheduleAgendaItems() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayValue = formatAdminScheduleDateValue(today);
    const scheduleItems = (scheduleEvents || [])
        .filter((event) => String(event.event_date || "") >= todayValue)
        .map((event) => {
            const type = getAdminScheduleType(event);
            const taggedNames = getAdminScheduleTaggedNames(event);

            return {
                id: event.id || "",
                source: "schedule",
                type,
                date: event.event_date,
                sortTime: event.start_time || "99:99",
                title: getAdminScheduleTitle(event),
                meta: [
                    getAdminScheduleTypeLabel(type),
                    [formatAdminScheduleTime(event.start_time), event.end_time ? "to " + formatAdminScheduleTime(event.end_time) : ""].filter(Boolean).join(" "),
                    event.job_number ? "Job #: " + event.job_number : "",
                    event.location || "",
                    event.maintenance_reason ? "Reason: " + event.maintenance_reason : "",
                    taggedNames.length ? "Tagged: " + taggedNames.join(", ") : ""
                ].filter(Boolean).join(" | ")
            };
        });
    const vacationItems = (vacationRequests || [])
        .filter((request) =>
            String(request.status || "").toLowerCase() === "approved" &&
            String(request.end_date || request.start_date || "") >= todayValue
        )
        .map((request) => {
            const startValue = String(request.start_date || "");
            const endValue = String(request.end_date || request.start_date || "");

            return {
                id: request.id || "",
                source: "vacation",
                type: "vacation",
                date: startValue < todayValue && todayValue <= endValue ? todayValue : startValue,
                sortTime: "99:99",
                title: "Vacation - " + (request.worker_display_name || request.worker_name || "Employee"),
                meta: getAdminVacationAgendaRange(request)
            };
        });
    const jobMilestoneItems = getAdminJobMilestones()
        .filter((milestone) => String(milestone.date || "") >= todayValue)
        .map((milestone) => ({
            ...milestone,
            meta: getAdminJobMilestoneMeta(milestone)
        }));

    return scheduleItems
        .concat(vacationItems)
        .concat(jobMilestoneItems)
        .filter((item) => item.date)
        .sort((a, b) => {
            const dateDifference = String(a.date || "").localeCompare(String(b.date || ""));

            if (dateDifference !== 0) {
                return dateDifference;
            }

            return String(a.sortTime || "").localeCompare(String(b.sortTime || ""));
        })
        .slice(0, 7);
}

function renderAdminScheduleAgenda() {
    const list = document.getElementById("adminScheduleAgenda");

    if (!list) {
        return;
    }

    const items = buildAdminScheduleAgendaItems();

    if (!items.length) {
        list.innerHTML = `
            <div class="admin-agenda-toolbar">
                <strong>Upcoming Schedule</strong>
                <button type="button" onclick="openAdminScheduleModal('${formatAdminScheduleDateValue(new Date())}')">Add Event</button>
                <button type="button" onclick="syncAllAdminScheduleEvents()">Sync All</button>
                <button type="button" class="secondary" onclick="pullAdminScheduleGoogleUpdates()">Pull Google Updates</button>
            </div>
            <div class="small">No upcoming schedule items found.</div>
        `;
        return;
    }

    const groups = items.reduce((grouped, item) => {
        grouped[item.date] = grouped[item.date] || [];
        grouped[item.date].push(item);
        return grouped;
    }, {});

    list.innerHTML = `
        <div class="admin-agenda-toolbar">
            <strong>Upcoming Schedule</strong>
            <button type="button" onclick="openAdminScheduleModal('${formatAdminScheduleDateValue(new Date())}')">Add Event</button>
            <button type="button" onclick="syncAllAdminScheduleEvents()">Sync All</button>
            <button type="button" class="secondary" onclick="pullAdminScheduleGoogleUpdates()">Pull Google Updates</button>
        </div>
        ${Object.keys(groups).map((dateValue) => `
            <div class="admin-agenda-day-group">
                <div class="admin-agenda-day-header">${escapeHtml(formatAdminAgendaDayHeader(dateValue))}</div>
                ${groups[dateValue].map((item) => {
                    const timeText = item.allDay || item.sortTime === "99:99" ? "All day" : formatAdminScheduleTime(item.sortTime);
                    const content = `
                        <span class="admin-agenda-time">${escapeHtml(timeText)}</span>
                        <span>
                            <span class="admin-agenda-title">${escapeHtml(item.title)}</span>
                            <span class="admin-agenda-meta">${escapeHtml(item.meta)}</span>
                        </span>
                    `;

                    if (item.source === "schedule") {
                        return `
                            <button type="button" class="admin-agenda-item ${escapeHtml(item.type)}" onclick="openAdminScheduleModal('${escapeHtml(item.date)}'); editAdminScheduleEvent('${escapeHtml(item.id)}');">
                                ${content}
                            </button>
                        `;
                    }

                    const noteLabel = [item.title, item.meta].filter(Boolean).join(". ");
                    return `
                        <div class="admin-agenda-item ${escapeHtml(item.type)}" role="note" aria-label="${escapeHtml(noteLabel)}">
                            ${content}
                        </div>
                    `;
                }).join("")}
            </div>
        `).join("")}
    `;
}

function adminScheduleVacationTouchesDate(request, dateValue) {
    return String(request.start_date || "") <= dateValue && dateValue <= String(request.end_date || request.start_date || "");
}

function getAdminScheduleEventsForDate(dateValue) {
    return scheduleEvents.filter((event) => String(event.event_date || "") === dateValue);
}

function getAdminScheduleVacationsForDate(dateValue) {
    return vacationRequests.filter((request) =>
        String(request.status || "").toLowerCase() === "approved" &&
        adminScheduleVacationTouchesDate(request, dateValue)
    );
}

function changeAdminScheduleMonth(offset) {
    adminScheduleMonth = new Date(adminScheduleMonth.getFullYear(), adminScheduleMonth.getMonth() + offset, 1);
    renderAdminScheduleCalendar();
}

function renderAdminScheduleCalendar() {
    const calendar = document.getElementById("adminScheduleCalendar");
    const title = document.getElementById("adminScheduleTitle");

    if (!calendar || !title) {
        return;
    }

    const year = adminScheduleMonth.getFullYear();
    const month = adminScheduleMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const todayValue = formatAdminScheduleDateValue(new Date());
    let html = dayNames.map((day) => '<div class="admin-schedule-head">' + day + '</div>').join("");

    title.textContent = firstDay.toLocaleDateString("en-CA", { month: "long", year: "numeric" });

    for (let i = 0; i < firstDay.getDay(); i++) {
        html += '<div class="admin-schedule-day muted"></div>';
    }

    for (let day = 1; day <= lastDay.getDate(); day++) {
        const date = new Date(year, month, day);
        const dateValue = formatAdminScheduleDateValue(date);
        const todayClass = dateValue === todayValue ? " today" : "";
        const events = getAdminScheduleEventsForDate(dateValue);
        const vacations = getAdminScheduleVacationsForDate(dateValue);
        const jobMilestones = getAdminJobMilestonesForDate(dateValue);
        const milestoneItems = jobMilestones.map((milestone) => {
            const compactJobLabel = [milestone.jobNumber, milestone.jobName].filter(Boolean).join(" - ") || "Job";
            const accessibleLabel = milestone.kindLabel + ": " + milestone.jobLabel + ". Automatic from Job Details and cannot be edited here.";
            return '<div class="admin-schedule-item admin-job-milestone admin-' + escapeHtml(milestone.type) + '" role="note" aria-label="' + escapeHtml(accessibleLabel) + '" title="' + escapeHtml(accessibleLabel) + '">' +
                '<span class="admin-job-milestone-kind">' + escapeHtml(milestone.type === "job-start" ? "Start" : "Target") + '</span>' +
                '<span class="admin-job-milestone-title">' + escapeHtml(compactJobLabel) + '</span></div>';
        });
        const eventItems = events.slice(0, 4).map((event) => {
            const type = getAdminScheduleType(event);
            const syncClass = getJgcScheduleSyncClass(event) === "synced" ? "synced" : "unsynced";
            const syncLabel = getJgcScheduleSyncLabel(event);
            const timeText = event.start_time ? formatAdminScheduleTime(event.start_time) : "";
            const label = '<span class="schedule-sync-dot ' + syncClass + '" title="' + escapeHtml(syncLabel) + '"></span>' +
                (timeText ? '<span class="schedule-event-time">' + escapeHtml(timeText) + '</span>' : "") +
                '<span class="schedule-event-title">' + escapeHtml(getAdminScheduleTitle(event)) + '</span>';
            return '<button type="button" class="admin-schedule-item admin-schedule-event-button admin-event-' + escapeHtml(type) + '" style="' + getAdminScheduleTypeStyle(type) + '" onclick="event.stopPropagation(); openAdminScheduleModal(\'' + escapeHtml(dateValue) + '\'); editAdminScheduleEvent(\'' + escapeHtml(event.id) + '\');">' + label + '</button>';
        });
        const vacationItems = vacations.slice(0, 2).map((request) =>
            '<div class="admin-schedule-item admin-event-vacation" style="' + getAdminScheduleTypeStyle("vacation") + '">' +
            '<span class="schedule-sync-dot ' + (getJgcScheduleSyncClass(request) === "synced" ? "synced" : "unsynced") + '" title="' + escapeHtml(getJgcScheduleSyncLabel(request)) + '"></span>' +
            escapeHtml(request.worker_display_name || request.worker_name || "Vacation") + '</div>'
        );
        const visibleItems = milestoneItems.concat(eventItems, vacationItems).slice(0, 6);
        const totalCount = jobMilestones.length + events.length + vacations.length;
        const more = totalCount > 6 ? '<div class="small">+' + (totalCount - 6) + ' more</div>' : "";
        const dayLabel = date.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) +
            ". " + events.length + " schedule item" + (events.length === 1 ? "" : "s") +
            ", " + vacations.length + " vacation" + (vacations.length === 1 ? "" : "s") +
            ", and " + jobMilestones.length + " job milestone" + (jobMilestones.length === 1 ? "" : "s") + ". Open day details.";

        html += `
            <div role="button" tabindex="0" aria-label="${escapeHtml(dayLabel)}" class="admin-schedule-day${todayClass}" onclick="openAdminScheduleModal('${dateValue}')" onkeydown="if(event.key === 'Enter' || event.key === ' '){ event.preventDefault(); openAdminScheduleModal('${dateValue}'); }">
                <div class="admin-schedule-day-number">${day}</div>
                <div class="admin-schedule-day-list">${visibleItems.join("")}${more}</div>
            </div>
        `;
    }

    calendar.innerHTML = html;
    applyAdminScheduleEventColors();
    renderAdminScheduleAgenda();
}

function renderAdminScheduleDayEvents(dateValue) {
    const list = document.getElementById("adminScheduleDayEvents");

    if (!list) {
        return;
    }

    const events = getAdminScheduleEventsForDate(dateValue);
    const vacations = getAdminScheduleVacationsForDate(dateValue);
    const jobMilestones = getAdminJobMilestonesForDate(dateValue);

    if (!events.length && !vacations.length && !jobMilestones.length) {
        list.innerHTML = '<div class="small">No existing events for this day.</div>';
        return;
    }

    const milestoneHtml = jobMilestones.map((milestone) => {
        const job = milestone.job || {};
        const details = [
            milestone.jobNumber ? "Job #: " + milestone.jobNumber : "",
            job.customer ? "Customer: " + job.customer : "",
            job.address ? "Address: " + job.address : "",
            job.project_manager ? "Project Manager: " + job.project_manager : ""
        ].filter(Boolean);

        return `
            <div class="detail-item admin-job-milestone-detail ${escapeHtml(milestone.type)}" role="note" aria-label="${escapeHtml(milestone.kindLabel + ": " + milestone.jobLabel)}">
                <div class="detail-title">
                    <span class="chip ${escapeHtml(milestone.type)}-chip">${escapeHtml(milestone.kindLabel)}</span>
                    ${escapeHtml(milestone.jobLabel)}
                </div>
                <div class="detail-meta">
                    ${details.map((detail) => escapeHtml(detail)).join("<br>")}
                    ${details.length ? "<br>" : ""}Automatic from Job Details. Edit the job dates to change this milestone.
                </div>
            </div>
        `;
    }).join("");

    const eventHtml = events.map((event) => `
        <div class="detail-item">
            <div class="detail-title">
                <span class="chip ${escapeHtml(getAdminScheduleType(event))}-chip">${escapeHtml(getAdminScheduleTypeLabel(getAdminScheduleType(event)))}</span>
                ${escapeHtml(getAdminScheduleTitle(event))}
            </div>
            <div class="detail-meta">
                ${escapeHtml([formatAdminScheduleTime(event.start_time), event.end_time ? "to " + formatAdminScheduleTime(event.end_time) : ""].filter(Boolean).join(" "))}<br>
                ${event.job_number ? "Job #: " + escapeHtml(event.job_number) + "<br>" : ""}
                ${event.location ? "Location: " + escapeHtml(event.location) + "<br>" : ""}
                ${event.maintenance_reason ? "Reason: " + escapeHtml(event.maintenance_reason) + "<br>" : ""}
                ${event.employee_names && event.employee_names.length ? "Tagged: " + escapeHtml(event.employee_names.join(", ")) + "<br>" : ""}
                ${event.notes ? "Notes: " + escapeHtml(event.notes) + "<br>" : ""}
            </div>
            ${renderAdminScheduleGoogleSyncStatus(event)}
            <div class="actions" style="margin-top:8px;">
                <button type="button" onclick="editAdminScheduleEvent('${escapeHtml(event.id)}')">Edit This Event</button>
                <button type="button" class="delete-button" onclick="deleteAdminScheduleEvent('${escapeHtml(event.id)}')">Delete</button>
            </div>
        </div>
    `).join("");

    const vacationHtml = vacations.map((request) => `
        <div class="detail-item">
            <div class="detail-title">Vacation - ${escapeHtml(request.worker_display_name || request.worker_name || "")}</div>
            <div class="detail-meta">${escapeHtml(makeAdminScheduleDate(request.start_date).toLocaleDateString("en-CA", { month: "long", day: "numeric" }))} to ${escapeHtml(makeAdminScheduleDate(request.end_date || request.start_date).toLocaleDateString("en-CA", { month: "long", day: "numeric" }))}</div>
            ${renderAdminVacationGoogleSyncStatus(request)}
        </div>
    `).join("");

    list.innerHTML = milestoneHtml + eventHtml + vacationHtml;
}

function renderAdminScheduleGoogleSyncStatus(event) {
    const statusClass = getJgcScheduleSyncClass(event);
    const label = getJgcScheduleSyncLabel(event);
    const icon = statusClass === "synced" ? "OK" : (statusClass === "failed" ? "!" : "-");
    const retry = statusClass !== "synced"
        ? '<button type="button" class="schedule-sync-retry" onclick="retryAdminScheduleGoogleSync(\'' + escapeHtml(event.id) + '\')">Retry Sync</button>'
        : "";

    return '<div><span class="schedule-sync-status ' + escapeHtml(statusClass) + '">' + icon + ' ' + escapeHtml(label) + '</span>' + retry + '</div>';
}

function renderAdminVacationGoogleSyncStatus(request) {
    const statusClass = getJgcScheduleSyncClass(request);
    const label = getJgcScheduleSyncLabel(request);
    const icon = statusClass === "synced" ? "OK" : (statusClass === "failed" ? "!" : "-");
    const retry = statusClass !== "synced"
        ? '<button type="button" class="schedule-sync-retry" onclick="retryAdminVacationGoogleSync(\'' + escapeHtml(request.id) + '\')">Retry Sync</button>'
        : "";

    return '<div><span class="schedule-sync-status ' + escapeHtml(statusClass) + '">' + icon + ' ' + escapeHtml(label) + '</span>' + retry + '</div>';
}

function getAdminScheduleSyncableEvents() {
    return (scheduleEvents || []).filter((event) =>
        event &&
        event.id &&
        String(event.google_sync_status || "not_synced").toLowerCase() !== "synced"
    );
}

function getAdminScheduleSyncableVacations() {
    return (vacationRequests || []).filter((request) =>
        request &&
        request.id &&
        String(request.status || "").toLowerCase() === "approved" &&
        String(request.google_sync_status || "not_synced").toLowerCase() !== "synced"
    );
}

function getAdminScheduleEventEquipmentName(event) {
    const item = (equipmentItems || []).find((equipment) =>
        (event.equipment_id && equipment.id === event.equipment_id) ||
        (event.location && normalizeWorkerName(equipment.identification_number) === normalizeWorkerName(event.location)) ||
        (event.title && normalizeWorkerName(getAdminScheduleEquipmentLabel(equipment)) === normalizeWorkerName(event.title || event.job_name))
    );

    return item ? getAdminScheduleEquipmentLabel(item) : "";
}

function buildAdminVacationGoogleEvent(request) {
    const account = getAccountForVacationRequest(request) || {};
    const workerName = request.worker_display_name || request.worker_name || "Employee";
    const requestType = request.request_type ? " - " + request.request_type : "";
    const description = [
        "Type: Approved Vacation" + requestType,
        "Employee: " + workerName,
        request.total_days ? "Total Days: " + request.total_days : "",
        request.reason ? "Reason / Notes: " + request.reason : "",
        request.admin_note ? "Admin Note: " + request.admin_note : "",
        "",
        "Created from JGC Portal.",
        "Portal Vacation Request ID: " + request.id
    ].filter(Boolean).join("\n");

    return {
        ...request,
        google_sync_table: "vacation_requests",
        all_day: true,
        event_type: "vacation",
        event_date: request.start_date,
        end_date: request.end_date || request.start_date,
        start_time: "07:00",
        end_time: "07:30",
        title: "Vacation - " + workerName,
        job_name: "Vacation",
        job_number: "",
        location: "",
        notes: request.reason || "",
        description,
        employee_names: [workerName],
        employee_emails: [request.worker_email || account.email].filter(Boolean)
    };
}

async function retryAdminScheduleGoogleSync(id) {
    const event = scheduleEvents.find((item) => String(item.id) === String(id));
    const status = document.getElementById("adminScheduleStatus");

    if (!event) {
        alert("That schedule event could not be found. Refresh the admin page and try again.");
        return;
    }

    if (status) {
        status.textContent = "Retrying Google Calendar sync...";
    }

    const result = await syncJgcScheduleEventToGoogle(supabaseClient, {
        ...event,
        equipment_name: getAdminScheduleEventEquipmentName(event)
    }, "upsert");
    await loadAllAdminData();
    openAdminScheduleModal(event.event_date || formatAdminScheduleDateValue(new Date()));

    const nextStatus = document.getElementById("adminScheduleStatus");
    if (nextStatus) {
        nextStatus.textContent = result.ok ? "Google Calendar sync queued." : "Event saved, but Google Calendar sync failed.";
    }
}

async function retryAdminVacationGoogleSync(id) {
    const request = vacationRequests.find((item) => String(item.id) === String(id));
    const status = document.getElementById("adminScheduleStatus");

    if (!request) {
        alert("That vacation request could not be found. Refresh the admin page and try again.");
        return;
    }

    if (status) {
        status.textContent = "Retrying vacation Google Calendar sync...";
    }

    const result = await syncJgcScheduleEventToGoogle(supabaseClient, buildAdminVacationGoogleEvent(request), "upsert");
    await loadAllAdminData();
    openAdminScheduleModal(request.start_date || formatAdminScheduleDateValue(new Date()));

    const nextStatus = document.getElementById("adminScheduleStatus");
    if (nextStatus) {
        nextStatus.textContent = result.ok ? "Vacation Google Calendar sync queued." : "Vacation saved, but Google Calendar sync failed.";
    }
}

async function syncAllAdminScheduleEvents() {
    const eventsToSync = getAdminScheduleSyncableEvents();
    const vacationsToSync = getAdminScheduleSyncableVacations();
    const button = document.getElementById("adminScheduleSyncAllButton");
    const totalToSync = eventsToSync.length + vacationsToSync.length;

    if (!totalToSync) {
        alert("All schedule events and approved vacations are already synced.");
        return;
    }

    if (!confirm("Sync " + totalToSync + " calendar item" + (totalToSync === 1 ? "" : "s") + " to Google Calendar?")) {
        return;
    }

    if (button) {
        button.disabled = true;
        button.textContent = "Syncing...";
    }

    for (const event of eventsToSync) {
        await syncJgcScheduleEventToGoogle(supabaseClient, {
            ...event,
            equipment_name: getAdminScheduleEventEquipmentName(event)
        }, "upsert");
    }

    for (const request of vacationsToSync) {
        await syncJgcScheduleEventToGoogle(supabaseClient, buildAdminVacationGoogleEvent(request), "upsert");
    }

    await new Promise((resolve) => setTimeout(resolve, 2500));
    await loadAllAdminData();
    renderAdminScheduleCalendar();
    renderPortalSummary();

    if (button) {
        button.disabled = false;
        button.textContent = "Sync All";
    }

    alert("Google Calendar sync queued for " + totalToSync + " calendar item" + (totalToSync === 1 ? "" : "s") + ". Refresh in a few seconds if any still show as Not Synced.");
}

async function pullAdminScheduleGoogleUpdates() {
    const button = document.getElementById("adminSchedulePullGoogleButton");
    const status = document.getElementById("adminScheduleStatus");

    if (!confirm("Pull date, time, title, location, and notes updates from Google Calendar for linked portal schedule events?")) {
        return;
    }

    if (button) {
        button.disabled = true;
        button.textContent = "Pulling...";
    }

    if (status) {
        status.textContent = "Pulling Google Calendar updates...";
    }

    const result = await pullJgcGoogleCalendarUpdates();

    if (!result.ok) {
        if (button) {
            button.disabled = false;
            button.textContent = "Pull Google Updates";
        }
        if (status) {
            status.textContent = "Google Calendar updates could not be pulled.";
        }
        alert("Google Calendar updates could not be pulled: " + (result.error || ""));
        return;
    }

    await new Promise((resolve) => setTimeout(resolve, 3500));
    await loadAllAdminData();
    renderAdminScheduleCalendar();
    renderPortalSummary();

    if (button) {
        button.disabled = false;
        button.textContent = "Pull Google Updates";
    }

    if (status) {
        status.textContent = "Google Calendar updates pulled.";
    }

    alert("Google Calendar updates were pulled. The portal schedule has been refreshed.");
}

function getAdminScheduleApprovedAccounts() {
    const scheduleWorkers = window.JGCEmployeeFeatureAccess
        ? window.JGCEmployeeFeatureAccess.filterWorkers(
            workOrderLabourWorkers,
            employeeFeatureAccessRows,
            "schedule"
        )
        : (workOrderLabourWorkers || []).filter((workerRow) => workerRow.approved);

    return scheduleWorkers
        .map((workerRow) => {
            const workerAliases = [
                workerRow.worker_key,
                workerRow.display_name
            ].map(normalizeWorkerName).filter(Boolean);
            const profile = accounts.find((account) =>
                (workerRow.profile_id && account.id === workerRow.profile_id) ||
                workerAliases.includes(normalizeWorkerName(account.worker_key)) ||
                workerAliases.includes(normalizeWorkerName(account.display_name)) ||
                workerAliases.includes(normalizeWorkerName(account.email))
            ) || {};

            return {
                id: workerRow.id,
                profile_id: workerRow.profile_id || profile.id || "",
                display_name: workerRow.display_name || profile.display_name || profile.worker_key || profile.email || "Employee",
                worker_key: workerRow.worker_key || profile.worker_key || normalizeWorkerName(workerRow.display_name),
                email: profile.email || "",
                role: profile.role || "worker",
                account_status: "approved"
            };
        });
}

function renderAdminScheduleEmployees() {
    const list = document.getElementById("adminScheduleEmployees");

    if (!list) {
        return;
    }

    const approved = getAdminScheduleApprovedAccounts();

    if (!approved.length) {
        list.innerHTML = '<div class="small">No approved employees found.</div>';
        return;
    }

    list.innerHTML = approved.map((account) => {
        const label = account.display_name || account.worker_key || account.email || "Employee";
        return `
            <label>
                <input type="checkbox" value="${escapeHtml(account.id)}" data-admin-schedule-employee>
                <span>${escapeHtml(label)}</span>
            </label>
        `;
    }).join("");
}

function renderAdminScheduleJobs() {
    const select = document.getElementById("adminScheduleJob");

    if (!select) {
        return;
    }

    const activeJobs = jobs
        .filter((job) => job.active !== false)
        .sort((a, b) => String(a.job_number || "").localeCompare(String(b.job_number || ""), undefined, { numeric: true }));

    select.innerHTML = '<option value="">Manual / no job selected</option>' + activeJobs.map((job) => {
        const number = String(job.job_number || "").trim();
        const name = String(job.job_name || "").trim();
        return '<option value="' + escapeHtml(job.id) + '">' + escapeHtml((number ? number + " - " : "") + name) + '</option>';
    }).join("");
}

function fillAdminScheduleJob() {
    const selectedId = document.getElementById("adminScheduleJob").value;
    const job = jobs.find((item) => item.id === selectedId);

    if (!job) {
        return;
    }

    document.getElementById("adminScheduleJobName").value = job.job_name || "";
    document.getElementById("adminScheduleJobNumber").value = job.job_number || "";
    document.getElementById("adminScheduleLocation").value = job.address || "";
}

function getAdminScheduleEquipmentCategory(item) {
    const text = [
        item.equipment_type,
        item.name,
        item.identification_number,
        item.notes
    ].join(" ").toLowerCase();

    if (/\b(trailer|trl|float)\b/.test(text)) {
        return "trailer";
    }

    if (/\b(truck|van|vehicle|pickup|car|f-?150|f-?250|f-?350|ram|silverado|sierra|plate)\b/.test(text)) {
        return "vehicle";
    }

    return "equipment";
}

function getAdminScheduleVehicleChoices() {
    return (equipmentItems || [])
        .slice()
        .sort((a, b) => {
            const categorySort = getAdminScheduleEquipmentCategory(a).localeCompare(getAdminScheduleEquipmentCategory(b));
            return categorySort || String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true });
        });
}

function getAdminScheduleEquipmentLabel(item) {
    if (!item) {
        return "";
    }

    const name = String(item.name || "Equipment").trim();
    const identification = String(item.identification_number || "").trim();
    const type = String(item.equipment_type || "").trim();
    const operator = String(item.operator_name || "").trim();
    return [
        name,
        identification ? "#" + identification : "",
        type ? "(" + type + ")" : "",
        operator ? "- " + operator : ""
    ].filter(Boolean).join(" ");
}

function renderAdminScheduleVehicleOptions() {
    const select = document.getElementById("adminScheduleVehicle");

    if (!select) {
        return;
    }

    const choices = getAdminScheduleVehicleChoices();
    select.innerHTML = '<option value="">Select vehicle, lift, trailer, or equipment</option>' + choices.map((item) =>
        '<option value="' + escapeHtml(item.id) + '">' + escapeHtml(getAdminScheduleEquipmentLabel(item)) + '</option>'
    ).join("");
}

async function ensureAdminScheduleReferenceData() {
    if (adminScheduleReferenceDataLoaded) {
        return;
    }

    if (adminScheduleReferenceDataPromise) {
        return adminScheduleReferenceDataPromise;
    }

    adminScheduleReferenceDataPromise = (async function() {
        const [jobResult, equipmentResult] = await runAdminQueries([
            { label: "schedule jobs", query: () => supabaseClient.from("jobs").select("*").order("job_number", { ascending: true }) },
            { label: "schedule equipment", query: () => supabaseClient.from("equipment_vehicles").select("*").eq("is_active", true).order("name", { ascending: true }) }
        ]);

        jobs = jobResult.data || [];
        equipmentItems = equipmentResult.data || [];
        adminScheduleReferenceDataLoaded = !jobResult.error && !equipmentResult.error;
    })().finally(() => {
        adminScheduleReferenceDataPromise = null;
    });

    return adminScheduleReferenceDataPromise;
}

function findAdminScheduleAccountByName(value) {
    const target = normalizeWorkerName(value);

    if (!target) {
        return null;
    }

    return getAdminScheduleApprovedAccounts().find((account) => [
        account.display_name,
        account.worker_key,
        account.email
    ].map(normalizeWorkerName).filter(Boolean).includes(target)) || null;
}

function checkAdminScheduleEmployeeAccount(account) {
    if (!account) {
        return false;
    }

    const box = Array.from(document.querySelectorAll("[data-admin-schedule-employee]"))
        .find((input) => input.value === account.id);

    if (!box) {
        return false;
    }

    box.checked = true;
    return true;
}

function getSelectedAdminScheduleVehicle() {
    const selectedId = document.getElementById("adminScheduleVehicle").value;
    return equipmentItems.find((item) => item.id === selectedId) || null;
}

function fillAdminScheduleVehicle() {
    const item = getSelectedAdminScheduleVehicle();
    const hint = document.getElementById("adminScheduleVehicleHint");

    if (!item) {
        if (hint) {
            hint.textContent = "";
        }
        return;
    }

    const label = getAdminScheduleEquipmentLabel(item);
    const operatorName = item.operator_name || "";
    document.getElementById("adminScheduleItemTitle").value = label;
    document.getElementById("adminScheduleLocation").value = item.identification_number || item.name || "";

    if (!operatorName) {
        if (hint) {
            hint.textContent = "No assigned operator is saved for this item.";
        }
        return;
    }

    const account = findAdminScheduleAccountByName(operatorName);
    const checked = checkAdminScheduleEmployeeAccount(account);

    if (hint) {
        hint.textContent = checked
            ? "Assigned operator tagged: " + (account.display_name || account.worker_key || account.email)
            : "Assigned operator saved as \"" + operatorName + "\", but no matching approved account was found.";
    }
}

function updateAdminScheduleTypeFields() {
    const type = document.getElementById("adminScheduleType").value || "work";
    const isWork = type === "work";
    const isVehicle = type === "vehicle";

    document.getElementById("adminScheduleJobWrap").classList.toggle("field-hidden", !isWork);
    document.getElementById("adminScheduleJobNameWrap").classList.toggle("field-hidden", !isWork);
    document.getElementById("adminScheduleJobNumberWrap").classList.toggle("field-hidden", !isWork);
    document.getElementById("adminScheduleVehicleWrap").classList.toggle("field-hidden", !isVehicle);
    document.getElementById("adminScheduleTitleLabel").textContent = isWork ? "Title / Attention" : "Title";
    document.getElementById("adminScheduleItemTitle").placeholder = type === "vehicle"
        ? "Example: Truck service, oil change, tire appointment"
        : type === "training"
            ? "Example: Working at Heights training"
            : type === "general"
                ? "Example: Shop day, meeting, appointment"
                : "Optional title or attention";
}

function clearAdminScheduleForm(dateValue) {
    editingAdminScheduleEventId = "";
    document.getElementById("adminScheduleType").value = "work";
    document.getElementById("adminScheduleDate").value = dateValue || formatAdminScheduleDateValue(new Date());
    document.getElementById("adminScheduleStartTime").value = "";
    document.getElementById("adminScheduleEndTime").value = "";
    document.getElementById("adminScheduleJob").value = "";
    document.getElementById("adminScheduleJobName").value = "";
    document.getElementById("adminScheduleJobNumber").value = "";
    document.getElementById("adminScheduleVehicle").value = "";
    document.getElementById("adminScheduleMaintenanceReason").value = "";
    document.getElementById("adminScheduleVehicleHint").textContent = "";
    document.getElementById("adminScheduleItemTitle").value = "";
    document.getElementById("adminScheduleLocation").value = "";
    document.getElementById("adminScheduleNotes").value = "";
    document.getElementById("adminScheduleStatus").textContent = "";
    document.querySelectorAll("[data-admin-schedule-employee]").forEach((box) => {
        box.checked = false;
    });
    updateAdminScheduleTypeFields();
    const saveButton = document.getElementById("adminScheduleSaveButton");
    if (saveButton) {
        saveButton.textContent = "Save Schedule";
    }
}

function openAdminScheduleModal(dateValue) {
    renderAdminScheduleJobs();
    renderAdminScheduleEmployees();
    renderAdminScheduleVehicleOptions();
    clearAdminScheduleForm(dateValue);
    document.getElementById("adminScheduleModalTitle").textContent = "Add Schedule - " + makeAdminScheduleDate(dateValue).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
    renderAdminScheduleDayEvents(dateValue);
    document.getElementById("adminScheduleModal").classList.add("open");

    if (!adminScheduleReferenceDataLoaded) {
        const status = document.getElementById("adminScheduleStatus");
        status.textContent = "Loading job and equipment choices...";
        ensureAdminScheduleReferenceData().then(() => {
            renderAdminScheduleJobs();
            renderAdminScheduleVehicleOptions();

            const editingEvent = scheduleEvents.find((item) => String(item.id) === String(editingAdminScheduleEventId));
            if (editingEvent) {
                selectAdminScheduleJobForEvent(editingEvent);
                selectAdminScheduleVehicleForEvent(editingEvent);
            }

            if (status.textContent === "Loading job and equipment choices...") {
                status.textContent = "";
            }
        }).catch((error) => {
            logAdminLoadError("schedule reference data", error);
            status.textContent = "Job and equipment choices could not be loaded. Manual entry is still available.";
        });
    }
}

function closeAdminScheduleModal(event) {
    if (event && event.target && event.target.id !== "adminScheduleModal") {
        return;
    }

    document.getElementById("adminScheduleModal").classList.remove("open");
}

function getSelectedAdminScheduleAccounts() {
    const approved = getAdminScheduleApprovedAccounts();
    return Array.from(document.querySelectorAll("[data-admin-schedule-employee]:checked"))
        .map((box) => approved.find((account) => account.id === box.value || account.profile_id === box.value))
        .filter(Boolean);
}

function getAdminScheduleEventAliases(event) {
    const keys = Array.isArray(event.employee_keys) ? event.employee_keys : [];
    const names = Array.isArray(event.employee_names) ? event.employee_names : [];
    const emails = Array.isArray(event.employee_emails) ? event.employee_emails : [];
    return keys.concat(names).concat(emails).map(normalizeWorkerName).filter(Boolean);
}

function setAdminScheduleEmployeeChecksForEvent(event) {
    const aliases = getAdminScheduleEventAliases(event);
    const approved = getAdminScheduleApprovedAccounts();

    document.querySelectorAll("[data-admin-schedule-employee]").forEach((box) => {
        const account = approved.find((item) => item.id === box.value || item.profile_id === box.value);
        const accountAliases = account ? [
            account.id,
            account.profile_id,
            account.worker_key,
            account.display_name,
            account.email
        ].map(normalizeWorkerName).filter(Boolean) : [];
        box.checked = accountAliases.some((alias) => aliases.includes(alias));
    });
}

function selectAdminScheduleJobForEvent(event) {
    const select = document.getElementById("adminScheduleJob");
    const job = jobs.find((item) =>
        (event.job_id && item.id === event.job_id) ||
        (event.job_number && String(item.job_number || "").trim() === String(event.job_number || "").trim()) ||
        (event.job_name && normalizeWorkerName(item.job_name) === normalizeWorkerName(event.job_name))
    );
    select.value = job ? job.id : "";
}

function selectAdminScheduleVehicleForEvent(event) {
    const select = document.getElementById("adminScheduleVehicle");
    const title = normalizeWorkerName(event.title || event.job_name);
    const location = normalizeWorkerName(event.location);
    const item = equipmentItems.find((equipment) =>
        (event.equipment_id && equipment.id === event.equipment_id) ||
        (title && normalizeWorkerName(getAdminScheduleEquipmentLabel(equipment)) === title) ||
        (title && normalizeWorkerName(equipment.name) === title) ||
        (location && normalizeWorkerName(equipment.identification_number) === location)
    );
    select.value = item ? item.id : "";
}

function editAdminScheduleEvent(id) {
    const event = scheduleEvents.find((item) => String(item.id) === String(id));

    if (!event) {
        alert("That schedule event could not be found. Refresh the admin page and try again.");
        return;
    }

    editingAdminScheduleEventId = event.id;
    document.getElementById("adminScheduleType").value = getAdminScheduleType(event);
    updateAdminScheduleTypeFields();
    document.getElementById("adminScheduleDate").value = event.event_date || "";
    document.getElementById("adminScheduleStartTime").value = String(event.start_time || "").slice(0, 5);
    document.getElementById("adminScheduleEndTime").value = String(event.end_time || "").slice(0, 5);
    document.getElementById("adminScheduleJobName").value = event.job_name || "";
    document.getElementById("adminScheduleJobNumber").value = event.job_number || "";
    document.getElementById("adminScheduleItemTitle").value = event.title || "";
    document.getElementById("adminScheduleLocation").value = event.location || "";
    document.getElementById("adminScheduleNotes").value = event.notes || "";
    document.getElementById("adminScheduleMaintenanceReason").value = event.maintenance_reason || "";
    selectAdminScheduleJobForEvent(event);
    selectAdminScheduleVehicleForEvent(event);
    setAdminScheduleEmployeeChecksForEvent(event);

    const saveButton = document.getElementById("adminScheduleSaveButton");
    if (saveButton) {
        saveButton.textContent = "Update Schedule";
    }

    document.getElementById("adminScheduleModalTitle").textContent = "Edit Schedule - " + makeAdminScheduleDate(event.event_date).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
    document.getElementById("adminScheduleStatus").textContent = "Editing this schedule item.";
}

async function deleteAdminScheduleEvent(id) {
    const event = scheduleEvents.find((item) => String(item.id) === String(id));

    if (!event) {
        alert("That schedule event could not be found. Refresh the admin page and try again.");
        return;
    }

    const confirmed = confirm(
        "Delete this schedule item?\n\n" +
        getAdminScheduleTitle(event) + "\n" +
        makeAdminScheduleDate(event.event_date).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    );

    if (!confirmed) {
        return;
    }

    const status = document.getElementById("adminScheduleStatus");

    if (status) {
        status.textContent = "Deleting schedule item...";
    }

    await syncJgcScheduleEventToGoogle(supabaseClient, event, "delete");

    const { error } = await supabaseClient
        .from("schedule_events")
        .delete()
        .eq("id", id);

    if (error) {
        alert("Schedule item could not be deleted: " + (error.message || "Unknown error"));
        if (status) {
            status.textContent = "Schedule item could not be deleted.";
        }
        return;
    }

    await Promise.allSettled([
        supabaseClient
            .from("equipment_maintenance_logs")
            .delete()
            .eq("schedule_event_id", id),
        supabaseClient
            .from("announcements")
            .update({ is_active: false })
            .eq("source_type", "schedule_event")
            .eq("source_id", id)
    ]);

    scheduleEvents = scheduleEvents.filter((item) => String(item.id) !== String(id));
    equipmentMaintenanceLogs = equipmentMaintenanceLogs.filter((item) => String(item.schedule_event_id) !== String(id));
    announcements = announcements.filter((item) => !(item.source_type === "schedule_event" && String(item.source_id) === String(id)));

    if (String(editingAdminScheduleEventId) === String(id)) {
        editingAdminScheduleEventId = "";
    }

    renderAdminScheduleCalendar();
    renderPortalSummary();
    openAdminScheduleModal(event.event_date || formatAdminScheduleDateValue(new Date()));
    const nextStatus = document.getElementById("adminScheduleStatus");

    if (nextStatus) {
        nextStatus.textContent = "Schedule item deleted.";
    }
}

function buildAdminScheduleAnnouncementBody(event, account) {
    return [
        "You have been tagged on the JGC schedule.",
        "",
        "Type: " + getAdminScheduleTypeLabel(getAdminScheduleType(event)),
        "Date: " + makeAdminScheduleDate(event.event_date).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
        "Time: " + [formatAdminScheduleTime(event.start_time), event.end_time ? "to " + formatAdminScheduleTime(event.end_time) : ""].filter(Boolean).join(" "),
        "Item: " + getAdminScheduleTitle(event),
        "Job: " + (event.job_name ? (event.job_number ? event.job_number + " - " : "") + event.job_name : ""),
        "Location: " + (event.location || ""),
        "Reason: " + (event.maintenance_reason || ""),
        "",
        "Notes:",
        event.notes || "",
        "",
        "Scheduled for: " + (account.display_name || account.worker_key || account.email || "")
    ].join("\n");
}

async function createAdminScheduleAnnouncements(event, selectedAccounts) {
    const records = selectedAccounts.map((account) => ({
        title: "Scheduled: " + makeAdminScheduleDate(event.event_date).toLocaleDateString("en-CA", { month: "long", day: "numeric" }),
        body: buildAdminScheduleAnnouncementBody(event, account),
        created_by: currentUserId || null,
        created_by_name: currentWorkerDisplay,
        expires_at: null,
        is_active: true,
        target_worker_name: account.worker_key || account.display_name || "",
        target_worker_email: account.email || "",
        source_type: "schedule_event",
        source_id: event.id
    }));

    if (!records.length) {
        return;
    }

    await supabaseClient
        .from("announcements")
        .insert(records);

    if (typeof createJgcPortalNotifications === "function") {
        await createJgcPortalNotifications(supabaseClient, "schedule_update", selectedAccounts, {
            title: "Scheduled: " + makeAdminScheduleDate(event.event_date).toLocaleDateString("en-CA", { month: "long", day: "numeric" }),
            message: [formatAdminScheduleTime(event.start_time), getAdminScheduleTitle(event)].filter(Boolean).join(" - "),
            link_url: "schedule.html",
            source_table: "schedule_events",
            source_id: event.id,
            created_by: currentUserId || null,
            created_by_name: currentWorkerDisplay,
            metadata: {
                event_date: event.event_date || "",
                event_type: getAdminScheduleType(event),
                job_number: event.job_number || "",
                job_name: event.job_name || "",
                location: event.location || ""
            }
        });
    }
}

function getAdminScheduleNotificationEmails(selectedAccounts) {
    const adminEmails = typeof JGC_ADMIN_EMAILS !== "undefined"
        ? JGC_ADMIN_EMAILS
        : ["zeth@johngordonconstruction.com", "jeff@johngordonconstruction.com"];
    const emails = (selectedAccounts || [])
        .map((account) => account.email || "")
        .concat(worker.email || "")
        .concat(adminEmails || []);
    const seen = new Set();

    return emails
        .map((email) => String(email || "").trim())
        .filter((email) => {
            const key = email.toLowerCase();

            if (!key || seen.has(key)) {
                return false;
            }

            seen.add(key);
            return true;
        });
}

async function emailAdminScheduleEmployees(event, selectedAccounts) {
    const recipients = getAdminScheduleNotificationEmails(selectedAccounts);

    if (!recipients.length || !SCHEDULE_EMAIL_SCRIPT_URL) {
        return;
    }

    const body = buildAdminScheduleAnnouncementBody(event, {
        display_name: selectedAccounts.map((account) => account.display_name || account.worker_key || account.email).join(", ")
    });

    await fetch(SCHEDULE_EMAIL_SCRIPT_URL, {
        method: "POST",
        mode: "no-cors",
        headers: {
            "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
            to: recipients.join(","),
            subject: "JGC Schedule - " + getAdminScheduleTypeLabel(getAdminScheduleType(event)) + " - " + event.event_date,
            body,
            text: body,
            pdfHtml: "<html><body><pre>" + escapeHtml(body) + "</pre></body></html>",
            pdfFileName: "jgc-schedule-" + event.event_date + ".pdf",
            source: "schedule_event"
        })
    });
}

async function saveAdminScheduleMaintenanceLog(event, selectedVehicle, maintenanceReason) {
    if (!selectedVehicle || !maintenanceReason || !event || !event.id) {
        return;
    }

    const { data, error } = await supabaseClient
        .from("equipment_maintenance_logs")
        .upsert({
            equipment_id: selectedVehicle.id || null,
            schedule_event_id: event.id,
            equipment_name: getAdminScheduleEquipmentLabel(selectedVehicle),
            maintenance_reason: maintenanceReason,
            scheduled_date: event.event_date,
            scheduled_time: event.start_time || null,
            status: "scheduled",
            notes: event.notes || ""
        }, { onConflict: "schedule_event_id" })
        .select()
        .single();

    if (!error && data) {
        equipmentMaintenanceLogs = equipmentMaintenanceLogs
            .filter((row) => row.schedule_event_id !== event.id)
            .concat(data);
    }
}

async function saveAdminScheduleEvent() {
    const selectedAccounts = getSelectedAdminScheduleAccounts();
    const eventType = document.getElementById("adminScheduleType").value || "work";
    const isWork = eventType === "work";
    const selectedVehicle = eventType === "vehicle" ? getSelectedAdminScheduleVehicle() : null;
    const eventDate = document.getElementById("adminScheduleDate").value;
    const title = document.getElementById("adminScheduleItemTitle").value.trim();
    const location = document.getElementById("adminScheduleLocation").value.trim();
    const maintenanceReason = eventType === "vehicle" ? document.getElementById("adminScheduleMaintenanceReason").value.trim() : "";
    const jobName = (isWork ? document.getElementById("adminScheduleJobName").value.trim() : (title || getAdminScheduleEquipmentLabel(selectedVehicle))) ||
        title ||
        location;
    const displayName = String(title || jobName || location || "").trim().replace(/\s+/g, " ");
    const timeRange = getAdminScheduleTimeRange(document.getElementById("adminScheduleStartTime").value, document.getElementById("adminScheduleEndTime").value);
    const status = document.getElementById("adminScheduleStatus");

    if (!eventDate) {
        status.textContent = "Choose a date for this schedule event.";
        return;
    }

    if (!displayName) {
        status.textContent = "Enter at least a name, job, title, or location for this schedule event.";
        return;
    }

    if (eventType === "vehicle" && !maintenanceReason) {
        status.textContent = "Enter the reason for the equipment or vehicle appointment.";
        return;
    }

    const record = {
        event_type: eventType,
        event_date: eventDate,
        start_time: timeRange.start,
        end_time: timeRange.end,
        job_id: isWork ? (document.getElementById("adminScheduleJob").value || null) : null,
        equipment_id: selectedVehicle ? selectedVehicle.id : null,
        maintenance_reason: maintenanceReason,
        title: title || displayName,
        job_name: jobName || displayName,
        job_number: isWork ? document.getElementById("adminScheduleJobNumber").value.trim() : "",
        location,
        notes: document.getElementById("adminScheduleNotes").value.trim(),
        employee_names: selectedAccounts.map((account) => account.display_name || account.worker_key || account.email || "Employee"),
        employee_keys: selectedAccounts.map((account) => account.worker_key || account.display_name || account.email || ""),
        employee_emails: selectedAccounts.map((account) => account.email || ""),
        created_by: currentUserId || null,
        created_by_name: currentWorkerDisplay
    };

    const isEditing = Boolean(editingAdminScheduleEventId);

    if (isDuplicateAdminScheduleEvent(record, editingAdminScheduleEventId)) {
        status.textContent = "That schedule event already exists for the same day and time.";
        return;
    }

    status.textContent = isEditing ? "Updating schedule..." : "Saving schedule...";

    const query = isEditing
        ? supabaseClient
            .from("schedule_events")
            .update(record)
            .eq("id", editingAdminScheduleEventId)
            .select()
            .single()
        : supabaseClient
            .from("schedule_events")
            .insert(record)
            .select()
            .single();
    const { data, error } = await query;

    if (error) {
        status.textContent = "Schedule could not be saved: " + (error.message || "Make sure the updated schedule setup SQL has been run.");
        return;
    }

    if (isEditing) {
        scheduleEvents = scheduleEvents.map((event) => String(event.id) === String(data.id) ? data : event);
    } else {
        scheduleEvents.push(data);
        await createAdminScheduleAnnouncements(data, selectedAccounts);

        try {
            await emailAdminScheduleEmployees(data, selectedAccounts);
        } catch (emailError) {
            console.warn("Schedule email could not be sent.", emailError);
        }
    }

    await saveAdminScheduleMaintenanceLog(data, selectedVehicle, maintenanceReason);
    const syncResult = await syncJgcScheduleEventToGoogle(supabaseClient, {
        ...data,
        equipment_name: selectedVehicle ? getAdminScheduleEquipmentLabel(selectedVehicle) : ""
    }, "upsert");

    await loadAnnouncements();
    adminScheduleMonth = makeAdminScheduleDate(data.event_date || eventDate);
    renderAdminScheduleCalendar();
    renderPortalSummary();
    closeAdminScheduleModal();
    alert(syncResult.ok
        ? (isEditing ? "Schedule updated. Google Calendar sync queued." : "Schedule saved. Tagged employees were notified. Google Calendar sync queued.")
        : "Event saved, but Google Calendar sync failed.");

    setTimeout(async function() {
        await loadAllAdminData();
        renderAdminScheduleCalendar();
        renderPortalSummary();
    }, 3500);
}

function renderPortalSummary() {
    const grid = document.getElementById("portalSummaryGrid");

    if (!grid) {
        return;
    }

    const todayValue = getLocalDateValue(new Date());
    const weekStart = getCurrentWeekStartForSummary();
    const inspectionsToday = inspections
        .concat(vehicleInspections || [])
        .filter((inspection) => isSameLocalDay(inspection.inspection_date || inspection.created_at, todayValue)).length;
    const reportsToday = countRecentReportsToday(todayValue);
    const expiringCertificates = getCertificateExpiryAlerts().length;
    const equipmentExpiring = countEquipmentExpiryAlerts();
    const pendingAccounts = countPendingAccounts();
    const pendingVacations = vacationRequests.filter((request) => String(request.status || "").toLowerCase() === "pending").length;
    const liveEntriesThisWeek = liveTimesheetEntries.filter((entry) => String(entry.week_start || "") === weekStart).length;
    const sickDaysThisWeek = liveTimesheetEntries.filter((entry) =>
        String(entry.week_start || "") === weekStart &&
        String(entry.entry_type || "").toLowerCase() === "sick"
    ).length;
    const activeAnnouncements = announcements.length;
    const activeJobs = jobs.filter((job) => job.active !== false).length;
    const activeWorkOrders = workOrders.filter((wo) => String(wo.status || "").toLowerCase() !== "submitted").length;
    const activeEquipment = equipmentItems.length;
    const activeContacts = contacts.length;
    const activeSubcontractorSuppliers = subcontractorSuppliers.length;
    const reportsForBadge = dailySiteReports
        .concat(incidentReports)
        .concat(accidentReports)
        .concat(employeeInjuryReports)
        .concat(toolboxReports);

    const tiles = [
        {
            title: "Jobs",
            value: activeJobs,
            badgeCount: null,
            detail: "Job costing and project summaries",
            action: "openAdminSummaryTile('jobDashboard')"
        },
        {
            title: "Profiles",
            value: getApprovedAccounts().length,
            badgeCount: null,
            detail: "Complete employee dashboard",
            action: "openAdminSummaryTile('employeeProfile')"
        },
        {
            title: "Timesheets",
            value: liveEntriesThisWeek,
            badgeCount: countNewForAdminTab(liveTimesheetEntries, "timesheets", ["created_at", "updated_at"]),
            detail: "Live entries saved this week",
            action: "openAdminSummaryTile('timesheets')"
        },
        {
            title: "Sick",
            value: sickDaysThisWeek,
            badgeCount: countNewForAdminTab(liveTimesheetEntries.filter((entry) => String(entry.entry_type || "").toLowerCase() === "sick"), "employeeProfile", ["created_at", "updated_at"]),
            detail: "Sick entries logged this week",
            action: "openAdminSummaryTile('employeeProfile')"
        },
        {
            title: "Inspections",
            value: inspectionsToday,
            badgeCount: countNewForAdminTab(inspections.concat(vehicleInspections || []), "inspections", ["created_at", "updated_at"]),
            detail: "Inspection records completed today",
            action: "openAdminSummaryTile('inspections')"
        },
        {
            title: "Reports",
            value: reportsToday,
            badgeCount: countNewForAdminTab(reportsForBadge, "reports", ["created_at", "updated_at", "submitted_at"]),
            detail: "Reports submitted today",
            action: "openAdminSummaryTile('reports')"
        },
        {
            title: "Certs",
            value: expiringCertificates,
            badgeCount: countNewForAdminTab(certificates, "certificates", ["created_at", "updated_at"]),
            detail: "Certificates expiring within 30 days",
            action: "openAdminSummaryTile('certificates')"
        },
        {
            title: "Vacation",
            value: pendingVacations,
            badgeCount: countNewForAdminTab(vacationRequests, "vacation", ["created_at", "updated_at"]),
            detail: "Pending approvals",
            action: "openAdminSummaryTile('vacation')"
        },
        {
            title: "Notice / Policy",
            value: activeAnnouncements + " / " + policies.length,
            badgeCount: null,
            detail: "Active notices / policies",
            action: "openAdminSummaryTile('noticePolicy')"
        },
        {
            title: "Talks",
            value: toolboxReports.length,
            badgeCount: countNewForAdminTab(toolboxReports.concat(toolboxAttendance), "reports", ["created_at", "acknowledged_at"]),
            detail: "New reports or acknowledgements",
            action: "openAdminSummaryTile('reports')"
        },
        {
            title: "Job List",
            value: activeJobs,
            badgeCount: null,
            detail: "Active jobs available for timesheets",
            action: "openAdminSummaryTile('jobs')"
        },
        {
            title: "WO",
            value: activeWorkOrders,
            badgeCount: countNewForAdminTab(workOrders.concat(workOrderLabourRows), "workOrders", ["created_at", "updated_at", "submitted_at"]),
            detail: "Draft or ready Work Orders",
            action: "openAdminSummaryTile('workOrders')"
        },
        {
            title: "Equipment",
            value: equipmentExpiring,
            badgeCount: countNewForAdminTab(equipmentItems, "equipment", ["created_at", "updated_at"]),
            detail: "Inspections expiring within 30 days",
            action: "openAdminSummaryTile('equipment')"
        },
        {
            title: "Contacts",
            value: activeContacts,
            badgeCount: null,
            detail: "Active company contacts",
            action: "openAdminSummaryTile('contacts')"
        },
        {
            title: "Subs/Suppliers",
            value: activeSubcontractorSuppliers,
            badgeCount: countNewForAdminTab(subcontractorSuppliers, "subcontractorsSuppliers", ["created_at", "updated_at"]),
            detail: "Active subcontractors and suppliers",
            action: "openAdminSummaryTile('subcontractorsSuppliers')"
        },
        {
            title: "Accounts",
            value: pendingAccounts,
            badgeCount: countNewForAdminTab(accounts.filter((account) => String(account.account_status || "").toLowerCase() === "pending"), "accounts", ["created_at"]),
            detail: "Accounts waiting for approval",
            action: "openAccountsFromSummary()"
        },
        {
            title: "Backups",
            value: "Sun",
            badgeCount: null,
            detail: "Weekly backup plus manual restore prep",
            action: "openAdminSummaryTile('backups')"
        }
    ];

    notifyPendingAccountsForReview(accounts.filter((account) => String(account.account_status || "").toLowerCase() === "pending"));

    const notificationTiles = tiles.filter((tile) => Number(tile.badgeCount || 0) > 0);

    grid.innerHTML = notificationTiles.length
        ? notificationTiles.map(renderSummaryTile).join("")
        : '<div class="small">No current admin notifications.</div>';
}

function notifyPendingAccountsForReview(pendingRows) {
    if (!pendingRows.length || typeof createJgcPortalNotifications !== "function") {
        return;
    }

    pendingRows.forEach((account) => {
        if (!account.id) {
            return;
        }

        createJgcPortalNotifications(supabaseClient, "admin_account_pending", [{ role: "admin" }], {
            title: "Account approval needed",
            message: (account.display_name || account.email || "A new account") + " is waiting for approval.",
            link_url: "accounts.html",
            source_table: "profiles",
            source_id: account.id,
            dedupe_key_prefix: "admin_account_pending:" + account.id,
            metadata: {
                display_name: account.display_name || "",
                email: account.email || "",
                worker_key: account.worker_key || ""
            }
        }).catch((error) => {
            console.warn("Pending account notification could not be created.", error);
        });
    });
}
