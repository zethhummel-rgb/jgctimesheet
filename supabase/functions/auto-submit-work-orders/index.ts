import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const TZ = "America/Toronto";
const WORK_ORDER_EMAIL_SCRIPT_URL = Deno.env.get("WORK_ORDER_EMAIL_SCRIPT_URL") ||
  "https://script.google.com/macros/s/AKfycbzPILTnOSzQcCkA6y5vSLxCH6i05Y2-ZHZAk09Und0YKiXZOYMppV4fvW3G6EgqOIZi/exec";
const WORK_ORDER_EMAIL_RECIPIENTS = (Deno.env.get("WORK_ORDER_EMAIL_RECIPIENTS") ||
  "zeth@johngordonconstruction.com,darlene@johngordonconstruction.com")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const MAX_PER_RUN = Number(Deno.env.get("WORK_ORDER_AUTO_SUBMIT_LIMIT") || 10);
const WORK_ORDER_EMAIL_TIMEOUT_MS = Number(Deno.env.get("WORK_ORDER_EMAIL_TIMEOUT_MS") || 60_000);
const WORK_ORDER_STALE_LOCK_MINUTES = Number(Deno.env.get("WORK_ORDER_STALE_LOCK_MINUTES") || 10);
const WORK_ORDER_RUN_BUDGET_MS = Number(Deno.env.get("WORK_ORDER_RUN_BUDGET_MS") || 120_000);
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type WorkOrder = Record<string, any>;
type WorkOrderBundle = {
  wo: WorkOrder;
  pos: Record<string, any>[];
  labour: Record<string, any>[];
  equipment: Record<string, any>[];
  rentals: Record<string, any>[];
  materials: Record<string, any>[];
  misc: Record<string, any>[];
  travel: Record<string, any>[];
};

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char] || char));
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeWorkerName(value: unknown) {
  return normalizeText(value);
}

function normalizeEmployeeMatchKey(value: unknown) {
  return normalizeWorkerName(value).replace(/[^a-z0-9]/g, "");
}

