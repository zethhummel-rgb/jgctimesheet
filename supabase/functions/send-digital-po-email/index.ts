import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TEMP_BUCKET = "digital-po-temp";
const MAX_PER_RUN = 5;
const GOOGLE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzPILTnOSzQcCkA6y5vSLxCH6i05Y2-ZHZAk09Und0YKiXZOYMppV4fvW3G6EgqOIZi/exec";
const DEFAULT_RECIPIENTS = "zeth@johngordonconstruction.com";

type JsonRecord = Record<string, any>;

function jsonResponse(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function safeFilename(value: unknown, fallback: string) {
  const cleaned = safeText(value)
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function formatPoNumber(value: unknown) {
  return `PO-${safeText(value).replace(/^PO-/i, "")}`;
}

function escapeHtml(value: unknown) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value: unknown) {
  const match = safeText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : safeText(value);
}

function blobToBase64(blob: Blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    const chunks: string[] = [];
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      chunks.push(String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length))));
    }
    return btoa(chunks.join(""));
  });
}

function buildEmailText(po: JsonRecord, items: JsonRecord[]) {
  const lines = items.map((item, index) =>
    `${index + 1}. Ordered: ${item.quantity_ordered ?? ""} | ${item.description ?? ""}`
  );

  return [
    `JGC Digital Purchase Order ${formatPoNumber(po.po_number)}`,
    "",
    `Date: ${safeText(po.order_date)}`,
    `Job: ${[po.job_number, po.job_name].filter(Boolean).join(" - ")}`,
    `Supplier: ${safeText(po.supplier_name)}`,
    `Created by: ${safeText(po.creator_name)}`,
    `Assigned to: ${safeText(po.assigned_name) || "Not assigned"}`,
    `Submitted by: ${safeText(po.submitted_by_name)}`,
    po.notes ? `Notes: ${safeText(po.notes)}` : "",
    "",
    "Materials:",
    ...lines,
    "",
    "The Digital PO PDF is attached.",
    po.receipt_attached ? "The receipt image is included in the attached PO PDF." : "No receipt image was attached.",
  ].filter((line) => line !== "").join("\n");
}

