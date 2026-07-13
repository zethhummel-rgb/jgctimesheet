import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TEMP_BUCKET = "digital-po-temp";
const MAX_PER_RUN = 5;

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
  const lines = items.map((item, index) => {
    const details = [
      item.stock_number ? `Stock ${item.stock_number}` : "",
      item.description,
      item.notes ? `Note: ${item.notes}` : "",
    ].filter(Boolean).join(" | ");
    return `${index + 1}. Ordered: ${item.quantity_ordered ?? ""} | Received: ${item.quantity_received ?? ""} | ${details}`;
  });

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
    po.receipt_attached ? "The receipt image is also attached." : "No receipt image was attached.",
  ].filter((line) => line !== "").join("\n");
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

async function processSend(db: any, job: JsonRecord, resendApiKey: string, fromEmail: string, toEmail: string) {
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured for the Digital PO email worker.");
  }
  const outbox = await getOutbox(db, job.outbox_id);
  const { po, items } = await getPo(db, job.po_id);

  if (!po.pdf_storage_path) {
    throw new Error("The temporary PO PDF path is missing.");
  }

  const pdfBlob = await downloadAttachment(db, po.pdf_storage_path);
  const attachments: JsonRecord[] = [{
    filename: `${formatPoNumber(po.po_number)}.pdf`,
    content: await blobToBase64(pdfBlob),
  }];

  if (po.receipt_storage_path) {
    const receiptBlob = await downloadAttachment(db, po.receipt_storage_path);
    attachments.push({
      filename: safeFilename(po.receipt_original_filename, `${formatPoNumber(po.po_number)}-receipt.jpg`),
      content: await blobToBase64(receiptBlob),
    });
  }

  const subject = [
    `JGC ${formatPoNumber(po.po_number)}`,
    po.job_number ? `Job ${po.job_number}` : "",
    po.supplier_name,
  ].filter(Boolean).join(" - ");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": outbox.idempotency_key,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject,
      text: buildEmailText(po, items),
      attachments,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Resend returned ${response.status}: ${safeText(result.message || result.name || "Email delivery failed.")}`);
  }

  const providerId = safeText(result.id);
  if (!providerId) {
    throw new Error("Resend accepted the request without returning a delivery ID.");
  }

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
  const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "Purchase Orders <onboarding@resend.dev>";
  const toEmail = Deno.env.get("PO_TO_EMAIL") || "darlene@johngordonconstruction.com";

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
        : await processSend(db, job, resendApiKey, fromEmail, toEmail);
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
