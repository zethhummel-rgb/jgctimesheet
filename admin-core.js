const supabaseClient = createJgcSupabaseClient();
const worker = requireJgcWorker();
const currentWorker = normalizeWorkerName(worker.key);
const currentWorkerDisplay = worker.display;
let timesheets = [];
let liveTimesheetEntries = [];
let inspections = [];
let vehicleInspections = [];
let certificates = [];
let certificateNotifications = [];
let vacationRequests = [];
let accounts = [];
let announcements = [];
let toolboxTalks = [];
let toolboxReports = [];
let toolboxAttendance = [];
let safetyAcknowledgements = [];
let dailySiteReports = [];
let incidentReports = [];
let accidentReports = [];
let accidentAcknowledgements = [];
let employeeInjuryReports = [];
let employeeInjuryAcknowledgements = [];
let policies = [];
let jobs = [];
let workOrders = [];
let digitalPurchaseOrders = [];
let workOrderLabourRows = [];
let workOrderPurchaseOrders = [];
let adminWorkOrderDigitalPoCounts = {};
let workOrderEquipmentRows = [];
let workOrderTravelRows = [];
let workOrderLabourWorkers = [];
let employeeFeatureAccessRows = [];
let adminWorkOrderManagementView = "active";
let jobDashboardRecordReturnFocus = null;
let jobDashboardContentLoaded = false;
let jobDashboardContentLoading = null;
let equipmentItems = [];
let equipmentNotifications = [];
let equipmentMaintenanceLogs = [];
let equipmentDocuments = [];
let activeEquipmentQr = null;
let activeEquipmentDocumentsId = "";
let contacts = [];
let subcontractorSuppliers = [];
let subcontractorSupplierContacts = [];
let subcontractorActivity = [];
let announcementAcknowledgements = [];
let vacationCalendarMonth = new Date();
let scheduleEvents = [];
let adminScheduleMonth = new Date();
let editingAdminScheduleEventId = "";
let certificateUrls = {};
let announcementUrls = {};
let toolboxTalkUrls = {};
let policyUrls = {};
let activeAdminReportSubtab = localStorage.getItem("jgcActiveAdminReportSubtab") || "daily";
let currentUserId = "";
let editingContactId = "";
let editingSubcontractorSupplierId = "";
let selectedSubcontractorSupplierId = "";
let editingSubcontractorSupplierContactId = "";
let editingTimesheetId = "";
let editingLiveTimesheetEntryId = "";
let editingEquipmentId = "";
let adminDataLoaded = false;
let adminDataLoading = false;
let pendingAdminTabRender = "";
let adminTabDataLoaded = new Set();
let adminTabDataLoading = {};
let adminScheduleReferenceDataLoaded = false;
let adminScheduleReferenceDataPromise = null;
let timesheetsTabRefreshInFlight = false;
let timesheetMissingNotificationKeys = new Set();
let adminGlobalSearchTasks = [];
let adminGlobalSearchIndex = [];
let adminGlobalSearchResults = [];
let adminGlobalSearchReady = false;
let adminGlobalSearchLoadPromise = null;
let adminGlobalSearchTimer = null;
const ANNOUNCEMENT_EMAIL_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzPILTnOSzQcCkA6y5vSLxCH6i05Y2-ZHZAk09Und0YKiXZOYMppV4fvW3G6EgqOIZi/exec";
const CERTIFICATE_EMAIL_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzPILTnOSzQcCkA6y5vSLxCH6i05Y2-ZHZAk09Und0YKiXZOYMppV4fvW3G6EgqOIZi/exec";
const EQUIPMENT_EMAIL_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzPILTnOSzQcCkA6y5vSLxCH6i05Y2-ZHZAk09Und0YKiXZOYMppV4fvW3G6EgqOIZi/exec";
const TIMESHEET_EMAIL_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxSW9gOO44n6eMaZyQwB-pXWmkEgbUNeSAxa6jbrTM5c_7ZgSD6RRrbO7YkFuqQl_-4/exec";
const SCHEDULE_EMAIL_SCRIPT_URL = ANNOUNCEMENT_EMAIL_SCRIPT_URL;
const ADMIN_TAB_STORAGE_KEY = "jgcAdminActiveTab";
const SAFETY_RECORDS_STORAGE_KEY = "jgcAdminSafetyRecordsSubtab";
const SAFETY_RECORDS_SUBTABS = ["inspections", "reports", "permits"];
const ADMIN_TOOL_TABS = ["employeeProfile", "certificates", "noticePolicy", "jobs", "equipment", "contacts", "subcontractorsSuppliers", "backups"];
const ADMIN_ALLOWED_TABS = ["summary", "jobDashboard", "employeeProfile", "timesheets", "safetyRecords", "certificates", "vacation", "tasks", "workOrders", "adminTools", "noticePolicy", "jobs", "equipment", "contacts", "subcontractorsSuppliers", "backups"];
let currentAdminTab = "";
let activeSafetyRecordsSubtab = "inspections";
let safetyRecordsSubtabDataLoaded = new Set();
let safetyRecordsSubtabDataLoading = {};

if (!isAdminWorker(currentWorker, worker.role)) {
    alert("Admin is only available to authorized users.");
    window.location.href = "home.html";
}

document.getElementById("currentUser").textContent = "Signed in as: " + currentWorkerDisplay;

window.addEventListener("message", function(event) {
    const data = event.data || {};

    if (data.type !== "jgc-task-frame-height") {
        return;
    }

    const frame = document.querySelector(".admin-task-frame");

    if (!frame || event.source !== frame.contentWindow) {
        return;
    }

    const height = Math.min(5000, Math.max(520, Math.ceil(Number(data.height) || 0) + 18));
    frame.style.height = height + "px";
});

function persistAdminTab(tab) {
    if (!ADMIN_ALLOWED_TABS.includes(tab)) {
        return;
    }

    currentAdminTab = tab;
    localStorage.setItem(ADMIN_TAB_STORAGE_KEY, tab);

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("tab", tab);
    if (tab === "safetyRecords") {
        nextUrl.searchParams.set("records", getActiveSafetyRecordsSubtab());
    } else {
        nextUrl.searchParams.delete("records");
    }
    nextUrl.hash = "";
    window.history.replaceState({ adminTab: tab }, "", nextUrl);
}

function getActiveAdminTab() {
    return ADMIN_ALLOWED_TABS.includes(currentAdminTab) ? currentAdminTab : getRequestedAdminTab();
}

