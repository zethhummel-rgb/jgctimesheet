import { createDefaultState, normalizeAppState, type AppState, type Job, type Vendor, type VendorContact } from "../lib/estimator-data";
import type { SupplierCatalogItemRecord, SupplierCatalogSearchResponse, SupplierImportApplyMetadata } from "../lib/supplier-catalog-types";
import { normalizeMaterialName } from "../lib/material-price-workbook";
import { normalizeSupplierSku } from "../lib/supplier-price-parser";
import { mergeConcurrentEstimatorState } from "../lib/estimator-state-sync";

type SupabaseResult<T> = { data: T | null; error: { message?: string } | null; count?: number | null };

export interface PortalJobOption {
  id: string;
  jobNumber: string;
  jobName: string;
  customer: string;
  address: string;
  jobType: string;
  projectManager: string;
  startDate: string;
  targetEndDate: string;
  active: boolean;
  documentLink?: string;
  documentLinkLabel?: string;
}

export interface PortalLabourActual {
  portalJobId: string;
  jobNumber: string;
  workerProfileId: string | null;
  workerName: string;
  sourceStatus: "submitted" | "provisional";
  firstWorkDate: string;
  lastWorkDate: string;
  hours: number;
  loadedLabourCost: number;
  missingRateHours: number;
}

export interface PortalJobStatistics {
  portalJobId: string;
  jobNumber: string;
  generatedAt: string;
  totalHours: number;
  employeeCount: number;
  digitalPoCount: number;
  dailyReportCount: number;
  inspectionCount: number;
  workOrderCount: number;
  equipmentCount: number;
  hoursByWeek: Array<{ label: string; startDate: string; hours: number }>;
  hoursByEmployee: Array<{ label: string; hours: number }>;
  onsiteByDay: Array<{ date: string; employees: number; hours: number }>;
  digitalPurchaseOrders: Array<{ id: string; number: string; supplier: string; date: string; status: string }>;
  dailyReports: Array<{ id: string; date: string; worker: string }>;
  inspections: Array<{ id: string; type: string; title: string; date: string; worker: string }>;
  workOrders: Array<{ id: string; number: string; date: string; status: string }>;
  equipment: Array<{ id: string; name: string; identifier: string; kind: string; workOrderNumber: string }>;
  schedule: Array<{ id: string; date: string; title: string; type: string }>;
}

interface PortalBridgeWindow extends Window {
  createJgcSupabaseClient?: () => any;
  JGC_ESTIMATOR_PORTAL_JOBS?: PortalJobOption[];
}

const bridgeWindow = window as PortalBridgeWindow;
const STATE_ID = "main";
let stateRevision = 0;
let stateBase: AppState | null = null;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function createConnectedInitialState(): AppState {
  const seeded = createDefaultState();
  return {
    ...seeded,
    settings: { ...seeded.settings, nextQuoteNumber: 1 },
    clients: [],
    vendors: [],
    quotes: [],
    jobs: [],
    activity: [],
  };
}

function dollars(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function catalogRecord(row: Record<string, any>): SupplierCatalogItemRecord {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierSku: row.supplier_sku,
    productName: row.product_name,
    rawDescription: row.raw_description,
    rawUnit: row.raw_unit,
    unit: row.unit,
    division: row.division,
    listPrice: row.list_price === null ? null : dollars(row.list_price),
    netCost: dollars(row.net_cost),
    effectiveDate: row.effective_date,
    validUntil: row.valid_until ?? "",
    active: Boolean(row.active),
    latestImportId: row.latest_import_id,
    lastSeenAt: row.last_seen_at,
  };
}

function portalContact(row: Record<string, any>): VendorContact {
  return {
    id: `portal-contact-${row.id}`,
    portalRecordId: row.id,
    name: row.contact_name ?? "",
    role: row.role ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    notes: row.notes ?? "",
    active: row.is_active !== false,
  };
}

function portalVendor(row: Record<string, any>, contactRows: Record<string, any>[] = []): Vendor {
  const contacts = contactRows.map(portalContact);
  const firstContact = contacts.find((contact) => contact.active) ?? contacts[0];
  const mainContact = contacts.find((contact) =>
    String(contact.name).trim().toLocaleLowerCase() === String(row.contact_name ?? "").trim().toLocaleLowerCase() &&
    (!row.email || String(contact.email).trim().toLocaleLowerCase() === String(row.email).trim().toLocaleLowerCase())
  );
  return {
    id: `portal-${row.id}`,
    portalRecordId: row.id,
    portalActive: Boolean(row.is_active),
    portalLastSyncedAt: new Date().toISOString(),
    name: row.company_name ?? "",
    trade: row.service_type ?? "",
    category: "Subcontractor",
    contact: row.contact_name ?? firstContact?.name ?? "",
    email: row.email ?? firstContact?.email ?? "",
    phone: row.phone ?? firstContact?.phone ?? "",
    status: row.is_active ? "Active" : "Inactive",
    notes: row.notes ?? "",
    contacts,
    mainContactId: mainContact?.id ?? null,
    demo: false,
  };
}

async function loadPortalVendors(client: any) {
  const [vendorsResult, contactsResult] = await Promise.all([
    client
      .from("subcontractors_suppliers")
      .select("id,company_name,category,service_type,contact_name,phone,email,notes,is_active")
      .eq("category", "Subcontractor")
      .order("company_name"),
    client
      .from("subcontractor_supplier_contacts")
      .select("id,company_id,contact_name,role,phone,email,notes,sort_order,is_active")
      .order("sort_order")
      .order("contact_name"),
  ]);
  if (vendorsResult.error) throw new Error(vendorsResult.error.message || "Portal subcontractors could not be loaded.");
  if (contactsResult.error) throw new Error(contactsResult.error.message || "Portal subcontractor contacts could not be loaded.");
  const contactsByCompany = new Map<string, Record<string, any>[]>();
  for (const contact of contactsResult.data ?? []) {
    const list = contactsByCompany.get(contact.company_id) ?? [];
    list.push(contact);
    contactsByCompany.set(contact.company_id, list);
  }
  return (vendorsResult.data ?? []).map((row: Record<string, any>) => portalVendor(row, contactsByCompany.get(row.id) ?? []));
}

