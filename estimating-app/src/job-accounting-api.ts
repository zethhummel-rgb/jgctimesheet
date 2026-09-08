import { accountingBase64ToBytes, accountingFileHash, planJobAccountingExport, type AccountingExportPreview } from "../lib/job-accounting-export";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const metadata = "id,cycle,version,file_name,file_sha256,summary,exported_by_name,exported_at";
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const failure = (error: { message?: string; code?: string }) => json({ error: error.message || "The accounting download could not be completed." }, error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "22023" ? 400 : 500);

/** A separate endpoint: no writes to jobs, workspace state, imports or payroll. */
export async function jobAccountingResponse(client: any, request: Request) {
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data?.user?.id) return json({ error: "Sign in with an approved administrator account." }, 403);
  const profile = await client.from("profiles").select("role,account_status").eq("id", auth.data.user.id).single();
  if (profile.error) return failure(profile.error);
  if (profile.data?.role !== "admin" || profile.data?.account_status !== "approved") return json({ error: "Approved administrator access is required." }, 403);
  const url = new URL(request.url);
  if (request.method === "GET") {
    const id = url.searchParams.get("id");
    if (id) {
      if (!uuid(id)) return json({ error: "Choose a valid saved version." }, 400);
      const record = await client.from("job_accounting_exports").select(`${metadata},rows`).eq("id", id).maybeSingle();
      if (record.error) return failure(record.error);
      if (!record.data) return json({ error: "This accounting version was not found." }, 404);
      const offset = Math.max(0, Math.min(1_000_000, Number(url.searchParams.get("offset")) || 0));
      const requests = await client.from("job_accounting_export_downloads")
        .select("id,downloaded_by_name,requested_at", { count: "exact" }).eq("export_id", id)
        .order("requested_at", { ascending: false }).order("id").range(offset, offset + 19);
      if (requests.error) return failure(requests.error);
      return json({ record: record.data, requests: requests.data ?? [], requestCount: requests.count ?? 0 });
    }
    const offset = Math.max(0, Math.min(1_000_000, Number(url.searchParams.get("offset")) || 0));
    const history = await client.from("job_accounting_exports").select(metadata, { count: "exact" }).order("cycle", { ascending: false }).order("version", { ascending: false }).range(offset, offset + 19);
    if (history.error) return failure(history.error);
    const state = await client.rpc("get_job_accounting_export_state");
    if (state.error) return failure(state.error);
    return json({ history: history.data ?? [], count: history.count ?? 0, state: state.data });
  }
  if (request.method !== "POST") return json({ error: "Saved accounting versions cannot be edited or deleted." }, 405);
  const body = await request.json();
  if (body.action === "reset") {
    if (!uuid(body.id) || !uuid(body.expectedExportId) || !Number.isSafeInteger(body.expectedCycle) || body.expectedCycle < 1 || body.confirmation !== "DELETE HISTORY") return json({ error: "Type DELETE HISTORY to confirm permanently deleting saved accounting downloads and logs." }, 400);
    const result = await client.rpc("clear_job_accounting_download_history", { p_reset_id: body.id, p_expected_cycle: body.expectedCycle, p_expected_export_id: body.expectedExportId, p_confirmation: body.confirmation });
    return result.error ? failure(result.error) : json({ reset: result.data });
  }
  if (body.action === "preview") {
    const prepared = await client.rpc("get_job_accounting_export_preview");
    if (prepared.error) return failure(prepared.error);
    const preview = prepared.data as AccountingExportPreview;
    return json({ preview, plan: planJobAccountingExport(preview) });
  }
  if (body.action === "save") {
    if (!uuid(body.id) || !body.preview || typeof body.fileBase64 !== "string" || body.fileBase64.length > 12_000_000) return json({ error: "A complete reviewed Excel file is required." }, 400);
    // Retrying a timed-out save returns its exact immutable version, without
    // advancing colours again, even if a later version now exists.
    const existing = await client.from("job_accounting_exports").select(metadata).eq("id", body.id).maybeSingle();
    if (existing.error) return failure(existing.error);
    if (existing.data) return json({ record: existing.data, reused: true });
    const preview = body.preview as AccountingExportPreview;
    const prepared = await client.rpc("get_job_accounting_export_preview");
    if (prepared.error) return failure(prepared.error);
    const current = prepared.data as AccountingExportPreview;
    if (current.cycle !== preview.cycle || current.version !== preview.version || current.previousExportId !== preview.previousExportId || JSON.stringify(current.sourceSnapshot) !== JSON.stringify(preview.sourceSnapshot)) return json({ error: "Jobs or download history changed. Refresh the preview before saving." }, 409);
    const plan = planJobAccountingExport(current);
    if (!plan.rows.length) return json({ error: "There are no jobs with a confirmed accounting status to download." }, 400);
    const fileHash = await accountingFileHash(accountingBase64ToBytes(body.fileBase64));
    if (fileHash !== body.fileSha256) return json({ error: "The Excel file failed its integrity check. No version was saved." }, 400);
    const saved = await client.from("job_accounting_exports").insert({
      id: body.id, cycle: current.cycle, version: current.version, previous_export_id: current.previousExportId,
      file_name: "assigned-by-database.xlsx", file_sha256: fileHash, file_base64: body.fileBase64,
      source_snapshot: current.sourceSnapshot, rows: plan.rows, summary: plan.summary,
      exported_by: auth.data.user.id, exported_by_name: "assigned by database",
    }).select(metadata).single();
    if (saved.error) {
      const retry = await client.from("job_accounting_exports").select(metadata).eq("id", body.id).maybeSingle();
      if (!retry.error && retry.data) return json({ record: retry.data, reused: true });
      return failure(saved.error);
    }
    return json({ record: saved.data }, 201);
  }
  if (body.action === "download") {
    if (!uuid(body.exportId) || !uuid(body.requestId)) return json({ error: "Choose a valid saved version." }, 400);
    const record = await client.from("job_accounting_exports").select(`${metadata},file_base64`).eq("id", body.exportId).maybeSingle();
    if (record.error) return failure(record.error);
    if (!record.data) return json({ error: "The saved Excel version was not found." }, 404);
    if (await accountingFileHash(accountingBase64ToBytes(record.data.file_base64)) !== record.data.file_sha256) return json({ error: "This saved file failed its integrity check. Contact an administrator; no new version was created." }, 500);
    const logged = await client.from("job_accounting_export_downloads").insert({ id: body.requestId, export_id: body.exportId, downloaded_by: auth.data.user.id, downloaded_by_name: "assigned by database" });
    if (logged.error) {
      if (logged.error.code !== "23505") return failure(logged.error);
      const previous = await client.from("job_accounting_export_downloads").select("export_id,downloaded_by").eq("id", body.requestId).single();
      if (previous.error || previous.data.export_id !== body.exportId || previous.data.downloaded_by !== auth.data.user.id) return json({ error: "This download request does not match the saved version." }, 409);
    }
    return json({ record: record.data });
  }
  return json({ error: "Choose preview, save, download or reset." }, 400);
}
