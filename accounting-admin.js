(function() {
  "use strict";

  const PAY_DATE_ANCHOR = "2026-08-20";
  const REQUIRED_TEMPLATE_SHEETS = ["Aug 8", "Jobs Week 1", "Aug 15", "Jobs Week 2", "Summary", "Stewart", "Pay Period"];
  const state = {
    client: null,
    user: null,
    profile: null,
    payDate: "",
    periodDates: null,
    period: null,
    profiles: [],
    workers: [],
    accessRows: [],
    rates: [],
    submissions: [],
    entries: [],
    jobs: [],
    exports: [],
    template: null,
    loading: false
  };
  const elements = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeText(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalized(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isoDate(value) {
    return String(value || "").slice(0, 10);
  }

  function utcDate(value) {
    const parts = isoDate(value).split("-").map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
  }

  function addDays(value, days) {
    const date = utcDate(value);
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  }

  function daysBetween(left, right) {
    return Math.round((utcDate(right).getTime() - utcDate(left).getTime()) / 86400000);
  }

  function torontoToday() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "America/Toronto"
    }).formatToParts(new Date()).reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function currentPayDate() {
    const periods = Math.ceil(daysBetween(PAY_DATE_ANCHOR, torontoToday()) / 14);
    return addDays(PAY_DATE_ANCHOR, periods * 14);
  }

  function periodDates(payDate) {
    return {
      payDate,
      weekOneStart: addDays(payDate, -18),
      weekOneEnd: addDays(payDate, -12),
      weekTwoStart: addDays(payDate, -11),
      weekTwoEnd: addDays(payDate, -5)
    };
  }

  function formatDate(value, includeYear) {
    if (!value) return "-";
    return new Intl.DateTimeFormat("en-CA", {
      month: "short",
      day: "numeric",
      year: includeYear === false ? undefined : "numeric",
      timeZone: "UTC"
    }).format(utcDate(value));
  }

  function formatDateTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/Toronto"
    }).format(date);
  }

  function number(value) {
    const result = Number(value || 0);
    return Number.isFinite(result) ? result : 0;
  }

  function hours(value) {
    return number(value).toFixed(2);
  }

  function money(value) {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(number(value));
  }

  function label(value) {
    return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function updateIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function showNotice(message, kind) {
    elements.notice.textContent = message || "";
    elements.notice.className = [
      "accounting-notice",
      "jgc-notice",
      kind === "warning" ? "jgc-notice--warning" : "",
      kind === "error" ? "jgc-notice--danger" : ""
    ].filter(Boolean).join(" ");
    elements.notice.hidden = !message;
  }

  function setLoading(loading) {
    state.loading = loading;
    document.body.classList.toggle("accounting-loading", loading);
    [elements.refresh, elements.previousPeriod, elements.nextPeriod, elements.currentPeriod].forEach((button) => {
      if (button) button.disabled = loading;
    });
  }

  function requireResult(result, labelText) {
    if (result && result.error) {
      throw new Error(`${labelText}: ${result.error.message || "request failed"}`);
    }
    return result ? result.data : null;
  }

  function profileById(id) {
    return state.profiles.find((profile) => profile.id === id) || null;
  }

  function employeeName(profileId, fallback) {
    const profile = profileById(profileId);
    return profile ? profile.display_name : (fallback || "Unmatched Employee");
  }

  function accountingProfileIds() {
    const enabledWorkerIds = new Set(state.accessRows
      .filter((row) => row.feature_key === "accounting" && row.enabled !== false)
      .map((row) => row.worker_id));
    return new Set(state.workers
      .filter((worker) => worker.profile_id && worker.approved !== false && enabledWorkerIds.has(worker.id))
      .map((worker) => worker.profile_id));
  }

  function isAccountingProfile(profileId) {
    return Boolean(profileId) && accountingProfileIds().has(profileId);
  }

  function ratesFor(profileId) {
    return state.rates.filter((rate) => rate.profile_id === profileId)
      .sort((left, right) => isoDate(right.effective_from).localeCompare(isoDate(left.effective_from)));
  }

  function rateFor(profileId, workDate) {
    return ratesFor(profileId).find((rate) => isoDate(rate.effective_from) <= isoDate(workDate)) || null;
  }

  function selectedSubmissions() {
    const selected = new Map();
    state.submissions.filter((submission) => isAccountingProfile(submission.profile_id)).sort((left, right) => {
      return String(left.submitted_at || "").localeCompare(String(right.submitted_at || ""))
        || number(left.source_revision) - number(right.source_revision);
    }).forEach((submission) => {
      const owner = submission.profile_id || `name:${normalized(submission.worker_name)}`;
      selected.set(`${owner}|${isoDate(submission.week_start)}`, submission);
    });
    return Array.from(selected.values());
  }

  function selectedEntries() {
    const selectedIds = new Set(selectedSubmissions().map((submission) => submission.id));
    return state.entries.filter((entry) => selectedIds.has(entry.submission_id) && entry.is_current !== false);
  }

  function reviewEmployees() {
    const employees = new Map();
    selectedSubmissions().forEach((submission) => {
      const key = submission.profile_id || `name:${normalized(submission.worker_name)}`;
      if (!employees.has(key)) {
        employees.set(key, {
          profileId: submission.profile_id || "",
          key,
          name: employeeName(submission.profile_id, submission.worker_name)
        });
      }
    });
    return Array.from(employees.values()).sort((left, right) => left.name.localeCompare(right.name));
  }

  function expectedProfiles() {
    const included = accountingProfileIds();
    return state.profiles.filter((profile) => included.has(profile.id))
      .sort((left, right) => String(left.display_name || "").localeCompare(String(right.display_name || "")));
  }

  function getValidation() {
    const submissions = selectedSubmissions();
    const entries = selectedEntries();
    const expected = expectedProfiles();
    const submissionKeys = new Set(submissions.map((submission) => `${submission.profile_id}|${isoDate(submission.week_start)}`));
    const missing = [];
    expected.forEach((profile) => {
      [state.periodDates.weekOneStart, state.periodDates.weekTwoStart].forEach((weekStart) => {
        if (!submissionKeys.has(`${profile.id}|${weekStart}`)) {
          missing.push({ profile, weekStart });
        }
      });
    });
    const workEntries = entries.filter((entry) => entry.entry_type === "work");
    const unmatched = workEntries.filter((entry) => entry.job_match_status === "unmatched");
    const unknownOwners = workEntries.filter((entry) => !entry.profile_id);
    const missingRateEntries = workEntries.filter((entry) => !rateFor(entry.profile_id, entry.work_date));
    const missingRateProfiles = Array.from(new Set(missingRateEntries.map((entry) => entry.profile_id))).filter(Boolean);
    const discrepancies = submissions.filter((submission) => {
      const ignoredPlaceholderHours = entries
        .filter((entry) => entry.submission_id === submission.id
          && entry.entry_type !== "work"
          && Math.abs(number(entry.original_hours) - 0.01) < 0.001)
        .reduce((sum, entry) => sum + number(entry.original_hours), 0);
      const storedWorkHours = number(submission.source_total_hours) - ignoredPlaceholderHours;
      return Math.abs(storedWorkHours - number(submission.normalized_work_hours)) > 0.011;
    });
    const leaveEntries = entries.filter((entry) => entry.entry_type !== "work");
    const blockFinal = [];
    if (!state.template) blockFinal.push("approved workbook template");
    if (!workEntries.length) blockFinal.push("submitted work hours");
    if (unknownOwners.length) blockFinal.push(`${unknownOwners.length} unmatched employee owner${unknownOwners.length === 1 ? "" : "s"}`);
    if (unmatched.length) blockFinal.push(`${unmatched.length} job exception${unmatched.length === 1 ? "" : "s"}`);
    if (missingRateProfiles.length) blockFinal.push(`${missingRateProfiles.length} missing employee rate${missingRateProfiles.length === 1 ? "" : "s"}`);
    return { submissions, entries, expected, missing, workEntries, unmatched, unknownOwners, missingRateProfiles, discrepancies, leaveEntries, blockFinal };
  }

  function renderPeriod() {
    const dates = state.periodDates;
    elements.payDate.value = state.payDate;
    elements.periodDates.innerHTML = `
      <div class="accounting-date-card"><strong>Week 1</strong><span>${escapeText(formatDate(dates.weekOneStart))} to ${escapeText(formatDate(dates.weekOneEnd))}</span></div>
      <div class="accounting-date-card"><strong>Week 2</strong><span>${escapeText(formatDate(dates.weekTwoStart))} to ${escapeText(formatDate(dates.weekTwoEnd))}</span></div>
    `;
    const locked = state.period && state.period.status === "locked";
    elements.periodStatus.textContent = locked ? "Locked" : "Draft";
    elements.periodStatus.className = `jgc-badge ${locked ? "jgc-badge--warning" : "jgc-badge--info"}`;
  }

  function renderMetrics(validation) {
    const submittedProfiles = new Set(validation.submissions.map((item) => item.profile_id).filter(Boolean)).size;
    const totalHours = validation.workEntries.reduce((sum, entry) => sum + number(entry.payable_hours), 0);
    elements.metrics.innerHTML = `
      <div class="accounting-metric"><strong>${submittedProfiles}</strong><span>Employees Submitted</span></div>
      <div class="accounting-metric"><strong>${validation.submissions.length}</strong><span>Weekly Submissions</span></div>
      <div class="accounting-metric"><strong>${hours(totalHours)}</strong><span>Work Hours</span></div>
      <div class="accounting-metric"><strong>${validation.leaveEntries.length}</strong><span>Leave Markers</span></div>
      <div class="accounting-metric"><strong>${validation.unmatched.length}</strong><span>Job Exceptions</span></div>
    `;
  }

  function renderValidation(validation) {
    const cards = [];
    if (!validation.blockFinal.length) {
      cards.push('<div class="accounting-validation-card"><strong>Final export checks passed</strong>Rates and job matches are ready. Review any missing submissions before locking the period.</div>');
    } else {
      cards.push(`<div class="accounting-validation-card danger"><strong>Final export blocked</strong>Resolve: ${escapeText(validation.blockFinal.join(", "))}.</div>`);
    }
    if (validation.missing.length) {
      const missingText = validation.missing.map((item) => `${item.profile.display_name} (${formatDate(item.weekStart, false)} week)`).join(", ");
      cards.push(`<div class="accounting-validation-card warning"><strong>${validation.missing.length} expected submission${validation.missing.length === 1 ? "" : "s"} missing</strong>${escapeText(missingText)}. This is a review warning and does not automatically block a final export.</div>`);
    }
    if (validation.discrepancies.length) {
      cards.push(`<div class="accounting-validation-card warning"><strong>${validation.discrepancies.length} stored-total difference${validation.discrepancies.length === 1 ? "" : "s"}</strong>The normalized work entries do not match the stored weekly total after leave placeholders are removed. Review these submissions during the historical comparison.</div>`);
    }
    if (validation.leaveEntries.length) {
      const counts = validation.leaveEntries.reduce((result, entry) => {
        result[entry.entry_type] = (result[entry.entry_type] || 0) + 1;
        return result;
      }, {});
      cards.push(`<div class="accounting-validation-card"><strong>Leave reference</strong>${escapeText(Object.entries(counts).map(([key, count]) => `${label(key)}: ${count}`).join(" | "))}. Leave placeholders are never counted as 0.01 paid hours.</div>`);
    }
    elements.validation.innerHTML = cards.join("");
  }

  function renderEmployeeReview(validation) {
    const entries = validation.entries;
    const submissions = validation.submissions;
    const groups = reviewEmployees();
    if (!groups.length) {
      elements.employeeReview.innerHTML = '<div class="accounting-empty">No submitted timesheets were captured for this pay period.</div>';
      return;
    }
    elements.employeeReview.innerHTML = groups.map((employee) => {
      const employeeEntries = entries.filter((entry) => entry.profile_id === employee.profileId);
      const employeeSubmissions = submissions.filter((submission) => submission.profile_id === employee.profileId);
      const workHours = employeeEntries.filter((entry) => entry.entry_type === "work").reduce((sum, entry) => sum + number(entry.payable_hours), 0);
      const weeks = new Set(employeeSubmissions.map((submission) => isoDate(submission.week_start)));
      const rows = employeeEntries.slice().sort((left, right) => isoDate(left.work_date).localeCompare(isoDate(right.work_date))).map((entry) => {
        const job = entry.job_id ? state.jobs.find((item) => item.id === entry.job_id) : null;
        const jobText = entry.entry_type === "work"
          ? [job ? job.job_number : entry.source_job_number, job ? job.job_name : entry.source_job_name].filter(Boolean).join(" - ")
          : label(entry.entry_type);
        return `<tr>
          <td>${escapeText(formatDate(entry.work_date))}<br><small>${escapeText(entry.day_of_week)}</small></td>
          <td>${escapeText(jobText || "Special / No Job")}</td>
          <td>${escapeText(entry.shift_type === "night" ? "Night" : "Day")}</td>
          <td class="accounting-number">${entry.entry_type === "work" ? hours(entry.payable_hours) : "-"}</td>
          <td>${escapeText(label(entry.job_match_status))}</td>
        </tr>`;
      }).join("");
      return `<details class="accounting-employee-group">
        <summary>
          <span>${escapeText(employee.name)}</span>
          <span class="accounting-employee-summary">
            <span class="jgc-badge jgc-badge--info">${weeks.size}/2 weeks</span>
            <span class="jgc-badge jgc-badge--success">${hours(workHours)} hrs</span>
          </span>
        </summary>
        <div class="accounting-employee-content">
          <div class="accounting-table-wrap"><table class="accounting-table">
            <thead><tr><th>Date</th><th>Job / Leave</th><th>Shift</th><th>Hours</th><th>Match</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5">No entry details.</td></tr>'}</tbody>
          </table></div>
        </div>
      </details>`;
    }).join("");
  }

  function jobOptions(selectedId) {
    const active = state.jobs.filter((job) => job.active);
    const inactive = state.jobs.filter((job) => !job.active);
    function options(jobs) {
      return jobs.map((job) => `<option value="${escapeText(job.id)}"${job.id === selectedId ? " selected" : ""}>${escapeText(job.job_number)} - ${escapeText(job.job_name)}</option>`).join("");
    }
    return `<option value="">Choose a job</option>
      <option value="special">Special / no job required</option>
      <optgroup label="Active Jobs">${options(active)}</optgroup>
      <optgroup label="Inactive Jobs">${options(inactive)}</optgroup>`;
  }

  function renderJobExceptions(validation) {
    const locked = state.period && state.period.status === "locked";
    elements.jobCount.textContent = `${validation.unmatched.length} exception${validation.unmatched.length === 1 ? "" : "s"}`;
    elements.jobCount.className = `jgc-badge ${validation.unmatched.length ? "jgc-badge--warning" : "jgc-badge--success"}`;
    if (!validation.unmatched.length) {
      elements.jobExceptions.innerHTML = '<div class="accounting-empty">All work entries are matched to a job or marked as a reviewed special entry.</div>';
      return;
    }
    const rows = validation.unmatched.map((entry) => `<tr>
      <td>${escapeText(employeeName(entry.profile_id, entry.worker_name))}</td>
      <td>${escapeText(formatDate(entry.work_date))}</td>
      <td>${escapeText(entry.source_job_number || "-")}<br><small>${escapeText(entry.source_job_name || "No job name")}</small></td>
      <td class="accounting-number">${hours(entry.payable_hours)}</td>
      <td><div class="accounting-job-controls">
        <select class="jgc-select accounting-job-select" data-entry-job-select="${escapeText(entry.id)}"${locked ? " disabled" : ""}>${jobOptions("")}</select>
        <button class="jgc-button" type="button" data-match-entry="${escapeText(entry.id)}"${locked ? " disabled" : ""}>Apply</button>
      </div></td>
    </tr>`).join("");
    elements.jobExceptions.innerHTML = `<div class="accounting-table-wrap"><table class="accounting-table">
      <thead><tr><th>Employee</th><th>Date</th><th>Submitted Job</th><th>Hours</th><th>Accounting Match</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function renderRates() {
    const included = accountingProfileIds();
    const profiles = state.profiles.filter((profile) => included.has(profile.id))
      .sort((left, right) => String(left.display_name || "").localeCompare(String(right.display_name || "")));
    if (!profiles.length) {
      elements.rates.innerHTML = '<div class="accounting-empty">No employees are selected for Accounting. Use Employee Page Access in Admin Tools to choose who appears here.</div>';
      return;
    }
    elements.rates.innerHTML = `<div class="accounting-table-wrap">${profiles.map((profile) => {
      const latest = ratesFor(profile.id)[0] || null;
      return `<div class="accounting-rate-form" data-rate-profile="${escapeText(profile.id)}">
        <div class="accounting-rate-name"><strong>${escapeText(profile.display_name)}</strong><small>${escapeText(label(profile.role))} · ${latest ? `Current ${money(latest.regular_rate)} from ${formatDate(latest.effective_from)}` : "No rate on file"}</small></div>
        <div class="jgc-field"><label class="jgc-label">Pay Type</label><select class="jgc-select" data-rate-pay-type><option value="hourly"${!latest || latest.pay_type === "hourly" ? " selected" : ""}>Hourly</option><option value="salary"${latest && latest.pay_type === "salary" ? " selected" : ""}>Salary</option></select></div>
        <div class="jgc-field"><label class="jgc-label">Regular Rate</label><input class="jgc-input" data-rate-regular type="number" min="0" step="0.01" value="${latest ? escapeText(latest.regular_rate) : ""}"></div>
        <div class="jgc-field"><label class="jgc-label">OT Multiplier</label><input class="jgc-input" data-rate-overtime type="number" min="0" step="0.001" value="${latest ? escapeText(latest.overtime_multiplier) : "1.5"}"></div>
        <div class="jgc-field"><label class="jgc-label">Effective Date</label><input class="jgc-input" data-rate-effective type="date" value="${escapeText(state.periodDates.weekOneStart)}"></div>
        <div class="jgc-actions"><button class="jgc-button" type="button" data-save-rate="${escapeText(profile.id)}">Add Rate</button></div>
      </div>`;
    }).join("")}</div>`;
  }

  function renderTemplate() {
    if (!state.template) {
      elements.templateStatus.innerHTML = '<strong>Workbook template missing</strong><br>Upload the approved biweekly .xlsx file before exporting.';
      return;
    }
    elements.templateStatus.innerHTML = `<strong>Approved template ready</strong><br>${escapeText(state.template.file_name)} - checksum ${escapeText(String(state.template.file_sha256 || "").slice(0, 12))}... - updated ${escapeText(formatDateTime(state.template.updated_at))}`;
  }

  function renderExportHistory() {
    const locked = state.period && state.period.status === "locked";
    const validation = getValidation();
    elements.downloadDraft.disabled = Boolean(locked || !state.template || !validation.workEntries.length);
    elements.downloadFinal.disabled = Boolean(locked || validation.blockFinal.length);
    if (!state.exports.length) {
      elements.exportHistory.innerHTML = '<div class="accounting-empty">No exports have been recorded for this pay period.</div>';
      return;
    }
    elements.exportHistory.innerHTML = `<div class="accounting-table-wrap"><table class="accounting-table">
      <thead><tr><th>Exported</th><th>Type</th><th>File</th><th>Checksum</th><th>Action</th></tr></thead>
      <tbody>${state.exports.map((item) => `<tr>
        <td>${escapeText(formatDateTime(item.exported_at))}<br><small>${escapeText(employeeName(item.exported_by, "Administrator"))}</small></td>
        <td><span class="jgc-badge ${item.is_final ? "jgc-badge--success" : "jgc-badge--info"}">${item.is_final ? "Final" : "Draft"}</span></td>
        <td>${escapeText(item.file_name)}</td>
        <td><code>${escapeText(String(item.file_sha256 || "").slice(0, 16))}...</code></td>
        <td><button class="jgc-button jgc-button--secondary" type="button" data-redownload-export="${escapeText(item.id)}"><i data-lucide="download"></i> Download Exact File</button></td>
      </tr>`).join("")}</tbody>
    </table></div>`;
  }

  function renderAll() {
    renderPeriod();
    const validation = getValidation();
    renderMetrics(validation);
    renderValidation(validation);
    renderEmployeeReview(validation);
    renderJobExceptions(validation);
    renderRates();
    renderTemplate();
    renderExportHistory();
    updateIcons();
  }

  async function loadData() {
    setLoading(true);
    showNotice("Loading Accounting data...");
    state.periodDates = periodDates(state.payDate);
    try {
      const dates = state.periodDates;
      const [profilesResult, workersResult, accessResult, ratesResult, submissionsResult, entriesResult, jobsResult, periodResult, templateResult] = await Promise.all([
        state.client.from("profiles").select("id,display_name,worker_key,role,account_status").order("display_name"),
        state.client.from("work_order_labour_workers").select("id,profile_id,approved"),
        state.client.from("employee_feature_access").select("worker_id,feature_key,enabled").eq("feature_key", "accounting"),
        state.client.from("accounting_employee_rates").select("*").order("effective_from", { ascending: false }),
        state.client.from("accounting_timesheet_submissions").select("*").in("week_start", [dates.weekOneStart, dates.weekTwoStart]).order("submitted_at"),
        state.client.from("accounting_time_entries").select("*").gte("work_date", dates.weekOneStart).lte("work_date", dates.weekTwoEnd).eq("is_current", true).order("work_date"),
        state.client.from("jobs").select("id,job_number,job_name,active").order("active", { ascending: false }).order("job_number"),
        state.client.from("accounting_pay_periods").select("*").eq("pay_date", state.payDate).maybeSingle(),
        state.client.from("accounting_workbook_templates").select("id,file_name,file_sha256,is_active,uploaded_by,created_at,updated_at").eq("is_active", true).limit(1).maybeSingle()
      ]);
      state.profiles = requireResult(profilesResult, "Profiles") || [];
      state.workers = requireResult(workersResult, "Employee directory") || [];
      state.accessRows = requireResult(accessResult, "Accounting employee selection") || [];
      state.rates = requireResult(ratesResult, "Employee rates") || [];
      state.submissions = requireResult(submissionsResult, "Submitted timesheets") || [];
      state.entries = requireResult(entriesResult, "Accounting time entries") || [];
      state.jobs = requireResult(jobsResult, "Jobs") || [];
      state.period = requireResult(periodResult, "Pay period") || null;
      state.template = requireResult(templateResult, "Workbook template") || null;
      if (state.period) {
        const exportsResult = await state.client.from("accounting_exports")
          .select("id,pay_period_id,file_name,file_sha256,is_final,exported_by,exported_at")
          .eq("pay_period_id", state.period.id)
          .order("exported_at", { ascending: false });
        state.exports = requireResult(exportsResult, "Export history") || [];
      } else {
        state.exports = [];
      }
      renderAll();
      showNotice("");
    } catch (error) {
      showNotice(error.message || "Accounting data could not be loaded.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function ensurePeriod() {
    if (state.period) return state.period;
    const dates = state.periodDates;
    const payload = {
      pay_date: dates.payDate,
      week_one_start: dates.weekOneStart,
      week_one_end: dates.weekOneEnd,
      week_two_start: dates.weekTwoStart,
      week_two_end: dates.weekTwoEnd,
      status: "draft",
      created_by: state.user.id
    };
    const result = await state.client.from("accounting_pay_periods").insert(payload).select("*").single();
    if (result.error && result.error.code === "23505") {
      const existing = await state.client.from("accounting_pay_periods").select("*").eq("pay_date", state.payDate).single();
      state.period = requireResult(existing, "Existing pay period");
      return state.period;
    }
    state.period = requireResult(result, "Create pay period");
    return state.period;
  }

  async function saveRate(profileId) {
    const row = elements.rates.querySelector(`[data-rate-profile="${CSS.escape(profileId)}"]`);
    if (!row) return;
    const regularRate = number(row.querySelector("[data-rate-regular]").value);
    const effectiveFrom = row.querySelector("[data-rate-effective]").value;
    if (!effectiveFrom || regularRate < 0) {
      showNotice("Enter a valid effective date and rate.", "warning");
      return;
    }
    const payload = {
      profile_id: profileId,
      pay_type: row.querySelector("[data-rate-pay-type]").value,
      regular_rate: regularRate,
      overtime_multiplier: number(row.querySelector("[data-rate-overtime]").value || 1.5),
      night_premium: 3,
      effective_from: effectiveFrom,
      created_by: state.user.id
    };
    const result = await state.client.from("accounting_employee_rates").insert(payload).select("*").single();
    if (result.error && result.error.code === "23505") {
      showNotice("A rate already exists for that employee and effective date. Choose a new effective date so the rate history stays locked.", "warning");
      return;
    }
    const saved = requireResult(result, "Add employee rate");
    state.rates.push(saved);
    showNotice(`New rate added for ${employeeName(profileId)}.`);
    renderAll();
  }

  async function matchEntry(entryId) {
    const select = elements.jobExceptions.querySelector(`[data-entry-job-select="${CSS.escape(entryId)}"]`);
    const selected = select ? select.value : "";
    if (!selected) {
      showNotice("Choose a job or Special / no job required.", "warning");
      return;
    }
    const job = selected === "special" ? null : state.jobs.find((item) => item.id === selected);
    const payload = {
      job_id: job ? job.id : null,
      job_match_status: job ? "manual" : "not_applicable",
      job_match_note: job ? `Matched by Accounting to ${job.job_number} - ${job.job_name}` : "Reviewed by Accounting: special / no job required",
      job_matched_by: state.user.id,
      job_matched_at: new Date().toISOString()
    };
    const result = await state.client.from("accounting_time_entries").update(payload).eq("id", entryId).select("*").single();
    requireResult(result, "Save job match");
    showNotice("Job match saved.");
    await loadData();
  }

  async function sha256Hex(buffer) {
    const digest = await window.crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function bufferToBase64(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let result = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      result += String.fromCharCode.apply(null, bytes.subarray(index, Math.min(index + chunk, bytes.length)));
    }
    return window.btoa(result);
  }

  function downloadBase64(fileName, base64) {
    const bytes = window.JgcAccountingWorkbook.base64ToUint8Array(base64);
    downloadBuffer(fileName, bytes);
  }

  function downloadBuffer(fileName, buffer) {
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function redownloadExport(exportId) {
    const result = await state.client.from("accounting_exports")
      .select("file_name,file_base64")
      .eq("id", exportId)
      .single();
    const item = requireResult(result, "Load exact Accounting export");
    downloadBase64(item.file_name, item.file_base64);
  }

  async function validateTemplate(buffer) {
    const workbook = new window.ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const missing = REQUIRED_TEMPLATE_SHEETS.filter((name) => !workbook.getWorksheet(name));
    if (missing.length) throw new Error("Template is missing: " + missing.join(", "));
  }

  async function uploadTemplate() {
    const file = elements.templateFile.files && elements.templateFile.files[0];
    if (!file) {
      showNotice("Choose the approved .xlsx workbook first.", "warning");
      return;
    }
    if (!/\.xlsx$/i.test(file.name) || file.size > 3 * 1024 * 1024) {
      showNotice("Choose an .xlsx workbook smaller than 3 MB.", "warning");
      return;
    }
    const buffer = await file.arrayBuffer();
    await validateTemplate(buffer);
    const payload = {
      id: "biweekly-v1",
      file_name: file.name,
      file_base64: bufferToBase64(buffer),
      file_sha256: await sha256Hex(buffer),
      is_active: true,
      uploaded_by: state.user.id,
      updated_at: new Date().toISOString()
    };
    const result = await state.client.from("accounting_workbook_templates").upsert(payload, { onConflict: "id" }).select("id,file_name,file_sha256,is_active,uploaded_by,created_at,updated_at").single();
    state.template = requireResult(result, "Upload workbook template");
    elements.templateFile.value = "";
    showNotice("Approved workbook template uploaded securely.");
    renderAll();
  }

  function buildExportData() {
    const validation = getValidation();
    const jobsById = new Map(state.jobs.map((job) => [job.id, job]));
    const employees = reviewEmployees().filter((employee) => employee.profileId);
    const entries = validation.entries.map((entry) => {
      const job = entry.job_id ? jobsById.get(entry.job_id) : null;
      return {
        id: entry.id,
        submissionId: entry.submission_id,
        profileId: entry.profile_id,
        workerName: entry.worker_name,
        workDate: entry.work_date,
        dayOfWeek: entry.day_of_week,
        entryType: entry.entry_type,
        sourceJobNumber: entry.source_job_number,
        sourceJobName: entry.source_job_name,
        jobId: entry.job_id,
        jobNumber: job ? job.job_number : entry.source_job_number,
        jobName: job ? job.job_name : entry.source_job_name,
        shiftType: entry.shift_type,
        hours: number(entry.payable_hours),
        originalHours: number(entry.original_hours)
      };
    });
    return {
      payDate: state.periodDates.payDate,
      weekOneStart: state.periodDates.weekOneStart,
      weekOneEnd: state.periodDates.weekOneEnd,
      weekTwoStart: state.periodDates.weekTwoStart,
      weekTwoEnd: state.periodDates.weekTwoEnd,
      employees,
      entries,
      jobs: state.jobs,
      rates: state.rates.filter((rate) => isAccountingProfile(rate.profile_id)),
      inputs: {},
      submissions: validation.submissions
    };
  }

  async function exportWorkbook(isFinal) {
    const validation = getValidation();
    if (state.period && state.period.status === "locked") {
      showNotice("This period is locked. Download the exact final file from Export History.", "warning");
      return;
    }
    if (isFinal && validation.blockFinal.length) {
      showNotice("Final export is blocked until these items are resolved: " + validation.blockFinal.join(", ") + ".", "error");
      return;
    }
    if (isFinal && !window.confirm("Download the final workbook and lock this pay period? Accounting adjustments can still be made in the downloaded Excel file.")) return;
    setLoading(true);
    try {
      await ensurePeriod();
      const templateResult = await state.client.from("accounting_workbook_templates")
        .select("file_base64")
        .eq("id", state.template.id)
        .eq("is_active", true)
        .single();
      const template = requireResult(templateResult, "Load approved workbook template");
      const result = await window.JgcAccountingWorkbook.build({
        templateBase64: template.file_base64,
        data: buildExportData(),
        exportedBy: state.profile.display_name
      });
      const checksum = await sha256Hex(result.buffer);
      const fileBase64 = bufferToBase64(result.buffer);
      const exportResult = await state.client.from("accounting_exports").insert({
        pay_period_id: state.period.id,
        file_name: result.fileName,
        file_sha256: checksum,
        file_base64: fileBase64,
        is_final: Boolean(isFinal),
        snapshot: result.snapshot,
        exported_by: state.user.id
      }).select("id,pay_period_id,file_name,file_sha256,is_final,exported_by,exported_at").single();
      const savedExport = requireResult(exportResult, "Record Accounting export");
      if (isFinal) {
        const periodResult = await state.client.from("accounting_pay_periods").select("*").eq("id", state.period.id).single();
        state.period = requireResult(periodResult, "Confirm locked pay period");
        if (!state.period || state.period.status !== "locked") {
          throw new Error("The final workbook was recorded, but the pay period lock could not be confirmed.");
        }
      }
      state.exports.unshift(savedExport);
      downloadBuffer(result.fileName, result.buffer);
      showNotice(isFinal ? "Final workbook downloaded and pay period locked." : "Draft workbook downloaded.");
      renderAll();
    } catch (error) {
      showNotice(error.message || "Workbook export failed.", "error");
    } finally {
      setLoading(false);
    }
  }

  function shiftPeriod(days) {
    state.payDate = addDays(state.payDate, days);
    state.periodDates = periodDates(state.payDate);
    loadData();
  }

  function bindEvents() {
    elements.previousPeriod.addEventListener("click", () => shiftPeriod(-14));
    elements.nextPeriod.addEventListener("click", () => shiftPeriod(14));
    elements.currentPeriod.addEventListener("click", () => {
      state.payDate = currentPayDate();
      loadData();
    });
    elements.refresh.addEventListener("click", loadData);
    elements.payDate.addEventListener("change", () => {
      if (!elements.payDate.value) return;
      state.payDate = elements.payDate.value;
      loadData();
    });
    elements.uploadTemplate.addEventListener("click", () => uploadTemplate().catch((error) => showNotice(error.message, "error")));
    elements.downloadDraft.addEventListener("click", () => exportWorkbook(false));
    elements.downloadFinal.addEventListener("click", () => exportWorkbook(true));

    document.addEventListener("click", (event) => {
      const matchButton = event.target.closest("[data-match-entry]");
      if (matchButton) {
        matchEntry(matchButton.dataset.matchEntry).catch((error) => showNotice(error.message, "error"));
        return;
      }
      const rateButton = event.target.closest("[data-save-rate]");
      if (rateButton) {
        saveRate(rateButton.dataset.saveRate).catch((error) => showNotice(error.message, "error"));
        return;
      }
      const downloadButton = event.target.closest("[data-redownload-export]");
      if (downloadButton) {
        redownloadExport(downloadButton.dataset.redownloadExport).catch((error) => showNotice(error.message, "error"));
      }
    });
  }

  function captureElements() {
    Object.assign(elements, {
      page: byId("accountingPage"),
      currentUser: byId("accountingCurrentUser"),
      notice: byId("accountingNotice"),
      previousPeriod: byId("accountingPreviousPeriod"),
      nextPeriod: byId("accountingNextPeriod"),
      currentPeriod: byId("accountingCurrentPeriod"),
      refresh: byId("accountingRefresh"),
      payDate: byId("accountingPayDate"),
      periodStatus: byId("accountingPeriodStatus"),
      periodDates: byId("accountingPeriodDates"),
      metrics: byId("accountingMetrics"),
      validation: byId("accountingValidation"),
      employeeReview: byId("accountingEmployeeReview"),
      jobCount: byId("accountingJobCount"),
      jobExceptions: byId("accountingJobExceptions"),
      rates: byId("accountingRates"),
      templateStatus: byId("accountingTemplateStatus"),
      templateFile: byId("accountingTemplateFile"),
      uploadTemplate: byId("accountingUploadTemplate"),
      downloadDraft: byId("accountingDownloadDraft"),
      downloadFinal: byId("accountingDownloadFinal"),
      exportHistory: byId("accountingExportHistory")
    });
  }

  async function initialize() {
    captureElements();
    bindEvents();
    updateIcons();
    state.payDate = currentPayDate();
    state.periodDates = periodDates(state.payDate);
    state.client = createJgcSupabaseClient();
    if (!state.client) {
      showNotice("Supabase is not available.", "error");
      return;
    }
    try {
      const sessionResult = await state.client.auth.getSession();
      state.user = sessionResult.data && sessionResult.data.session ? sessionResult.data.session.user : null;
      if (!state.user) {
        window.location.href = "index.html";
        return;
      }
      const profileResult = await state.client.from("profiles").select("id,display_name,role,account_status").eq("id", state.user.id).single();
      if (profileResult.error || !profileResult.data || profileResult.data.role !== "admin" || profileResult.data.account_status !== "approved") {
        window.alert("Accounting is only available to approved administrators.");
        window.location.href = "home.html";
        return;
      }
      state.profile = profileResult.data;
      let accountingAllowed = false;
      try {
        accountingAllowed = typeof hasJgcAccountingAccess === "function"
          && await hasJgcAccountingAccess(state.client, state.user.id, state.profile);
      } catch (accessError) {
        console.warn("Accounting access could not be verified.", accessError);
        window.alert("Accounting access could not be verified. Please try again.");
        window.location.href = "admin.html?tab=summary";
        return;
      }
      if (!accountingAllowed) {
        window.alert("Your account does not have Accounting access.");
        window.location.href = "admin.html?tab=summary";
        return;
      }
      if (typeof setJgcAccountingNavigationAccess === "function") {
        setJgcAccountingNavigationAccess(true);
      }
      elements.page.hidden = false;
      elements.currentUser.textContent = "Signed in as: " + state.profile.display_name;
      await loadData();
    } catch (error) {
      showNotice(error.message || "Accounting could not be loaded.", "error");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
