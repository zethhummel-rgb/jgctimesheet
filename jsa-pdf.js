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

    let logoPromise;
    function loadLogo() {
        if (!logoPromise) logoPromise = new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = Math.min(1000, image.naturalWidth); canvas.height = Math.round(canvas.width * image.naturalHeight / image.naturalWidth);
                const context = canvas.getContext("2d");
                context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve({ data: canvas.toDataURL("image/png"), ratio: canvas.width / canvas.height });
            };
            image.onerror = () => { logoPromise = null; reject(new Error("The JGC logo could not load. Refresh and try again.")); };
            image.src = "logo.webp";
        });
        return logoPromise;
    }

    async function create(record, options = {}) {
        if (!window.jspdf?.jsPDF) throw new Error("The PDF library is not available.");
        const logo = await loadLogo();
        const doc = new window.jspdf.jsPDF({ unit: "mm", format: "letter", orientation: "landscape", compress: true });
        const width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight();
        const margin = 12, usable = width - margin * 2, bottom = height - 15;
        const green = [20, 65, 49], ink = [27, 43, 37], muted = [82, 97, 89], line = [181, 191, 185], pale = [242, 246, 243];
        const prepared = options.prepared === true;
        const status = prepared ? "PREPARED / DRAFT - NOT ASSIGNED" : "ISSUED JSA";
        let y;
        const text = (value, x, yy, size = 9, bold = false, color = ink) => {
            doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
            doc.text(String(value || ""), x, yy);
        };
        function header() {
            doc.addImage(logo.data, "PNG", margin, 9, 49, 49 / logo.ratio);
            text("JOB SAFETY ANALYSIS", 80, 17, 19, true, green);
            text(status, 80, 24, 8, true, muted);
            text(prepared ? "For advance review. Confirm site conditions and crew before activation." : "Review with the crew each day and when conditions change.", 80, 30, 8, false, muted);
            doc.setDrawColor(...green); doc.setLineWidth(.65); doc.line(margin, 36, width - margin, 36);
            y = 42;
        }
        function nextPage() { doc.addPage(); header(); }
        function section(title) {
            if (y + 14 > bottom) nextPage();
            text(title, margin, y, 10, true, green); y += 6;
        }
        function lines(value, w, size = 9) {
            doc.setFont("helvetica", "normal"); doc.setFontSize(size);
            return doc.splitTextToSize(String(value || "-"), w);
        }
        function paragraph(value) {
            const wrapped = lines(value, usable - 6, 8.5);
            while (wrapped.length) {
                if (y + 9 > bottom) nextPage();
                const count = Math.max(1, Math.floor((bottom - y - 6) / 3.8));
                const chunk = wrapped.splice(0, count), h = chunk.length * 3.8 + 6;
                doc.setDrawColor(...line); doc.setLineWidth(.2); doc.rect(margin, y, usable, h);
                chunk.forEach((l, i) => text(l, margin + 3, y + 5 + i * 3.8, 8.5)); y += h + 5;
            }
        }
        function cards(items) {
            const w = usable / items.length;
            const wrapped = items.map(([,value]) => lines(value, w - 8, 9));
            const h = 12 + Math.max(...wrapped.map(l => l.length)) * 4;
            if (y + h > bottom) nextPage();
            items.forEach(([label], i) => {
                doc.setDrawColor(...line); doc.setFillColor(...pale); doc.setLineWidth(.2); doc.rect(margin + i * w, y, w, h, "FD");
                text(label.toUpperCase(), margin + i * w + 4, y + 5, 7, true, muted);
                wrapped[i].forEach((l, n) => text(l, margin + i * w + 4, y + 11 + n * 4, 9));
            }); y += h + 5;
        }
        function table(headers, widths, rows, signatureColumn = -1) {
            function tableHeader() {
                let x = margin;
                headers.forEach((h, i) => { doc.setFillColor(...green); doc.rect(x, y, widths[i], 8, "F"); text(h, x + 3, y + 5.4, 8, true, [255,255,255]); x += widths[i]; });
                y += 8;
            }
            if (y + 22 > bottom) nextPage(); tableHeader();
            rows.forEach((row, rowIndex) => {
                const wrapped = row.cells.map((v, i) => i === signatureColumn ? [""] : lines(v, widths[i] - 6, 8.5));
                let offset = 0;
                const total = Math.max(...wrapped.map(l => l.length));
                while (offset < total) {
                    if (y + 14 > bottom) { nextPage(); tableHeader(); }
                    const count = Math.max(1, Math.min(total - offset, Math.floor((bottom - y - 6) / 3.8)));
                    const h = Math.max(signatureColumn >= 0 ? 12 : 13, count * 3.8 + 6);
                    let x = margin;
                    row.cells.forEach((_, i) => {
                        doc.setDrawColor(...line); doc.setLineWidth(.2); doc.setFillColor(...(rowIndex % 2 ? pale : [255,255,255])); doc.rect(x, y, widths[i], h, "FD");
                        wrapped[i].slice(offset, offset + count).forEach((l, n) => text(l, x + 3, y + 5 + n * 3.8, 8.5));
                        if (i === signatureColumn && offset === 0) drawSignature(doc, row.ack, x + 2, y + 1, widths[i] - 4, h - 2);
                        x += widths[i];
                    });
                    offset += count; y += h;
                }
            }); y += 6;
        }
        header();
        cards([["Project / Job", findFieldValue(record, /Project/i)], ["Location", findFieldValue(record, /Location/i)], ["Work date", findFieldValue(record, /^Date$/i) || record.inspection_date]]);
        cards([["Contractor", findFieldValue(record, /^Contractor$/i) || "John Gordon Construction"], ["Supervisor", findFieldValue(record, /Contractor Supervisor/i)], ["Reviewed by", findFieldValue(record, /Reviewed By/i)]]);
        const checked = findCheckedLabels(record, ["Lockout / Tag Out", "Hot Work", "Confined Space", "Elevated Work", "Excavation", "Crane / Hoisting / Rigging", "Other"]).filter(i => i.checked).map(i => i.label);
        if (checked.length) { section("WORK CONDITIONS / PERMITS IDENTIFIED"); paragraph(checked.join("  |  ")); }
        section("TASKS, HAZARDS & CONTROLS / PPE");
        const rows = getRows(record);
        table(["Task / job step", "Hazards", "Controls / PPE"], [usable * .23, usable * .29, usable * .48], (rows.length ? rows : [{step:"Not entered",hazard:"Not entered",action:"Not entered"}]).map((r, i) => ({cells:[`${i+1}. ${r.step}`,r.hazard,r.action]})));
        section(prepared ? "INTENDED CREW - NOT ASSIGNED / NO ACKNOWLEDGMENTS REQUESTED" : "CREW - PRINTED NAMES");
        paragraph(findFieldValue(record, /Crew Sign Off/i) || "Not selected");
        const acknowledgements = prepared ? [] : (options.acknowledgements || []);
        if (acknowledgements.length) {
            section("DIGITAL JSA ACKNOWLEDGMENTS");
            table(["Name", "Company", "Acknowledged", "Signature", "Email"], [usable*.22,usable*.16,usable*.18,usable*.24,usable*.20], acknowledgements.map(ack => ({ack,cells:[acknowledgementName(ack),ack.attendee_company || ack.company || "",formatAcknowledgementDate(ack.acknowledged_at) || "Pending","",ack.matched_employee_email || ack.email || ""]})),3);
        }
        const totalPages = doc.getNumberOfPages();
        for (let page = 1; page <= totalPages; page++) {
            doc.setPage(page); doc.setDrawColor(...line); doc.setLineWidth(.2); doc.line(margin,height-12,width-margin,height-12);
            text("JOHN GORDON CONSTRUCTION  |  " + status,margin,height-7,7,false,muted);
            text(`Page ${page} of ${totalPages}`,width-margin-24,height-7,7,false,muted);
        }
        return doc;
    }
    async function download(record, options = {}) {
        const doc = await create(record, options);
        doc.save(`jsa-${options.prepared ? "prepared-" : ""}${record.inspection_date || "inspection"}.pdf`);
    }
    window.JgcJsaPdf = { create, download };
}());