function normalizeJobNumber(value: unknown) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function moneylessNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function safeFileName(value: unknown) {
  return String(value || "work-order")
    .replace(/[^a-z0-9\-_. ]/gi, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function parseDateParts(value: unknown) {
  const parts = String(value || "").split("-").map(Number);

  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  return { year: parts[0], month: parts[1], day: parts[2] };
}

function formatDateValue(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function dateAtUtcNoon(value: unknown) {
  const parts = parseDateParts(value);

  if (!parts) {
    return null;
  }

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0));
}

function getWeekStartValueForDate(value: unknown) {
  const date = dateAtUtcNoon(value);

  if (!date) {
    return "";
  }

  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return formatDateValue(date);
}

function getDayNameForDate(value: unknown) {
  const date = dateAtUtcNoon(value);
  return date ? DAY_NAMES[date.getUTCDay()] : "";
}

function getFollowingMondayValue(value: unknown) {
  const date = dateAtUtcNoon(value);

  if (!date) {
    return "";
  }

  const daysUntilMonday = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  return formatDateValue(date);
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const zone = parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = zone.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);

  if (!match) {
    return 0;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

function zonedDateTimeToUtc(dateValue: string, hour: number, minute: number) {
  const parts = parseDateParts(dateValue);

  if (!parts) {
    return null;
  }

  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, TZ);
  return new Date(utcGuess.getTime() - offsetMinutes * 60 * 1000);
}

function getWorkOrderGateUtc(wo: WorkOrder) {
  const monday = getFollowingMondayValue(wo.work_order_date);
  return monday ? zonedDateTimeToUtc(monday, 8, 0) : null;
}

function isWorkOrderDue(wo: WorkOrder, now: Date) {
  const gate = getWorkOrderGateUtc(wo);
  return Boolean(gate && now >= gate);
}

function isManualLabourRow(row: Record<string, any>) {
  return String(row?.worker_key || "").startsWith("manual-") ||
    String(row?.notes || "").toLowerCase() === "manual labour entry";
}

function workerMatches(row: Record<string, any>, entry: Record<string, any>) {
  const rowKey = normalizeEmployeeMatchKey(row.worker_key);
  const rowName = normalizeEmployeeMatchKey(row.employee_name);
  const entryWorker = normalizeEmployeeMatchKey(entry.worker_name || entry.user || entry.employee_name);

  return Boolean(entryWorker) && (
    Boolean(rowKey && entryWorker === rowKey) ||
    Boolean(rowName && entryWorker === rowName) ||
    Boolean(rowName && entryWorker.length > 2 && rowName.includes(entryWorker)) ||
    Boolean(rowName && rowName.length > 2 && entryWorker.includes(rowName))
  );
}

function jobMatches(wo: WorkOrder, entry: Record<string, any>) {
  const normalizedJob = normalizeJobNumber(wo.job_number);
  const normalizedJobName = normalizeText(wo.job_name);
  const entryJobNumber = normalizeJobNumber(entry.job_number || entry.jobNumber);
  const entryJobName = normalizeText(entry.job_name || entry.jobName);

  return normalizedJob
    ? entryJobNumber === normalizedJob || (!entryJobNumber && entryJobName === normalizedJobName)
    : entryJobName === normalizedJobName;
}

function normalizeArchivedTimesheetEntry(week: Record<string, any>, entry: Record<string, any>, index: number) {
  return {
    id: entry.id || `${week.id || "archived"}-${index}`,
    worker_name: entry.worker_name || entry.user || entry.employee_name || week.worker_name || "",
    week_start: entry.week_start || entry.weekStartValue || entry.weekStart || "",
    job_name: entry.job_name || entry.jobName || "",
    job_number: entry.job_number || entry.jobNumber || "",
    day_of_week: entry.day_of_week || entry.day || "",
    hours: entry.hours || 0,
    entry_type: entry.entry_type || entry.entryType || "work",
    archived: true,
  };
}

async function loadTimesheetEntriesForWorkOrderDate(db: any, weekStart: string, dayName: string) {
  const [liveResult, archiveResult] = await Promise.all([
    db
      .from("timesheet_entries")
      .select("id,worker_name,week_start,job_name,job_number,day_of_week,hours,entry_type")
      .eq("week_start", weekStart)
      .eq("day_of_week", dayName),
    db
      .from("previous_timesheet_weeks")
      .select("id,worker_name,entries,submitted_at")
      .order("submitted_at", { ascending: false })
      .limit(1000),
  ]);

  if (liveResult.error || archiveResult.error) {
    throw new Error((liveResult.error || archiveResult.error).message);
  }

  const archivedEntries: Record<string, any>[] = [];
  for (const week of archiveResult.data || []) {
    const entries = Array.isArray(week.entries) ? week.entries : [];
    entries.forEach((entry: Record<string, any>, index: number) => {
      const normalized = normalizeArchivedTimesheetEntry(week, entry, index);

      if (
        normalized.week_start === weekStart &&
        normalizeText(normalized.day_of_week) === normalizeText(dayName)
      ) {
        archivedEntries.push(normalized);
      }
    });
  }

  return (liveResult.data || []).concat(archivedEntries);
}

async function loadBundle(db: any, wo: WorkOrder): Promise<WorkOrderBundle> {
  const id = wo.id;
  const [pos, labour, equipment, rentals, materials, misc, travel] = await Promise.all([
    db.from("work_order_purchase_orders").select("*").eq("work_order_id", id).order("sort_order", { ascending: true }),
    db.from("work_order_labour").select("*").eq("work_order_id", id).order("employee_name", { ascending: true }),
    db.from("work_order_equipment").select("*").eq("work_order_id", id),
    db.from("work_order_rentals").select("*").eq("work_order_id", id),
    db.from("work_order_materials").select("*").eq("work_order_id", id),
    db.from("work_order_misc_invoices").select("*").eq("work_order_id", id),
    db.from("work_order_travel").select("*").eq("work_order_id", id),
  ]);

  const errors = [pos, labour, equipment, rentals, materials, misc, travel]
    .map((result) => result.error)
    .filter(Boolean);

  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }

  return {
    wo,
    pos: pos.data || [],
    labour: labour.data || [],
    equipment: equipment.data || [],
    rentals: rentals.data || [],
    materials: materials.data || [],
    misc: misc.data || [],
    travel: travel.data || [],
  };
}

