function getExcelCell(row, name) {
    const normalizedName = name.toLowerCase().replace(/\s+/g, "");
    const key = Object.keys(row).find((item) => item.toLowerCase().replace(/\s+/g, "") === normalizedName);
    return key ? row[key] : "";
}

function normalizeExcelHeader(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isHighlightedFill(cell) {
    if (!cell || !cell.s) {
        return false;
    }

    const fill = cell.s.fill || {};
    const patternType = String(fill.patternType || "").toLowerCase();
    const colors = [fill.fgColor, fill.bgColor, fill.patternColor].filter(Boolean);

    if (patternType && patternType !== "none") {
        return true;
    }

    return colors.some((color) => {
        const value = String(color.rgb || color.indexed || color.theme || "").toUpperCase();

        if (!value) {
            return false;
        }

        return ![
            "FFFFFF",
            "FFFFFFFF",
            "000000",
            "FF000000",
            "64",
            "65"
        ].includes(value);
    });
}

function isHighlightedInactiveRow(sheet, rowIndex, columnIndexes) {
    return columnIndexes.some((columnIndex) => {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
        return isHighlightedFill(sheet[address]);
    });
}

function normalizeExcelValue(value) {
    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "object") {
        if (Array.isArray(value.richText)) {
            return value.richText.map((part) => part.text || "").join("").trim();
        }

        if (value.text !== undefined) {
            return String(value.text || "").trim();
        }

        if (value.result !== undefined) {
            return String(value.result || "").trim();
        }

        if (value.formula !== undefined) {
            return String(value.result || value.formula || "").trim();
        }
    }

    return String(value || "").trim();
}

function cleanRepeatedExcelText(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    const words = text.split(" ").filter(Boolean);

    if (words.length < 2) {
        return text;
    }

    for (let size = 1; size <= Math.floor(words.length / 2); size++) {
        if (words.length % size !== 0) {
            continue;
        }

        const pattern = words.slice(0, size).join(" ");
        let repeated = true;

        for (let index = size; index < words.length; index += size) {
            if (words.slice(index, index + size).join(" ").toLowerCase() !== pattern.toLowerCase()) {
                repeated = false;
                break;
            }
        }

        if (repeated) {
            return pattern;
        }
    }

    return text;
}

function getExcelJobName(row, jobNameColumns) {
    const seen = new Set();
    const parts = [];

    jobNameColumns.forEach((columnIndex) => {
        const value = cleanRepeatedExcelText(normalizeExcelValue(row.getCell(columnIndex + 1).value));
        const key = normalizeExcelHeader(value);

        if (!value || seen.has(key)) {
            return;
        }

        seen.add(key);
        parts.push(value);
    });

    return cleanRepeatedExcelText(parts.join(" "));
}

function isExcelJsHighlightedCell(cell) {
    const fill = cell && cell.fill ? cell.fill : null;

    if (!fill) {
        return false;
    }

    const type = String(fill.type || "").toLowerCase();
    const pattern = String(fill.pattern || "").toLowerCase();
    const colors = [fill.fgColor, fill.bgColor].filter(Boolean);

    const hasNonDefaultColor = colors.some((color) => {
        const value = String(color.argb || color.rgb || color.indexed || color.theme || "").toUpperCase();

        if (!value) {
            return false;
        }

        return ![
            "FFFFFF",
            "FFFFFFFF",
            "000000",
            "FF000000",
            "64",
            "65"
        ].includes(value);
    });

    if (hasNonDefaultColor) {
        return true;
    }

    return Boolean(type && type !== "none" && pattern && pattern !== "none" && !colors.length);
}

