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
    creator_entry: "Creator Entry",
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

    const result = await client
        .from(SAFETY_ACK_TABLE)
        .upsert(rows, { onConflict: "record_type,record_id,attendee_key" })
        .select("*");

    if (!result.error) {
        await safetyAckNotifyPendingRows(client, result.data || rows);
    }

    return result;
}

async function safetyAckNotifyPendingRows(client, rows) {
    if (typeof createJgcPortalNotifications !== "function" || !client || !rows || !rows.length) {
        return;
    }

    const pendingRows = rows.filter((row) =>
        row &&
        String(row.acknowledgement_status || "pending").toLowerCase() === "pending" &&
        !row.acknowledged_at &&
        (row.matched_employee_id || row.matched_employee_email)
    );

    if (!pendingRows.length) {
        return;
    }

    const groups = pendingRows.reduce((map, row) => {
        const key = [row.record_type || "record", row.record_id || ""].join(":");
        if (!map[key]) {
            map[key] = [];
        }
        map[key].push(row);
        return map;
    }, {});

    for (const groupRows of Object.values(groups)) {
        const first = groupRows[0] || {};
        const recordType = String(first.record_type || "").toLowerCase();
        const label = recordType === "toolbox" || recordType === "toolbox_talk" ? "Toolbox Talk" : "JSA";
        const projectText = first.project || first.job_name || first.record_title || "";
        await createJgcPortalNotifications(client, "jsa_acknowledgement", groupRows.map((row) => ({
            id: row.matched_employee_id || null,
            profile_id: row.matched_employee_id || null,
            email: row.matched_employee_email || "",
            worker_key: row.attendee_key || "",
            display_name: row.attendee_name || "",
            role: "worker"
        })), {
            title: label + " acknowledgement required",
            message: [projectText, first.record_date ? String(first.record_date).slice(0, 10) : ""].filter(Boolean).join(" - "),
            link_url: "home.html",
            source_table: SAFETY_ACK_TABLE,
            source_id: [first.record_type || "record", first.record_id || ""].join(":"),
            created_by: first.created_by || null,
            created_by_name: first.created_by_name || "",
            metadata: {
                record_type: first.record_type || "",
                record_id: first.record_id || "",
                record_title: first.record_title || "",
                record_date: first.record_date || "",
                project: first.project || "",
                location: first.location || ""
            }
        });
    }
}

async function safetyAckClearPortalNotifications(client, row, fallback) {
    const source = row || {};
    const settings = fallback || {};
    const recordType = source.record_type || settings.recordType || settings.record_type || "";
    const recordId = source.record_id || settings.recordId || settings.record_id || "";
    const localId = source.id || settings.id || "";
    const sourceId = [recordType || "record", recordId || ""].join(":");

    if (typeof clearJgcNotifications === "function" && localId) {
        await clearJgcNotifications(["safety-ack:" + localId]);
    }

    if (!client || !recordId) {
        return;
    }

    try {
        const now = new Date().toISOString();
        await client
            .from("notifications")
            .update({
                cleared_at: now,
                clicked_at: now,
                updated_at: now
            })
            .eq("notification_type", "jsa_acknowledgement")
            .eq("source_table", SAFETY_ACK_TABLE)
            .eq("source_id", sourceId)
            .is("cleared_at", null);
    } catch (error) {
        console.warn("Safety acknowledgement notification could not be cleared.", error);
    }
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

        await safetyAckClearPortalNotifications(client, data, settings);

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

    await safetyAckClearPortalNotifications(client, data && data[0], settings);

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

function safetyAckQrTextBytes(text) {
    const Encoder = typeof TextEncoder !== "undefined"
        ? TextEncoder
        : (typeof window !== "undefined" ? window.TextEncoder : null);

    if (Encoder) {
        return Array.from(new Encoder().encode(String(text || "")));
    }

    return unescape(encodeURIComponent(String(text || ""))).split("").map((char) => char.charCodeAt(0));
}

function safetyAckQrAppendBits(bits, value, length) {
    for (let i = length - 1; i >= 0; i -= 1) {
        bits.push((value >>> i) & 1);
    }
}

function safetyAckQrBuildDataCodewords(text) {
    const bytes = safetyAckQrTextBytes(text);
    const dataCodewordCount = 274; // Version 10, error correction L.
    const capacityBits = dataCodewordCount * 8;
    const bits = [];

    if (bytes.length > 271) {
        return null;
    }

    safetyAckQrAppendBits(bits, 0x4, 4); // Byte mode.
    safetyAckQrAppendBits(bits, bytes.length, 16);
    bytes.forEach((byte) => safetyAckQrAppendBits(bits, byte, 8));
    safetyAckQrAppendBits(bits, 0, Math.min(4, capacityBits - bits.length));

    while (bits.length % 8) {
        bits.push(0);
    }

    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
        let value = 0;
        for (let j = 0; j < 8; j += 1) {
            value = (value << 1) | bits[i + j];
        }
        data.push(value);
    }

    for (let pad = 0; data.length < dataCodewordCount; pad += 1) {
        data.push(pad % 2 ? 0x11 : 0xEC);
    }

    return data.length <= dataCodewordCount ? data : null;
}

