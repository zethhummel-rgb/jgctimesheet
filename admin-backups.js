const BACKUP_COMMAND = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\Users\\Zeth\\OneDrive - JOHN GORDON CONSTRUCTION INC\\Documents\\index.html\\backup-jgc-portal.ps1"';
const BACKUP_CREDENTIAL_COMMAND = BACKUP_COMMAND + ' -ConfigureCredential';

function initializeBackupsPage() {
    const commandBlock = document.getElementById("backupCommandText");

    if (commandBlock) {
        commandBlock.textContent = BACKUP_COMMAND;
    }

    const credentialCommandBlock = document.getElementById("backupCredentialCommandText");
    if (credentialCommandBlock) {
        credentialCommandBlock.textContent = BACKUP_CREDENTIAL_COMMAND;
    }

    renderBackupHistory();
}

function setBackupStatus(elementId, message, isError) {
    const element = document.getElementById(elementId);

    if (!element) {
        return;
    }

    element.textContent = message;
    element.style.color = isError ? "#b42318" : "";
}

async function copyBackupCommand() {
    try {
        await navigator.clipboard.writeText(BACKUP_COMMAND);
        setBackupStatus("backupCommandStatus", "Manual backup command copied.");
    } catch (err) {
        setBackupStatus("backupCommandStatus", "Could not copy automatically. Highlight the command above and copy it manually.", true);
    }
}

async function copyBackupCredentialCommand() {
    try {
        await navigator.clipboard.writeText(BACKUP_CREDENTIAL_COMMAND);
        setBackupStatus("backupCredentialStatus", "Credential setup command copied.");
    } catch (err) {
        setBackupStatus("backupCredentialStatus", "Could not copy automatically. Highlight the command above and copy it manually.", true);
    }
}

function normalizeZipName(name) {
    return String(name || "").replace(/\\/g, "/");
}

function findZipEntry(zip, wantedPath) {
    const normalizedWanted = normalizeZipName(wantedPath).toLowerCase();
    const entries = Object.values(zip.files || {});

    return entries.find((entry) => normalizeZipName(entry.name).toLowerCase() === normalizedWanted) || null;
}

async function readZipJson(zip, wantedPath) {
    const entry = findZipEntry(zip, wantedPath);

    if (!entry) {
        return null;
    }

    return JSON.parse(await entry.async("string"));
}

function getBackupHistory() {
    try {
        return JSON.parse(localStorage.getItem("jgcBackupHistory") || "[]");
    } catch (err) {
        return [];
    }
}

function saveBackupHistory(record) {
    const existing = getBackupHistory().filter((item) => item.fileName !== record.fileName);
    const next = [record].concat(existing).slice(0, 12);
    localStorage.setItem("jgcBackupHistory", JSON.stringify(next));
    renderBackupHistory();
}

function renderBackupHistory() {
    const target = document.getElementById("backupHistoryList");

    if (!target) {
        return;
    }

    const history = getBackupHistory();

    if (!history.length) {
        target.innerHTML = "<h4>Backup List</h4><div class=\"small\">No backups inspected yet. Upload a backup ZIP to add it to this list.</div>";
        return;
    }

    const historyRows = history.map((item) => ({ ...item, status: item.status || item.supabase || "Unknown" }));
    target.innerHTML = renderBackupSummaryTable("Backup List", historyRows, [
        { key: "fileName", label: "File" },
        { key: "createdAt", label: "Created" },
        { key: "websiteFiles", label: "Website Files" },
        { key: "tableFiles", label: "Tables" },
        { key: "storageFiles", label: "Storage Files" },
        { key: "status", label: "Status" }
    ]);
}

