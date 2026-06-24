const INSPECTION_EMAIL = "zeth@johngordonconstruction.com";
const INSPECTION_EMAIL_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzPILTnOSzQcCkA6y5vSLxCH6i05Y2-ZHZAk09Und0YKiXZOYMppV4fvW3G6EgqOIZi/exec";
const INSPECTION_SUPABASE_URL = "https://xnrljkkszoimegfivlya.supabase.co";
const INSPECTION_SUPABASE_KEY = "sb_publishable_k_m_R-jzMnsnHhNY_OHwJA_cbO1qO58";
const inspectionSupabaseClient = window.supabase
    ? window.supabase.createClient(INSPECTION_SUPABASE_URL, INSPECTION_SUPABASE_KEY)
    : null;

function setInspectionSaveStatus(message) {
    const status = document.getElementById("inspectionSaveStatus");
    if (status) {
        status.textContent = message || "";
    }
}

function getCurrentWorker() {
    return {
        key: localStorage.getItem("currentWorker"),
        display: localStorage.getItem("currentWorkerDisplay") || localStorage.getItem("currentWorker")
    };
}

function getFieldLabel(field) {
    const parentLabel = field.closest("label");
    if (parentLabel) {
        return parentLabel.innerText.trim();
    }

    const checkRow = field.closest(".check-row");
    if (checkRow) {
        return checkRow.innerText.trim();
    }

    const id = field.getAttribute("id");
    if (id) {
        const label = document.querySelector(`label[for="${id}"]`);
        if (label) {
            return label.innerText.trim();
        }
    }

    const wrapper = field.closest(".field");
    if (wrapper) {
        const label = wrapper.querySelector("label");
        if (label) {
            return label.innerText.trim();
        }
    }

    const previous = field.previousElementSibling;
    if (previous && previous.tagName === "LABEL") {
        return previous.innerText.trim();
    }

    const cell = field.closest("td");
    if (cell && cell.previousElementSibling) {
        return cell.previousElementSibling.innerText.trim();
    }

    return field.name || field.placeholder || field.type || "Field";
}

function getFieldValue(field) {
    if (field.type === "radio") {
        return field.checked ? (field.value || "Selected") : "";
    }

    if (field.type === "checkbox") {
        return field.checked ? "Yes" : "No";
    }

    return field.value || "";
}

function collectFields() {
    const fields = [];
    document.querySelectorAll("input, select, textarea").forEach((field) => {
        if (field.type === "hidden" || field.closest(".actions")) {
            return;
        }

        if (field.type === "radio" && !field.checked) {
            return;
        }

        fields.push({
            label: getFieldLabel(field),
            value: getFieldValue(field)
        });
    });
    return fields;
}

function collectTableRows() {
    const rows = [];
    document.querySelectorAll("table").forEach((table, tableIndex) => {
        table.querySelectorAll("tbody tr, table > tr").forEach((row) => {
            const cells = Array.from(row.children)
            .filter((cell) => !cell.classList.contains("delete-cell") && !cell.classList.contains("delete-column"))
            .map((cell) => {
                const values = [];
                cell.querySelectorAll("input, select, textarea").forEach((field) => {
                    if (field.type === "hidden") {
                        if (field.value) {
                            values.push(field.value);
                        }
                    } else if (field.type === "radio") {
                        if (field.checked) {
                            values.push(field.value || "Selected");
                        }
                    } else if (field.type === "checkbox") {
                        if (field.checked) {
                            values.push(field.value && field.value !== "on" ? field.value : "Checked");
                        }
                    } else if (field.value) {
                        values.push(field.value);
                    }
                });

                return values.length ? values.join(", ") : cell.innerText.trim();
            });

            if (cells.some(Boolean)) {
                rows.push({ table: tableIndex + 1, cells });
            }
        });
    });
    return rows;
}

function getProjectFieldFromFormFields(fields) {
    const match = fields.find((field) => {
        const label = String(field.label || "").toLowerCase();
        return ["location of use", "project / site", "project", "site location", "location"].some((key) => label.includes(key));
    });

    return match && match.value ? String(match.value).trim() : "";
}

function splitProjectDisplay(value) {
    const text = String(value || "").trim();
    const parts = text.split(" - ");

    if (parts.length >= 2) {
        const maybeNumber = String(parts[0]).trim();
        const maybeName = parts.slice(1).join(" - ").trim();

        return {
            jobNumber: maybeNumber,
            jobName: maybeName,
            project: text,
            location: text
        };
    }

    return {
        project: text,
        location: text
    };
}

