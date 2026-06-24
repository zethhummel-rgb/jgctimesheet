const SAFETY_ACK_TABLE = "safety_acknowledgements";
const SAFETY_ACK_COMPANY_JGC = "John Gordon Construction";

const SAFETY_ACK_STATUS_LABELS = {
    pending: "Pending",
    acknowledged_by_user: "Acknowledged",
    acknowledged_by_creator: "Acknowledged by creator",
    acknowledged_by_qr: "Acknowledged by QR",
    late_acknowledgement: "Late acknowledgement",
    not_required: "Not required",
    removed: "Removed"
};

const SAFETY_ACK_METHOD_LABELS = {
    user_portal: "User Portal",
    creator_on_behalf: "Creator On Behalf",
    qr_external: "QR External",
    late_user_portal: "Late User Portal",
    late_qr_external: "Late QR External"
};

function safetyAckEscapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function safetyAckNormalize(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9@._ -]+/g, "")
        .replace(/\s+/g, " ");
}

function safetyAckAttendeeKey(name, company) {
    const normalizedName = safetyAckNormalize(name).replace(/\s+/g, "-");
    const normalizedCompany = safetyAckNormalize(company).replace(/\s+/g, "-");
    return [normalizedName, normalizedCompany].filter(Boolean).join("|") || "attendee";
}

function safetyAckUuidOrNull(value) {
    const text = String(value || "").trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
        ? text
        : null;
}

function safetyAckCreateToken() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID().replace(/-/g, "") + Date.now().toString(36);
    }

    return "ack-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2);
}

function safetyAckFormatDateTime(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });
}

