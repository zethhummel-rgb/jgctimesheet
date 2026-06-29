const JGC_SUPABASE_URL = "https://xnrljkkszoimegfivlya.supabase.co";
const JGC_SUPABASE_KEY = "sb_publishable_k_m_R-jzMnsnHhNY_OHwJA_cbO1qO58";
const JGC_ADMIN_EMAILS = ["zeth@johngordonconstruction.com", "jeff@johngordonconstruction.com"];
const JGC_GOOGLE_CALENDAR_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby0Z_lMrs25SO3G4L8cK46vs7ZVcrVH9nxsLsZxyIhpwjsuveu4L3DGlso0xPORmaXf/exec";
const JGC_SUBCONTRACTOR_ROLE = "subcontractor";
const JGC_SUBCONTRACTOR_HOME_PAGE = "subcontractor.html";
const JGC_SUBCONTRACTOR_ALLOWED_PAGES = [
  "subcontractor.html",
  "acknowledge.html",
  "equipment-inspection.html",
  "reports.html",
  "daily-site-report.html",
  "jsa.html",
  "toolbox-talks.html",
  "incident-report.html",
  "accident-report.html",
  "employee-injury-report.html",
  "inspections.html",
  "aerial-lifts.html",
  "forklift.html",
  "harness.html",
  "tele-handler.html",
  "permits.html",
  "hot-work-permit.html",
  "confined-space-permit.html",
  "excavation-permit.html",
  "todays-inspections.html",
  "policies-announcements.html",
  "contacts.html",
  "field-calculator.html"
];
const JGC_SUBCONTRACTOR_NAV_LINKS = [
  { label: "Inspections", href: "inspections.html" },
  { label: "Permits", href: "permits.html" },
  { label: "Reports", href: "reports.html" },
  { label: "Policies", href: "policies-announcements.html" },
  { label: "Contacts", href: "contacts.html" }
];

function jgcScheduleArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [value];
    } catch (error) {
      return [value];
    }
  }

  return [];
}

function jgcScheduleEventTitle(event) {
  const title = String(event && (event.title || event.job_name || event.location) || "").trim();
  const jobName = String(event && event.job_name || "").trim();
  const label = jobName && title && jobName !== title
    ? jobName + " - " + title
    : (title || jobName || "Schedule Event");

  return "[JGC] " + label;
}

function jgcAddDays(dateValue, days) {
  const date = new Date(String(dateValue || "") + "T00:00:00");
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function jgcScheduleEventDescription(event) {
  const employeeNames = jgcScheduleArray(event && event.employee_names).filter(Boolean).join(", ");
  const vehicle = String(event && (event.equipment_name || event.vehicle_name || "") || "").trim();
  const lines = [
    event && event.job_name ? "Job: " + [event.job_number, event.job_name].filter(Boolean).join(" - ") : "",
    employeeNames ? "Employees: " + employeeNames : "",
    vehicle ? "Vehicle / Equipment: " + vehicle : "",
    event && event.location ? "Location: " + event.location : "",
    event && event.maintenance_reason ? "Reason: " + event.maintenance_reason : "",
    event && event.notes ? "Notes: " + event.notes : "",
    "",
    "Created from JGC Portal.",
    "Portal Event ID: " + ((event && event.id) || "")
  ];

  return lines.filter(function(line, index) {
    return line || index === lines.length - 2;
  }).join("\n");
}

function buildJgcGoogleCalendarPayload(event, action) {
  return {
    action: action || "upsert",
    event: {
      id: event.id,
      sync_table: event.google_sync_table || event.sync_table || "schedule_events",
      google_event_id: event.google_event_id || "",
      event_type: event.event_type || "work",
      event_date: event.event_date,
      end_date: event.end_date || event.event_date,
      all_day: Boolean(event.all_day),
      start_time: event.start_time || "07:00",
      end_time: event.end_time || "07:30",
      title: jgcScheduleEventTitle(event),
      description: jgcScheduleEventDescription(event),
      location: event.location || "",
      job_name: event.job_name || "",
      job_number: event.job_number || "",
      employee_names: jgcScheduleArray(event.employee_names),
      employee_emails: jgcScheduleArray(event.employee_emails),
      notes: event.notes || "",
      maintenance_reason: event.maintenance_reason || ""
    }
  };
}

function getJgcGoogleSyncTable(event) {
  const table = String(event && (event.google_sync_table || event.sync_table) || "schedule_events");
  return table === "vacation_requests" ? "vacation_requests" : "schedule_events";
}

async function markJgcScheduleGoogleSyncStatus(supabaseClient, eventId, status, errorText, syncTable) {
  if (!supabaseClient || !eventId) {
    return;
  }

  const record = {
    google_sync_status: status || "not_synced",
    google_sync_error: errorText || null
  };

  if (status === "synced") {
    record.google_synced_at = new Date().toISOString();
  } else {
    record.google_synced_at = null;
  }

  await supabaseClient
    .from(syncTable === "vacation_requests" ? "vacation_requests" : "schedule_events")
    .update(record)
    .eq("id", eventId);
}

async function syncJgcScheduleEventToGoogle(supabaseClient, event, action) {
  if (!event || !event.id) {
    return { ok: false, skipped: true, error: "Missing schedule event." };
  }

  const syncTable = getJgcGoogleSyncTable(event);

  if (!JGC_GOOGLE_CALENDAR_SCRIPT_URL) {
    await markJgcScheduleGoogleSyncStatus(supabaseClient, event.id, "not_synced", "Google Calendar script URL is not configured.", syncTable);
    return { ok: false, skipped: true, error: "Google Calendar script URL is not configured." };
  }

  try {
    if (action !== "delete") {
      await markJgcScheduleGoogleSyncStatus(supabaseClient, event.id, "not_synced", null, syncTable);
    }

    await fetch(JGC_GOOGLE_CALENDAR_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(buildJgcGoogleCalendarPayload(event, action || "upsert"))
    });

    if (syncTable === "vacation_requests" && action !== "delete") {
      await markJgcScheduleGoogleSyncStatus(supabaseClient, event.id, "synced", null, syncTable);
    }

    return { ok: true };
  } catch (error) {
    const message = error && error.message ? error.message : String(error || "Google Calendar sync failed.");
    await markJgcScheduleGoogleSyncStatus(supabaseClient, event.id, "sync_failed", message, syncTable);
    return { ok: false, error: message };
  }
}

async function pullJgcGoogleCalendarUpdates() {
  if (!JGC_GOOGLE_CALENDAR_SCRIPT_URL) {
    return { ok: false, error: "Google Calendar script URL is not configured." };
  }

  try {
    await fetch(JGC_GOOGLE_CALENDAR_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify({ action: "pull_google_updates" })
    });

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error || "Google Calendar pull failed.") };
  }
}

function getJgcScheduleSyncLabel(event) {
  const status = String(event && event.google_sync_status || "not_synced").toLowerCase();
  const isSyncedVacation = Boolean(event && event.google_event_id && event.start_date);

  if (status === "synced" || isSyncedVacation) {
    return "Synced";
  }

  if (status === "sync_failed") {
    return "Sync Failed";
  }

  return "Not Synced";
}

function getJgcScheduleSyncClass(event) {
  const status = String(event && event.google_sync_status || "not_synced").toLowerCase();
  if (event && event.google_event_id && event.start_date) {
    return "synced";
  }
  return status === "synced" ? "synced" : (status === "sync_failed" ? "failed" : "pending");
}