function normalizeProjectInput(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function resolveInspectionJobContext(fields) {
    const projectValue = getProjectFieldFromFormFields(fields);

    const context = splitProjectDisplay(projectValue);

    const jobOptions = (typeof getJgcProjectJobOptions === "function")
        ? await getJgcProjectJobOptions()
        : [];

    if (projectValue && Array.isArray(jobOptions) && jobOptions.length) {
        const normalized = normalizeProjectInput(projectValue);

        const direct = jobOptions.find((job) => {
            const display = normalizeProjectInput(getJgcProjectJobDisplay(job));
            const directNumber = normalizeProjectInput(job.job_number || "");
            const directName = normalizeProjectInput(job.job_name || "");

            return display === normalized || directNumber === normalized || directName === normalized;
        });

        if (direct) {
            return {
                project: projectValue,
                location: projectValue,
                jobName: String(direct.job_name || "").trim(),
                jobNumber: String(direct.job_number || "").trim()
            };
        }
    }

    return context;
}

function getInspectionDate(fields) {
    const dateField = fields.find((field) => /date/i.test(field.label) && field.value);
    return dateField ? dateField.value : new Date().toISOString().slice(0, 10);
}

function getInspectionFieldValue(fields, labelPattern) {
    const field = (fields || []).find((item) => labelPattern.test(item.label || ""));
    return field ? String(field.value || "").trim() : "";
}

function getInspectionRecordTypeKey(type) {
    return String(type || "").trim().toLowerCase();
}

function buildInspectionEmail(type, fields, rows) {
    const worker = getCurrentWorker();
    const lines = [
        `${type}`,
        `Completed by: ${worker.display || ""}`,
        ""
    ];

    fields.forEach((field) => {
        if (field.value) {
            lines.push(`${field.label}: ${field.value}`);
        }
    });

    if (rows.length) {
        lines.push("", "Inspection Details:");
        rows.forEach((row) => {
            lines.push(row.cells.filter(Boolean).join(" | "));
        });
    }

    return lines.join("\n");
}

async function createJsaSafetyAcknowledgements(savedRecord, fields) {
    if (
        !savedRecord ||
        getInspectionRecordTypeKey(savedRecord.inspection_type) !== "jsa" ||
        typeof safetyAckLoadApprovedProfiles !== "function" ||
        typeof safetyAckParseManualAttendees !== "function" ||
        typeof safetyAckBuildAttendeesFromNames !== "function" ||
        typeof safetyAckBuildRowsForRecord !== "function" ||
        typeof safetyAckSaveRows !== "function"
    ) {
        return [];
    }

    const manualAttendees = safetyAckParseManualAttendees(getInspectionFieldValue(fields, /Crew Sign Off/i), "");

    if (!manualAttendees.length) {
        return [];
    }

    const profiles = await safetyAckLoadApprovedProfiles(inspectionSupabaseClient);
    const attendees = safetyAckBuildAttendeesFromNames(manualAttendees, profiles, { defaultCompany: "" });

    if (!attendees.length) {
        return [];
    }

    const token = typeof safetyAckCreateToken === "function"
        ? safetyAckCreateToken()
        : "jsa-" + Date.now();
    const formJobContext = savedRecord.form_data && savedRecord.form_data.job_context || {};
    const rows = safetyAckBuildRowsForRecord({
        recordType: "jsa",
        recordId: savedRecord.id,
        recordTitle: savedRecord.title || "JSA - " + (savedRecord.inspection_date || ""),
        recordDate: savedRecord.inspection_date || null,
        project: formJobContext.project || getInspectionFieldValue(fields, /Project|Job/i),
        location: formJobContext.location || getInspectionFieldValue(fields, /Location/i),
        jobNumber: formJobContext.jobNumber || "",
        jobName: formJobContext.jobName || "",
        qrToken: token,
        creator: getCurrentWorker(),
        attendees
    });

    const { data, error } = await safetyAckSaveRows(inspectionSupabaseClient, rows);

    if (error) {
        console.warn("JSA acknowledgement rows could not be created.", error);
        return [];
    }

    return data || [];
}

function escapeInspectionHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getInspectionFields(record) {
    return record.form_data && Array.isArray(record.form_data.fields)
        ? record.form_data.fields
        : [];
}

function getInspectionRows(record) {
    return record.form_data && Array.isArray(record.form_data.rows)
        ? record.form_data.rows
        : [];
}

function getInspectionRecordAcknowledgements(record) {
    if (record && Array.isArray(record.safety_acknowledgements)) {
        return record.safety_acknowledgements;
    }

    const formData = record && record.form_data && typeof record.form_data === "object"
        ? record.form_data
        : {};
    const acknowledgements = Array.isArray(formData.acknowledgements)
        ? formData.acknowledgements
        : [];

    return acknowledgements.filter((ack) =>
        ack && (ack.worker_key || ack.worker_name || ack.worker_display_name || ack.name || ack.email)
    );
}

function getInspectionRecordAcknowledgementName(ack) {
    return ack.worker_display_name || ack.worker_name || ack.name || ack.worker_key || ack.email || "Worker";
}

function formatInspectionRecordAcknowledgementDate(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function buildInspectionRecordAcknowledgementsHtml(record) {
    if (String(record && record.inspection_type || "").toLowerCase() !== "jsa") {
        return "";
    }

    const acknowledgements = getInspectionRecordAcknowledgements(record);

    if (!acknowledgements.length) {
        return "";
    }

    if (typeof safetyAckBuildTableHtml === "function") {
        return `
            <h2>Digital JSA Acknowledgements</h2>
            ${safetyAckBuildTableHtml(acknowledgements)}
        `;
    }

    return `
        <h2>Digital JSA Acknowledgements</h2>
        <table>
            <thead>
                <tr><th>Name</th><th>Company</th><th>Acknowledged</th><th>Email</th></tr>
            </thead>
            <tbody>
                ${acknowledgements.map((ack) => `
                    <tr>
                        <td>${escapeInspectionHtml(getInspectionRecordAcknowledgementName(ack))}</td>
                        <td>${escapeInspectionHtml(ack.company || "")}</td>
                        <td>${escapeInspectionHtml(formatInspectionRecordAcknowledgementDate(ack.acknowledged_at))}</td>
                        <td>${escapeInspectionHtml(ack.email || "")}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

function buildInspectionPdfHtml(record) {
    const type = String(record.inspection_type || "Inspection");
    const typeKey = type.toLowerCase();
    const fields = getInspectionFields(record);
    const rows = getInspectionRows(record);
    const fieldRows = fields
        .filter((field) => field.value)
        .map((field) => `
            <tr>
                <th>${escapeInspectionHtml(field.label)}</th>
                <td>${escapeInspectionHtml(field.value)}</td>
            </tr>
        `).join("");

    let inspectionRows = "";
    let heading = "Inspection Details";
    const acknowledgementSection = buildInspectionRecordAcknowledgementsHtml(record);

    if (typeKey === "jsa") {
        heading = "Job Safety Analysis";
        inspectionRows = rows
            .filter((row) => (row.cells || []).slice(0, 3).some(Boolean))
            .map((row) => `
                <tr>
                    <td>${escapeInspectionHtml((row.cells || [])[0])}</td>
                    <td>${escapeInspectionHtml((row.cells || [])[1])}</td>
                    <td>${escapeInspectionHtml((row.cells || [])[2])}</td>
                </tr>
            `).join("");
        inspectionRows = `
            <table>
                <thead><tr><th>Sequence of Basic Job Steps</th><th>Potential Hazards</th><th>Required Action or Procedure</th></tr></thead>
                <tbody>${inspectionRows}</tbody>
            </table>
        `;
    } else if (typeKey === "aerial lifts") {
        heading = "Aerial Lift Pre-Use Inspection";
        inspectionRows = rows
            .filter((row) => /^\d+$/.test(String((row.cells || [])[0] || "").trim()))
            .map((row) => `
                <tr>
                    <td>${escapeInspectionHtml((row.cells || [])[0])}</td>
                    <td>${escapeInspectionHtml((row.cells || [])[1])}</td>
                    <td>${escapeInspectionHtml((row.cells || []).slice(2).find(Boolean) || "")}</td>
                </tr>
            `).join("");
        inspectionRows = `
            <table>
                <thead><tr><th>#</th><th>Inspection Item and Description</th><th>P/F/N/A</th></tr></thead>
                <tbody>${inspectionRows}</tbody>
            </table>
        `;
    } else if (typeKey === "harness") {
        heading = "Harness Inspection Checklist";
        inspectionRows = rows
            .filter((row) => (row.cells || []).length >= 4)
            .map((row) => `
                <tr>
                    <td>${escapeInspectionHtml((row.cells || [])[0])}</td>
                    <td>${escapeInspectionHtml((row.cells || [])[1])}</td>
                    <td>${escapeInspectionHtml((row.cells || [])[2])}</td>
                    <td>${escapeInspectionHtml((row.cells || [])[3])}</td>
                </tr>
            `).join("");
        inspectionRows = `
            <table>
                <thead><tr><th>Component Part</th><th>Possible Defect</th><th>Current Condition</th><th>Pass / Fail</th></tr></thead>
                <tbody>${inspectionRows}</tbody>
            </table>
        `;
    } else if (typeKey === "hot work permit") {
        heading = "Hot Work Permit";
        inspectionRows = fields
            .filter((field) => field.value === "Yes" || field.value === "No" || field.value === "Employee" || field.value === "Contractor")
            .map((field) => `
                <tr>
                    <td>${escapeInspectionHtml(field.label)}</td>
                    <td>${escapeInspectionHtml(field.value)}</td>
                </tr>
            `).join("");
        inspectionRows = `
            <table>
                <thead><tr><th>Requirement</th><th>Confirmed</th></tr></thead>
                <tbody>${inspectionRows}</tbody>
            </table>
        `;
    } else if (typeKey === "fork lift") {
        heading = "Daily Forklift Inspection";
        inspectionRows = rows
            .filter((row) => /^\d+\./.test(String((row.cells || [])[0] || "").trim()) || /^\d+\./.test(String((row.cells || [])[4] || "").trim()))
            .map((row) => `
                <tr>
                    <td>${escapeInspectionHtml((row.cells || [])[0])}</td>
                    <td>${escapeInspectionHtml((row.cells || []).slice(1, 4).find(Boolean) || "")}</td>
                    <td>${escapeInspectionHtml((row.cells || [])[4])}</td>
                    <td>${escapeInspectionHtml((row.cells || []).slice(5, 8).find(Boolean) || "")}</td>
                </tr>
            `).join("");
        inspectionRows = `
            <table>
                <thead><tr><th>Visual Inspection</th><th>Result</th><th>Operational Inspection</th><th>Result</th></tr></thead>
                <tbody>${inspectionRows}</tbody>
            </table>
        `;
    } else if (typeKey === "tele handler") {
        heading = "Telehandler Inspection and Daily Checklist";
        inspectionRows = rows
            .filter((row) => (row.cells || [])[0])
            .map((row) => {
                const cells = row.cells || [];
                return `
                    <tr>
                        <td>${escapeInspectionHtml(cells[0])}</td>
                        <td>${cells[1] ? "X" : ""}</td><td>${cells[2] ? "X" : ""}</td>
                        <td>${cells[3] ? "X" : ""}</td><td>${cells[4] ? "X" : ""}</td>
                        <td>${cells[5] ? "X" : ""}</td><td>${cells[6] ? "X" : ""}</td>
                        <td>${cells[7] ? "X" : ""}</td><td>${cells[8] ? "X" : ""}</td>
                        <td>${cells[9] ? "X" : ""}</td><td>${cells[10] ? "X" : ""}</td>
                        <td>${cells[11] ? "X" : ""}</td><td>${cells[12] ? "X" : ""}</td>
                        <td>${cells[13] ? "X" : ""}</td><td>${cells[14] ? "X" : ""}</td>
                    </tr>
                `;
            }).join("");
        inspectionRows = `
            <table>
                <thead>
                    <tr>
                        <th>Inspection Item</th>
                        <th>Mon Def.</th><th>Mon Okay</th>
                        <th>Tue Def.</th><th>Tue Okay</th>
                        <th>Wed Def.</th><th>Wed Okay</th>
                        <th>Thu Def.</th><th>Thu Okay</th>
                        <th>Fri Def.</th><th>Fri Okay</th>
                        <th>Sat Def.</th><th>Sat Okay</th>
                        <th>Sun Def.</th><th>Sun Okay</th>
                    </tr>
                </thead>
                <tbody>${inspectionRows}</tbody>
            </table>
        `;
    } else {
        inspectionRows = rows.map((row) => `
            <tr>${(row.cells || []).map((cell) => `<td>${escapeInspectionHtml(cell)}</td>`).join("")}</tr>
        `).join("");
        inspectionRows = `<table><tbody>${inspectionRows}</tbody></table>`;
    }

    return `
        <!doctype html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: Arial, sans-serif; color: #1f2a24; }
                h1 { color: #2f6f3c; margin-bottom: 4px; }
                h2 { color: #2f6f3c; margin-top: 18px; }
                .meta { margin-bottom: 14px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
                th, td { border: 1px solid #999; padding: 6px; font-size: 11px; text-align: left; vertical-align: top; }
                th { background: #e6ece6; font-weight: bold; }
            </style>
        </head>
        <body>
            <h1>John Gordon Construction</h1>
            <h2>${escapeInspectionHtml(heading)}</h2>
            <div class="meta">
                <div><b>Date:</b> ${escapeInspectionHtml(record.inspection_date || "")}</div>
                <div><b>Completed By:</b> ${escapeInspectionHtml(record.worker_display_name || record.worker_name || "")}</div>
            </div>
            ${fieldRows ? `<h2>Form Details</h2><table><tbody>${fieldRows}</tbody></table>` : ""}
            <h2>${escapeInspectionHtml(heading)} Items</h2>
            ${inspectionRows}
            ${acknowledgementSection}
        </body>
        </html>
    `;
}

async function saveInspection(type) {
    const worker = getCurrentWorker();
    setInspectionSaveStatus("Saving inspection...");

    if (!worker.key) {
        window.location.href = "index.html";
        return;
    }

    if (!inspectionSupabaseClient) {
        setInspectionSaveStatus("");
        alert("Supabase is not available right now. Please try again.");
        return;
    }

    const fields = collectFields();
    const rows = collectTableRows();
    const inspectionDate = getInspectionDate(fields);
    const emailBody = buildInspectionEmail(type, fields, rows);
    const jobContext = await resolveInspectionJobContext(fields);
    const record = {
        worker_name: worker.key,
        worker_display_name: worker.display,
        inspection_type: type,
        inspection_date: inspectionDate,
        title: `${type} - ${inspectionDate}`,
        summary: {
            completed_by: worker.display,
            field_count: fields.length,
            row_count: rows.length
        },
        form_data: {
            fields,
            rows,
            job_context: jobContext
        },
        email_body: emailBody
    };

    const { data, error } = await inspectionSupabaseClient
        .from("inspection_records")
        .insert(record)
        .select()
        .single();

    if (error) {
        setInspectionSaveStatus("");
        alert("This inspection could not be saved. Please try again. " + (error.message || ""));
        return;
    }

    const savedRecord = {
        ...record,
        ...(data || {})
    };
    const safetyRows = await createJsaSafetyAcknowledgements(savedRecord, fields);
    savedRecord.safety_acknowledgements = safetyRows;

    if (typeof isJgcSubcontractorSession === "function" && isJgcSubcontractorSession()) {
        setInspectionSaveStatus("Inspection saved. Emailing PDF...");
        await emailInspectionRecord(savedRecord);
    }

    setInspectionSaveStatus("Inspection saved.");
    window.location.href = (typeof isJgcSubcontractorSession === "function" && isJgcSubcontractorSession())
        ? "inspections.html"
        : "todays-inspections.html";
}

function openInspectionMailto(record) {
    const subject = encodeURIComponent(`${record.inspection_type} - ${record.inspection_date || ""}`);
    const body = encodeURIComponent(record.email_body || "");
    window.location.href = `mailto:${INSPECTION_EMAIL}?subject=${subject}&body=${body}`;
}

async function emailInspectionRecord(record) {
    if (!record) {
        alert("This inspection could not be found.");
        return;
    }

    const subject = `${record.inspection_type} - ${record.inspection_date || ""}`;
    const body = record.email_body || "";

    if (!INSPECTION_EMAIL_SCRIPT_URL) {
        alert("Automatic inspection email is not set up yet. Your email app will open instead.");
        openInspectionMailto(record);
        return;
    }

    try {
        await fetch(INSPECTION_EMAIL_SCRIPT_URL, {
            method: "POST",
            mode: "no-cors",
            headers: {
                "Content-Type": "text/plain;charset=utf-8"
            },
            body: JSON.stringify(withJgcSubcontractorEmailCopy({
                subject,
                body,
                text: body,
                pdfHtml: buildInspectionPdfHtml(record),
                inspectionType: record.inspection_type || "Inspection",
                inspectionDate: record.inspection_date || "",
                completedBy: record.worker_display_name || record.worker_name || "",
                pdfFileName: `inspection-${String(record.inspection_type || "inspection").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${record.inspection_date || "record"}.pdf`
            }))
        });

        alert("Inspection email sent.");
    } catch (error) {
        alert("Automatic inspection email could not be sent. Your email app will open instead.");
        openInspectionMailto(record);
    }
}
