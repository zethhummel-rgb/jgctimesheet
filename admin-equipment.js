function getEquipmentStatus(expiryDate) {
    if (!expiryDate) {
        return "No Expiry";
    }

    const daysUntilExpiry = getEquipmentDaysUntilExpiry(expiryDate);

    if (daysUntilExpiry < 0) {
        return "Expired";
    }

    if (daysUntilExpiry <= 30) {
        return "Expiring Soon";
    }

    return "Valid";
}

function getEquipmentDaysUntilExpiry(expiryDate) {
    if (!expiryDate) {
        return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const expiry = new Date(expiryDate + "T00:00:00");
    return Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
}

function getEquipmentExpiryAlerts() {
    return equipmentItems
        .map((item) => ({
            ...item,
            daysUntilExpiry: getEquipmentDaysUntilExpiry(item.yearly_inspection_expiry)
        }))
        .filter((item) => item.yearly_inspection_expiry && item.daysUntilExpiry !== null && item.daysUntilExpiry >= 0 && item.daysUntilExpiry <= 30)
        .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
}

function hasEquipmentNotification(item) {
    return equipmentNotifications.some((notification) =>
        notification.equipment_id === item.id &&
        notification.expiry_date === item.yearly_inspection_expiry &&
        notification.notification_type === "30_day"
    );
}

function renderEquipmentExpiryAlerts() {
    const panel = document.getElementById("equipmentExpiryAlerts");

    if (!panel) {
        return;
    }

    const alerts = getEquipmentExpiryAlerts();

    if (!alerts.length) {
        panel.innerHTML = "<strong>Expiry Notifications:</strong> No equipment or vehicles expiring in the next 30 days.";
        return;
    }

    panel.innerHTML = `
        <strong>Expiry Notifications:</strong> ${alerts.length} equipment/vehicle inspection${alerts.length === 1 ? "" : "s"} expiring within 30 days.
        <div class="table-wrap" style="margin-top:8px;">
            <table>
                <thead>
                    <tr><th>Name</th><th>ID #</th><th>Operator</th><th>Expiry</th><th>Days Left</th><th>Email Status</th></tr>
                </thead>
                <tbody>
                    ${alerts.map((item) => {
                        const sent = hasEquipmentNotification(item);
                        return `
                            <tr>
                                <td>${escapeHtml(item.name)}</td>
                                <td>${escapeHtml(item.identification_number || "")}</td>
                                <td>${escapeHtml(item.operator_name || "")}</td>
                                <td>${escapeHtml(item.yearly_inspection_expiry)}</td>
                                <td>${item.daysUntilExpiry}</td>
                                <td>${sent ? "Email sent" : "Email pending"}</td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        </div>
    `;
}

async function processEquipmentExpiryNotifications() {
    renderEquipmentExpiryAlerts();

    const alertsToSend = getEquipmentExpiryAlerts().filter((item) => !hasEquipmentNotification(item));

    for (const item of alertsToSend) {
        await sendEquipmentExpiryEmail(item);
    }

    renderEquipmentExpiryAlerts();
}

async function sendEquipmentExpiryEmail(item) {
    const subject = "JGC Equipment Inspection Expiry Notice - " + item.name;
    const body = [
        "JGC Equipment Inspection Expiry Notice",
        "",
        "Equipment / Vehicle: " + item.name,
        "Identification Number: " + (item.identification_number || "Not entered"),
        "Operator: " + (item.operator_name || "Not entered"),
        "Yearly Inspection Expiry: " + item.yearly_inspection_expiry,
        "Days Until Expiry: " + item.daysUntilExpiry,
        "",
        "Please review this item in the JGC Portal admin equipment tab."
    ].join("\n");

    try {
        await fetch(EQUIPMENT_EMAIL_SCRIPT_URL, {
            method: "POST",
            mode: "no-cors",
            headers: {
                "Content-Type": "text/plain;charset=utf-8"
            },
            body: JSON.stringify({
                subject,
                body,
                text: body,
                source: "equipment_expiry",
                equipmentId: item.id,
                equipmentName: item.name,
                identificationNumber: item.identification_number || "",
                operatorName: item.operator_name || "",
                expiryDate: item.yearly_inspection_expiry
            })
        });

        const { data, error } = await supabaseClient
            .from("equipment_expiry_notifications")
            .insert({
                equipment_id: item.id,
                equipment_name: item.name,
                identification_number: item.identification_number || "",
                operator_name: item.operator_name || "",
                expiry_date: item.yearly_inspection_expiry,
                notification_type: "30_day",
                emailed_at: new Date().toISOString()
            })
            .select()
            .single();

        if (!error && data) {
            equipmentNotifications.unshift(data);
        }

        if (typeof createJgcPortalNotifications === "function") {
            await createJgcPortalNotifications(supabaseClient, "inspection_issue", [{ role: "supervisor" }, { role: "admin" }], {
                title: "Equipment inspection expiring",
                message: item.name + " " + (item.identification_number || "") + " expires " + item.yearly_inspection_expiry + ".",
                link_url: "admin.html?tab=equipment",
                source_table: "equipment_vehicles",
                source_id: item.id,
                dedupe_key_prefix: "equipment_expiring:" + item.id + ":" + item.yearly_inspection_expiry,
                metadata: {
                    equipment_name: item.name,
                    identification_number: item.identification_number || "",
                    operator_name: item.operator_name || "",
                    expiry_date: item.yearly_inspection_expiry,
                    days_until_expiry: item.daysUntilExpiry
                }
            });
        }
    } catch (error) {
        console.warn("Equipment expiry email could not be sent.", error);
    }
}

function setEquipmentStatus(message, isError = false) {
    const status = document.getElementById("equipmentStatus");

    if (!status) {
        return;
    }

    status.textContent = message;
    status.style.color = isError ? "#ffb4b4" : "";
}

function clearEquipmentForm() {
    editingEquipmentId = "";
    document.getElementById("equipmentName").value = "";
    document.getElementById("equipmentIdentification").value = "";
    document.getElementById("equipmentLicensePlate").value = "";
    document.getElementById("equipmentType").value = "";
    document.getElementById("equipmentOperator").value = "";
    document.getElementById("equipmentHours").value = "";
    document.getElementById("equipmentCurrentKm").value = "";
    document.getElementById("equipmentOwnership").value = "owned";
    document.getElementById("equipmentRentalSupplier").value = "";
    document.getElementById("equipmentBillable").value = "true";
    document.getElementById("equipmentTransportationRequired").value = "false";
    document.getElementById("equipmentExpiry").value = "";
    document.getElementById("equipmentJurisdiction").value = "";
    document.getElementById("equipmentVin").value = "";
    document.getElementById("equipmentMake").value = "";
    document.getElementById("equipmentModel").value = "";
    document.getElementById("equipmentModelYear").value = "";
    document.getElementById("equipmentOdometerRequired").value = "true";
    document.getElementById("equipmentNotes").value = "";
    document.getElementById("equipmentSaveButton").textContent = "Add Equipment / Vehicle";
    setEquipmentStatus("");
}

function getEquipmentQrInspectionType(item) {
    const text = [
        item && item.name,
        item && item.equipment_type,
        item && item.identification_number,
        item && item.notes
    ].join(" ").toLowerCase();

    if (/(telehandler|tele-handler|tele handler)/.test(text)) {
        return "Tele Handler";
    }

    if (/(forklift|fork lift)/.test(text)) {
        return "Fork Lift";
    }

    if (/(aerial|scissor|boom|man lift|manlift|lift)/.test(text)) {
        return "Aerial Lifts";
    }

    return "";
}

function getEquipmentQrUrl(token) {
    const url = new URL("equipment-inspection.html", window.location.href);
    url.searchParams.set("token", token || "");
    return url.href;
}

function isVehicleInspectionAsset(item) {
    if (!item) {
        return false;
    }

    if (getEquipmentQrInspectionType(item)) {
        return false;
    }

    const text = [
        item.name,
        item.equipment_type,
        item.asset_category,
        item.identification_number,
        item.license_plate,
        item.notes
    ].join(" ").toLowerCase();

    if (/\b(trailer|trl|float|lift|forklift|telehandler|tele-handler|aerial|scissor|boom)\b/.test(text)) {
        return false;
    }

    return /\b(truck|van|vehicle|pickup|car|f-?150|f-?250|f-?350|ram|silverado|sierra|chevy|plate)\b/.test(text) || getEquipmentCategory(item) === "Vehicles";
}

function getVehicleQrUrl(item) {
    const url = new URL("vehicle-inspection.html", window.location.href);
    url.searchParams.set("vehicle_id", item && item.id ? item.id : "");
    url.searchParams.set("token", item && item.vehicle_qr_token ? item.vehicle_qr_token : "");
    return url.href;
}

function getEquipmentQrImageUrl(url) {
    return "https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&format=png&data=" + encodeURIComponent(url || "");
}

function showEquipmentQrImageFallback(url, canvas, image, fallback, message) {
    const imageUrl = getEquipmentQrImageUrl(url);

    if (activeEquipmentQr) {
        activeEquipmentQr.fallbackQrImageSrc = imageUrl;
        activeEquipmentQr.qrImageSrc = imageUrl;
    }

    if (canvas) {
        canvas.hidden = true;
    }

    if (image) {
        image.hidden = false;
        image.onload = () => {
            if (fallback) {
                fallback.textContent = "";
            }
        };
        image.onerror = () => {
            if (fallback) {
                fallback.textContent = "QR code could not render. Use the link above.";
            }
        };
        image.src = imageUrl;
    }

    if (fallback) {
        fallback.textContent = message || "";
    }
}

function renderEquipmentQrCode(url, canvas, image, fallback) {
    if (activeEquipmentQr) {
        activeEquipmentQr.qrImageSrc = "";
        activeEquipmentQr.fallbackQrImageSrc = getEquipmentQrImageUrl(url);
    }

    if (image) {
        image.hidden = true;
        image.removeAttribute("src");
        image.onload = null;
        image.onerror = null;
    }

    if (fallback) {
        fallback.textContent = "";
    }

    if (!canvas) {
        showEquipmentQrImageFallback(url, canvas, image, fallback, "");
        return;
    }

    canvas.hidden = false;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (window.QRCode && typeof window.QRCode.toCanvas === "function") {
        window.QRCode.toCanvas(canvas, url, { width: 220, margin: 2 }, (error) => {
            if (error) {
                showEquipmentQrImageFallback(url, canvas, image, fallback, "Using backup QR renderer.");
                return;
            }

            try {
                if (activeEquipmentQr) {
                    activeEquipmentQr.qrImageSrc = canvas.toDataURL("image/png");
                }
            } catch (toDataError) {
                if (activeEquipmentQr) {
                    activeEquipmentQr.qrImageSrc = activeEquipmentQr.fallbackQrImageSrc || "";
                }
            }
        });
        return;
    }

    showEquipmentQrImageFallback(url, canvas, image, fallback, "Using backup QR renderer.");
}

function renderEquipmentQrCell(item) {
    const inspectionType = item.inspection_qr_type || getEquipmentQrInspectionType(item);
    const vehicleQrButton = isVehicleInspectionAsset(item)
        ? `
            <button type="button" class="secondary jgc-button jgc-button--secondary" onclick="openVehicleInspectionQr('${item.id}')">${item.vehicle_qr_token ? "Vehicle QR" : "Create Vehicle QR"}</button>
            <div class="small">Vehicle / Trailer Daily</div>
        `
        : "";
    const historyButton = `
        <button type="button" class="secondary jgc-button jgc-button--secondary" onclick="openEquipmentInspectionHistory('${item.id}')">History</button>
    `;

    if (!inspectionType && !vehicleQrButton) {
        return '<span class="small">No lift QR</span>';
    }

    const buttonLabel = item.inspection_qr_token ? "View QR" : "Create QR";

    return `
        ${inspectionType ? `
            <button type="button" class="secondary jgc-button jgc-button--secondary" onclick="openEquipmentQr('${item.id}')">${buttonLabel}</button>
            <div class="small">${escapeHtml(inspectionType)}</div>
        ` : ""}
        ${vehicleQrButton}
        ${historyButton}
    `;
}

function getEquipmentDocumentsByType(equipmentId, documentType) {
    return (equipmentDocuments || [])
        .filter((document) => document.equipment_id === equipmentId && document.document_type === documentType && document.is_active !== false)
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

function renderEquipmentDocumentsCell(item) {
    if (!getEquipmentQrInspectionType(item) && !item.inspection_qr_type) {
        return '<span class="small">Not a lift</span>';
    }

    const manualCount = getEquipmentDocumentsByType(item.id, "manual").length;
    const yearlyCount = getEquipmentDocumentsByType(item.id, "yearly_inspection").length;

    return `
        <button type="button" class="secondary jgc-button jgc-button--secondary" onclick="openEquipmentDocuments('${escapeHtml(item.id)}')">Documents</button>
        <div class="small">${manualCount} manual${manualCount === 1 ? "" : "s"} / ${yearlyCount ? "Yearly report added" : "No yearly report"}</div>
    `;
}

function setEquipmentDocumentsStatus(message, isError) {
    const status = document.getElementById("equipmentDocumentsStatus");

    if (!status) {
        return;
    }

    status.textContent = message || "";
    status.style.color = isError ? "#ffb4b4" : "";
}

function renderEquipmentDocumentRows(documents, emptyMessage) {
    if (!documents.length) {
        return '<div class="small jgc-empty-state">' + escapeHtml(emptyMessage) + '</div>';
    }

    return documents.map((document) => `
        <div class="equipment-document-row">
            <div>
                <div class="equipment-document-name">${escapeHtml(document.file_name || "Document.pdf")}</div>
                <div class="small">Uploaded ${escapeHtml(formatDate(document.created_at) || "")}${document.uploaded_by_name ? " by " + escapeHtml(document.uploaded_by_name) : ""}</div>
            </div>
            <div class="actions jgc-table-actions">
                <button type="button" class="secondary jgc-button jgc-button--secondary" onclick="viewEquipmentDocument('${escapeHtml(document.id)}')">View PDF</button>
                <button type="button" class="delete-button jgc-button jgc-button--danger" onclick="removeEquipmentDocument('${escapeHtml(document.id)}')">Remove</button>
            </div>
        </div>
    `).join("");
}

function renderEquipmentDocumentsModal() {
    const manualList = document.getElementById("equipmentManualList");
    const yearlyList = document.getElementById("equipmentYearlyInspectionList");

    if (!manualList || !yearlyList || !activeEquipmentDocumentsId) {
        return;
    }

    manualList.innerHTML = renderEquipmentDocumentRows(
        getEquipmentDocumentsByType(activeEquipmentDocumentsId, "manual"),
        "No lift manuals uploaded."
    );
    yearlyList.innerHTML = renderEquipmentDocumentRows(
        getEquipmentDocumentsByType(activeEquipmentDocumentsId, "yearly_inspection"),
        "No yearly inspection report uploaded."
    );
}

async function refreshEquipmentDocuments(equipmentId) {
    const { data, error } = await supabaseClient
        .from("equipment_documents")
        .select("*")
        .eq("equipment_id", equipmentId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

    if (error) {
        throw new Error(error.message || "Lift documents could not be loaded.");
    }

    equipmentDocuments = equipmentDocuments
        .filter((document) => document.equipment_id !== equipmentId)
        .concat(data || []);
    renderEquipmentDocumentsModal();
    renderEquipment();
}

async function openEquipmentDocuments(id) {
    const item = equipmentItems.find((entry) => entry.id === id);

    if (!item) {
        setEquipmentStatus("Equipment could not be found.", true);
        return;
    }

    if (!getEquipmentQrInspectionType(item) && !item.inspection_qr_type) {
        setEquipmentStatus("Lift documents are available for forklifts, aerial lifts, and telehandlers.", true);
        return;
    }

    activeEquipmentDocumentsId = id;
    document.getElementById("equipmentDocumentsTitle").textContent = "Lift Documents";
    document.getElementById("equipmentDocumentsUnit").textContent = getEquipmentNameById(id) || item.name || "Lift";
    document.getElementById("equipmentManualFiles").value = "";
    document.getElementById("equipmentYearlyInspectionFile").value = "";
    setEquipmentDocumentsStatus("Loading lift documents...");

    const modal = document.getElementById("equipmentDocumentsModal");
    modal.classList.add("open");
    modal.style.display = "flex";

    try {
        await ensureEquipmentQrToken(id);
        await refreshEquipmentDocuments(id);
        setEquipmentDocumentsStatus("");
    } catch (error) {
        setEquipmentDocumentsStatus(error && error.message ? error.message : "Lift documents could not be loaded.", true);
    }
}

function closeEquipmentDocumentsModal(event) {
    if (event && event.target !== event.currentTarget) {
        return;
    }

    const modal = document.getElementById("equipmentDocumentsModal");
    modal.classList.remove("open");
    modal.style.display = "none";
    activeEquipmentDocumentsId = "";
}

function isPdfDocument(file) {
    return Boolean(file) && (file.type === "application/pdf" || /\.pdf$/i.test(file.name || ""));
}

function createEquipmentDocumentStorageId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
        return window.crypto.randomUUID();
    }

    return Date.now() + "-" + Math.random().toString(16).slice(2);
}

async function saveEquipmentDocumentFile(item, documentType, file) {
    if (!isPdfDocument(file)) {
        throw new Error((file && file.name ? file.name + ": " : "") + "Only PDF files can be uploaded.");
    }

    if (file.size > 25 * 1024 * 1024) {
        throw new Error(file.name + " is larger than the 25 MB limit.");
    }

    const token = item.inspection_qr_token;
    if (!token) {
        throw new Error("This lift needs an inspection QR token before documents can be uploaded.");
    }

    const storagePath = token + "/" + documentType + "/" + createEquipmentDocumentStorageId() + ".pdf";
    const input = document.getElementById(documentType === "manual" ? "equipmentManualFiles" : "equipmentYearlyInspectionFile");
    const { error: uploadError } = await uploadJgcFile({
        client: supabaseClient,
        bucket: "equipment-documents",
        path: storagePath,
        file,
        input,
        cacheControl: "3600",
        contentType: "application/pdf",
        upsert: false,
        retry: function() { return uploadEquipmentDocuments(documentType); }
    });

    if (uploadError) {
        throw new Error(file.name + " could not be uploaded: " + uploadError.message);
    }

    const existingYearly = documentType === "yearly_inspection"
        ? getEquipmentDocumentsByType(item.id, "yearly_inspection")[0]
        : null;
    const payload = {
        equipment_id: item.id,
        document_type: documentType,
        file_name: file.name,
        storage_path: storagePath,
        uploaded_by: currentUserId || null,
        uploaded_by_name: currentWorkerDisplay || "",
        is_active: true,
        updated_at: new Date().toISOString()
    };
    let result;

    if (existingYearly) {
        result = await supabaseClient
            .from("equipment_documents")
            .update(payload)
            .eq("id", existingYearly.id)
            .select()
            .single();
    } else {
        result = await supabaseClient
            .from("equipment_documents")
            .insert(payload)
            .select()
            .single();
    }

    if (result.error) {
        await supabaseClient.storage.from("equipment-documents").remove([storagePath]);
        throw new Error(file.name + " could not be saved: " + result.error.message);
    }

    if (existingYearly && existingYearly.storage_path && existingYearly.storage_path !== storagePath) {
        await supabaseClient.storage.from("equipment-documents").remove([existingYearly.storage_path]);
    }

    return result.data;
}

async function uploadEquipmentDocuments(documentType) {
    const item = equipmentItems.find((entry) => entry.id === activeEquipmentDocumentsId);
    const input = documentType === "manual"
        ? document.getElementById("equipmentManualFiles")
        : document.getElementById("equipmentYearlyInspectionFile");
    const files = Array.from(input && input.files ? input.files : []);

    if (!item) {
        setEquipmentDocumentsStatus("Lift could not be found.", true);
        return;
    }

    if (!files.length) {
        setEquipmentDocumentsStatus("Choose a PDF to upload.", true);
        return;
    }

    if (documentType === "yearly_inspection" && files.length > 1) {
        setEquipmentDocumentsStatus("Choose one yearly inspection report.", true);
        return;
    }

    setEquipmentDocumentsStatus("Uploading " + files.length + " PDF" + (files.length === 1 ? "" : "s") + "...");

    try {
        await ensureEquipmentQrToken(item.id);

        for (const file of files) {
            await saveEquipmentDocumentFile(item, documentType, file);
        }

        input.value = "";
        await refreshEquipmentDocuments(item.id);
        setEquipmentDocumentsStatus(documentType === "manual" ? "Lift manual uploaded." : "Yearly inspection report uploaded.");
    } catch (error) {
        setEquipmentDocumentsStatus(error && error.message ? error.message : "PDF upload failed.", true);
    }
}

async function viewEquipmentDocument(id) {
    const documentRecord = equipmentDocuments.find((document) => document.id === id && document.is_active !== false);

    if (!documentRecord) {
        setEquipmentDocumentsStatus("Document could not be found.", true);
        return;
    }

    const viewer = window.open("", "_blank");
    const result = await openJgcSignedFile({
        client: supabaseClient,
        bucket: "equipment-documents",
        path: documentRecord.storage_path,
        expiresIn: 600,
        viewer
    });

    if (result.error) {
        setEquipmentDocumentsStatus(result.error.message || "Document could not be opened.", true);
    }
}

async function removeEquipmentDocument(id) {
    const documentRecord = equipmentDocuments.find((document) => document.id === id && document.is_active !== false);

    if (!documentRecord || !confirm("Remove " + (documentRecord.file_name || "this PDF") + " from this lift?")) {
        return;
    }

    setEquipmentDocumentsStatus("Removing PDF...");
    const { error } = await supabaseClient
        .from("equipment_documents")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", id);

    if (error) {
        setEquipmentDocumentsStatus("PDF could not be removed: " + error.message, true);
        return;
    }

    const { error: storageError } = await supabaseClient.storage
        .from("equipment-documents")
        .remove([documentRecord.storage_path]);

    equipmentDocuments = equipmentDocuments.filter((document) => document.id !== id);
    renderEquipmentDocumentsModal();
    renderEquipment();
    setEquipmentDocumentsStatus(storageError ? "PDF was removed from the lift, but storage cleanup will need attention." : "PDF removed.", Boolean(storageError));
}

async function ensureEquipmentQrToken(id) {
    const item = equipmentItems.find((entry) => entry.id === id);

    if (!item) {
        throw new Error("Equipment or vehicle could not be found.");
    }

    if (!getEquipmentQrInspectionType(item) && !item.inspection_qr_type) {
        throw new Error("Only forklifts, aerial lifts, and telehandlers can use inspection QR codes.");
    }

    if (item.inspection_qr_token && item.inspection_qr_type) {
        return item;
    }

    const { data, error } = await supabaseClient.rpc("ensure_equipment_inspection_qr_token", {
        p_equipment_id: id
    });

    if (error) {
        throw new Error((error.message || "QR code could not be created.") + " If this is the first time using equipment QR codes, run supabase-equipment-qr-inspection-setup.sql in Supabase.");
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (!result || !result.token) {
        throw new Error("Supabase did not return a QR token.");
    }

    item.inspection_qr_token = result.token;
    item.inspection_qr_type = result.inspection_type || getEquipmentQrInspectionType(item);
    renderEquipment();
    return item;
}

async function openEquipmentQr(id) {
    try {
        setEquipmentStatus("Preparing QR code...");
        const item = await ensureEquipmentQrToken(id);
        const url = getEquipmentQrUrl(item.inspection_qr_token);
        const unitLabel = getEquipmentNameById(item.id) || item.name || "Equipment";
        const inspectionType = item.inspection_qr_type || getEquipmentQrInspectionType(item) || "Equipment Inspection";
        const modal = document.getElementById("equipmentQrModal");
        const canvas = document.getElementById("equipmentQrCanvas");
        const image = document.getElementById("equipmentQrImage");
        const fallback = document.getElementById("equipmentQrFallback");
        const link = document.getElementById("equipmentQrLink");

        activeEquipmentQr = {
            item,
            url,
            unitLabel,
            inspectionType,
            qrImageSrc: "",
            fallbackQrImageSrc: getEquipmentQrImageUrl(url)
        };

        document.getElementById("equipmentQrTitle").textContent = "QR Code - " + unitLabel;
        document.getElementById("equipmentQrUnit").textContent = unitLabel;
        document.getElementById("equipmentQrType").textContent = inspectionType;
        fallback.textContent = "";
        link.href = url;
        link.textContent = url;

        renderEquipmentQrCode(url, canvas, image, fallback);

        modal.classList.add("open");
        modal.style.display = "flex";
        setEquipmentStatus("QR code ready.");
    } catch (error) {
        setEquipmentStatus(error && error.message ? error.message : "QR code could not be opened.", true);
    }
}

async function ensureVehicleInspectionQrToken(id) {
    const item = equipmentItems.find((entry) => entry.id === id);

    if (!item) {
        throw new Error("Vehicle could not be found.");
    }

    if (!isVehicleInspectionAsset(item)) {
        throw new Error("Vehicle QR codes are for trucks and vehicles. Trailers are selected from the vehicle inspection form.");
    }

    if (item.vehicle_qr_token) {
        return item;
    }

    const { data, error } = await supabaseClient.rpc("ensure_vehicle_inspection_qr_token", {
        p_equipment_id: id
    });

    if (error) {
        throw new Error((error.message || "Vehicle QR code could not be created.") + " If this is the first time using vehicle QR codes, run supabase-vehicle-inspection-setup.sql in Supabase.");
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (!result || !result.token) {
        throw new Error("Supabase did not return a vehicle QR token.");
    }

    item.vehicle_qr_token = result.token;
    item.vehicle_qr_url = result.qr_url || "";
    renderEquipment();
    return item;
}

async function openVehicleInspectionQr(id) {
    try {
        setEquipmentStatus("Preparing vehicle QR code...");
        const item = await ensureVehicleInspectionQrToken(id);
        const url = getVehicleQrUrl(item);
        const unitLabel = [item.license_plate || item.unit_number || item.identification_number, item.name].filter(Boolean).join(" - ") || "Vehicle";
        const modal = document.getElementById("equipmentQrModal");
        const canvas = document.getElementById("equipmentQrCanvas");
        const image = document.getElementById("equipmentQrImage");
        const fallback = document.getElementById("equipmentQrFallback");
        const link = document.getElementById("equipmentQrLink");

        activeEquipmentQr = {
            item,
            url,
            unitLabel,
            inspectionType: "Daily Vehicle / Trailer Inspection",
            qrImageSrc: "",
            fallbackQrImageSrc: getEquipmentQrImageUrl(url)
        };

        document.getElementById("equipmentQrTitle").textContent = "Vehicle QR Code - " + unitLabel;
        document.getElementById("equipmentQrUnit").textContent = unitLabel;
        document.getElementById("equipmentQrType").textContent = "Daily Vehicle / Trailer Inspection";
        fallback.textContent = "";
        link.href = url;
        link.textContent = url;

        renderEquipmentQrCode(url, canvas, image, fallback);

        modal.classList.add("open");
        modal.style.display = "flex";
        setEquipmentStatus("Vehicle QR code ready.");
    } catch (error) {
        setEquipmentStatus(error && error.message ? error.message : "Vehicle QR code could not be opened.", true);
    }
}

async function openEquipmentInspectionHistory(id) {
    const item = equipmentItems.find((entry) => entry.id === id);

    if (!item) {
        setEquipmentStatus("Equipment or vehicle could not be found.", true);
        return;
    }

    const searchValue = item.license_plate || item.unit_number || item.identification_number || item.name || "";
    showTab("inspections");

    if (!adminTabDataLoaded.has("inspections")) {
        await loadAdminTabData("inspections");
        adminTabDataLoaded.add("inspections");
    }

    const workerInput = document.getElementById("inspectionWorkerFilter");
    const typeInput = document.getElementById("inspectionTypeFilter");

    if (workerInput) {
        workerInput.value = "";
    }

    if (typeInput) {
        typeInput.value = searchValue;
    }

    renderInspections();

    const inspectionsSection = document.getElementById("inspectionsSection");
    if (inspectionsSection) {
        inspectionsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
}

function closeEquipmentQrModal(event) {
    if (event && event.target !== event.currentTarget) {
        return;
    }

    const modal = document.getElementById("equipmentQrModal");
    if (modal) {
        modal.classList.remove("open");
        modal.style.display = "";
    }
}

async function copyEquipmentQrLink() {
    if (!activeEquipmentQr || !activeEquipmentQr.url) {
        return;
    }

    try {
        await navigator.clipboard.writeText(activeEquipmentQr.url);
        setEquipmentStatus("QR link copied.");
    } catch (error) {
        setEquipmentStatus("QR link: " + activeEquipmentQr.url);
    }
}

function printEquipmentQr() {
    if (!activeEquipmentQr) {
        return;
    }

    const canvas = document.getElementById("equipmentQrCanvas");
    const image = document.getElementById("equipmentQrImage");
    let qrImage = activeEquipmentQr.qrImageSrc || "";

    if (!qrImage && image && !image.hidden && image.src) {
        qrImage = image.src;
    }

    if (!qrImage && canvas && !canvas.hidden) {
        try {
            qrImage = canvas.toDataURL("image/png");
        } catch (error) {
            qrImage = "";
        }
    }

    qrImage = qrImage || activeEquipmentQr.fallbackQrImageSrc || "";

    const printWindow = window.open("", "_blank", "width=520,height=720");

    if (!printWindow) {
        setEquipmentStatus("Popup blocked. Use your browser print button while the QR modal is open.", true);
        return;
    }

    printWindow.document.write(`
        <!doctype html>
        <html>
        <head>
            <title>${escapeHtml(activeEquipmentQr.unitLabel)} QR</title>
            <style>
                body { margin: 0; padding: 28px; font-family: Arial, sans-serif; color: #102018; text-align: center; }
                .label { max-width: 420px; margin: 0 auto; border: 2px solid #102018; border-radius: 10px; padding: 20px; }
                .logo { width: 230px; max-width: 100%; height: auto; margin-bottom: 12px; }
                h1 { margin: 6px 0; font-size: 24px; }
                p { margin: 8px 0; font-size: 15px; }
                .qr { width: 260px; height: 260px; margin: 14px auto; display: block; }
                .link { overflow-wrap: anywhere; font-size: 10px; color: #0b5e3b; }
            </style>
        </head>
        <body>
            <div class="label">
                <img class="logo" src="logo.webp" alt="John Gordon Construction logo">
                <h1>${escapeHtml(activeEquipmentQr.unitLabel)}</h1>
                <p>${escapeHtml(activeEquipmentQr.inspectionType)}</p>
                ${qrImage ? '<img class="qr" src="' + qrImage + '" alt="Equipment inspection QR code">' : '<p>QR image could not render. Use link below.</p>'}
                <p>Scan to submit or view today's inspection.</p>
                <p class="link">${escapeHtml(activeEquipmentQr.url)}</p>
            </div>
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
}

function renderEquipment() {
    const list = document.getElementById("equipmentList");

    renderEquipmentExpiryAlerts();

    if (!list) {
        return;
    }

    if (!equipmentItems.length) {
        list.innerHTML = '<div class="jgc-empty-state">No equipment or vehicles have been added yet.</div>';
        return;
    }

    const groups = ["Vehicles", "Trailers", "Equipment"].map((category) => ({
        category,
        items: equipmentItems
            .filter((item) => getEquipmentCategory(item) === category)
            .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
    }));

    const maintenanceHtml = renderEquipmentMaintenanceLogTable();

    list.innerHTML = groups.map((group) => `
        <h3 class="jgc-section-title" style="margin:18px 0 8px;color:#2f6f3c;">${group.category}</h3>
        <div class="table-wrap jgc-table-wrap">
            <table class="jgc-table">
                <thead>
                    <tr><th>Name</th><th>Type of Equip/Vehicle</th><th>Plate / ID #</th><th>Make</th><th>Model</th><th>Year</th><th>KM</th><th>Operator</th><th>Current Hours</th><th>Owned / Rental</th><th>Billable</th><th>Transport Required</th><th>Inspection Expiry</th><th>Status</th><th>Notes</th><th>Lift Documents</th><th>QR</th><th>Actions</th></tr>
                </thead>
                <tbody>
                    ${group.items.length ? group.items.map((item) => {
                        const status = getEquipmentStatus(item.yearly_inspection_expiry);
                        const currentKm = item.current_km !== null && item.current_km !== undefined && item.current_km !== ""
                            ? Number(item.current_km).toLocaleString("en-CA", { maximumFractionDigits: 0 })
                            : "";
                        const currentHours = group.category === "Vehicles"
                            ? ""
                            : (item.current_hours !== null && item.current_hours !== undefined ? Number(item.current_hours).toFixed(1) : "");

                        return `
                            <tr>
                                <td>${escapeHtml(item.name)}</td>
                                <td>${escapeHtml(item.equipment_type || "")}</td>
                                <td>${escapeHtml(item.license_plate || item.identification_number || "")}</td>
                                <td>${escapeHtml(item.make || "")}</td>
                                <td>${escapeHtml(item.model || "")}</td>
                                <td>${escapeHtml(item.model_year || "")}</td>
                                <td>${escapeHtml(currentKm)}</td>
                                <td>${escapeHtml(item.operator_name || "")}</td>
                                <td>${escapeHtml(currentHours)}</td>
                                <td>${escapeHtml(capitalizeWords(item.ownership_type || "owned"))}${item.rental_supplier ? "<br><span class=\"small\">" + escapeHtml(item.rental_supplier) + "</span>" : ""}</td>
                                <td>${item.billable_equipment === false ? "No" : "Yes"}</td>
                                <td>${item.transportation_required ? "Yes" : "No"}</td>
                                <td>${escapeHtml(item.yearly_inspection_expiry || "")}</td>
                                <td><span class="jgc-badge ${status === "Valid" || status === "No Expiry" ? "jgc-badge--success" : status === "Expiring Soon" ? "jgc-badge--warning" : "jgc-badge--danger"}">${escapeHtml(status)}</span></td>
                                <td>${escapeHtml(item.notes || "")}</td>
                                <td>${renderEquipmentDocumentsCell(item)}</td>
                                <td>${renderEquipmentQrCell(item)}</td>
                                <td><div class="actions jgc-table-actions">
                                    <button type="button" class="jgc-button" onclick="editEquipment('${item.id}')">Edit</button>
                                    <button type="button" class="delete-button jgc-button jgc-button--danger" onclick="deleteEquipment('${item.id}')">Delete</button>
                                </div>
                                </td>
                            </tr>
                        `;
                    }).join("") : '<tr><td colspan="18"><div class="jgc-empty-state">No items in this group.</div></td></tr>'}
                </tbody>
            </table>
        </div>
    `).join("") + maintenanceHtml;
}

function renderEquipmentMaintenanceLogTable() {
    const rows = (equipmentMaintenanceLogs || [])
        .slice()
        .sort((a, b) => String(b.scheduled_date || b.created_at || "").localeCompare(String(a.scheduled_date || a.created_at || "")));
    const grouped = groupMaintenanceLogsByCategoryAndUnit(rows);

    return `
        <h3 class="jgc-section-title" style="margin:22px 0 8px;color:#2f6f3c;">Maintenance Work Log</h3>
        <div class="small" style="margin-bottom:8px;">Equipment, trailer, and vehicle appointments from the schedule are logged here for maintenance tracking.</div>
        ${rows.length ? ["Vehicles", "Trailers", "Equipment"].map((category) => renderMaintenanceCategoryGroup(category, grouped[category] || new Map())).join("") : '<div class="small jgc-empty-state">No maintenance work has been scheduled yet.</div>'}
    `;
}

function groupMaintenanceLogsByCategoryAndUnit(rows) {
    const groups = {
        Vehicles: new Map(),
        Trailers: new Map(),
        Equipment: new Map()
    };

    rows.forEach((row) => {
        const item = equipmentItems.find((entry) => entry.id === row.equipment_id) || null;
        const category = item ? getEquipmentCategory(item) : getMaintenanceCategoryFromName(row.equipment_name);
        const unitKey = row.equipment_id || normalizeWorkerName(row.equipment_name || "unknown-unit");
        const unitName = row.equipment_name || getEquipmentNameById(row.equipment_id) || "Unknown Unit";
        const categoryMap = groups[category] || groups.Equipment;

        if (!categoryMap.has(unitKey)) {
            categoryMap.set(unitKey, {
                unitName,
                rows: []
            });
        }

        categoryMap.get(unitKey).rows.push(row);
    });

    return groups;
}

function getMaintenanceCategoryFromName(name) {
    const text = String(name || "").toLowerCase();

    if (/\b(trailer|trl|float)\b/.test(text)) {
        return "Trailers";
    }

    if (/\b(truck|van|vehicle|pickup|car|f-?150|f-?250|f-?350|ram|silverado|sierra|plate)\b/.test(text)) {
        return "Vehicles";
    }

    return "Equipment";
}

function renderMaintenanceCategoryGroup(category, unitMap) {
    const units = Array.from(unitMap.values())
        .sort((a, b) => String(a.unitName || "").localeCompare(String(b.unitName || "")));

    return `
        <h4 style="margin:16px 0 8px;color:#2f6f3c;">${escapeHtml(category)}</h4>
        ${units.length ? units.map((unit) => renderMaintenanceUnitGroup(unit)).join("") : '<div class="small jgc-empty-state" style="margin-bottom:10px;">No maintenance logged for this group.</div>'}
    `;
}

function renderMaintenanceUnitGroup(unit) {
    return `
        <details class="sub-card jgc-card" style="margin:8px 0 12px;" open>
            <summary style="cursor:pointer;font-weight:900;color:#2f6f3c;">${escapeHtml(unit.unitName)} (${unit.rows.length})</summary>
            <div class="table-wrap jgc-table-wrap" style="margin-top:8px;">
                <table class="jgc-table">
                    <thead>
                        <tr><th>Date</th><th>Time</th><th>Reason</th><th>Status</th><th>Completed</th><th>Notes</th><th>Actions</th></tr>
                    </thead>
                    <tbody>
                        ${unit.rows.map((row) => `
                            <tr>
                                <td>${escapeHtml(row.scheduled_date || "")}</td>
                                <td>${escapeHtml(row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : "")}</td>
                                <td>${escapeHtml(row.maintenance_reason || "")}</td>
                                <td>${escapeHtml(capitalizeWords(row.status || "scheduled"))}</td>
                                <td>${escapeHtml(row.completed_at ? String(row.completed_at).slice(0, 10) : "")}</td>
                                <td>${escapeHtml(row.notes || "")}</td>
                                <td>
                                    ${row.status === "completed"
                                        ? '<span class="small">Complete</span>'
                                        : '<button type="button" class="jgc-button" onclick="completeMaintenanceLog(\'' + escapeHtml(row.id) + '\')">Mark Complete</button>'}
                                </td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        </details>
    `;
}

function getEquipmentNameById(id) {
    const item = equipmentItems.find((entry) => entry.id === id);
    return item ? [item.name, item.identification_number ? "#" + item.identification_number : ""].filter(Boolean).join(" ") : "";
}

async function completeMaintenanceLog(id) {
    const confirmed = confirm("Mark this maintenance work as completed?");

    if (!confirmed) {
        return;
    }

    const { data, error } = await supabaseClient
        .from("equipment_maintenance_logs")
        .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            completed_by: currentWorkerDisplay
        })
        .eq("id", id)
        .select()
        .single();

    if (error) {
        setEquipmentStatus("Maintenance log could not be updated: " + (error.message || "Unknown error"), true);
        return;
    }

    equipmentMaintenanceLogs = equipmentMaintenanceLogs.map((row) => row.id === id ? data : row);
    renderEquipment();
    setEquipmentStatus("Maintenance log marked complete.");
}

function getEquipmentCategory(item) {
    const text = [
        item.equipment_type,
        item.name,
        item.identification_number,
        item.notes
    ].join(" ").toLowerCase();

    if (/\b(trailer|trl|float)\b/.test(text)) {
        return "Trailers";
    }

    if (/\b(equipment|forklift|lift|telehandler|tele-handler|loader|excavator|compressor|generator)\b/.test(text)) {
        return "Equipment";
    }

    if (/\b(truck|van|vehicle|pickup|car|f-?150|f-?250|f-?350|ram|silverado|sierra|plate)\b/.test(text)) {
        return "Vehicles";
    }

    return "Equipment";
}

function editEquipment(id) {
    const item = equipmentItems.find((entry) => entry.id === id);

    if (!item) {
        alert("Equipment or vehicle could not be found.");
        return;
    }

    editingEquipmentId = id;
    const panel = document.getElementById("equipmentEntryPanel");
    if (panel) {
        panel.open = true;
    }
    document.getElementById("equipmentName").value = item.name || "";
    document.getElementById("equipmentIdentification").value = item.identification_number || "";
    document.getElementById("equipmentLicensePlate").value = item.license_plate || "";
    document.getElementById("equipmentType").value = item.equipment_type || "";
    document.getElementById("equipmentOperator").value = item.operator_name || "";
    document.getElementById("equipmentHours").value = item.current_hours !== null && item.current_hours !== undefined ? item.current_hours : "";
    document.getElementById("equipmentCurrentKm").value = item.current_km !== null && item.current_km !== undefined ? item.current_km : "";
    document.getElementById("equipmentOwnership").value = item.ownership_type || "owned";
    document.getElementById("equipmentRentalSupplier").value = item.rental_supplier || "";
    document.getElementById("equipmentBillable").value = item.billable_equipment === false ? "false" : "true";
    document.getElementById("equipmentTransportationRequired").value = item.transportation_required ? "true" : "false";
    document.getElementById("equipmentExpiry").value = item.yearly_inspection_expiry || "";
    document.getElementById("equipmentJurisdiction").value = item.jurisdiction || "";
    document.getElementById("equipmentVin").value = item.vin || "";
    document.getElementById("equipmentMake").value = item.make || "";
    document.getElementById("equipmentModel").value = item.model || "";
    document.getElementById("equipmentModelYear").value = item.model_year || "";
    document.getElementById("equipmentOdometerRequired").value = item.odometer_required === false ? "false" : "true";
    document.getElementById("equipmentNotes").value = item.notes || "";
    document.getElementById("equipmentSaveButton").textContent = "Update Equipment / Vehicle";
    setEquipmentStatus("Editing " + item.name + ".");
    document.getElementById("equipmentName").focus();
}

async function saveEquipment() {
    const name = document.getElementById("equipmentName").value.trim();
    const identificationNumber = document.getElementById("equipmentIdentification").value.trim();
    const licensePlate = document.getElementById("equipmentLicensePlate").value.trim();
    const equipmentType = document.getElementById("equipmentType").value.trim();
    const operatorName = document.getElementById("equipmentOperator").value.trim();
    const currentHoursValue = document.getElementById("equipmentHours").value;
    const currentHours = currentHoursValue === "" ? null : Number(currentHoursValue);
    const currentKmValue = document.getElementById("equipmentCurrentKm").value;
    const currentKm = currentKmValue === "" ? null : Number(currentKmValue);
    const ownershipType = document.getElementById("equipmentOwnership").value || "owned";
    const rentalSupplier = document.getElementById("equipmentRentalSupplier").value.trim();
    const billableEquipment = document.getElementById("equipmentBillable").value !== "false";
    const transportationRequired = document.getElementById("equipmentTransportationRequired").value === "true";
    const expiry = document.getElementById("equipmentExpiry").value || null;
    const jurisdiction = document.getElementById("equipmentJurisdiction").value.trim();
    const vin = document.getElementById("equipmentVin").value.trim();
    const make = document.getElementById("equipmentMake").value.trim();
    const model = document.getElementById("equipmentModel").value.trim();
    const modelYear = document.getElementById("equipmentModelYear").value.trim();
    const odometerRequired = document.getElementById("equipmentOdometerRequired").value !== "false";
    const notes = document.getElementById("equipmentNotes").value.trim();

    if (!name) {
        setEquipmentStatus("Please enter the equipment or vehicle name.", true);
        return;
    }

    if (currentHoursValue !== "" && (!Number.isFinite(currentHours) || currentHours < 0)) {
        setEquipmentStatus("Current hours must be a valid number.", true);
        return;
    }

    if (currentKmValue !== "" && (!Number.isFinite(currentKm) || currentKm < 0)) {
        setEquipmentStatus("Current KM must be a valid number.", true);
        return;
    }

    setEquipmentStatus("Saving equipment...");

    const payload = {
        name,
        equipment_type: equipmentType,
        identification_number: identificationNumber,
        license_plate: licensePlate,
        unit_number: licensePlate,
        jurisdiction,
        vin,
        make,
        model,
        model_year: modelYear,
        odometer_required: odometerRequired,
        operator_name: operatorName,
        current_hours: currentHours,
        current_km: currentKm,
        ownership_type: ownershipType,
        rental_supplier: rentalSupplier,
        billable_equipment: billableEquipment,
        transportation_required: transportationRequired,
        yearly_inspection_expiry: expiry,
        notes,
        updated_at: new Date().toISOString()
    };

    let result;

    const savePayload = async (payloadToSave) => {
        if (editingEquipmentId) {
            return supabaseClient
                .from("equipment_vehicles")
                .update(payloadToSave)
                .eq("id", editingEquipmentId)
                .select()
                .single();
        }

        return supabaseClient
            .from("equipment_vehicles")
            .insert({
                ...payloadToSave,
                created_by: currentUserId || null,
                created_by_name: currentWorkerDisplay
            })
            .select()
            .single();
    };

    result = await savePayload(payload);

    if (result.error && String(result.error.message || "").includes("current_km")) {
        const fallbackPayload = { ...payload };
        delete fallbackPayload.current_km;
        result = await savePayload(fallbackPayload);

        if (!result.error) {
            setEquipmentStatus("Equipment saved. Run the updated Supabase vehicle inspection SQL when you want the KM column to save live.");
        }
    }

    if (result.error) {
        setEquipmentStatus("Equipment could not be saved: " + result.error.message, true);
        return;
    }

    if (editingEquipmentId) {
        equipmentItems = equipmentItems.map((item) => item.id === editingEquipmentId ? result.data : item);
    } else {
        equipmentItems.push(result.data);
    }

    clearEquipmentForm();
    renderEquipment();
    await processEquipmentExpiryNotifications();
    setEquipmentStatus("Equipment saved.");
}

async function deleteEquipment(id) {
    const item = equipmentItems.find((entry) => entry.id === id);

    if (!item) {
        alert("Equipment or vehicle could not be found.");
        return;
    }

    if (!confirm("Delete " + item.name + " from Equipment / Vehicles?")) {
        return;
    }

    const { error } = await supabaseClient
        .from("equipment_vehicles")
        .update({
            is_active: false,
            updated_at: new Date().toISOString()
        })
        .eq("id", id);

    if (error) {
        alert("Equipment could not be deleted: " + error.message);
        return;
    }

    equipmentItems = equipmentItems.filter((entry) => entry.id !== id);
    equipmentDocuments = equipmentDocuments.filter((document) => document.equipment_id !== id);
    clearEquipmentForm();
    renderEquipment();
}

async function loadEquipment() {
    setEquipmentStatus("Refreshing equipment...");

    const [equipmentResult, notificationResult, maintenanceResult, documentResult] = await Promise.all([
        supabaseClient.from("equipment_vehicles").select("*").eq("is_active", true).order("name", { ascending: true }),
        supabaseClient.from("equipment_expiry_notifications").select("*").order("created_at", { ascending: false }),
        supabaseClient.from("equipment_maintenance_logs").select("*").order("scheduled_date", { ascending: false }).order("created_at", { ascending: false }),
        supabaseClient.from("equipment_documents").select("*").eq("is_active", true).order("created_at", { ascending: false })
    ]);

    if (equipmentResult.error) {
        setEquipmentStatus("Equipment could not be loaded: " + equipmentResult.error.message, true);
        return;
    }

    equipmentItems = equipmentResult.data || [];
    equipmentNotifications = notificationResult.data || [];
    equipmentMaintenanceLogs = maintenanceResult.data || [];
    equipmentDocuments = documentResult.data || [];

    if (documentResult.error) {
        setEquipmentStatus("Equipment loaded, but lift documents could not be loaded: " + documentResult.error.message, true);
    }
    await processEquipmentExpiryNotifications();
    renderEquipment();
    if (!documentResult.error) {
        setEquipmentStatus("Equipment refreshed.");
    }
}