function portalJobOption(row: Record<string, any>): PortalJobOption {
  return {
    id: String(row.id ?? ""),
    jobNumber: String(row.job_number ?? ""),
    jobName: String(row.job_name ?? ""),
    customer: String(row.customer ?? ""),
    address: String(row.address ?? ""),
    jobType: String(row.job_type ?? ""),
    projectManager: String(row.project_manager ?? ""),
    startDate: String(row.start_date ?? ""),
    targetEndDate: String(row.target_end_date ?? ""),
    active: Boolean(row.active),
    documentLink: String(row.document_link ?? ""),
    documentLinkLabel: String(row.document_link_label ?? ""),
  };
}

async function loadPortalReferences(client: any) {
  const [vendors, jobsResult] = await Promise.all([
    loadPortalVendors(client),
    client
      .from("jobs")
      .select("id,job_number,job_name,customer,address,job_type,project_manager,start_date,target_end_date,active,document_link,document_link_label")
      .order("job_number", { ascending: false }),
  ]);
  if (jobsResult.error) throw new Error(jobsResult.error.message || "Portal jobs could not be loaded.");
  const portalJobs: PortalJobOption[] = (jobsResult.data ?? []).map(portalJobOption);
  bridgeWindow.JGC_ESTIMATOR_PORTAL_JOBS = portalJobs;
  return { vendors, portalJobs };
}

function vendorPayload(body: Record<string, any>) {
  return {
    company_name: String(body.name ?? "").trim(),
    category: "Subcontractor",
    service_type: String(body.trade ?? "").trim(),
    contact_name: String(body.contact ?? "").trim(),
    phone: String(body.phone ?? "").trim(),
    email: String(body.email ?? "").trim(),
    notes: String(body.notes ?? "").trim(),
    is_active: body.status !== "Inactive",
    updated_at: new Date().toISOString(),
  };
}

async function vendorsResponse(client: any) {
  return json({ vendors: await loadPortalVendors(client) });
}

async function jobCostingResponse(client: any) {
  const result = await client.rpc("get_estimator_job_labour_actuals");
  if (result.error) {
    const restricted = result.error.code === "42501";
    return json({
      error: restricted
        ? "Approved administrator access is required to view employee labour costs."
        : result.error.message || "Portal labour costs could not be loaded.",
      restricted,
    }, restricted ? 403 : 500);
  }
  const actuals: PortalLabourActual[] = (result.data ?? []).map((row: Record<string, any>) => ({
    portalJobId: String(row.portal_job_id ?? ""),
    jobNumber: String(row.job_number ?? ""),
    workerProfileId: row.worker_profile_id ? String(row.worker_profile_id) : null,
    workerName: String(row.worker_name ?? "Unknown employee"),
    sourceStatus: row.source_status === "provisional" ? "provisional" : "submitted",
    firstWorkDate: String(row.first_work_date ?? ""),
    lastWorkDate: String(row.last_work_date ?? ""),
    hours: dollars(row.hours),
    loadedLabourCost: dollars(row.loaded_labour_cost),
    missingRateHours: dollars(row.missing_rate_hours),
  }));
  return json({ actuals, loadedAt: new Date().toISOString() });
}

function cleanPortalText(value: unknown, maxLength = 300) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function cleanPortalDate(value: unknown, label: string) {
  const date = cleanPortalText(value, 10);
  if (!date) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`${label} must be a valid date.`);
  }
  return date;
}

async function mutatePortalJobInfo(client: any, request: Request) {
  if (request.method !== "PATCH") return json({ error: "This job information action is not supported." }, 405);
  const body = await request.json() as Record<string, any>;
  const portalJobId = cleanPortalText(body.portalJobId, 100);
  if (!portalJobId) return json({ error: "This estimator job is not linked to a Portal job." }, 400);

  const payload: Record<string, any> = { updated_at: new Date().toISOString() };
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
  if (has("jobName")) {
    const jobName = cleanPortalText(body.jobName, 150);
    if (!jobName) return json({ error: "The official Portal job name cannot be blank." }, 400);
    payload.job_name = jobName;
  }
  if (has("customer")) payload.customer = cleanPortalText(body.customer, 200) || null;
  if (has("address")) payload.address = cleanPortalText(body.address, 500) || null;
  if (has("jobType")) payload.job_type = cleanPortalText(body.jobType, 60) || null;
  if (has("projectManager")) payload.project_manager = cleanPortalText(body.projectManager, 150) || null;
  if (has("startDate")) payload.start_date = cleanPortalDate(body.startDate, "Start date") || null;
  if (has("targetEndDate")) payload.target_end_date = cleanPortalDate(body.targetEndDate, "Target end date") || null;
  if (Object.keys(payload).length === 1) return json({ error: "No job information was provided." }, 400);

  if (payload.start_date && payload.target_end_date && payload.target_end_date < payload.start_date) {
    return json({ error: "The target end date cannot be before the start date." }, 400);
  }

  const result = await client
    .from("jobs")
    .update(payload)
    .eq("id", portalJobId)
    .select("id,job_number,job_name,customer,address,job_type,project_manager,start_date,target_end_date,active,document_link,document_link_label")
    .single();
  if (result.error) throw new Error(result.error.message || "The Portal job information could not be saved.");
  const job = portalJobOption(result.data);
  bridgeWindow.JGC_ESTIMATOR_PORTAL_JOBS = (bridgeWindow.JGC_ESTIMATOR_PORTAL_JOBS ?? [])
    .map((item) => item.id === job.id ? job : item);
  return json({ saved: true, job });
}

function roundPortalHours(value: unknown) {
  return Math.round(dollars(value) * 100) / 100;
}

function portalRecordDate(value: unknown) {
  return cleanPortalText(value, 30).slice(0, 10);
}

function portalDayOffset(value: unknown) {
  return ({ sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 } as Record<string, number>)[cleanPortalText(value, 12).toLowerCase()] ?? 0;
}

function addPortalDays(value: unknown, days: number) {
  const date = portalRecordDate(value);
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function portalWeekStart(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!value || Number.isNaN(parsed.getTime())) return "";
  parsed.setUTCDate(parsed.getUTCDate() - parsed.getUTCDay());
  return parsed.toISOString().slice(0, 10);
}

