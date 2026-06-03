const JGC_SUPABASE_URL = "https://xnrljkkszoimegfivlya.supabase.co";
const JGC_SUPABASE_KEY = "sb_publishable_k_m_R-jzMnsnHhNY_OHwJA_cbO1qO58";
const JGC_ADMIN_WORKERS = ["zeth hummel", "jeff vandrish"];

function applyJgcPortalName() {
  const pageTitles = {
    "accounts.html": "Accounts",
    "admin.html": "Admin",
    "aerial-lifts.html": "Aerial Lift Inspection",
    "certificates.html": "Certificates",
    "contacts.html": "Contacts",
    "daily-site-report.html": "Daily Site Report",
    "equipment-vehicles.html": "Equipment / Vehicles",
    "forklift.html": "Forklift Inspection",
    "harness.html": "Harness Inspection",
    "home.html": "Home",
    "hot-work-permit.html": "Hot Work Permit",
    "index.html": "Login",
    "inspections.html": "Inspections",
    "jsa.html": "JSA",
    "previous-inspections.html": "Previous Inspections",
    "reset-password.html": "Reset Password",
    "tele-handler.html": "Telehandler Inspection",
    "timesheet.html": "Timesheets",
    "toolbox-talks.html": "Tool Box Talks",
    "todays-inspections.html": "Today's Inspections",
    "vacation-request.html": "Vacation Request",
    "policies-announcements.html": "Policies/Announcements",
    "reports.html": "Reports"
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

function activateGlobalTopNavigation() {
  const page = window.location.pathname.split("/").pop() || "index.html";
  const excludedPages = ["index.html", "reset-password.html", "home.html"];

  if (excludedPages.includes(page) || document.getElementById("jgcGlobalTopNav")) {
    return;
  }

  const links = [
    { label: "Timesheets", href: "timesheet.html" },
    { label: "Inspections", href: "inspections.html" },
    { label: "Certificates", href: "certificates.html" },
    { label: "Vacation", href: "vacation-request.html" },
    { label: "Equipment", href: "equipment-vehicles.html" },
    { label: "Reports", href: "reports.html" },
    { label: "Policies", href: "policies-announcements.html" },
    { label: "Contacts", href: "contacts.html" }
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
    }

    .jgc-global-top-nav button,
    .jgc-global-top-nav a {
      width: auto !important;
      min-width: 0 !important;
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
      white-space: nowrap;
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
      align-items: center;
      justify-content: center;
      gap: 8px;
      max-width: 100%;
      overflow-x: auto;
      scrollbar-width: thin;
    }

    .jgc-old-nav-hidden {
      display: none !important;
    }

    @media (max-width: 780px) {
      body.jgc-has-global-nav {
        padding-top: 142px !important;
      }

      .jgc-global-top-nav {
        min-height: 124px;
        padding: 44px 8px 10px;
        align-items: flex-start;
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
        white-space: normal;
        overflow: hidden;
        word-break: normal;
      }

      .jgc-nav-center {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
        width: 100%;
        padding: 0;
        overflow: visible;
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
    window.location.href = "home.html";
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
    if (isAdminPage && (button.id === "contactsTab" || button.closest(".tabs"))) {
      return;
    }

    const label = button.textContent.replace(/\s+/g, " ").trim().toLowerCase();
    const currentAction = String(button.getAttribute("onclick") || "").toLowerCase();
    const isContactsLink = label === "contacts"
      || label.includes("contacts")
      || currentAction.includes("contacts")
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

  const styleId = "jgcPoliciesAnnouncementsStyles";

  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      #policiesAnnouncementsCard h2 {
        max-width: 100%;
        font-size: clamp(22px, 2.3vw, 28px);
        line-height: 1.05;
        overflow-wrap: anywhere;
      }

      #policiesAnnouncementsCard p {
        max-width: 100%;
      }

      @media (max-width: 620px) {
        #policiesAnnouncementsCard h2 {
          font-size: 17px;
          line-height: 1.08;
        }
      }
    `;
    document.head.appendChild(style);
  }

  const sideNav = document.querySelector(".side-nav");

  if (sideNav && !document.getElementById("policiesAnnouncementsSideLink")) {
    const sideLink = document.createElement("button");
    sideLink.id = "policiesAnnouncementsSideLink";
    sideLink.type = "button";
    sideLink.className = "side-link";
    sideLink.onclick = function() {
      window.location.href = "policies-announcements.html";
    };
    sideLink.innerHTML = '<i data-lucide="file-text"></i>Policies/Announcements';

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
    moreLink.innerHTML = '<i data-lucide="file-text"></i>Policies/Announcements';

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

  const grid = document.querySelector(".cards-grid");

  if (!grid) {
    return;
  }

  const card = document.createElement("button");
  card.id = "policiesAnnouncementsCard";
  card.type = "button";
  card.className = "feature-card";
  card.onclick = function() {
    window.location.href = "policies-announcements.html";
  };
  card.innerHTML = `
    <span class="card-icon"><i data-lucide="file-text"></i></span>
    <h2>Policies & Announcements</h2>
    <p>Review JGC policies and previous announcements</p>
    <i class="arrow" data-lucide="arrow-right"></i>
  `;

  const adminCard = document.getElementById("adminCard");

  if (adminCard && adminCard.parentElement === grid) {
    grid.insertBefore(card, adminCard);
  } else {
    grid.appendChild(card);
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function isValidTimesheetEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  return Boolean(String(entry.jobName || "").trim())
    && Boolean(String(entry.day || "").trim())
    && Boolean(String(entry.weekStartValue || entry.weekStart || "").trim())
    && Number(entry.hours || 0) > 0;
}

function activateTimesheetEntryCleanupFeature() {
  if (!/timesheet\.html$/i.test(window.location.pathname) || window.__jgcTimesheetEntryCleanupWrapped) {
    return;
  }

  const originalLoadTimesheets = typeof loadTimesheets === "function" ? loadTimesheets : null;
  const originalSetTimesheets = typeof setTimesheets === "function" ? setTimesheets : null;

  if (originalLoadTimesheets) {
    window.loadTimesheets = function() {
      return originalLoadTimesheets().filter(isValidTimesheetEntry);
    };
  }

  if (originalSetTimesheets) {
    window.setTimesheets = function(entries) {
      originalSetTimesheets(Array.isArray(entries) ? entries.filter(isValidTimesheetEntry) : []);
    };
  }

  window.__jgcTimesheetEntryCleanupWrapped = true;
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

function activateTimesheetDeleteFeature() {
  if (!/timesheet\.html$/i.test(window.location.pathname)) {
    return;
  }

  const style = document.createElement("style");
  style.textContent = `
    .delete-entry-button {
      width: auto;
      min-width: 72px;
      padding: 6px 10px;
      margin: 0 0 0 6px;
      font-size: 12px;
      background: #8b2e2e !important;
      color: #ffffff !important;
    }

    .delete-entry-button:hover {
      background: #692222 !important;
    }
  `;
  document.head.appendChild(style);

  window.deleteTimesheetEntry = async function(entryId) {
    if (typeof loadTimesheets !== "function") {
      alert("Entries are still loading. Please try again.");
      return;
    }

    const entry = loadTimesheets().find(function(item) {
      return item.id === entryId;
    });

    if (!entry) {
      alert("This entry could not be found.");
      return;
    }

    if (!confirm("Delete this entry for " + entry.day + " - " + entry.jobName + "?")) {
      return;
    }

    const status = document.getElementById("submitStatus");

    if (status) {
      status.innerText = "Deleting entry...";
    }

    const client = createJgcSupabaseClient();
    const worker = normalizeWorkerName(localStorage.getItem("currentWorker"));

    if (client) {
      const { error } = await client
        .from("timesheet_entries")
        .delete()
        .eq("id", entryId)
        .eq("worker_name", worker);

      if (error) {
        if (status) {
          status.innerText = "Could not delete this entry.";
        }
        return;
      }
    }

    if (typeof cancelEdit === "function") {
      cancelEdit();
    }

    if (typeof setTimesheets === "function") {
      setTimesheets(loadTimesheets().filter(function(item) {
        return item.id !== entryId;
      }));
    }

    if (status) {
      status.innerText = "Entry deleted.";
    }

    if (typeof render === "function") {
      render();
    }

    if (typeof updateJobSuggestions === "function") {
      updateJobSuggestions();
    }
  };

  function addDeleteButtons() {
    const editTable = document.querySelector(".edit-table");

    if (!editTable) {
      return;
    }

    const actionHeader = Array.from(editTable.querySelectorAll("th"))
      .find((header) => header.textContent.trim() === "Edit");

    if (actionHeader) {
      actionHeader.textContent = "Actions";
    }

    editTable.querySelectorAll(".edit-button").forEach((button) => {
      const cell = button.closest("td");
      const row = button.closest("tr");

      if (!cell || !row || cell.querySelector(".delete-entry-button")) {
        return;
      }

      const rowText = row.textContent.replace(/\s+/g, " ").trim();

      if (!rowText || rowText === "Edit" || rowText === "Actions") {
        return;
      }

      const match = String(button.getAttribute("onclick") || "").match(/editEntry\('([^']+)'\)/);
      const entryId = match ? match[1] : "";

      if (!entryId) {
        return;
      }

      cell.setAttribute("data-label", "Actions");
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-entry-button";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", function() {
        window.deleteTimesheetEntry(entryId);
      });
      cell.appendChild(deleteButton);
    });
  }

  const originalRender = typeof render === "function" ? render : null;

  if (originalRender && !window.__jgcTimesheetDeleteWrapped) {
    window.render = function() {
      originalRender();
      addDeleteButtons();
    };
    window.__jgcTimesheetDeleteWrapped = true;
  }

  addDeleteButtons();
}

function activateTimesheetCalendarFeature() {
  if (!/timesheet\.html$/i.test(window.location.pathname) || document.getElementById("timesheetCalendar")) {
    return;
  }

  const formCard = document.querySelector(".form-card");

  if (!formCard) {
    return;
  }

  const style = document.createElement("style");
  style.textContent = `
    .calendar-card {
      max-width: 720px;
      margin-left: auto;
      margin-right: auto;
    }

    .timesheet-calendar-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }

    .timesheet-calendar-header button {
      width: auto;
      min-width: 92px;
      margin: 0;
      background: #5f6a62 !important;
      color: #ffffff !important;
    }

    .timesheet-calendar-title {
      font-weight: bold;
      color: #39c848;
      text-align: center;
      font-size: 18px;
    }

    .timesheet-calendar-grid {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 4px;
    }

    .calendar-day-name {
      padding: 6px 4px;
      text-align: center;
      font-size: 12px;
      font-weight: bold;
      color: #f5f7f3;
    }

    .timesheet-day {
      min-height: 72px;
      border: 1px solid #c5cec1;
      border-radius: 6px;
      background: #ffffff !important;
      color: #1f2a24 !important;
      padding: 6px;
      text-align: left;
      cursor: pointer;
    }

    .timesheet-day:hover {
      border-color: #3f7d4d;
      box-shadow: inset 0 0 0 2px #d9ead5;
    }

    .timesheet-day.outside-month {
      opacity: 0.38;
    }

    .timesheet-day.current-week {
      background: #e8f4e4 !important;
      border-color: #3f7d4d;
    }

    .timesheet-day.selected-day {
      background: #3f7d4d !important;
      color: #ffffff !important;
      border-color: #2f6f3c;
    }

    .timesheet-day-number {
      font-weight: bold;
      font-size: 15px;
    }

    .timesheet-day-meta {
      margin-top: 8px;
      font-size: 11px;
      font-weight: bold;
    }

    @media (max-width: 720px) {
      .timesheet-calendar-header {
        display: grid;
        grid-template-columns: 1fr;
      }

      .timesheet-day {
        min-height: 58px;
        padding: 5px;
      }

      .timesheet-day-number {
        font-size: 13px;
      }

      .timesheet-day-meta {
        font-size: 10px;
      }
    }
  `;
  document.head.appendChild(style);

  const calendarCard = document.createElement("div");
  calendarCard.className = "card calendar-card";
  calendarCard.innerHTML = `
    <div class="timesheet-calendar-header">
      <button type="button" id="timesheetCalendarPrevious">Previous</button>
      <div id="timesheetCalendarTitle" class="timesheet-calendar-title"></div>
      <button type="button" id="timesheetCalendarNext">Next</button>
    </div>
    <div id="timesheetCalendar" class="timesheet-calendar-grid"></div>
    <div class="small">Pick a date to start an entry for that day. The selected week stays highlighted.</div>
  `;
  formCard.parentNode.insertBefore(calendarCard, formCard);

  let calendarMonth = new Date();
  let selectedCalendarDate = new Date();

  function getDayNames() {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  }

  function makeDateValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function makeDateFromValue(value) {
    const parts = String(value).split("-");
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function getWeekStartDate(date) {
    const weekStart = new Date(date);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(date.getDate() - date.getDay());
    return weekStart;
  }

  function getDateForEntry(entry) {
    if (!entry.weekStartValue || !entry.day) {
      return null;
    }

    const dayIndex = getDayNames().indexOf(entry.day);

    if (dayIndex < 0) {
      return null;
    }

    const date = makeDateFromValue(entry.weekStartValue);
    date.setDate(date.getDate() + dayIndex);
    return date;
  }

  function getHoursForDate(date) {
    if (typeof loadTimesheets !== "function") {
      return 0;
    }

    const targetValue = makeDateValue(date);

    return loadTimesheets().reduce(function(total, entry) {
      const entryDate = getDateForEntry(entry);

      if (!entryDate || makeDateValue(entryDate) !== targetValue) {
        return total;
      }

      return total + Number(entry.hours || 0);
    }, 0);
  }

  function getSelectedWeekStart() {
    const input = document.getElementById("weekStart");

    if (input && input.value) {
      return makeDateFromValue(input.value);
    }

    return getWeekStartDate(selectedCalendarDate);
  }

  function getDayHtml(date, visibleMonth, selectedWeekStart, selectedWeekEnd, selectedValue) {
    const dateValue = makeDateValue(date);
    const hours = getHoursForDate(date);
    const classes = ["timesheet-day"];

    if (date.getMonth() !== visibleMonth) {
      classes.push("outside-month");
    }

    if (selectedWeekStart.getTime() <= date.getTime() && date.getTime() <= selectedWeekEnd.getTime()) {
      classes.push("current-week");
    }

    if (dateValue === selectedValue) {
      classes.push("selected-day");
    }

    return `
      <button type="button" class="${classes.join(" ")}" data-timesheet-date="${dateValue}">
        <div class="timesheet-day-number">${date.getDate()}</div>
        <div class="timesheet-day-meta">${hours ? hours.toFixed(2) + " hrs" : ""}</div>
      </button>
    `;
  }

  function renderCalendar() {
    const calendar = document.getElementById("timesheetCalendar");
    const title = document.getElementById("timesheetCalendarTitle");

    if (!calendar || !title) {
      return;
    }

    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const selectedWeekStart = getSelectedWeekStart();
    const selectedWeekEnd = new Date(selectedWeekStart);
    selectedWeekEnd.setDate(selectedWeekStart.getDate() + 6);
    const selectedValue = makeDateValue(selectedCalendarDate);
    const cells = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
      .map((name) => '<div class="calendar-day-name">' + name + '</div>');

    title.innerText = firstDay.toLocaleDateString("en-CA", {
      month: "long",
      year: "numeric"
    });

    for (let i = 0; i < firstDay.getDay(); i++) {
      const date = new Date(year, month, 1 - firstDay.getDay() + i);
      cells.push(getDayHtml(date, month, selectedWeekStart, selectedWeekEnd, selectedValue));
    }

    for (let day = 1; day <= lastDay.getDate(); day++) {
      cells.push(getDayHtml(new Date(year, month, day), month, selectedWeekStart, selectedWeekEnd, selectedValue));
    }

    while ((cells.length - 7) % 7 !== 0) {
      const date = new Date(year, month, lastDay.getDate() + ((cells.length - 7) % 7) + 1);
      cells.push(getDayHtml(date, month, selectedWeekStart, selectedWeekEnd, selectedValue));
    }

    calendar.innerHTML = cells.join("");
    calendar.querySelectorAll("[data-timesheet-date]").forEach((button) => {
      button.addEventListener("click", function() {
        selectCalendarDate(button.dataset.timesheetDate);
      });
    });
  }

  function selectCalendarDate(dateValue) {
    const date = makeDateFromValue(dateValue);
    selectedCalendarDate = date;
    calendarMonth = new Date(date.getFullYear(), date.getMonth(), 1);

    const weekStartInput = document.getElementById("weekStart");
    weekStartInput.value = dateValue;

    if (typeof validateSunday === "function") {
      validateSunday(weekStartInput);
    }

    const daySelect = document.getElementById("day");

    if (daySelect) {
      daySelect.value = getDayNames()[date.getDay()];
    }

    renderCalendar();
    formCard.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  document.getElementById("timesheetCalendarPrevious").addEventListener("click", function() {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    renderCalendar();
  });

  document.getElementById("timesheetCalendarNext").addEventListener("click", function() {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    renderCalendar();
  });

  const originalRender = typeof render === "function" ? render : null;

  if (originalRender && !window.__jgcTimesheetCalendarWrapped) {
    window.render = function() {
      originalRender();
      renderCalendar();
    };
    window.__jgcTimesheetCalendarWrapped = true;
  }

  const weekStartInput = document.getElementById("weekStart");

  if (weekStartInput) {
    weekStartInput.addEventListener("change", function() {
      if (weekStartInput.value) {
        selectedCalendarDate = makeDateFromValue(weekStartInput.value);
        calendarMonth = new Date(selectedCalendarDate.getFullYear(), selectedCalendarDate.getMonth(), 1);
      }

      renderCalendar();
    });
  }

  renderCalendar();
}

function activateJgcEnhancements() {
  activateGlobalTopNavigation();
  activateJgcContactsFeature();
  activateJgcPoliciesFeature();
  activatePoliciesAnnouncementsTile();
  activateTimesheetTableContrastFeature();
  activateTimesheetEntryCleanupFeature();
  activateTimesheetCalendarFeature();
  activateTimesheetDeleteFeature();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", activateJgcEnhancements);
} else {
  activateJgcEnhancements();
}
