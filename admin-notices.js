function makeSafeFileName(name) {
    return String(name || "announcement.pdf")
        .trim()
        .replace(/[^a-z0-9.\-_]+/gi, "-")
        .replace(/-+/g, "-")
        .toLowerCase();
}

function setAnnouncementStatus(message) {
    document.getElementById("announcementStatus").textContent = message || "";
}

function getApprovedEmails() {
    return accounts
        .filter((account) => account.account_status === "approved" && account.email)
        .map((account) => account.email);
}

async function prepareAnnouncementUrls() {
    announcementUrls = {};

    for (const announcement of announcements) {
        if (!announcement.file_path) {
            continue;
        }

        const { data } = await supabaseClient
            .storage
            .from("announcements")
            .createSignedUrl(announcement.file_path, 604800);

        if (data && data.signedUrl) {
            announcementUrls[announcement.id] = data.signedUrl;
        }
    }
}

function getApprovedAccounts() {
    return accounts.filter((account) => account.account_status === "approved");
}

function getAnnouncementAcknowledgements(announcementId) {
    return announcementAcknowledgements.filter((receipt) => receipt.announcement_id === announcementId);
}

function getAnnouncementTargetAccounts(announcement) {
    const approvedAccounts = getApprovedAccounts();
    const targetName = normalizeWorkerName(announcement && announcement.target_worker_name);
    const targetEmail = normalizeWorkerName(announcement && announcement.target_worker_email);

    if (!targetName && !targetEmail) {
        return approvedAccounts;
    }

    const targetedAccounts = approvedAccounts.filter((account) => {
        const accountName = normalizeWorkerName(account.worker_key || account.display_name || account.full_name || "");
        const accountEmail = normalizeWorkerName(account.email || "");

        return (targetName && accountName === targetName) || (targetEmail && accountEmail === targetEmail);
    });

    if (targetedAccounts.length) {
        return targetedAccounts;
    }

    return [{
        id: "__target-" + (announcement.id || ""),
        display_name: announcement.target_worker_name || "",
        worker_key: announcement.target_worker_name || "",
        email: announcement.target_worker_email || ""
    }];
}

function getAnnouncementReceiptForAccount(account, receipts) {
    const accountName = normalizeWorkerName(account.worker_key || account.display_name || account.full_name || "");
    const accountEmail = normalizeWorkerName(account.email || "");

    return (receipts || []).find((receipt) => {
        const receiptName = normalizeWorkerName(receipt.worker_name || receipt.worker_display_name || "");
        const receiptEmail = normalizeWorkerName(receipt.worker_email || "");

        return (account.id && receipt.worker_id === account.id) ||
            (accountEmail && receiptEmail && accountEmail === receiptEmail) ||
            (accountName && receiptName && accountName === receiptName);
    }) || null;
}

function renderAnnouncementReadDetails(announcement) {
    const targetAccounts = getAnnouncementTargetAccounts(announcement);
    const receipts = getAnnouncementAcknowledgements(announcement.id);
    const matchedReceipts = targetAccounts
        .map((account) => getAnnouncementReceiptForAccount(account, receipts))
        .filter(Boolean);
    const uniqueReadCount = new Set(matchedReceipts.map((receipt) => receipt.id || receipt.worker_id || receipt.worker_email || receipt.worker_name)).size;

    if (!targetAccounts.length) {
        return "No approved accounts found.";
    }

    return `
        <details>
            <summary>${uniqueReadCount}/${targetAccounts.length} read</summary>
            <div class="table-wrap" style="margin-top:8px;">
                <table>
                    <thead>
                        <tr><th>Worker</th><th>Email</th><th>Status</th><th>Read At</th></tr>
                    </thead>
                    <tbody>
                        ${targetAccounts.map((account) => {
                            const receipt = getAnnouncementReceiptForAccount(account, receipts);
                            return `
                                <tr>
                                    <td>${escapeHtml(account.display_name || account.worker_key || receipt && receipt.worker_name || "")}</td>
                                    <td>${escapeHtml(account.email || receipt && receipt.worker_email || "")}</td>
                                    <td>${receipt ? "Read" : "Not read"}</td>
                                    <td>${receipt ? escapeHtml(formatDate(receipt.read_at)) : "-"}</td>
                                </tr>
                            `;
                        }).join("")}
                    </tbody>
                </table>
            </div>
        </details>
    `;
}