function buildPoPdfHtml(po: JsonRecord, items: JsonRecord[], receiptDataUrl: string) {
  const rows = (items.length ? items : [{}]).map((item) => `<tr>
    <td>${escapeHtml(item.quantity_ordered)}</td>
    <td>${escapeHtml(item.description)}</td>
  </tr>`).join("");

  const receipt = receiptDataUrl
    ? `<section class="receipt"><h2>Receipt</h2><img src="${receiptDataUrl}" alt="Attached receipt"></section>`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; color: #142017; margin: 34px; font-size: 12px; }
  .header { border-bottom: 4px solid #186940; padding-bottom: 14px; display: flex; justify-content: space-between; }
  h1 { color: #186940; margin: 0; font-size: 25px; }
  .number { font-size: 22px; font-weight: bold; text-align: right; }
  .address { color: #4f5e52; margin-top: 6px; line-height: 1.45; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #31543e; margin: 20px 0; }
  .field { border-right: 1px solid #31543e; border-bottom: 1px solid #31543e; padding: 10px; min-height: 37px; }
  .field:nth-child(even) { border-right: 0; }
  .label { color: #31543e; font-size: 9px; font-weight: bold; text-transform: uppercase; display: block; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { background: #186940; color: white; text-align: left; font-size: 9px; padding: 8px; }
  td { border: 1px solid #557061; padding: 8px; vertical-align: top; min-height: 24px; }
  th:nth-child(1), td:nth-child(1) { width: 18%; }
  .notes, .receipt { margin-top: 18px; border: 1px solid #31543e; padding: 10px; }
  .notes h2, .receipt h2 { color: #186940; font-size: 13px; margin: 0 0 7px; }
  .receipt img { max-width: 100%; max-height: 560px; display: block; }
  .footer { border-top: 1px solid #31543e; margin-top: 25px; padding-top: 10px; color: #4f5e52; line-height: 1.5; }
</style></head><body>
  <div class="header"><div><h1>JOHN GORDON CONSTRUCTION INC.</h1><div class="address">830 Campbell Street, Unit #3, Cornwall, Ontario K6H 6L7<br>Tel: 613-932-1293</div></div><div><div class="number">${escapeHtml(formatPoNumber(po.po_number))}</div><div>Digital Purchase Order</div></div></div>
  <div class="fields">
    <div class="field"><span class="label">Date of Order</span>${escapeHtml(formatDate(po.order_date))}</div>
    <div class="field"><span class="label">Job #</span>${escapeHtml(po.job_number)}</div>
    <div class="field"><span class="label">To</span>${escapeHtml(po.supplier_name)}</div>
    <div class="field"><span class="label">Job Name</span>${escapeHtml(po.job_name)}</div>
  </div>
  <table><thead><tr><th>Qty. Ordered</th><th>Material Description</th></tr></thead><tbody>${rows}</tbody></table>
  ${po.notes ? `<section class="notes"><h2>Order Notes</h2>${escapeHtml(po.notes).replace(/\n/g, "<br>")}</section>` : ""}
  ${receipt}
  <div class="footer">Created by: ${escapeHtml(po.creator_name)}<br>Assigned to: ${escapeHtml(po.assigned_name || "Not assigned")}<br>Submitted by: ${escapeHtml(po.submitted_by_name || po.creator_name)}<br>Portal authorization record - no field signature required.</div>
</body></html>`;
}

async function getOutbox(db: any, outboxId: string) {
  const result = await db
    .from("digital_po_email_outbox")
    .select("id,po_id,submission_sequence,idempotency_key,delivery_status,lock_token")
    .eq("id", outboxId)
    .single();
  if (result.error) {
    throw new Error(result.error.message);
  }
  return result.data;
}

async function getPo(db: any, poId: string) {
  const [poResult, itemResult] = await Promise.all([
    db.from("digital_purchase_orders").select("*").eq("id", poId).single(),
    db.from("digital_po_items").select("*").eq("po_id", poId).order("sort_order"),
  ]);
  if (poResult.error || itemResult.error) {
    throw new Error((poResult.error || itemResult.error).message);
  }
  return { po: poResult.data, items: itemResult.data || [] };
}

async function downloadAttachment(db: any, path: string) {
  const result = await db.storage.from(TEMP_BUCKET).download(path);
  if (result.error || !result.data) {
    throw new Error(result.error?.message || `Temporary attachment ${path} could not be downloaded.`);
  }
  return result.data;
}

async function cleanTemporaryFiles(db: any, po: JsonRecord, outboxId: string, lockToken: string) {
  const paths = [po.pdf_storage_path, po.receipt_storage_path].filter(Boolean);
  let cleanupError = "";

  if (paths.length) {
    const removeResult = await db.storage.from(TEMP_BUCKET).remove(paths);
    if (removeResult.error) {
      cleanupError = removeResult.error.message;
    }
  }

  const completeResult = await db.rpc("digital_po_complete_temp_cleanup", {
    p_outbox_id: outboxId,
    p_lock_token: lockToken,
    p_success: !cleanupError,
    p_error: cleanupError || null,
  });
  if (completeResult.error) {
    throw new Error(completeResult.error.message);
  }
  return cleanupError ? { status: "cleanup_failed", error: cleanupError } : { status: "completed" };
}

async function processCleanup(db: any, job: JsonRecord) {
  const { po } = await getPo(db, job.po_id);
  return cleanTemporaryFiles(db, po, job.outbox_id, job.lock_token);
}

async function processSend(db: any, job: JsonRecord, toEmail: string) {
  const outbox = await getOutbox(db, job.outbox_id);
  const { po, items } = await getPo(db, job.po_id);
  let receiptDataUrl = "";
  if (po.receipt_storage_path) {
    const receiptBlob = await downloadAttachment(db, po.receipt_storage_path);
    receiptDataUrl = `data:${receiptBlob.type || "image/jpeg"};base64,${await blobToBase64(receiptBlob)}`;
  }

  const subject = [
    `JGC ${formatPoNumber(po.po_number)}`,
    po.job_number ? `Job ${po.job_number}` : "",
    po.supplier_name,
  ].filter(Boolean).join(" - ");

  const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      to: toEmail,
      subject,
      text: buildEmailText(po, items),
      body: buildEmailText(po, items),
      pdfHtml: buildPoPdfHtml(po, items, receiptDataUrl),
      pdfFileName: safeFilename(`${formatPoNumber(po.po_number)}.pdf`, "digital-purchase-order.pdf"),
      source: "digital_purchase_order",
      poNumber: formatPoNumber(po.po_number),
      idempotencyKey: outbox.idempotency_key,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Apps Script returned ${response.status} while sending ${formatPoNumber(po.po_number)}.`);
  }

  const providerId = `google-apps-script:${outbox.idempotency_key}`;

  const completeResult = await db.rpc("digital_po_complete_email_delivery", {
    p_outbox_id: job.outbox_id,
    p_lock_token: job.lock_token,
    p_provider_message_id: providerId,
  });
  if (completeResult.error || completeResult.data !== true) {
    throw new Error(completeResult.error?.message || "Email delivery could not be recorded.");
  }

  const cleanup = await cleanTemporaryFiles(db, po, job.outbox_id, job.lock_token);
  return { status: cleanup.status, provider_id: providerId, cleanup_error: cleanup.error || null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Use POST." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const toEmail = Deno.env.get("PO_TO_EMAIL") || DEFAULT_RECIPIENTS;

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, error: "Supabase function environment variables are missing." }, 500);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const claimResult = await db.rpc("digital_po_claim_email_jobs", { p_limit: MAX_PER_RUN });
  if (claimResult.error) {
    return jsonResponse({ success: false, error: claimResult.error.message }, 500);
  }

  const results: JsonRecord[] = [];
  const failures: JsonRecord[] = [];

  for (const job of claimResult.data || []) {
    try {
      const result = job.action === "cleanup"
        ? await processCleanup(db, job)
        : await processSend(db, job, toEmail);
      results.push({ outbox_id: job.outbox_id, po_id: job.po_id, action: job.action, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ outbox_id: job.outbox_id, po_id: job.po_id, action: job.action, error: message });

      if (job.action === "send") {
        await db.rpc("digital_po_fail_email_job", {
          p_outbox_id: job.outbox_id,
          p_lock_token: job.lock_token,
          p_error: message,
        }).catch(() => {});
      } else {
        await db.rpc("digital_po_complete_temp_cleanup", {
          p_outbox_id: job.outbox_id,
          p_lock_token: job.lock_token,
          p_success: false,
          p_error: message,
        }).catch(() => {});
      }
    }
  }

  return jsonResponse({
    success: failures.length === 0,
    claimed: (claimResult.data || []).length,
    results,
    failures,
  }, failures.length ? 207 : 200);
});
