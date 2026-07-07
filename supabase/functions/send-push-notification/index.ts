import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const VAPID_PUBLIC_KEY = Deno.env.get("JGC_VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("JGC_VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("JGC_VAPID_SUBJECT") || "mailto:zeth@johngordonconstruction.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type NotificationRow = Record<string, any>;
type PushSubscriptionRow = Record<string, any>;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function cleanIdList(value: unknown) {
  const values = Array.isArray(value) ? value : [];
  return Array.from(new Set(values.map((item) => String(item || "").trim()).filter(Boolean))).slice(0, 50);
}

function notificationUrl(row: NotificationRow) {
  const link = String(row.link_url || "home.html").replace(/^\/+/, "");
  return "https://zethhummel-rgb.github.io/jgctimesheet/" + link;
}

function buildPayload(row: NotificationRow) {
  return JSON.stringify({
    title: row.title || "JGC Portal",
    body: row.message || "New portal notification",
    url: notificationUrl(row),
    link_url: row.link_url || "home.html",
    notification_id: row.id || "",
    tag: row.dedupe_key || row.id || "jgc-portal-notification",
    icon: "./icon-192.png?v=4",
    badge: "./icon-180.png?v=4",
  });
}

async function authenticateRequest(request: Request, supabase: ReturnType<typeof createClient>) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return false;
  }

  const { data, error } = await supabase.auth.getUser(token);
  return !error && Boolean(data && data.user);
}

async function loadSubscriptionsForNotification(
  supabase: ReturnType<typeof createClient>,
  row: NotificationRow,
) {
  let query = supabase
    .from("push_subscriptions")
    .select("*")
    .eq("enabled", true);

  if (row.target_profile_id) {
    query = query.eq("profile_id", row.target_profile_id);
  } else if (row.target_worker_email) {
    query = query.eq("worker_email", row.target_worker_email);
  } else if (row.target_worker_key) {
    query = query.eq("worker_key", row.target_worker_key);
  } else if (row.target_role) {
    query = query.eq("role", row.target_role);
  } else {
    return [];
  }

  const { data, error } = await query.limit(100);

  if (error) {
    console.warn("Push subscriptions could not be loaded.", error);
    return [];
  }

  return data || [];
}

async function logDelivery(
  supabase: ReturnType<typeof createClient>,
  notificationId: string,
  subscriptionId: string,
  status: string,
  errorMessage = "",
) {
  await supabase.from("push_delivery_log").insert({
    notification_id: notificationId,
    push_subscription_id: subscriptionId || null,
    status,
    error_message: errorMessage || null,
  });
}

async function sendToSubscription(
  supabase: ReturnType<typeof createClient>,
  notification: NotificationRow,
  subscription: PushSubscriptionRow,
) {
  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };

  try {
    await webpush.sendNotification(pushSubscription, buildPayload(notification));
    await supabase
      .from("push_subscriptions")
      .update({
        last_success_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", subscription.id);
    await logDelivery(supabase, notification.id, subscription.id, "sent");
    return { ok: true };
  } catch (error) {
    const statusCode = Number((error as any)?.statusCode || 0);
    const message = String((error as any)?.body || (error as any)?.message || error || "Push send failed.");
    const disable = statusCode === 404 || statusCode === 410;

    await supabase
      .from("push_subscriptions")
      .update({
        enabled: disable ? false : subscription.enabled,
        last_error_at: new Date().toISOString(),
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", subscription.id);
    await logDelivery(supabase, notification.id, subscription.id, "failed", message.slice(0, 500));
    return { ok: false, error: message };
  }
}

async function alreadySentToSubscription(
  supabase: ReturnType<typeof createClient>,
  notificationId: string,
  subscriptionId: string,
) {
  const { data, error } = await supabase
    .from("push_delivery_log")
    .select("id")
    .eq("notification_id", notificationId)
    .eq("push_subscription_id", subscriptionId)
    .eq("status", "sent")
    .limit(1);

  if (error) {
    console.warn("Push delivery log could not be checked.", error);
    return false;
  }

  return Boolean((data || []).length);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return jsonResponse({ success: false, error: "POST required." }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ success: false, error: "Supabase service credentials are not configured." }, 500);
  }

  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return jsonResponse({ success: false, error: "VAPID keys are not configured." }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (!await authenticateRequest(request, supabase)) {
    return jsonResponse({ success: false, error: "Unauthorized." }, 401);
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const body = await request.json().catch(() => ({}));
  const notificationIds = cleanIdList(body.notification_ids);

  if (!notificationIds.length) {
    return jsonResponse({ success: true, checked: 0, sent: 0, failures: [] });
  }

  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("id,notification_type,title,message,link_url,target_profile_id,target_worker_key,target_worker_email,target_role,dedupe_key,created_at,cleared_at")
    .in("id", notificationIds)
    .is("cleared_at", null);

  if (error) {
    return jsonResponse({ success: false, error: error.message }, 500);
  }

  let sent = 0;
  const failures: Record<string, unknown>[] = [];

  for (const notification of notifications || []) {
    const subscriptions = await loadSubscriptionsForNotification(supabase, notification);

    for (const subscription of subscriptions) {
      if (await alreadySentToSubscription(supabase, notification.id, subscription.id)) {
        continue;
      }

      const result = await sendToSubscription(supabase, notification, subscription);
      if (result.ok) {
        sent += 1;
      } else {
        failures.push({
          notification_id: notification.id,
          subscription_id: subscription.id,
          error: result.error,
        });
      }
    }
  }

  return jsonResponse({
    success: true,
    checked: (notifications || []).length,
    sent,
    failures,
  });
});
