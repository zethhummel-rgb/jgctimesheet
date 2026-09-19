(async function () {
  "use strict";
  const ui = JGCSafetyReport;
  const client = createJgcSupabaseClient();
  const worker = requireJgcWorker();
  const form = document.getElementById("injuryForm");
  const status = document.getElementById("saveStatus");
  const value = id => document.getElementById(id).value.trim();
  const selected = group => Array.from(document.querySelectorAll(`[name="${group}"]:checked`), box => box.value);
  const signatureRoles = ["Employee", "Employer representative", "Worker representative", "Project manager", "Site superintendent"];
  let savedRecord = null;
  let submitting = false;
  let recordId = ui.uuid();
  document.getElementById("currentUser").textContent = "Signed in as: " + (worker.display || worker.key);
  document.getElementById("accidentDate").value = ui.today();
  const reportId = new URLSearchParams(location.search).get("reportId");
  if (reportId) {
    form.hidden = true;
    status.textContent = "Loading saved report…";
    try {
      const { data, error } = await client.from("employee_injury_reports").select("*").eq("id", reportId).single();
      if (error || !data) throw new Error("Report unavailable. Check that you are signed in with access to this report.");
      await ui.view(data, "injury", document.querySelector(".container"));
    } catch (error) { status.textContent = error.message; }
    return;
  }

  // Add/remove rows preserve every entered person and action in the saved report.
  const rowDefinitions = {
    injuredPeople: [["name", "Full name"], ["jobTitle", "Job title"], ["company", "Employer / subcontractor"]],
    witnessRows: [["name", "Full name"], ["jobTitle", "Job title"], ["company", "Employer / subcontractor"], ["contact", "Phone / email"]],
    participantRows: [["name", "Full name"], ["jobTitle", "Job title"], ["company", "Employer / subcontractor"], ["contact", "Phone / email"]],
    actionRows: [["action", "Corrective action", "textarea"], ["assignedTo", "Assigned person / title"], ["targetDate", "Target completion", "date"], ["completedDate", "Completed date", "date"]]
  };
  function addRow(group) {
    const host = document.getElementById(group);
    const row = document.createElement("div"); row.className = "repeat-row";
    row.innerHTML = rowDefinitions[group].map(([key, label, type]) => `<label>${label}${type === "textarea" ? `<textarea data-key="${key}" maxlength="10000"></textarea>` : `<input data-key="${key}" type="${type || "text"}" maxlength="300">`}</label>`).join("") + '<button type="button" class="secondary remove-row">Remove row</button>';
    row.querySelector("button").onclick = () => row.remove();
    host.append(row);
  }
  document.querySelectorAll("[data-add-row]").forEach(button => button.onclick = () => addRow(button.dataset.addRow));
  ["witnessRows", "participantRows", "actionRows"].forEach(addRow);
  function rows(group) {
    return Array.from(document.getElementById(group).children, row => Object.fromEntries(Array.from(row.querySelectorAll("[data-key]"), input => [input.dataset.key, input.value.trim()]))).filter(row => Object.values(row).some(Boolean));
  }
  ["occurrence", "injury", "reportType"].forEach(group => {
    document.getElementById(group + "Choices").innerHTML = JGCInjuryOptions[group].map((label, index) => `<div class="choice"><label><input type="checkbox" name="${group}" value="${ui.escape(label)}">${ui.escape(label)}</label>${group === "reportType" ? `<label class="report-date">Report date<input type="date" id="reportDate${index}" aria-label="${ui.escape(label)} date"></label>` : ""}</div>`).join("");
  });
  document.querySelector('[name="reportType"]').checked = true;
  document.getElementById("reportDate0").value = ui.today();
  signatureRoles.forEach((role, index) => ui.signatureBox("signoff" + index, role, () => index === 0 ? ui.person("employeeWorker")?.displayName : ""));
  try {
    const { data, error } = await client.from("profiles").select("display_name,worker_key,email,account_status").eq("account_status", "approved").order("display_name", { ascending: true });
    const roster = (data || []).map(p => ({ workerName: normalizeWorkerName(p.worker_key || p.display_name || p.email), displayName: p.display_name || p.worker_key || p.email })).filter(p => p.workerName);
    ui.personPicker("employeeWorker", roster, normalizeWorkerName(worker.key));
    if (error) status.textContent = "Employee list unavailable. You can still enter a name manually.";
  } catch (_) {
    ui.personPicker("employeeWorker", [], ""); status.textContent = "Employee list unavailable. You can still enter a name manually.";
  }

  function collect() {
    const employee = ui.person("employeeWorker");
    const witnesses = rows("witnessRows");
    const signatures = signatureRoles.map((role, index) => {
      const signature = ui.signature("signoff" + index);
      return signature ? { ...signature, jobTitle: value("signoffTitle" + index) } : null;
    }).filter(Boolean);
    const details = {
      version: 1, employee, witnesses, signatures,
      employerName: value("employerName"), employerAddress: value("employerAddress"), employerCity: value("employerCity"), employerPhone: value("employerPhone"), employerEmail: value("employerEmail"),
      siteAddress: value("siteAddress"), occurrence: selected("occurrence"), occurrenceOther: value("occurrenceOther"),
      reportTypes: selected("reportType"), reportDates: JGCInjuryOptions.reportType.map((_, i) => value("reportDate" + i)), revised: document.getElementById("revisedReport").checked,
      injuredPeople: rows("injuredPeople"), participants: rows("participantRows"), sequenceOfEvents: value("sequenceOfEvents"), unsafeConditions: value("unsafeConditions"),
      injuryTypes: selected("injury"), injuryOther: value("injuryOther"), treatment: value("treatment"), actions: rows("actionRows"), blankExplanation: value("blankExplanation")
    };
    return {
      id: recordId, employee_worker: employee?.workerName || "", employee_display: employee?.displayName || "", employee_name: employee?.displayName || "",
      gender: value("gender"), date_of_birth: value("dateOfBirth") || null, job_classification: value("jobClassification"),
      accident_location: value("accidentLocation"), accident_date: value("accidentDate"), accident_time: value("accidentTime"), accident_description: value("accidentDescription"),
      bodily_injury: value("bodilyInjury"), prevention_recommendation: value("preventionRecommendation"), supervisor_name: value("supervisorName"),
      witnesses: witnesses.map(p => p.name).filter(Boolean).join("; "), reported_to_supervisor_at: value("reportedToSupervisorAt"),
      employee_signature: ui.signature("signoff0")?.printedName || "", signature_date: ui.signature("signoff0")?.date || null,
      created_by_worker: normalizeWorkerName(worker.key), created_by_name: worker.display || worker.key, report_details: details
    };
  }
  form.addEventListener("input", () => { form.classList.remove("show-errors"); });
  function validate() {
    form.classList.add("show-errors");
    if (!form.reportValidity()) { status.textContent = "Complete the highlighted required information."; return false; }
    if (!ui.person("employeeWorker")?.displayName) { status.textContent = "The employee name is required."; return false; }
    for (const id of ["accidentLocation", "accidentDescription"]) {
      if (!value(id)) { status.textContent = "Complete the highlighted required information."; document.getElementById(id).focus(); return false; }
    }
    return true;
  }
  document.getElementById("downloadReport").onclick = async () => {
    const button = document.getElementById("downloadReport"); button.disabled = true;
    try { await ui.download(savedRecord || { ...collect(), id: "Draft" }, "injury"); }
    catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  };
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submitting || savedRecord || !validate()) return;
    submitting = true;
    const button = document.getElementById("saveReport"); button.disabled = true;
    const record = collect();
    let acknowledgementFailed = false;
    try {
      // Prepare the complete PDF before saving; a logo failure cannot leave a partial submission.
      const pdfHtml = await ui.html(record, "injury");
      status.textContent = "Saving injury report…";
      const { error } = await client.from("employee_injury_reports").insert(record);
      if (error) throw new Error("The report could not be saved. Your entries are still here. Please try again.");
      savedRecord = record;
      // Freeze the submitted version so its downloaded PDF always matches the saved record.
      form.querySelectorAll("input,select,textarea,button").forEach(input => { input.disabled = true; });
      document.getElementById("downloadReport").disabled = false;
      button.textContent = "Report saved";
      if (!record.report_details.employee.manual) {
        try {
          const result = await client.from("employee_injury_acknowledgements").insert({ employee_injury_report_id: record.id, worker_name: record.employee_worker, worker_display_name: record.employee_name });
          acknowledgementFailed = Boolean(result.error);
        } catch (_) { acknowledgementFailed = true; }
      }
      const subject = "Employee Injury Report - " + record.employee_name + " - " + record.accident_date;
      await fetch("https://script.google.com/macros/s/AKfycbzPILTnOSzQcCkA6y5vSLxCH6i05Y2-ZHZAk09Und0YKiXZOYMppV4fvW3G6EgqOIZi/exec", {
        method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(withJgcSubcontractorEmailCopy({ subject, body: subject + "\nLocation: " + record.accident_location + "\nSee attached full report.", text: subject, pdfHtml, pdfFileName: `JGC-Injury-${record.accident_date}.pdf`, source: "employee_injury_report" }))
      });
      status.textContent = "Report saved. Email request sent; delivery cannot be confirmed here." + (acknowledgementFailed ? " Employee acknowledgement could not be created; contact an administrator." : "");
    } catch (error) {
      status.textContent = savedRecord ? "Report saved, but the email request failed. Download the PDF to send it manually." + (acknowledgementFailed ? " Employee acknowledgement also needs administrator attention." : "") : error.message;
    } finally {
      submitting = false; button.disabled = Boolean(savedRecord);
    }
  });
  window.addEventListener("beforeunload", event => {
    if (!savedRecord && (value("accidentDescription") || value("bodilyInjury"))) { event.preventDefault(); event.returnValue = ""; }
  });
})();