function renderBackupSummaryTable(title, rows, columns) {
    if (!rows || !rows.length) {
        return `<h4>${escapeHtml(title)}</h4><div class="small">No records found.</div>`;
    }

    return `
        <h4>${escapeHtml(title)}</h4>
        <div class="table-wrap jgc-table-wrap">
            <table class="jgc-table">
                <thead>
                    <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
                </thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            ${columns.map((column) => `<td>${escapeHtml(String(row[column.key] ?? ""))}</td>`).join("")}
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function formatBackupDateTime(value) {
    if (!value) {
        return "";
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString();
}

function renderBackupInspection(fileName, manifest, tableSummary, storageSummary, validation, restoreReadiness, counts) {
    const createdAt = manifest && manifest.createdAt ? formatBackupDateTime(manifest.createdAt) : "Not found";
    const overallStatus = manifest && manifest.overallStatus
        ? manifest.overallStatus
        : (manifest && manifest.supabaseExportConfigured ? "LEGACY / UNVERIFIED" : "FAILED");
    const validationStatus = validation && validation.status ? validation.status : "NOT FOUND";
    const failedItems = manifest && Array.isArray(manifest.failedItems) ? manifest.failedItems : [];
    const restoreStatus = restoreReadiness && restoreReadiness.status
        ? restoreReadiness.status
        : (manifest && manifest.restoreReadiness ? manifest.restoreReadiness : "NOT FOUND");

    return `
        <div class="backup-status-grid">
            <div class="backup-status-card">
                <strong>Backup File</strong>
                ${escapeHtml(fileName)}
            </div>
            <div class="backup-status-card">
                <strong>Created</strong>
                ${escapeHtml(createdAt)}
            </div>
            <div class="backup-status-card">
                <strong>Overall Status</strong>
                ${escapeHtml(overallStatus)}
            </div>
            <div class="backup-status-card">
                <strong>Website</strong>
                ${escapeHtml(manifest && manifest.websiteStatus ? manifest.websiteStatus : "UNVERIFIED")} - ${escapeHtml(String(counts.websiteFiles))} files
            </div>
            <div class="backup-status-card">
                <strong>Database</strong>
                ${escapeHtml(manifest && manifest.databaseStatus ? manifest.databaseStatus : "UNVERIFIED")} - ${escapeHtml(String(counts.tableFiles))} files - ${escapeHtml(String(manifest && manifest.totalDatabaseRowsExported !== undefined ? manifest.totalDatabaseRowsExported : "Unknown"))} rows
            </div>
            <div class="backup-status-card">
                <strong>Storage</strong>
                ${escapeHtml(manifest && manifest.storageStatus ? manifest.storageStatus : "UNVERIFIED")} - ${escapeHtml(String(counts.storageFiles))} files
            </div>
            <div class="backup-status-card">
                <strong>ZIP Validation</strong>
                ${escapeHtml(validationStatus)}
            </div>
            <div class="backup-status-card">
                <strong>Restore Readiness</strong>
                ${escapeHtml(restoreStatus)}
            </div>
        </div>
        ${renderBackupSummaryTable("Supabase Tables", tableSummary || [], [
            { key: "table", label: "Table" },
            { key: "rows", label: "Rows" },
            { key: "status", label: "Status" }
        ])}
        ${renderBackupSummaryTable("Storage Buckets", storageSummary || [], [
            { key: "bucket", label: "Bucket" },
            { key: "files", label: "Files" },
            { key: "bytes", label: "Bytes" },
            { key: "status", label: "Status" }
        ])}
        ${renderBackupSummaryTable("Failed Items", failedItems, [
            { key: "area", label: "Area" },
            { key: "item", label: "Item" },
            { key: "error", label: "Error" }
        ])}
        <div class="small" style="margin-top:12px;">Restore is intentionally review-only here. To restore live data, review this backup first and then run a controlled restore script so the website does not overwrite Supabase by accident.</div>
    `;
}

async function inspectBackupZip(file) {
    if (!window.JSZip) {
        throw new Error("ZIP reader did not load. Refresh the page and try again.");
    }

    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const files = Object.values(zip.files || {}).filter((entry) => !entry.dir);
    const normalizedNames = files.map((entry) => normalizeZipName(entry.name));
    const counts = {
        websiteFiles: normalizedNames.filter((name) => name.startsWith("website-files/")).length,
        tableFiles: normalizedNames.filter((name) => name.startsWith("supabase/tables/") && name.endsWith(".json")).length,
        storageFiles: normalizedNames.filter((name) => name.startsWith("supabase/storage/")).length
    };
    const manifest = await readZipJson(zip, "backup-manifest.json");
    const tableSummary = await readZipJson(zip, "supabase/table-export-summary.json");
    const storageSummary = await readZipJson(zip, "supabase/storage-export-summary.json");
    const validation = await readZipJson(zip, "post-backup-validation.json");
    const restoreReadiness = await readZipJson(zip, "restore-readiness.json");

    document.getElementById("backupInspectResult").innerHTML = renderBackupInspection(
        file.name,
        manifest,
        Array.isArray(tableSummary) ? tableSummary : [],
        Array.isArray(storageSummary) ? storageSummary : [],
        validation,
        restoreReadiness,
        counts
    );

    const overallStatus = manifest && manifest.overallStatus
        ? manifest.overallStatus
        : (manifest && manifest.supabaseExportConfigured ? "LEGACY / UNVERIFIED" : "FAILED");
    const inspectionStatus = validation && validation.status === "PASS" && overallStatus === "PASSED"
        ? "PASSED"
        : (overallStatus === "PASSED" ? "FAILED VALIDATION" : overallStatus);

    return {
        fileName: file.name,
        createdAt: manifest && manifest.createdAt ? formatBackupDateTime(manifest.createdAt) : "Not found",
        websiteFiles: counts.websiteFiles,
        tableFiles: counts.tableFiles,
        storageFiles: counts.storageFiles,
        status: inspectionStatus,
        supabase: inspectionStatus
    };
}

async function inspectBackupJson(file) {
    const data = JSON.parse(await file.text());
    const rows = Array.isArray(data) ? data : [data];

    document.getElementById("backupInspectResult").innerHTML = renderBackupSummaryTable("Uploaded JSON", rows.slice(0, 50), Object.keys(rows[0] || {}).slice(0, 8).map((key) => ({
        key,
        label: key
    })));

    return {
        fileName: file.name,
        createdAt: "JSON file",
        websiteFiles: "-",
        tableFiles: "-",
        storageFiles: "-",
        supabase: "Single JSON"
    };
}

async function inspectBackupFile() {
    const input = document.getElementById("backupZipFile");
    const file = input && input.files ? input.files[0] : null;

    if (!file) {
        setBackupStatus("backupInspectStatus", "No backup selected yet.");
        document.getElementById("backupInspectResult").innerHTML = "";
        return;
    }

    try {
        setBackupStatus("backupInspectStatus", "Inspecting backup...");
        document.getElementById("backupInspectResult").innerHTML = "";

        const record = file.name.toLowerCase().endsWith(".json")
            ? await inspectBackupJson(file)
            : await inspectBackupZip(file);

        saveBackupHistory(record);
        const failed = String(record.status || record.supabase || "").toUpperCase().includes("FAIL") || String(record.status || "").toUpperCase().includes("UNVERIFIED");
        setBackupStatus("backupInspectStatus", "Backup inspection result: " + (record.status || record.supabase || "Unknown"), failed);
    } catch (err) {
        setBackupStatus("backupInspectStatus", "Could not inspect backup: " + err.message, true);
    }
}