function normalizeSafetyRecordsSubtab(value) {
    return SAFETY_RECORDS_SUBTABS.includes(value) ? value : "inspections";
}

function getActiveSafetyRecordsSubtab() {
    return normalizeSafetyRecordsSubtab(activeSafetyRecordsSubtab);
}

function setActiveSafetyRecordsSubtab(subtab, options = {}) {
    activeSafetyRecordsSubtab = normalizeSafetyRecordsSubtab(subtab);

    if (options.persist === false) {
        return;
    }

    localStorage.setItem(SAFETY_RECORDS_STORAGE_KEY, activeSafetyRecordsSubtab);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("tab", "safetyRecords");
    nextUrl.searchParams.set("records", activeSafetyRecordsSubtab);
    nextUrl.hash = "";
    window.history.replaceState({ adminTab: "safetyRecords", safetyRecordsSubtab: activeSafetyRecordsSubtab }, "", nextUrl);
}

async function loadSafetyRecordsSubtabData(subtab) {
    const requestedSubtab = normalizeSafetyRecordsSubtab(subtab);

    if (requestedSubtab === "inspections" || requestedSubtab === "permits") {
        const [inspectionResult, vehicleInspectionResult] = await runAdminQueries([
            { label: "inspection records", query: () => supabaseClient.from("inspection_records").select("*").order("created_at", { ascending: false }) },
            { label: "vehicle inspection records", query: () => supabaseClient.from("vehicle_inspection_records").select("*").order("created_at", { ascending: false }) }
        ]);
        inspections = inspectionResult.data || [];
        vehicleInspections = vehicleInspectionResult.data || [];
        safetyRecordsSubtabDataLoaded.add("inspections");
        safetyRecordsSubtabDataLoaded.add("permits");
        return;
    }

    const [inspectionResult, safetyAcknowledgementResult, dailyResult, incidentResult, accidentResult, accidentAckResult, injuryResult, injuryAckResult, toolboxTalkResult, toolboxReportResult, toolboxAttendanceResult] = await runAdminQueries([
        { label: "report inspection records", query: () => supabaseClient.from("inspection_records").select("*").order("created_at", { ascending: false }) },
        { label: "report safety acknowledgements", query: () => supabaseClient.from("safety_acknowledgements").select("*").order("created_at", { ascending: false }) },
        { label: "daily reports", query: () => supabaseClient.from("daily_site_reports").select("*").order("report_date", { ascending: false }).order("created_at", { ascending: false }) },
        { label: "incident reports", query: () => supabaseClient.from("incident_reports").select("*").order("report_date", { ascending: false }).order("created_at", { ascending: false }) },
        { label: "accident reports", query: () => supabaseClient.from("accident_reports").select("*").order("accident_date", { ascending: false }).order("created_at", { ascending: false }) },
        { label: "accident acknowledgements", query: () => supabaseClient.from("accident_report_acknowledgements").select("*").order("created_at", { ascending: false }) },
        { label: "employee injury reports", query: () => supabaseClient.from("employee_injury_reports").select("*").order("accident_date", { ascending: false }).order("created_at", { ascending: false }) },
        { label: "employee injury acknowledgements", query: () => supabaseClient.from("employee_injury_acknowledgements").select("*").order("created_at", { ascending: false }) },
        { label: "toolbox talks", query: () => supabaseClient.from("toolbox_talks").select("*").eq("is_active", true).order("created_at", { ascending: false }) },
        { label: "toolbox talk reports", query: () => supabaseClient.from("toolbox_talk_reports").select("*").order("created_at", { ascending: false }) },
        { label: "toolbox talk attendance", query: () => supabaseClient.from("toolbox_talk_attendance").select("*").order("created_at", { ascending: false }) }
    ]);
    inspections = inspectionResult.data || [];
    safetyAcknowledgements = safetyAcknowledgementResult.data || [];
    dailySiteReports = dailyResult.data || [];
    incidentReports = incidentResult.data || [];
    accidentReports = accidentResult.data || [];
    accidentAcknowledgements = accidentAckResult.data || [];
    employeeInjuryReports = injuryResult.data || [];
    employeeInjuryAcknowledgements = injuryAckResult.data || [];
    toolboxTalks = toolboxTalkResult.data || [];
    toolboxReports = toolboxReportResult.data || [];
    toolboxAttendance = toolboxAttendanceResult.data || [];
    await prepareToolboxTalkUrls();
    safetyRecordsSubtabDataLoaded.add("reports");
}

function ensureSafetyRecordsSubtabData(subtab) {
    const requestedSubtab = normalizeSafetyRecordsSubtab(subtab);

    if (!supabaseClient || safetyRecordsSubtabDataLoaded.has(requestedSubtab)) {
        return true;
    }

    if (safetyRecordsSubtabDataLoading[requestedSubtab]) {
        return false;
    }

    safetyRecordsSubtabDataLoading[requestedSubtab] = true;
    loadSafetyRecordsSubtabData(requestedSubtab)
        .catch((error) => logAdminLoadError("lazy load safety records " + requestedSubtab, error))
        .finally(() => {
            safetyRecordsSubtabDataLoaded.add(requestedSubtab);
            safetyRecordsSubtabDataLoading[requestedSubtab] = false;

            if (getActiveAdminTab() === "safetyRecords" && getActiveSafetyRecordsSubtab() === requestedSubtab) {
                renderSafetyRecordsPanel(requestedSubtab);
            }
        });

    return false;
}

function renderSafetyRecordsPanel(subtab) {
    const requestedSubtab = normalizeSafetyRecordsSubtab(subtab);
    const inspectionSection = document.getElementById("inspectionsSection");
    const reportsSection = document.getElementById("reportsSection");
    const inspectionTitle = document.getElementById("adminInspectionSectionTitle");

    if (inspectionSection) {
        inspectionSection.hidden = requestedSubtab === "reports";
    }

    if (reportsSection) {
        reportsSection.hidden = requestedSubtab !== "reports";
    }

    if (inspectionTitle) {
        inspectionTitle.textContent = requestedSubtab === "permits" ? "Safety Permits" : "Inspection Reports";
    }

    if (adminTabDataLoading.safetyRecords && !adminTabDataLoaded.has("safetyRecords")) {
        if (requestedSubtab !== "reports") {
            renderInspections(requestedSubtab);
        }
        return;
    }

    if (!ensureSafetyRecordsSubtabData(requestedSubtab)) {
        if (requestedSubtab === "reports") {
            const reportPanel = document.querySelector("#reportsSection .admin-report-panels");
            if (reportPanel) {
                reportPanel.setAttribute("aria-busy", "true");
            }
        } else {
            renderInspections(requestedSubtab);
        }
        return;
    }

    if (requestedSubtab === "reports") {
        const reportPanel = document.querySelector("#reportsSection .admin-report-panels");
        if (reportPanel) {
            reportPanel.removeAttribute("aria-busy");
        }
        renderReports();
        renderToolboxTalks();
        return;
    }

    renderInspections(requestedSubtab);
}