async function refreshLabourFromTimesheets(db: any, bundle: WorkOrderBundle) {
  const weekStart = getWeekStartValueForDate(bundle.wo.work_order_date);
  const dayName = getDayNameForDate(bundle.wo.work_order_date);

  if (!weekStart || !dayName) {
    return;
  }

  const entries = await loadTimesheetEntriesForWorkOrderDate(db, weekStart, dayName);
  const updates: Record<string, any>[] = [];

  for (const row of bundle.labour) {
    if (isManualLabourRow(row)) {
      continue;
    }

    const matches = entries.filter((entry: Record<string, any>) =>
      normalizeText(entry.entry_type || "work") === "work" &&
      workerMatches(row, entry) &&
      jobMatches(bundle.wo, entry)
    );
    const hours = matches.reduce((total: number, entry: Record<string, any>) => total + Number(entry.hours || 0), 0);
    const next = {
      matched_timesheet_entry_id: matches[0]?.id || null,
      hours,
      complete: hours > 0,
      notes: matches.length > 1 ? `${matches.length} matching entries` : row.notes || "",
      updated_at: new Date().toISOString(),
    };

    if (
      String(row.matched_timesheet_entry_id || "") !== String(next.matched_timesheet_entry_id || "") ||
      Number(row.hours || 0) !== Number(next.hours || 0) ||
      Boolean(row.complete) !== Boolean(next.complete) ||
      String(row.notes || "") !== String(next.notes || "")
    ) {
      updates.push({ ...row, ...next });
    }
  }

  if (!updates.length) {
    return;
  }

  await Promise.all(updates.map((row) => db
    .from("work_order_labour")
    .update({
      matched_timesheet_entry_id: row.matched_timesheet_entry_id,
      hours: row.hours,
      complete: row.complete,
      notes: row.notes,
      updated_at: row.updated_at,
    })
    .eq("id", row.id)));

  bundle.labour = bundle.labour.map((row) => updates.find((updated) => updated.id === row.id) || row);
}

function getWorkOrderCompleteness(bundle: WorkOrderBundle) {
  const waitingFor: string[] = [];
  const requiredFields = [
    ["WO Number", bundle.wo.wo_number],
    ["Date", bundle.wo.work_order_date],
    ["Job Number", bundle.wo.job_number],
    ["Job Name", bundle.wo.job_name],
    ["Description of Work", bundle.wo.description_of_work],
  ];

  for (const [label, value] of requiredFields) {
    if (!String(value || "").trim()) {
      waitingFor.push(label);
    }
  }

  if (!bundle.labour.length) {
    waitingFor.push("Labour selection");
  }

  for (const row of bundle.labour.filter((item) => !item.complete)) {
    waitingFor.push((row.employee_name || "Employee") + " Timesheet");
  }

  const labourComplete = bundle.labour.length > 0 && bundle.labour.every((row) => row.complete);
  return {
    complete: waitingFor.length === 0 && labourComplete,
    labourComplete,
    waitingFor,
  };
}

function buildPdfRows(rows: Record<string, any>[], emptyText: string, cellsBuilder: (row: Record<string, any>) => unknown[]) {
  if (!rows.length) {
    return '<tr><td colspan="10" class="empty">' + escapeHtml(emptyText) + "</td></tr>";
  }

  return rows.map((row) => "<tr>" + cellsBuilder(row).map((cell) => "<td>" + escapeHtml(cell) + "</td>").join("") + "</tr>").join("");
}

function buildOptionalPdfSection(title: string, rows: Record<string, any>[], headers: string[], cellsBuilder: (row: Record<string, any>) => unknown[]) {
  if (!rows.length) {
    return "";
  }

  return `
  <h2>${escapeHtml(title)}</h2>
  <table>
    <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => "<tr>" + cellsBuilder(row).map((cell) => "<td>" + escapeHtml(cell) + "</td>").join("") + "</tr>").join("")}</tbody>
  </table>`;
}