function safetyAckQrMultiply(left, right) {
    let result = 0;

    for (let i = 7; i >= 0; i -= 1) {
        result = ((result << 1) ^ (((result >>> 7) & 1) ? 0x11D : 0)) & 0xFF;
        if (((right >>> i) & 1) !== 0) {
            result ^= left;
        }
    }

    return result;
}

function safetyAckQrReedSolomonDivisor(degree) {
    const result = new Array(degree).fill(0);
    let root = 1;
    result[degree - 1] = 1;

    for (let i = 0; i < degree; i += 1) {
        for (let j = 0; j < degree; j += 1) {
            result[j] = safetyAckQrMultiply(result[j], root);
            if (j + 1 < degree) {
                result[j] ^= result[j + 1];
            }
        }
        root = safetyAckQrMultiply(root, 0x02);
    }

    return result;
}

function safetyAckQrReedSolomonRemainder(data, divisor) {
    const result = new Array(divisor.length).fill(0);

    data.forEach((byte) => {
        const factor = byte ^ result.shift();
        result.push(0);
        divisor.forEach((coefficient, index) => {
            result[index] ^= safetyAckQrMultiply(coefficient, factor);
        });
    });

    return result;
}

function safetyAckQrAddErrorCorrection(data) {
    const totalCodewords = 346; // Version 10.
    const errorCodewordsPerBlock = 18;
    const blockCount = 4;
    const shortBlockCount = blockCount - (totalCodewords % blockCount);
    const shortBlockLength = Math.floor(totalCodewords / blockCount);
    const shortDataLength = shortBlockLength - errorCodewordsPerBlock;
    const divisor = safetyAckQrReedSolomonDivisor(errorCodewordsPerBlock);
    const blocks = [];
    let offset = 0;

    for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
        const dataLength = shortDataLength + (blockIndex < shortBlockCount ? 0 : 1);
        const blockData = data.slice(offset, offset + dataLength);
        const ecc = safetyAckQrReedSolomonRemainder(blockData, divisor);
        offset += dataLength;
        blocks.push(blockData.concat(blockIndex < shortBlockCount ? [0] : [], ecc));
    }

    const result = [];
    for (let i = 0; i < shortBlockLength + 1; i += 1) {
        blocks.forEach((block, blockIndex) => {
            if (i === shortDataLength && blockIndex < shortBlockCount) {
                return;
            }

            if (i < block.length) {
                result.push(block[i]);
            }
        });
    }

    return result;
}

function safetyAckQrGetBit(value, index) {
    return ((value >>> index) & 1) !== 0;
}

function safetyAckQrFormatBits(mask) {
    const errorCorrectionLevelLow = 1;
    let data = (errorCorrectionLevelLow << 3) | mask;
    let remainder = data;

    for (let i = 0; i < 10; i += 1) {
        remainder = (remainder << 1) ^ (((remainder >>> 9) & 1) ? 0x537 : 0);
    }

    return ((data << 10) | remainder) ^ 0x5412;
}

function safetyAckQrVersionBits(version) {
    let remainder = version;

    for (let i = 0; i < 12; i += 1) {
        remainder = (remainder << 1) ^ (((remainder >>> 11) & 1) ? 0x1F25 : 0);
    }

    return (version << 12) | remainder;
}

