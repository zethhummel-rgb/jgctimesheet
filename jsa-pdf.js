(function () {
    "use strict";

    function findFieldValue(record, labelPattern) {
        const fields = record.form_data && Array.isArray(record.form_data.fields) ? record.form_data.fields : [];
        const field = fields.find((item) => labelPattern.test(item.label || ""));
        return field ? field.value : "";
    }

    function findCheckedLabels(record, labels) {
        const fields = record.form_data && Array.isArray(record.form_data.fields) ? record.form_data.fields : [];
        return labels.map((label) => {
            const field = fields.find((item) => (item.label || "").toLowerCase().includes(label.toLowerCase()));
            return { label, checked: field ? field.value === "Yes" : false };
        });
    }

    function drawBoxText(doc, text, x, y, width, height, options = {}) {
        if (options.fill) {
            doc.setFillColor(options.fill[0], options.fill[1], options.fill[2]);
            doc.rect(x, y, width, height, "F");
        }
        doc.rect(x, y, width, height);
        doc.setFont("helvetica", options.bold ? "bold" : "normal");
        doc.setFontSize(options.fontSize || 8);
        const lines = doc.splitTextToSize(String(text || ""), width - 4);
        doc.text(lines.slice(0, options.maxLines || 3), x + 2, y + 5);
    }

    function getRows(record) {
        const rows = record.form_data && Array.isArray(record.form_data.rows) ? record.form_data.rows : [];
        return rows
            .map((row) => row.cells || [])
            .filter((cells) => cells.slice(0, 3).some((cell) => String(cell || "").trim()))
            .map((cells) => ({ step: cells[0] || "", hazard: cells[1] || "", action: cells[2] || "" }));
    }

    function acknowledgementName(acknowledgement) {
        return acknowledgement.attendee_name || acknowledgement.employee_name || acknowledgement.name || "Worker";
    }

    function formatAcknowledgementDate(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString([], {
            year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
        });
    }

    function drawAcknowledgementHeader(doc, margin, y, usable) {
        const fill = [230, 236, 230];
        drawBoxText(doc, "Digital JSA Acknowledgements", margin, y, usable, 9, { bold: true, fill, maxLines: 1 });
        y += 9;
        drawBoxText(doc, "Name", margin, y, usable * 0.25, 8, { bold: true, fill, maxLines: 1 });
        drawBoxText(doc, "Company", margin + usable * 0.25, y, usable * 0.17, 8, { bold: true, fill, maxLines: 1 });
        drawBoxText(doc, "Acknowledged", margin + usable * 0.42, y, usable * 0.16, 8, { bold: true, fill, maxLines: 1 });
        drawBoxText(doc, "Signature", margin + usable * 0.58, y, usable * 0.28, 8, { bold: true, fill, maxLines: 1 });
        drawBoxText(doc, "Email", margin + usable * 0.86, y, usable * 0.14, 8, { bold: true, fill, maxLines: 1 });
        return y + 8;
    }

    function drawSignature(doc, acknowledgement, x, y, width, height) {
        const strokes = typeof window.safetyAckSignatureStrokes === "function"
            ? window.safetyAckSignatureStrokes(acknowledgement)
            : [];
        if (!strokes.length) return;
        doc.setDrawColor(20, 20, 20);
        doc.setLineWidth(0.35);
        strokes.forEach((stroke) => {
            for (let index = 1; index < stroke.length; index += 1) {
                const from = stroke[index - 1];
                const to = stroke[index];
                doc.line(
                    x + 1 + from[0] * (width - 2), y + 1 + from[1] * (height - 4),
                    x + 1 + to[0] * (width - 2), y + 1 + to[1] * (height - 4)
                );
            }
        });
    }

    function drawAcknowledgements(doc, acknowledgements, margin, y, usable) {
        if (!acknowledgements.length) return y;
        if (y > 172) {
            doc.addPage();
            y = 12;
        } else {
            y += 5;
        }
        y = drawAcknowledgementHeader(doc, margin, y, usable);
        acknowledgements.forEach((ack) => {
            if (y > 185) {
                doc.addPage();
                y = drawAcknowledgementHeader(doc, margin, 12, usable);
            }
            const rowHeight = 14;
            const signatureX = margin + usable * 0.58;
            const signatureWidth = usable * 0.28;
            drawBoxText(doc, acknowledgementName(ack), margin, y, usable * 0.25, rowHeight, { fontSize: 7, maxLines: 2 });
            drawBoxText(doc, ack.attendee_company || ack.company || "", margin + usable * 0.25, y, usable * 0.17, rowHeight, { fontSize: 7, maxLines: 2 });
            drawBoxText(doc, formatAcknowledgementDate(ack.acknowledged_at), margin + usable * 0.42, y, usable * 0.16, rowHeight, { fontSize: 6, maxLines: 2 });
            drawBoxText(doc, "", signatureX, y, signatureWidth, rowHeight, { fontSize: 6, maxLines: 1 });
            drawSignature(doc, ack, signatureX, y, signatureWidth, rowHeight);
            drawBoxText(doc, ack.matched_employee_email || ack.email || "", margin + usable * 0.86, y, usable * 0.14, rowHeight, { fontSize: 6, maxLines: 2 });
            y += rowHeight;
        });
        return y;
    }

    function download(record, options = {}) {
        if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("The PDF library is not available.");
        const doc = new window.jspdf.jsPDF({ unit: "mm", format: "letter", orientation: "landscape" });
        const pageWidth = doc.internal.pageSize.getWidth();
        const margin = 10;
        let y = 10;
        const contractor = findFieldValue(record, /^Contractor$/i) || "John Gordon Construction";
        const project = findFieldValue(record, /Project/i);
        const location = findFieldValue(record, /Location/i);
        const date = findFieldValue(record, /^Date$/i) || record.inspection_date || "";
        const supervisor = findFieldValue(record, /Contractor Supervisor/i);
        const reviewedBy = findFieldValue(record, /Reviewed By/i);
        const crew = findFieldValue(record, /Crew Sign Off/i);
        const checklist = findCheckedLabels(record, [
            "Lockout / Tag Out", "Hot Work", "Confined Space", "Elevated Work",
            "Excavation", "Crane / Hoisting / Rigging", "Other"
        ]);
        const rows = getRows(record);
        const acknowledgements = Array.isArray(options.acknowledgements) ? options.acknowledgements : [];

        doc.setLineWidth(0.2);
        doc.setDrawColor(40, 40, 40);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(15);
        doc.text("John Gordon Construction- Job Safety Analysis Form", pageWidth / 2, y, { align: "center" });
        y += 6;
        doc.setFontSize(11);
        doc.text("Must be filled out Daily", pageWidth / 2, y, { align: "center" });
        y += 7;

        const usable = pageWidth - margin * 2;
        const topWidth = usable / 4;
        drawBoxText(doc, `Contractor:\n${contractor}`, margin, y, topWidth, 16, { bold: true });
        drawBoxText(doc, `Project/Job:\n${project}`, margin + topWidth, y, topWidth, 16, { bold: true });
        drawBoxText(doc, `Location:\n${location}`, margin + topWidth * 2, y, topWidth, 16, { bold: true });
        drawBoxText(doc, `Date:\n${date}`, margin + topWidth * 3, y, topWidth, 16, { bold: true });
        y += 16;

        const checklistText = checklist.map((item) => `${item.checked ? "[X]" : "[ ]"} ${item.label}`).join("   ");
        drawBoxText(doc, checklistText, margin, y, topWidth * 2, 22, { fontSize: 7 });
        drawBoxText(doc, `Contractor Supervisor:\n${supervisor}`, margin + topWidth * 2, y, topWidth, 22, { bold: true });
        drawBoxText(doc, `Reviewed By:\n${reviewedBy}`, margin + topWidth * 3, y, topWidth, 22, { bold: true });
        y += 22;
        drawBoxText(doc, `Crew Sign Off: All Individuals- Print and sign\n${crew}`, margin, y, usable, 18, { bold: true });
        y += 18;

        const columnOne = 78;
        const columnTwo = 88;
        const columnThree = usable - columnOne - columnTwo;
        const headerFill = [230, 236, 230];
        const drawHeader = () => {
            drawBoxText(doc, "Sequence of Basic Job Steps", margin, y, columnOne, 12, { bold: true, fill: headerFill });
            drawBoxText(doc, "Potential Hazards", margin + columnOne, y, columnTwo, 12, { bold: true, fill: headerFill });
            drawBoxText(doc, "Required Action or Procedure", margin + columnOne + columnTwo, y, columnThree, 12, { bold: true, fill: headerFill });
            y += 12;
        };
        drawHeader();

        const rowsToDraw = rows.length ? rows : Array.from({ length: 7 }, () => ({ step: "", hazard: "", action: "" }));
        rowsToDraw.forEach((row) => {
            if (y > 185) {
                doc.addPage();
                y = 12;
                drawHeader();
            }
            const lineCount = Math.max(
                doc.splitTextToSize(row.step, columnOne - 4).length,
                doc.splitTextToSize(row.hazard, columnTwo - 4).length,
                doc.splitTextToSize(row.action, columnThree - 4).length
            );
            const rowHeight = Math.max(16, Math.min(34, lineCount * 5 + 6));
            drawBoxText(doc, row.step, margin, y, columnOne, rowHeight, { fontSize: 8, maxLines: 5 });
            drawBoxText(doc, row.hazard, margin + columnOne, y, columnTwo, rowHeight, { fontSize: 8, maxLines: 5 });
            drawBoxText(doc, row.action, margin + columnOne + columnTwo, y, columnThree, rowHeight, { fontSize: 8, maxLines: 5 });
            y += rowHeight;
        });

        drawAcknowledgements(doc, acknowledgements, margin, y, usable);
        doc.save(`jsa-${record.inspection_date || "inspection"}.pdf`);
    }

    window.JgcJsaPdf = { download };
}());
