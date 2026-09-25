// Shared by the admin and employee write-up pages: labels, on-screen report and the JGC-branded PDF.
(function () {
  "use strict";
  const CATEGORIES = [
    ["lateness_attendance", "Lateness / attendance"],
    ["sent_home", "Sent home"],
    ["behaviour_attitude", "Behaviour / attitude"],
    ["ppe_harness", "PPE / harness violation"],
    ["safety_violation", "Safety violation"],
    ["failure_to_follow_direction", "Failure to follow direction"],
    ["other", "Other / custom issue"]
  ];
  const STATUS = { draft: "Draft", sent: "Awaiting acknowledgment", acknowledged: "Acknowledged", voided: "Voided" };
  const ACK_STATEMENT = "Signing confirms that I received and reviewed this write-up. It does not necessarily mean I agree with it.";
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const label = key => (CATEGORIES.find(c => c[0] === key) || [key, key])[1];
  const BADGE_TONE = { draft: "info", sent: "warning", acknowledged: "success", voided: "danger" };
  // Design-system status badge; `text` overrides the label (the employee page says "Needs your acknowledgment").
  const badge = (status, text) => `<span class="jgc-badge jgc-badge--${BADGE_TONE[status] || "info"}">${escape(text || STATUS[status] || status)}</span>`;

  function issueText(payload) {
    return (payload.categories || []).map(key => key === "other" && payload.custom_issue ? "Other: " + payload.custom_issue : label(key)).join(", ");
  }
  function locationText(payload) {
    if (payload.location_mode === "job" && payload.job) {
      const job = payload.job;
      return [job.job_number, job.customer, job.job_name, job.job_type].filter(Boolean).join(" — ") + (payload.location ? " (" + payload.location + ")" : "");
    }
    return payload.location || "";
  }
  function formatDate(value) {
    if (!value) return "";
    const date = String(value).length === 10 ? new Date(value + "T12:00:00") : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
  }
  function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-CA", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" });
  }
  function incidentWhen(payload) {
    return [formatDate(payload.incident_date), payload.incident_time].filter(Boolean).join(" at ");
  }

  function signatureImage(strokes, width = 600, height = 220) {
    if (!Array.isArray(strokes)) return "";
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#111"; ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const stroke of strokes) {
      if (!Array.isArray(stroke) || stroke.length < 2) continue;
      ctx.beginPath();
      stroke.forEach((point, index) => {
        const x = Math.max(0, Math.min(1, Number(point[0]) || 0)) * width;
        const y = Math.max(0, Math.min(1, Number(point[1]) || 0)) * height;
        if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    return canvas.toDataURL("image/png");
  }

  // Sections shared by the screen view and the PDF, so both always show the same facts.
  function sections(record) {
    const { writeup, version, acknowledgement } = record;
    const p = version.payload || {};
    return [
      ["Employee & incident", [
        ["Employee", writeup.employee_name],
        ["Issue type", issueText(p)],
        ["Date / time of incident", incidentWhen(p)],
        ["Job / location", locationText(p)],
        ["Issued by", version.created_by_name || writeup.created_by_name],
        ["Sent to employee", formatDateTime(version.sent_at) || "Not sent (draft)"]
      ]],
      ["Factual description", [["", p.description]]],
      ["Action taken", [["", p.action_taken]]],
      ["Corrective expectations", [["", p.expectations]]],
      ["Follow-up", [["Follow-up date", formatDate(p.follow_up_date) || "None set"], ["Follow-up notes", p.follow_up_notes || "None"]]],
      ["Employee acknowledgment", acknowledgement ? [
        ["Statement", ACK_STATEMENT],
        ["Printed name", acknowledgement.printed_name],
        ["Acknowledged", formatDateTime(acknowledgement.acknowledged_at)],
        ["Employee comments", acknowledgement.employee_comment || "None"]
      ] : [["Status", writeup.status === "voided" ? "Not acknowledged (voided)" : version.sent_at ? "Not yet acknowledged" : "Draft - not sent"]]]
    ];
  }

  function reportHtml(record) {
    const { writeup, version, acknowledgement, versions = [], acknowledgements = [] } = record;
    const voided = writeup.status === "voided"
      ? `<p class="jgc-notice jgc-notice--danger writeup-voided" role="note"><strong>Voided ${escape(formatDateTime(writeup.voided_at))}.</strong> ${escape(writeup.void_reason || "")}</p>` : "";
    const body = sections(record).map(([title, rows]) => `<section class="jgc-list-card writeup-section"><h3>${escape(title)}</h3>${rows.map(([name, value]) => name
      ? `<div class="writeup-row"><span>${escape(name)}</span><p>${escape(value || "—")}</p></div>`
      : `<p class="writeup-text">${escape(value || "—")}</p>`).join("")}${title === "Employee acknowledgment" && acknowledgement
      ? `<img class="writeup-signature" alt="Signature of ${escape(acknowledgement.printed_name)}" src="${signatureImage(acknowledgement.signature)}">` : ""}</section>`).join("");
    const history = versions.length > 1 || acknowledgements.length ? `<section class="jgc-list-card writeup-section"><h3>History</h3><ul class="writeup-history">${versions.slice().sort((a, b) => b.version - a.version).map(v => {
      const ack = acknowledgements.find(a => a.version === v.version);
      return `<li><strong>Version ${v.version}</strong> · ${escape(v.sent_at ? "sent " + formatDateTime(v.sent_at) : "draft")} · ${escape(v.created_by_name)}${v.change_note ? `<br>Change: ${escape(v.change_note)}` : ""}<br>${ack ? "Acknowledged " + escape(formatDateTime(ack.acknowledged_at)) + " by " + escape(ack.printed_name) : "Not acknowledged"}</li>`;
    }).join("")}</ul></section>` : "";
    return `${voided}<div class="writeup-meta">${badge(writeup.status)}<span>Version ${version.version}</span></div>${body}${history}`;
  }

  // Same visual language as the JSA PDF (jsa-pdf.js): logo, green title and rule, label cards,
  // green section headings, bordered text boxes, green-header tables and a ruled footer.
  let logoPromise;
  function logo() {
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

  async function pdf(record) {
    if (!window.jspdf?.jsPDF) throw new Error("The PDF library is not available.");
    const { writeup, version, acknowledgement, versions = [], acknowledgements = [] } = record;
    const p = version.payload || {};
    const brand = await logo();
    const doc = new window.jspdf.jsPDF({ unit: "mm", format: "letter", orientation: "portrait", compress: true });
    const width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight();
    const margin = 12, usable = width - margin * 2, bottom = height - 15;
    const green = [20, 65, 49], ink = [27, 43, 37], muted = [82, 97, 89], line = [181, 191, 185], pale = [242, 246, 243];
    const statusLine = (STATUS[writeup.status] || writeup.status).toUpperCase() + "  |  VERSION " + version.version;
    const clean = v => String(v ?? "").replace(/\r/g, "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
    let y;
    const text = (value, x, yy, size = 9, bold = false, color = ink) => {
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
      doc.text(clean(value), x, yy);
    };
    function header() {
      doc.addImage(brand.data, "PNG", margin, 9, 49, 49 / brand.ratio);
      text("EMPLOYEE WRITE-UP", 72, 17, 19, true, green);
      text(statusLine, 72, 24, 8, true, muted);
      text("Confidential. Visible only to JGC administrators and the employee named.", 72, 30, 8, false, muted);
      doc.setDrawColor(...green); doc.setLineWidth(.65); doc.line(margin, 36, width - margin, 36);
      y = 42;
    }
    function nextPage() { doc.addPage(); header(); }
    function section(title) {
      if (y + 16 > bottom) nextPage();
      text(title, margin, y, 10, true, green); y += 6;
    }
    function lines(value, w, size = 9) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(size);
      return doc.splitTextToSize(clean(value) || "-", w);
    }
    function paragraph(value) {
      const wrapped = lines(value, usable - 6, 8.5);
      if (wrapped.length * 3.8 + 6 <= bottom - 42 && y + wrapped.length * 3.8 + 6 > bottom) nextPage();
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
      const wrapped = items.map(([, value]) => lines(value, w - 8, 9));
      const h = 12 + Math.max(...wrapped.map(l => l.length)) * 4;
      if (y + h > bottom) nextPage();
      items.forEach(([label], i) => {
        doc.setDrawColor(...line); doc.setFillColor(...pale); doc.setLineWidth(.2); doc.rect(margin + i * w, y, w, h, "FD");
        text(label.toUpperCase(), margin + i * w + 4, y + 5, 7, true, muted);
        wrapped[i].forEach((l, n) => text(l, margin + i * w + 4, y + 11 + n * 4, 9));
      });
      y += h + 5;
    }
    function drawSignature(strokes, x, yy, w, h) {
      doc.setDrawColor(20, 20, 20); doc.setLineWidth(.35);
      (Array.isArray(strokes) ? strokes : []).forEach(stroke => {
        for (let i = 1; i < stroke.length; i += 1) {
          doc.line(x + 1 + stroke[i - 1][0] * (w - 2), yy + 1 + stroke[i - 1][1] * (h - 4), x + 1 + stroke[i][0] * (w - 2), yy + 1 + stroke[i][1] * (h - 4));
        }
      });
    }
    function table(headers, widths, rows, signatureColumn = -1) {
      function tableHeader() {
        let x = margin;
        headers.forEach((h, i) => { doc.setFillColor(...green); doc.rect(x, y, widths[i], 8, "F"); text(h, x + 3, y + 5.4, 8, true, [255, 255, 255]); x += widths[i]; });
        y += 8;
      }
      if (y + 22 > bottom) nextPage();
      tableHeader();
      rows.forEach((row, rowIndex) => {
        const wrapped = row.cells.map((v, i) => i === signatureColumn ? [""] : lines(v, widths[i] - 6, 8.5));
        const total = Math.max(...wrapped.map(l => l.length));
        const minimum = signatureColumn >= 0 && row.signature ? 20 : 13;
        if (y + Math.max(minimum, total * 3.8 + 6) > bottom && total * 3.8 + 6 <= bottom - 50) { nextPage(); tableHeader(); }
        let offset = 0;
        while (offset < total) {
          if (y + 14 > bottom) { nextPage(); tableHeader(); }
          const count = Math.max(1, Math.min(total - offset, Math.floor((bottom - y - 6) / 3.8)));
          const h = Math.max(minimum, count * 3.8 + 6);
          let x = margin;
          row.cells.forEach((_, i) => {
            doc.setDrawColor(...line); doc.setLineWidth(.2); doc.setFillColor(...(rowIndex % 2 ? pale : [255, 255, 255])); doc.rect(x, y, widths[i], h, "FD");
            wrapped[i].slice(offset, offset + count).forEach((l, n) => text(l, x + 3, y + 5 + n * 3.8, 8.5));
            if (i === signatureColumn && offset === 0 && row.signature) drawSignature(row.signature, x + 2, y + 1, widths[i] - 4, h - 2);
            x += widths[i];
          });
          offset += count; y += h;
        }
      });
      y += 6;
    }

    header();
    if (writeup.status === "voided") {
      doc.setFillColor(253, 232, 232); doc.setDrawColor(170, 30, 30); doc.setLineWidth(.3); doc.rect(margin, y, usable, 10, "FD");
      text(`VOIDED ${formatDateTime(writeup.voided_at)}  |  ${writeup.void_reason || ""}`.slice(0, 120), margin + 3, y + 6.5, 9, true, [150, 20, 20]);
      y += 15;
    }
    cards([["Employee", writeup.employee_name], ["Incident date / time", incidentWhen(p)], ["Issued by", version.created_by_name || writeup.created_by_name]]);
    cards([["Issue type", issueText(p)], ["Job / location", locationText(p)], ["Sent to employee", formatDateTime(version.sent_at) || "Not sent (draft)"]]);
    section("FACTUAL DESCRIPTION"); paragraph(p.description);
    section("ACTION TAKEN"); paragraph(p.action_taken);
    section("CORRECTIVE EXPECTATIONS"); paragraph(p.expectations);
    section("FOLLOW-UP");
    cards([["Follow-up date", formatDate(p.follow_up_date) || "None set"], ["Follow-up notes", p.follow_up_notes || "None"]]);
    section("EMPLOYEE ACKNOWLEDGMENT");
    paragraph(ACK_STATEMENT);
    if (acknowledgement) {
      table(["Printed name", "Acknowledged", "Signature", "Employee comments"], [usable * .22, usable * .2, usable * .24, usable * .34],
        [{ signature: acknowledgement.signature, cells: [acknowledgement.printed_name, formatDateTime(acknowledgement.acknowledged_at), "", acknowledgement.employee_comment || "None"] }], 2);
    } else paragraph(writeup.status === "voided" ? "Not acknowledged (voided)." : version.sent_at ? "Not yet acknowledged." : "Draft - not sent to the employee.");
    if (versions.length > 1 || acknowledgements.length) {
      section("VERSION HISTORY");
      table(["Version", "Sent / by", "Change", "Acknowledged", "Signature"], [usable * .1, usable * .24, usable * .24, usable * .22, usable * .2],
        versions.slice().sort((a, b) => a.version - b.version).map(v => {
          const ack = acknowledgements.find(a => a.version === v.version);
          return { signature: ack ? ack.signature : null, cells: [String(v.version), (v.sent_at ? formatDateTime(v.sent_at) : "Draft") + "\n" + (v.created_by_name || ""), v.change_note || (v.version === 1 ? "Original" : "-"), ack ? formatDateTime(ack.acknowledged_at) + "\n" + ack.printed_name : "Not acknowledged", ""] };
        }), 4);
    }
    const totalPages = doc.getNumberOfPages();
    for (let page = 1; page <= totalPages; page++) {
      doc.setPage(page); doc.setDrawColor(...line); doc.setLineWidth(.2); doc.line(margin, height - 12, width - margin, height - 12);
      text("JOHN GORDON CONSTRUCTION  |  EMPLOYEE WRITE-UP - CONFIDENTIAL  |  " + writeup.id, margin, height - 7, 7, false, muted);
      text(`Page ${page} of ${totalPages}`, width - margin - 20, height - 7, 7, false, muted);
    }
    return doc;
  }

  async function download(record) {
    const doc = await pdf(record);
    const name = String(record.writeup.employee_name || "Employee").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    doc.save(`JGC-Write-Up-${name}-${record.version.payload?.incident_date || "undated"}-v${record.version.version}.pdf`);
  }

  // Loads one write-up with its versions and acknowledgements; RLS limits this to admins and the employee.
  async function load(client, id) {
    const [header, versions, acks] = await Promise.all([
      client.from("employee_writeups").select("*").eq("id", id).maybeSingle(),
      client.from("employee_writeup_versions").select("*").eq("writeup_id", id).order("version"),
      client.from("employee_writeup_acknowledgements").select("*").eq("writeup_id", id).order("version")
    ]);
    for (const result of [header, versions, acks]) if (result.error) throw result.error;
    if (!header.data) return null;
    const version = versions.data.find(v => v.version === header.data.current_version) || versions.data[versions.data.length - 1];
    if (!version) return null;
    return { writeup: header.data, version, versions: versions.data, acknowledgements: acks.data, acknowledgement: acks.data.find(a => a.version === version.version) || null };
  }

  window.JGCWriteUps = { CATEGORIES, STATUS, ACK_STATEMENT, escape, label, badge, issueText, locationText, formatDate, formatDateTime, reportHtml, pdf, download, load };
}());