function isExcelJsRedFill(cell) {
    const fill = cell && cell.fill ? cell.fill : null;

    if (!fill) {
        return false;
    }

    return [fill.fgColor, fill.bgColor].filter(Boolean).some((color) => {
        const value = String(color.argb || color.rgb || "").replace(/^#/, "").toUpperCase();
        const hex = value.length === 8 ? value.slice(2) : value;

        if (!/^[0-9A-F]{6}$/.test(hex)) {
            return false;
        }

        const red = parseInt(hex.slice(0, 2), 16);
        const green = parseInt(hex.slice(2, 4), 16);
        const blue = parseInt(hex.slice(4, 6), 16);
        const maximum = Math.max(red, green, blue);
        const minimum = Math.min(red, green, blue);

        if (maximum === minimum || maximum !== red) {
            return false;
        }

        const hue = (60 * ((green - blue) / (maximum - minimum)) + 360) % 360;
        return hue <= 20 || hue >= 340;
    });
}

function isExcelJsHighlightedRow(row, columnIndexes) {
    if (isExcelJsHighlightedCell({ fill: row.fill })) {
        return true;
    }

    return columnIndexes.some((columnIndex) => isExcelJsHighlightedCell(row.getCell(columnIndex + 1)));
}

function isExcelJsCancelledRow(row, columnIndexes) {
    if (isExcelJsRedFill({ fill: row.fill })) {
        return true;
    }

    return columnIndexes.some((columnIndex) => isExcelJsRedFill(row.getCell(columnIndex + 1)));
}

function isJobImportSheet(sheetName) {
    const currentYear = new Date().getFullYear();
    const yearMatch = String(sheetName || "").match(/\b(20\d{2})\b/);

    if (!yearMatch) {
        return false;
    }

    const year = Number(yearMatch[1]);
    return year >= 2025 && year <= currentYear;
}

function renderJobDashboardOptions() {
    const select = document.getElementById("jobDashboardSelect");

    if (!select) {
        return;
    }

    const currentValue = select.value;
    const sorted = jobs
        .filter((job) => shouldShowJobOnDashboard(job))
        .sort((a, b) => String(a.job_number || "").localeCompare(String(b.job_number || ""), undefined, { numeric: true }));

    select.innerHTML = sorted.length
        ? sorted.map((job) => `<option value="${escapeHtml(job.job_number || job.id)}">${escapeHtml([job.job_number, job.job_name].filter(Boolean).join(" - "))}</option>`).join("")
        : '<option value="">No jobs found</option>';

    if (currentValue && sorted.some((job) => (job.job_number || job.id) === currentValue)) {
        select.value = currentValue;
    }
}

function getSelectedDashboardJob() {
    const select = document.getElementById("jobDashboardSelect");
    const selectedValue = select ? select.value : "";
    const availableJobs = jobs.filter((job) => shouldShowJobOnDashboard(job));

    return availableJobs.find((job) => (job.job_number || job.id) === selectedValue) || availableJobs[0] || null;
}

function getArchiveCutoffDate() {
    const date = new Date();
    date.setMonth(date.getMonth() + 2);
    return date.toISOString().slice(0, 10);
}

function shouldShowJobOnDashboard(job) {
    if (!job) {
        return false;
    }

    if (job.active !== false) {
        return true;
    }

    return Boolean(job.archive_until && String(job.archive_until) >= new Date().toISOString().slice(0, 10));
}

function getArchivedDashboardJobs() {
    return jobs
        .filter((job) => job.active === false && shouldShowJobOnDashboard(job))
        .sort((a, b) => String(a.archive_until || "").localeCompare(String(b.archive_until || "")));
}

function getJobMatchTokens(job) {
    return {
        number: normalizeWorkerName(job && job.job_number),
        name: normalizeWorkerName(job && job.job_name),
        display: [job && job.job_number, job && job.job_name].filter(Boolean).join(" - ")
    };
}

function valueMatchesJob(value, job) {
    const text = normalizeWorkerName(value);
    const tokens = getJobMatchTokens(job);

    return Boolean(text && (
        (tokens.number && text.includes(tokens.number)) ||
        (tokens.name && text.includes(tokens.name))
    ));
}

function itemMatchesJob(item, job, fields) {
    return fields.some((field) => valueMatchesJob(item && item[field], job));
}

function parseDashboardDate(value) {
    if (!value) {
        return null;
    }

    const date = new Date(String(value).slice(0, 10) + "T00:00:00");
    return Number.isNaN(date.getTime()) ? null : date;
}

function getDashboardWeekStart(value) {
    const date = parseDashboardDate(value);

    if (!date) {
        return "";
    }

    date.setDate(date.getDate() - date.getDay());
    return date.toISOString().slice(0, 10);
}

function getDashboardEntryDate(entry) {
    if (entry.week_start) {
        return entry.week_start;
    }

    if (entry.weekStartValue) {
        return entry.weekStartValue;
    }

    return "";
}

function getDashboardTimesheetRows(job) {
    const rows = [];

    liveTimesheetEntries
        .filter((entry) => String(entry.entry_type || "work").toLowerCase() === "work")
        .filter((entry) => itemMatchesJob(entry, job, ["job_number", "job_name"]))
        .forEach((entry) => {
            rows.push({
                worker: entry.worker_name || entry.user || "",
                jobType: job.job_type || "",
                hours: Number(entry.hours || 0),
                date: getDashboardEntryDate(entry),
                week: getDashboardWeekStart(getDashboardEntryDate(entry))
            });
        });

    timesheets.forEach((week) => {
        (Array.isArray(week.entries) ? week.entries : [])
            .filter((entry) => String(entry.entryType || entry.entry_type || "work").toLowerCase() === "work")
            .filter((entry) => valueMatchesJob(entry.jobNumber || entry.job_number, job) || valueMatchesJob(entry.jobName || entry.job_name, job))
            .forEach((entry) => {
                const date = entry.weekStartValue || week.week_start || week.submitted_at || "";
                rows.push({
                    worker: entry.user || week.worker_name || "",
                    jobType: job.job_type || "",
                    hours: Number(entry.hours || 0),
                    date,
                    week: getDashboardWeekStart(date)
                });
            });
    });

    return rows.filter((row) => row.hours > 0);
}

function isDashboardManualWorkOrderLabour(row) {
    return String(row && row.worker_key || "").startsWith("manual-") ||
        String(row && row.notes || "").toLowerCase() === "manual labour entry";
}

function getDashboardManualWorkOrderLabourRows(job, workOrderRows) {
    const submittedWorkOrderIds = new Set(
        (workOrderRows || [])
            .filter((wo) => String(wo.status || "").toLowerCase() === "submitted" || wo.locked)
            .map((wo) => wo.id)
    );

    return workOrderLabourRows
        .filter((row) => submittedWorkOrderIds.has(row.work_order_id))
        .filter(isDashboardManualWorkOrderLabour)
        .map((row) => {
            const wo = (workOrderRows || []).find((item) => item.id === row.work_order_id) || {};
            const date = wo.work_order_date || wo.submitted_at || row.updated_at || wo.created_at || "";
            return {
                worker: row.employee_name || "Manual Labour",
                jobType: job.job_type || "",
                hours: Number(row.hours || 0),
                date,
                week: getDashboardWeekStart(date),
                source: "Manual WO Labour"
            };
        })
        .filter((row) => row.hours > 0);
}

function sumRows(rows, valueGetter) {
    return rows.reduce((total, row) => total + Number(valueGetter(row) || 0), 0);
}

function groupTotals(rows, keyGetter, valueGetter) {
    const map = new Map();

    rows.forEach((row) => {
        const key = keyGetter(row) || "Unspecified";
        map.set(key, (map.get(key) || 0) + Number(valueGetter(row) || 0));
    });

    return Array.from(map.entries())
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);
}

