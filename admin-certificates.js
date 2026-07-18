function getCertificateStatus(expiryDate) {
    if (!expiryDate) {
        return "No Expiry";
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(expiryDate + "T00:00:00");
    const daysUntilExpiry = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

    if (daysUntilExpiry < 0) {
        return "Expired";
    }

    if (daysUntilExpiry <= 30) {
        return "Expiring Soon";
    }

    return "Valid";
}

function getCertificateDaysUntilExpiry(expiryDate) {
    if (!expiryDate) {
        return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(expiryDate + "T00:00:00");
    return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
}

function getCertificateExpiryAlerts() {
    return certificates
        .map((certificate) => ({
            ...certificate,
            daysUntilExpiry: getCertificateDaysUntilExpiry(certificate.expiry_date)
        }))
        .filter((certificate) => certificate.expiry_date && certificate.daysUntilExpiry !== null && certificate.daysUntilExpiry >= 0 && certificate.daysUntilExpiry <= 30)
        .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
}

function hasCertificateNotification(certificate) {
    return certificateNotifications.some((notification) =>
        notification.certificate_id === certificate.id &&
        notification.expiry_date === certificate.expiry_date &&
        notification.notification_type === "30_day"
    );
}

async function prepareCertificateUrls() {
    certificateUrls = {};

    for (const certificate of certificates) {
        const { data } = await supabaseClient
            .storage
            .from("certificates")
            .createSignedUrl(certificate.file_path, 3600);

        if (data && data.signedUrl) {
            certificateUrls[certificate.id] = data.signedUrl;
        }
    }
}

function renderCertificateExpiryAlerts() {
    const panel = document.getElementById("certificateExpiryAlerts");

    if (!panel) {
        return;
    }

    const alerts = getCertificateExpiryAlerts();

    if (!alerts.length) {
        panel.innerHTML = '<strong>Expiry Notifications:</strong> No certificates expiring in the next 30 days.';
        return;
    }

    panel.innerHTML = `
        <strong>Expiry Notifications:</strong> ${alerts.length} certificate${alerts.length === 1 ? "" : "s"} expiring within 30 days.
        <div class="table-wrap jgc-table-wrap" style="margin-top:8px;">
            <table class="jgc-table">
                <thead>
                    <tr><th>Worker</th><th>Certificate</th><th>Expiry</th><th>Days Left</th><th>Email Status</th></tr>
                </thead>
                <tbody>
                    ${alerts.map((certificate) => {
                        const sent = hasCertificateNotification(certificate);
                        return `
                            <tr>
                                <td>${escapeHtml(certificate.worker_name)}</td>
                                <td>${escapeHtml(certificate.certificate_name)}</td>
                                <td>${escapeHtml(certificate.expiry_date)}</td>
                                <td>${certificate.daysUntilExpiry}</td>
                                <td>${sent ? "Email sent" : "Email pending"}</td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        </div>
    `;
}

async function processCertificateExpiryNotifications() {
    renderCertificateExpiryAlerts();

    const alertsToSend = getCertificateExpiryAlerts().filter((certificate) => !hasCertificateNotification(certificate));

    for (const certificate of alertsToSend) {
        await sendCertificateExpiryEmail(certificate);
    }

    renderCertificateExpiryAlerts();
}

async function sendCertificateExpiryEmail(certificate) {
    const subject = "JGC Certificate Expiry Notice - " + certificate.worker_name + " - " + certificate.certificate_name;
    const body = [
        "JGC Certificate Expiry Notice",
        "",
        "Worker: " + certificate.worker_name,
        "Certificate: " + certificate.certificate_name,
        "Expiry Date: " + certificate.expiry_date,
        "Days Until Expiry: " + certificate.daysUntilExpiry,
        "",
        "Please review this certificate in the JGC Portal admin certificates tab."
    ].join("\n");

    try {
        await fetch(CERTIFICATE_EMAIL_SCRIPT_URL, {
            method: "POST",
            mode: "no-cors",
            headers: {
                "Content-Type": "text/plain;charset=utf-8"
            },
            body: JSON.stringify({
                subject,
                body,
                text: body,
                source: "certificate_expiry",
                certificateId: certificate.id,
                workerName: certificate.worker_name,
                certificateName: certificate.certificate_name,
                expiryDate: certificate.expiry_date
            })
        });

        const { data, error } = await supabaseClient
            .from("certificate_expiry_notifications")
            .insert({
                certificate_id: certificate.id,
                worker_name: certificate.worker_name,
                certificate_name: certificate.certificate_name,
                expiry_date: certificate.expiry_date,
                notification_type: "30_day",
                emailed_at: new Date().toISOString()
            })
            .select()
            .single();

        if (!error && data) {
            certificateNotifications.unshift(data);
        }

        if (typeof createJgcPortalNotifications === "function") {
            const workerAccount = accounts.find((account) => [
                account.worker_key,
                account.display_name,
                account.email
            ].map(normalizeWorkerName).includes(normalizeWorkerName(certificate.worker_name)));
            const recipients = [{ role: "supervisor" }, { role: "admin" }];

            if (workerAccount) {
                recipients.unshift({
                    profile_id: workerAccount.id,
                    worker_key: workerAccount.worker_key || workerAccount.display_name || "",
                    display_name: workerAccount.display_name || workerAccount.worker_key || "",
                    email: workerAccount.email || "",
                    role: workerAccount.role || "worker"
                });
            }

            await createJgcPortalNotifications(supabaseClient, "certificate_expiring", recipients, {
                title: "Certificate expiring",
                message: certificate.worker_name + " - " + certificate.certificate_name + " expires " + certificate.expiry_date + ".",
                link_url: "admin.html?tab=certificates",
                source_table: "certificates",
                source_id: certificate.id,
                dedupe_key_prefix: "certificate_expiring:" + certificate.id + ":" + certificate.expiry_date,
                metadata: {
                    worker_name: certificate.worker_name,
                    certificate_name: certificate.certificate_name,
                    expiry_date: certificate.expiry_date,
                    days_until_expiry: certificate.daysUntilExpiry
                }
            });
        }
    } catch (error) {
        console.warn("Certificate expiry email could not be sent.", error);
    }
}

function renderAdminCertificateTable(rows) {
    if (!rows.length) {
        return '<p class="jgc-archive__empty">No certificates in this section.</p>';
    }

    return `
        <div class="table-wrap jgc-table-wrap">
            <table class="jgc-table">
                <thead>
                    <tr><th>Certificate</th><th>Expiry</th><th>Status</th><th>File</th><th>Actions</th></tr>
                </thead>
                <tbody>
                    ${rows.map((certificate) => {
                        const status = getCertificateStatus(certificate.expiry_date);
                        const tone = status === "Expired" ? "jgc-badge--danger"
                            : status === "Expiring Soon" ? "jgc-badge--warning"
                                : "jgc-badge--success";
                        return `
                            <tr>
                                <td>${escapeHtml(certificate.certificate_name)}</td>
                                <td>${certificate.expiry_date ? escapeHtml(certificate.expiry_date) : "-"}</td>
                                <td><span class="jgc-badge ${tone}">${escapeHtml(status)}</span></td>
                                <td>${certificateUrls[certificate.id] ? '<a class="file-link" href="' + certificateUrls[certificate.id] + '" target="_blank" rel="noopener">Open</a>' : "Refresh needed"}</td>
                                <td><button type="button" class="delete-button jgc-button jgc-button--danger" onclick="deleteAdminCertificate('${escapeHtml(certificate.id)}')">Delete</button></td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function getCertificateEmployeeDisplayName(workerName) {
    const workerKey = normalizeWorkerName(workerName);
    const account = accounts.find((item) => [item.worker_key, item.display_name, item.email]
        .map(normalizeWorkerName)
        .includes(workerKey));

    return account && account.display_name ? account.display_name : workerName || "Unknown Employee";
}

function groupCertificatesByEmployee(rows) {
    const groupsByWorker = {};

    rows.forEach((certificate) => {
        const workerKey = normalizeWorkerName(certificate.worker_name) || "unknown employee";

        if (!groupsByWorker[workerKey]) {
            groupsByWorker[workerKey] = {
                key: workerKey,
                name: getCertificateEmployeeDisplayName(certificate.worker_name),
                certificates: []
            };
        }

        groupsByWorker[workerKey].certificates.push(certificate);
    });

    return Object.values(groupsByWorker).sort((a, b) => a.name.localeCompare(b.name));
}

let certificateLazyGroupRows = new Map();

function loadCertificateEmployeeGroup(details) {
    if (!details || !details.open) {
        return;
    }

    const body = details.querySelector("[data-certificate-lazy-body]");

    if (!body || body.dataset.loaded === "true") {
        return;
    }

    const rows = certificateLazyGroupRows.get(details.dataset.certificateWorker) || [];
    body.innerHTML = renderAdminCertificateTable(rows);
    body.dataset.loaded = "true";
}

function renderCertificateEmployeeGroups(rows, openGroups) {
    const groups = groupCertificatesByEmployee(rows);
    certificateLazyGroupRows = new Map(groups.map((group) => [group.key, group.certificates]));

    return `<div class="jgc-archive-list">${groups.map((group) => {
        const isOpen = openGroups.has(group.key);
        const countLabel = group.certificates.length + " certificate" + (group.certificates.length === 1 ? "" : "s");

        return `
            <details class="jgc-archive" data-certificate-worker="${escapeHtml(group.key)}"${isOpen ? " open" : ""} ontoggle="loadCertificateEmployeeGroup(this)">
                <summary>
                    <span class="jgc-archive__title">${escapeHtml(group.name)}</span>
                    <span class="jgc-archive__count">${escapeHtml(countLabel)}</span>
                </summary>
                <div class="jgc-archive__body" data-certificate-lazy-body data-loaded="${isOpen ? "true" : "false"}">${isOpen ? renderAdminCertificateTable(group.certificates) : ""}</div>
            </details>
        `;
    }).join("")}</div>`;
}

function renderCertificates() {
    const workerFilter = document.getElementById("certificateWorkerFilter").value.trim().toLowerCase();
    const statusFilter = document.getElementById("certificateStatusFilter").value;
    const list = document.getElementById("certificatesList");
    renderCertificateExpiryAlerts();
    renderCertificateTrainingMatrix();
    const filtered = certificates.filter((certificate) => {
        const worker = String(certificate.worker_name || "").toLowerCase();
        const status = getCertificateStatus(certificate.expiry_date);
        return (!workerFilter || worker.includes(workerFilter)) && (!statusFilter || status === statusFilter);
    });

    if (!filtered.length) {
        list.textContent = "No certificates found.";
        return;
    }

    const openGroups = new Set(Array.from(list.querySelectorAll("details[data-certificate-worker][open]"))
        .map((details) => details.dataset.certificateWorker));
    list.innerHTML = renderCertificateEmployeeGroups(filtered, openGroups);
}

function getMatrixStatusClass(status) {
    const normalized = String(status || "").toLowerCase();

    if (normalized === "valid") {
        return "valid";
    }

    if (normalized === "expiring soon") {
        return "expiring";
    }

    if (normalized === "no expiry") {
        return "no-expiry";
    }

    if (normalized === "missing") {
        return "missing";
    }

    return "expired";
}

function getCertificateSortTime(certificate) {
    if (certificate.expiry_date) {
        return new Date(certificate.expiry_date + "T00:00:00").getTime();
    }

    if (certificate.created_at) {
        return new Date(certificate.created_at).getTime();
    }

    return 0;
}

function isTrainingMatrixHiddenAccount(account) {
    const email = normalizeWorkerName(account && account.email);
    const names = [
        account && account.display_name,
        account && account.worker_key,
        account && account.email
    ].map(normalizeWorkerName).filter(Boolean);

    return email === "zethhummel@gmail.com" ||
        names.includes("test account") ||
        names.includes("john smith");
}

function getTrainingMatrixHiddenWorkerKeys() {
    const hiddenKeys = new Set(["test account", "john smith"]);

    accounts
        .filter(isTrainingMatrixHiddenAccount)
        .forEach((account) => {
            [
                account.worker_key,
                account.display_name,
                account.email
            ].map(normalizeWorkerName).filter(Boolean).forEach((value) => hiddenKeys.add(value));
        });

    return hiddenKeys;
}

function isHiddenTrainingMatrixWorker(workerName, hiddenKeys) {
    const workerKey = normalizeWorkerName(workerName);
    return Boolean(workerKey && hiddenKeys.has(workerKey));
}

function getTrainingMatrixCertificateKey(name) {
    return String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function getTrainingMatrixCertificateLabel(name) {
    return String(name || "").replace(/\s+/g, " ").trim();
}

function getTrainingMatrixCertificateColumns(certificateRows) {
    const byKey = {};

    certificateRows.forEach((certificate) => {
        const key = getTrainingMatrixCertificateKey(certificate.certificate_name);
        const label = getTrainingMatrixCertificateLabel(certificate.certificate_name);

        if (!key || !label) {
            return;
        }

        if (!byKey[key]) {
            byKey[key] = {
                key,
                label
            };
        }
    });

    return Object.values(byKey).sort((a, b) => a.label.localeCompare(b.label));
}

function renderCertificateTrainingMatrix() {
    const matrix = document.getElementById("certificateTrainingMatrix");

    if (!matrix) {
        return;
    }

    const workerNamesByKey = {};
    const hiddenWorkerKeys = getTrainingMatrixHiddenWorkerKeys();
    const visibleCertificates = certificates.filter((certificate) =>
        !isHiddenTrainingMatrixWorker(certificate.worker_name, hiddenWorkerKeys)
    );

    accounts
        .filter((account) => String(account.account_status || "").toLowerCase() !== "inactive")
        .filter((account) => !isTrainingMatrixHiddenAccount(account))
        .forEach((account) => {
            const workerKey = normalizeWorkerName(account.worker_key || account.display_name || account.email);

            if (workerKey) {
                workerNamesByKey[workerKey] = account.display_name || account.worker_key || account.email || workerKey;
            }
        });

    visibleCertificates.forEach((certificate) => {
        const workerKey = normalizeWorkerName(certificate.worker_name);

        if (workerKey && !workerNamesByKey[workerKey]) {
            workerNamesByKey[workerKey] = certificate.worker_name;
        }
    });

    const workers = Object.keys(workerNamesByKey).sort((a, b) => workerNamesByKey[a].localeCompare(workerNamesByKey[b]));
    const certificateColumns = getTrainingMatrixCertificateColumns(visibleCertificates);

    if (!workers.length || !certificateColumns.length) {
        matrix.textContent = "Upload certificates to build the training matrix.";
        return;
    }

    const certificatesByWorkerAndName = {};

    visibleCertificates.forEach((certificate) => {
        const workerKey = normalizeWorkerName(certificate.worker_name);
        const certificateKey = getTrainingMatrixCertificateKey(certificate.certificate_name);

        if (!workerKey || !certificateKey) {
            return;
        }

        const key = workerKey + "::" + certificateKey;
        const existing = certificatesByWorkerAndName[key];

        if (!existing || getCertificateSortTime(certificate) >= getCertificateSortTime(existing)) {
            certificatesByWorkerAndName[key] = certificate;
        }
    });

    matrix.innerHTML = `
        <div class="table-wrap">
            <table class="training-matrix-table">
                <thead>
                    <tr>
                        <th>Employee</th>
                        ${certificateColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}
                    </tr>
                </thead>
                <tbody>
                    ${workers.map((workerKey) => `
                        <tr>
                            <td>${escapeHtml(workerNamesByKey[workerKey])}</td>
                            ${certificateColumns.map((column) => {
                                const certificate = certificatesByWorkerAndName[workerKey + "::" + column.key];

                                if (!certificate) {
                                    return '<td class="matrix-cell"><span class="matrix-status missing">Missing</span></td>';
                                }

                                const status = getCertificateStatus(certificate.expiry_date);
                                const expiryText = certificate.expiry_date ? formatDate(certificate.expiry_date) : "No expiry date";

                                return `
                                    <td class="matrix-cell">
                                        <div>${escapeHtml(expiryText)}</div>
                                        <span class="matrix-status ${escapeHtml(getMatrixStatusClass(status))}">${escapeHtml(status)}</span>
                                    </td>
                                `;
                            }).join("")}
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function renderAdminCertificateWorkerOptions() {
    const select = document.getElementById("adminCertificateWorker");

    if (!select) {
        return;
    }

    const existingValue = select.value;
    const workersByKey = {};

    accounts
        .filter((account) => String(account.account_status || "").toLowerCase() !== "inactive")
        .forEach((account) => {
            const workerKey = normalizeWorkerName(account.worker_key || account.display_name || account.email);

            if (!workerKey) {
                return;
            }

            workersByKey[workerKey] = account.display_name || account.worker_key || account.email || workerKey;
        });

    certificates.forEach((certificate) => {
        const workerKey = normalizeWorkerName(certificate.worker_name);

        if (workerKey && !workersByKey[workerKey]) {
            workersByKey[workerKey] = certificate.worker_name;
        }
    });

    if (currentWorker && !workersByKey[currentWorker]) {
        workersByKey[currentWorker] = currentWorkerDisplay || currentWorker;
    }

    const workerOptions = Object.keys(workersByKey).sort((a, b) => workersByKey[a].localeCompare(workersByKey[b]));

    if (!workerOptions.length) {
        select.innerHTML = '<option value="">No employees found</option>';
        return;
    }

    select.innerHTML = '<option value="">Select Employee</option>' + workerOptions.map((workerKey) => {
        return '<option value="' + escapeHtml(workerKey) + '">' + escapeHtml(workersByKey[workerKey]) + '</option>';
    }).join("");

    if (existingValue && workersByKey[existingValue]) {
        select.value = existingValue;
    }
}

function setAdminCertificateStatus(message) {
    document.getElementById("adminCertificateStatus").textContent = message || "";
}

async function uploadAdminCertificate() {
    const workerName = document.getElementById("adminCertificateWorker").value;
    const certificateName = document.getElementById("adminCertificateName").value.trim();
    const expiryDate = document.getElementById("adminCertificateExpiry").value || null;
    const notes = document.getElementById("adminCertificateNotes").value.trim();
    const fileInput = document.getElementById("adminCertificateFile");
    const file = fileInput.files[0];

    if (!workerName || !certificateName || !file) {
        alert("Choose an employee, enter a certificate name, and choose a file.");
        return;
    }

    setAdminCertificateStatus("Uploading certificate...");

    const filePath = workerName + "/" + Date.now() + "-" + makeSafeFileName(file.name);
    const fileType = file.type || "application/octet-stream";

    const { error: uploadError } = await uploadJgcFile({
        client: supabaseClient,
        bucket: "certificates",
        path: filePath,
        file,
        input: fileInput,
        cacheControl: "3600",
        upsert: false,
        contentType: fileType,
        retry: uploadAdminCertificate
    });

    if (uploadError) {
        setAdminCertificateStatus("Certificate file upload failed: " + uploadError.message);
        return;
    }

    const { data, error } = await supabaseClient
        .from("certificates")
        .insert({
            worker_name: workerName,
            certificate_name: certificateName,
            expiry_date: expiryDate,
            notes,
            file_path: filePath,
            file_name: file.name,
            file_type: fileType
        })
        .select()
        .single();

    if (error) {
        await supabaseClient.storage.from("certificates").remove([filePath]);
        setAdminCertificateStatus("Certificate record could not be saved.");
        return;
    }

    certificates.push(data);
    document.getElementById("adminCertificateName").value = "";
    document.getElementById("adminCertificateExpiry").value = "";
    document.getElementById("adminCertificateNotes").value = "";
    fileInput.value = "";
    setAdminCertificateStatus("Certificate uploaded.");
    await prepareCertificateUrls();
    renderCertificates();
}

async function deleteAdminCertificate(certificateId) {
    const certificate = certificates.find((item) => item.id === certificateId);

    if (!certificate) {
        alert("Certificate could not be found.");
        return;
    }

    const confirmed = confirm(
        "Delete this certificate permanently?\n\n" +
        certificate.worker_name + " - " + certificate.certificate_name +
        "\n\nThis will remove the file and cannot be undone."
    );

    if (!confirmed) {
        return;
    }

    await supabaseClient.storage.from("certificates").remove([certificate.file_path]);

    const { error } = await supabaseClient
        .from("certificates")
        .delete()
        .eq("id", certificateId);

    if (error) {
        alert("Certificate could not be deleted.");
        return;
    }

    certificates = certificates.filter((item) => item.id !== certificateId);
    delete certificateUrls[certificateId];
    certificateNotifications = certificateNotifications.filter((notification) => notification.certificate_id !== certificateId);
    renderCertificates();
}
