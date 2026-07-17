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

function getAdminJsaReports() {
    return inspections.filter((inspection) =>
        String(inspection.inspection_type || "").toLowerCase().includes("jsa") ||
        String(inspection.inspection_type || "").toLowerCase().includes("job safety")
    );
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
    setAdminReportSubtabCount("toolbox", toolboxTalks.length);
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

    if (dailyList) {
        if (!dailySiteReports.length) {
            dailyList.textContent = "No daily site reports found.";
        } else {
            dailyList.innerHTML = `
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr><th>Date</th><th>Project</th><th>Submitted By</th><th>Saved</th></tr>
                        </thead>
                        <tbody>
                            ${dailySiteReports.slice(0, 50).map((report) => `
                                <tr>
                                    <td>${escapeHtml(formatDate(report.report_date))}</td>
                                    <td>${escapeHtml(report.project || "")}</td>
                                    <td>${escapeHtml(report.worker_display_name || report.worker_name || "")}</td>
                                    <td>${escapeHtml(formatDate(report.created_at))}</td>
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
                            <tr><th>Date</th><th>Completed By</th><th>Acknowledgements</th><th>Saved</th></tr>
                        </thead>
                        <tbody>
                            ${jsaReports.slice(0, 50).map((inspection) => `
                                <tr>
                                    <td>${escapeHtml(formatDate(inspection.inspection_date))}</td>
                                    <td>${escapeHtml(inspection.worker_display_name || inspection.worker_name || "")}</td>
                                    <td>${renderJsaReportAcknowledgements(inspection)}</td>
                                    <td>${escapeHtml(formatDate(inspection.created_at))}</td>
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