function formatDashboardWeekLabel(value) {
    const date = parseDashboardDate(value);

    if (!date) {
        return "No week";
    }

    return "Week of " + date.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function renderJobBars(rows, emptyText) {
    if (!rows.length) {
        return `<div class="small">${escapeHtml(emptyText)}</div>`;
    }

    const max = Math.max(...rows.map((row) => row.value), 1);

    return rows.map((row) => `
        <div class="job-bar-row">
            <div>${escapeHtml(row.label)}</div>
            <div class="job-bar-track"><div class="job-bar-fill" style="width:${Math.max(4, Math.round((row.value / max) * 100))}%;"></div></div>
            <strong>${Number(row.value || 0).toFixed(2)}</strong>
        </div>
    `).join("");
}

function getDashboardWorkOrders(job) {
    return workOrders.filter((wo) => itemMatchesJob(wo, job, ["job_number", "job_name"]));
}

function getDashboardRecordSortTime(value) {
    const date = parseDashboardDate(value);
    return date ? date.getTime() : 0;
}

function getJobDashboardDigitalPoStatus(purchaseOrder) {
    const workflowStatus = String(purchaseOrder && purchaseOrder.workflow_status || "").toLowerCase();
    const emailStatus = String(purchaseOrder && purchaseOrder.email_status || "").toLowerCase();

    if (workflowStatus === "submitted" && ["not_ready", "pending", "sending"].includes(emailStatus)) {
        return "Pending Submission";
    }

    if (workflowStatus === "submitted" && emailStatus === "emailed") {
        return "Submitted";
    }

    return capitalizeWords(workflowStatus || emailStatus || "draft");
}

function getDashboardPurchaseOrders(job, workOrderRows) {
    const workOrderIds = new Set((workOrderRows || []).map((workOrder) => workOrder.id));
    const workOrdersById = new Map((workOrderRows || []).map((workOrder) => [workOrder.id, workOrder]));
    const jobTokens = getJobMatchTokens(job);
    const digitalRows = digitalPurchaseOrders
        .filter((purchaseOrder) => {
            const purchaseOrderJobNumber = normalizeWorkerName(purchaseOrder && purchaseOrder.job_number);

            if (jobTokens.number && purchaseOrderJobNumber) {
                return purchaseOrderJobNumber === jobTokens.number;
            }

            return valueMatchesJob(purchaseOrder && purchaseOrder.job_name, job);
        })
        .map((purchaseOrder) => ({
            id: purchaseOrder.id,
            poNumber: purchaseOrder.po_number,
            date: purchaseOrder.order_date || purchaseOrder.created_at || "",
            status: getJobDashboardDigitalPoStatus(purchaseOrder),
            supplier: purchaseOrder.supplier_name || "",
            source: "digital",
            record: purchaseOrder
        }));
    const manualRows = workOrderPurchaseOrders
        .filter((purchaseOrder) => workOrderIds.has(purchaseOrder.work_order_id))
        .map((purchaseOrder) => {
            const linkedWorkOrder = workOrdersById.get(purchaseOrder.work_order_id) || null;
            return {
                id: purchaseOrder.id,
                poNumber: purchaseOrder.po_number || purchaseOrder.purchase_order_number,
                date: purchaseOrder.po_date || (linkedWorkOrder && linkedWorkOrder.work_order_date) || purchaseOrder.created_at || "",
                status: linkedWorkOrder ? "Manual / " + getAdminWorkOrderStatusLabel(linkedWorkOrder.status) : "Manual PO",
                supplier: purchaseOrder.company_name || purchaseOrder.supplier || "",
                source: "work-order",
                record: purchaseOrder,
                linkedWorkOrder
            };
        });

    return digitalRows.concat(manualRows).sort((a, b) =>
        getDashboardRecordSortTime(b.date) - getDashboardRecordSortTime(a.date) ||
        String(b.poNumber || "").localeCompare(String(a.poNumber || ""), undefined, { numeric: true })
    );
}

function getDashboardDailyReports(job) {
    return dailySiteReports.filter((report) => itemMatchesJob(report, job, ["project", "location"]));
}

function getDashboardInspections(job) {
    return inspections.filter((inspection) =>
        itemMatchesJob(inspection, job, ["project", "job_name", "job_number", "location", "inspection_type"]) ||
        valueMatchesJob(JSON.stringify(inspection || {}), job)
    );
}

function getDashboardEquipmentRows(workOrderRows) {
    const workOrderIds = new Set(workOrderRows.map((wo) => wo.id));
    const rows = [];

    workOrderEquipmentRows
        .filter((row) => workOrderIds.has(row.work_order_id))
        .forEach((row) => rows.push({
            name: row.equipment_name || "Equipment",
            identification: row.identification_number || "",
            status: "Used"
        }));

    workOrderTravelRows
        .filter((row) => workOrderIds.has(row.work_order_id) && row.vehicle_name)
        .forEach((row) => rows.push({
            name: row.vehicle_name || "Vehicle",
            identification: row.identification_number || "",
            status: row.trailer_used ? "Travel / Trailer" : "Travel"
        }));

    return rows;
}

function renderDashboardTable(headers, rows, rowBuilder, emptyText, actionBuilder) {
    if (!rows.length) {
        return `<div class="small">${escapeHtml(emptyText)}</div>`;
    }

    return `
        <div class="table-wrap">
            <table>
                <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}${actionBuilder ? '<th class="job-dashboard-actions-cell">View</th>' : ""}</tr></thead>
                <tbody>${rows.map((row) => `<tr>${rowBuilder(row).map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}${actionBuilder ? '<td class="job-dashboard-actions-cell">' + actionBuilder(row) + '</td>' : ""}</tr>`).join("")}</tbody>
            </table>
        </div>
    `;
}

function renderJobDashboardRecordFields(fields) {
    return `
        <div class="job-dashboard-record-grid">
            ${fields.map(([label, value]) => `
                <div class="job-dashboard-record-field">
                    <span>${escapeHtml(label)}</span>
                    <strong>${escapeHtml(value || "Not provided")}</strong>
                </div>
            `).join("")}
        </div>
    `;
}

function openJobDashboardRecordModal(recordType, title, fields, descriptionLabel, description) {
    const modal = document.getElementById("jobDashboardRecordModal");
    const typeElement = document.getElementById("jobDashboardRecordType");
    const titleElement = document.getElementById("jobDashboardRecordTitle");
    const content = document.getElementById("jobDashboardRecordContent");

    if (!modal || !typeElement || !titleElement || !content) {
        return;
    }

    jobDashboardRecordReturnFocus = document.activeElement;
    typeElement.textContent = recordType || "Record";
    titleElement.textContent = title || "Record Details";
    content.innerHTML = renderJobDashboardRecordFields(fields || []) + (description ? `
        <div class="job-dashboard-record-description">
            <span>${escapeHtml(descriptionLabel || "Details")}</span>
            <p>${escapeHtml(description)}</p>
        </div>
    ` : "");
    modal.hidden = false;

    if (window.lucide && typeof window.lucide.createIcons === "function") {
        window.lucide.createIcons();
    }

    const closeButton = modal.querySelector(".job-dashboard-record-close");
    if (closeButton) {
        closeButton.focus();
    }
}

function closeJobDashboardRecordModal() {
    const modal = document.getElementById("jobDashboardRecordModal");

    if (modal) {
        modal.hidden = true;
    }

    if (jobDashboardRecordReturnFocus && typeof jobDashboardRecordReturnFocus.focus === "function") {
        jobDashboardRecordReturnFocus.focus();
    }
    jobDashboardRecordReturnFocus = null;
}

function openJobDashboardWorkOrder(id) {
    const workOrder = workOrders.find((item) => String(item.id) === String(id));

    if (!workOrder) {
        alert("Work Order could not be found.");
        return;
    }

    adminWorkOrderManagementView = isAdminWorkOrderSubmittedForManagement(workOrder) ? "submitted" : "active";
    showTab("workOrders");
    renderAdminWorkOrders();
    openAdminWorkOrderEditor(workOrder.id);
}

function openJobDashboardPurchaseOrder(source, id) {
    if (source === "digital") {
        const purchaseOrder = digitalPurchaseOrders.find((item) => String(item.id) === String(id));

        if (!purchaseOrder) {
            alert("Purchase Order could not be found.");
            return;
        }

        window.location.href = "purchase-orders-admin.html?po=" + encodeURIComponent(purchaseOrder.id);
        return;
    }

    const purchaseOrder = workOrderPurchaseOrders.find((item) => String(item.id) === String(id));
    const linkedWorkOrder = purchaseOrder
        ? workOrders.find((item) => String(item.id) === String(purchaseOrder.work_order_id))
        : null;

    if (!purchaseOrder) {
        alert("Purchase Order could not be found.");
        return;
    }

    if (!linkedWorkOrder) {
        alert("This manual Purchase Order is not linked to a Work Order that can be opened.");
        return;
    }

    openJobDashboardWorkOrder(linkedWorkOrder.id);
}

document.addEventListener("keydown", (event) => {
    const modal = document.getElementById("jobDashboardRecordModal");
    if (event.key === "Escape" && modal && !modal.hidden) {
        closeJobDashboardRecordModal();
    }
});

function renderJobDashboardMetric(title, value, detail) {
    return `
        <div class="job-dashboard-metric">
            <span>${escapeHtml(title)}</span>
            <strong>${escapeHtml(String(value))}</strong>
            <em>${escapeHtml(detail || "")}</em>
        </div>
    `;
}

function getJobDocumentHref(job) {
    const url = String(job && job.document_link || "").trim();
    return /^https?:\/\//i.test(url) ? url : "";
}

async function saveJobDashboardInfo(jobId) {
    const job = jobs.find((item) => item.id === jobId);

    if (!job) {
        alert("Job could not be found.");
        return;
    }

    const getValue = (id) => {
        const input = document.getElementById(id);
        return input ? input.value.trim() : "";
    };
    const payload = {
        customer: getValue("jobDashboardCustomer") || null,
        job_type: getValue("jobDashboardJobType") || null,
        address: getValue("jobDashboardAddress") || null,
        project_manager: getValue("jobDashboardProjectManager") || null,
        start_date: getValue("jobDashboardStartDate") || null,
        target_end_date: getValue("jobDashboardTargetEndDate") || null,
        document_link: getValue("jobDashboardDocumentLink") || null,
        document_link_label: getValue("jobDashboardDocumentLinkLabel") || null,
        updated_at: new Date().toISOString()
    };

    const status = document.getElementById("jobDashboardEditStatus");
    if (status) {
        status.textContent = "Saving job info...";
    }

    const { data, error } = await supabaseClient
        .from("jobs")
        .update(payload)
        .eq("id", jobId)
        .select()
        .single();

    if (error) {
        if (status) {
            status.textContent = "Job info could not be saved: " + error.message;
        }
        return;
    }

    jobs = jobs.map((item) => item.id === jobId ? data : item);
    renderJobsManagement();
    renderJobDashboardOptions();
    const select = document.getElementById("jobDashboardSelect");
    if (select) {
        select.value = data.job_number || data.id;
    }
    renderJobDashboard();
}

function renderJobDashboard() {
    const container = document.getElementById("jobDashboardContent");
    const job = getSelectedDashboardJob();

    if (!container) {
        return;
    }

    if (!job) {
        container.textContent = "Import jobs to build the dashboard.";
        return;
    }

    const workOrderRows = getDashboardWorkOrders(job);
    const purchaseOrderRows = getDashboardPurchaseOrders(job, workOrderRows);
    const recentWorkOrderRows = workOrderRows.slice().sort((a, b) =>
        getDashboardRecordSortTime(b.work_order_date || b.created_at) - getDashboardRecordSortTime(a.work_order_date || a.created_at)
    ).slice(0, 10);
    const recentPurchaseOrderRows = purchaseOrderRows.slice(0, 10);
    const timesheetRows = getDashboardTimesheetRows(job);
    const manualWorkOrderLabourRows = getDashboardManualWorkOrderLabourRows(job, workOrderRows);
    const labourHourRows = timesheetRows.concat(manualWorkOrderLabourRows);
    const dailyRows = getDashboardDailyReports(job);
    const inspectionRows = getDashboardInspections(job);
    const equipmentRows = getDashboardEquipmentRows(workOrderRows);
    const totalHours = sumRows(labourHourRows, (row) => row.hours);
    const employees = new Set(labourHourRows.map((row) => normalizeWorkerName(row.worker)).filter(Boolean));
    const weekRows = groupTotals(labourHourRows, (row) => row.week, (row) => row.hours)
        .sort((a, b) => String(a.label).localeCompare(String(b.label)))
        .slice(-8)
        .map((row) => ({ label: formatDashboardWeekLabel(row.label), value: row.value }));
    const employeeRows = groupTotals(labourHourRows, (row) => row.worker || "Unknown", (row) => row.hours).slice(0, 8);
    const thisMonth = new Date();
    const monthRows = labourHourRows.filter((row) => {
        const date = parseDashboardDate(row.date);
        return date && date.getFullYear() === thisMonth.getFullYear() && date.getMonth() === thisMonth.getMonth();
    });
    const topMonthRows = groupTotals(monthRows, (row) => row.worker || "Unknown", (row) => row.hours).slice(0, 5);
    const jobTypeRows = groupTotals(labourHourRows, () => job.job_type || "Unspecified", (row) => row.hours);
    const archivedJobs = getArchivedDashboardJobs();
    const documentHref = getJobDocumentHref(job);
    const documentLabel = job.document_link_label || "Open Documents";

    container.innerHTML = `
        <div class="job-dashboard-shell">
            <section class="job-dashboard-hero">
                <div class="job-dashboard-title">
                    <h3>${escapeHtml([job.job_number, job.job_name].filter(Boolean).join(" - "))}</h3>
                    <span class="job-status-pill ${job.active ? "" : "inactive"}">${job.active ? "Active" : "Inactive"}</span>
                </div>
                <div class="job-info-grid">
                    <div class="job-info-item"><span>Customer</span><strong>${escapeHtml(job.customer || "Not added")}</strong></div>
                    <div class="job-info-item"><span>Job Type</span><strong>${escapeHtml(job.job_type || "Not set")}</strong></div>
                    <div class="job-info-item"><span>Address</span><strong>${escapeHtml(job.address || "Not added")}</strong></div>
                    <div class="job-info-item"><span>Project Manager</span><strong>${escapeHtml(job.project_manager || "Not added")}</strong></div>
                    <div class="job-info-item"><span>Start Date</span><strong>${escapeHtml(job.start_date ? formatDate(job.start_date) : "Not added")}</strong></div>
                    <div class="job-info-item"><span>Target End Date</span><strong>${escapeHtml(job.target_end_date ? formatDate(job.target_end_date) : "Not added")}</strong></div>
                    <div class="job-info-item"><span>Documents / Drawings</span><strong>${documentHref ? '<a href="' + escapeHtml(documentHref) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(documentLabel) + '</a>' : "Not added"}</strong></div>
                </div>
                <details class="job-dashboard-edit">
                    <summary>Edit Job Info</summary>
                    <div class="job-dashboard-edit-body">
                        <div class="job-dashboard-edit-grid">
                            <div>
                                <label>Customer</label>
                                <input id="jobDashboardCustomer" value="${escapeHtml(job.customer || "")}">
                            </div>
                            <div>
                                <label>Job Type</label>
                                <select id="jobDashboardJobType">
                                    <option value="">Not set</option>
                                    <option value="T&M"${String(job.job_type || "") === "T&M" ? " selected" : ""}>T&M</option>
                                    <option value="Contract"${String(job.job_type || "").toLowerCase() === "contract" ? " selected" : ""}>Contract</option>
                                </select>
                            </div>
                            <div>
                                <label>Project Manager</label>
                                <input id="jobDashboardProjectManager" value="${escapeHtml(job.project_manager || "")}">
                            </div>
                            <div>
                                <label>Start Date</label>
                                <input id="jobDashboardStartDate" type="date" value="${escapeHtml(job.start_date || "")}">
                            </div>
                            <div>
                                <label>Target End Date</label>
                                <input id="jobDashboardTargetEndDate" type="date" value="${escapeHtml(job.target_end_date || "")}">
                            </div>
                            <div>
                                <label>Document Link Label</label>
                                <input id="jobDashboardDocumentLinkLabel" value="${escapeHtml(job.document_link_label || "")}" placeholder="Drawings, Site Docs, Specs">
                            </div>
                            <div class="full">
                                <label>OneDrive / Document Link</label>
                                <input id="jobDashboardDocumentLink" type="url" value="${escapeHtml(job.document_link || "")}" placeholder="https://...">
                                <div class="small">Paste the OneDrive sharing link for drawings or job documents.</div>
                            </div>
                            <div class="full">
                                <label>Address</label>
                                <textarea id="jobDashboardAddress">${escapeHtml(job.address || "")}</textarea>
                            </div>
                        </div>
                        <div class="actions" style="margin-top:12px;">
                            <button type="button" onclick="saveJobDashboardInfo('${escapeHtml(job.id)}')">Save Job Info</button>
                        </div>
                        <div id="jobDashboardEditStatus" class="small" style="margin-top:8px;"></div>
                    </div>
                </details>
            </section>

            <section class="job-dashboard-metrics">
                ${renderJobDashboardMetric("Total Hours", totalHours.toFixed(2), manualWorkOrderLabourRows.length ? "Timesheets + manual WO labour" : "Submitted labour hours")}
                ${renderJobDashboardMetric("Employees on Job", employees.size, "Workers with logged hours")}
                ${renderJobDashboardMetric("Work Orders", workOrderRows.length, "Saved Work Orders")}
                ${renderJobDashboardMetric("Purchase Orders", purchaseOrderRows.length, "Digital and Work Order POs")}
                ${renderJobDashboardMetric("Daily Reports", dailyRows.length, "Submitted reports")}
                ${renderJobDashboardMetric("Inspections", inspectionRows.length, "Matching records")}
                ${renderJobDashboardMetric("Equipment Used", equipmentRows.length, "From Work Orders")}
            </section>

            <section class="job-dashboard-grid">
                <div class="job-dashboard-panel">
                    <h3>Hours by Week</h3>
                    ${renderJobBars(weekRows, "No labour hours found for this job yet.")}
                </div>
                <div class="job-dashboard-panel">
                    <h3>Hours by Employee</h3>
                    ${renderJobBars(employeeRows, "No employee hours found for this job yet.")}
                </div>
                <div class="job-dashboard-panel">
                    <h3>Hours by Job Type</h3>
                    ${renderJobBars(jobTypeRows, "No job type hours found.")}
                </div>
                <div class="job-dashboard-panel">
                    <h3>Top Employees This Month</h3>
                    ${renderJobBars(topMonthRows, "No hours logged this month.")}
                </div>
            </section>

            <section class="job-dashboard-grid">
                <div class="job-dashboard-panel">
                    <h3>Recent Work Orders</h3>
                    ${renderDashboardTable(["WO Number", "Date Used", "Status"], recentWorkOrderRows, (row) => [
                        row.wo_number || "",
                        row.work_order_date ? formatDate(row.work_order_date) : "",
                        getAdminWorkOrderStatusText(row)
                    ], "No Work Orders found for this job.", (row) => `
                        <button type="button" class="job-dashboard-inline-view secondary jgc-button jgc-button--secondary" onclick="openJobDashboardWorkOrder('${escapeHtml(row.id)}')">View</button>
                    `)}
                </div>
                <div class="job-dashboard-panel">
                    <h3>Recent Purchase Orders</h3>
                    ${renderDashboardTable(["PO Number", "Date Used", "Status"], recentPurchaseOrderRows, (row) => [
                        formatAdminGlobalSearchPoNumber(row.poNumber),
                        row.date ? formatDate(row.date) : "",
                        row.status || ""
                    ], "No Purchase Orders found for this job.", (row) => `
                        <button type="button" class="job-dashboard-inline-view secondary jgc-button jgc-button--secondary" onclick="openJobDashboardPurchaseOrder('${escapeHtml(row.source)}', '${escapeHtml(row.id)}')">View</button>
                    `)}
                </div>
                <div class="job-dashboard-panel">
                    <h3>Recent Daily Reports</h3>
                    ${renderDashboardTable(["Date", "Project", "Submitted By"], dailyRows.slice(0, 8), (row) => [row.report_date ? formatDate(row.report_date) : "", row.project || "", row.worker_display_name || row.worker_name || ""], "No Daily Reports found for this job.")}
                </div>
                <div class="job-dashboard-panel">
                    <h3>Recent Inspections</h3>
                    ${renderDashboardTable(["Type", "Date", "Completed By"], inspectionRows.slice(0, 8), (row) => [row.inspection_type || "", row.inspection_date ? formatDate(row.inspection_date) : formatDate(row.created_at), row.worker_display_name || row.worker_name || ""], "No inspections found for this job.")}
                </div>
                <div class="job-dashboard-panel">
                    <h3>Equipment on Job</h3>
                    ${renderDashboardTable(["Equipment", "Identification", "Status"], equipmentRows.slice(0, 8), (row) => [row.name || "", row.identification || "", row.status || ""], "No equipment found from Work Orders yet.")}
                </div>
            </section>
            <details class="job-dashboard-panel">
                <summary style="cursor:pointer;color:#37f05a;font-weight:900;">Archived Jobs</summary>
                <div style="margin-top:12px;">
                    ${renderDashboardTable(["Job Number", "Job Name", "Project Manager", "Removed", "Archive Until"], archivedJobs, (row) => [
                        row.job_number || "",
                        row.job_name || "",
                        row.project_manager || "",
                        row.removed_from_import_at ? formatDate(row.removed_from_import_at) : "",
                        row.archive_until ? formatDate(row.archive_until) : ""
                    ], "No archived jobs are currently being retained.")}
                </div>
            </details>
        </div>
    `;
}

function getJobsSummary() {
    const totalJobs = jobs.length;
    const activeJobs = jobs.filter((job) => Boolean(job.active)).length;
    const inactiveJobs = totalJobs - activeJobs;
    const lastImport = jobs.reduce((latest, job) => {
        const updated = job.updated_at ? new Date(job.updated_at).getTime() : 0;
        return updated > latest ? updated : latest;
    }, 0);

    return {
        totalJobs,
        activeJobs,
        inactiveJobs,
        lastImport
    };
}

function renderJobsManagement() {
    const summaryPanel = document.getElementById("jobsSummary");
    const list = document.getElementById("jobsList");

    if (!summaryPanel || !list) {
        return;
    }

    const summary = getJobsSummary();
    summaryPanel.innerHTML = `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr><th>Total Jobs</th><th>Active Jobs</th><th>Inactive Jobs</th><th>Last Import Date</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <td>${summary.totalJobs}</td>
                        <td>${summary.activeJobs}</td>
                        <td>${summary.inactiveJobs}</td>
                        <td>${summary.lastImport ? escapeHtml(formatDate(new Date(summary.lastImport).toISOString())) : "No imports yet"}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;

    if (!jobs.length) {
        list.textContent = "No jobs imported yet.";
        return;
    }

    const rows = jobs.map((job) => `
        <tr>
            <td>${escapeHtml(job.job_number || "")}</td>
            <td>${escapeHtml(job.job_name || "")}</td>
            <td>${escapeHtml(job.job_type || "")}</td>
            <td>${escapeHtml(job.project_manager || "")}</td>
            <td>${getJobDocumentHref(job) ? '<a href="' + escapeHtml(getJobDocumentHref(job)) + '" target="_blank" rel="noopener noreferrer">Open</a>' : ""}</td>
            <td>
                <label class="job-status-toggle">
                    <input type="checkbox" ${job.active ? "checked" : ""} onchange="toggleJobActive('${escapeHtml(job.id)}', this.checked)">
                    <span>${job.active ? "Active" : "Inactive"}</span>
                </label>
            </td>
            <td>${escapeHtml(formatDate(job.updated_at))}</td>
        </tr>
    `).join("");

    list.innerHTML = `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr><th>Job Number</th><th>Job Name</th><th>Contract / T&M</th><th>Project Manager</th><th>Documents</th><th>Status</th><th>Updated</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

async function toggleJobActive(jobId, isActive) {
    const job = jobs.find((item) => String(item.id) === String(jobId));
    const status = document.getElementById("jobsImportStatus");

    if (!job) {
        alert("Job could not be found.");
        renderJobsManagement();
        return;
    }

    if (!isActive && !confirm("Mark " + (job.job_number || job.job_name || "this job") + " inactive? It will be hidden from the employee job list.")) {
        renderJobsManagement();
        return;
    }

    if (status) {
        status.textContent = isActive ? "Reactivating job..." : "Marking job inactive...";
    }

    const payload = {
        active: isActive,
        removed_from_import_at: isActive ? null : new Date().toISOString(),
        archive_until: isActive ? null : getArchiveCutoffDate(),
        updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseClient
        .from("jobs")
        .update(payload)
        .eq("id", jobId)
        .select()
        .single();

    if (error) {
        if (status) {
            status.textContent = "Job status could not be updated: " + error.message;
        }
        renderJobsManagement();
        return;
    }

    jobs = jobs.map((item) => String(item.id) === String(jobId) ? { ...item, ...(data || payload) } : item);
    renderJobDashboardOptions();
    renderJobDashboard();
    renderJobsManagement();

    if (status) {
        status.textContent = "Job status updated.";
    }
}

async function loadJobsManagement() {
    const status = document.getElementById("jobsImportStatus");

    if (status) {
        status.textContent = "Refreshing jobs...";
    }

    const { data, error } = await supabaseClient
        .from("jobs")
        .select("*")
        .order("job_number", { ascending: true });

    if (error) {
        if (status) {
            status.textContent = "Jobs could not be loaded.";
        }
        return;
    }

    jobs = data || [];
    renderJobDashboardOptions();
    renderJobDashboard();
    renderJobsManagement();

    if (status) {
        status.textContent = "Jobs refreshed.";
    }
}

async function importJobsFromExcel() {
    const fileInput = document.getElementById("jobsExcelFile");
    const status = document.getElementById("jobsImportStatus");
    const file = fileInput.files[0];

    if (!file) {
        alert("Please choose an Excel file first.");
        return;
    }

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
        alert("Please upload an .xlsx file.");
        return;
    }

    if (!window.ExcelJS) {
        status.textContent = "Excel reader could not be loaded. Please refresh and try again.";
        return;
    }

    status.textContent = "Reading Excel file...";

    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());
        const worksheets = workbook.worksheets.filter((worksheet) => isJobImportSheet(worksheet.name));
        const sheetNames = worksheets.map((worksheet) => worksheet.name);

        if (!sheetNames.length) {
            status.textContent = "No 2025-present tabs found in this Excel file.";
            return;
        }

        const jobMap = new Map();
        let highlightedInactive = 0;
        let skippedCancelled = 0;
        let skippedIncomplete = 0;
        const jobNameColumns = [0, 1, 2, 3, 4];
        const jobNumberColumn = 5;
        const projectManagerColumn = 7;
        const jobTypeColumn = 10;
        const columnsToCheckForHighlight = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        worksheets.forEach((worksheet) => {
            worksheet.eachRow({ includeEmpty: false }, (row) => {
                if (isExcelJsCancelledRow(row, columnsToCheckForHighlight)) {
                    skippedCancelled++;
                    return;
                }

                const isHighlighted = isExcelJsHighlightedRow(row, columnsToCheckForHighlight);

                const jobNumber = normalizeExcelValue(row.getCell(jobNumberColumn + 1).value);
                const jobName = getExcelJobName(row, jobNameColumns);
                const projectManager = normalizeExcelValue(row.getCell(projectManagerColumn + 1).value);
                const jobType = normalizeExcelValue(row.getCell(jobTypeColumn + 1).value);

                if (!jobNumber || !jobName) {
                    skippedIncomplete++;
                    return;
                }

                const normalizedNumber = normalizeExcelHeader(jobNumber);
                const normalizedName = normalizeExcelHeader(jobName);

                if (["jobno", "jobnumber"].includes(normalizedNumber) || normalizedName === "jobname") {
                    skippedIncomplete++;
                    return;
                }

                if (isHighlighted) {
                    highlightedInactive++;
                }

                jobMap.set(jobNumber, {
                    job_number: jobNumber,
                    job_name: jobName,
                    job_type: jobType,
                    project_manager: projectManager,
                    active: !isHighlighted,
                    removed_from_import_at: null,
                    archive_until: null,
                    updated_at: new Date().toISOString()
                });
            });
        });

        const records = Array.from(jobMap.values()).sort((a, b) => a.job_number.localeCompare(b.job_number, undefined, { numeric: true }));

        if (!records.length) {
            status.textContent = "No valid jobs found. Check that job names are in columns A-E and job numbers are in column F.";
            return;
        }

        const activeJobCount = records.filter((record) => record.active).length;
        const inactiveJobCount = records.length - activeJobCount;
        status.textContent = "Importing " + records.length + " jobs (" + activeJobCount + " active, " + inactiveJobCount + " inactive) from " + sheetNames.length + " tab" + (sheetNames.length === 1 ? "" : "s") + "...";

        const { error } = await supabaseClient
            .from("jobs")
            .upsert(records, { onConflict: "job_number" });

        if (error) {
            status.textContent = "Job import failed: " + error.message;
            return;
        }

        const importedJobNumbers = new Set(records.map((record) => record.job_number));
        const { data: existingJobs, error: existingError } = await supabaseClient
            .from("jobs")
            .select("job_number, active");

        if (existingError) {
            status.textContent = "Jobs imported, but old jobs could not be checked for inactive status.";
            await loadJobsManagement();
            return;
        }

        const removedJobNumbers = (existingJobs || [])
            .filter((job) => job.active !== false)
            .map((job) => job.job_number)
            .filter((jobNumber) => !importedJobNumbers.has(jobNumber));

        if (removedJobNumbers.length) {
            const { error: removeError } = await supabaseClient
                .from("jobs")
                .update({
                    active: false,
                    removed_from_import_at: new Date().toISOString(),
                    archive_until: getArchiveCutoffDate(),
                    updated_at: new Date().toISOString()
                })
                .in("job_number", removedJobNumbers);

            if (removeError) {
                status.textContent = "Jobs imported, but removed jobs could not be archived: " + removeError.message;
                await loadJobsManagement();
                return;
            }
        }

        fileInput.value = "";
        status.textContent = "Import complete: " + records.length + " jobs imported from " + sheetNames.join(", ") + " (" + activeJobCount + " active, " + inactiveJobCount + " inactive). " + skippedCancelled + " red row" + (skippedCancelled === 1 ? " was" : "s were") + " skipped as cancelled. " + highlightedInactive + " other highlighted row" + (highlightedInactive === 1 ? " was" : "s were") + " imported as inactive. " + removedJobNumbers.length + " jobs missing from the workbook were archived for 2 months. " + skippedIncomplete + " incomplete rows skipped.";
        await loadJobsManagement();
    } catch (error) {
        status.textContent = "Could not import this Excel file.";
        console.warn("Job import failed.", error);
    }
}

function clearJobsExcelFile() {
    const fileInput = document.getElementById("jobsExcelFile");
    const status = document.getElementById("jobsImportStatus");

    if (fileInput) {
        fileInput.value = "";
    }

    if (status) {
        status.textContent = "Selected Excel file removed.";
    }
}

async function deleteImportedJobs() {
    const fileInput = document.getElementById("jobsExcelFile");
    const status = document.getElementById("jobsImportStatus");

    const confirmed = confirm("Delete all imported jobs from the portal? This will clear the jobs dropdown until a new Excel file is imported.");

    if (!confirmed) {
        return;
    }

    if (status) {
        status.textContent = "Deleting imported jobs...";
    }

    const { error } = await supabaseClient
        .from("jobs")
        .delete()
        .not("id", "is", null);

    if (error) {
        if (status) {
            status.textContent = "Imported jobs could not be deleted: " + error.message;
        }
        return;
    }

    jobs = [];

    if (fileInput) {
        fileInput.value = "";
    }

    renderJobsManagement();
    renderJobDashboardOptions();
    renderJobDashboard();

    if (status) {
        status.textContent = "All imported jobs were deleted.";
    }
}
