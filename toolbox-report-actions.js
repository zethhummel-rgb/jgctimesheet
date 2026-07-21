(function(global) {
    "use strict";

    const EMAIL_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzPILTnOSzQcCkA6y5vSLxCH6i05Y2-ZHZAk09Und0YKiXZOYMppV4fvW3G6EgqOIZi/exec";

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatDate(value) {
        if (!value) {
            return "";
        }

        const date = new Date(String(value).length === 10 ? value + "T12:00:00" : value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString();
    }

    function formatDateTime(value) {
        if (!value) {
            return "";
        }

        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    }

    function getCrew(record) {
        return record && Array.isArray(record.crew) ? record.crew : [];
    }

    function getCrewName(person) {
        return person && (person.displayName || person.worker_display_name || person.workerName || person.worker_name || person.name) || "Worker";
    }

    function getAcknowledgements(record, rows) {
        if (Array.isArray(rows)) {
            return rows;
        }

        return record && Array.isArray(record.safety_acknowledgements)
            ? record.safety_acknowledgements
            : [];
    }

    function getAcknowledgementName(row) {
        return row && (row.attendee_name || row.worker_display_name || row.worker_name || row.name) || "Worker";
    }

    function buildEmailBody(record) {
        const crewLines = getCrew(record).map((person) => "- " + getCrewName(person));

        return [
            "Tool Box Talk Report",
            "",
            "Talk: " + (record.talk_title || ""),
            "Date: " + (record.report_date || ""),
            "Project: " + (record.project || ""),
            "Location: " + (record.location || ""),
            "Presenter: " + (record.presenter_name || ""),
            "Submitted by: " + (record.submitted_by_name || record.submitted_by_worker || ""),
            "",
            "Crew Onsite:",
            crewLines.length ? crewLines.join("\n") : "- None recorded",
            "",
            "What Was Talked About:",
            record.discussion_notes || "",
            "",
            "Hazards Discussed:",
            record.hazards_discussed || "",
            "",
            "Corrective Actions / Follow Up:",
            record.corrective_actions || ""
        ].join("\n");
    }

    function buildPdfHtml(record, acknowledgementRows) {
        const crewRows = getCrew(record).map((person) => `
            <tr>
                <td>${escapeHtml(getCrewName(person))}</td>
                <td>${escapeHtml(person.company || "")}</td>
            </tr>
        `).join("");
        const acknowledgements = getAcknowledgements(record, acknowledgementRows);
        const acknowledgementHtml = acknowledgements.length ? `
            <h3>Digital Acknowledgements</h3>
            <table>
                <thead><tr><th>Name</th><th>Company</th><th>Status</th><th>Acknowledged</th></tr></thead>
                <tbody>
                    ${acknowledgements.map((row) => `
                        <tr>
                            <td>${escapeHtml(getAcknowledgementName(row))}</td>
                            <td>${escapeHtml(row.attendee_company || row.company || "")}</td>
                            <td>${escapeHtml(row.acknowledgement_status || (row.acknowledged_at ? "Acknowledged" : "Pending"))}</td>
                            <td>${escapeHtml(formatDateTime(row.acknowledged_at))}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        ` : "";

        return `<!doctype html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>${escapeHtml(record.talk_title || "Tool Box Talk Report")}</title>
                <style>
                    @page { size: letter; margin: 16mm; }
                    body { font-family: Arial, sans-serif; color: #111; margin: 0; }
                    h1 { text-align: center; margin: 0 0 4px; }
                    h2 { text-align: center; margin: 0 0 18px; font-size: 18px; }
                    h3 { margin: 20px 0 8px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
                    th, td { border: 1px solid #555; padding: 7px; font-size: 12px; text-align: left; vertical-align: top; }
                    th { background: #e8ece8; }
                    .label { width: 30%; font-weight: bold; }
                    .section { min-height: 55px; white-space: pre-wrap; }
                </style>
            </head>
            <body>
                <h1>John Gordon Construction</h1>
                <h2>Tool Box Talk Report</h2>
                <table>
                    <tr><td class="label">Talk</td><td>${escapeHtml(record.talk_title || "")}</td></tr>
                    <tr><td class="label">Date</td><td>${escapeHtml(formatDate(record.report_date))}</td></tr>
                    <tr><td class="label">Project / Job</td><td>${escapeHtml(record.project || "")}</td></tr>
                    <tr><td class="label">Location</td><td>${escapeHtml(record.location || "")}</td></tr>
                    <tr><td class="label">Presenter / Reader</td><td>${escapeHtml(record.presenter_name || "")}</td></tr>
                    <tr><td class="label">Submitted By</td><td>${escapeHtml(record.submitted_by_name || record.submitted_by_worker || "")}</td></tr>
                    <tr><td class="label">Saved</td><td>${escapeHtml(formatDateTime(record.created_at))}</td></tr>
                    <tr><td class="label">What Was Talked About</td><td class="section">${escapeHtml(record.discussion_notes || "")}</td></tr>
                    <tr><td class="label">Hazards Discussed</td><td class="section">${escapeHtml(record.hazards_discussed || "")}</td></tr>
                    <tr><td class="label">Corrective Actions / Follow Up</td><td class="section">${escapeHtml(record.corrective_actions || "")}</td></tr>
                </table>
                <h3>Crew Onsite</h3>
                <table>
                    <thead><tr><th>Name</th><th>Company</th></tr></thead>
                    <tbody>${crewRows || '<tr><td colspan="2">No crew recorded.</td></tr>'}</tbody>
                </table>
                ${acknowledgementHtml}
            </body>
            </html>`;
    }

    function reportUrl(reportId, mode, returnTarget) {
        const params = new URLSearchParams({
            reportId: String(reportId || ""),
            mode: mode === "edit" ? "edit" : "view",
            return: returnTarget || "reports"
        });
        return "toolbox-talks.html?" + params.toString();
    }

    function openReport(reportId, mode, returnTarget) {
        global.location.href = reportUrl(reportId, mode, returnTarget);
    }

    function printReport(record, acknowledgementRows) {
        if (!record) {
            global.alert("This toolbox talk report could not be found.");
            return false;
        }

        const printWindow = global.open("", "_blank", "width=900,height=980");

        if (!printWindow) {
            global.alert("Popup blocked. Allow popups for this portal, then try again.");
            return false;
        }

        printWindow.document.write(buildPdfHtml(record, acknowledgementRows));
        printWindow.document.close();
        printWindow.focus();
        global.setTimeout(() => printWindow.print(), 250);
        return true;
    }

    async function emailReport(record, options) {
        const settings = options || {};

        if (!record) {
            if (!settings.silent) {
                global.alert("This toolbox talk report could not be found.");
            }
            return false;
        }

        const subject = "Tool Box Talk Report - " + (record.talk_title || "Toolbox Talk") + " - " + (record.report_date || "");
        const body = buildEmailBody(record);
        const payload = {
            subject,
            body,
            text: body,
            pdfHtml: buildPdfHtml(record, settings.acknowledgements || settings.acknowledgementRows),
            pdfFileName: subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") + ".pdf",
            source: "toolbox_talk_report"
        };
        const finalPayload = typeof global.withJgcSubcontractorEmailCopy === "function"
            ? global.withJgcSubcontractorEmailCopy(payload)
            : payload;

        try {
            await global.fetch(EMAIL_SCRIPT_URL, {
                method: "POST",
                mode: "no-cors",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify(finalPayload)
            });

            if (!settings.silent) {
                global.alert("Toolbox talk report emailed.");
            }
            return true;
        } catch (error) {
            if (!settings.silent) {
                global.alert("The toolbox talk report could not be emailed. Please try again.");
            }
            return false;
        }
    }

    global.JGCToolboxReports = Object.freeze({
        buildEmailBody,
        buildPdfHtml,
        emailReport,
        openReport,
        printReport,
        reportUrl
    });
})(window);
