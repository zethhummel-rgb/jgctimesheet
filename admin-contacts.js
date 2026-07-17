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
                                    <button type="button" class="secondary" onclick="editContact('${escapeHtml(contact.id)}')">Edit</button>
                                    <button type="button" class="delete-button" onclick="deleteContact('${escapeHtml(contact.id)}')">Delete</button>
                                </div>
                            </td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

async function loadContacts() {
    const { data, error } = await supabaseClient
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

    let result;

    if (editingContactId) {
        result = await supabaseClient
            .from("contacts")
            .update(values)
            .eq("id", editingContactId);
    } else {
        result = await supabaseClient
            .from("contacts")
            .insert({
                ...values,
                created_by: currentUserId || null,
                created_by_name: currentWorkerDisplay,
                is_active: true
            });
    }

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

    const { error } = await supabaseClient
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

function setSubcontractorSupplierStatus(message) {
    document.getElementById("supplierStatus").textContent = message || "";
}

function setSubcontractorSupplierContactStatus(message) {
    document.getElementById("supplierContactStatus").textContent = message || "";
}

function getSubcontractorSupplierById(id) {
    return subcontractorSuppliers.find((item) => String(item.id) === String(id));
}

function getSubcontractorSupplierContacts(companyId) {
    return subcontractorSupplierContacts
        .filter((contact) => String(contact.company_id) === String(companyId) && contact.is_active !== false)
        .slice()
        .sort((a, b) =>
            Number(a.sort_order || 0) - Number(b.sort_order || 0) ||
            String(a.contact_name || "").localeCompare(String(b.contact_name || ""))
        );
}

function normalizeSupplierCompanyText(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function formatSupplierPhoneNumber(value) {
    const raw = String(value || "").trim();
    const digits = raw.replace(/\D/g, "");

    if (digits.length === 10) {
        return "(" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6);
    }

    if (digits.length === 11 && digits.charAt(0) === "1") {
        return "+1 (" + digits.slice(1, 4) + ") " + digits.slice(4, 7) + "-" + digits.slice(7);
    }

    return raw;
}

function syncSupplierContactCompanyOptions() {
    const options = document.getElementById("supplierContactCompanyOptions");

    if (!options) {
        return;
    }

    options.innerHTML = subcontractorSuppliers.map((entry) =>
        `<option value="${escapeHtml(entry.company_name || "")}"></option>`
    ).join("");
}

function resolveSupplierCompanyFromInput() {
    const input = document.getElementById("supplierContactCompanySearch");
    const typed = normalizeSupplierCompanyText(input ? input.value : "");

    if (!typed) {
        return null;
    }

    return subcontractorSuppliers.find((entry) =>
        normalizeSupplierCompanyText(entry.company_name) === typed
    ) || null;
}

function selectSupplierCompanyFromSearch(options = {}) {
    const selected = resolveSupplierCompanyFromInput();

    if (!selected) {
        if (options.requireMatch) {
            alert("Choose a company from the Company box before adding the contact.");
        }
        return null;
    }

    selectedSubcontractorSupplierId = selected.id;
    updateSubcontractorSupplierContactSelection();
    renderSubcontractorSuppliers();
    return selected;
}

function clearSubcontractorSupplierContactForm(options = {}) {
    editingSubcontractorSupplierContactId = "";
    document.getElementById("supplierContactName").value = "";
    document.getElementById("supplierContactRole").value = "";
    document.getElementById("supplierContactPhone").value = "";
    document.getElementById("supplierContactEmail").value = "";
    document.getElementById("supplierContactOrder").value = "0";
    document.getElementById("supplierContactNotes").value = "";
    document.getElementById("supplierContactSaveButton").textContent = "Add Contact";

    if (!options.keepCompany) {
        selectedSubcontractorSupplierId = "";
        const companyInput = document.getElementById("supplierContactCompanySearch");
        if (companyInput) {
            companyInput.value = "";
        }
    }

    updateSubcontractorSupplierContactSelection();
    setSubcontractorSupplierContactStatus("");
}

function updateSubcontractorSupplierContactSelection() {
    const selected = getSubcontractorSupplierById(selectedSubcontractorSupplierId);
    const label = document.getElementById("supplierSelectedCompany");
    const companyInput = document.getElementById("supplierContactCompanySearch");

    if (!label) {
        return;
    }

    label.textContent = selected
        ? "Adding contacts for: " + selected.company_name
        : "Select a company below, or save a new company first.";

    if (companyInput && selected) {
        companyInput.value = selected.company_name || "";
    }
}

function selectSubcontractorSupplierForContact(id) {
    const selected = getSubcontractorSupplierById(id);

    if (!selected) {
        alert("Company could not be found.");
        return;
    }

    selectedSubcontractorSupplierId = selected.id;
    clearSubcontractorSupplierContactForm({ keepCompany: true });
    renderSubcontractorSuppliers();
    setSubcontractorSupplierContactStatus("Ready to add a contact for " + selected.company_name + ".");
}

function clearSubcontractorSupplierForm() {
    editingSubcontractorSupplierId = "";
    document.getElementById("supplierCompanyName").value = "";
    document.getElementById("supplierCategory").value = "Subcontractor";
    document.getElementById("supplierServiceType").value = "";
    document.getElementById("supplierOrder").value = "0";
    document.getElementById("supplierNotes").value = "";
    document.getElementById("supplierSaveButton").textContent = "Add Company";
    setSubcontractorSupplierStatus("");
}

function editSubcontractorSupplier(id) {
    const entry = subcontractorSuppliers.find((item) => item.id === id);

    if (!entry) {
        alert("Subcontractor or supplier could not be found.");
        return;
    }

    editingSubcontractorSupplierId = id;
    document.getElementById("supplierCompanyName").value = entry.company_name || "";
    document.getElementById("supplierCategory").value = entry.category || "Subcontractor";
    document.getElementById("supplierServiceType").value = entry.service_type || "";
    document.getElementById("supplierOrder").value = entry.sort_order || 0;
    document.getElementById("supplierNotes").value = entry.notes || "";
    document.getElementById("supplierSaveButton").textContent = "Update Company";
    selectedSubcontractorSupplierId = id;
    updateSubcontractorSupplierContactSelection();
    renderSubcontractorSuppliers();
    setSubcontractorSupplierStatus("Editing " + (entry.company_name || "company") + ".");
}

function renderSubcontractorSupplierContactList(entry) {
    const rows = getSubcontractorSupplierContacts(entry.id);

    if (!rows.length) {
        return '<div class="small">No contacts added yet.</div>';
    }

    return rows.map((contact) => {
        const contactName = String(contact.contact_name || "").trim();
        const phoneDisplay = formatSupplierPhoneNumber(contact.phone || "");
        return `
        <div class="detail-item supplier-contact-card" style="margin-bottom:8px;">
            <strong>${escapeHtml(contactName || "Unnamed contact")}</strong>
            ${contact.role ? '<div>' + escapeHtml(contact.role) + '</div>' : ""}
            ${phoneDisplay ? '<div><a href="tel:' + escapeHtml(phoneDisplay) + '">' + escapeHtml(phoneDisplay) + '</a></div>' : ""}
            ${contact.email ? '<div><a href="mailto:' + escapeHtml(contact.email) + '">' + escapeHtml(contact.email) + '</a></div>' : ""}
            ${contact.notes ? '<div class="small">' + escapeHtml(contact.notes) + '</div>' : ""}
            <div class="actions" style="margin-top:6px;">
                <button type="button" class="secondary" onclick="editSubcontractorSupplierContact('${escapeHtml(contact.id)}')">Edit Contact</button>
                <button type="button" class="delete-button" onclick="deleteSubcontractorSupplierContact('${escapeHtml(contact.id)}')">Delete Contact</button>
            </div>
        </div>
    `;
    }).join("");
}

function renderSubcontractorSupplierCompanyPanel(entry) {
    const contacts = getSubcontractorSupplierContacts(entry.id);
    const isOpen = String(entry.id) === String(selectedSubcontractorSupplierId) ||
        String(entry.id) === String(editingSubcontractorSupplierId) ||
        contacts.some((contact) => String(contact.id) === String(editingSubcontractorSupplierContactId));
    const companyMeta = [entry.category, entry.service_type].filter(Boolean).join(" - ") || "No category or trade entered";
    const contactCount = contacts.length + " contact" + (contacts.length === 1 ? "" : "s");

    return `
        <details class="supplier-company-panel" ${isOpen ? "open" : ""}>
            <summary class="supplier-company-summary">
                <span class="supplier-company-title">
                    <strong>${escapeHtml(entry.company_name || "Unnamed company")}</strong>
                    <span>${escapeHtml(companyMeta)}</span>
                </span>
                <span class="supplier-company-count">${escapeHtml(contactCount)}</span>
            </summary>
            <div class="supplier-company-body">
                <div class="supplier-company-meta-grid">
                    <div class="supplier-company-meta"><strong>Category</strong>${escapeHtml(entry.category || "-")}</div>
                    <div class="supplier-company-meta"><strong>Service / Trade</strong>${escapeHtml(entry.service_type || "-")}</div>
                    <div class="supplier-company-meta"><strong>Order</strong>${Number(entry.sort_order || 0)}</div>
                    <div class="supplier-company-meta"><strong>Notes</strong>${escapeHtml(entry.notes || "-")}</div>
                </div>
                <h3 style="margin:0 0 8px;color:#32dc55;">Contacts</h3>
                <div class="supplier-company-contacts">
                    ${contacts.length ? renderSubcontractorSupplierContactList(entry) : '<div class="small">No contacts added yet.</div>'}
                </div>
                <div class="actions">
                    <button type="button" class="secondary" onclick="editSubcontractorSupplier('${escapeHtml(entry.id)}')">Edit Company</button>
                    <button type="button" onclick="selectSubcontractorSupplierForContact('${escapeHtml(entry.id)}')">Add Contact</button>
                    <button type="button" class="delete-button" onclick="deleteSubcontractorSupplier('${escapeHtml(entry.id)}')">Delete Company</button>
                </div>
            </div>
        </details>
    `;
}

function renderSubcontractorSuppliers() {
    const list = document.getElementById("subcontractorsSuppliersAdminList");

    if (!list) {
        return;
    }

    if (!subcontractorSuppliers.length) {
        list.textContent = "No subcontractors or suppliers added yet.";
        return;
    }

    list.innerHTML = `
        <div class="small" style="margin-bottom:8px;">${subcontractorSuppliers.length} compan${subcontractorSuppliers.length === 1 ? "y" : "ies"} shown. Open a company to view contacts or edit it.</div>
        <div class="supplier-company-list">
            ${subcontractorSuppliers.map(renderSubcontractorSupplierCompanyPanel).join("")}
        </div>
    `;
}

async function loadSubcontractorSuppliers() {
    const companyResult = await supabaseClient
        .from("subcontractors_suppliers")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("company_name", { ascending: true });

    if (companyResult.error) {
        document.getElementById("subcontractorsSuppliersAdminList").textContent = "Subcontractors and suppliers could not be loaded.";
        return;
    }

    subcontractorSuppliers = companyResult.data || [];
    subcontractorSupplierContacts = [];

    const companyIds = subcontractorSuppliers.map((entry) => entry.id).filter(Boolean);

    if (companyIds.length) {
        const contactResult = await supabaseClient
            .from("subcontractor_supplier_contacts")
            .select("*")
            .in("company_id", companyIds)
            .eq("is_active", true)
            .order("sort_order", { ascending: true })
            .order("contact_name", { ascending: true });

        if (contactResult.error) {
            setSubcontractorSupplierContactStatus("Contacts could not be loaded. Run the updated setup SQL if this table is new.");
        } else {
            subcontractorSupplierContacts = contactResult.data || [];
        }
    }

    if (selectedSubcontractorSupplierId && !getSubcontractorSupplierById(selectedSubcontractorSupplierId)) {
        clearSubcontractorSupplierContactForm();
    } else {
        updateSubcontractorSupplierContactSelection();
    }

    syncSupplierContactCompanyOptions();
    renderSubcontractorSuppliers();
    renderPortalSummary();
}

async function saveSubcontractorSupplier() {
    const companyName = document.getElementById("supplierCompanyName").value.trim();
    const category = document.getElementById("supplierCategory").value.trim() || "Subcontractor";
    const serviceType = document.getElementById("supplierServiceType").value.trim();
    const notes = document.getElementById("supplierNotes").value.trim();
    const sortOrder = Number(document.getElementById("supplierOrder").value || 0);

    if (!companyName) {
        alert("Add a company name.");
        return;
    }

    setSubcontractorSupplierStatus(editingSubcontractorSupplierId ? "Updating company..." : "Adding company...");

    const values = {
        company_name: companyName,
        category,
        service_type: serviceType,
        notes,
        sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
        updated_at: new Date().toISOString()
    };

    let result;

    if (editingSubcontractorSupplierId) {
        result = await supabaseClient
            .from("subcontractors_suppliers")
            .update(values)
            .eq("id", editingSubcontractorSupplierId)
            .select()
            .single();
    } else {
        result = await supabaseClient
            .from("subcontractors_suppliers")
            .insert({
                ...values,
                created_by: currentUserId || null,
                created_by_name: currentWorkerDisplay,
                is_active: true
            })
            .select()
            .single();
    }

    if (result.error) {
        setSubcontractorSupplierStatus("Company could not be saved.");
        return;
    }

    const savedId = result.data && result.data.id ? result.data.id : editingSubcontractorSupplierId;
    clearSubcontractorSupplierForm();
    setSubcontractorSupplierStatus("Company saved.");
    await loadSubcontractorSuppliers();

    if (savedId) {
        selectSubcontractorSupplierForContact(savedId);
    }
}

async function deleteSubcontractorSupplier(id) {
    const entry = subcontractorSuppliers.find((item) => item.id === id);

    if (!entry) {
        alert("Subcontractor or supplier could not be found.");
        return;
    }

    if (!confirm("Delete " + (entry.company_name || "this entry") + "?")) {
        return;
    }

    const { error } = await supabaseClient
        .from("subcontractors_suppliers")
        .update({
            is_active: false,
            updated_at: new Date().toISOString()
        })
        .eq("id", id);

    if (error) {
        alert("Entry could not be deleted.");
        return;
    }

    if (editingSubcontractorSupplierId === id) {
        clearSubcontractorSupplierForm();
    }

    await loadSubcontractorSuppliers();
}

function editSubcontractorSupplierContact(id) {
    const contact = subcontractorSupplierContacts.find((item) => item.id === id);

    if (!contact) {
        alert("Contact could not be found.");
        return;
    }

    selectedSubcontractorSupplierId = contact.company_id;
    editingSubcontractorSupplierContactId = id;
    document.getElementById("supplierContactName").value = contact.contact_name || "";
    document.getElementById("supplierContactRole").value = contact.role || "";
    document.getElementById("supplierContactPhone").value = formatSupplierPhoneNumber(contact.phone || "");
    document.getElementById("supplierContactEmail").value = contact.email || "";
    document.getElementById("supplierContactOrder").value = contact.sort_order || 0;
    document.getElementById("supplierContactNotes").value = contact.notes || "";
    document.getElementById("supplierContactSaveButton").textContent = "Update Contact";
    updateSubcontractorSupplierContactSelection();
    renderSubcontractorSuppliers();
    setSubcontractorSupplierContactStatus("Editing " + (contact.contact_name || "contact") + ".");
}

async function saveSubcontractorSupplierContact() {
    let selected = getSubcontractorSupplierById(selectedSubcontractorSupplierId);
    const typedCompany = resolveSupplierCompanyFromInput();
    if (typedCompany) {
        selectedSubcontractorSupplierId = typedCompany.id;
        selected = typedCompany;
    }
    const contactName = document.getElementById("supplierContactName").value.trim();
    const role = document.getElementById("supplierContactRole").value.trim();
    const phone = formatSupplierPhoneNumber(document.getElementById("supplierContactPhone").value);
    const email = document.getElementById("supplierContactEmail").value.trim();
    const notes = document.getElementById("supplierContactNotes").value.trim();
    const sortOrder = Number(document.getElementById("supplierContactOrder").value || 0);

    if (!selected) {
        selectSupplierCompanyFromSearch({ requireMatch: true });
        return;
    }

    if (!contactName) {
        alert("Add a contact name.");
        return;
    }

    if (!phone && !email) {
        alert("Add at least a phone number or email address.");
        return;
    }

    setSubcontractorSupplierContactStatus(editingSubcontractorSupplierContactId ? "Updating contact..." : "Adding contact...");

    const values = {
        company_id: selected.id,
        contact_name: contactName,
        role,
        phone,
        email,
        notes,
        sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
        updated_at: new Date().toISOString()
    };

    const result = editingSubcontractorSupplierContactId
        ? await supabaseClient
            .from("subcontractor_supplier_contacts")
            .update(values)
            .eq("id", editingSubcontractorSupplierContactId)
        : await supabaseClient
            .from("subcontractor_supplier_contacts")
            .insert({
                ...values,
                created_by: currentUserId || null,
                created_by_name: currentWorkerDisplay,
                is_active: true
            });

    if (result.error) {
        setSubcontractorSupplierContactStatus("Contact could not be saved.");
        return;
    }

    const companyId = selected.id;
    clearSubcontractorSupplierContactForm({ keepCompany: true });
    await loadSubcontractorSuppliers();
    selectedSubcontractorSupplierId = companyId;
    updateSubcontractorSupplierContactSelection();
    renderSubcontractorSuppliers();
    setSubcontractorSupplierContactStatus("Contact saved.");
}

async function deleteSubcontractorSupplierContact(id) {
    const contact = subcontractorSupplierContacts.find((item) => item.id === id);

    if (!contact) {
        alert("Contact could not be found.");
        return;
    }

    if (!confirm("Delete " + (contact.contact_name || "this contact") + "?")) {
        return;
    }

    const { error } = await supabaseClient
        .from("subcontractor_supplier_contacts")
        .update({
            is_active: false,
            updated_at: new Date().toISOString()
        })
        .eq("id", id);

    if (error) {
        alert("Contact could not be deleted.");
        return;
    }

    const companyId = contact.company_id;
    clearSubcontractorSupplierContactForm({ keepCompany: true });
    await loadSubcontractorSuppliers();
    selectedSubcontractorSupplierId = companyId;
    updateSubcontractorSupplierContactSelection();
    renderSubcontractorSuppliers();
    setSubcontractorSupplierContactStatus("Contact deleted.");
}