function switchSafetyRecordsSubtab(subtab, options = {}) {
    const requestedSubtab = normalizeSafetyRecordsSubtab(subtab);
    setActiveSafetyRecordsSubtab(requestedSubtab, options);
    document.querySelectorAll("[data-safety-record-tab]").forEach((button) => {
        const isActive = button.dataset.safetyRecordTab === requestedSubtab;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    closeAdminInspectionView();
    renderSafetyRecordsPanel(requestedSubtab);
}

function renderSafetyRecords() {
    switchSafetyRecordsSubtab(getActiveSafetyRecordsSubtab(), { persist: false });
}

function ensureAdminTabData(tab) {
    if (!supabaseClient || adminTabDataLoaded.has(tab)) {
        return true;
    }

    if (adminTabDataLoading[tab]) {
        return false;
    }

    const section = document.getElementById(tab + "Section");
    adminTabDataLoading[tab] = true;
    if (section) {
        section.setAttribute("aria-busy", "true");
    }
    loadAdminTabData(tab)
        .catch((error) => logAdminLoadError("lazy load " + tab, error))
        .finally(() => {
            adminTabDataLoaded.add(tab);
            adminTabDataLoading[tab] = false;
            if (section) {
                section.removeAttribute("aria-busy");
            }

            if (getActiveAdminTab() === tab) {
                renderActiveAdminTab(tab);
            }
        });

    return false;
}

async function loadJobDashboardContentData() {
    const [submittedResult, liveResult, inspectionResult, dailyResult, workOrderResult, digitalPoResult, labourResult, poResult, equipmentResult, travelResult] = await runAdminQueries([
        { label: "job dashboard submitted timesheets", query: () => supabaseClient.from("previous_timesheet_weeks").select("*").order("submitted_at", { ascending: false }) },
        { label: "job dashboard timesheets", query: () => supabaseClient.from("timesheet_entries").select("*").order("week_start", { ascending: false }).order("created_at", { ascending: false }) },
        { label: "job dashboard inspections", query: () => supabaseClient.from("inspection_records").select("*").order("created_at", { ascending: false }) },
        { label: "job dashboard daily reports", query: () => supabaseClient.from("daily_site_reports").select("*").order("report_date", { ascending: false }).order("created_at", { ascending: false }) },
        { label: "job dashboard work orders", query: () => supabaseClient.from("work_orders").select("*").order("work_order_date", { ascending: false }).order("created_at", { ascending: false }) },
        { label: "job dashboard digital purchase orders", query: () => supabaseClient.from("digital_purchase_orders").select("*").order("order_date", { ascending: false }).order("created_at", { ascending: false }).limit(2000) },
        { label: "job dashboard labour", query: () => supabaseClient.from("work_order_labour").select("*").order("employee_name", { ascending: true }) },
        { label: "job dashboard purchase orders", query: () => supabaseClient.from("work_order_purchase_orders").select("*").order("sort_order", { ascending: true }) },
        { label: "job dashboard equipment", query: () => supabaseClient.from("work_order_equipment").select("*") },
        { label: "job dashboard travel", query: () => supabaseClient.from("work_order_travel").select("*") }
    ]);
    timesheets = submittedResult.data || [];
    liveTimesheetEntries = liveResult.data || [];
    inspections = inspectionResult.data || [];
    dailySiteReports = dailyResult.data || [];
    workOrders = workOrderResult.data || [];
    digitalPurchaseOrders = digitalPoResult.data || [];
    workOrderLabourRows = labourResult.data || [];
    workOrderPurchaseOrders = poResult.data || [];
    workOrderEquipmentRows = equipmentResult.data || [];
    workOrderTravelRows = travelResult.data || [];
}

function ensureJobDashboardContentData() {
    if (jobDashboardContentLoaded) {
        return Promise.resolve();
    }

    if (!jobDashboardContentLoading) {
        jobDashboardContentLoading = loadJobDashboardContentData()
            .then(() => {
                jobDashboardContentLoaded = true;
            })
            .finally(() => {
                jobDashboardContentLoading = null;
            });
    }

    return jobDashboardContentLoading;
}

async function loadAdminTabData(tab) {
    if (tab === "summary" || tab === "vacation" || tab === "adminTools") {
        return;
    }

    if (tab === "timesheets") {
        const [submittedResult, liveResult, accountResult, jobsResult] = await runAdminQueries([
            { label: "submitted timesheets", query: () => supabaseClient.from("previous_timesheet_weeks").select("*").order("submitted_at", { ascending: false }) },
            { label: "live timesheet entries", query: () => supabaseClient.from("timesheet_entries").select("*").order("week_start", { ascending: false }).order("created_at", { ascending: false }) },
            { label: "profiles", query: () => supabaseClient.from("profiles").select("id,email,display_name,worker_key,role,account_status,created_at,approved_at,deactivated_at").order("display_name", { ascending: true }) },
            { label: "jobs", query: () => supabaseClient.from("jobs").select("*").order("job_number", { ascending: true }) }
        ]);
        timesheets = submittedResult.data || [];
        liveTimesheetEntries = liveResult.data || [];
        accounts = accountResult.data || accounts;
        jobs = jobsResult.data || jobs;
        return;
    }

    if (tab === "safetyRecords") {
        const safetySubtab = getActiveSafetyRecordsSubtab();
        await loadSafetyRecordsSubtabData(safetySubtab);
        safetyRecordsSubtabDataLoaded.add(safetySubtab);
        return;
    }

    if (tab === "inspections" || tab === "reports" || tab === "permits") {
        await loadSafetyRecordsSubtabData(tab === "reports" ? "reports" : tab === "permits" ? "permits" : "inspections");
        return;
    }

    if (tab === "certificates") {
        const [accountResult, certificateResult, notificationResult] = await runAdminQueries([
            { label: "certificate profiles", query: () => supabaseClient.from("profiles").select("id,email,display_name,worker_key,role,account_status,created_at,approved_at,deactivated_at").order("display_name", { ascending: true }) },
            { label: "certificates", query: () => supabaseClient.from("certificates").select("*").order("worker_name", { ascending: true }) },
            { label: "certificate notifications", query: () => supabaseClient.from("certificate_expiry_notifications").select("*").order("created_at", { ascending: false }) }
        ]);
        accounts = accountResult.data || accounts;
        certificates = certificateResult.data || [];
        certificateNotifications = notificationResult.data || [];
        await prepareCertificateUrls();
        await processCertificateExpiryNotifications();
        return;
    }

    if (tab === "noticePolicy") {
        await loadAnnouncements();
        await loadPolicies();
        return;
    }

    if (tab === "jobs") {
        await loadJobsManagement();
        return;
    }

    if (tab === "workOrders") {
        await loadAdminWorkOrders();
        return;
    }

    if (tab === "equipment") {
        await loadEquipment();
        return;
    }

    if (tab === "contacts") {
        await loadContacts();
        return;
    }

    if (tab === "subcontractorsSuppliers") {
        await loadSubcontractorSuppliers();
        return;
    }

    if (tab === "jobDashboard") {
        return;
    }

    if (tab === "employeeProfile") {
        const [submittedResult, liveResult, inspectionResult, vehicleInspectionResult, dailyResult, incidentResult, certificateResult, vacationResult, workOrderResult, labourResult, toolboxReportResult, toolboxAttendanceResult, policyResult, announcementAckResult] = await runAdminQueries([
            { label: "profile submitted timesheets", query: () => supabaseClient.from("previous_timesheet_weeks").select("*").order("submitted_at", { ascending: false }) },
            { label: "profile live timesheets", query: () => supabaseClient.from("timesheet_entries").select("*").order("week_start", { ascending: false }).order("created_at", { ascending: false }) },
            { label: "profile inspections", query: () => supabaseClient.from("inspection_records").select("*").order("created_at", { ascending: false }) },
            { label: "profile vehicle inspections", query: () => supabaseClient.from("vehicle_inspection_records").select("*").order("created_at", { ascending: false }) },
            { label: "profile daily reports", query: () => supabaseClient.from("daily_site_reports").select("*").order("report_date", { ascending: false }).order("created_at", { ascending: false }) },
            { label: "profile incidents", query: () => supabaseClient.from("incident_reports").select("*").order("report_date", { ascending: false }).order("created_at", { ascending: false }) },
            { label: "profile certificates", query: () => supabaseClient.from("certificates").select("*").order("worker_name", { ascending: true }) },
            { label: "profile vacations", query: () => supabaseClient.from("vacation_requests").select("*").order("created_at", { ascending: false }) },
            { label: "profile work orders", query: () => supabaseClient.from("work_orders").select("*").order("work_order_date", { ascending: false }).order("created_at", { ascending: false }) },
            { label: "profile work order labour", query: () => supabaseClient.from("work_order_labour").select("*").order("employee_name", { ascending: true }) },
            { label: "profile toolbox reports", query: () => supabaseClient.from("toolbox_talk_reports").select("*").order("created_at", { ascending: false }) },
            { label: "profile toolbox attendance", query: () => supabaseClient.from("toolbox_talk_attendance").select("*").order("created_at", { ascending: false }) },
            { label: "profile policies", query: () => supabaseClient.from("policies").select("*").eq("is_active", true).order("sort_order", { ascending: true }).order("title", { ascending: true }) },
            { label: "profile announcement acknowledgements", query: () => supabaseClient.from("announcement_acknowledgements").select("*").order("read_at", { ascending: false }) }
        ]);
        timesheets = submittedResult.data || [];
        liveTimesheetEntries = liveResult.data || [];
        inspections = inspectionResult.data || [];
        vehicleInspections = vehicleInspectionResult.data || [];
        dailySiteReports = dailyResult.data || [];
        incidentReports = incidentResult.data || [];
        certificates = certificateResult.data || [];
        vacationRequests = vacationResult.data || [];
        workOrders = workOrderResult.data || [];
        workOrderLabourRows = labourResult.data || [];
        toolboxReports = toolboxReportResult.data || [];
        toolboxAttendance = toolboxAttendanceResult.data || [];
        policies = policyResult.data || [];
        announcementAcknowledgements = announcementAckResult.data || [];
        await prepareCertificateUrls();
    }
}

function renderActiveAdminTab(tab) {
    const requestedTab = ADMIN_ALLOWED_TABS.includes(tab) ? tab : getActiveAdminTab();

    if (!adminDataLoaded && adminDataLoading) {
        pendingAdminTabRender = requestedTab;
        return;
    }

    if (!ensureAdminTabData(requestedTab)) {
        return;
    }

    if (requestedTab === "summary") {
        renderAdminScheduleCalendar();
        renderPortalSummary();
    }

    if (requestedTab === "jobDashboard") {
        renderJobDashboardOptions();
        renderJobDashboard();
    }

    if (requestedTab === "employeeProfile") {
        renderEmployeeProfile();
    }

    if (requestedTab === "vacation") {
        renderVacationRequests();
    }

    if (requestedTab === "safetyRecords") {
        renderSafetyRecords();
    }

    if (requestedTab === "certificates") {
        renderAdminCertificateWorkerOptions();
        renderCertificates();
    }

    if (requestedTab === "adminTools") {
        renderAdminTools();
    }

    if (requestedTab === "noticePolicy") {
        renderAnnouncements();
        renderPolicies();
    }

    if (requestedTab === "tasks" && typeof renderTasks === "function") {
        renderTasks();
    }

    if (requestedTab === "contacts") {
        renderContacts();
    }

    if (requestedTab === "subcontractorsSuppliers") {
        renderSubcontractorSuppliers();
    }

    if (requestedTab === "equipment") {
        renderEquipment();
    }

    if (requestedTab === "jobs") {
        renderJobsManagement();
    }

    if (requestedTab === "workOrders") {
        renderAdminWorkOrders();
    }

    if (requestedTab === "backups") {
        initializeBackupsPage();
    }
}

function showTab(tab, options = {}) {
    const legacySafetySubtabs = {
        inspections: "inspections",
        reports: "reports",
        permits: "permits"
    };
    const legacySafetySubtab = legacySafetySubtabs[tab];
    const normalizedTab = legacySafetySubtab ? "safetyRecords" : tab;
    const requestedTab = ADMIN_ALLOWED_TABS.includes(normalizedTab) ? normalizedTab : "summary";

    if (legacySafetySubtab) {
        setActiveSafetyRecordsSubtab(legacySafetySubtab, { persist: false });
    }

    if (options.persist !== false) {
        persistAdminTab(requestedTab);
    } else {
        currentAdminTab = requestedTab;
    }

    if (legacySafetySubtab && options.persist !== false) {
        setActiveSafetyRecordsSubtab(legacySafetySubtab);
    }

    ["inspectionsSection", "reportsSection"].forEach((sectionId) => {
        const section = document.getElementById(sectionId);
        if (section) {
            section.hidden = true;
        }
    });

    ADMIN_ALLOWED_TABS.forEach((name) => {
        const section = document.getElementById(name + "Section");
        const tabButton = document.getElementById(name + "Tab");

        if (section) {
            section.hidden = name !== requestedTab;
        }

        if (tabButton) {
            tabButton.classList.toggle("active", name === requestedTab);
        }
    });

    const adminToolsTab = document.getElementById("adminToolsTab");

    if (adminToolsTab) {
        adminToolsTab.classList.toggle("active", requestedTab === "adminTools" || ADMIN_TOOL_TABS.includes(requestedTab));
    }

    const employeeProfileEditSection = document.getElementById("employeeProfileEditSection");
    if (employeeProfileEditSection) {
        employeeProfileEditSection.hidden = requestedTab !== "employeeProfile";
    }

    if (requestedTab !== "summary") {
        markAdminTabViewed(requestedTab === "safetyRecords" ? getActiveSafetyRecordsSubtab() : requestedTab);
    }

    renderActiveAdminTab(requestedTab);

    if (requestedTab === "tasks") {
        ensureAdminTaskFrameLoaded();
    }

    if (requestedTab === "timesheets") {
        refreshTimesheetsTabOnOpen();
    }
}

async function refreshTimesheetsTabOnOpen() {
    if (!supabaseClient || timesheetsTabRefreshInFlight) {
        return;
    }

    timesheetsTabRefreshInFlight = true;

    try {
        await loadAdminTabData("timesheets");

        if (getActiveAdminTab() === "timesheets") {
            renderTimesheets();
            renderSickDays();
            renderPortalSummary();
        }
    } catch (error) {
        logAdminLoadError("refresh timesheets tab", error);
    } finally {
        timesheetsTabRefreshInFlight = false;
        adminTabDataLoaded.add("timesheets");
    }
}

function renderAdminTools() {
    const section = document.getElementById("adminToolsSection");

    if (!section) {
        return;
    }
}

function ensureAdminTaskFrameLoaded() {
    const frame = document.querySelector(".admin-task-frame");

    if (!frame || frame.getAttribute("src")) {
        return;
    }

    const source = frame.getAttribute("data-src");
    if (source) {
        frame.setAttribute("src", source);
    }
}

function openAdminTool(tab) {
    if (!ADMIN_TOOL_TABS.includes(tab)) {
        showTab("adminTools");
        return;
    }

    showTab(tab);
}

function getRequestedAdminTab() {
    const params = new URLSearchParams(window.location.search);
    const requested = String(params.get("tab") || window.location.hash || "").replace("#", "");
    const stored = localStorage.getItem(ADMIN_TAB_STORAGE_KEY);
    const legacySafetySubtabs = {
        inspections: "inspections",
        reports: "reports",
        permits: "permits"
    };
    const tabAliases = {
        announcements: "noticePolicy",
        policies: "noticePolicy",
        subcontractors: "subcontractorsSuppliers",
        suppliers: "subcontractorsSuppliers",
        vendors: "subcontractorsSuppliers"
    };

    const requestedSafetySubtab = legacySafetySubtabs[requested];
    const storedSafetySubtab = legacySafetySubtabs[stored];
    const querySafetySubtab = params.get("records");
    const storedPreferredSafetySubtab = localStorage.getItem(SAFETY_RECORDS_STORAGE_KEY);
    activeSafetyRecordsSubtab = normalizeSafetyRecordsSubtab(
        requestedSafetySubtab
        || (SAFETY_RECORDS_SUBTABS.includes(querySafetySubtab) ? querySafetySubtab : "")
        || storedSafetySubtab
        || storedPreferredSafetySubtab
    );

    const requestedAlias = requestedSafetySubtab ? "safetyRecords" : (tabAliases[requested] || requested);
    const storedAlias = storedSafetySubtab ? "safetyRecords" : (tabAliases[stored] || stored);

    if (ADMIN_ALLOWED_TABS.includes(requestedAlias)) {
        return requestedAlias;
    }

    if (ADMIN_ALLOWED_TABS.includes(storedAlias)) {
        return storedAlias;
    }

    return "summary";
}

function formatDate(value) {
    return formatDisplayDate(value);
}

function logAdminLoadError(label, error) {
    if (error) {
        console.warn("Admin load issue - " + label + ":", error);
        if (typeof window.logJgcDiagnostic === "function") {
            window.logJgcDiagnostic({
                severity: "error",
                category: "admin",
                event_type: "admin_data_load_failed",
                source: "admin-core",
                message: "Admin data could not load: " + label,
                details: { error }
            });
        }
    }
}

async function safeAdminSetupStep(label, callback) {
    try {
        await callback();
    } catch (error) {
        logAdminLoadError(label, error);
    }
}

function renderAdminSectionsSafely() {
    [
        ["timesheets", renderTimesheets],
        ["safety records", renderSafetyRecords],
        ["vacation", renderVacationRequests],
        ["announcements", renderAnnouncements],
        ["policies", renderPolicies],
        ["job dashboard options", renderJobDashboardOptions],
        ["job dashboard", renderJobDashboard],
        ["jobs management", renderJobsManagement],
        ["work orders", renderAdminWorkOrders],
        ["equipment", renderEquipment],
        ["contacts", renderContacts],
        ["subcontractors suppliers", renderSubcontractorSuppliers],
        ["employee profile options", renderEmployeeProfileOptions],
        ["employee profile", renderEmployeeProfile],
        ["schedule calendar", renderAdminScheduleCalendar],
        ["portal summary", renderPortalSummary],
        ["subcontractor activity", renderSubcontractorActivity]
    ].forEach(([label, renderer]) => {
        try {
            renderer();
        } catch (error) {
            logAdminLoadError("render " + label, error);
        }
    });
}

function renderImmediateAdminSectionsSafely() {
    [
        ["schedule calendar", renderAdminScheduleCalendar],
        ["portal summary", renderPortalSummary],
        ["subcontractor activity", renderSubcontractorActivity],
        ["vacation", renderVacationRequests]
    ].forEach(([label, renderer]) => {
        try {
            renderer();
        } catch (error) {
            logAdminLoadError("render " + label, error);
        }
    });
}

async function runAdminQueries(definitions) {
    const results = await Promise.all(definitions.map((definition, index) =>
        Promise.resolve(definition.query()).then((result) => {
            if (result && result.error) {
                logAdminLoadError(definition.label || ("query " + index), result.error);
            }

            return result || { data: [] };
        }).catch((error) => {
            logAdminLoadError(definition.label || ("query " + index), error);
            return { data: [], error };
        })
    ));

    return results;
}

function renderSubcontractorActivity() {
    const list = document.getElementById("subcontractorActivityList");
    const count = document.getElementById("subcontractorActivityCount");

    if (!list) {
        return;
    }

    if (!subcontractorActivity.length) {
        list.textContent = "No subcontractor portal activity yet.";
        if (count) {
            count.textContent = "0 companies";
        }
        return;
    }

    const companyGroups = new Map();

    subcontractorActivity.forEach((item) => {
        const companyName = String(item.company_name || "").trim() || "Unknown Company";
        const key = companyName.toLowerCase();

        if (!companyGroups.has(key)) {
            companyGroups.set(key, {
                companyName,
                rows: []
            });
        }

        companyGroups.get(key).rows.push(item);
    });

    const groups = Array.from(companyGroups.values()).sort((a, b) => {
        const aTime = new Date(a.rows[0] && a.rows[0].created_at || 0).getTime();
        const bTime = new Date(b.rows[0] && b.rows[0].created_at || 0).getTime();
        return bTime - aTime;
    });

    if (count) {
        count.textContent = groups.length + " compan" + (groups.length === 1 ? "y" : "ies");
    }

    list.innerHTML = groups.map((group) => {
        const latest = group.rows[0] || {};
        const contacts = Array.from(new Set(group.rows.map((row) => row.contact_name || row.email || "").filter(Boolean))).slice(0, 3);

        return `
            <details class="subcontractor-company-panel">
                <summary class="subcontractor-company-summary">
                    <span class="subcontractor-company-name">${escapeHtml(group.companyName)}</span>
                    <span class="subcontractor-company-meta">${escapeHtml(group.rows.length + " visit" + (group.rows.length === 1 ? "" : "s") + " | " + (latest.created_at ? formatDate(latest.created_at) : ""))}</span>
                </summary>
                <div class="subcontractor-company-body">
                    <div class="small" style="margin-bottom:8px;">${escapeHtml(contacts.length ? "Contacts: " + contacts.join(", ") : "No contact names recorded.")}</div>
                    <div class="table-wrap">
                        <table class="subcontractor-activity-table">
                            <thead>
                                <tr>
                                    <th>Time</th>
                                    <th>Contact</th>
                                    <th>Email</th>
                                    <th>Activity</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${group.rows.slice(0, 20).map((item) => `
                        <tr>
                            <td>${escapeHtml(item.created_at ? formatDate(item.created_at) : "")}</td>
                            <td>${escapeHtml(item.contact_name || "")}</td>
                            <td>${escapeHtml(item.email || "")}</td>
                            <td>${escapeHtml([item.action, item.page].filter(Boolean).join(" - "))}</td>
                        </tr>
                                `).join("")}
                            </tbody>
                        </table>
                    </div>
                </div>
            </details>
        `;
    }).join("");
}

async function loadSubcontractorActivity() {
    const list = document.getElementById("subcontractorActivityList");
    const count = document.getElementById("subcontractorActivityCount");

    if (list) {
        list.textContent = "Loading subcontractor activity...";
    }
    if (count) {
        count.textContent = "Loading...";
    }

    if (!supabaseClient) {
        if (list) {
            list.textContent = "Subcontractor activity could not be loaded.";
        }
        if (count) {
            count.textContent = "Unavailable";
        }
        return;
    }

    const { data, error } = await supabaseClient
        .from("subcontractor_portal_activity")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(80);

    if (error) {
        subcontractorActivity = [];
        if (list) {
            list.textContent = "Subcontractor activity is not set up yet.";
        }
        if (count) {
            count.textContent = "Unavailable";
        }
        logAdminLoadError("subcontractor activity", error);
        return;
    }

    subcontractorActivity = data || [];
    renderSubcontractorActivity();
}

async function loadAdminData(options = {}) {
    if (!supabaseClient) {
        document.getElementById("timesheetsList").textContent = "Supabase is not available.";
        return;
    }

    adminDataLoading = true;
    adminDataLoaded = false;

    try {
        const sessionResult = await supabaseClient.auth.getSession();
        currentUserId = sessionResult.data.session && sessionResult.data.session.user
            ? sessionResult.data.session.user.id
            : "";

        if (!options.full) {
            const adminDataResults = await runAdminQueries([
                { label: "live timesheet entries", query: () => supabaseClient.from("timesheet_entries").select("*").order("week_start", { ascending: false }).order("created_at", { ascending: false }) },
                { label: "vacation requests", query: () => supabaseClient.from("vacation_requests").select("*").order("created_at", { ascending: false }) },
                { label: "schedule events", query: () => supabaseClient.from("schedule_events").select("*").order("event_date", { ascending: true }).order("start_time", { ascending: true }) },
                { label: "profiles", query: () => supabaseClient.from("profiles").select("id,email,display_name,worker_key,role,account_status,created_at,approved_at,deactivated_at,phone,emergency_contact,address,position,department,hire_date,employment_type,supervisor,employee_id,avatar_path,last_login_at,last_portal_activity").order("display_name", { ascending: true }) },
                { label: "jobs", query: () => supabaseClient.from("jobs").select("*").order("job_number", { ascending: true }) },
                { label: "approved work order workers", query: () => supabaseClient.from("work_order_labour_workers").select("*").order("display_name", { ascending: true }) },
                { label: "employee page access", query: () => supabaseClient.from("employee_feature_access").select("worker_id,feature_key,enabled") },
                { label: "subcontractor activity", query: () => supabaseClient.from("subcontractor_portal_activity").select("*").order("created_at", { ascending: false }).limit(80) }
            ]);

            const [liveTimesheetResult, vacationResult, scheduleResult, accountResult, jobsResult, workOrderWorkerResult, employeeFeatureAccessResult, subcontractorActivityResult] = adminDataResults;

            liveTimesheetEntries = liveTimesheetResult.data || [];
            vacationRequests = vacationResult.data || [];
            scheduleEvents = scheduleResult.data || [];
            accounts = accountResult.data || [];
            jobs = jobsResult.data || [];
            workOrderLabourWorkers = workOrderWorkerResult.data || [];
            employeeFeatureAccessRows = employeeFeatureAccessResult.data || [];
            subcontractorActivity = subcontractorActivityResult.data || [];

            if ((!accounts.length && accountResult.error) || (accountResult.error && String(accountResult.error.message || "").toLowerCase().includes("column"))) {
                const { data: fallbackAccounts, error: fallbackAccountError } = await supabaseClient
                    .from("profiles")
                    .select("id,email,display_name,worker_key,role,account_status,created_at,approved_at,deactivated_at")
                    .order("display_name", { ascending: true });

                if (fallbackAccountError) {
                    logAdminLoadError("fallback profiles query", fallbackAccountError);
                } else {
                    accounts = fallbackAccounts || [];
                }
            }

            initializeAdminSummaryBaselines();
            jobDashboardContentLoaded = false;
            jobDashboardContentLoading = null;
            adminTabDataLoaded = new Set(["summary", "vacation", "adminTools", "jobDashboard"]);
            safetyRecordsSubtabDataLoaded = new Set();
            safetyRecordsSubtabDataLoading = {};
            adminDataLoaded = true;
            renderImmediateAdminSectionsSafely();
            showTab(pendingAdminTabRender || getActiveAdminTab(), { persist: false });
            pendingAdminTabRender = "";
            return;
        }

        const adminDataResults = await Promise.all([
        supabaseClient.from("previous_timesheet_weeks").select("*").order("submitted_at", { ascending: false }),
        supabaseClient.from("timesheet_entries").select("*").order("week_start", { ascending: false }).order("created_at", { ascending: false }),
        supabaseClient.from("inspection_records").select("*").order("created_at", { ascending: false }),
        supabaseClient.from("vehicle_inspection_records").select("*").order("created_at", { ascending: false }),
        supabaseClient.from("certificates").select("*").order("worker_name", { ascending: true }),
        supabaseClient.from("certificate_expiry_notifications").select("*").order("created_at", { ascending: false }),
        supabaseClient.from("vacation_requests").select("*").order("created_at", { ascending: false }),
        supabaseClient.from("schedule_events").select("*").order("event_date", { ascending: true }).order("start_time", { ascending: true }),
        supabaseClient.from("profiles").select("id,email,display_name,worker_key,role,account_status,created_at,approved_at,deactivated_at,phone,emergency_contact,address,position,department,hire_date,employment_type,supervisor,employee_id,avatar_path,last_login_at,last_portal_activity").order("display_name", { ascending: true }),
        supabaseClient.from("announcements").select("*").eq("is_active", true).order("created_at", { ascending: false }),
        supabaseClient.from("announcement_acknowledgements").select("*").order("read_at", { ascending: false }),
        supabaseClient.from("toolbox_talks").select("*").eq("is_active", true).order("created_at", { ascending: false }),
        supabaseClient.from("toolbox_talk_reports").select("*").eq("is_duplicate", false).order("created_at", { ascending: false }),
        supabaseClient.from("toolbox_talk_attendance").select("*").order("created_at", { ascending: false }),
        supabaseClient.from("daily_site_reports").select("*").order("report_date", { ascending: false }).order("created_at", { ascending: false }),
        supabaseClient.from("incident_reports").select("*").order("report_date", { ascending: false }).order("created_at", { ascending: false }),
        supabaseClient.from("accident_reports").select("*").order("accident_date", { ascending: false }).order("created_at", { ascending: false }),
        supabaseClient.from("accident_report_acknowledgements").select("*").order("created_at", { ascending: false }),
        supabaseClient.from("employee_injury_reports").select("*").order("accident_date", { ascending: false }).order("created_at", { ascending: false }),
        supabaseClient.from("employee_injury_acknowledgements").select("*").order("created_at", { ascending: false }),
        supabaseClient.from("policies").select("*").eq("is_active", true).order("sort_order", { ascending: true }).order("title", { ascending: true }),
        supabaseClient.from("jobs").select("*").order("job_number", { ascending: true }),
        supabaseClient.from("work_orders").select("*").order("work_order_date", { ascending: false }).order("created_at", { ascending: false }),
        supabaseClient.from("digital_purchase_orders").select("*").order("order_date", { ascending: false }).order("created_at", { ascending: false }).limit(2000),
        supabaseClient.from("work_order_labour").select("*").order("employee_name", { ascending: true }),
        supabaseClient.from("work_order_purchase_orders").select("*").order("sort_order", { ascending: true }),
        supabaseClient.from("work_order_equipment").select("*"),
        supabaseClient.from("work_order_travel").select("*"),
        supabaseClient.from("work_order_labour_workers").select("*").order("display_name", { ascending: true }),
        supabaseClient.from("employee_feature_access").select("worker_id,feature_key,enabled"),
        supabaseClient.from("equipment_vehicles").select("*").eq("is_active", true).order("name", { ascending: true }),
        supabaseClient.from("equipment_expiry_notifications").select("*").order("created_at", { ascending: false }),
        supabaseClient.from("equipment_maintenance_logs").select("*").order("scheduled_date", { ascending: false }).order("created_at", { ascending: false }),
        supabaseClient.from("contacts").select("*").eq("is_active", true).order("sort_order", { ascending: true }).order("name", { ascending: true }),
        supabaseClient.from("subcontractors_suppliers").select("*").eq("is_active", true).order("sort_order", { ascending: true }).order("company_name", { ascending: true }),
        supabaseClient.from("subcontractor_supplier_contacts").select("*").eq("is_active", true).order("sort_order", { ascending: true }).order("contact_name", { ascending: true }),
        supabaseClient.from("safety_acknowledgements").select("*").order("created_at", { ascending: false }),
        supabaseClient.from("subcontractor_portal_activity").select("*").order("created_at", { ascending: false }).limit(80)
    ].map((query, index) => Promise.resolve(query).then((result) => {
        if (result && result.error) {
            logAdminLoadError("query " + index, result.error);
        }

        return result || { data: [] };
    }).catch((error) => {
        logAdminLoadError("query " + index, error);
        return { data: [], error };
    })));

        const [timesheetResult, liveTimesheetResult, inspectionResult, vehicleInspectionResult, certificateResult, certificateNotificationResult, vacationResult, scheduleResult, accountResult, announcementResult, announcementAcknowledgementResult, toolboxTalkResult, toolboxReportResult, toolboxAttendanceResult, dailySiteReportResult, incidentReportResult, accidentReportResult, accidentAcknowledgementResult, employeeInjuryReportResult, employeeInjuryAcknowledgementResult, policyResult, jobsResult, workOrderResult, digitalPurchaseOrderResult, workOrderLabourResult, workOrderPoResult, workOrderEquipmentResult, workOrderTravelResult, workOrderWorkerResult, employeeFeatureAccessResult, equipmentResult, equipmentNotificationResult, equipmentMaintenanceResult, contactResult, subcontractorSupplierResult, subcontractorSupplierContactResult, safetyAcknowledgementResult, subcontractorActivityResult] = adminDataResults;

        timesheets = timesheetResult.data || [];
    liveTimesheetEntries = liveTimesheetResult.data || [];
    inspections = inspectionResult.data || [];
    vehicleInspections = vehicleInspectionResult.data || [];
    certificates = certificateResult.data || [];
    certificateNotifications = certificateNotificationResult.data || [];
    vacationRequests = vacationResult.data || [];
    scheduleEvents = scheduleResult.data || [];
    accounts = accountResult.data || [];
    if ((!accounts.length && accountResult.error) || (accountResult.error && String(accountResult.error.message || "").toLowerCase().includes("column"))) {
        const { data: fallbackAccounts, error: fallbackAccountError } = await supabaseClient
            .from("profiles")
            .select("id,email,display_name,worker_key,role,account_status,created_at,approved_at,deactivated_at")
            .order("display_name", { ascending: true });

        if (fallbackAccountError) {
            logAdminLoadError("fallback profiles query", fallbackAccountError);
        } else {
            accounts = fallbackAccounts || [];
        }
    }
    announcements = announcementResult.data || [];
    announcementAcknowledgements = announcementAcknowledgementResult.data || [];
    toolboxTalks = toolboxTalkResult.data || [];
    toolboxReports = toolboxReportResult.data || [];
    toolboxAttendance = toolboxAttendanceResult.data || [];
    dailySiteReports = dailySiteReportResult.data || [];
    incidentReports = incidentReportResult.data || [];
    accidentReports = accidentReportResult.data || [];
    accidentAcknowledgements = accidentAcknowledgementResult.data || [];
    employeeInjuryReports = employeeInjuryReportResult.data || [];
    employeeInjuryAcknowledgements = employeeInjuryAcknowledgementResult.data || [];
    policies = policyResult.data || [];
    jobs = jobsResult.data || [];
    workOrders = workOrderResult.data || [];
    digitalPurchaseOrders = digitalPurchaseOrderResult.data || [];
    workOrderLabourRows = workOrderLabourResult.data || [];
    workOrderPurchaseOrders = workOrderPoResult.data || [];
    workOrderEquipmentRows = workOrderEquipmentResult.data || [];
    workOrderTravelRows = workOrderTravelResult.data || [];
    jobDashboardContentLoaded = true;
    jobDashboardContentLoading = null;
    workOrderLabourWorkers = workOrderWorkerResult.data || [];
    employeeFeatureAccessRows = employeeFeatureAccessResult.data || [];
    equipmentItems = equipmentResult.data || [];
        equipmentNotifications = equipmentNotificationResult.data || [];
        equipmentMaintenanceLogs = equipmentMaintenanceResult.data || [];
        contacts = contactResult.data || [];
        subcontractorSuppliers = subcontractorSupplierResult.data || [];
        subcontractorSupplierContacts = subcontractorSupplierContactResult.data || [];
        safetyAcknowledgements = safetyAcknowledgementResult.data || [];
        subcontractorActivity = subcontractorActivityResult.data || [];
        await safeAdminSetupStep("certificate expiry notifications", processCertificateExpiryNotifications);
        await safeAdminSetupStep("equipment expiry notifications", processEquipmentExpiryNotifications);
        await safeAdminSetupStep("prepare announcement URLs", prepareAnnouncementUrls);
        await safeAdminSetupStep("prepare toolbox talk URLs", prepareToolboxTalkUrls);
        await safeAdminSetupStep("prepare policy URLs", preparePolicyUrls);
        initializeAdminSummaryBaselines();
        adminTabDataLoaded = new Set(ADMIN_ALLOWED_TABS);
        safetyRecordsSubtabDataLoaded = new Set(SAFETY_RECORDS_SUBTABS);
        safetyRecordsSubtabDataLoading = {};
        adminDataLoaded = true;
        renderAdminSectionsSafely();
        showTab(pendingAdminTabRender || getActiveAdminTab(), { persist: false });
        pendingAdminTabRender = "";
    } finally {
        adminDataLoading = false;
        if (adminDataLoaded) {
            renderActiveAdminTab(getActiveAdminTab());
        }
    }
}

async function loadAllAdminData() {
    await loadAdminData({ full: true });
}

async function signOut() {
    await signOutJgc(supabaseClient);
}

const supplierContactCompanySearchInput = document.getElementById("supplierContactCompanySearch");
if (supplierContactCompanySearchInput) {
    supplierContactCompanySearchInput.addEventListener("input", () => {
        selectSupplierCompanyFromSearch();
    });
    supplierContactCompanySearchInput.addEventListener("change", () => {
        selectSupplierCompanyFromSearch();
    });
}

const supplierContactPhoneInput = document.getElementById("supplierContactPhone");
if (supplierContactPhoneInput) {
    supplierContactPhoneInput.addEventListener("input", () => {
        const digits = supplierContactPhoneInput.value.replace(/\D/g, "");
        if (digits.length === 10 || (digits.length === 11 && digits.charAt(0) === "1")) {
            supplierContactPhoneInput.value = formatSupplierPhoneNumber(supplierContactPhoneInput.value);
        }
    });
    supplierContactPhoneInput.addEventListener("blur", () => {
        supplierContactPhoneInput.value = formatSupplierPhoneNumber(supplierContactPhoneInput.value);
    });
}

loadAdminData();
showTab(getRequestedAdminTab(), { persist: false });
