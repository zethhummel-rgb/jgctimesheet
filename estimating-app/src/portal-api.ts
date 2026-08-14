import { createDefaultState, normalizeAppState, type AppState, type Job, type Vendor, type VendorContact } from "../lib/estimator-data";
import type { SupplierCatalogItemRecord, SupplierCatalogSearchResponse, SupplierImportApplyMetadata } from "../lib/supplier-catalog-types";
import { normalizeMaterialName } from "../lib/material-price-workbook";
import { normalizeSupplierSku } from "../lib/supplier-price-parser";

type SupabaseResult<T> = { data: T | null; error: { message?: string } | null; count?: number | null };

export interface PortalJobOption {
  id: string;
  jobNumber: string;
  jobName: string;
  customer: string;
  address: string;
  active: boolean;
}

interface PortalBridgeWindow extends Window {
  createJgcSupabaseClient?: () => any;
  JGC_ESTIMATOR_PORTAL_JOBS?: PortalJobOption[];
}

const bridgeWindow = window as PortalBridgeWindow;
const STATE_ID = "main";
let stateRevision = 0;

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

async function loadPortalReferences(client: any) {
  const [vendors, jobsResult] = await Promise.all([
    loadPortalVendors(client),
    client
      .from("jobs")
      .select("id,job_number,job_name,customer,address,active")
      .order("job_number", { ascending: false }),
  ]);
  if (jobsResult.error) throw new Error(jobsResult.error.message || "Portal jobs could not be loaded.");
  const portalJobs: PortalJobOption[] = (jobsResult.data ?? []).map((row: Record<string, any>) => ({
    id: row.id,
    jobNumber: row.job_number,
    jobName: row.job_name,
    customer: row.customer ?? "",
    address: row.address ?? "",
    active: Boolean(row.active),
  }));
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
    return {
      ...job,
      jobNumber: portal.jobNumber,
      portalJobId: portal.id,
      portalActive: portal.active,
      portalLastSyncedAt: new Date().toISOString(),
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
    return { state: syncPortalData(initial, references.vendors, references.portalJobs), updatedAt: inserted.data.updated_at, revision: stateRevision };
  }
  const state = normalizeAppState(data.payload as AppState);
  stateRevision = Number(data.revision) || 1;
  return { state: syncPortalData(state, references.vendors, references.portalJobs), updatedAt: data.updated_at, revision: stateRevision };
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
  const result = await client
    .from("estimator_workspaces")
    .update({ payload: stripPortalSnapshots(body.state), updated_at: new Date().toISOString() })
    .eq("id", STATE_ID)
    .eq("revision", stateRevision)
    .select("updated_at,revision")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "Estimator workspace could not be saved.");
  if (!result.data) return json({ error: "This estimate changed in another browser. Refresh before continuing so no work is overwritten." }, 409);
  stateRevision = Number(result.data.revision) || stateRevision + 1;
  return json({ saved: true, updatedAt: result.data.updated_at, revision: stateRevision });
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
    active: Boolean(body.active),
    last_seen_at: new Date().toISOString(),
  }).eq("id", body.id).select("id").single();
  if (result.error) throw new Error(result.error.message || "Supplier item could not be saved.");
  return json({ saved: true });
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
    if (request.method === "POST") return applySupplierImport(client, request);
    return getSupplierCatalog(client, url);
  }
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