function applyJgcPortalName() {
  const pageTitles = {
    "accounts.html": "Accounts",
    "acknowledge.html": "Safety Acknowledgement",
    "accident-report.html": "Supervisor Accident Investigation",
    "admin.html": "Admin",
    "aerial-lifts.html": "Aerial Lift Inspection",
    "certificates-admin.html": "Admin Certificates",
    "certificates.html": "Certificates",
    "contacts.html": "Contacts",
    "subcontractors-suppliers.html": "Subcontractors / Suppliers",
    "daily-site-report.html": "Daily Site Report",
    "equipment-vehicles.html": "Equipment / Vehicles",
    "field-calculator.html": "Field Calculator",
    "employee-injury-report.html": "Employee Injury Report",
    "forklift.html": "Forklift Inspection",
    "harness.html": "Harness Inspection",
    "home.html": "Home",
    "hot-work-permit.html": "Hot Work Permit",
    "confined-space-permit.html": "Confined Space Permit",
    "index.html": "Login",
    "inspections.html": "Inspections",
    "incident-report.html": "Incident / Near Miss Report",
    "jsa.html": "JSA",
    "previous-inspections.html": "Previous Inspections",
    "permits.html": "Permits",
    "excavation-permit.html": "Excavation Permit",
    "reset-password.html": "Reset Password",
    "tele-handler.html": "Telehandler Inspection",
    "tasks.html": "Tasks",
    "timesheet.html": "Timesheets",
    "toolbox-talks.html": "Tool Box Talks",
    "todays-inspections.html": "Today's Inspections",
    "vacation-request.html": "Vacation Request",
    "work-orders.html": "Work Orders",
    "policies-announcements.html": "Policies/Announcements",
    "reports.html": "Reports",
    "subcontractor.html": "Subcontractor Access"
  };
  const page = window.location.pathname.split("/").pop() || "index.html";
  const section = pageTitles[page];

  document.title = section ? "JGC Portal - " + section : "JGC Portal";

  if (page === "index.html") {
    const loginTitle = document.querySelector("body > h2");

    if (loginTitle) {
      loginTitle.textContent = "JGC Portal";
    }
  }

  if (page === "home.html") {
    const heroTitle = document.querySelector(".hero h1");

    if (heroTitle) {
      heroTitle.textContent = "JGC Portal";
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyJgcPortalName);
} else {
  applyJgcPortalName();
}

function applyJgcTheme() {
  if (!document.body || document.querySelector(".app-shell")) {
    return;
  }

  document.body.classList.add("jgc-theme");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyJgcTheme);
} else {
  applyJgcTheme();
}

