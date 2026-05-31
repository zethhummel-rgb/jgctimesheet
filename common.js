const JGC_SUPABASE_URL = "https://xnrljkkszoimegfivlya.supabase.co";
const JGC_SUPABASE_KEY = "sb_publishable_k_m_R-jzMnsnHhNY_OHwJA_cbO1qO58";
const JGC_ADMIN_WORKERS = ["zeth hummel", "jeff vandrish"];

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

function createJgcSupabaseClient() {
  return window.supabase
    ? window.supabase.createClient(JGC_SUPABASE_URL, JGC_SUPABASE_KEY)
    : null;
}

function normalizeWorkerName(name) {
  return String(name || "").trim().toLowerCase();
}

function getCurrentWorkerRecord() {
  const key = localStorage.getItem("currentWorker");

  return {
    key,
    display: localStorage.getItem("currentWorkerDisplay") || key,
    email: localStorage.getItem("currentUserEmail") || "",
    role: localStorage.getItem("currentUserRole") || "worker",
    status: localStorage.getItem("currentAccountStatus") || ""
  };
}

function isAdminWorker(workerKey, role) {
  return role === "admin" || JGC_ADMIN_WORKERS.includes(normalizeWorkerName(workerKey));
}

function clearJgcSession() {
  localStorage.removeItem("currentWorker");
  localStorage.removeItem("currentWorkerDisplay");
  localStorage.removeItem("currentUserEmail");
  localStorage.removeItem("currentUserRole");
  localStorage.removeItem("currentAccountStatus");
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

  if (!worker.key) {
    window.location.href = "index.html";
  }

  return worker;
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
