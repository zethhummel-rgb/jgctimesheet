(function(global) {
  "use strict";

  const SEARCH_DATASETS = [
    { key: "submittedTimesheets", table: "previous_timesheet_weeks" },
    { key: "liveTimesheets", table: "timesheet_entries" },
    { key: "inspections", table: "inspection_records" },
    { key: "vehicleInspections", table: "vehicle_inspection_records" },
    { key: "certificates", table: "certificates" },
    { key: "certificateAlerts", table: "certificate_expiry_notifications" },
    { key: "vacations", table: "vacation_requests" },
    { key: "schedule", table: "schedule_events" },
    { key: "profiles", table: "profiles" },
    { key: "announcements", table: "announcements", activeOnly: true },
    { key: "announcementAcknowledgements", table: "announcement_acknowledgements" },
    { key: "policies", table: "policies", activeOnly: true },
    { key: "toolboxTalks", table: "toolbox_talks", activeOnly: true },
    { key: "toolboxReports", table: "toolbox_talk_reports", excludeDuplicates: true },
    { key: "toolboxAttendance", table: "toolbox_talk_attendance" },
    { key: "dailyReports", table: "daily_site_reports" },
    { key: "incidentReports", table: "incident_reports" },
    { key: "accidentReports", table: "accident_reports" },
    { key: "accidentAcknowledgements", table: "accident_report_acknowledgements" },
    { key: "injuryReports", table: "employee_injury_reports" },
    { key: "injuryAcknowledgements", table: "employee_injury_acknowledgements" },
    { key: "safetyAcknowledgements", table: "safety_acknowledgements" },
    { key: "jobs", table: "jobs" },
    { key: "workOrders", table: "work_orders" },
    { key: "purchaseOrders", table: "digital_purchase_orders", limit: 2000 },
    { key: "workOrderLabour", table: "work_order_labour" },
    { key: "workOrderPurchaseOrders", table: "work_order_purchase_orders" },
    { key: "workOrderEquipment", table: "work_order_equipment" },
    { key: "workOrderTravel", table: "work_order_travel" },
    { key: "workOrderWorkers", table: "work_order_labour_workers" },
    { key: "equipment", table: "equipment_vehicles", activeOnly: true },
    { key: "equipmentAlerts", table: "equipment_expiry_notifications" },
    { key: "equipmentMaintenance", table: "equipment_maintenance_logs" },
    { key: "contacts", table: "contacts", activeOnly: true },
    { key: "subcontractors", table: "subcontractors_suppliers", activeOnly: true },
    { key: "supplierContacts", table: "subcontractor_supplier_contacts", activeOnly: true },
    { key: "subcontractorActivity", table: "subcontractor_portal_activity" },
    { key: "tasks", table: "tasks" }
  ];

  const SEARCH_COLLECTIONS = [
    { dataset: "submittedTimesheets", category: "Submitted Timesheet", tab: "timesheets", action: "submitted_timesheet", keywords: "timesheet hours employee worker job site", titleKeys: ["worker_name"], detailKeys: ["week_label", "total_hours", "note"], dateKeys: ["submitted_at", "week_start", "created_at"], extraSearch: getSubmittedTimesheetDates },
    { dataset: "liveTimesheets", category: "Live Timesheet", tab: "timesheets", action: "live_timesheet", keywords: "timesheet hours employee worker job site", titleKeys: ["worker_name"], detailKeys: ["day_of_week", "job_name", "job_number", "hours"], dateKeys: ["week_start", "created_at"], extraSearch: (record) => getTimesheetEntryDate(record.week_start, record.day_of_week) },
    { dataset: "inspections", category: "Inspection", tab: "inspections", keywords: "inspection permit safety worker employee job site", titleKeys: ["worker_name", "completed_by", "inspection_type"], detailKeys: ["inspection_type", "job_number", "job_name", "location"], dateKeys: ["inspection_date", "created_at"] },
    { dataset: "vehicleInspections", category: "Vehicle Inspection", tab: "inspections", keywords: "vehicle trailer inspection plate driver", titleKeys: ["driver_name", "worker_name", "vehicle_license_plate"], detailKeys: ["vehicle_license_plate", "trailer_1_license_plate", "inspection_type", "location"], dateKeys: ["inspection_date", "created_at"] },
    { dataset: "certificates", category: "Certificate", tab: "certificates", keywords: "certificate training employee worker expiry", titleKeys: ["worker_name", "employee_name", "certificate_name"], detailKeys: ["certificate_type", "certificate_name", "expiry_date", "status"], dateKeys: ["expiry_date", "issued_date", "created_at"] },
    { dataset: "certificateAlerts", category: "Certificate Alert", tab: "certificates", keywords: "certificate training expiry notification", titleKeys: ["worker_name", "certificate_name"], detailKeys: ["certificate_type", "expiry_date", "message"], dateKeys: ["expiry_date", "created_at"] },
    { dataset: "vacations", category: "Vacation", tab: "vacation", keywords: "vacation holiday leave employee worker", titleKeys: ["worker_display_name", "worker_name"], detailKeys: ["start_date", "end_date", "request_type", "status"], dateKeys: ["start_date", "end_date", "created_at"], extraSearch: getVacationRangeDates },
    { dataset: "schedule", category: "Schedule", tab: "summary", keywords: "schedule calendar appointment training job equipment vehicle", titleKeys: ["title", "job_name", "event_type"], detailKeys: ["event_date", "job_number", "location", "notes"], dateKeys: ["event_date", "created_at"] },
    { dataset: "profiles", category: "Employee Profile", tab: "employeeProfile", keywords: "employee worker account profile phone email", titleKeys: ["display_name", "worker_key", "email"], detailKeys: ["email", "position", "department", "employee_id"], dateKeys: ["hire_date", "created_at"] },
    { dataset: "announcements", category: "Announcement", tab: "noticePolicy", keywords: "announcement notice message", titleKeys: ["title", "subject"], detailKeys: ["description", "message", "created_by_name"], dateKeys: ["published_at", "created_at"] },
    { dataset: "announcementAcknowledgements", category: "Announcement Acknowledgement", tab: "noticePolicy", keywords: "announcement notice acknowledgement employee worker", titleKeys: ["worker_name", "display_name", "employee_name"], detailKeys: ["announcement_title", "title", "status"], dateKeys: ["read_at", "acknowledged_at", "created_at"] },
    { dataset: "policies", category: "Policy", tab: "noticePolicy", keywords: "policy document safety", titleKeys: ["title", "name"], detailKeys: ["category", "description"], dateKeys: ["published_at", "created_at"] },
    { dataset: "toolboxTalks", category: "Toolbox Talk", tab: "reports", keywords: "toolbox talk safety meeting", titleKeys: ["title", "topic"], detailKeys: ["description", "job_number", "location"], dateKeys: ["talk_date", "created_at"] },
    { dataset: "toolboxReports", category: "Toolbox Report", tab: "reports", keywords: "toolbox talk report safety employee worker", titleKeys: ["title", "worker_name", "completed_by_name"], detailKeys: ["topic", "job_number", "location"], dateKeys: ["report_date", "created_at"] },
    { dataset: "toolboxAttendance", category: "Toolbox Attendance", tab: "reports", keywords: "toolbox talk attendance employee worker", titleKeys: ["attendee_name", "worker_name"], detailKeys: ["toolbox_talk_title", "company", "status"], dateKeys: ["acknowledged_at", "created_at"] },
    { dataset: "dailyReports", category: "Daily Site Report", tab: "reports", keywords: "daily site report job project worker", titleKeys: ["job_name", "project", "worker_name"], detailKeys: ["job_number", "report_date", "location", "completed_by"], dateKeys: ["report_date", "created_at"] },
    { dataset: "incidentReports", category: "Incident Report", tab: "reports", keywords: "incident near miss safety report employee worker job", titleKeys: ["incident_type", "worker_name", "reported_by"], detailKeys: ["job_number", "job_name", "location", "description"], dateKeys: ["report_date", "incident_date", "created_at"] },
    { dataset: "accidentReports", category: "Accident Report", tab: "reports", keywords: "accident safety injury report employee worker job", titleKeys: ["injured_employee_name", "worker_name", "reported_by"], detailKeys: ["job_number", "job_name", "accident_location", "description"], dateKeys: ["accident_date", "created_at"] },
    { dataset: "accidentAcknowledgements", category: "Accident Acknowledgement", tab: "reports", keywords: "accident acknowledgement employee worker", titleKeys: ["worker_display_name", "worker_name"], detailKeys: ["status", "note"], dateKeys: ["acknowledged_at", "created_at"] },
    { dataset: "injuryReports", category: "Employee Injury", tab: "reports", keywords: "employee injury accident report worker job", titleKeys: ["employee_name", "employee_display", "worker_name"], detailKeys: ["job_number", "accident_location", "accident_description"], dateKeys: ["accident_date", "created_at"] },
    { dataset: "injuryAcknowledgements", category: "Injury Acknowledgement", tab: "reports", keywords: "employee injury acknowledgement worker", titleKeys: ["worker_display_name", "worker_name"], detailKeys: ["status", "note"], dateKeys: ["acknowledged_at", "created_at"] },
    { dataset: "safetyAcknowledgements", category: "Safety Acknowledgement", tab: "reports", keywords: "safety acknowledgement employee worker", titleKeys: ["attendee_name", "worker_name", "record_title"], detailKeys: ["record_type", "record_title", "project", "location"], dateKeys: ["record_date", "acknowledged_at", "created_at"] },
    { dataset: "jobs", category: "Job", tab: "jobDashboard", keywords: "job job number project site", title: (record) => [getValue(record, ["job_number"]), getValue(record, ["job_name"])].filter(Boolean).join(" - "), detailKeys: ["address", "job_type", "project_manager"], dateKeys: ["updated_at", "created_at"] },
    { dataset: "workOrders", category: "Work Order", tab: "workOrders", action: "work_order", keywords: "work order wo wo number job customer", title: (record) => "WO " + (getValue(record, ["wo_number", "work_order_number", "number"]) || getValue(record, ["job_name"]) || "record"), detailKeys: ["job_number", "job_name", "customer_name", "status"], dateKeys: ["work_order_date", "submitted_at", "created_at"] },
    { dataset: "purchaseOrders", group: "Purchase Orders", category: "Purchase Order", tab: "summary", action: "digital_purchase_order", keywords: "purchase order po po number supplier creator submitter job materials", title: (record) => formatPoNumber(getValue(record, ["po_number"])), detailKeys: ["supplier_name", "job_number", "job_name", "workflow_status"], dateKeys: ["order_date", "created_at"] },
    { dataset: "workOrderLabour", category: "Work Order Labour", tab: "workOrders", keywords: "work order wo labour employee worker hours", titleKeys: ["employee_name", "worker_name"], detailKeys: ["wo_number", "job_number", "hours", "description"], dateKeys: ["work_date", "created_at"] },
    { dataset: "workOrderPurchaseOrders", category: "Work Order PO", tab: "workOrders", keywords: "work order wo purchase order po supplier", titleKeys: ["po_number", "purchase_order_number", "supplier"], detailKeys: ["wo_number", "job_number", "description", "amount"], dateKeys: ["po_date", "created_at"] },
    { dataset: "workOrderEquipment", category: "Work Order Equipment", tab: "workOrders", keywords: "work order wo equipment vehicle", titleKeys: ["equipment_name", "name"], detailKeys: ["wo_number", "job_number", "hours", "description"], dateKeys: ["work_date", "created_at"] },
    { dataset: "workOrderTravel", category: "Work Order Travel", tab: "workOrders", keywords: "work order wo travel employee worker kilometres", titleKeys: ["employee_name", "worker_name"], detailKeys: ["wo_number", "job_number", "kilometres", "hours"], dateKeys: ["travel_date", "created_at"] },
    { dataset: "workOrderWorkers", category: "Work Order Worker", tab: "workOrders", keywords: "work order wo labour employee worker", titleKeys: ["display_name", "worker_key"], detailKeys: ["email", "approved"], dateKeys: ["updated_at", "created_at"] },
    { dataset: "equipment", category: "Equipment / Vehicle", tab: "equipment", keywords: "equipment vehicle trailer plate unit", titleKeys: ["name", "unit_number", "license_plate"], detailKeys: ["category", "license_plate", "unit_number", "serial_number"], dateKeys: ["yearly_inspection_expiry", "updated_at", "created_at"] },
    { dataset: "equipmentAlerts", category: "Equipment Alert", tab: "equipment", keywords: "equipment vehicle expiry notification alert", titleKeys: ["equipment_name", "name", "message"], detailKeys: ["notification_type", "expiry_date", "status"], dateKeys: ["expiry_date", "created_at"] },
    { dataset: "equipmentMaintenance", category: "Equipment Maintenance", tab: "equipment", keywords: "equipment vehicle maintenance service repair", titleKeys: ["equipment_name", "title", "service_type"], detailKeys: ["scheduled_date", "completed_date", "description", "status"], dateKeys: ["scheduled_date", "completed_date", "created_at"] },
    { dataset: "contacts", category: "Contact", tab: "contacts", keywords: "contact company phone email", titleKeys: ["name", "company_name"], detailKeys: ["company", "role", "phone", "email"], dateKeys: ["updated_at", "created_at"] },
    { dataset: "subcontractors", category: "Subcontractor / Supplier", tab: "subcontractorsSuppliers", keywords: "subcontractor supplier rental service company contact", titleKeys: ["company_name", "name"], detailKeys: ["category", "phone", "email", "address"], dateKeys: ["updated_at", "created_at"] },
    { dataset: "supplierContacts", category: "Supplier Contact", tab: "subcontractorsSuppliers", keywords: "subcontractor supplier contact company phone email", titleKeys: ["contact_name", "name"], detailKeys: ["company_name", "role", "phone", "email"], dateKeys: ["updated_at", "created_at"] },
    { dataset: "subcontractorActivity", category: "Subcontractor Activity", tab: "summary", keywords: "subcontractor activity portal company user", titleKeys: ["company_name", "subcontractor_name", "display_name"], detailKeys: ["activity_type", "page_name", "email"], dateKeys: ["created_at"] },
    { dataset: "tasks", category: "Task", tab: "tasks", keywords: "task assignment employee worker job follow up", titleKeys: ["title"], detailKeys: ["job_number", "job_name", "assigned_to_name", "status"], dateKeys: ["due_date", "completed_at", "created_at"] }
  ];

  const GROUP_ORDER = [
    "Time & Attendance",
    "Jobs & Work Orders",
    "Purchase Orders",
    "Inspections",
    "Reports & Submissions",
    "People & Leave",
    "Equipment & Vehicles",
    "Schedule & Tasks",
    "Notices & Contacts",
    "Other"
  ];

  const state = {
    initialized: false,
    ready: false,
    loadingPromise: null,
    records: {},
    index: [],
    results: [],
    timer: null,
    client: null
  };

  function escapeText(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character]));
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatLocalDate(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function getDateAliases(value) {
    let date = null;
    const text = String(value || "").trim();
    const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

    if (value instanceof Date) {
      date = value;
    } else if (isoMatch) {
      date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    } else if (/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/i.test(text)) {
      const parsed = new Date(text);
      date = Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (!date || Number.isNaN(date.getTime())) {
      return "";
    }

    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = date.getFullYear();
    const longMonth = date.toLocaleDateString("en-US", { month: "long" });
    const shortMonth = date.toLocaleDateString("en-US", { month: "short" });
    const weekday = date.toLocaleDateString("en-US", { weekday: "long" });

    return [
      longMonth + " " + day,
      longMonth + " " + day + " " + year,
      shortMonth + " " + day,
      shortMonth + " " + day + " " + year,
      month + "/" + day,
      month + "/" + day + "/" + year,
      formatLocalDate(date),
      weekday
    ].join(" ");
  }

  function collectValues(value, output, depth) {
    if (value === null || value === undefined || depth > 6) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => collectValues(item, output, depth + 1));
      return;
    }

    if (typeof value === "object" && !(value instanceof Date)) {
      Object.values(value).forEach((item) => collectValues(item, output, depth + 1));
      return;
    }

    const text = String(value);
    output.push(text);
    const aliases = getDateAliases(value);
    if (aliases) output.push(aliases);
  }

  function getValue(record, keys) {
    for (const key of keys || []) {
      const value = record && record[key];
      if (value !== null && value !== undefined && String(value).trim()) {
        return Array.isArray(value) ? value.join(", ") : String(value);
      }
    }
    return "";
  }

  function joinDetails(record, keys) {
    const values = [];
    (keys || []).forEach((key) => {
      const value = getValue(record, [key]);
      if (value && !values.includes(value)) values.push(value);
    });
    return values.slice(0, 4).join(" | ");
  }

  function formatPoNumber(value) {
    const normalized = String(value || "").trim().replace(/^po[-\s]*/i, "");
    return normalized ? "PO-" + normalized : "PO record";
  }

  function getTimesheetEntryDate(weekStart, dayName) {
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const dayIndex = names.indexOf(String(dayName || ""));
    const match = String(weekStart || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match || dayIndex < 0) return "";
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    date.setDate(date.getDate() + dayIndex);
    return formatLocalDate(date);
  }

  function getSubmittedTimesheetDates(week) {
    return (Array.isArray(week && week.entries) ? week.entries : []).map((entry) => getTimesheetEntryDate(
      entry.weekStartValue || entry.week_start || week.week_start,
      entry.day || entry.day_of_week
    ));
  }

  function getVacationRangeDates(record) {
    const startMatch = String(record && record.start_date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    const endMatch = String(record && (record.end_date || record.start_date) || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!startMatch || !endMatch) return [];
    const date = new Date(Number(startMatch[1]), Number(startMatch[2]) - 1, Number(startMatch[3]));
    const end = new Date(Number(endMatch[1]), Number(endMatch[2]) - 1, Number(endMatch[3]));
    const dates = [];
    while (date <= end && dates.length < 366) {
      dates.push(formatLocalDate(date));
      date.setDate(date.getDate() + 1);
    }
    return dates;
  }

  function getGroup(item) {
    const category = String(item.category || "").toLowerCase();
    if (category.includes("timesheet")) return "Time & Attendance";
    if (category.includes("purchase order")) return "Purchase Orders";
    if (category.includes("work order") || category === "job") return "Jobs & Work Orders";
    if (category.includes("inspection")) return "Inspections";
    if (/report|toolbox|accident|injury|acknowledgement/.test(category)) return "Reports & Submissions";
    if (/employee|certificate|vacation/.test(category)) return "People & Leave";
    if (/equipment|vehicle/.test(category)) return "Equipment & Vehicles";
    if (/schedule|task/.test(category)) return "Schedule & Tasks";
    if (/announcement|policy|contact|supplier|subcontractor/.test(category)) return "Notices & Contacts";
    return "Other";
  }

  function includeDatasetRecord(definition, record) {
    if (definition.activeOnly && record && record.is_active === false) return false;
    if (definition.excludeDuplicates && record && record.is_duplicate === true) return false;
    return true;
  }

  async function verifyAdminAccess(client) {
    const userResult = await client.auth.getUser();
    const user = userResult && userResult.data && userResult.data.user;
    if (userResult.error || !user) throw new Error("A signed-in admin account is required.");

    const profileResult = await client
      .from("profiles")
      .select("id,email,display_name,worker_key,role,account_status")
      .eq("id", user.id)
      .limit(1);
    const profile = Array.isArray(profileResult.data) ? profileResult.data[0] : profileResult.data;
    const isAdminRole = String(profile && profile.role || "").toLowerCase() === "admin";
    const isKnownAdmin = profile && typeof global.isAdminWorker === "function" && global.isAdminWorker(profile.worker_key, profile.role, profile.email);
    const isAdmin = profile && profile.account_status === "approved" && (isAdminRole || isKnownAdmin);

    if (profileResult.error || !isAdmin) {
      throw new Error("Admin search access could not be confirmed.");
    }

    localStorage.setItem("currentWorker", profile.worker_key || "");
    localStorage.setItem("currentWorkerDisplay", profile.display_name || profile.worker_key || "");
    localStorage.setItem("currentUserEmail", profile.email || "");
    localStorage.setItem("currentUserRole", profile.role || "worker");
    localStorage.setItem("currentAccountStatus", profile.account_status || "pending");
  }

  function buildIndex() {
    const index = [];

    SEARCH_COLLECTIONS.forEach((config) => {
      (state.records[config.dataset] || []).forEach((record) => {
        const title = typeof config.title === "function" ? config.title(record) : getValue(record, config.titleKeys);
        const detail = joinDetails(record, config.detailKeys);
        const values = [config.category, config.keywords || "", title, detail];
        collectValues(record, values, 0);
        if (typeof config.extraSearch === "function") collectValues(config.extraSearch(record), values, 0);

        index.push({
          group: config.group || "",
          category: config.category,
          title: title || config.category + " record",
          detail,
          tab: config.tab,
          action: config.action || "",
          recordId: record && record.id ? String(record.id) : "",
          searchText: normalizeText(values.join(" ")),
          sortDate: getValue(record, config.dateKeys || ["updated_at", "created_at"])
        });
      });
    });

    return index;
  }

  async function loadAllSearchData(forceReload) {
    if (state.ready && !forceReload) return;
    if (state.loadingPromise) return state.loadingPromise;

    state.loadingPromise = (async function() {
      state.client = state.client || (typeof global.createJgcSupabaseClient === "function" ? global.createJgcSupabaseClient() : null);
      if (!state.client) throw new Error("Portal data connection is unavailable.");
      await verifyAdminAccess(state.client);

      const results = await Promise.all(SEARCH_DATASETS.map(async (definition) => {
        try {
          const result = await state.client.from(definition.table).select("*").limit(definition.limit || 1000);
          if (result.error) {
            console.warn("Admin search could not load " + definition.table + ".", result.error);
            return { key: definition.key, rows: [] };
          }
          return { key: definition.key, rows: (result.data || []).filter((record) => includeDatasetRecord(definition, record)) };
        } catch (error) {
          console.warn("Admin search could not load " + definition.table + ".", error);
          return { key: definition.key, rows: [] };
        }
      }));

      state.records = {};
      results.forEach((result) => { state.records[result.key] = result.rows; });
      state.index = buildIndex();
      state.ready = true;
    })().finally(() => {
      state.loadingPromise = null;
    });

    return state.loadingPromise;
  }

  function getElements() {
    return {
      wrapper: document.getElementById("jgcAdminGlobalSearch"),
      button: document.getElementById("jgcAdminGlobalSearchButton"),
      panel: document.getElementById("jgcAdminGlobalSearchPanel"),
      input: document.getElementById("jgcAdminGlobalSearchInput"),
      submit: document.getElementById("jgcAdminGlobalSearchSubmit"),
      refresh: document.getElementById("jgcAdminGlobalSearchRefresh"),
      status: document.getElementById("jgcAdminGlobalSearchStatus"),
      results: document.getElementById("jgcAdminGlobalSearchResults")
    };
  }

  function renderResults(matches, totalCount) {
    const elements = getElements();
    if (!elements.status || !elements.results) return;

    state.results = matches;
    elements.status.textContent = totalCount
      ? totalCount + " relevant result" + (totalCount === 1 ? "" : "s") + (totalCount > matches.length ? " - showing the first " + matches.length : "")
      : "No records found.";

    if (!matches.length) {
      elements.results.innerHTML = '<div class="jgc-admin-search-empty">Try a job number, employee, date, WO, PO, report, or equipment name.</div>';
      return;
    }

    const groups = new Map();
    matches.forEach((item, index) => {
      const groupName = item.group || getGroup(item);
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName).push({ item, index });
    });

    const orderedGroups = GROUP_ORDER.filter((name) => groups.has(name));
    Array.from(groups.keys()).forEach((name) => {
      if (!orderedGroups.includes(name)) orderedGroups.push(name);
    });

    elements.results.innerHTML = orderedGroups.map((groupName) => {
      const rows = groups.get(groupName);
      return `
        <section class="jgc-admin-search-group">
          <div class="jgc-admin-search-group-header">
            <h3>${escapeText(groupName)}</h3>
            <span>${rows.length}</span>
          </div>
          <div class="jgc-admin-search-group-results">
            ${rows.map(({ item, index }) => `
              <article class="jgc-admin-search-result">
                <div class="jgc-admin-search-result-copy">
                  <div class="jgc-admin-search-result-category">${escapeText(item.category)}</div>
                  <div class="jgc-admin-search-result-title">${escapeText(item.title)}</div>
                  ${item.detail ? `<div class="jgc-admin-search-result-detail">${escapeText(item.detail)}</div>` : ""}
                </div>
                <button type="button" data-jgc-admin-search-result="${index}">Open</button>
              </article>
            `).join("")}
          </div>
        </section>
      `;
    }).join("");
  }

  async function runSearch(forceReload) {
    const elements = getElements();
    if (!elements.input || !elements.status || !elements.submit) return;
    const query = elements.input.value.trim();
    const normalizedQuery = normalizeText(query);

    if (normalizedQuery.length < 2) {
      state.results = [];
      elements.results.innerHTML = "";
      elements.status.textContent = query ? "Enter at least 2 characters." : "Type at least 2 characters to search all portal records.";
      return;
    }

    elements.status.textContent = forceReload || !state.ready ? "Loading all portal records for search..." : "Searching...";
    elements.submit.disabled = true;
    if (elements.refresh) elements.refresh.disabled = true;

    try {
      await loadAllSearchData(Boolean(forceReload));
      const currentQuery = normalizeText(elements.input.value.trim());
      const terms = currentQuery.split(" ").filter(Boolean);
      const matches = state.index
        .filter((item) => terms.every((term) => item.searchText.includes(term)))
        .map((item) => {
          const title = normalizeText(item.title);
          const category = normalizeText(item.category);
          const score = title.includes(currentQuery) ? 0 : (category.includes(currentQuery) ? 1 : 2);
          return Object.assign({ score }, item);
        })
        .sort((a, b) => a.score - b.score || String(b.sortDate || "").localeCompare(String(a.sortDate || "")));
      renderResults(matches.slice(0, 100), matches.length);
    } catch (error) {
      console.error("Admin portal search could not load.", error);
      elements.status.textContent = error && error.message ? error.message : "Search could not load portal records. Please try again.";
    } finally {
      elements.submit.disabled = false;
      if (elements.refresh) elements.refresh.disabled = false;
    }
  }

  function scheduleSearch() {
    clearTimeout(state.timer);
    const elements = getElements();
    if (!elements.input) return;
    if (normalizeText(elements.input.value).length < 2) {
      runSearch(false);
      return;
    }
    state.timer = setTimeout(() => runSearch(false), 350);
  }

  function close() {
    const elements = getElements();
    if (!elements.panel || !elements.button) return;
    elements.panel.hidden = true;
    elements.button.setAttribute("aria-expanded", "false");
  }

  function open() {
    const elements = getElements();
    if (!elements.panel || !elements.button) return;
    if (typeof global.toggleJgcNotificationPanel === "function") global.toggleJgcNotificationPanel(false);
    elements.panel.hidden = false;
    elements.button.setAttribute("aria-expanded", "true");
    setTimeout(() => elements.input && elements.input.focus(), 0);
  }

  function toggle() {
    const elements = getElements();
    if (!elements.panel) return;
    if (elements.panel.hidden) open(); else close();
  }

  function getCurrentPage() {
    const path = String(global.location && global.location.pathname || "");
    return path.split("/").pop() || "index.html";
  }

  async function waitForAdminAction(result) {
    if (typeof global.showTab === "function") global.showTab(result.tab || "summary");

    if (!result.action || !result.recordId) return;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const actionReady = result.action === "submitted_timesheet"
        ? typeof global.viewSubmittedTimesheetHours === "function"
        : result.action === "live_timesheet"
          ? typeof global.editLiveTimesheetEntry === "function"
          : result.action === "work_order"
            ? typeof global.openAdminWorkOrderEditor === "function"
            : true;

      if (actionReady && typeof global.loadAdminTabData === "function") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (typeof global.loadAdminTabData === "function") {
      await global.loadAdminTabData(result.tab || "summary");
    }

    if (result.action === "submitted_timesheet" && typeof global.viewSubmittedTimesheetHours === "function") {
      global.viewSubmittedTimesheetHours(result.recordId);
    } else if (result.action === "live_timesheet" && typeof global.editLiveTimesheetEntry === "function") {
      global.editLiveTimesheetEntry(result.recordId);
    } else if (result.action === "work_order" && typeof global.openAdminWorkOrderEditor === "function") {
      if (typeof global.renderAdminWorkOrders === "function") global.renderAdminWorkOrders();
      global.openAdminWorkOrderEditor(result.recordId);
    }
  }

  function openResult(index) {
    const result = state.results[Number(index)];
    if (!result) return;
    close();

    if (result.action === "digital_purchase_order" && result.recordId) {
      global.location.href = "purchase-orders-admin.html?po=" + encodeURIComponent(result.recordId);
      return;
    }

    if (getCurrentPage() === "admin.html" && typeof global.showTab === "function") {
      waitForAdminAction(result);
      return;
    }

    if (result.action && result.recordId) {
      sessionStorage.setItem("jgcPendingAdminGlobalSearchResult", JSON.stringify({
        tab: result.tab,
        action: result.action,
        recordId: result.recordId
      }));
    }
    global.location.href = "admin.html?tab=" + encodeURIComponent(result.tab || "summary");
  }

  function consumePendingResult() {
    if (getCurrentPage() !== "admin.html") return;
    const stored = sessionStorage.getItem("jgcPendingAdminGlobalSearchResult");
    if (!stored) return;
    sessionStorage.removeItem("jgcPendingAdminGlobalSearchResult");
    try {
      const result = JSON.parse(stored);
      setTimeout(() => waitForAdminAction(result), 250);
    } catch (error) {
      console.warn("Pending admin search result could not be opened.", error);
    }
  }

  function init() {
    if (state.initialized || document.getElementById("jgcAdminGlobalSearch")) return;
    const worker = typeof global.getCurrentWorkerRecord === "function" ? global.getCurrentWorkerRecord() : null;
    if (!worker || typeof global.isAdminWorker !== "function" || !global.isAdminWorker(worker.key, worker.role, worker.email)) return;

    state.initialized = true;
    const wrapper = document.createElement("div");
    wrapper.id = "jgcAdminGlobalSearch";
    wrapper.className = "jgc-admin-global-search";
    wrapper.innerHTML = `
      <button id="jgcAdminGlobalSearchButton" class="jgc-admin-search-button" type="button" aria-label="Search all portal records" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7"></circle>
          <path d="m20 20-3.6-3.6"></path>
        </svg>
      </button>
      <section id="jgcAdminGlobalSearchPanel" class="jgc-admin-search-panel" role="dialog" aria-modal="false" aria-labelledby="jgcAdminGlobalSearchTitle" hidden>
        <header class="jgc-admin-search-header">
          <div>
            <span class="jgc-admin-search-eyebrow">Admin Search</span>
            <strong id="jgcAdminGlobalSearchTitle">Search the Entire Portal</strong>
          </div>
          <div class="jgc-admin-search-header-actions">
            <button id="jgcAdminGlobalSearchRefresh" type="button">Refresh Data</button>
            <button type="button" data-jgc-admin-search-close>Close</button>
          </div>
        </header>
        <div class="jgc-admin-search-form">
          <input id="jgcAdminGlobalSearchInput" type="search" autocomplete="off" placeholder="Search dates, employees, jobs, WO or PO numbers..." aria-label="Search all portal records">
          <button id="jgcAdminGlobalSearchSubmit" type="button">Search</button>
        </div>
        <div id="jgcAdminGlobalSearchStatus" class="jgc-admin-search-status">Type at least 2 characters to search all portal records.</div>
        <div id="jgcAdminGlobalSearchResults" class="jgc-admin-search-results"></div>
      </section>
    `;
    document.body.appendChild(wrapper);

    const elements = getElements();
    elements.button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggle();
    });
    wrapper.querySelector("[data-jgc-admin-search-close]").addEventListener("click", close);
    elements.submit.addEventListener("click", () => runSearch(false));
    elements.refresh.addEventListener("click", () => runSearch(true));
    elements.input.addEventListener("input", scheduleSearch);
    elements.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        clearTimeout(state.timer);
        runSearch(false);
      }
      if (event.key === "Escape") close();
    });
    elements.results.addEventListener("click", (event) => {
      const button = event.target.closest("[data-jgc-admin-search-result]");
      if (button) openResult(button.getAttribute("data-jgc-admin-search-result"));
    });
    document.addEventListener("click", (event) => {
      if (!elements.panel.hidden && !wrapper.contains(event.target)) close();
    });
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      } else if (event.key === "Escape" && !elements.panel.hidden) {
        close();
      }
    });

    consumePendingResult();
  }

  global.JGCAdminGlobalSearch = {
    init,
    open,
    close,
    refresh: () => runSearch(true),
    search: () => runSearch(false)
  };
})(window);
