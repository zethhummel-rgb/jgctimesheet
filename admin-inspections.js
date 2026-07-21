function renderAdminInspectionTable(rows) {
    if (!rows.length) {
        return '<p class="jgc-archive__empty">No inspection reports in this section.</p>';
    }

    return `
        <div class="table-wrap jgc-table-wrap">
            <table class="jgc-table">
                <thead>
                    <tr><th>Date</th><th>Source</th><th>Type</th><th>Completed By</th><th>Asset</th><th>Details</th><th>Saved</th><th>Actions</th></tr>
                </thead>
                <tbody>
                    ${rows.map((inspection) => `
                        <tr>
                            <td>${escapeHtml(formatDate(inspection.date))}</td>
                            <td>${escapeHtml(inspection.source)}</td>
                            <td>${escapeHtml(inspection.type || "")}</td>
                            <td>${escapeHtml(inspection.completedBy || "")}</td>
                            <td>${escapeHtml(inspection.asset || "")}</td>
                            <td>${escapeHtml(inspection.details || "")}</td>
                            <td>${escapeHtml(formatDate(inspection.saved))}</td>
                            <td>
                                <div class="actions jgc-table-actions">
                                    <button type="button" class="jgc-button" onclick="viewAdminInspection('${escapeHtml(inspection.kind)}', '${escapeHtml(inspection.id)}')">View</button>
                                    <button type="button" class="delete-button jgc-button jgc-button--danger" onclick="deleteAdminInspection('${escapeHtml(inspection.kind)}', '${escapeHtml(inspection.id)}')">Delete</button>
                                </div>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

const ADMIN_INSPECTION_CATEGORY_ORDER = [
    "vehicle",
    "aerial-lifts",
    "fork-lifts",
    "telehandlers",
    "harnesses",
    "equipment",
    "other"
];

const ADMIN_PERMIT_CATEGORY_ORDER = [
    "hot-work-permits",
    "confined-space-permits",
    "excavation-permits",
    "other-permits"
];

const ADMIN_INSPECTION_CATEGORY_LABELS = {
    vehicle: "Vehicle / Trailer",
    "aerial-lifts": "Aerial Lifts",
    "fork-lifts": "Fork Lifts",
    telehandlers: "Telehandlers",
    harnesses: "Harnesses",
    equipment: "Equipment",
    other: "Other Inspections",
    "hot-work-permits": "Hot Work Permits",
    "confined-space-permits": "Confined Space Permits",
    "excavation-permits": "Excavation Permits",
    "other-permits": "Other Permits"
};

let adminInspectionLazyCategoryRows = new Map();

function getAdminInspectionCategoryKey(inspection) {
    if (inspection.kind === "vehicle") {
        return "vehicle";
    }

    const record = inspection.record || {};
    const categoryText = [
        inspection.type,
        inspection.source,
        inspection.asset,
        record.equipment_type,
        record.title,
        record.form_data && record.form_data.template_key
    ].filter(Boolean).join(" ").toLowerCase();

    if (["jsa", "job safety analysis", "toolbox", "daily site report", "near miss", "accident", "employee injury"].some((term) => categoryText.includes(term))) {
        return "report";
    }

    if (categoryText.includes("hot work")) {
        return "hot-work-permits";
    }

    if (categoryText.includes("confined space")) {
        return "confined-space-permits";
    }

    if (categoryText.includes("excavation")) {
        return "excavation-permits";
    }

    if (categoryText.includes("permit")) {
        return "other-permits";
    }

    if (categoryText.includes("fork lift") || categoryText.includes("forklift")) {
        return "fork-lifts";
    }

    if (categoryText.includes("tele handler") || categoryText.includes("telehandler")) {
        return "telehandlers";
    }

    if (categoryText.includes("harness")) {
        return "harnesses";
    }

    if (["aerial", "scissor", "boom lift", "man lift"].some((term) => categoryText.includes(term))) {
        return "aerial-lifts";
    }

    if (categoryText.includes("equipment")) {
        return "equipment";
    }

    return "other";
}

function renderAdminInspectionCategoryBody(rows, openArchive) {
    const archiveDays = window.JgcAdminHousekeeping?.inspectionArchiveDays || 60;
    const olderInspections = rows.filter((inspection) =>
        window.JgcAdminHousekeeping?.isOlderThanDays(inspection.date || inspection.saved, archiveDays)
    );
    const olderIds = new Set(olderInspections.map((inspection) => inspection.kind + ":" + inspection.id));
    const recentInspections = rows.filter((inspection) => !olderIds.has(inspection.kind + ":" + inspection.id));
    const recentMarkup = recentInspections.length
        ? renderAdminInspectionTable(recentInspections)
        : '<p class="jgc-archive__empty">No inspections from the last ' + archiveDays + ' days in this category.</p>';
    const archiveMarkup = olderInspections.length ? `
        <details class="jgc-archive"${openArchive ? " open" : ""}>
            <summary>
                <span class="jgc-archive__title">Older Inspections</span>
                <span class="jgc-archive__count">${olderInspections.length} older than ${archiveDays} days</span>
            </summary>
            <div class="jgc-archive__body">${renderAdminInspectionTable(olderInspections)}</div>
        </details>
    ` : "";

    return recentMarkup + archiveMarkup;
}

function loadAdminInspectionCategory(details) {
    if (!details || !details.open) {
        return;
    }

    const body = details.querySelector("[data-inspection-lazy-body]");

    if (!body || body.dataset.loaded === "true") {
        return;
    }

    const category = adminInspectionLazyCategoryRows.get(details.dataset.inspectionCategory);
    body.innerHTML = category
        ? renderAdminInspectionCategoryBody(category.rows, category.openArchive)
        : '<p class="jgc-archive__empty">No inspection reports in this category.</p>';
    body.dataset.loaded = "true";
}

function renderAdminInspectionCategories(rows, openCategoryKeys, openFilteredCategories, safetySubtab) {
    const groupedRows = new Map();
    const categoryOrder = safetySubtab === "permits"
        ? ADMIN_PERMIT_CATEGORY_ORDER
        : ADMIN_INSPECTION_CATEGORY_ORDER;

    rows.forEach((inspection) => {
        const categoryKey = getAdminInspectionCategoryKey(inspection);
        const categoryRows = groupedRows.get(categoryKey) || [];
        categoryRows.push(inspection);
        groupedRows.set(categoryKey, categoryRows);
    });

    const groups = categoryOrder
        .filter((categoryKey) => groupedRows.has(categoryKey))
        .map((categoryKey) => ({
            key: categoryKey,
            label: ADMIN_INSPECTION_CATEGORY_LABELS[categoryKey],
            rows: groupedRows.get(categoryKey)
        }));

    adminInspectionLazyCategoryRows = new Map(groups.map((group) => [group.key, {
        rows: group.rows,
        openArchive: openFilteredCategories
    }]));

    return `<div class="jgc-archive-list">${groups.map((group) => {
        const isOpen = openFilteredCategories || openCategoryKeys.has(group.key);
        const recordNoun = safetySubtab === "permits" ? "permit" : "inspection";
        const countLabel = group.rows.length + " " + recordNoun + (group.rows.length === 1 ? "" : "s");

        return `
            <details class="jgc-archive" data-inspection-category="${escapeHtml(group.key)}"${isOpen ? " open" : ""} ontoggle="loadAdminInspectionCategory(this)">
                <summary>
                    <span class="jgc-archive__title">${escapeHtml(group.label)}</span>
                    <span class="jgc-archive__count">${escapeHtml(countLabel)}</span>
                </summary>
                <div class="jgc-archive__body" data-inspection-lazy-body data-loaded="${isOpen ? "true" : "false"}">${isOpen ? renderAdminInspectionCategoryBody(group.rows, openFilteredCategories) : ""}</div>
            </details>
        `;
    }).join("")}</div>`;
}

function renderInspections(safetySubtab) {
    const list = document.getElementById("inspectionsList");
    const workerInput = document.getElementById("inspectionWorkerFilter");
    const typeInput = document.getElementById("inspectionTypeFilter");
    const activeSubtab = safetySubtab || (typeof getActiveSafetyRecordsSubtab === "function"
        ? getActiveSafetyRecordsSubtab()
        : "inspections");

    if (!list) {
        return;
    }

    const safetySubtabLoading = typeof safetyRecordsSubtabDataLoading === "object"
        && Boolean(safetyRecordsSubtabDataLoading[activeSubtab]);
    if ((adminTabDataLoading.safetyRecords && !adminTabDataLoaded.has("safetyRecords")) || safetySubtabLoading) {
        list.textContent = activeSubtab === "permits" ? "Loading permits..." : "Loading inspections...";
        return;
    }

    const workerFilter = workerInput ? workerInput.value.trim().toLowerCase() : "";
    const typeFilter = typeInput ? typeInput.value.trim().toLowerCase() : "";
    const standardInspectionRows = (Array.isArray(inspections) ? inspections : []).map((inspection) => ({
        id: inspection.id,
        kind: "standard",
        source: "Inspection",
        date: inspection.inspection_date,
        type: inspection.inspection_type,
        completedBy: inspection.worker_display_name || inspection.worker_name,
        asset: inspection.equipment_name || inspection.equipment_identification || "",
        details: inspection.summary && typeof inspection.summary === "object"
            ? [
                inspection.summary.equipment_name,
                inspection.summary.equipment_identification,
                inspection.summary.failed_count ? inspection.summary.failed_count + " failed" : ""
            ].filter(Boolean).join(" | ")
            : "",
        saved: inspection.created_at,
        record: inspection
    }));
    const vehicleInspectionRows = (Array.isArray(vehicleInspections) ? vehicleInspections : []).map((inspection) => ({
        id: inspection.id,
        kind: "vehicle",
        source: "Vehicle / Trailer",
        date: inspection.inspection_date,
        type: inspection.inspection_type,
        completedBy: inspection.driver_name,
        asset: [
            inspection.vehicle_license_plate || inspection.vehicle_name,
            inspection.trailer_1_license_plate ? "Trailer 1: " + inspection.trailer_1_license_plate : "",
            inspection.trailer_2_license_plate ? "Trailer 2: " + inspection.trailer_2_license_plate : ""
        ].filter(Boolean).join(" | "),
        details: inspection.defects_found
            ? (inspection.major_defects_found ? "Major defects found" : "Minor defects found")
            : "No defects reported",
        saved: inspection.created_at,
        record: inspection
    }));
    const inspectionRows = standardInspectionRows.concat(vehicleInspectionRows)
        .sort((a, b) => String(b.saved || b.date || "").localeCompare(String(a.saved || a.date || "")));
    const allowedCategories = new Set(activeSubtab === "permits"
        ? ADMIN_PERMIT_CATEGORY_ORDER
        : ADMIN_INSPECTION_CATEGORY_ORDER);
    const filtered = inspectionRows.filter((inspection) => allowedCategories.has(getAdminInspectionCategoryKey(inspection))).filter((inspection) => {
        const worker = String(inspection.completedBy || "").toLowerCase();
        const type = [inspection.type, inspection.asset, inspection.source, inspection.details].join(" ").toLowerCase();
        return (!workerFilter || worker.includes(workerFilter)) && (!typeFilter || type.includes(typeFilter));
    });

    if (!filtered.length) {
        list.textContent = activeSubtab === "permits" ? "No permit records found." : "No inspection reports found.";
        return;
    }

    const openCategoryKeys = new Set(Array.from(list.querySelectorAll("details[data-inspection-category][open]"))
        .map((details) => details.dataset.inspectionCategory));
    const filtersActive = Boolean(workerFilter || typeFilter);
    list.innerHTML = renderAdminInspectionCategories(filtered, openCategoryKeys, filtersActive, activeSubtab);
}

function getAdminInspectionRecord(kind, id) {
    const source = kind === "vehicle" ? vehicleInspections : inspections;
    return (Array.isArray(source) ? source : []).find((record) => String(record.id) === String(id)) || null;
}

function closeAdminInspectionView() {
    const panel = document.getElementById("adminInspectionViewPanel");
    if (panel) {
        panel.hidden = true;
        panel.innerHTML = "";
    }
}

function getAdminInspectionFields(record) {
    return record && record.form_data && Array.isArray(record.form_data.fields)
        ? record.form_data.fields
        : [];
}

function getAdminInspectionRows(record) {
    return record && record.form_data && Array.isArray(record.form_data.rows)
        ? record.form_data.rows
        : [];
}

function normalizeAdminInspectionResultLabel(value) {
    const result = String(value || "").trim();
    const lower = result.toLowerCase();

    if (lower === "na") {
        return "N/A";
    }

    if (lower === "pass") {
        return "Pass";
    }

    if (lower === "defect") {
        return "Defect";
    }

    return result;
}

function getAdminReadableChecklistRows(record) {
    const rows = getAdminInspectionRows(record);
    const readableRows = [];

    rows.forEach((row) => {
        const cells = row.cells || [];
        const first = String(cells[0] || "").trim();

        if (/^\d+$/.test(first) && cells[1]) {
            readableRows.push({
                number: first,
                item: cells[1] || "",
                result: cells.slice(2).find((cell) => String(cell || "").trim()) || ""
            });
            return;
        }

        if (/^\d+\./.test(first)) {
            readableRows.push({
                number: first.replace(/\..*$/, ""),
                item: first,
                result: cells.slice(1, 4).find((cell) => String(cell || "").trim()) || ""
            });

            if (/^\d+\./.test(String(cells[4] || "").trim())) {
                readableRows.push({
                    number: String(cells[4] || "").replace(/\..*$/, ""),
                    item: cells[4] || "",
                    result: cells.slice(5, 8).find((cell) => String(cell || "").trim()) || ""
                });
            }
            return;
        }

        const joined = cells.filter((cell) => String(cell || "").trim()).join(" | ");
        if (joined) {
            readableRows.push({
                number: "",
                item: joined,
                result: ""
            });
        }
    });

    return readableRows;
}

function getAdminVehicleInspectionRows(record) {
    const sections = record && record.form_data && Array.isArray(record.form_data.sections)
        ? record.form_data.sections
        : [];

    return sections.flatMap((section) => (section.items || []).map((item) => ({
        section: section.section || "",
        number: item.code || "",
        item: item.label || "",
        result: normalizeAdminInspectionResultLabel(item.result),
        severity: item.severity || "",
        description: item.description || ""
    })));
}

function getAdminInspectionEquipmentLabel(record) {
    const formData = record && record.form_data && typeof record.form_data === "object" ? record.form_data : {};
    const equipment = formData.equipment && typeof formData.equipment === "object" ? formData.equipment : {};
    const parts = [
        record && record.equipment_identification,
        record && record.equipment_name,
        equipment.identification_number,
        equipment.name
    ].map((value) => String(value || "").trim()).filter(Boolean);

    return [...new Set(parts)].join(" - ");
}

function renderAdminInspectionFieldGrid(fields) {
    return fields.length ? `
        <div class="announcement-grid" style="margin-top:10px;">
            ${fields.map((field) => `
                <div>
                    <label>${escapeHtml(field.label || "")}</label>
                    <input type="text" value="${escapeHtml(field.value || "")}" readonly>
                </div>
            `).join("")}
        </div>
    ` : '<div class="small">No submitted field details were saved for this inspection.</div>';
}

function renderAdminInspectionRowsTable(rows, emptyText) {
    if (!rows.length) {
        return `<div class="small">${escapeHtml(emptyText)}</div>`;
    }

    return `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr><th>Section</th><th>#</th><th>Inspection Item</th><th>Result</th><th>Severity</th><th>Description</th></tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td>${escapeHtml(row.section || "")}</td>
                            <td>${escapeHtml(row.number || "")}</td>
                            <td>${escapeHtml(row.item || "")}</td>
                            <td>${escapeHtml(normalizeAdminInspectionResultLabel(row.result))}</td>
                            <td>${escapeHtml(row.severity || "")}</td>
                            <td>${escapeHtml(row.description || "")}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function getAdminVehicleInspectionSections(record) {
    return record && record.form_data && Array.isArray(record.form_data.sections)
        ? record.form_data.sections
        : [];
}

function getAdminVehicleInspectionStatus(record) {
    if (!record) {
        return "";
    }

    if (record.defects_found) {
        return record.major_defects_found ? "Major defects found" : "Minor defects found";
    }

    return "No defects reported";
}

function getAdminVehicleRepairNotes(record) {
    const formData = record && record.form_data && typeof record.form_data === "object" ? record.form_data : {};
    return record && record.repair_notes ? record.repair_notes : (formData.repair_notes || "");
}

function getAdminInspectionResultClass(value) {
    const result = String(value || "").trim().toLowerCase();

    if (result === "pass" || result === "p") {
        return "pass";
    }

    if (result === "defect" || result === "fail" || result === "failed" || result === "f") {
        return "defect";
    }

    if (result === "na" || result === "n/a") {
        return "na";
    }

    return "";
}

function renderAdminVehicleInspectionMeta(record) {
    const trailer1 = record.trailer_1_license_plate || record.trailer_1_name || "";
    const trailer2 = record.trailer_2_license_plate || record.trailer_2_name || "";
    const meta = [
        ["Date", formatDate(record.inspection_date)],
        ["Driver / Inspector", record.driver_name || ""],
        ["Vehicle Plate", record.vehicle_license_plate || record.vehicle_name || ""],
        ["Location", record.location || ""]
    ];

    if (record.odometer) {
        meta.push(["Current KM", record.odometer]);
    }

    if (trailer1) {
        meta.push(["Trailer 1", trailer1]);
    }

    if (trailer2) {
        meta.push(["Trailer 2", trailer2]);
    }

    meta.push(["Status", getAdminVehicleInspectionStatus(record)]);

    return `
        <div class="inspection-sheet-meta">
            ${meta.map(([label, value]) => `
                <div>
                    <strong>${escapeHtml(label)}</strong>
                    <span>${escapeHtml(value || "-")}</span>
                </div>
            `).join("")}
        </div>
    `;
}

function renderAdminVehicleInspectionSections(record) {
    const sections = getAdminVehicleInspectionSections(record);

    if (!sections.length) {
        return '<div class="inspection-sheet-note"><span>No checklist answers were saved for this vehicle inspection.</span></div>';
    }

    return sections.map((section) => {
        const items = Array.isArray(section.items) ? section.items : [];

        return `
            <h3 class="inspection-sheet-section-title">${escapeHtml(section.section || "Inspection Items")}</h3>
            <div class="inspection-sheet-table-wrap">
                <table>
                    <thead>
                        <tr><th style="width:44px;">#</th><th>Item</th><th style="width:110px;">Result</th><th style="width:120px;">Severity</th><th>Description</th></tr>
                    </thead>
                    <tbody>
                        ${items.length ? items.map((item) => {
                            const result = normalizeAdminInspectionResultLabel(item.result || "");
                            const resultClass = getAdminInspectionResultClass(result);
                            return `
                                <tr>
                                    <td>${escapeHtml(item.code || "")}</td>
                                    <td>${escapeHtml(item.label || "")}</td>
                                    <td>${result ? `<span class="inspection-result-pill ${escapeHtml(resultClass)}">${escapeHtml(result)}</span>` : ""}</td>
                                    <td>${escapeHtml(item.severity || "")}</td>
                                    <td>${escapeHtml(item.description || "")}</td>
                                </tr>
                            `;
                        }).join("") : '<tr><td colspan="5">No items saved in this section.</td></tr>'}
                    </tbody>
                </table>
            </div>
        `;
    }).join("");
}

function renderAdminVehicleInspectionSheet(record) {
    const notes = getAdminVehicleRepairNotes(record);

    return `
        <div class="inspection-sheet">
            <img class="inspection-sheet-logo" src="logo.webp" alt="John Gordon Construction logo">
            <h2 class="inspection-sheet-title">${escapeHtml(record.inspection_type || "Vehicle Inspection")}</h2>
            ${renderAdminVehicleInspectionMeta(record)}
            ${renderAdminVehicleInspectionSections(record)}
            ${notes ? `
                <div class="inspection-sheet-note">
                    <strong>Repair / Notes</strong>
                    <span>${escapeHtml(notes)}</span>
                </div>
            ` : ""}
        </div>
    `;
}

function renderAdminVehicleInspectionPrintDocument(record) {
    return `
        <!doctype html>
        <html>
        <head>
            <title>${escapeHtml(record.inspection_type || "Vehicle Inspection")}</title>
            <style>
                @page { size: letter; margin: 16mm; }
                body { margin: 0; padding: 0; font-family: Arial, sans-serif; color: #1b241e; background: #ffffff; }
                .inspection-sheet { padding: 0; background: #ffffff; color: #1b241e; }
                .inspection-sheet, .inspection-sheet * { box-sizing: border-box; }
                .inspection-sheet-logo { width: 220px; max-width: 70%; height: auto; display: block; margin: 0 auto 18px; }
                .inspection-sheet-title { margin: 0 0 20px; color: #161d19; text-align: center; font-size: 26px; line-height: 1.2; }
                .inspection-sheet-meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 18px; }
                .inspection-sheet-meta div, .inspection-sheet-note { border: 1px solid #bfc9c1; background: #ffffff; padding: 8px; color: #1b241e; }
                .inspection-sheet-meta strong, .inspection-sheet-note strong { display: block; color: #1b241e; font-size: 14px; }
                .inspection-sheet-meta span, .inspection-sheet-note span { color: #1b241e; font-size: 15px; }
                .inspection-sheet-section-title { margin: 22px 0 10px; color: #161d19; font-size: 22px; line-height: 1.2; page-break-after: avoid; }
                table { width: 100%; border-collapse: collapse; margin: 0 0 18px; page-break-inside: auto; }
                tr { page-break-inside: avoid; page-break-after: auto; }
                th, td { border: 1px solid #aeb8b1; padding: 7px; color: #1b241e; background: #ffffff; font-size: 13px; text-align: left; vertical-align: top; }
                th { background: #e9f4eb; font-weight: bold; }
                .inspection-result-pill { display: inline; font-weight: bold; }
            </style>
        </head>
        <body>
            ${renderAdminVehicleInspectionSheet(record)}
        </body>
        </html>
    `;
}

function printAdminVehicleInspection(id) {
    const record = getAdminInspectionRecord("vehicle", id);

    if (!record) {
        alert("This inspection could not be found.");
        return;
    }

    const printWindow = window.open("", "_blank", "width=840,height=980");

    if (!printWindow) {
        alert("Popup blocked. Allow popups for this portal, then try Save PDF again.");
        return;
    }

    printWindow.document.write(renderAdminVehicleInspectionPrintDocument(record));
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
}

function viewAdminInspection(kind, id) {
    const record = getAdminInspectionRecord(kind, id);
    const panel = document.getElementById("adminInspectionViewPanel");

    if (!record || !panel) {
        alert("This inspection could not be found.");
        return;
    }

    panel.hidden = false;

    if (kind === "vehicle") {
        panel.innerHTML = `
            <div class="actions inspection-view-actions jgc-actions">
                <button type="button" class="download-button jgc-button" onclick="printAdminVehicleInspection('${escapeHtml(record.id)}')">Save PDF</button>
                <button type="button" class="secondary jgc-button jgc-button--secondary" onclick="closeAdminInspectionView()">Close</button>
                <button type="button" class="delete-button jgc-button jgc-button--danger" onclick="deleteAdminInspection('vehicle', '${escapeHtml(record.id)}')">Delete</button>
            </div>
            ${renderAdminVehicleInspectionSheet(record)}
        `;
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
    }

    const fields = getAdminInspectionFields(record).filter((field) => field.value);
    const rows = getAdminReadableChecklistRows(record).map((row) => ({
        section: "",
        number: row.number,
        item: row.item,
        result: row.result,
        severity: "",
        description: ""
    }));
    const equipmentLabel = getAdminInspectionEquipmentLabel(record);

    panel.innerHTML = `
        <h3>${escapeHtml(record.inspection_type || "Inspection")}</h3>
        <div class="announcement-grid" style="margin-top:10px;">
            <div><label>Inspection Date</label><input type="text" value="${escapeHtml(formatDate(record.inspection_date))}" readonly></div>
            <div><label>Saved</label><input type="text" value="${escapeHtml(formatDate(record.created_at))}" readonly></div>
            <div><label>Completed By</label><input type="text" value="${escapeHtml(record.worker_display_name || record.worker_name || "")}" readonly></div>
            ${equipmentLabel ? `<div><label>Equipment</label><input type="text" value="${escapeHtml(equipmentLabel)}" readonly></div>` : ""}
        </div>
        <h3 style="margin-top:14px;">Submitted Details</h3>
        ${renderAdminInspectionFieldGrid(fields)}
        <h3 style="margin-top:14px;">Checklist Answers</h3>
        ${renderAdminInspectionRowsTable(rows, "No checklist answers were saved for this inspection.")}
        <div class="actions jgc-actions" style="margin-top:12px;">
            <button type="button" class="secondary jgc-button jgc-button--secondary" onclick="closeAdminInspectionView()">Close</button>
            <button type="button" class="delete-button jgc-button jgc-button--danger" onclick="deleteAdminInspection('standard', '${escapeHtml(record.id)}')">Delete</button>
        </div>
    `;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteAdminInspection(kind, id) {
    const record = getAdminInspectionRecord(kind, id);

    if (!record) {
        alert("This inspection could not be found.");
        return;
    }

    const label = [
        record.inspection_type || (kind === "vehicle" ? "Vehicle inspection" : "Inspection"),
        kind === "vehicle" ? (record.vehicle_license_plate || record.vehicle_name) : (record.equipment_identification || record.equipment_name),
        record.inspection_date
    ].filter(Boolean).join(" - ");

    if (!confirm("Delete " + label + "?")) {
        return;
    }

    const table = kind === "vehicle" ? "vehicle_inspection_records" : "inspection_records";
    let acknowledgementIds = [];

    if (kind !== "vehicle") {
        const { data: ackRows, error: ackLoadError } = await supabaseClient
            .from("safety_acknowledgements")
            .select("id")
            .eq("record_id", id)
            .in("record_type", ["jsa", "toolbox_talk"]);

        if (ackLoadError) {
            console.warn("Related acknowledgement notifications could not be looked up.", ackLoadError);
        } else {
            acknowledgementIds = (ackRows || []).map((row) => row.id).filter(Boolean);
        }
    }

    const { error } = await supabaseClient
        .from(table)
        .delete()
        .eq("id", id);

    if (error) {
        alert("Inspection could not be deleted: " + (error.message || "Unknown error"));
        return;
    }

    if (typeof clearJgcNotificationsForSource === "function") {
        await clearJgcNotificationsForSource(table, id, supabaseClient);
        if (acknowledgementIds.length) {
            await clearJgcNotificationsForSource("safety_acknowledgements", acknowledgementIds, supabaseClient);
        }
    }

    if (kind === "vehicle") {
        vehicleInspections = vehicleInspections.filter((inspection) => String(inspection.id) !== String(id));
    } else {
        inspections = inspections.filter((inspection) => String(inspection.id) !== String(id));
    }

    closeAdminInspectionView();
    renderInspections();
}
