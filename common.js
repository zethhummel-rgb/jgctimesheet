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

function activateContactsLinks() {
  document.querySelectorAll("button").forEach((button) => {
    if (button.textContent.trim() !== "Contacts") {
      return;
    }

    button.onclick = function() {
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", activateJgcContactsFeature);
} else {
  activateJgcContactsFeature();
}