function renderAnnouncements() {
    const list = document.getElementById("announcementsList");

    if (!announcements.length) {
        list.textContent = "No active announcements yet.";
        return;
    }

    list.innerHTML = `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Title</th>
                        <th>Message</th>
                        <th>PDF</th>
                        <th>Read Status</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${announcements.map((announcement) => `
                        <tr>
                            <td>${escapeHtml(announcement.title)}</td>
                            <td>${escapeHtml(announcement.body || "")}</td>
                            <td>${announcementUrls[announcement.id] ? '<a class="file-link" href="' + announcementUrls[announcement.id] + '" target="_blank" rel="noopener">Open PDF</a>' : "-"}</td>
                            <td>${renderAnnouncementReadDetails(announcement)}</td>
                            <td>${escapeHtml(formatDate(announcement.created_at))}</td>
                            <td><button type="button" class="delete-button" onclick="deleteAnnouncement('${escapeHtml(announcement.id)}')">Delete</button></td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

async function loadAnnouncements() {
    const [announcementResult, acknowledgementResult] = await Promise.all([
        supabaseClient
            .from("announcements")
            .select("*")
            .eq("is_active", true)
            .order("created_at", { ascending: false }),
        supabaseClient
            .from("announcement_acknowledgements")
            .select("*")
            .order("read_at", { ascending: false })
    ]);

    if (announcementResult.error) {
        document.getElementById("announcementsList").textContent = "Announcements could not be loaded.";
        return;
    }

    announcements = announcementResult.data || [];
    announcementAcknowledgements = acknowledgementResult.data || [];
    await prepareAnnouncementUrls();
    renderAnnouncements();
}

async function publishAnnouncement() {
    const title = document.getElementById("announcementTitle").value.trim();
    const body = document.getElementById("announcementBody").value.trim();
    const expiresValue = document.getElementById("announcementExpires").value;
    const fileInput = document.getElementById("announcementFile");
    const file = fileInput.files[0];

    if (!title || (!body && !file)) {
        alert("Add a title and either a message or a PDF.");
        return;
    }

    if (file && file.type !== "application/pdf") {
        alert("Please upload a PDF file.");
        return;
    }

    setAnnouncementStatus("Publishing announcement...");

    let filePath = null;
    let fileName = null;
    let fileType = null;
    let signedUrl = "";

    if (file) {
        filePath = "announcements/" + Date.now() + "-" + makeSafeFileName(file.name);
        fileName = file.name;
        fileType = file.type || "application/pdf";

        const { error: uploadError } = await uploadJgcFile({
            client: supabaseClient,
            bucket: "announcements",
            path: filePath,
            file,
            input: fileInput,
            cacheControl: "3600",
            upsert: false,
            contentType: fileType,
            retry: publishAnnouncement
        });

        if (uploadError) {
            setAnnouncementStatus("PDF upload failed: " + uploadError.message);
            return;
        }

        const { data: signedData } = await supabaseClient
            .storage
            .from("announcements")
            .createSignedUrl(filePath, 604800);

        signedUrl = signedData && signedData.signedUrl ? signedData.signedUrl : "";
    }

    const record = {
        title,
        body,
        file_path: filePath,
        file_name: fileName,
        file_type: fileType,
        created_by: currentUserId || null,
        created_by_name: currentWorkerDisplay,
        expires_at: expiresValue ? expiresValue + "T23:59:59" : null,
        is_active: true
    };

    const { data, error } = await supabaseClient
        .from("announcements")
        .insert(record)
        .select()
        .single();

    if (error) {
        if (filePath) {
            await supabaseClient.storage.from("announcements").remove([filePath]);
        }
        setAnnouncementStatus("Announcement could not be saved.");
        return;
    }

    setAnnouncementStatus("Sending email notification...");

    try {
        await emailAnnouncement(data, signedUrl);
        setAnnouncementStatus("Announcement published and email notifications sent.");
    } catch (error) {
        setAnnouncementStatus("Announcement published, but email notification could not be sent.");
    }

    document.getElementById("announcementTitle").value = "";
    document.getElementById("announcementBody").value = "";
    document.getElementById("announcementExpires").value = "";
    fileInput.value = "";
    await loadAnnouncements();
}

async function emailAnnouncement(announcement, pdfUrl) {
    const recipients = getApprovedEmails();

    if (!recipients.length) {
        return;
    }

    const body = [
        "JGC Announcement",
        "",
        announcement.title,
        "",
        announcement.body || "",
        "",
        pdfUrl ? "PDF: " + pdfUrl : ""
    ].join("\n");

    await fetch(ANNOUNCEMENT_EMAIL_SCRIPT_URL, {
        method: "POST",
        mode: "no-cors",
        headers: {
            "Content-Type": "text/plain;charset=utf-8"
        },
        body: JSON.stringify({
            to: recipients.join(","),
            recipients,
            subject: "JGC Announcement - " + announcement.title,
            body,
            text: body,
            pdfUrl,
            pdfFileName: announcement.file_name || ""
        })
    });
}

async function deleteAnnouncement(id) {
    const announcement = announcements.find((item) => item.id === id);

    if (!announcement) {
        alert("Announcement could not be found.");
        return;
    }

    if (!confirm("Delete this announcement?")) {
        return;
    }

    const { error } = await supabaseClient
        .from("announcements")
        .update({ is_active: false })
        .eq("id", id);

    if (error) {
        alert("Announcement could not be deleted.");
        return;
    }

    await loadAnnouncements();
}

function setToolboxTalkStatus(message) {
    document.getElementById("toolboxTalkStatus").textContent = message || "";
}

async function prepareToolboxTalkUrls() {
    toolboxTalkUrls = {};

    for (const talk of toolboxTalks) {
        if (!talk.file_path) {
            continue;
        }

        const { data } = await supabaseClient
            .storage
            .from("toolbox-talks")
            .createSignedUrl(talk.file_path, 604800);

        if (data && data.signedUrl) {
            toolboxTalkUrls[talk.id] = data.signedUrl;
        }
    }
}

function renderToolboxTalks() {
    const list = document.getElementById("toolboxTalkList");

    if (!list) {
        return;
    }

    updateAdminReportSubtabCounts();
    renderToolboxTalkHistory();

    if (!toolboxTalks.length) {
        list.textContent = "No toolbox talks uploaded yet.";
        return;
    }

    list.innerHTML = `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Title</th>
                        <th>Description</th>
                        <th>PDF</th>
                        <th>Uploaded</th>
                        <th>Expires</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${toolboxTalks.map((talk) => `
                        <tr>
                            <td>${escapeHtml(talk.title)}</td>
                            <td>${escapeHtml(talk.description || "")}</td>
                            <td>${toolboxTalkUrls[talk.id] ? '<a class="file-link" href="' + toolboxTalkUrls[talk.id] + '" target="_blank" rel="noopener">Open PDF</a>' : "-"}</td>
                            <td>${escapeHtml(formatDate(talk.created_at))}</td>
                            <td>${escapeHtml(formatDate(talk.expires_at))}</td>
                            <td><button type="button" class="delete-button" onclick="deleteToolboxTalk('${escapeHtml(talk.id)}')">Delete</button></td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

async function loadToolboxTalks() {
    const [talkResult, reportResult, attendanceResult] = await Promise.all([
        supabaseClient
            .from("toolbox_talks")
            .select("*")
            .eq("is_active", true)
            .order("created_at", { ascending: false }),
        supabaseClient
            .from("toolbox_talk_reports")
            .select("*")
            .order("created_at", { ascending: false }),
        supabaseClient
            .from("toolbox_talk_attendance")
            .select("*")
            .order("created_at", { ascending: false })
    ]);

    const error = talkResult.error || reportResult.error || attendanceResult.error;

    if (error) {
        setToolboxTalkStatus("Toolbox talk data could not be loaded.");
        return;
    }

    toolboxTalks = talkResult.data || [];
    toolboxReports = reportResult.data || [];
    toolboxAttendance = attendanceResult.data || [];
    await prepareToolboxTalkUrls();
    renderToolboxTalks();
    setToolboxTalkStatus("");
}

async function publishToolboxTalk() {
    const title = document.getElementById("toolboxTalkTitle").value.trim();
    const description = document.getElementById("toolboxTalkDescription").value.trim();
    const fileInput = document.getElementById("toolboxTalkFile");
    const file = fileInput.files[0];

    if (!title || !file) {
        alert("Add a title and PDF for the toolbox talk.");
        return;
    }

    if (file.type && file.type !== "application/pdf") {
        alert("Please upload a PDF file.");
        return;
    }

    setToolboxTalkStatus("Uploading toolbox talk...");

    const filePath = "toolbox-talks/" + Date.now() + "-" + makeSafeFileName(file.name);
    const { error: uploadError } = await uploadJgcFile({
        client: supabaseClient,
        bucket: "toolbox-talks",
        path: filePath,
        file,
        input: fileInput,
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || "application/pdf",
        retry: publishToolboxTalk
    });

    if (uploadError) {
        setToolboxTalkStatus("Toolbox talk PDF upload failed: " + uploadError.message);
        return;
    }

    const { error: talkError } = await supabaseClient
        .from("toolbox_talks")
        .insert({
            title,
            description,
            file_path: filePath,
            file_name: file.name,
            created_by_name: currentWorkerDisplay,
            is_active: true
        })
        .select()
        .single();

    if (talkError) {
        await supabaseClient.storage.from("toolbox-talks").remove([filePath]);
        setToolboxTalkStatus("Toolbox talk could not be saved.");
        return;
    }

    document.getElementById("toolboxTalkTitle").value = "";
    document.getElementById("toolboxTalkDescription").value = "";
    fileInput.value = "";
    setToolboxTalkStatus("Toolbox talk PDF uploaded.");
    await loadToolboxTalks();
}

async function deleteToolboxTalk(id) {
    const talk = toolboxTalks.find((item) => item.id === id);

    if (!talk) {
        alert("Toolbox talk could not be found.");
        return;
    }

    if (!confirm("Delete this toolbox talk?")) {
        return;
    }

    const { error } = await supabaseClient
        .from("toolbox_talks")
        .update({ is_active: false })
        .eq("id", id);

    if (error) {
        alert("Toolbox talk could not be deleted.");
        return;
    }

    await loadToolboxTalks();
}

function setPolicyStatus(message) {
    document.getElementById("policyStatus").textContent = message || "";
}

async function preparePolicyUrls() {
    policyUrls = {};

    for (const policy of policies) {
        if (!policy.file_path) {
            continue;
        }

        const { data } = await supabaseClient
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
                            <td>${escapeHtml(formatDate(policy.created_at))}</td>
                            <td><button type="button" class="delete-button" onclick="deletePolicy('${escapeHtml(policy.id)}')">Delete</button></td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

async function loadPolicies() {
    const { data, error } = await supabaseClient
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

    const filePath = "policies/" + Date.now() + "-" + makeSafeFileName(file.name);
    const fileType = file.type || "application/pdf";

    const { error: uploadError } = await uploadJgcFile({
        client: supabaseClient,
        bucket: "policies",
        path: filePath,
        file,
        input: fileInput,
        cacheControl: "3600",
        upsert: false,
        contentType: fileType,
        retry: publishPolicy
    });

    if (uploadError) {
        setPolicyStatus("Policy PDF upload failed: " + uploadError.message);
        return;
    }

    setPolicyStatus("Saving policy...");

    const { error } = await supabaseClient
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
            created_by_name: currentWorkerDisplay
        });

    if (error) {
        await supabaseClient.storage.from("policies").remove([filePath]);
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

    const { error } = await supabaseClient
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
