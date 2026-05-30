const INSPECTION_EMAIL = "zeth@johngordonconstruction.com";
const INSPECTION_SUPABASE_URL = "https://xnrljkkszoimegfivlya.supabase.co";
const INSPECTION_SUPABASE_KEY = "sb_publishable_k_m_R-jzMnsnHhNY_OHwJA_cbO1qO58";
const inspectionSupabaseClient = window.supabase
    ? window.supabase.createClient(INSPECTION_SUPABASE_URL, INSPECTION_SUPABASE_KEY)
    : null;

function getCurrentWorker() {
    return {
        key: localStorage.getItem("currentWorker"),
        display: localStorage.getItem("currentWorkerDisplay") || localStorage.getItem("currentWorker")
    };
}

function getFieldLabel(field) {
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
        return field.checked ? "Selected" : "";
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
            const cells = Array.from(row.children).map((cell) => {
                const values = [];
                cell.querySelectorAll("input, select, textarea").forEach((field) => {
                    if (field.type === "hidden") {
                        if (field.value) {
                            values.push(field.value);
                        }
                    } else if (field.type === "radio" || field.type === "checkbox") {
                        if (field.checked) {
                            values.push(field.value || "Checked");
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

function getInspectionDate(fields) {
    const dateField = fields.find((field) => /date/i.test(field.label) && field.value);
    return dateField ? dateField.value : new Date().toISOString().slice(0, 10);
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

async function saveInspection(type) {
    const worker = getCurrentWorker();

    if (!worker.key) {
        window.location.href = "index.html";
        return;
    }

    if (!inspectionSupabaseClient) {
        alert("Supabase is not available right now. Please try again.");
        return;
    }

    const fields = collectFields();
    const rows = collectTableRows();
    const inspectionDate = getInspectionDate(fields);
    const emailBody = buildInspectionEmail(type, fields, rows);
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
            rows
        },
        email_body: emailBody
    };

    const { error } = await inspectionSupabaseClient
        .from("inspection_records")
        .insert(record);

    if (error) {
        alert("This inspection could not be saved. Please try again.");
        return;
    }

    alert("Inspection saved.");
    window.location.href = "previous-inspections.html";
}

function emailInspectionRecord(record) {
    if (!record) {
        alert("This inspection could not be found.");
        return;
    }

    const subject = encodeURIComponent(`${record.inspection_type} - ${record.inspection_date || ""}`);
    const body = encodeURIComponent(record.email_body || "");
    window.location.href = `mailto:${INSPECTION_EMAIL}?subject=${subject}&body=${body}`;
}