function activateJgcPwa() {
  if (!document.querySelector('link[rel="manifest"]')) {
    const manifest = document.createElement("link");
    manifest.rel = "manifest";
    manifest.href = "manifest.json?v=3";
    document.head.appendChild(manifest);
  }

  const metaTags = [
    { name: "theme-color", content: "#0b5e3b" },
    { name: "apple-mobile-web-app-capable", content: "yes" },
    { name: "apple-mobile-web-app-title", content: "JGC Portal" },
    { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" }
  ];

  metaTags.forEach((tag) => {
    if (document.querySelector('meta[name="' + tag.name + '"]')) {
      return;
    }

    const meta = document.createElement("meta");
    meta.name = tag.name;
    meta.content = tag.content;
    document.head.appendChild(meta);
  });

  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    const appleIcon = document.createElement("link");
    appleIcon.rel = "apple-touch-icon";
    appleIcon.href = "icon-180.png?v=3";
    document.head.appendChild(appleIcon);
  }

  if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
    window.addEventListener("load", function() {
      let refreshing = false;

      function askWorkerToActivate(worker) {
        if (worker) {
          worker.postMessage({ type: "SKIP_WAITING" });
        }
      }

      function checkForUpdate(registration) {
        if (registration && typeof registration.update === "function") {
          registration.update().catch(function(error) {
            console.warn("JGC Portal update check failed.", error);
          });
        }
      }

      navigator.serviceWorker.addEventListener("controllerchange", function() {
        if (refreshing) {
          return;
        }

        refreshing = true;
        window.location.reload();
      });

      navigator.serviceWorker.register("service-worker.js", { updateViaCache: "none" }).then(function(registration) {
        checkForUpdate(registration);

        if (registration.waiting) {
          askWorkerToActivate(registration.waiting);
        }

        registration.addEventListener("updatefound", function() {
          const newWorker = registration.installing;

          if (!newWorker) {
            return;
          }

          newWorker.addEventListener("statechange", function() {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              askWorkerToActivate(newWorker);
            }
          });
        });

        window.setInterval(function() {
          checkForUpdate(registration);
        }, 3 * 60 * 1000);

        document.addEventListener("visibilitychange", function() {
          if (document.visibilityState === "visible") {
            checkForUpdate(registration);
          }
        });

        window.addEventListener("focus", function() {
          checkForUpdate(registration);
        });
      }).catch(function(error) {
        console.warn("JGC Portal service worker could not be registered.", error);
      });
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", activateJgcPwa);
} else {
  activateJgcPwa();
}

function createJgcSupabaseClient() {
  return window.supabase
    ? window.supabase.createClient(JGC_SUPABASE_URL, JGC_SUPABASE_KEY)
    : null;
}

let jgcProjectJobOptions = null;

function cleanJgcRepeatedJobName(value) {
  const text = String(value || "").trim();
  const words = text.split(/\s+/).filter(Boolean);

  if (words.length < 4 || words.length % 2 !== 0) {
    return text;
  }

  const half = words.length / 2;
  const first = words.slice(0, half).join(" ");
  const second = words.slice(half).join(" ");

  return first.toLowerCase() === second.toLowerCase() ? first : text;
}

function getJgcProjectJobDisplay(job) {
  const jobNumber = String(job && job.job_number || "").trim();
  const jobName = cleanJgcRepeatedJobName(job && job.job_name);

  return jobNumber ? jobNumber + " - " + jobName : jobName;
}

async function getJgcProjectJobOptions() {
  if (jgcProjectJobOptions) {
    return jgcProjectJobOptions;
  }

  const client = createJgcSupabaseClient();

  if (!client) {
    jgcProjectJobOptions = [];
    return jgcProjectJobOptions;
  }

  const { data, error } = await client
    .from("jobs")
    .select("job_number, job_name, active")
    .eq("active", true)
    .order("job_number", { ascending: true });

  if (error) {
    console.warn("JGC projects could not be loaded.", error);
    jgcProjectJobOptions = [];
    return jgcProjectJobOptions;
  }

  jgcProjectJobOptions = (data || []).filter((job) => String(job.job_name || "").trim());
  return jgcProjectJobOptions;
}

function enhanceJgcProjectJobInputs() {
  const fields = Array.from(document.querySelectorAll("[data-jgc-project-job]"));

  if (!fields.length) {
    return;
  }

  const listId = "jgcProjectJobOptions";
  let list = document.getElementById(listId);

  if (!list) {
    list = document.createElement("datalist");
    list.id = listId;
    document.body.appendChild(list);
  }

  fields.forEach((field) => {
    field.setAttribute("list", listId);
    if (!field.placeholder) {
      field.placeholder = "Select project/job or type manually";
    }
  });

  getJgcProjectJobOptions().then((jobs) => {
    list.innerHTML = jobs
      .map((job) => '<option value="' + escapeHtml(getJgcProjectJobDisplay(job)) + '"></option>')
      .join("");
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", enhanceJgcProjectJobInputs);
} else {
  enhanceJgcProjectJobInputs();
}

async function recordJgcPortalActivity() {
  if (!window.supabase || !localStorage.getItem("currentWorker")) {
    return;
  }

  if (isJgcSubcontractorSession()) {
    await recordJgcSubcontractorActivity("page_view");
    return;
  }

  const lastRecorded = Number(sessionStorage.getItem("jgcPortalActivityRecordedAt") || 0);
  const nowMs = Date.now();

  if (lastRecorded && nowMs - lastRecorded < 15 * 60 * 1000) {
    return;
  }

  const client = createJgcSupabaseClient();

  if (!client) {
    return;
  }

  try {
    const { data } = await client.auth.getSession();
    const user = data && data.session && data.session.user;

    if (!user) {
      return;
    }

    const activityTime = new Date().toISOString();
    const { error } = await client
      .from("profiles")
      .update({
        last_login_at: activityTime,
        last_portal_activity: activityTime
      })
      .eq("id", user.id);

    if (!error) {
      sessionStorage.setItem("jgcPortalActivityRecordedAt", String(nowMs));
    }
  } catch (error) {
    console.warn("JGC Portal activity could not be recorded.", error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", recordJgcPortalActivity);
} else {
  recordJgcPortalActivity();
}

function normalizeWorkerName(name) {
  return String(name || "").trim().toLowerCase();
}

function getCurrentWorkerRecord() {
  if (localStorage.getItem("jgcStayLoggedIn") === "false" && sessionStorage.getItem("jgcActiveSession") !== "true") {
    clearJgcSession();
  }

  const key = localStorage.getItem("currentWorker");

  return {
    key,
    display: localStorage.getItem("currentWorkerDisplay") || key,
    email: localStorage.getItem("currentUserEmail") || "",
    role: localStorage.getItem("currentUserRole") || "worker",
    status: localStorage.getItem("currentAccountStatus") || "",
    company: localStorage.getItem("jgcSubcontractorCompany") || "",
    phone: localStorage.getItem("jgcSubcontractorPhone") || "",
    sessionId: localStorage.getItem("jgcSubcontractorSessionId") || ""
  };
}

function isAdminWorker(workerKey, role, email) {
  const storedEmail = normalizeWorkerName(email || localStorage.getItem("currentUserEmail"));
  return role === "admin" || JGC_ADMIN_EMAILS.includes(storedEmail);
}

function isJgcSubcontractorSession(worker) {
  const record = worker || getCurrentWorkerRecord();
  return record && record.role === JGC_SUBCONTRACTOR_ROLE;
}

function isJgcSubcontractorAllowedPage(page) {
  return JGC_SUBCONTRACTOR_ALLOWED_PAGES.includes(page || "");
}

function getCurrentJgcPageName() {
  return window.location.pathname.split("/").pop() || "index.html";
}

function createJgcSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return "sub-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function setJgcSubcontractorSession(details) {
  const contactName = String(details && details.contactName || "").trim().replace(/\s+/g, " ");
  const companyName = String(details && details.companyName || "").trim().replace(/\s+/g, " ");
  const email = String(details && details.email || "").trim().toLowerCase();
  const phone = String(details && details.phone || "").trim();
  const sessionId = createJgcSessionId();

  localStorage.setItem("currentWorker", "subcontractor:" + email);
  localStorage.setItem("currentWorkerDisplay", contactName + (companyName ? " - " + companyName : ""));
  localStorage.setItem("currentUserEmail", email);
  localStorage.setItem("currentUserRole", JGC_SUBCONTRACTOR_ROLE);
  localStorage.setItem("currentAccountStatus", "approved");
  localStorage.setItem("jgcSubcontractorCompany", companyName);
  localStorage.setItem("jgcSubcontractorPhone", phone);
  localStorage.setItem("jgcSubcontractorSessionId", sessionId);
  localStorage.setItem("jgcStayLoggedIn", "true");
  sessionStorage.setItem("jgcActiveSession", "true");

  return getCurrentWorkerRecord();
}

function clearJgcSession() {
  localStorage.removeItem("currentWorker");
  localStorage.removeItem("currentWorkerDisplay");
  localStorage.removeItem("currentUserEmail");
  localStorage.removeItem("currentUserRole");
  localStorage.removeItem("currentAccountStatus");
  localStorage.removeItem("jgcSubcontractorCompany");
  localStorage.removeItem("jgcSubcontractorPhone");
  localStorage.removeItem("jgcSubcontractorSessionId");
  localStorage.removeItem("jgcStayLoggedIn");
  sessionStorage.removeItem("jgcActiveSession");
}

async function signOutJgc(client) {
  if (client) {
    await client.auth.signOut();
  }

  clearJgcSession();
  window.location.href = "index.html";
}

function requireJgcWorker() {
  const worker = getCurrentWorkerRecord();
  const page = getCurrentJgcPageName();

  if (!worker.key) {
    window.location.href = "index.html";
  }

  if (isJgcSubcontractorSession(worker) && !isJgcSubcontractorAllowedPage(page)) {
    window.location.href = JGC_SUBCONTRACTOR_HOME_PAGE;
  }

  return worker;
}

function enforceJgcSubcontractorAccess() {
  const worker = getCurrentWorkerRecord();
  const page = getCurrentJgcPageName();

  if (isJgcSubcontractorSession(worker) && !isJgcSubcontractorAllowedPage(page) && page !== "index.html" && page !== "reset-password.html") {
    window.location.href = JGC_SUBCONTRACTOR_HOME_PAGE;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", enforceJgcSubcontractorAccess);
} else {
  enforceJgcSubcontractorAccess();
}

function getJgcSubcontractorEmailPayloadExtras() {
  const worker = getCurrentWorkerRecord();

  if (!isJgcSubcontractorSession(worker)) {
    return {};
  }

  return {
    subcontractor_email: worker.email,
    subcontractor_name: worker.display,
    subcontractor_company: worker.company,
    replyTo: worker.email,
    additionalRecipients: worker.email ? [worker.email] : []
  };
}

function withJgcSubcontractorEmailCopy(payload) {
  return Object.assign({}, payload || {}, getJgcSubcontractorEmailPayloadExtras());
}

async function recordJgcSubcontractorActivity(action) {
  const worker = getCurrentWorkerRecord();

  if (!isJgcSubcontractorSession(worker) || !worker.email || !window.supabase) {
    return;
  }

  const page = getCurrentJgcPageName();
  const activityAction = action || "page_view";
  const throttleKey = "jgcSubcontractorActivity:" + page + ":" + activityAction;
  const lastRecorded = Number(sessionStorage.getItem(throttleKey) || 0);
  const nowMs = Date.now();

  if (activityAction === "page_view" && lastRecorded && nowMs - lastRecorded < 5 * 60 * 1000) {
    return;
  }

  const client = createJgcSupabaseClient();

  if (!client) {
    return;
  }

  try {
    const { error } = await client
      .from("subcontractor_portal_activity")
      .insert({
        session_id: worker.sessionId || createJgcSessionId(),
        contact_name: worker.display || "",
        company_name: worker.company || "",
        email: worker.email || "",
        phone: worker.phone || "",
        page,
        action: activityAction,
        user_agent: navigator.userAgent || ""
      });

    if (!error) {
      sessionStorage.setItem(throttleKey, String(nowMs));
    }
  } catch (error) {
    console.warn("Subcontractor activity could not be recorded.", error);
  }
}

function activateGlobalTopNavigation() {
  const page = window.location.pathname.split("/").pop() || "index.html";
  const params = new URLSearchParams(window.location.search);
  const excludedPages = ["index.html", "reset-password.html", "home.html", "field-calculator.html", "acknowledge.html", "equipment-inspection.html", JGC_SUBCONTRACTOR_HOME_PAGE];

  if (excludedPages.includes(page) || params.get("embedded") === "1" || document.getElementById("jgcGlobalTopNav")) {
    return;
  }

  const workerRecord = getCurrentWorkerRecord();
  const links = isJgcSubcontractorSession(workerRecord) ? JGC_SUBCONTRACTOR_NAV_LINKS : [
    { label: "Timesheets", href: "timesheet.html" },
    { label: "Inspections", href: "inspections.html" },
    { label: "Certificates", href: "certificates.html" },
    { label: "Vacation", href: "vacation-request.html" },
    { label: "Equipment", href: "equipment-vehicles.html" },
    { label: "WO", href: "work-orders.html" },
    { label: "Permits", href: "permits.html" },
    { label: "Reports", href: "reports.html" },
    { label: "Tasks", href: "tasks.html" },
    { label: "Policies", href: "policies-announcements.html" },
    { label: "Contacts", href: "contacts.html" },
    { label: "Subs/Suppliers", href: "subcontractors-suppliers.html" }
  ];

  const style = document.createElement("style");
  style.id = "jgcGlobalTopNavStyles";
  style.textContent = `
    body.jgc-has-global-nav {
      padding-top: 66px !important;
    }

    .jgc-global-top-nav {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 9999;
      min-height: 56px;
      padding: 8px 132px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(90deg, rgba(7, 55, 28, 0.98), rgba(11, 94, 59, 0.98));
      border-bottom: 1px solid rgba(255, 255, 255, 0.16);
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.26);
      font-family: Arial, sans-serif;
      overflow: hidden;
    }

    .jgc-global-top-nav button,
    .jgc-global-top-nav a {
      width: auto !important;
      min-width: max-content !important;
      flex: 0 0 auto;
      box-sizing: border-box;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 7px;
      padding: 9px 12px;
      background: rgba(255, 255, 255, 0.08);
      color: #ffffff;
      font-size: 13px;
      line-height: 1;
      font-weight: 800;
      text-decoration: none;
      white-space: nowrap !important;
      cursor: pointer;
    }

    .jgc-global-top-nav button:hover,
    .jgc-global-top-nav a:hover,
    .jgc-global-top-nav a.active {
      background: rgba(57, 200, 72, 0.28);
    }

    .jgc-nav-home,
    .jgc-nav-logout {
      position: absolute;
      top: 8px;
    }

    .jgc-nav-home {
      left: 14px;
    }

    .jgc-nav-logout {
      right: 14px;
    }

    .jgc-nav-center {
      display: flex;
      flex: 0 1 auto;
      min-width: 0;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: min(100%, calc(100vw - 280px));
      max-width: calc(100vw - 280px);
      overflow-x: auto;
      overflow-y: hidden;
      padding: 0 4px;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }

    .jgc-nav-center::-webkit-scrollbar {
      display: none;
    }

    .jgc-old-nav-hidden {
      display: none !important;
    }

    @media (min-width: 781px) and (max-width: 1180px) {
      .jgc-global-top-nav {
        padding: 8px 108px;
        justify-content: flex-start;
      }

      .jgc-nav-center {
        max-width: calc(100vw - 230px);
        width: calc(100vw - 230px);
        justify-content: flex-start;
      }

      .jgc-global-top-nav button,
      .jgc-global-top-nav a {
        min-height: 42px;
        padding: 8px 12px;
        font-size: 13px;
        white-space: nowrap !important;
      }
    }

    @media (max-width: 780px) {
      body.jgc-has-global-nav {
        padding-top: 58px !important;
      }

      .jgc-global-top-nav {
        min-height: 46px;
        padding: 8px 92px;
        align-items: center;
      }

      .jgc-nav-home,
      .jgc-nav-logout {
        top: 8px;
        padding: 8px 12px !important;
        min-height: 34px !important;
      }

      .jgc-global-top-nav button,
      .jgc-global-top-nav a {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 36px;
        padding: 7px 8px;
        font-size: 11px;
        line-height: 1.15;
        text-align: center;
        white-space: nowrap !important;
        overflow: hidden;
        word-break: normal;
      }

      .jgc-nav-center {
        display: none;
      }

      .jgc-nav-center a {
        width: 100% !important;
      }
    }

    @media (max-width: 390px) {
      .jgc-global-top-nav button,
      .jgc-global-top-nav a {
        font-size: 10px;
        padding-left: 5px;
        padding-right: 5px;
      }
    }
  `;
  document.head.appendChild(style);

  const nav = document.createElement("nav");
  nav.id = "jgcGlobalTopNav";
  nav.className = "jgc-global-top-nav";
  nav.setAttribute("aria-label", "JGC Portal navigation");
  nav.innerHTML = `
    <button type="button" class="jgc-nav-home">Home</button>
    <div class="jgc-nav-center">
      ${links.map((link) => '<a href="' + link.href + '"' + (page === link.href ? ' class="active"' : "") + ">" + link.label + "</a>").join("")}
    </div>
    <button type="button" class="jgc-nav-logout">Logout</button>
  `;

  document.body.classList.add("jgc-has-global-nav");
  document.body.prepend(nav);

  nav.querySelector(".jgc-nav-home").addEventListener("click", function() {
    const worker = getCurrentWorkerRecord();
    window.location.href = isJgcSubcontractorSession(worker)
      ? JGC_SUBCONTRACTOR_HOME_PAGE
      : (isAdminWorker(worker.key, worker.role, worker.email) ? "admin.html" : "home.html");
  });

  nav.querySelector(".jgc-nav-logout").addEventListener("click", async function() {
    await signOutJgc(createJgcSupabaseClient());
  });

  hideOldNavigationButtons();

  const observer = new MutationObserver(function() {
    hideOldNavigationButtons();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function hideOldNavigationButtons() {
  const nav = document.getElementById("jgcGlobalTopNav");

  document.querySelectorAll("button, a").forEach(function(element) {
    if (nav && nav.contains(element)) {
      return;
    }

    const text = String(element.textContent || "").trim().toLowerCase();
    const action = String(element.getAttribute("onclick") || "").toLowerCase();
    const isOldHome = text === "home" && action.includes("home");
    const isOldLogout = (text === "sign out" || text === "logout") && action.includes("signout");

    if (isOldHome || isOldLogout) {
      element.classList.add("jgc-old-nav-hidden");
    }
  });
}

function getJgcMobileNavItems() {
  if (isJgcSubcontractorSession()) {
    return {
      primary: [
        { label: "Home", href: JGC_SUBCONTRACTOR_HOME_PAGE, icon: "home", home: true },
        { label: "Reports", href: "reports.html", icon: "report" },
        { label: "Inspect", href: "inspections.html", icon: "shield" },
        { label: "Permits", href: "permits.html", icon: "permit" },
        { label: "Policies", href: "policies-announcements.html", icon: "policy" },
        { label: "Contacts", href: "contacts.html", icon: "phone" }
      ],
      more: []
    };
  }

  return {
    primary: [
      { label: "Home", href: "home.html", icon: "home", home: true },
      { label: "Timesheets", href: "timesheet.html", icon: "clock" },
      { label: "Jobs", href: "jobs.html", icon: "briefcase" },
      { label: "WO", href: "work-orders.html", icon: "file" },
      { label: "Inspections", href: "inspections.html", icon: "shield" },
      { label: "More", href: "#", icon: "more", more: true }
    ],
    more: [
      { label: "Certificates", href: "certificates.html", icon: "award" },
      { label: "Reports", href: "reports.html", icon: "report" },
      { label: "Permits", href: "permits.html", icon: "permit" },
      { label: "Vacation", href: "vacation-request.html", icon: "vacation" },
      { label: "Schedule", href: "schedule.html", icon: "schedule" },
      { label: "Tasks", href: "tasks.html", icon: "tasks" },
      { label: "Field Calculator", href: "field-calculator.html", icon: "calculator" },
      { label: "Equipment", href: "equipment-vehicles.html", icon: "truck" },
      { label: "Contacts", href: "contacts.html", icon: "phone" },
      { label: "Subs/Suppliers", href: "subcontractors-suppliers.html", icon: "briefcase" },
      { label: "Policies", href: "policies-announcements.html", icon: "policy" }
    ]
  };
}

function getJgcMobileNavIcon(name) {
  const icons = {
    home: '<path d="M3 10.5 12 3l9 7.5"></path><path d="M5 10v10h5v-6h4v6h5V10"></path>',
    clock: '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
    briefcase: '<path d="M9 6V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1"></path><rect x="3" y="6" width="18" height="14" rx="2"></rect><path d="M3 12h18"></path>',
    file: '<path d="M6 3h8l4 4v14H6z"></path><path d="M14 3v5h5"></path><path d="M9 13h6"></path><path d="M9 17h4"></path>',
    shield: '<path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6z"></path><path d="m9 12 2 2 4-5"></path>',
    more: '<circle cx="5" cy="12" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle>',
    award: '<circle cx="12" cy="8" r="5"></circle><path d="m8.5 12.5-2 7 5.5-3 5.5 3-2-7"></path>',
    report: '<path d="M5 3h11l3 3v15H5z"></path><path d="M16 3v4h4"></path><path d="M8 12h8"></path><path d="M8 16h8"></path>',
    permit: '<rect x="5" y="3" width="14" height="18" rx="2"></rect><path d="M9 8h6"></path><path d="M9 12h6"></path><path d="M9 16h4"></path>',
    vacation: '<path d="M12 3c4 3 4 7 0 9-4-2-4-6 0-9Z"></path><path d="M12 12v8"></path><path d="M7 20h10"></path>',
    schedule: '<rect x="4" y="5" width="16" height="17" rx="2"></rect><path d="M8 3v4"></path><path d="M16 3v4"></path><path d="M4 10h16"></path><path d="m9 16 2 2 4-5"></path>',
    tasks: '<path d="M9 6h11"></path><path d="M9 12h11"></path><path d="M9 18h11"></path><path d="m4 6 1 1 2-2"></path><path d="m4 12 1 1 2-2"></path><path d="m4 18 1 1 2-2"></path>',
    calculator: '<rect x="5" y="3" width="14" height="18" rx="2"></rect><path d="M8 7h8"></path><path d="M8 11h.01"></path><path d="M12 11h.01"></path><path d="M16 11h.01"></path><path d="M8 15h.01"></path><path d="M12 15h.01"></path><path d="M16 15h.01"></path><path d="M8 19h8"></path>',
    truck: '<path d="M3 7h11v10H3z"></path><path d="M14 11h4l3 3v3h-7z"></path><circle cx="7" cy="18" r="2"></circle><circle cx="18" cy="18" r="2"></circle>',
    phone: '<path d="M22 16.5v3a2 2 0 0 1-2.2 2 19 19 0 0 1-8.3-3A18.7 18.7 0 0 1 3 8.2 2 2 0 0 1 5 6h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1l-1.3 1.3a15 15 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6A2 2 0 0 1 22 16.5Z"></path>',
    policy: '<path d="M6 3h12v18H6z"></path><path d="M9 8h6"></path><path d="M9 12h6"></path><path d="M9 16h4"></path>'
  };

  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (icons[name] || icons.file) + '</svg>';
}

function activateMobileBottomNavigation() {
  const page = window.location.pathname.split("/").pop() || "index.html";
  const params = new URLSearchParams(window.location.search);
  const excludedPages = ["index.html", "reset-password.html", "field-calculator.html", "equipment-inspection.html"];

  if (excludedPages.includes(page) || params.get("embedded") === "1" || document.getElementById("jgcMobileBottomNav")) {
    return;
  }

  const navItems = getJgcMobileNavItems();
  const style = document.createElement("style");
  style.id = "jgcMobileBottomNavStyles";
  style.textContent = `
    .jgc-mobile-bottom-nav,
    .jgc-mobile-more-sheet,
    .jgc-mobile-more-backdrop {
      display: none;
    }

    @media (max-width: 780px) {
      body.jgc-has-mobile-bottom-nav {
        padding-bottom: calc(82px + env(safe-area-inset-bottom)) !important;
      }

      .jgc-mobile-bottom-nav {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 10020;
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 2px;
        padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
        background: rgba(3, 18, 16, 0.98);
        border-top: 1px solid rgba(64, 220, 78, 0.34);
        box-shadow: 0 -14px 34px rgba(0, 0, 0, 0.42);
        font-family: Arial, sans-serif;
      }

      .jgc-mobile-bottom-nav a,
      .jgc-mobile-bottom-nav button {
        min-width: 0 !important;
        width: 100% !important;
        min-height: 54px;
        margin: 0 !important;
        padding: 6px 3px !important;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        border: 1px solid transparent;
        border-radius: 12px;
        background: transparent;
        color: rgba(255, 255, 255, 0.78);
        font-size: 10px;
        line-height: 1.05;
        font-weight: 800;
        text-align: center;
        text-decoration: none;
        cursor: pointer;
        box-sizing: border-box;
      }

      .jgc-mobile-bottom-nav svg,
      .jgc-mobile-more-sheet svg {
        width: 20px;
        height: 20px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
        flex: 0 0 auto;
      }

      .jgc-mobile-bottom-nav a.active,
      .jgc-mobile-bottom-nav button.active {
        color: #ffffff;
        background: rgba(33, 186, 70, 0.28);
        border-color: rgba(64, 220, 78, 0.5);
      }

      .jgc-mobile-more-backdrop.open {
        position: fixed;
        inset: 0;
        z-index: 10018;
        display: block;
        background: rgba(0, 0, 0, 0.48);
      }

      .jgc-mobile-more-sheet {
        position: fixed;
        left: 12px;
        right: 12px;
        bottom: calc(76px + env(safe-area-inset-bottom));
        z-index: 10019;
        display: block;
        padding: 12px;
        border: 1px solid rgba(64, 220, 78, 0.4);
        border-radius: 16px;
        background: rgba(7, 26, 22, 0.98);
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.5);
        transform: translateY(18px);
        opacity: 0;
        pointer-events: none;
        transition: transform 0.16s ease, opacity 0.16s ease;
      }

      .jgc-mobile-more-sheet.open {
        transform: translateY(0);
        opacity: 1;
        pointer-events: auto;
      }

      .jgc-mobile-more-title {
        margin: 0 0 10px;
        color: #37e857;
        font-size: 14px;
        font-weight: 900;
      }

      .jgc-mobile-more-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      .jgc-mobile-more-grid a {
        min-height: 48px;
        padding: 10px;
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.06);
        color: #ffffff;
        text-decoration: none;
        font-size: 13px;
        font-weight: 800;
      }

      .jgc-mobile-more-grid a.active {
        background: rgba(33, 186, 70, 0.24);
        border-color: rgba(64, 220, 78, 0.52);
      }
    }
  `;
  document.head.appendChild(style);

  const primaryHtml = navItems.primary.map(function(item) {
    const active = page === item.href || (item.more && navItems.more.some(function(moreItem) { return moreItem.href === page; }));
    if (item.more) {
      return '<button type="button" class="' + (active ? "active" : "") + '" id="jgcMobileMoreButton">' + getJgcMobileNavIcon(item.icon) + '<span>' + item.label + '</span></button>';
    }

    if (item.home) {
      return '<button type="button" class="' + (page === item.href || page === "home.html" || page === "admin.html" ? "active" : "") + '" id="jgcMobileHomeButton">' + getJgcMobileNavIcon(item.icon) + '<span>' + item.label + '</span></button>';
    }

    return '<a href="' + item.href + '" class="' + (page === item.href ? "active" : "") + '">' + getJgcMobileNavIcon(item.icon) + '<span>' + item.label + '</span></a>';
  }).join("");

  const moreHtml = navItems.more.map(function(item) {
    return '<a href="' + item.href + '" class="' + (page === item.href ? "active" : "") + '">' + getJgcMobileNavIcon(item.icon) + '<span>' + item.label + '</span></a>';
  }).join("");

  const backdrop = document.createElement("div");
  backdrop.id = "jgcMobileMoreBackdrop";
  backdrop.className = "jgc-mobile-more-backdrop";

  const sheet = document.createElement("div");
  sheet.id = "jgcMobileMoreSheet";
  sheet.className = "jgc-mobile-more-sheet";
  sheet.innerHTML = '<div class="jgc-mobile-more-title">More</div><div class="jgc-mobile-more-grid">' + moreHtml + '</div>';

  const nav = document.createElement("nav");
  nav.id = "jgcMobileBottomNav";
  nav.className = "jgc-mobile-bottom-nav";
  nav.setAttribute("aria-label", "Mobile quick navigation");
  nav.innerHTML = primaryHtml;

  document.body.classList.add("jgc-has-mobile-bottom-nav");
  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);
  document.body.appendChild(nav);

  const moreButton = document.getElementById("jgcMobileMoreButton");
  const homeButton = document.getElementById("jgcMobileHomeButton");

  function closeMoreSheet() {
    sheet.classList.remove("open");
    backdrop.classList.remove("open");
  }

  function toggleMoreSheet() {
    const isOpen = sheet.classList.toggle("open");
    backdrop.classList.toggle("open", isOpen);
  }

  if (moreButton) {
    moreButton.addEventListener("click", toggleMoreSheet);
  }

  if (homeButton) {
    homeButton.addEventListener("click", function() {
      const worker = getCurrentWorkerRecord();
      window.location.href = isJgcSubcontractorSession(worker)
        ? JGC_SUBCONTRACTOR_HOME_PAGE
        : (isAdminWorker(worker.key, worker.role, worker.email) ? "admin.html" : "home.html");
    });
  }

  backdrop.addEventListener("click", closeMoreSheet);
  sheet.querySelectorAll("a").forEach(function(link) {
    link.addEventListener("click", closeMoreSheet);
  });
}

function getAppPageUrl(pageName) {
  const path = window.location.pathname;
  const folder = path.endsWith("/")
    ? path
    : path.substring(0, path.lastIndexOf("/") + 1);

  return window.location.origin + folder + pageName;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, function(character) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[character];
  });
}

function formatDisplayDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function activateContactsLinks() {
  const isAdminPage = /admin\.html$/i.test(window.location.pathname);

  document.querySelectorAll("button").forEach((button) => {
    const currentAction = String(button.getAttribute("onclick") || "").toLowerCase();

    if (
      isAdminPage &&
      (
        button.id === "contactsTab" ||
        button.closest(".tabs") ||
        button.closest(".admin-tools-grid") ||
        currentAction.includes("openadmintool(") ||
        currentAction.includes("showtab(")
      )
    ) {
      return;
    }

    const label = button.textContent.replace(/\s+/g, " ").trim().toLowerCase();
    const isContactsLink = label === "contacts"
      || currentAction.includes("contacts.html")
      || currentAction.includes("comingsoon('contacts")
      || currentAction.includes('comingsoon("contacts');

    if (!isContactsLink) {
      return;
    }

    button.onclick = function(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      window.location.href = "contacts.html";
    };
  });
}

function activateAdminContactsTab() {
  if (!/admin\.html$/i.test(window.location.pathname) || document.getElementById("contactsTab")) {
    return;
  }

  const worker = getCurrentWorkerRecord();

  if (!isAdminWorker(worker.key, worker.role)) {
    return;
  }

  const tabs = document.querySelector(".tabs");
  const signOutButton = Array.from(tabs ? tabs.querySelectorAll("button") : [])
    .find((button) => button.textContent.trim() === "Sign Out");

  if (!tabs || !signOutButton) {
    return;
  }

  const contactTab = document.createElement("button");
  contactTab.id = "contactsTab";
  contactTab.className = "tab-button";
  contactTab.type = "button";
  contactTab.textContent = "Contacts";
  tabs.insertBefore(contactTab, signOutButton);

  const section = document.createElement("div");
  section.id = "contactsSection";
  section.className = "card";
  section.hidden = true;
  section.innerHTML = `
    <h2>Contacts</h2>
    <div class="filters">
      <div>
        <label>Name</label>
        <input id="contactName" placeholder="Name">
      </div>
      <div>
        <label>Role / Description</label>
        <input id="contactRole" placeholder="Example: Safety, Payroll, Supervisor">
      </div>
      <div>
        <label>Phone</label>
        <input id="contactPhone" placeholder="Phone number">
      </div>
      <div>
        <label>Email</label>
        <input id="contactEmail" type="email" placeholder="Email address">
      </div>
      <div>
        <label>Order</label>
        <input id="contactOrder" type="number" value="0">
      </div>
      <div>
        <label>Notes</label>
        <input id="contactNotes" placeholder="Optional note">
      </div>
    </div>
    <div class="actions" style="margin-top:10px;">
      <button id="contactSaveButton" type="button">Add Contact</button>
      <button id="contactClearButton" class="secondary" type="button">Clear</button>
      <button id="contactRefreshButton" class="secondary" type="button">Refresh Contacts</button>
    </div>
    <div id="contactStatus" class="small" style="margin-top:10px;"></div>
    <div id="contactsList" class="small" style="margin-top:12px;">Loading contacts...</div>
  `;
  document.body.insertBefore(section, document.querySelector("script"));

  const client = createJgcSupabaseClient();
  let contacts = [];
  let editingContactId = "";
  let currentUserId = "";

  function showContactsTab() {
    ["timesheets", "inspections", "certificates", "vacation", "announcements", "contacts"].forEach((name) => {
      const panel = document.getElementById(name + "Section");
      const tab = document.getElementById(name + "Tab");

      if (panel) {
        panel.hidden = name !== "contacts";
      }

      if (tab) {
        tab.classList.toggle("active", name === "contacts");
      }
    });

    loadContacts();
  }

  function setContactStatus(message) {
    document.getElementById("contactStatus").textContent = message || "";
  }

  function clearContactForm() {
    editingContactId = "";
    document.getElementById("contactName").value = "";
    document.getElementById("contactRole").value = "";
    document.getElementById("contactPhone").value = "";
    document.getElementById("contactEmail").value = "";
    document.getElementById("contactOrder").value = "0";
    document.getElementById("contactNotes").value = "";
    document.getElementById("contactSaveButton").textContent = "Add Contact";
    setContactStatus("");
  }

  function renderContacts() {
    const list = document.getElementById("contactsList");

    if (!contacts.length) {
      list.textContent = "No contacts added yet.";
      return;
    }

    list.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role / Description</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Notes</th>
              <th>Order</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${contacts.map((contact) => `
              <tr>
                <td>${escapeHtml(contact.name)}</td>
                <td>${escapeHtml(contact.role || "")}</td>
                <td>${escapeHtml(contact.phone || "")}</td>
                <td>${contact.email ? '<a href="mailto:' + escapeHtml(contact.email) + '">' + escapeHtml(contact.email) + '</a>' : ""}</td>
                <td>${escapeHtml(contact.notes || "")}</td>
                <td>${Number(contact.sort_order || 0)}</td>
                <td>
                  <div class="actions">
                    <button type="button" class="secondary" data-contact-edit="${escapeHtml(contact.id)}">Edit</button>
                    <button type="button" class="delete-button" data-contact-delete="${escapeHtml(contact.id)}">Delete</button>
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    list.querySelectorAll("[data-contact-edit]").forEach((button) => {
      button.addEventListener("click", () => editContact(button.dataset.contactEdit));
    });
    list.querySelectorAll("[data-contact-delete]").forEach((button) => {
      button.addEventListener("click", () => deleteContact(button.dataset.contactDelete));
    });
  }

  async function loadContacts() {
    const { data, error } = await client
      .from("contacts")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      document.getElementById("contactsList").textContent = "Contacts could not be loaded.";
      return;
    }

    contacts = data || [];
    renderContacts();
  }

  function editContact(id) {
    const contact = contacts.find((item) => item.id === id);

    if (!contact) {
      alert("Contact could not be found.");
      return;
    }

    editingContactId = id;
    document.getElementById("contactName").value = contact.name || "";
    document.getElementById("contactRole").value = contact.role || "";
    document.getElementById("contactPhone").value = contact.phone || "";
    document.getElementById("contactEmail").value = contact.email || "";
    document.getElementById("contactOrder").value = contact.sort_order || 0;
    document.getElementById("contactNotes").value = contact.notes || "";
    document.getElementById("contactSaveButton").textContent = "Update Contact";
    setContactStatus("Editing " + (contact.name || "contact") + ".");
  }

  async function saveContact() {
    const name = document.getElementById("contactName").value.trim();
    const role = document.getElementById("contactRole").value.trim();
    const phone = document.getElementById("contactPhone").value.trim();
    const email = document.getElementById("contactEmail").value.trim();
    const notes = document.getElementById("contactNotes").value.trim();
    const sortOrder = Number(document.getElementById("contactOrder").value || 0);

    if (!name) {
      alert("Add a contact name.");
      return;
    }

    if (!phone && !email) {
      alert("Add at least a phone number or email address.");
      return;
    }

    setContactStatus(editingContactId ? "Updating contact..." : "Adding contact...");

    const values = {
      name,
      role,
      phone,
      email,
      notes,
      sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      updated_at: new Date().toISOString()
    };

    const result = editingContactId
      ? await client.from("contacts").update(values).eq("id", editingContactId)
      : await client.from("contacts").insert({
          ...values,
          created_by: currentUserId || null,
          created_by_name: worker.display || worker.key,
          is_active: true
        });

    if (result.error) {
      setContactStatus("Contact could not be saved.");
      return;
    }

    clearContactForm();
    setContactStatus("Contact saved.");
    await loadContacts();
  }

  async function deleteContact(id) {
    const contact = contacts.find((item) => item.id === id);

    if (!contact) {
      alert("Contact could not be found.");
      return;
    }

    if (!confirm("Delete " + (contact.name || "this contact") + "?")) {
      return;
    }

    const { error } = await client
      .from("contacts")
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    if (error) {
      alert("Contact could not be deleted.");
      return;
    }

    if (editingContactId === id) {
      clearContactForm();
    }

    await loadContacts();
  }

  contactTab.addEventListener("click", showContactsTab);
  section.querySelector("#contactSaveButton").addEventListener("click", saveContact);
  section.querySelector("#contactClearButton").addEventListener("click", clearContactForm);
  section.querySelector("#contactRefreshButton").addEventListener("click", loadContacts);

  if (client) {
    client.auth.getSession().then((result) => {
      currentUserId = result.data.session && result.data.session.user
        ? result.data.session.user.id
        : "";
    });
  }
}

function activateJgcContactsFeature() {
  activateContactsLinks();
  activateAdminContactsTab();
}

function activateAdminPoliciesTab() {
  if (!/admin\.html$/i.test(window.location.pathname) || document.getElementById("policiesTab")) {
    return;
  }

  const worker = getCurrentWorkerRecord();

  if (!isAdminWorker(worker.key, worker.role)) {
    return;
  }

  const tabs = document.querySelector(".tabs");
  const contactsTab = document.getElementById("contactsTab");
  const signOutButton = Array.from(tabs ? tabs.querySelectorAll("button") : [])
    .find((button) => button.textContent.trim() === "Sign Out");

  if (!tabs || !signOutButton) {
    return;
  }

  const policyTab = document.createElement("button");
  policyTab.id = "policiesTab";
  policyTab.className = "tab-button";
  policyTab.type = "button";
  policyTab.textContent = "Policies";
  tabs.insertBefore(policyTab, contactsTab || signOutButton);

  const section = document.createElement("div");
  section.id = "policiesSection";
  section.className = "card";
  section.hidden = true;
  section.innerHTML = `
    <h2>Policies</h2>
    <div class="announcement-grid">
      <div>
        <label>Policy Title</label>
        <input id="policyTitle" placeholder="Example: Fall Protection Policy">
      </div>
      <div>
        <label>Category</label>
        <input id="policyCategory" placeholder="Example: Safety" value="General">
      </div>
      <div>
        <label>Display Order</label>
        <input id="policyOrder" type="number" value="0">
      </div>
      <div class="full">
        <label>Description</label>
        <textarea id="policyDescription" placeholder="Short description for employees"></textarea>
      </div>
      <div class="full">
        <label>Policy PDF</label>
        <input id="policyFile" type="file" accept="application/pdf,.pdf">
      </div>
    </div>
    <div class="actions" style="margin-top:10px;">
      <button id="policySaveButton" type="button">Add Policy</button>
      <button id="policyRefreshButton" class="secondary" type="button">Refresh Policies</button>
    </div>
    <div id="policyStatus" class="small" style="margin-top:10px;"></div>
    <div id="policiesList" class="small" style="margin-top:12px;">Loading policies...</div>
  `;
  document.body.insertBefore(section, document.querySelector("script"));

  const client = createJgcSupabaseClient();
  let policies = [];
  let policyUrls = {};
  let currentUserId = "";

  function showPoliciesTab() {
    ["timesheets", "inspections", "certificates", "vacation", "announcements", "policies", "contacts"].forEach((name) => {
      const panel = document.getElementById(name + "Section");
      const tab = document.getElementById(name + "Tab");

      if (panel) {
        panel.hidden = name !== "policies";
      }

      if (tab) {
        tab.classList.toggle("active", name === "policies");
      }
    });

    loadPolicies();
  }

  function setPolicyStatus(message) {
    document.getElementById("policyStatus").textContent = message || "";
  }

  function makePolicyFileName(name) {
    return String(name || "policy.pdf")
      .trim()
      .replace(/[^a-z0-9.\-_]+/gi, "-")
      .replace(/-+/g, "-")
      .toLowerCase();
  }

  async function preparePolicyUrls() {
    policyUrls = {};

    for (const policy of policies) {
      if (!policy.file_path) {
        continue;
      }

      const { data } = await client
        .storage
        .from("policies")
        .createSignedUrl(policy.file_path, 604800);

      if (data && data.signedUrl) {
        policyUrls[policy.id] = data.signedUrl;
      }
    }
  }

  function renderPolicies() {
    const list = document.getElementById("policiesList");

    if (!policies.length) {
      list.textContent = "No active policies yet.";
      return;
    }

    list.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Category</th>
              <th>Description</th>
              <th>PDF</th>
              <th>Order</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${policies.map((policy) => `
              <tr>
                <td>${escapeHtml(policy.title)}</td>
                <td>${escapeHtml(policy.category || "General")}</td>
                <td>${escapeHtml(policy.description || "")}</td>
                <td>${policyUrls[policy.id] ? '<a class="file-link" href="' + policyUrls[policy.id] + '" target="_blank" rel="noopener">Open PDF</a>' : "-"}</td>
                <td>${Number(policy.sort_order || 0)}</td>
                <td>${escapeHtml(formatDisplayDate(policy.created_at))}</td>
                <td><button type="button" class="delete-button" data-policy-delete="${escapeHtml(policy.id)}">Delete</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    list.querySelectorAll("[data-policy-delete]").forEach((button) => {
      button.addEventListener("click", () => deletePolicy(button.dataset.policyDelete));
    });
  }

  async function loadPolicies() {
    const { data, error } = await client
      .from("policies")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true });

    if (error) {
      document.getElementById("policiesList").textContent = "Policies could not be loaded.";
      return;
    }

    policies = data || [];
    await preparePolicyUrls();
    renderPolicies();
  }

  async function publishPolicy() {
    const title = document.getElementById("policyTitle").value.trim();
    const description = document.getElementById("policyDescription").value.trim();
    const category = document.getElementById("policyCategory").value.trim() || "General";
    const sortOrder = Number(document.getElementById("policyOrder").value || 0);
    const fileInput = document.getElementById("policyFile");
    const file = fileInput.files[0];

    if (!title || !file) {
      alert("Add a policy title and PDF.");
      return;
    }

    if (file.type && file.type !== "application/pdf") {
      alert("Please upload a PDF file.");
      return;
    }

    setPolicyStatus("Uploading policy PDF...");

    const filePath = "policies/" + Date.now() + "-" + makePolicyFileName(file.name);
    const fileType = file.type || "application/pdf";
    const { error: uploadError } = await client
      .storage
      .from("policies")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: fileType
      });

    if (uploadError) {
      setPolicyStatus("Policy PDF upload failed.");
      return;
    }

    setPolicyStatus("Saving policy...");

    const { error } = await client
      .from("policies")
      .insert({
        title,
        description,
        category,
        sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
        file_path: filePath,
        file_name: file.name,
        file_type: fileType,
        created_by: currentUserId || null,
        created_by_name: worker.display || worker.key
      });

    if (error) {
      await client.storage.from("policies").remove([filePath]);
      setPolicyStatus("Policy could not be saved.");
      return;
    }

    document.getElementById("policyTitle").value = "";
    document.getElementById("policyDescription").value = "";
    document.getElementById("policyCategory").value = "General";
    document.getElementById("policyOrder").value = "0";
    fileInput.value = "";
    setPolicyStatus("Policy added.");
    await loadPolicies();
  }

  async function deletePolicy(id) {
    const policy = policies.find((item) => item.id === id);

    if (!policy) {
      alert("Policy could not be found.");
      return;
    }

    if (!confirm("Delete this policy?")) {
      return;
    }

    const { error } = await client
      .from("policies")
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    if (error) {
      alert("Policy could not be deleted.");
      return;
    }

    await loadPolicies();
  }

  policyTab.addEventListener("click", showPoliciesTab);
  section.querySelector("#policySaveButton").addEventListener("click", publishPolicy);
  section.querySelector("#policyRefreshButton").addEventListener("click", loadPolicies);

  if (client) {
    client.auth.getSession().then((result) => {
      currentUserId = result.data.session && result.data.session.user
        ? result.data.session.user.id
        : "";
    });
  }
}

function activateJgcPoliciesFeature() {
  activateAdminPoliciesTab();
}

function activatePoliciesAnnouncementsTile() {
  if (!/home\.html$/i.test(window.location.pathname)) {
    return;
  }

  function normalizeSinglePoliciesItem(selector, id) {
    const items = Array.from(document.querySelectorAll(selector)).filter((item) => {
      const target = String(item.getAttribute("onclick") || "").toLowerCase();
      const text = String(item.textContent || "").toLowerCase();
      return target.includes("policies-announcements.html") || text.includes("policies/announcements") || text.includes("policies & announcements");
    });

    items.forEach((item, index) => {
      if (index === 0) {
        item.id = id;
      } else {
        item.remove();
      }
    });
  }

  normalizeSinglePoliciesItem(".side-nav .side-link", "policiesAnnouncementsSideLink");
  normalizeSinglePoliciesItem("#moreSheet button", "policiesAnnouncementsMoreLink");
  normalizeSinglePoliciesItem(".cards-grid .feature-card", "policiesAnnouncementsCard");

  const sideNav = document.querySelector(".side-nav");

  if (sideNav && !document.getElementById("policiesAnnouncementsSideLink")) {
    const sideLink = document.createElement("button");
    sideLink.id = "policiesAnnouncementsSideLink";
    sideLink.type = "button";
    sideLink.className = "side-link";
    sideLink.onclick = function() {
      window.location.href = "policies-announcements.html";
    };
    sideLink.innerHTML = '<i data-lucide="file-text"></i><span class="side-label">Policies / Announcements</span>';

    const adminSideButton = document.getElementById("sideAdminButton");

    if (adminSideButton && adminSideButton.parentElement === sideNav) {
      sideNav.insertBefore(sideLink, adminSideButton);
    } else {
      sideNav.appendChild(sideLink);
    }
  }

  const moreSheet = document.getElementById("moreSheet");

  if (moreSheet && !document.getElementById("policiesAnnouncementsMoreLink")) {
    const moreLink = document.createElement("button");
    moreLink.id = "policiesAnnouncementsMoreLink";
    moreLink.type = "button";
    moreLink.onclick = function() {
      window.location.href = "policies-announcements.html";
    };
    moreLink.innerHTML = '<i data-lucide="file-text"></i>Policies / Announcements';

    const mobileAdminButton = document.getElementById("mobileAdminButton");

    if (mobileAdminButton && mobileAdminButton.parentElement === moreSheet) {
      moreSheet.insertBefore(moreLink, mobileAdminButton);
    } else {
      moreSheet.appendChild(moreLink);
    }
  }

  if (document.getElementById("policiesAnnouncementsCard")) {
    if (window.lucide) {
      window.lucide.createIcons();
    }
    return;
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function activateTimesheetTableContrastFeature() {
  if (!/timesheet\.html$/i.test(window.location.pathname) || document.getElementById("jgcTimesheetTableContrast")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "jgcTimesheetTableContrast";
  style.textContent = `
    body.jgc-theme .entries-card table,
    body.jgc-theme .entries-card tbody,
    body.jgc-theme .entries-card tbody tr,
    body.jgc-theme .entries-card tbody tr:nth-child(even),
    body.jgc-theme .entries-card tbody tr:nth-child(odd) {
      background: rgba(8, 18, 18, 0.92) !important;
      color: #f5f7f3 !important;
    }

    body.jgc-theme .entries-card tbody td,
    body.jgc-theme .entries-card tbody tr:nth-child(even) td,
    body.jgc-theme .entries-card tbody tr:nth-child(odd) td {
      background: rgba(255, 255, 255, 0.03) !important;
      color: #f5f7f3 !important;
    }

    body.jgc-theme .entries-card tbody tr:nth-child(even) td {
      background: rgba(255, 255, 255, 0.06) !important;
    }

    body.jgc-theme .entries-card .empty-cell {
      color: #bac4bd !important;
    }
  `;
  document.head.appendChild(style);
}

function activateJgcEnhancements() {
  activateGlobalTopNavigation();
  activateMobileBottomNavigation();
  activateJgcContactsFeature();
  activateJgcPoliciesFeature();
  activatePoliciesAnnouncementsTile();
  activateTimesheetTableContrastFeature();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", activateJgcEnhancements);
} else {
  activateJgcEnhancements();
}