function safetyAckFormatDate(value) {
    if (!value) {
        return "";
    }

    const date = new Date(String(value).slice(0, 10) + "T00:00:00");

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString([], {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

function safetyAckSplitNames(value) {
    return String(value || "")
        .split(/\r?\n|,/)
        .map((name) => name.trim().replace(/\s+/g, " "))
        .filter(Boolean);
}

function safetyAckParseManualAttendees(value, defaultCompany) {
    return safetyAckSplitNames(value).map((line) => {
        const parts = line.split(/\s+-\s+|\s+\|\s+/);
        return {
            name: (parts[0] || line).trim(),
            company: (parts[1] || defaultCompany || "").trim()
        };
    }).filter((attendee) => attendee.name);
}

async function safetyAckLoadApprovedProfiles(client) {
    if (!client) {
        return [];
    }

    const { data, error } = await client
        .from("profiles")
        .select("id,email,display_name,worker_key,account_status")
        .eq("account_status", "approved")
        .order("display_name", { ascending: true });

    if (error) {
        console.warn("Approved employee list could not be loaded for acknowledgements.", error);
        return [];
    }

    return data || [];
}

function safetyAckProfileAliases(profile) {
    return [
        profile && profile.display_name,
        profile && profile.worker_key,
        profile && profile.email
    ].map(safetyAckNormalize).filter(Boolean);
}

function safetyAckFindEmployeeMatch(name, profiles) {
    const target = safetyAckNormalize(name);

    if (!target) {
        return null;
    }

    return (profiles || []).find((profile) => safetyAckProfileAliases(profile).includes(target)) || null;
}

function safetyAckBuildAttendeesFromNames(names, profiles, options) {
    const settings = options || {};
    const seen = new Set();

    return (names || []).map((rawName) => {
        const attendee = typeof rawName === "string"
            ? { name: rawName, company: settings.defaultCompany || "" }
            : rawName || {};
        const name = String(attendee.name || attendee.displayName || attendee.workerName || "").trim();
        const company = String(attendee.company || settings.defaultCompany || "").trim();

        if (!name) {
            return null;
        }

        const match = safetyAckFindEmployeeMatch(name, profiles);
        const resolvedCompany = match ? SAFETY_ACK_COMPANY_JGC : company;
        const attendeeKey = match
            ? safetyAckAttendeeKey(match.email || match.worker_key || match.display_name || name, SAFETY_ACK_COMPANY_JGC)
            : safetyAckAttendeeKey(name, resolvedCompany);

        if (seen.has(attendeeKey)) {
            return null;
        }

        seen.add(attendeeKey);

        return {
            attendee_name: match ? (match.display_name || match.worker_key || match.email || name) : name,
            attendee_key: attendeeKey,
            attendee_company: resolvedCompany,
            attendee_type: match ? "employee" : (attendee.type || "external"),
            matched_employee_id: match ? match.id : null,
            matched_employee_email: match ? (match.email || "") : "",
            acknowledgement_status: "pending",
            acknowledgement_method: null
        };
    }).filter(Boolean);
}

function safetyAckBuildRowsForRecord(config) {
    const record = config || {};
    const token = record.qrToken || safetyAckCreateToken();
    const creator = record.creator || {};

    return (record.attendees || []).map((attendee) => ({
        record_type: record.recordType,
        record_id: record.recordId,
        record_title: record.recordTitle || "",
        record_date: record.recordDate || null,
        job_id: safetyAckUuidOrNull(record.jobId),
        job_number: record.jobNumber || "",
        job_name: record.jobName || "",
        project: record.project || "",
        location: record.location || "",
        attendee_name: attendee.attendee_name,
        attendee_key: attendee.attendee_key || safetyAckAttendeeKey(attendee.attendee_name, attendee.attendee_company),
        attendee_company: attendee.attendee_company || "",
        attendee_type: attendee.attendee_type || "unknown",
        matched_employee_id: attendee.matched_employee_id || null,
        matched_employee_email: attendee.matched_employee_email || "",
        acknowledgement_status: attendee.acknowledgement_status || "pending",
        acknowledgement_method: attendee.acknowledgement_method || null,
        acknowledged_at: attendee.acknowledged_at || null,
        acknowledged_by_user_id: attendee.acknowledged_by_user_id || null,
        acknowledged_by_name: attendee.acknowledged_by_name || "",
        acknowledgement_note: attendee.acknowledgement_note || "",
        is_late: Boolean(attendee.is_late),
        unmatched_qr_entry: Boolean(attendee.unmatched_qr_entry),
        qr_token: token,
        created_by: safetyAckUuidOrNull(creator.id || creator.userId || creator.created_by || creator.key),
        created_by_name: creator.display || creator.name || creator.key || ""
    }));
}

async function safetyAckSaveRows(client, rows) {
    if (!client || !rows || !rows.length) {
        return { data: [], error: null };
    }

    return client
        .from(SAFETY_ACK_TABLE)
        .upsert(rows, { onConflict: "record_type,record_id,attendee_key" })
        .select("*");
}

async function safetyAckLoadForRecords(client, recordType, recordIds) {
    const ids = Array.isArray(recordIds) ? recordIds.filter(Boolean) : [recordIds].filter(Boolean);

    if (!client || !recordType || !ids.length) {
        return [];
    }

    const { data, error } = await client
        .from(SAFETY_ACK_TABLE)
        .select("*")
        .eq("record_type", recordType)
        .in("record_id", ids)
        .is("removed_at", null)
        .order("created_at", { ascending: true });

    if (error) {
        console.warn("Safety acknowledgements could not be loaded.", error);
        return [];
    }

    return data || [];
}

function safetyAckGetCurrentWorker() {
    if (typeof getCurrentWorkerRecord === "function") {
        return getCurrentWorkerRecord();
    }

    const key = localStorage.getItem("currentWorker") || "";
    return {
        key,
        display: localStorage.getItem("currentWorkerDisplay") || key,
        email: localStorage.getItem("currentUserEmail") || "",
        role: localStorage.getItem("currentUserRole") || "worker",
        company: localStorage.getItem("jgcSubcontractorCompany") || ""
    };
}

function safetyAckWorkerAliases(worker) {
    return [
        worker && worker.key,
        worker && worker.display,
        worker && worker.email
    ].map(safetyAckNormalize).filter(Boolean);
}

function safetyAckRowAliases(row) {
    return [
        row && row.attendee_key,
        row && row.attendee_name,
        row && row.matched_employee_email,
        row && row.acknowledged_by_name
    ].map(safetyAckNormalize).filter(Boolean);
}

function safetyAckRowMatchesWorker(row, worker) {
    const workerAliases = safetyAckWorkerAliases(worker);
    const rowAliases = safetyAckRowAliases(row);
    return rowAliases.some((alias) => workerAliases.includes(alias));
}

function safetyAckIsAcknowledged(row) {
    return Boolean(row && (row.acknowledged_at || String(row.acknowledgement_status || "").startsWith("acknowledged") || row.acknowledgement_status === "late_acknowledgement"));
}

function safetyAckIsSameDate(recordDate) {
    if (!recordDate) {
        return true;
    }

    return String(recordDate).slice(0, 10) === new Date().toISOString().slice(0, 10);
}

async function safetyAckSubmitCurrentWorker(client, config) {
    const settings = config || {};
    const worker = safetyAckGetCurrentWorker();

    if (!client || !settings.recordType || !settings.recordId || !worker.key) {
        return { ok: false, message: "Acknowledgement could not be saved." };
    }

    const existingRows = await safetyAckLoadForRecords(client, settings.recordType, settings.recordId);
    const existing = existingRows.find((row) => safetyAckRowMatchesWorker(row, worker));

    if (existing && safetyAckIsAcknowledged(existing)) {
        return { ok: true, message: "You are already acknowledged for this record.", row: existing };
    }

    const isLate = !existing || !safetyAckIsSameDate(settings.recordDate);
    const method = isLate ? "late_user_portal" : "user_portal";
    const status = isLate ? "late_acknowledgement" : "acknowledged_by_user";
    const acknowledgedAt = new Date().toISOString();

    if (existing) {
        const { data, error } = await client
            .from(SAFETY_ACK_TABLE)
            .update({
                acknowledgement_status: status,
                acknowledgement_method: method,
                acknowledged_at: acknowledgedAt,
                acknowledged_by_name: worker.display || worker.key,
                is_late: isLate,
                acknowledgement_note: settings.note || ""
            })
            .eq("id", existing.id)
            .select("*")
            .single();

        if (error) {
            return { ok: false, message: "Acknowledgement could not be saved.", error };
        }

        return { ok: true, message: "Acknowledgement saved.", row: data };
    }

    const attendeeType = worker.role === "subcontractor" ? "external" : "employee";
    const company = worker.company || (attendeeType === "employee" ? SAFETY_ACK_COMPANY_JGC : "");
    const attendeeName = worker.display || worker.key;
    const attendeeKey = safetyAckAttendeeKey(worker.email || worker.key || attendeeName, company);
    const rows = safetyAckBuildRowsForRecord({
        recordType: settings.recordType,
        recordId: settings.recordId,
        recordTitle: settings.recordTitle || "",
        recordDate: settings.recordDate || null,
        project: settings.project || "",
        location: settings.location || "",
        jobNumber: settings.jobNumber || "",
        jobName: settings.jobName || "",
        qrToken: settings.qrToken || safetyAckCreateToken(),
        creator: settings.creator || worker,
        attendees: [{
            attendee_name: attendeeName,
            attendee_key: attendeeKey,
            attendee_company: company,
            attendee_type: attendeeType,
            matched_employee_email: worker.email || "",
            acknowledgement_status: status,
            acknowledgement_method: method,
            acknowledged_at: acknowledgedAt,
            acknowledged_by_name: attendeeName,
            is_late: true
        }]
    });

    const { data, error } = await safetyAckSaveRows(client, rows);

    if (error) {
        return { ok: false, message: "Acknowledgement could not be saved.", error };
    }

    return { ok: true, message: "Acknowledgement saved.", row: data && data[0] };
}

async function safetyAckMarkOnBehalf(client, ackId, note, options) {
    const worker = safetyAckGetCurrentWorker();
    const settings = options || {};

    if (!client || !ackId) {
        return { ok: false, message: "Acknowledgement could not be saved." };
    }

    let query = client
        .from(SAFETY_ACK_TABLE)
        .update({
            acknowledgement_status: "acknowledged_by_creator",
            acknowledgement_method: "creator_on_behalf",
            acknowledged_at: new Date().toISOString(),
            acknowledged_by_name: worker.display || worker.key || "Creator",
            acknowledgement_note: note || "",
            is_late: false
        })
        .eq("id", ackId);

    if (settings.recordId) {
        query = query.eq("record_id", settings.recordId);
    }

    if (settings.recordType) {
        query = query.eq("record_type", settings.recordType);
    }

    const { data, error } = await query.select("*").single();

    if (error) {
        return { ok: false, message: "Acknowledgement could not be saved.", error };
    }

    return { ok: true, message: "Acknowledgement saved.", row: data };
}

function safetyAckStatusLabel(row) {
    const status = row && row.acknowledgement_status || "pending";
    return SAFETY_ACK_STATUS_LABELS[status] || status;
}

function safetyAckMethodLabel(row) {
    const method = row && row.acknowledgement_method || "";
    return SAFETY_ACK_METHOD_LABELS[method] || method || "-";
}

function safetyAckSummary(rows) {
    const activeRows = (rows || []).filter((row) => row && row.acknowledgement_status !== "removed" && !row.removed_at);
    const acknowledged = activeRows.filter(safetyAckIsAcknowledged).length;
    const late = activeRows.filter((row) => row.is_late || row.acknowledgement_status === "late_acknowledgement").length;
    const unmatched = activeRows.filter((row) => row.unmatched_qr_entry).length;

    return {
        total: activeRows.length,
        acknowledged,
        pending: Math.max(0, activeRows.length - acknowledged),
        late,
        unmatched
    };
}

function safetyAckBuildTableHtml(rows) {
    const activeRows = (rows || []).filter((row) => row && !row.removed_at);

    if (!activeRows.length) {
        return "";
    }

    return `
        <table>
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Method</th>
                    <th>Acknowledged At</th>
                    <th>Acknowledged By</th>
                    <th>Note</th>
                </tr>
            </thead>
            <tbody>
                ${activeRows.map((row) => `
                    <tr>
                        <td>${safetyAckEscapeHtml(row.attendee_name)}</td>
                        <td>${safetyAckEscapeHtml(row.attendee_company)}</td>
                        <td>${safetyAckEscapeHtml(row.attendee_type)}</td>
                        <td>${safetyAckEscapeHtml(safetyAckStatusLabel(row))}</td>
                        <td>${safetyAckEscapeHtml(safetyAckMethodLabel(row))}</td>
                        <td>${safetyAckEscapeHtml(safetyAckFormatDateTime(row.acknowledged_at))}</td>
                        <td>${safetyAckEscapeHtml(row.acknowledged_by_name || "")}</td>
                        <td>${safetyAckEscapeHtml(row.acknowledgement_note || "")}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

function safetyAckTextLines(rows) {
    return (rows || []).filter((row) => row && !row.removed_at).map((row) => [
        row.attendee_name || "",
        row.attendee_company || "",
        row.attendee_type || "",
        safetyAckStatusLabel(row),
        safetyAckMethodLabel(row),
        safetyAckFormatDateTime(row.acknowledged_at),
        row.acknowledged_by_name || "",
        row.acknowledgement_note || ""
    ].filter(Boolean).join(" | "));
}

function safetyAckQrUrl(recordType, recordId, token) {
    const url = new URL("acknowledge.html", window.location.href);
    url.searchParams.set("type", recordType);
    url.searchParams.set("id", recordId);
    url.searchParams.set("token", token || "");
    return url.toString();
}

function safetyAckGetRecordToken(rows, fallback) {
    const row = (rows || []).find((item) => item && item.qr_token);
    return row ? row.qr_token : (fallback || "");
}

function safetyAckRenderQr(container, url) {
    if (!container) {
        return;
    }

    container.innerHTML = `
        <div class="small" style="word-break:break-all;margin-bottom:8px;">${safetyAckEscapeHtml(url)}</div>
        <canvas width="220" height="220" aria-label="Acknowledgement QR code"></canvas>
    `;

    const canvas = container.querySelector("canvas");

    if (window.QRCode && typeof window.QRCode.toCanvas === "function" && canvas) {
        window.QRCode.toCanvas(canvas, url, { width: 220, margin: 2 }, (error) => {
            if (error) {
                container.innerHTML += '<div class="small">QR code could not be drawn. Use the link above.</div>';
            }
        });
    } else if (canvas) {
        canvas.remove();
        container.innerHTML += '<div class="small">QR code library did not load. Use the link above.</div>';
    }
}