function safetyAckQrCreateMatrix(text) {
    const dataCodewords = safetyAckQrBuildDataCodewords(text);
    const version = 10;
    const size = 21 + (version - 1) * 4;
    const mask = 0;

    if (!dataCodewords) {
        return null;
    }

    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const functionModules = Array.from({ length: size }, () => new Array(size).fill(false));

    function setFunctionModule(x, y, isBlack) {
        if (x < 0 || y < 0 || x >= size || y >= size) {
            return;
        }

        modules[y][x] = Boolean(isBlack);
        functionModules[y][x] = true;
    }

    function drawFinderPattern(centerX, centerY) {
        for (let dy = -4; dy <= 4; dy += 1) {
            for (let dx = -4; dx <= 4; dx += 1) {
                const distance = Math.max(Math.abs(dx), Math.abs(dy));
                setFunctionModule(centerX + dx, centerY + dy, distance !== 2 && distance !== 4);
            }
        }
    }

    function drawAlignmentPattern(centerX, centerY) {
        for (let dy = -2; dy <= 2; dy += 1) {
            for (let dx = -2; dx <= 2; dx += 1) {
                setFunctionModule(centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
            }
        }
    }

    function drawFormatBits() {
        const bits = safetyAckQrFormatBits(mask);

        for (let i = 0; i <= 5; i += 1) {
            setFunctionModule(8, i, safetyAckQrGetBit(bits, i));
        }
        setFunctionModule(8, 7, safetyAckQrGetBit(bits, 6));
        setFunctionModule(8, 8, safetyAckQrGetBit(bits, 7));
        setFunctionModule(7, 8, safetyAckQrGetBit(bits, 8));

        for (let i = 9; i < 15; i += 1) {
            setFunctionModule(14 - i, 8, safetyAckQrGetBit(bits, i));
        }

        for (let i = 0; i < 8; i += 1) {
            setFunctionModule(size - 1 - i, 8, safetyAckQrGetBit(bits, i));
        }

        for (let i = 8; i < 15; i += 1) {
            setFunctionModule(8, size - 15 + i, safetyAckQrGetBit(bits, i));
        }

        setFunctionModule(8, size - 8, true);
    }

    function drawVersionBits() {
        const bits = safetyAckQrVersionBits(version);

        for (let i = 0; i < 18; i += 1) {
            const bit = safetyAckQrGetBit(bits, i);
            const a = size - 11 + (i % 3);
            const b = Math.floor(i / 3);
            setFunctionModule(a, b, bit);
            setFunctionModule(b, a, bit);
        }
    }

    for (let i = 0; i < size; i += 1) {
        setFunctionModule(6, i, i % 2 === 0);
        setFunctionModule(i, 6, i % 2 === 0);
    }

    drawFinderPattern(3, 3);
    drawFinderPattern(size - 4, 3);
    drawFinderPattern(3, size - 4);

    [6, 28, 50].forEach((y, yIndex) => {
        [6, 28, 50].forEach((x, xIndex) => {
            const overlapsFinder = (
                (xIndex === 0 && yIndex === 0) ||
                (xIndex === 2 && yIndex === 0) ||
                (xIndex === 0 && yIndex === 2)
            );

            if (!overlapsFinder) {
                drawAlignmentPattern(x, y);
            }
        });
    });

    drawFormatBits();
    drawVersionBits();

    const allCodewords = safetyAckQrAddErrorCorrection(dataCodewords);
    let bitIndex = 0;

    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) {
            right = 5;
        }

        for (let vertical = 0; vertical < size; vertical += 1) {
            for (let j = 0; j < 2; j += 1) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - vertical : vertical;

                if (functionModules[y][x]) {
                    continue;
                }

                const byte = allCodewords[bitIndex >>> 3] || 0;
                modules[y][x] = safetyAckQrGetBit(byte, 7 - (bitIndex & 7));
                bitIndex += 1;
            }
        }
    }

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            if (!functionModules[y][x] && (x + y) % 2 === 0) {
                modules[y][x] = !modules[y][x];
            }
        }
    }

    drawFormatBits();

    return { size, modules };
}

function safetyAckDrawLocalQr(canvas, text) {
    const qr = safetyAckQrCreateMatrix(text);

    if (!canvas || !qr || !canvas.getContext) {
        return false;
    }

    const quietZone = 4;
    const scale = 4;
    const dimension = (qr.size + quietZone * 2) * scale;
    const context = canvas.getContext("2d");

    canvas.width = dimension;
    canvas.height = dimension;
    canvas.style.width = dimension + "px";
    canvas.style.height = dimension + "px";

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, dimension, dimension);
    context.fillStyle = "#000000";

    for (let y = 0; y < qr.size; y += 1) {
        for (let x = 0; x < qr.size; x += 1) {
            if (qr.modules[y][x]) {
                context.fillRect((x + quietZone) * scale, (y + quietZone) * scale, scale, scale);
            }
        }
    }

    return true;
}

function safetyAckRenderQr(container, url) {
    if (!container) {
        return;
    }

    container.innerHTML = `
        <div class="small" style="word-break:break-all;margin-bottom:8px;">${safetyAckEscapeHtml(url)}</div>
        <canvas aria-label="Acknowledgement QR code"></canvas>
    `;

    const canvas = container.querySelector("canvas");

    if (window.QRCode && typeof window.QRCode.toCanvas === "function" && canvas) {
        window.QRCode.toCanvas(canvas, url, { width: 220, margin: 2 }, (error) => {
            if (error) {
                if (!safetyAckDrawLocalQr(canvas, url)) {
                    container.innerHTML += '<div class="small">QR code could not be drawn. Use the link above.</div>';
                }
            }
        });
    } else if (canvas && safetyAckDrawLocalQr(canvas, url)) {
        return;
    } else if (canvas) {
        canvas.remove();
        container.innerHTML += '<div class="small">QR code library did not load. Use the link above.</div>';
    }
}