function portalWeekLabel(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!value || Number.isNaN(parsed.getTime())) return "Week not available";
  return `Week of ${parsed.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

function portalDisplayStatus(value: unknown) {
  const text = cleanPortalText(value, 80).replace(/[_-]+/g, " ");
  return text ? text.replace(/\b\w/g, (character) => character.toUpperCase()) : "Draft";
}

function portalDigitalPoStatus(row: Record<string, any>) {
  const workflowStatus = cleanPortalText(row.workflow_status, 80).toLowerCase();
  const emailStatus = cleanPortalText(row.email_status, 80).toLowerCase();
  if (workflowStatus === "submitted" && ["not_ready", "pending", "sending"].includes(emailStatus)) return "Pending Submission";
  if (workflowStatus === "submitted" && emailStatus === "emailed") return "Submitted";
  return portalDisplayStatus(workflowStatus || emailStatus || "draft");
}

function uniquePortalRows(rows: Record<string, any>[]) {
  const records = new Map<string, Record<string, any>>();
  for (const row of rows) records.set(String(row.id ?? JSON.stringify(row)), row);
  return [...records.values()];
}

const PORTAL_STATISTICS_PAGE_SIZE = 500;
const PORTAL_STATISTICS_ID_CHUNK_SIZE = 100;
const PORTAL_STATISTICS_MAX_PAGES = 10_000;
const PORTAL_STATISTICS_MAX_ROWS = 250_000;

type PortalRowsResult = {
  data: Record<string, any>[];
  error: { code?: string; message?: string } | null;
};

async function loadPortalStatisticPages(queryFactory: () => any): Promise<PortalRowsResult> {
  const data: Record<string, any>[] = [];
  const seenIds = new Set<string>();
  let from = 0;
  let expectedCount: number | null = null;

  for (let pageNumber = 0; pageNumber < PORTAL_STATISTICS_MAX_PAGES; pageNumber += 1) {
    const page = await queryFactory().range(from, from + PORTAL_STATISTICS_PAGE_SIZE - 1);
    if (page.error) return { data: [], error: page.error };
    const rows = Array.isArray(page.data) ? page.data : [];
    if (expectedCount === null && Number.isFinite(page.count)) expectedCount = Number(page.count);
    if ((expectedCount !== null && expectedCount > PORTAL_STATISTICS_MAX_ROWS) || data.length + rows.length > PORTAL_STATISTICS_MAX_ROWS) {
      return { data: [], error: { code: "PORTAL_STATISTICS_LIMIT", message: "This job has too many Portal records to total safely." } };
    }
    for (const row of rows) {
      const id = cleanPortalText(row.id, 150);
      if (id && seenIds.has(id)) {
        return { data: [], error: { code: "PORTAL_STATISTICS_PAGINATION", message: "Portal record pagination did not advance safely." } };
      }
      if (id) seenIds.add(id);
    }
    data.push(...rows);
    if (!rows.length || (expectedCount !== null ? data.length >= expectedCount : rows.length < PORTAL_STATISTICS_PAGE_SIZE)) {
      return { data, error: null };
    }
    from += rows.length;
  }
  return { data: [], error: { code: "PORTAL_STATISTICS_PAGINATION", message: "Portal record pagination exceeded its safe page limit." } };
}

async function loadPortalStatisticIdChunks(ids: string[], queryFactory: (chunk: string[]) => any): Promise<PortalRowsResult> {
  const uniqueIds = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const data: Record<string, any>[] = [];
  for (let index = 0; index < uniqueIds.length; index += PORTAL_STATISTICS_ID_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(index, index + PORTAL_STATISTICS_ID_CHUNK_SIZE);
    const result = await loadPortalStatisticPages(() => queryFactory(chunk));
    if (result.error) return result;
    if (data.length + result.data.length > PORTAL_STATISTICS_MAX_ROWS) {
      return { data: [], error: { code: "PORTAL_STATISTICS_LIMIT", message: "This job has too many related Portal records to total safely." } };
    }
    data.push(...result.data);
  }
  return { data, error: null };
}

async function jobStatisticsResponse(client: any, request: Request, url: URL) {
  if (request.method !== "GET") return json({ error: "Job statistics are read-only." }, 405);
  const portalJobId = cleanPortalText(url.searchParams.get("portalJobId"), 100);
  if (!portalJobId) return json({ error: "A linked Portal job is required." }, 400);

  const jobResult = await client
    .from("jobs")
    .select("id,job_number,job_name")
    .eq("id", portalJobId)
    .single();
  if (jobResult.error) {
    const restricted = jobResult.error.code === "42501";
    return json({ error: restricted ? "Approved administrator access is required to view job statistics." : jobResult.error.message || "The Portal job could not be loaded.", restricted }, restricted ? 403 : 500);
  }

  const jobNumber = cleanPortalText(jobResult.data.job_number, 100);
  const jobName = cleanPortalText(jobResult.data.job_name, 200);
  if (!jobNumber) return json({ error: "The linked Portal job is missing its official job number." }, 409);
  const jobDisplay = [jobNumber, jobName].filter(Boolean).join(" - ");
  const reportProjects = [...new Set([jobNumber, jobDisplay].filter(Boolean))];

  const [submittedResult, liveResult, digitalPoResult, dailyResult, inspectionResult, workOrdersByIdResult, legacyWorkOrdersResult, scheduleByIdResult, legacyScheduleResult] = await Promise.all([
    loadPortalStatisticPages(() => client.from("accounting_time_entries").select("id,source_entry_key,profile_id,worker_name,work_date,payable_hours", { count: "exact" }).eq("job_id", portalJobId).eq("is_current", true).eq("entry_type", "work").gt("payable_hours", 0).order("work_date", { ascending: true }).order("id", { ascending: true })),
    loadPortalStatisticPages(() => client.from("timesheet_entries").select("id,profile_id,worker_name,week_start,day_of_week,hours", { count: "exact" }).eq("job_number", jobNumber).eq("entry_type", "work").gt("hours", 0).order("week_start", { ascending: true }).order("id", { ascending: true })),
    loadPortalStatisticPages(() => client.from("digital_purchase_orders").select("id,po_number,supplier_name,order_date,workflow_status,email_status,created_at", { count: "exact" }).eq("job_id", portalJobId).order("order_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false })),
    loadPortalStatisticPages(() => client.from("daily_site_reports").select("id,report_date,worker_display_name,worker_name,created_at", { count: "exact" }).in("project", reportProjects).order("report_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false })),
    loadPortalStatisticPages(() => client.from("inspection_records").select("id,inspection_type,inspection_date,title,worker_display_name,worker_name,created_at", { count: "exact" }).contains("form_data", { job_context: { jobNumber } }).order("inspection_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false })),
    loadPortalStatisticPages(() => client.from("work_orders").select("id,wo_number,work_order_date,status,submitted_at,created_at,locked", { count: "exact" }).eq("job_id", portalJobId).order("work_order_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false })),
    loadPortalStatisticPages(() => client.from("work_orders").select("id,wo_number,work_order_date,status,submitted_at,created_at,locked", { count: "exact" }).is("job_id", null).eq("job_number", jobNumber).order("work_order_date", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false })),
    loadPortalStatisticPages(() => client.from("schedule_events").select("id,event_date,title,event_type,job_name,location", { count: "exact" }).eq("job_id", portalJobId).order("event_date", { ascending: true }).order("start_time", { ascending: true }).order("id", { ascending: true })),
    loadPortalStatisticPages(() => client.from("schedule_events").select("id,event_date,title,event_type,job_name,location", { count: "exact" }).is("job_id", null).eq("job_number", jobNumber).order("event_date", { ascending: true }).order("start_time", { ascending: true }).order("id", { ascending: true })),
  ]);
  const primaryResults = [submittedResult, liveResult, digitalPoResult, dailyResult, inspectionResult, workOrdersByIdResult, legacyWorkOrdersResult, scheduleByIdResult, legacyScheduleResult];
  const primaryError = primaryResults.find((result) => result.error)?.error;
  if (primaryError) {
    const restricted = primaryError.code === "42501";
    return json({ error: restricted ? "Approved administrator access is required to view job statistics." : primaryError.message || "Portal job statistics could not be loaded.", restricted }, restricted ? 403 : 500);
  }

  const workOrderRows = uniquePortalRows([...(workOrdersByIdResult.data ?? []), ...(legacyWorkOrdersResult.data ?? [])]);
  const workOrderIds = workOrderRows.map((row) => String(row.id)).filter(Boolean);
  const liveIds = (liveResult.data ?? []).map((row: Record<string, any>) => String(row.id ?? "")).filter(Boolean);
  const emptyResult: PortalRowsResult = { data: [], error: null };
  const [capturedResult, equipmentResult, travelResult, manualLabourResult] = await Promise.all([
    liveIds.length
      ? loadPortalStatisticIdChunks(liveIds, (chunk) => client.from("accounting_time_entries").select("id,source_entry_key", { count: "exact" }).eq("is_current", true).in("source_entry_key", chunk).order("id", { ascending: true }))
      : Promise.resolve(emptyResult),
    workOrderIds.length
      ? loadPortalStatisticIdChunks(workOrderIds, (chunk) => client.from("work_order_equipment").select("id,work_order_id,equipment_name,identification_number", { count: "exact" }).in("work_order_id", chunk).order("id", { ascending: true }))
      : Promise.resolve(emptyResult),
    workOrderIds.length
      ? loadPortalStatisticIdChunks(workOrderIds, (chunk) => client.from("work_order_travel").select("id,work_order_id,vehicle_name,identification_number,trailer_used,trailer_name,trailer_identification_number", { count: "exact" }).in("work_order_id", chunk).order("id", { ascending: true }))
      : Promise.resolve(emptyResult),
    workOrderIds.length
      ? loadPortalStatisticIdChunks(workOrderIds, (chunk) => client.from("work_order_labour").select("id,work_order_id,employee_id,employee_name,worker_key,hours,notes,matched_timesheet_entry_id", { count: "exact" }).in("work_order_id", chunk).order("id", { ascending: true }))
      : Promise.resolve(emptyResult),
  ]);
  const relatedResults = [capturedResult, equipmentResult, travelResult, manualLabourResult];
  const relatedError = relatedResults.find((result) => result.error)?.error;
  if (relatedError) {
    const restricted = relatedError.code === "42501";
    return json({ error: restricted ? "Approved administrator access is required to view job statistics." : relatedError.message || "Related Portal job records could not be loaded.", restricted }, restricted ? 403 : 500);
  }

  type LabourPoint = { identity: string; worker: string; date: string; hours: number };
  const labour: LabourPoint[] = [];
  const pushLabour = (identityValue: unknown, workerValue: unknown, dateValue: unknown, hoursValue: unknown) => {
    const worker = cleanPortalText(workerValue, 150) || "Unknown employee";
    const date = portalRecordDate(dateValue);
    const hours = roundPortalHours(hoursValue);
    if (!date || hours <= 0) return;
    const identity = cleanPortalText(identityValue, 150) || `name:${worker.toLowerCase().replace(/\s+/g, " ")}`;
    labour.push({ identity, worker, date, hours });
  };
  for (const row of submittedResult.data ?? []) pushLabour(row.profile_id, row.worker_name, row.work_date, row.payable_hours);
  const capturedSourceIds = new Set((capturedResult.data ?? []).map((row: Record<string, any>) => String(row.source_entry_key ?? "")));
  for (const row of liveResult.data ?? []) {
    if (capturedSourceIds.has(String(row.id ?? ""))) continue;
    pushLabour(row.profile_id, row.worker_name, addPortalDays(row.week_start, portalDayOffset(row.day_of_week)), row.hours);
  }
  const workOrdersById = new Map(workOrderRows.map((row) => [String(row.id), row]));
  const finalizedWorkOrderIds = new Set(workOrderRows.filter((row) => row.locked || cleanPortalText(row.status, 50).toLowerCase() === "submitted").map((row) => String(row.id)));
  for (const row of manualLabourResult.data ?? []) {
    const manual = cleanPortalText(row.worker_key, 150).toLowerCase().startsWith("manual-") || cleanPortalText(row.notes, 150).toLowerCase() === "manual labour entry";
    if (!manual || row.matched_timesheet_entry_id || !finalizedWorkOrderIds.has(String(row.work_order_id))) continue;
    const workOrder = workOrdersById.get(String(row.work_order_id));
    pushLabour(row.employee_id || row.worker_key, row.employee_name, workOrder?.work_order_date || workOrder?.submitted_at || workOrder?.created_at, row.hours);
  }

  const weekHours = new Map<string, number>();
  const employeeHours = new Map<string, { label: string; hours: number }>();
  const dailyHours = new Map<string, { hours: number; employees: Set<string> }>();
  const employeeIds = new Set<string>();
  for (const row of labour) {
    employeeIds.add(row.identity);
    const week = portalWeekStart(row.date);
    weekHours.set(week, (weekHours.get(week) ?? 0) + row.hours);
    const employee = employeeHours.get(row.identity) ?? { label: row.worker, hours: 0 };
    employee.hours += row.hours;
    employeeHours.set(row.identity, employee);
    const day = dailyHours.get(row.date) ?? { hours: 0, employees: new Set<string>() };
    day.hours += row.hours;
    day.employees.add(row.identity);
    dailyHours.set(row.date, day);
  }

  const workOrders: PortalJobStatistics["workOrders"] = workOrderRows
    .map((row) => ({ id: String(row.id ?? ""), number: cleanPortalText(row.wo_number, 100), date: portalRecordDate(row.work_order_date || row.created_at), status: portalDisplayStatus(row.status) }))
    .sort((left, right) => right.date.localeCompare(left.date));
  const workOrderNumber = new Map(workOrders.map((row) => [row.id, row.number]));
  const equipment: PortalJobStatistics["equipment"] = [];
  for (const row of equipmentResult.data ?? []) {
    equipment.push({ id: String(row.id ?? `equipment-${equipment.length}`), name: cleanPortalText(row.equipment_name, 200) || "Equipment", identifier: cleanPortalText(row.identification_number, 150), kind: "Equipment", workOrderNumber: workOrderNumber.get(String(row.work_order_id)) ?? "" });
  }
  for (const row of travelResult.data ?? []) {
    const id = String(row.id ?? `travel-${equipment.length}`);
    if (row.vehicle_name || row.identification_number) equipment.push({ id, name: cleanPortalText(row.vehicle_name, 200) || "Vehicle", identifier: cleanPortalText(row.identification_number, 150), kind: "Vehicle", workOrderNumber: workOrderNumber.get(String(row.work_order_id)) ?? "" });
    if (row.trailer_used && (row.trailer_name || row.trailer_identification_number)) equipment.push({ id: `${id}-trailer`, name: cleanPortalText(row.trailer_name, 200) || "Trailer", identifier: cleanPortalText(row.trailer_identification_number, 150), kind: "Trailer", workOrderNumber: workOrderNumber.get(String(row.work_order_id)) ?? "" });
  }

  const digitalPurchaseOrders: PortalJobStatistics["digitalPurchaseOrders"] = (digitalPoResult.data ?? []).map((row: Record<string, any>) => ({ id: String(row.id ?? ""), number: String(row.po_number ?? ""), supplier: cleanPortalText(row.supplier_name, 200), date: portalRecordDate(row.order_date || row.created_at), status: portalDigitalPoStatus(row) }));
  const dailyReports: PortalJobStatistics["dailyReports"] = (dailyResult.data ?? []).map((row: Record<string, any>) => ({ id: String(row.id ?? ""), date: portalRecordDate(row.report_date || row.created_at), worker: cleanPortalText(row.worker_display_name || row.worker_name, 150) }));
  const inspections: PortalJobStatistics["inspections"] = (inspectionResult.data ?? []).map((row: Record<string, any>) => ({ id: String(row.id ?? ""), type: cleanPortalText(row.inspection_type, 150), title: cleanPortalText(row.title || row.inspection_type, 250), date: portalRecordDate(row.inspection_date || row.created_at), worker: cleanPortalText(row.worker_display_name || row.worker_name, 150) }));
  const schedule: PortalJobStatistics["schedule"] = uniquePortalRows([...(scheduleByIdResult.data ?? []), ...(legacyScheduleResult.data ?? [])])
    .map((row) => ({ id: String(row.id ?? ""), date: portalRecordDate(row.event_date), title: cleanPortalText(row.title || row.job_name || row.location || "Scheduled work", 250), type: portalDisplayStatus(row.event_type || "work") }))
    .sort((left, right) => left.date.localeCompare(right.date));

  const response: PortalJobStatistics = {
    portalJobId,
    jobNumber,
    generatedAt: new Date().toISOString(),
    totalHours: roundPortalHours(labour.reduce((sum, row) => sum + row.hours, 0)),
    employeeCount: employeeIds.size,
    digitalPoCount: digitalPurchaseOrders.length,
    dailyReportCount: dailyReports.length,
    inspectionCount: inspections.length,
    workOrderCount: workOrders.length,
    equipmentCount: equipment.length,
    hoursByWeek: [...weekHours.entries()].filter(([startDate]) => Boolean(startDate)).sort(([left], [right]) => left.localeCompare(right)).map(([startDate, hours]) => ({ label: portalWeekLabel(startDate), startDate, hours: roundPortalHours(hours) })),
    hoursByEmployee: [...employeeHours.values()].map((row) => ({ label: row.label, hours: roundPortalHours(row.hours) })).sort((left, right) => right.hours - left.hours || left.label.localeCompare(right.label)),
    onsiteByDay: [...dailyHours.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, row]) => ({ date, employees: row.employees.size, hours: roundPortalHours(row.hours) })),
    digitalPurchaseOrders,
    dailyReports,
    inspections,
    workOrders,
    equipment,
    schedule,
  };
  return json(response);
}

function secureDocumentLink(value: unknown) {
  const link = String(value ?? "").trim();
  if (!link) return "";
  try {
    const url = new URL(link);
    return url.protocol === "https:" ? link : "";
  } catch {
    return "";
  }
}

async function mutatePortalJobDocuments(client: any, request: Request) {
  if (request.method !== "PATCH") return json({ error: "This job document action is not supported." }, 405);
  const body = await request.json() as Record<string, any>;
  const portalJobId = String(body.portalJobId ?? "").trim();
  const requestedLink = String(body.documentLink ?? "").trim();
  const documentLink = secureDocumentLink(requestedLink);
  const documentLinkLabel = String(body.documentLinkLabel ?? "").trim().slice(0, 100);
  if (!portalJobId) return json({ error: "This estimator job is not linked to a Portal job." }, 400);
  if (requestedLink && !documentLink) return json({ error: "Paste a secure https:// OneDrive folder link." }, 400);
  const result = await client
    .from("jobs")
    .update({
      document_link: documentLink || null,
      document_link_label: documentLink ? (documentLinkLabel || "Open OneDrive Folder") : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", portalJobId)
    .select("id,document_link,document_link_label")
    .single();
  if (result.error) throw new Error(result.error.message || "The project document folder could not be saved.");
  return json({
    saved: true,
    portalJobId: result.data.id,
    documentLink: result.data.document_link ?? "",
    documentLinkLabel: result.data.document_link_label ?? "",
  });
}

async function mutatePortalVendor(client: any, request: Request) {
  if (request.method === "GET") return vendorsResponse(client);
  const body = await request.json() as Record<string, any>;
  const payload = vendorPayload(body);
  if (!payload.company_name) return json({ error: "A subcontractor company name is required." }, 400);
  if (request.method === "POST") {
    const result = await client.from("subcontractors_suppliers").insert(payload).select("id").single();
    if (result.error) throw new Error(result.error.message || "The subcontractor could not be added.");
    return vendorsResponse(client);
  }
  if (!body.portalRecordId) return json({ error: "The Portal subcontractor record is required." }, 400);
  const result = await client.from("subcontractors_suppliers").update(payload).eq("id", body.portalRecordId).select("id").single();
  if (result.error) throw new Error(result.error.message || "The subcontractor could not be saved.");
  return vendorsResponse(client);
}

async function mutatePortalContact(client: any, request: Request) {
  const body = await request.json() as Record<string, any>;
  if (request.method === "DELETE") {
    if (!body.portalRecordId) return json({ error: "The Portal contact record is required." }, 400);
    const result = await client.from("subcontractor_supplier_contacts").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", body.portalRecordId).select("id").single();
    if (result.error) throw new Error(result.error.message || "The contact could not be removed.");
    return vendorsResponse(client);
  }
  const payload = {
    company_id: String(body.companyId ?? ""),
    contact_name: String(body.name ?? "").trim(),
    role: String(body.role ?? "").trim(),
    phone: String(body.phone ?? "").trim(),
    email: String(body.email ?? "").trim(),
    notes: String(body.notes ?? "").trim(),
    is_active: body.active !== false,
    updated_at: new Date().toISOString(),
  };
  if (!payload.company_id || !payload.contact_name) return json({ error: "A company and contact name are required." }, 400);
  if (request.method === "POST") {
    const result = await client.from("subcontractor_supplier_contacts").insert(payload).select("id").single();
    if (result.error) throw new Error(result.error.message || "The contact could not be added.");
    return vendorsResponse(client);
  }
  if (!body.portalRecordId) return json({ error: "The Portal contact record is required." }, 400);
  const result = await client.from("subcontractor_supplier_contacts").update(payload).eq("id", body.portalRecordId).select("id").single();
  if (result.error) throw new Error(result.error.message || "The contact could not be saved.");
  return vendorsResponse(client);
}

function syncPortalData(state: AppState, vendors: Vendor[], portalJobs: PortalJobOption[]) {
  const portalById = new Map(portalJobs.map((job) => [job.id, job]));
  const portalByNumber = new Map(portalJobs.map((job) => [job.jobNumber.trim().toLowerCase(), job]));
  const jobs: Job[] = state.jobs.map((job) => {
    const portal = (job.portalJobId && portalById.get(job.portalJobId)) || portalByNumber.get(job.jobNumber.trim().toLowerCase());
    if (!portal) return job;
    const archived = !portal.active;
    const portalDocumentLinkId = `portal-job-link-${job.id}`;
    const savedDocumentLinks = job.documentLinks ?? [];
    const previousPortalDocumentLink = savedDocumentLinks.find((link) => link.id === portalDocumentLinkId);
    const internalDocumentLinks = savedDocumentLinks.filter((link) => link.id !== portalDocumentLinkId);
    const documentLinks = [...internalDocumentLinks];
    if (portal.documentLink?.trim() && !internalDocumentLinks.some((link) => link.url === portal.documentLink)) {
      documentLinks.unshift({
        id: portalDocumentLinkId,
        label: portal.documentLinkLabel?.trim() || "Open Project Documents",
        url: portal.documentLink,
        createdAt: previousPortalDocumentLink?.createdAt || new Date().toISOString(),
      });
    }
    return {
      ...job,
      jobNumber: portal.jobNumber,
      portalJobId: portal.id,
      portalActive: portal.active,
      portalLastSyncedAt: new Date().toISOString(),
      portalJobName: portal.jobName,
      portalCustomer: portal.customer,
      portalAddress: portal.address,
      jobType: portal.jobType,
      projectManager: portal.projectManager,
      startDate: portal.startDate,
      targetEndDate: portal.targetEndDate,
      documentLinks,
      documentLink: portal.documentLink ?? "",
      documentLinkLabel: portal.documentLinkLabel ?? "",
      status: archived ? "Archived" : "Active",
      archivedAt: archived ? (job.archivedAt || new Date().toISOString()) : "",
    };
  });
  return { ...state, vendors, jobs };
}

async function getState(client: any) {
  const [{ data, error }, references] = await Promise.all([
    client.from("estimator_workspaces").select("payload,updated_at,revision").eq("id", STATE_ID).maybeSingle(),
    loadPortalReferences(client),
  ]);
  if (error) throw new Error(error.message || "Estimator workspace could not be loaded.");
  if (!data) {
    const initial = createConnectedInitialState();
    const inserted = await client.from("estimator_workspaces").insert({ id: STATE_ID, payload: initial }).select("updated_at,revision").single();
    if (inserted.error) throw new Error(inserted.error.message || "Estimator workspace could not be initialized.");
    stateRevision = Number(inserted.data.revision) || 1;
    const state = syncPortalData(initial, references.vendors, references.portalJobs);
    stateBase = stripPortalSnapshots(state);
    return { state, updatedAt: inserted.data.updated_at, revision: stateRevision };
  }
  const state = normalizeAppState(data.payload as AppState);
  stateRevision = Number(data.revision) || 1;
  const syncedState = syncPortalData(state, references.vendors, references.portalJobs);
  stateBase = stripPortalSnapshots(syncedState);
  return { state: syncedState, updatedAt: data.updated_at, revision: stateRevision };
}

function stripPortalSnapshots(state: AppState) {
  return {
    ...state,
    vendors: [],
    jobs: state.jobs.map((job) => ({ ...job })),
  };
}

async function putState(client: any, request: Request) {
  const body = await request.json() as { state?: AppState };
  if (!body.state || !Array.isArray(body.state.quotes) || !Array.isArray(body.state.priceBook)) return json({ error: "A complete estimator workspace is required." }, 400);
  const localState = stripPortalSnapshots(body.state);
  const result = await client
    .from("estimator_workspaces")
    .update({ payload: localState, updated_at: new Date().toISOString() })
    .eq("id", STATE_ID)
    .eq("revision", stateRevision)
    .select("updated_at,revision")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "Estimator workspace could not be saved.");
  if (result.data) {
    stateRevision = Number(result.data.revision) || stateRevision + 1;
    stateBase = localState;
    return json({ saved: true, updatedAt: result.data.updated_at, revision: stateRevision });
  }

  const latest = await client
    .from("estimator_workspaces")
    .select("payload,updated_at,revision")
    .eq("id", STATE_ID)
    .maybeSingle();
  if (latest.error) throw new Error(latest.error.message || "The latest estimator workspace could not be loaded.");
  if (!latest.data) return json({ error: "The shared estimator workspace is unavailable. Refresh and try again." }, 409);

  const remoteState = normalizeAppState(latest.data.payload as AppState);
  const baseState = stateBase ?? remoteState;
  stateRevision = Number(latest.data.revision) || stateRevision;
  stateBase = remoteState;
  const merged = mergeConcurrentEstimatorState(baseState, localState, remoteState);
  if (!merged.state) {
    return json({
      error: "The same estimate field changed in another browser. Tap the save warning to keep this browser's current value, or refresh to use the shared value.",
      conflicts: merged.conflicts,
    }, 409);
  }

  const retry = await client
    .from("estimator_workspaces")
    .update({ payload: merged.state, updated_at: new Date().toISOString() })
    .eq("id", STATE_ID)
    .eq("revision", stateRevision)
    .select("updated_at,revision")
    .maybeSingle();
  if (retry.error) throw new Error(retry.error.message || "Estimator workspace could not be merged.");
  if (!retry.data) return json({ error: "The estimator changed again while saving. Tap the save warning to retry." }, 409);

  stateRevision = Number(retry.data.revision) || stateRevision + 1;
  stateBase = merged.state;
  const refreshed = await getState(client);
  return json({ ...refreshed, saved: true, merged: true });
}

async function getSupplierCatalog(client: any, url: URL) {
  const supplierId = url.searchParams.get("supplierId")?.trim() ?? "";
  const queryText = url.searchParams.get("q")?.trim() ?? "";
  const mode = url.searchParams.get("mode") === "supplier" ? "supplier" : "search";
  const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get("limit")) || (mode === "supplier" ? 5000 : 100)));
  let query = client.from("estimator_supplier_catalog_items").select("*", { count: "exact" });
  if (supplierId) query = query.eq("supplier_id", supplierId);
  if (mode !== "supplier") query = query.eq("active", true);
  if (queryText) {
    const safe = queryText.replace(/[,%()]/g, " ").trim();
    if (safe) query = query.or(`normalized_description.ilike.%${safe.toLowerCase()}%,supplier_sku.ilike.%${safe}%,supplier_name.ilike.%${safe}%`);
  }
  const result: SupabaseResult<Record<string, any>[]> = await query.order("supplier_name").order("product_name").limit(limit);
  if (result.error) throw new Error(result.error.message || "Supplier prices could not be loaded.");
  const imports = await client.from("estimator_supplier_price_imports").select("*").order("created_at", { ascending: false }).limit(15);
  if (imports.error) throw new Error(imports.error.message || "Supplier import history could not be loaded.");
  const response: SupplierCatalogSearchResponse = {
    items: (result.data ?? []).map(catalogRecord),
    total: result.count ?? result.data?.length ?? 0,
    imports: (imports.data ?? []).map((row: Record<string, any>) => ({
      id: row.id,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      filename: row.filename,
      detectedDate: row.detected_date ?? "",
      effectiveDate: row.effective_date,
      validUntil: row.valid_until ?? "",
      parserType: row.parser_type,
      rowCount: row.row_count,
      newCount: row.new_count,
      changedCount: row.changed_count,
      unchangedCount: row.unchanged_count,
      reviewCount: row.review_count,
      createdAt: row.created_at,
    })),
  };
  return json(response);
}

async function patchSupplierItem(client: any, request: Request) {
  const body = await request.json() as Record<string, any>;
  if (!body.id || !String(body.productName ?? "").trim()) return json({ error: "A product and material name are required." }, 400);
  const result = await client.from("estimator_supplier_catalog_items").update({
    product_name: String(body.productName).trim(),
    normalized_description: normalizeMaterialName(String(body.productName)),
    division: String(body.division ?? "").trim(),
    unit: String(body.unit ?? "").trim(),
    net_cost: dollars(body.netCost),
    effective_date: String(body.effectiveDate ?? "").trim() || undefined,
    active: Boolean(body.active),
    last_seen_at: new Date().toISOString(),
  }).eq("id", body.id).select("id").single();
  if (result.error) throw new Error(result.error.message || "Supplier item could not be saved.");
  return json({ saved: true });
}

async function createManualSupplierItem(client: any, request: Request) {
  const body = await request.json() as Record<string, any>;
  const productName = String(body.productName ?? "").trim();
  const normalizedName = normalizeMaterialName(productName);
  const effectiveDate = String(body.effectiveDate ?? "").trim() || new Date().toISOString().slice(0, 10);
  const supplierName = String(body.supplierName ?? "").trim() || "Manual entry";
  const supplierId = "manual-jgc";
  const normalizedSku = `name:${normalizedName}`;
  if (!productName || !normalizedName) return json({ error: "A material name is required." }, 400);
  if (!String(body.unit ?? "").trim()) return json({ error: "A unit is required." }, 400);
  if (dollars(body.netCost) < 0) return json({ error: "Cost cannot be negative." }, 400);

  const existing = await client
    .from("estimator_supplier_catalog_items")
    .select("id")
    .eq("supplier_id", supplierId)
    .eq("normalized_sku", normalizedSku)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message || "Existing manual materials could not be checked.");
  if (existing.data) return json({ error: "That manual material already exists. Search for it and edit the existing price." }, 409);

  const importId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const now = new Date().toISOString();
  const imported = await client.from("estimator_supplier_price_imports").insert({
    id: importId,
    supplier_id: supplierId,
    supplier_name: supplierName,
    filename: `Manual material - ${productName}`,
    file_hash: `manual:${crypto.randomUUID()}`,
    detected_date: effectiveDate,
    effective_date: effectiveDate,
    valid_until: null,
    parser_type: "manual",
    source_subtotal: dollars(body.netCost),
    extracted_subtotal: dollars(body.netCost),
    row_count: 1,
    new_count: 1,
    changed_count: 0,
    unchanged_count: 0,
    review_count: 0,
  });
  if (imported.error) throw new Error(imported.error.message || "Manual material history could not be saved.");

  const record = {
    id: itemId,
    supplier_id: supplierId,
    supplier_name: supplierName,
    supplier_sku: productName,
    normalized_sku: normalizedSku,
    product_name: productName,
    raw_description: productName,
    normalized_description: normalizedName,
    raw_unit: String(body.unit).trim(),
    unit: String(body.unit).trim(),
    division: String(body.division ?? "").trim(),
    list_price: null,
    net_cost: dollars(body.netCost),
    effective_date: effectiveDate,
    valid_until: null,
    active: true,
    latest_import_id: importId,
    last_seen_at: now,
  };
  const inserted = await client.from("estimator_supplier_catalog_items").insert(record).select("*").single();
  if (inserted.error) {
    await client.from("estimator_supplier_price_imports").delete().eq("id", importId);
    throw new Error(inserted.error.message || "Manual material could not be saved.");
  }
  return json({ item: catalogRecord(inserted.data) }, 201);
}

async function applySupplierImport(client: any, request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  const metadataText = form.get("metadata");
  if (!(file instanceof File) || typeof metadataText !== "string") return json({ error: "The supplier file and reviewed prices are required." }, 400);
  const metadata = JSON.parse(metadataText) as SupplierImportApplyMetadata;
  if (!metadata.supplierId || !metadata.supplierName || !metadata.effectiveDate || !Array.isArray(metadata.rows) || !metadata.rows.length) return json({ error: "The reviewed supplier import is incomplete." }, 400);
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const fileHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (fileHash !== metadata.fileHash) return json({ error: "The supplier file changed after it was reviewed. Read it again before importing." }, 409);
  const duplicate = await client.from("estimator_supplier_price_imports").select("id").eq("supplier_id", metadata.supplierId).eq("file_hash", metadata.fileHash).maybeSingle();
  if (duplicate.error) throw new Error(duplicate.error.message || "Supplier import could not be checked.");
  if (duplicate.data) return json({ error: "This exact supplier price file has already been imported." }, 409);
  const existingResult = await client.from("estimator_supplier_catalog_items").select("*").eq("supplier_id", metadata.supplierId);
  if (existingResult.error) throw new Error(existingResult.error.message || "Existing supplier prices could not be checked.");
  const matchByName = metadata.parserType === "material-xlsx";
  const identity = (row: Record<string, any>) => matchByName ? normalizeMaterialName(row.product_name) : row.normalized_sku;
  const existing = new Map<string, Record<string, any>>((existingResult.data ?? []).map((row: Record<string, any>) => [identity(row), row]));
  const deduped = new Map<string, SupplierImportApplyMetadata["rows"][number]>();
  for (const row of metadata.rows) {
    const key = matchByName ? normalizeMaterialName(row.productName) : normalizeSupplierSku(row.sku);
    if (key) deduped.set(key, row);
  }
  const importId = crypto.randomUUID();
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  const upserts: Record<string, any>[] = [];
  for (const [key, row] of deduped) {
    const old = existing.get(key);
    const normalizedSku = matchByName ? `name:${key}` : normalizeSupplierSku(row.sku);
    const changed = !old || old.product_name !== row.productName || old.unit !== row.unit || dollars(old.net_cost) !== dollars(row.netCost) || old.active !== true;
    if (!old) newCount += 1;
    else if (changed) changedCount += 1;
    else unchangedCount += 1;
    upserts.push({
      id: old?.id ?? crypto.randomUUID(),
      supplier_id: metadata.supplierId,
      supplier_name: metadata.supplierName,
      supplier_sku: row.sku,
      normalized_sku: normalizedSku,
      product_name: row.productName,
      raw_description: row.description,
      normalized_description: normalizeMaterialName(row.productName),
      raw_unit: row.rawUnit,
      unit: row.unit,
      division: row.division,
      list_price: row.listPrice,
      net_cost: row.netCost,
      effective_date: metadata.effectiveDate,
      valid_until: metadata.validUntil || null,
      active: true,
      latest_import_id: importId,
      last_seen_at: new Date().toISOString(),
    });
  }
  const imported = await client.from("estimator_supplier_price_imports").insert({
    id: importId,
    supplier_id: metadata.supplierId,
    supplier_name: metadata.supplierName,
    filename: metadata.filename,
    file_hash: metadata.fileHash,
    detected_date: metadata.detectedDate || null,
    effective_date: metadata.effectiveDate,
    valid_until: metadata.validUntil || null,
    parser_type: metadata.parserType,
    source_subtotal: metadata.sourceSubtotal,
    extracted_subtotal: metadata.extractedSubtotal,
    row_count: upserts.length,
    new_count: newCount,
    changed_count: changedCount,
    unchanged_count: unchangedCount,
    review_count: metadata.reviewCount,
  });
  if (imported.error) throw new Error(imported.error.message || "Supplier import history could not be saved.");
  for (let offset = 0; offset < upserts.length; offset += 250) {
    const result = await client.from("estimator_supplier_catalog_items").upsert(upserts.slice(offset, offset + 250), { onConflict: "supplier_id,normalized_sku" });
    if (result.error) throw new Error(result.error.message || "Supplier prices could not be applied.");
  }
  return json({ newCount, changedCount, unchangedCount });
}

async function route(client: any, input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url, window.location.href);
  if (url.pathname.endsWith("/api/state")) {
    if (request.method === "PUT") return putState(client, request);
    return json(await getState(client));
  }
  if (url.pathname.endsWith("/api/supplier-catalog")) {
    if (request.method === "PATCH") return patchSupplierItem(client, request);
    if (request.method === "POST") {
      return request.headers.get("content-type")?.includes("application/json")
        ? createManualSupplierItem(client, request)
        : applySupplierImport(client, request);
    }
    return getSupplierCatalog(client, url);
  }
  if (url.pathname.endsWith("/api/job-costing")) return jobCostingResponse(client);
  if (url.pathname.endsWith("/api/job-statistics")) return jobStatisticsResponse(client, request, url);
  if (url.pathname.endsWith("/api/job-info")) return mutatePortalJobInfo(client, request);
  if (url.pathname.endsWith("/api/job-documents")) return mutatePortalJobDocuments(client, request);
  if (url.pathname.endsWith("/api/vendors")) return mutatePortalVendor(client, request);
  if (url.pathname.endsWith("/api/vendor-contacts")) return mutatePortalContact(client, request);
  return null;
}

export function installEstimatorApiBridge(client: any) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return (await route(client, input, init)) ?? nativeFetch(input, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Estimator data could not be loaded.";
      return json({ error: message }, 500);
    }
  };
}

export function portalJobs() {
  return bridgeWindow.JGC_ESTIMATOR_PORTAL_JOBS ?? [];
}
