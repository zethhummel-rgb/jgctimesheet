function getJsaReportAcknowledgements(inspection) {
    return safetyAcknowledgements.filter((ack) =>
        ack.record_type === "jsa" && ack.record_id === inspection.id && !ack.removed_at
    );
}

function getToolboxReportSafetyAcknowledgements(report) {
    return safetyAcknowledgements.filter((ack) =>
        ack.record_type === "toolbox_talk" && ack.record_id === report.id && !ack.removed_at
    );
}

function formatJsaReportAcknowledgementDate(value) {
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

function renderJsaReportAcknowledgements(inspection) {
    const acknowledgements = getJsaReportAcknowledgements(inspection);

    if (!acknowledgements.length) {
        return "-";
    }

    const summary = typeof safetyAckSummary === "function"
        ? safetyAckSummary(acknowledgements)
        : { total: acknowledgements.length, acknowledged: acknowledgements.filter((ack) => ack.acknowledged_at).length, pending: 0, late: 0, unmatched: 0 };
    const detail = acknowledgements.slice(0, 8).map((ack) => {
        const name = ack.attendee_name || "Worker";
        const status = typeof safetyAckStatusLabel === "function" ? safetyAckStatusLabel(ack) : ack.acknowledgement_status || "";
        const method = typeof safetyAckMethodLabel === "function" ? safetyAckMethodLabel(ack) : ack.acknowledgement_method || "";
        const acknowledgedAt = ack.acknowledged_at ? " - " + formatJsaReportAcknowledgementDate(ack.acknowledged_at) : "";

        return escapeHtml(name + ": " + status + (method && method !== "-" ? " / " + method : "") + acknowledgedAt);
    }).join("<br>");

    return `
        <strong>${escapeHtml(String(summary.acknowledged))}/${escapeHtml(String(summary.total))}</strong>
        ${summary.pending ? " Pending: " + escapeHtml(String(summary.pending)) : ""}
        ${summary.late ? " Late: " + escapeHtml(String(summary.late)) : ""}
        ${summary.unmatched ? " Unmatched QR: " + escapeHtml(String(summary.unmatched)) : ""}
        <br>${detail}
    `;
}

function renderSafetyAcknowledgementOverview() {
    const list = document.getElementById("safetyAcknowledgementList");

    if (!list) {
        return;
    }

    const rows = safetyAcknowledgements.filter((ack) => !ack.removed_at);

    if (!rows.length) {
        list.textContent = "No JSA or toolbox talk acknowledgements found.";
        return;
    }

    list.innerHTML = `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr><th>Record</th><th>Name</th><th>Company</th><th>Type</th><th>Status</th><th>Method</th><th>Acknowledged</th><th>By</th><th>Note</th></tr>
                </thead>
                <tbody>
                    ${rows.slice(0, 120).map((ack) => `
                        <tr>
                            <td>${escapeHtml((ack.record_type === "toolbox_talk" ? "Toolbox Talk" : "JSA") + " - " + (ack.record_title || ack.record_date || ""))}</td>
                            <td>${escapeHtml(ack.attendee_name || "")}</td>
                            <td>${escapeHtml(ack.attendee_company || "")}</td>
                            <td>${escapeHtml(ack.attendee_type || "")}${ack.matched_employee_id ? " / matched" : ""}</td>
                            <td>${escapeHtml(typeof safetyAckStatusLabel === "function" ? safetyAckStatusLabel(ack) : ack.acknowledgement_status || "")}${ack.is_late ? " / Late" : ""}${ack.unmatched_qr_entry ? " / Unmatched QR" : ""}</td>
                            <td>${escapeHtml(typeof safetyAckMethodLabel === "function" ? safetyAckMethodLabel(ack) : ack.acknowledgement_method || "")}</td>
                            <td>${escapeHtml(formatJsaReportAcknowledgementDate(ack.acknowledged_at))}</td>
                            <td>${escapeHtml(ack.acknowledged_by_name || "")}</td>
                            <td>${escapeHtml(ack.acknowledgement_note || "")}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function getToolboxReportPeople(report) {
    const safetyRows = getToolboxReportSafetyAcknowledgements(report);

    if (safetyRows.length) {
        return safetyRows.map((ack) => ({
            name: ack.attendee_name || "Worker",
            company: ack.attendee_company || "",
            status: (typeof safetyAckStatusLabel === "function" ? safetyAckStatusLabel(ack) : ack.acknowledgement_status || "") +
                (ack.acknowledged_at ? " - " + formatJsaReportAcknowledgementDate(ack.acknowledged_at) : "")
        }));
    }

    const attendanceRows = toolboxAttendance.filter((attendance) => attendance.report_id === report.id);

    if (attendanceRows.length) {
        return attendanceRows.map((attendance) => ({
            name: attendance.worker_display_name || attendance.worker_name || "Worker",
            company: "",
            status: attendance.acknowledged_at
                ? "Acknowledged - " + formatJsaReportAcknowledgementDate(attendance.acknowledged_at)
                : "Pending acknowledgement"
        }));
    }

    return (Array.isArray(report.crew) ? report.crew : []).map((person) => ({
        name: person.displayName || person.workerName || person.name || "Worker",
        company: person.company || "",
        status: "Recorded present"
    }));
}

function renderToolboxTalkHistory() {
    const list = document.getElementById("toolboxTalkHistoryList");

    if (!list) {
        return;
    }

    if (!toolboxReports.length) {
        list.textContent = "No completed toolbox talk reports found.";
        return;
    }

    list.innerHTML = toolboxReports.map((report) => {
        const people = getToolboxReportPeople(report);
        const crewCount = people.length || (Array.isArray(report.crew) ? report.crew.length : 0);

        return `
            <details class="admin-collapsible-panel jgc-card" style="margin-bottom:10px;">
                <summary>
                    <span>
                        <strong>${escapeHtml(report.talk_title || "Toolbox Talk")}</strong><br>
                        <span class="timesheet-worker-meta">${escapeHtml(formatDate(report.report_date))} | ${escapeHtml(report.project || "No project entered")} | Presented by ${escapeHtml(report.presenter_name || "-")}</span>
                    </span>
                    <span class="admin-report-count jgc-badge">${escapeHtml(String(crewCount))} attendee${crewCount === 1 ? "" : "s"}</span>
                </summary>
                <div>
                    <div class="table-wrap">
                        <table>
                            <tbody>
                                <tr><th>Talk</th><td>${escapeHtml(report.talk_title || "")}</td></tr>
                                <tr><th>Date</th><td>${escapeHtml(formatDate(report.report_date))}</td></tr>
                                <tr><th>Project</th><td>${escapeHtml(report.project || "")}</td></tr>
                                <tr><th>Location</th><td>${escapeHtml(report.location || "-")}</td></tr>
                                <tr><th>Presenter</th><td>${escapeHtml(report.presenter_name || "")}</td></tr>
                                <tr><th>Submitted By</th><td>${escapeHtml(report.submitted_by_name || report.submitted_by_worker || "")}</td></tr>
                                <tr><th>Saved</th><td>${escapeHtml(formatJsaReportAcknowledgementDate(report.created_at))}</td></tr>
                                <tr><th>Discussion Notes</th><td>${escapeHtml(report.discussion_notes || "-")}</td></tr>
                                <tr><th>Hazards Discussed</th><td>${escapeHtml(report.hazards_discussed || "-")}</td></tr>
                                <tr><th>Corrective Actions</th><td>${escapeHtml(report.corrective_actions || "-")}</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <h4 style="margin:14px 0 8px;">Attendance</h4>
                    ${people.length ? `
                        <div class="table-wrap">
                            <table>
                                <thead><tr><th>Name</th><th>Company</th><th>Status</th></tr></thead>
                                <tbody>
                                    ${people.map((person) => `
                                        <tr>
                                            <td>${escapeHtml(person.name)}</td>
                                            <td>${escapeHtml(person.company || "-")}</td>
                                            <td>${escapeHtml(person.status || "Recorded present")}</td>
                                        </tr>
                                    `).join("")}
                                </tbody>
                            </table>
                        </div>
                    ` : '<div class="small">No attendance was recorded.</div>'}
                </div>
            </details>
        `;
    }).join("");
}

function getAdminJsaReports() {
    return inspections.filter((inspection) =>
        String(inspection.inspection_type || "").toLowerCase().includes("jsa") ||
        String(inspection.inspection_type || "").toLowerCase().includes("job safety")
    );
}

function getAdminJsaReportById(reportId) {
    return getAdminJsaReports().find((report) => String(report.id) === String(reportId)) || null;
}

function getAdminJsaReportFields(report) {
    const fields = report && report.form_data && Array.isArray(report.form_data.fields)
        ? report.form_data.fields
        : [];

    return fields.filter((field) => {
        const label = String(field && field.label || "").trim();
        const value = String(field && field.value || "").trim();
        return label && value && label.toLowerCase() !== "textarea";
    });
}

function getAdminJsaReportRows(report) {
    return report && report.form_data && Array.isArray(report.form_data.rows)
        ? report.form_data.rows.filter((row) => (row.cells || []).slice(0, 3).some((cell) => String(cell || "").trim()))
        : [];
}

function renderAdminJsaReportBody(report) {
    const fields = getAdminJsaReportFields(report);
    const rows = getAdminJsaReportRows(report);
    const acknowledgements = getJsaReportAcknowledgements(report);
    const acknowledgementSummary = acknowledgements.length && typeof safetyAckSummary === "function"
        ? safetyAckSummary(acknowledgements)
        : null;

    return `
        <div class="admin-jsa-report-meta">
            <div><strong>Date</strong><span>${escapeHtml(formatDate(report.inspection_date) || "-")}</span></div>
            <div><strong>Completed By</strong><span>${escapeHtml(report.worker_display_name || report.worker_name || "-")}</span></div>
            <div><strong>Saved</strong><span>${escapeHtml(formatJsaReportAcknowledgementDate(report.created_at) || "-")}</span></div>
            <div><strong>Record</strong><span>${escapeHtml(report.title || "JSA")}</span></div>
        </div>
        <h4>Submitted Details</h4>
        ${fields.length ? `
            <div class="admin-jsa-report-fields">
                ${fields.map((field) => `
                    <div>
                        <strong>${escapeHtml(field.label)}</strong>
                        <span class="admin-jsa-report-value">${escapeHtml(field.value)}</span>
                    </div>
                `).join("")}
            </div>
        ` : '<p class="small">No submitted field details were saved.</p>'}
        <h4>Job Steps, Hazards, and Controls</h4>
        ${rows.length ? `
            <div class="table-wrap jgc-table-wrap">
                <table class="jgc-table admin-jsa-report-table">
                    <thead>
                        <tr><th>Sequence of Basic Job Steps</th><th>Potential Hazards</th><th>Required Action or Procedure</th></tr>
                    </thead>
                    <tbody>
                        ${rows.map((row) => `
                            <tr>
                                <td class="admin-jsa-report-value">${escapeHtml((row.cells || [])[0] || "-")}</td>
                                <td class="admin-jsa-report-value">${escapeHtml((row.cells || [])[1] || "-")}</td>
                                <td class="admin-jsa-report-value">${escapeHtml((row.cells || [])[2] || "-")}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        ` : '<p class="small">No job-step rows were saved.</p>'}
        <h4>Digital Acknowledgements${acknowledgementSummary ? ` - ${escapeHtml(String(acknowledgementSummary.acknowledged))}/${escapeHtml(String(acknowledgementSummary.total))} complete` : ""}</h4>
        ${acknowledgements.length ? `
            <div class="table-wrap jgc-table-wrap">
                <table class="jgc-table">
                    <thead>
                        <tr><th>Name</th><th>Company</th><th>Status</th><th>Method</th><th>Acknowledged</th></tr>
                    </thead>
                    <tbody>
                        ${acknowledgements.map((ack) => `
                            <tr>
                                <td>${escapeHtml(ack.attendee_name || "Worker")}</td>
                                <td>${escapeHtml(ack.attendee_company || "-")}</td>
                                <td>${escapeHtml(typeof safetyAckStatusLabel === "function" ? safetyAckStatusLabel(ack) : ack.acknowledgement_status || "Pending")}</td>
                                <td>${escapeHtml(typeof safetyAckMethodLabel === "function" ? safetyAckMethodLabel(ack) : ack.acknowledgement_method || "-")}</td>
                                <td>${escapeHtml(formatJsaReportAcknowledgementDate(ack.acknowledged_at) || "-")}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        ` : '<p class="small">No digital acknowledgements were recorded for this JSA.</p>'}
    `;
}

function closeAdminJsaReport() {
    const panel = document.getElementById("adminJsaReportViewPanel");

    if (panel) {
        panel.hidden = true;
        panel.innerHTML = "";
    }
}

function openAdminJsaReport(reportId) {
    const report = getAdminJsaReportById(reportId);
    const panel = document.getElementById("adminJsaReportViewPanel");

    if (!report || !panel) {
        alert("This JSA report could not be found.");
        return;
    }

    panel.innerHTML = `
        <div class="admin-jsa-report-header">
            <div>
                <span class="small">Completed JSA</span>
                <h3>${escapeHtml(report.title || "Job Safety Analysis")}</h3>
            </div>
            <div class="jgc-actions jgc-actions--compact">
                <button type="button" class="jgc-button jgc-button--secondary" onclick="printAdminJsaReport('${escapeHtml(report.id)}')">Print / Save PDF</button>
                <button type="button" class="jgc-button jgc-button--secondary" onclick="closeAdminJsaReport()">Close</button>
            </div>
        </div>
        ${renderAdminJsaReportBody(report)}
    `;
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function printAdminJsaReport(reportId) {
    const report = getAdminJsaReportById(reportId);

    if (!report) {
        alert("This JSA report could not be found.");
        return;
    }

    const printWindow = window.open("", "_blank", "width=920,height=980");

    if (!printWindow) {
        alert("Popup blocked. Allow popups for this portal, then try again.");
        return;
    }

    printWindow.document.write(`
        <!doctype html>
        <html>
        <head>
            <title>${escapeHtml(report.title || "Job Safety Analysis")}</title>
            <style>
                @page { size: letter; margin: 14mm; }
                * { box-sizing: border-box; }
                body { margin: 0; color: #17221b; font: 13px Arial, sans-serif; }
                h3, h4 { color: #174f28; }
                .small { color: #526158; }
                .admin-jsa-report-meta, .admin-jsa-report-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
                .admin-jsa-report-meta > div, .admin-jsa-report-fields > div { border: 1px solid #b9c6bc; padding: 8px; }
                strong, span { display: block; }
                table { width: 100%; margin-top: 8px; border-collapse: collapse; }
                th, td { border: 1px solid #aeb8b1; padding: 7px; text-align: left; vertical-align: top; }
                th { background: #e7f3e9; }
                .admin-jsa-report-value { white-space: pre-wrap; }
            </style>
        </head>
        <body>
            <h1>${escapeHtml(report.title || "Job Safety Analysis")}</h1>
            ${renderAdminJsaReportBody(report)}
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
}

function setAdminReportSubtabCount(tab, count) {
    const countElement = document.querySelector(`[data-report-tab="${tab}"] .admin-report-count`);

    if (countElement) {
        countElement.textContent = String(count || 0);
    }
}

function updateAdminReportSubtabCounts() {
    setAdminReportSubtabCount("daily", dailySiteReports.length);
    setAdminReportSubtabCount("jsa", getAdminJsaReports().length);
    setAdminReportSubtabCount("nearMiss", incidentReports.length);
    setAdminReportSubtabCount("accident", accidentReports.length);
    setAdminReportSubtabCount("injury", employeeInjuryReports.length);
    setAdminReportSubtabCount("acknowledgements", safetyAcknowledgements.filter((ack) => !ack.removed_at).length);
    setAdminReportSubtabCount("toolbox", toolboxReports.length);
}

function switchAdminReportSubtab(tab) {
    const requestedTab = tab || "daily";
    const targetPanel = document.querySelector(`[data-report-panel="${requestedTab}"]`);
    const resolvedTab = targetPanel ? requestedTab : "daily";

    activeAdminReportSubtab = resolvedTab;
    localStorage.setItem("jgcActiveAdminReportSubtab", resolvedTab);

    document.querySelectorAll("[data-report-tab]").forEach((button) => {
        const isActive = button.getAttribute("data-report-tab") === resolvedTab;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    document.querySelectorAll("[data-report-panel]").forEach((panel) => {
        panel.hidden = panel.getAttribute("data-report-panel") !== resolvedTab;
    });
}

function initializeAdminReportSubtabs() {
    updateAdminReportSubtabCounts();
    switchAdminReportSubtab(activeAdminReportSubtab || "daily");
}

function renderReports() {
    const dailyList = document.getElementById("dailySiteReportsList");
    const jsaList = document.getElementById("jsaReportsList");
    const incidentList = document.getElementById("nearMissReportsList");
    const accidentList = document.getElementById("accidentReportsList");
    const employeeInjuryList = document.getElementById("employeeInjuryReportsList");
    const jsaReports = getAdminJsaReports();

    renderSafetyAcknowledgementOverview();
    renderToolboxTalkHistory();

    if (dailyList) {
        if (!dailySiteReports.length) {
            dailyList.textContent = "No daily site reports found.";
        } else {
            dailyList.innerHTML = `
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr><th>Date</th><th>Project</th><th>Submitted By</th><th>Saved</th><th>Actions</th></tr>
                        </thead>
                        <tbody>
                            ${dailySiteReports.slice(0, 50).map((report) => `
                                <tr>
                                    <td>${escapeHtml(formatDate(report.report_date))}</td>
                                    <td>${escapeHtml(report.project || "")}</td>
                                    <td>${escapeHtml(report.worker_display_name || report.worker_name || "")}</td>
                                    <td>${escapeHtml(formatDate(report.created_at))}</td>
                                    <td>
                                        <div class="jgc-actions jgc-actions--compact">
                                            <button type="button" class="jgc-button" onclick="openDailySiteReport('${escapeHtml(report.id)}', 'view')">View</button>
                                            <button type="button" class="jgc-button jgc-button--secondary" onclick="openDailySiteReport('${escapeHtml(report.id)}', 'edit')">Edit</button>
                                        </div>
                                    </td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        }
    }

    if (jsaList) {
        if (!jsaReports.length) {
            jsaList.textContent = "No JSA reports found.";
        } else {
            jsaList.innerHTML = `
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr><th>Date</th><th>Completed By</th><th>Acknowledgements</th><th>Saved</th><th>Actions</th></tr>
                        </thead>
                        <tbody>
                            ${jsaReports.slice(0, 50).map((inspection) => `
                                <tr>
                                    <td>${escapeHtml(formatDate(inspection.inspection_date))}</td>
                                    <td>${escapeHtml(inspection.worker_display_name || inspection.worker_name || "")}</td>
                                    <td>${renderJsaReportAcknowledgements(inspection)}</td>
                                    <td>${escapeHtml(formatDate(inspection.created_at))}</td>
                                    <td><button type="button" class="jgc-button" onclick="openAdminJsaReport('${escapeHtml(inspection.id)}')">View</button></td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        }
    }

    if (incidentList) {
        if (!incidentReports.length) {
            incidentList.textContent = "No incident or near miss reports found.";
        } else {
            incidentList.innerHTML = `
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr><th>Date</th><th>Type</th><th>Severity</th><th>Project</th><th>Location</th><th>Reported By</th><th>Saved</th></tr>
                        </thead>
                        <tbody>
                            ${incidentReports.slice(0, 50).map((report) => `
                                <tr>
                                    <td>${escapeHtml(formatDate(report.report_date))}</td>
                                    <td>${escapeHtml(report.incident_type || "")}</td>
                                    <td>${escapeHtml(report.severity || "")}</td>
                                    <td>${escapeHtml(report.project || "")}</td>
                                    <td>${escapeHtml(report.location || "")}</td>
                                    <td>${escapeHtml(report.reported_by_name || report.reported_by_worker || "")}</td>
                                    <td>${escapeHtml(formatDate(report.created_at))}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        }
    }

    if (accidentList) {
        if (!accidentReports.length) {
            accidentList.textContent = "No accident reports found.";
        } else {
            accidentList.innerHTML = `
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr><th>Date</th><th>Injured Employee</th><th>Location</th><th>Report Maker</th><th>Acknowledgement</th><th>Saved</th></tr>
                        </thead>
                        <tbody>
                            ${accidentReports.slice(0, 50).map((report) => {
                                const acks = accidentAcknowledgements.filter((ack) => ack.accident_report_id === report.id);
                                const ackStatus = acks.length
                                    ? acks.map((ack) => escapeHtml(ack.worker_display_name || ack.worker_name || "") + ": " + escapeHtml(ack.acknowledged_at ? "Acknowledged " + formatDate(ack.acknowledged_at) : "Pending")).join("<br>")
                                    : "-";

                                return `
                                    <tr>
                                        <td>${escapeHtml(formatDate(report.accident_date))}</td>
                                        <td>${escapeHtml(report.injured_worker_display || report.injured_worker || "")}</td>
                                        <td>${escapeHtml(report.site_location || "")}</td>
                                        <td>${escapeHtml(report.report_maker_display || report.report_maker_worker || "")}</td>
                                        <td>${ackStatus}</td>
                                        <td>${escapeHtml(formatDate(report.created_at))}</td>
                                    </tr>
                                `;
                            }).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        }
    }

    if (employeeInjuryList) {
        if (!employeeInjuryReports.length) {
            employeeInjuryList.textContent = "No employee injury reports found.";
        } else {
            employeeInjuryList.innerHTML = `
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr><th>Date</th><th>Employee</th><th>Location</th><th>Supervisor</th><th>Acknowledgement</th><th>Saved</th></tr>
                        </thead>
                        <tbody>
                            ${employeeInjuryReports.slice(0, 50).map((report) => {
                                const acks = employeeInjuryAcknowledgements.filter((ack) => ack.employee_injury_report_id === report.id);
                                const ackStatus = acks.length
                                    ? acks.map((ack) => escapeHtml(ack.worker_display_name || ack.worker_name || "") + ": " + escapeHtml(ack.acknowledged_at ? "Acknowledged " + formatDate(ack.acknowledged_at) : "Pending")).join("<br>")
                                    : "-";

                                return `
                                    <tr>
                                        <td>${escapeHtml(formatDate(report.accident_date))}</td>
                                        <td>${escapeHtml(report.employee_name || report.employee_display || "")}</td>
                                        <td>${escapeHtml(report.accident_location || "")}</td>
                                        <td>${escapeHtml(report.supervisor_name || "")}</td>
                                        <td>${ackStatus}</td>
                                        <td>${escapeHtml(formatDate(report.created_at))}</td>
                                    </tr>
                                `;
                            }).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        }
    }

    initializeAdminReportSubtabs();
}

function openDailySiteReport(reportId, mode) {
    const id = String(reportId || "").trim();
    if (!id) {
        return;
    }

    const reportMode = mode === "edit" ? "edit" : "view";
    window.location.href = `daily-site-report.html?reportId=${encodeURIComponent(id)}&mode=${reportMode}&return=admin`;
}
