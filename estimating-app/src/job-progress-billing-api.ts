
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const failure = (e: {message?: string; code?: string}) => json({error: e.message || "Progress billing could not be saved."}, e.code === "42501" ? 403 : e.code === "40001" ? 409 : e.code === "22023" ? 400 : 500);
export async function jobProgressBillingResponse(client: any, request: Request) {
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data?.user?.id) return json({error: "Sign in with an approved administrator account."},403);
  const profile = await client.from("profiles").select("role,account_status").eq("id",auth.data.user.id).single();
  if (profile.error) return failure(profile.error);
  if (profile.data?.role !== "admin" || profile.data?.account_status !== "approved") return json({error: "Approved administrator access is required."},403);
  if (request.method === "GET") {
    const url = new URL(request.url), jobId = url.searchParams.get("jobId");
    if (!uuid(jobId)) return json({error: "Choose a linked Portal job."},400);
    const offset = Math.max(0,Math.min(1000000,Math.floor(Number(url.searchParams.get("offset")) || 0)));
    const result = await client.from("job_progress_billing_requests").select("*",{count:"exact"}).eq("job_id",jobId)
      .order("requested_at",{ascending:false}).order("id").range(offset,offset+49);
    return result.error ? failure(result.error) : json({requests: result.data ?? [], count: result.count ?? 0});
  }
  if (request.method !== "POST") return json({error: "Choose request or cancel."},405);
  const body = await request.json();
  if (!uuid(body.jobId) || !uuid(body.requestId) || !["request","cancel"].includes(body.action)) return json({error: "Choose a valid billing request."},400);
  const result = await client.rpc("change_job_progress_billing", {p_job_id:body.jobId,p_request_id:body.requestId,p_action:body.action});
  return result.error ? failure(result.error) : json({request:result.data});
}
