(function () {
  "use strict";
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const uuid = () => crypto.randomUUID();
  const people = new Map();
  const signatures = new Map();
  let logoPromise;

  function personPicker(id, roster, selected) {
    const select = document.getElementById(id);
    const manualKey = "manual:" + uuid();
    select.innerHTML = '<option value="">Select employee</option>' + roster.map(p => `<option value="${escape(p.workerName)}">${escape(p.displayName)}</option>`).join("") + '<option value="__manual__">Enter name manually / subcontractor</option>';
    if (roster.some(p => p.workerName === selected)) select.value = selected;
    const box = document.createElement("div");
    box.className = "manual-person";
    box.hidden = true;
    box.innerHTML = `<label for="${id}Name">Full name <span aria-hidden="true">*</span></label><input id="${id}Name" maxlength="150" autocomplete="name"><label for="${id}Company">Employer / subcontractor</label><input id="${id}Company" maxlength="150" placeholder="Company name"><small>Manual entry; no portal account is created.</small>`;
    select.after(box);
    select.addEventListener("change", () => {
      box.hidden = select.value !== "__manual__";
      document.getElementById(id + "Name").required = !box.hidden;
      if (!box.hidden) document.getElementById(id + "Name").focus();
    });
    people.set(id, () => select.value === "__manual__"
      ? { workerName: manualKey, displayName: document.getElementById(id + "Name").value.trim(), company: document.getElementById(id + "Company").value.trim(), manual: true }
      : { workerName: select.value, displayName: roster.find(p => p.workerName === select.value)?.displayName || "", company: "", manual: false });
  }

  function signatureImage(signature) {
    if (!signature || !Array.isArray(signature.strokes)) return "";
    const canvas = document.createElement("canvas");
    canvas.width = 600; canvas.height = 220;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 600, 220);
    ctx.strokeStyle = "#111"; ctx.lineWidth = 2.6; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const stroke of signature.strokes) {
      if (!Array.isArray(stroke) || stroke.length < 2) continue;
      ctx.beginPath();
      stroke.forEach((p, i) => {
        const x = Math.max(0, Math.min(1, Number(p[0]) || 0)) * 600;
        const y = Math.max(0, Math.min(1, Number(p[1]) || 0)) * 220;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    return canvas.toDataURL("image/png");
  }

  function signatureBox(id, role, name) {
    const host = document.getElementById(id);
    host.classList.add("signature-box");
    const render = () => {
      const sig = signatures.get(id);
      host.innerHTML = `<strong>${escape(role)}</strong>${sig ? `<img alt="${escape(role)} signature" src="${signatureImage(sig)}"><span>${escape(sig.printedName)} · ${escape(sig.date)}</span>` : '<span class="signature-empty">Sign with a finger, mouse or stylus</span>'}<div class="signature-controls"><button type="button" class="secondary" data-sign>${sig ? "Replace signature" : "Add signature"}</button>${sig ? '<button type="button" class="secondary" data-clear>Clear signature</button>' : ""}</div>`;
      host.querySelector("[data-sign]").onclick = () => JGCSafetySignature.open({
        recordLabel: role, attendeeName: sig?.printedName || (typeof name === "function" ? name() : ""),
        onSubmit: value => { signatures.set(id, { ...value, role, date: today(), signedAt: new Date().toISOString() }); render(); return { ok: true }; }
      });
      const clear = host.querySelector("[data-clear]");
      if (clear) clear.onclick = () => { signatures.delete(id); render(); };
    };
    render();
  }

  function logo() {
    if (!logoPromise) logoPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        resolve({ src: canvas.toDataURL("image/png"), ratio: canvas.width / canvas.height });
      };
      img.onerror = () => { logoPromise = null; reject(new Error("The JGC logo could not load. Please try again.")); };
      img.src = "logo.webp";
    });
    return logoPromise;
  }

  function table(title, headings, rows) { return { title, headings, rows: rows.length ? rows : [headings.map(() => "")] }; }
  function fields(title, pairs) { return table(title, ["Field", "Details"], pairs); }
  function blocks(record, kind) {
    const d = record.report_details || {};
    const signoffs = roles => roles.map(role => (d.signatures || []).find(s => s.role === role) || { role, printedName: "Not signed", date: "" });
    if (kind === "accident") {
      return [
        fields("1. Incident & people", [["Site / location", record.site_location], ["Date / time", [record.accident_date, record.accident_time].filter(Boolean).join(" · ")], ["Injured person", record.injured_worker_display], ["Employer / subcontractor", d.injuredPerson?.company], ["Report maker", record.report_maker_display], ["Report maker employer", d.reportMaker?.company], ["Job title / time at job", [record.job_title, record.time_on_job].filter(Boolean).join(" · ")], ["Injury location", record.injury_location]]),
        fields("2. Incident details", [["Activity before incident", record.activity_before_incident], ["Machine / tool", record.machine_or_tool], ["Operation", record.operation], ["How it occurred", record.incident_description], ["Objects / substances", record.objects_substances], ["Property damaged / owner", [record.property_damaged, record.property_owner].filter(Boolean).join(" · ")]]),
        fields("3. Injury & contributing factors", [["Body part", record.body_part_affected], ["Prior physical defects", [record.prior_physical_defects, record.prior_physical_defects_details].filter(Boolean).join(" · ")], ["Nature / extent", record.nature_extent], ["Contributing factors", (record.contributing_factors || []).join("; ")], ["PPE / safety training", record.trained_ppe], ["Cautioned about PPE / procedures", record.cautioned_ppe], ["Promptly reported", record.promptly_reported], ["Modified duty available", record.modified_duty_available]]),
        fields("4. Corrective actions", [["Prevention", record.corrective_action_prevent], ["Action taken", record.corrective_action_taken], ["Assigned to", record.corrective_action_taken_by], ["Action date", record.corrective_action_date], ["Supervisor", record.supervisor_name]]),
        { title: "5. Supervisor sign-off", signatures: d.version ? signoffs(["Supervisor"]) : d.signatures || [], legacy: record.supervisor_signature }
      ];
    }
    return [
      fields("1. Employer information", [["Employer / trade name", d.employerName], ["Address", d.employerAddress], ["City / province / postal code", d.employerCity], ["Foreman / supervisor", record.supervisor_name], ["Phone", d.employerPhone], ["Email", d.employerEmail]]),
      table("2. Injured persons", ["Name", "Job title", "Employer"], [[record.employee_name || record.employee_display, record.job_classification, d.employee?.company || d.employerName], ...(d.injuredPeople || []).map(p => [p.name, p.jobTitle, p.company])]),
      fields("3. Place, date & time", [["Site / location", record.accident_location], ["Site address / city / province / postal code", d.siteAddress], ["Date / time", [record.accident_date, record.accident_time].filter(Boolean).join(" · ")], ["Reported to supervisor", record.reported_to_supervisor_at]]),
      { title: "4. Type of occurrence", choices: window.JGCInjuryOptions.occurrence, selected: d.occurrence || [], other: d.occurrenceOther },
      table("5. Report type", ["Report", "Selected", "Date"], window.JGCInjuryOptions.reportType.map((label, i) => [label, (d.reportTypes || []).includes(label) ? "Yes" : "No", d.reportDates?.[i] || ""]).concat([["Revised report", d.revised ? "Yes" : "No", ""]])),
      table("6. Witnesses", ["Name", "Job title / employer", "Contact"], (d.witnesses || []).map(p => [p.name, [p.jobTitle, p.company].filter(Boolean).join(" / "), p.contact]).concat(!d.version && record.witnesses ? [[record.witnesses, "", ""]] : [])),
      table("7. Other investigation participants", ["Name", "Job title / employer", "Contact"], (d.participants || []).map(p => [p.name, [p.jobTitle, p.company].filter(Boolean).join(" / "), p.contact])),
      fields("8. Sequence of events", [["Events preceding the incident", d.sequenceOfEvents]]),
      fields("9. Contributing conditions & procedures", [["Unsafe conditions / acts / procedures", d.unsafeConditions]]),
      { title: "10. Nature of injury", choices: window.JGCInjuryOptions.injury, selected: d.injuryTypes || [], other: d.injuryOther },
      fields("11. Incident & injury details", [["How the incident occurred", record.accident_description], ["Bodily injury sustained", record.bodily_injury], ["First aid / treatment", d.treatment], ["Gender (if provided)", record.gender], ["Date of birth (if provided)", record.date_of_birth]]),
      table("12. Corrective actions", ["Action", "Assigned to / title", "Target date", "Completed"], (d.actions || []).map(a => [a.action, a.assignedTo, a.targetDate, a.completedDate])),
      fields("13. Prevention & outstanding information", [["Prevention recommendation", record.prevention_recommendation], ["Explanation of blank / pending items", d.blankExplanation]]),
      { title: "14. Sign-offs", signatures: d.version ? signoffs(["Employee", "Employer representative", "Worker representative", "Project manager", "Site superintendent"]) : d.signatures || [], legacy: !d.version ? [record.employee_signature, record.signature_date].filter(Boolean).join(" · ") : "" }
    ];
  }

  const title = kind => kind === "accident" ? "Supervisor Accident Investigation" : "Employee Injury & Incident Report";
  function contentHtml(record, kind, brand) {
    return `<header class="pdf-brand"><img src="${brand.src}" alt="John Gordon Construction"><div><p>JOHN GORDON CONSTRUCTION</p><h1>${title(kind)}</h1><small>Report date: ${escape(record.accident_date)} · Reference: ${escape(record.id || "Draft")}</small></div></header>` + blocks(record, kind).map(b => {
      let body;
      if (b.headings) body = `<table><thead><tr>${b.headings.map(h => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(v => `<td>${escape(v || "—")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      else if (b.choices) body = `<div class="pdf-checks">${b.choices.map(c => `<div>${b.selected.includes(c) ? "☑" : "☐"} ${escape(c)}</div>`).join("")}</div>${b.other ? `<p>Other: ${escape(b.other)}</p>` : ""}`;
      else body = b.signatures.length ? `<div class="pdf-signatures">${b.signatures.map(s => `<div><strong>${escape(s.role)}</strong>${s.strokes ? `<img src="${signatureImage(s)}" alt="Signature">` : '<div style="height:66px;border-bottom:1px solid #a8bbb0"></div>'}<p>${escape(s.printedName)} · ${escape(s.jobTitle || "")}<br>${escape(s.date)}</p></div>`).join("")}</div>` : `<p>${escape(b.legacy || "No signatures recorded")}</p>`;
      return `<section class="pdf-section"><h2>${escape(b.title)}</h2>${body}</section>`;
    }).join("");
  }
  const pdfCss = `@page{size:letter;margin:14mm}*{box-sizing:border-box}body{font:11px Arial,sans-serif;color:#172c24;background:#fff;margin:0}.pdf-brand{display:flex;align-items:center;gap:20px;border-bottom:3px solid #146c43;padding:0 0 15px;margin-bottom:18px}.pdf-brand img{width:130px;height:auto}.pdf-brand h1{font-size:22px;margin:5px 0}.pdf-brand p{font-size:10px;letter-spacing:1px}.pdf-section{margin-bottom:16px}.pdf-section h2{font-size:13px;background:#e5eee8;padding:8px;border-left:4px solid #146c43;break-after:avoid}.pdf-section table{width:100%;border-collapse:collapse;table-layout:fixed}.pdf-section th,.pdf-section td{border:1px solid #a8bbb0;text-align:left;padding:8px;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap;color:#172c24;background:white}.pdf-section th{background:#edf3ef}.pdf-section tr{break-inside:avoid}.pdf-checks{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:6px}.pdf-signatures{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pdf-signatures>div{border:1px solid #a8bbb0;padding:10px;break-inside:avoid}.pdf-signatures img{display:block;width:180px;height:66px;object-fit:contain}.pdf-signatures p{margin-bottom:0}`;
  async function html(record, kind) { return `<!doctype html><html><head><meta charset="utf-8"><title>${title(kind)}</title><style>${pdfCss}</style></head><body>${contentHtml(record, kind, await logo())}</body></html>`; }

  async function pdf(record, kind) {
    const brand = await logo();
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter", compress: true });
    const left = 40, width = 532, bottom = 741;
    let y;
    function header() {
      doc.addImage(brand.src, "PNG", left, 24, 106, 106 / brand.ratio);
      doc.setTextColor(20, 70, 47); doc.setFont("helvetica", "bold"); doc.setFontSize(16);
      doc.text(kind === "accident" ? ["Supervisor Accident", "Investigation"] : ["Employee Injury &", "Incident Report"], 170, 40);
      doc.setFontSize(8); doc.setFont("helvetica", "normal"); doc.setTextColor(60);
      doc.text(`Report date: ${record.accident_date || ""}`, 170, 74);
      doc.setDrawColor(20, 108, 67); doc.setLineWidth(2); doc.line(left, 94, left + width, 94);
      y = 108;
    }
    function space(height) { if (y + height > bottom) { doc.addPage(); header(); return true; } return false; }
    const clean = v => String(v || "-").replace(/\r/g, "").replace(/[\u2013\u2014]/g, "-").replace(/\u2022/g, "-");
    function heading(text) {
      space(104); doc.setFillColor(228, 239, 232); doc.rect(left, y, width, 24, "F");
      doc.setTextColor(20, 70, 47); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.text(text, left + 8, y + 16); y += 30;
    }
    function row(values, widths, bold) {
      doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(9);
      let lines = values.map((v, i) => doc.splitTextToSize(clean(v), widths[i] - 14));
      const wholeHeight = Math.max(...lines.map(a => a.length)) * 12 + 12;
      space(wholeHeight <= 300 ? wholeHeight : 60);
      // Split exceptionally long cells across pages without clipping their contents.
      while (lines.some(a => a.length)) {
        space(29);
        doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(9);
        const capacity = Math.max(1, Math.floor((bottom - y - 12) / 12));
        const count = Math.min(capacity, Math.max(...lines.map(a => a.length)));
        const height = count * 12 + 12;
        let x = left;
        lines.forEach((list, i) => {
          doc.setFillColor(...(bold ? [237, 243, 239] : [255, 255, 255]));
          doc.setDrawColor(172, 190, 179); doc.setLineWidth(0.5); doc.rect(x, y, widths[i], height, "FD");
          doc.setTextColor(23, 44, 36); doc.text(list.splice(0, count), x + 7, y + 14, { lineHeightFactor: 1.33 });
          x += widths[i];
        });
        y += height;
        if (lines.some(a => a.length)) { doc.addPage(); header(); }
      }
    }
    header();
    for (const b of blocks(record, kind)) {
      if (b.choices) space(40 + b.choices.length * 18 + (b.other ? 36 : 0));
      if (b.signatures?.length && b.signatures.length * 107 + 40 <= bottom - 108) space(b.signatures.length * 107 + 40);
      if (b.headings) {
        const widths = b.headings.length === 2 ? [150, 382] : b.headings.length === 4 ? [225, 145, 81, 81] : [190, 190, 152];
        doc.setFont("helvetica", "normal"); doc.setFontSize(9);
        const height = 60 + b.rows.reduce((sum, r) => sum + 12 + Math.max(...r.map((v, i) => doc.splitTextToSize(clean(v), widths[i] - 14).length)) * 12, 0);
        if (height <= bottom - 108) space(height);
      }
      heading(b.title);
      if (b.headings) {
        const widths = b.headings.length === 2 ? [150, 382] : b.headings.length === 4 ? [225, 145, 81, 81] : [190, 190, 152];
        row(b.headings, widths, true);
        for (const r of b.rows) row(r, widths, false);
      } else if (b.choices) {
        for (const c of b.choices) {
          space(23); doc.setDrawColor(66); doc.setLineWidth(0.8); doc.rect(left + 7, y + 2, 8, 8);
          if (b.selected.includes(c)) { doc.line(left + 8, y + 3, left + 14, y + 9); doc.line(left + 14, y + 3, left + 8, y + 9); }
          doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(23, 44, 36);
          doc.text(c, left + 23, y + 10); y += 18;
        }
        if (b.other) row(["Other", b.other], [150, 382], false);
      } else if (b.signatures.length) {
        for (const s of b.signatures) {
          space(107); doc.setDrawColor(172, 190, 179); doc.rect(left, y, width, 99);
          doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.text(clean(s.role), left + 10, y + 16);
          if (s.strokes) doc.addImage(signatureImage(s), "PNG", left + 10, y + 23, 170, 62);
          else { doc.setDrawColor(172, 190, 179); doc.line(left + 10, y + 80, left + 180, y + 80); }
          doc.setFont("helvetica", "normal"); doc.setFontSize(9);
          doc.text(doc.splitTextToSize(clean(s.printedName) + "\n" + (s.jobTitle || "") + "\n" + clean(s.date), 290), left + 205, y + 37);
          y += 107;
        }
      } else row(["Sign-off", b.legacy || "No signatures recorded"], [150, 382], false);
      y += 13;
    }
    const count = doc.getNumberOfPages();
    for (let page = 1; page <= count; page++) {
      doc.setPage(page); doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(85);
      doc.text(`JGC | Confidential safety report | ${record.id || "Draft"}`, left, 769);
      doc.text(`${page} / ${count}`, 572, 769, { align: "right" });
    }
    return doc;
  }
  async function download(record, kind) {
    const doc = await pdf(record, kind);
    doc.save(`JGC-${kind === "accident" ? "Supervisor" : "Employee-Injury"}-${record.accident_date || today()}-${record.id || "draft"}.pdf`);
  }
  async function view(record, kind, host) {
    const brand = await logo();
    host.innerHTML = `<div class="saved-report-heading"><h2>Saved report</h2><button type="button" id="downloadSavedReport">Download PDF</button><a href="reports.html">Reports</a></div><iframe title="Saved safety report" class="saved-report-frame" sandbox="allow-same-origin"></iframe>`;
    host.querySelector("iframe").srcdoc = `<!doctype html><html><head><style>${pdfCss}</style></head><body>${contentHtml(record, kind, brand)}</body></html>`;
    host.querySelector("#downloadSavedReport").onclick = async () => {
      const button = host.querySelector("#downloadSavedReport"); button.disabled = true;
      try { await download(record, kind); } catch (error) { alert(error.message); } finally { button.disabled = false; }
    };
  }
  window.JGCInjuryOptions = {
    occurrence: ["Death", "Serious injury", "Structural failure / collapse", "Hazardous substance release", "Blasting / explosives incident", "Fall protection / tie-off failure", "Falling object", "Minor injury", "Near miss / potential serious injury", "Security procedure breach", "Other"],
    reportType: ["Incident report", "Interim corrective action", "Full investigation", "Full corrective action"],
    injury: ["Life-threatening injury / loss of consciousness", "Major broken bone", "Crush injury", "Major cut / bleeding", "Amputation", "Penetrating eye / head / body injury", "Severe burn", "Breathing difficulty / lung injury", "Internal injury / bleeding", "Loss of sight / hearing / touch", "CPR / critical intervention", "Minor cut / abrasion", "Chemical exposure / heat or cold stress", "Other"]
  };
  window.JGCSafetyReport = { escape, today, uuid, personPicker, person: id => people.get(id)?.(), signatureBox, signature: id => signatures.get(id), signatureImage, blocks, html, pdf, download, view };
})();