function getStatusLabel(status: unknown) {
  if (status === "ready_for_submission") {
    return "Ready For Submission";
  }
  return String(status || "draft").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildWorkOrderPdfHtml(bundle: WorkOrderBundle) {
  const { wo, pos, labour, equipment, rentals, materials, misc, travel } = bundle;
  const totalLabour = labour.reduce((total, row) => total + Number(row.hours || 0), 0);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHtml(wo.wo_number || "Work Order")}</title>
<style>
  @page { size: letter; margin: 0.45in; }
  body { font-family: Arial, sans-serif; color: #111; margin: 0; font-size: 12px; }
  h1 { color: #0b5e3b; margin: 0; font-size: 25px; text-align: center; }
  h2 { color: #0b5e3b; border-bottom: 2px solid #0b5e3b; padding-bottom: 3px; margin: 18px 0 8px; font-size: 16px; }
  .brand { text-align: center; font-weight: bold; color: #0b5e3b; letter-spacing: 1px; margin-bottom: 8px; }
  .summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0; border: 2px solid #111; margin-top: 12px; }
  .summary div { border: 1px solid #111; padding: 7px; min-height: 30px; }
  .summary b { display: block; font-size: 10px; text-transform: uppercase; color: #333; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; page-break-inside: auto; }
  th, td { border: 1px solid #111; padding: 5px; vertical-align: top; }
  th { background: #e9f2e8; color: #111; text-align: left; }
  .description { border: 1px solid #111; min-height: 70px; padding: 8px; white-space: pre-wrap; }
  .empty { color: #555; font-style: italic; }
  .totals { font-weight: bold; background: #f3f7f2; }
  .signatures { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; margin-top: 34px; }
  .line { border-top: 1px solid #111; padding-top: 5px; }
</style>
</head>
<body>
  <div class="brand">JOHN GORDON CONSTRUCTION</div>
  <h1>Work Order</h1>
  <div class="summary">
    <div><b>WO Number</b>${escapeHtml(wo.wo_number || "")}</div>
    <div><b>Date</b>${escapeHtml(wo.work_order_date || "")}</div>
    <div><b>Attention</b>${escapeHtml(wo.customer || "")}</div>
    <div><b>Customer PO #</b>${escapeHtml(wo.customer_po_number || "")}</div>
    <div><b>Job Number</b>${escapeHtml(wo.job_number || "")}</div>
    <div><b>Job Name</b>${escapeHtml(wo.job_name || "")}</div>
    <div><b>Job Address</b>${escapeHtml(wo.job_address || "")}</div>
    <div><b>Supervisor</b>${escapeHtml(wo.supervisor_name || wo.created_by_name || "")}</div>
  </div>

  <h2>Description of Work Completed Today</h2>
  <div class="description">${escapeHtml(wo.description_of_work || "")}</div>

  <h2>Labour</h2>
  <table>
    <thead><tr><th>Employee</th><th>Hours</th></tr></thead>
    <tbody>
      ${buildPdfRows(labour, "No labour rows entered.", (row) => [row.employee_name || "", moneylessNumber(row.hours)])}
      <tr class="totals"><td>Total Labour Hours</td><td>${moneylessNumber(totalLabour)}</td></tr>
    </tbody>
  </table>

  ${buildOptionalPdfSection("Purchase Orders", pos, ["PO Number", "Company", "Notes"], (row) => [row.po_number || "", row.company_name || "", row.notes || ""])}
  ${buildOptionalPdfSection("Materials Used From Shop", materials, ["Shop", "Material Description", "Quantity"], (row) => [row.purchased_from || "", row.material_description || "", String(row.quantity || "")])}
  ${buildOptionalPdfSection("Misc. Invoices and Sub Contractors", misc, ["Name"], (row) => [row.invoice_name || ""])}
  ${buildOptionalPdfSection("Travelling", travel, ["Vehicle", "Identification #", "Total KM", "Trailer", "Trailer ID #"], (row) => [
    row.vehicle_name || "",
    row.identification_number || "",
    String(row.total_km || ""),
    row.trailer_used ? row.trailer_name || "Trailer used" : "",
    row.trailer_used ? row.trailer_identification_number || "" : "",
  ])}
  ${buildOptionalPdfSection("Equipment Used", equipment, ["Lift", "Identification #", "Floated By Tow Truck"], (row) => [
    row.equipment_name || "",
    row.identification_number || "",
    row.transportation_required ? "Yes" : "No",
  ])}
  ${buildOptionalPdfSection("Rental Equipment", rentals, ["Rental Equipment", "PO #", "Company", "Quantity", "Hours", "Days", "Notes"], (row) => [
    row.rental_equipment_description || "",
    row.po_number || "",
    row.rental_company || "",
    String(row.quantity || ""),
    String(row.hours_used || ""),
    String(row.days_used || ""),
    row.notes || "",
  ])}
  ${wo.notes ? '<h2>Notes</h2><div class="description">' + escapeHtml(wo.notes) + "</div>" : ""}

  <div class="signatures">
    <div class="line">Supervisor Signature</div>
    <div class="line">Client Signature</div>
  </div>
</body>
</html>`;
}

function buildWorkOrderEmailBody(bundle: WorkOrderBundle) {
  const { wo, labour, equipment, rentals, materials, misc, travel } = bundle;
  const totalLabour = labour.reduce((total, row) => total + Number(row.hours || 0), 0);

  return [
    "JGC Work Order Submission",
    "",
    "WO Number: " + (wo.wo_number || ""),
    "Date: " + (wo.work_order_date || ""),
    "Attention: " + (wo.customer || ""),
    "Customer PO #: " + (wo.customer_po_number || ""),
    "Job: " + [wo.job_number, wo.job_name].filter(Boolean).join(" - "),
    "Status: " + getStatusLabel(wo.status),
    "Labour Hours: " + totalLabour.toFixed(2),
    "Equipment Rows: " + equipment.length,
    "Rental Rows: " + rentals.length,
    "Material Rows: " + materials.length,
    "Misc. Invoice / Sub Contractor Rows: " + misc.length,
    "Travel Rows: " + travel.length,
    wo.notes ? "Notes: " + wo.notes : "",
    "",
    "See attached Work Order PDF.",
  ].filter((line) => line !== "").join("\n");
}

async function sendWorkOrderEmail(bundle: WorkOrderBundle) {
  const subject = "JGC Work Order " + (bundle.wo.wo_number || "") + " - " +
    [bundle.wo.job_number, bundle.wo.job_name].filter(Boolean).join(" - ");
  const body = buildWorkOrderEmailBody(bundle);
  const pdfHtml = buildWorkOrderPdfHtml(bundle);
  const response = await fetch(WORK_ORDER_EMAIL_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    signal: AbortSignal.timeout(WORK_ORDER_EMAIL_TIMEOUT_MS),
    body: JSON.stringify({
      to: WORK_ORDER_EMAIL_RECIPIENTS.join(","),
      subject,
      body,
      text: body,
      pdfHtml,
      pdfFileName: safeFileName(subject) + ".pdf",
      source: "work_order_auto_submit",
      idempotencyKey: `jgc-work-order-submit-${bundle.wo.id}`,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Email script failed with ${response.status}. ${text}`.trim());
  }
}

async function recoverStaleWorkOrderClaims(db: any, now: Date, targetWorkOrderId = "") {
  const staleBefore = new Date(now.getTime() - WORK_ORDER_STALE_LOCK_MINUTES * 60_000).toISOString();
  const recoveredAt = now.toISOString();
  let recoveryQuery = db
    .from("work_orders")
    .update({
      locked: false,
      updated_at: recoveredAt,
    })
    .in("status", ["draft", "ready_for_submission"])
    .eq("locked", true)
    .is("submitted_at", null)
    .lt("updated_at", staleBefore);

  if (targetWorkOrderId) {
    recoveryQuery = recoveryQuery.eq("id", targetWorkOrderId);
  }

  const { data, error } = await recoveryQuery.select("id,wo_number");

  if (error) {
    throw new Error(`Stale work order claims could not be recovered: ${error.message}`);
  }

  if (data?.length) {
    console.warn("Recovered stale work order submission claims.", data.map((row: WorkOrder) => row.wo_number));
  }

  return data || [];
}

async function processWorkOrder(db: any, wo: WorkOrder, now: Date) {
  const bundle = await loadBundle(db, wo);
  await refreshLabourFromTimesheets(db, bundle);
  const check = getWorkOrderCompleteness(bundle);

  if (!check.complete) {
    await db
      .from("work_orders")
      .update({
        labour_complete: check.labourComplete,
        waiting_for: check.waitingFor,
        updated_at: now.toISOString(),
      })
      .eq("id", wo.id);

    return { id: wo.id, wo_number: wo.wo_number, status: "waiting", waiting_for: check.waitingFor };
  }

  if (!isWorkOrderDue(wo, now)) {
    await db
      .from("work_orders")
      .update({
        labour_complete: true,
        waiting_for: [],
        updated_at: now.toISOString(),
      })
      .eq("id", wo.id);

    return { id: wo.id, wo_number: wo.wo_number, status: "pending_8am" };
  }

  const { data: claimed, error: claimError } = await db
    .from("work_orders")
    .update({
      locked: true,
      updated_at: now.toISOString(),
    })
    .eq("id", wo.id)
    .in("status", ["draft", "ready_for_submission"])
    .or("locked.is.false,locked.is.null")
    .select("id");

  if (claimError) {
    throw new Error(claimError.message);
  }

  if (!claimed || !claimed.length) {
    return { id: wo.id, wo_number: wo.wo_number, status: "already_claimed" };
  }

  try {
    await sendWorkOrderEmail(bundle);
  } catch (error) {
    await db
      .from("work_orders")
      .update({
        locked: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", wo.id);

    throw error;
  }

  const submittedAt = new Date().toISOString();
  const { error } = await db
    .from("work_orders")
    .update({
      status: "submitted",
      labour_complete: true,
      waiting_for: [],
      locked: true,
      submitted_at: submittedAt,
      updated_at: submittedAt,
    })
    .eq("id", wo.id);

  if (error) {
    throw new Error(error.message);
  }

  return { id: wo.id, wo_number: wo.wo_number, status: "submitted" };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ success: false, error: "Use POST." }, { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ success: false, error: "Missing Supabase function environment variables." }, { status: 500 });
  }

  const db = createClient(supabaseUrl, serviceRoleKey);
  const now = new Date();
  const runStartedAt = Date.now();
  const requestBody = await req.json().catch(() => ({}));
  const targetWorkOrderId = String(requestBody?.work_order_id || "").trim();

  if (targetWorkOrderId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetWorkOrderId)) {
    return Response.json({ success: false, error: "work_order_id must be a valid UUID." }, { status: 400 });
  }

  let recoveredClaims: WorkOrder[] = [];

  try {
    recoveredClaims = await recoverStaleWorkOrderClaims(db, now, targetWorkOrderId);
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }

  let workOrderQuery = db
    .from("work_orders")
    .select("*")
    .eq("status", "ready_for_submission")
    .or("locked.is.false,locked.is.null")
    .order("work_order_date", { ascending: true });

  if (targetWorkOrderId) {
    workOrderQuery = workOrderQuery.eq("id", targetWorkOrderId);
  }

  const { data: workOrders, error } = await workOrderQuery.limit(targetWorkOrderId ? 1 : MAX_PER_RUN);

  if (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }

  const results: Record<string, any>[] = [];
  const failures: Record<string, any>[] = [];
  const deferred: Record<string, any>[] = [];

  for (const wo of (workOrders || []) as WorkOrder[]) {
    const remainingBudget = WORK_ORDER_RUN_BUDGET_MS - (Date.now() - runStartedAt);
    if (remainingBudget < WORK_ORDER_EMAIL_TIMEOUT_MS + 10_000) {
      deferred.push({ id: wo.id, wo_number: wo.wo_number, status: "deferred_for_next_run" });
      continue;
    }

    try {
      results.push(await processWorkOrder(db, wo, now));
    } catch (error) {
      const failure = {
        id: wo.id,
        wo_number: wo.wo_number,
        error: error instanceof Error ? error.message : String(error),
      };
      failures.push(failure);
      console.error("Work order auto-submission failed.", failure);
    }
  }

  return Response.json({
    success: failures.length === 0,
    target_work_order_id: targetWorkOrderId || null,
    checked: (workOrders || []).length,
    recovered_claims: recoveredClaims.map((wo) => ({ id: wo.id, wo_number: wo.wo_number })),
    results,
    failures,
    deferred,
  }, { status: failures.length ? 207 : 200 });
});
