import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TZ = "America/Toronto";
const CAL_NAME = "JGC Portal Schedule";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,OPTIONS" };

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function localDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function esc(value: unknown) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

function prop(name: string, value: unknown) {
  return fold(name + ":" + esc(value));
}

function ymd(value: string) {
  return String(value || "").replaceAll("-", "");
}

function dt(date: string, time: string) {
  return ymd(date) + "T" + String(time || "00:00").slice(0, 5).replace(":", "") + "00";
}

function stamp(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  return (Number.isNaN(date.getTime()) ? new Date() : date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function plus30(time: string) {
  const [h, m = "00"] = String(time || "00:00").slice(0, 5).split(":");
  const total = Number(h) * 60 + Number(m) + 30;
  return String(Math.floor(total / 60) % 24).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0");
}

function typeLabel(value: string | null) {
  const labels: Record<string, string> = {
    work: "Work",
    vehicle: "Equipment / Vehicle Appointment",
    training: "Training",
    general: "General",
  };
  return labels[String(value || "work").toLowerCase()] || "Schedule";
}

function scheduleSummary(e: any) {
  const title = e.title || e.job_name || e.location || typeLabel(e.event_type);
  return e.job_number && e.job_name && !String(title).includes(e.job_number) ? `${e.job_number} - ${title}` : title;
}

function scheduleDescription(e: any) {
  return [
    `Type: ${typeLabel(e.event_type)}`,
    e.job_name ? `Job: ${[e.job_number, e.job_name].filter(Boolean).join(" - ")}` : "",
    e.maintenance_reason ? `Reason: ${e.maintenance_reason}` : "",
    e.location ? `Location: ${e.location}` : "",
    Array.isArray(e.employee_names) && e.employee_names.length ? `Tagged: ${e.employee_names.join(", ")}` : "",
    e.created_by_name ? `Created By: ${e.created_by_name}` : "",
    e.notes ? `Notes: ${e.notes}` : "",
  ].filter(Boolean).join("\n");
}

function scheduleEvent(e: any) {
  const lines = [
    "BEGIN:VEVENT",
    prop("UID", `schedule-${e.id}@jgc-portal`),
    "DTSTAMP:" + stamp(e.updated_at || e.created_at),
    "LAST-MODIFIED:" + stamp(e.updated_at || e.created_at),
    prop("SUMMARY", scheduleSummary(e)),
    prop("DESCRIPTION", scheduleDescription(e)),
    prop("CATEGORIES", "JGC " + typeLabel(e.event_type)),
  ];
  if (e.location) lines.push(prop("LOCATION", e.location));
  if (e.start_time) {
    lines.push("DTSTART;TZID=" + TZ + ":" + dt(e.event_date, e.start_time));
    lines.push("DTEND;TZID=" + TZ + ":" + dt(e.event_date, e.end_time || plus30(e.start_time)));
  } else {
    lines.push("DTSTART;VALUE=DATE:" + ymd(e.event_date));
    lines.push("DTEND;VALUE=DATE:" + ymd(localDate(addDays(new Date(e.event_date + "T00:00:00"), 1))));
  }
  lines.push("END:VEVENT");
  return lines.map(fold).join("\r\n");
}

function vacationEvent(v: any) {
  const name = v.worker_display_name || v.worker_name || "Employee";
  const end = localDate(addDays(new Date((v.end_date || v.start_date) + "T00:00:00"), 1));
  return [
    "BEGIN:VEVENT",
    prop("UID", `vacation-${v.id}@jgc-portal`),
    "DTSTAMP:" + stamp(v.updated_at || v.created_at),
    "LAST-MODIFIED:" + stamp(v.updated_at || v.created_at),
    prop("SUMMARY", "Vacation - " + name),
    prop("DESCRIPTION", [`Type: Approved Vacation`, `Employee: ${name}`, v.request_type ? `Request Type: ${v.request_type}` : "", v.total_days ? `Total Days: ${v.total_days}` : ""].filter(Boolean).join("\n")),
    prop("CATEGORIES", "JGC Vacation"),
    "DTSTART;VALUE=DATE:" + ymd(v.start_date),
    "DTEND;VALUE=DATE:" + ymd(end),
    "END:VEVENT",
  ].map(fold).join("\r\n");
}

function header() {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//JGC Portal//Schedule Feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    prop("X-WR-CALNAME", CAL_NAME),
    prop("X-WR-CALDESC", "Schedule, appointments, training, general events, and approved vacations from the JGC Portal."),
    "X-WR-TIMEZONE:" + TZ,
    "REFRESH-INTERVAL;VALUE=DURATION:PT30M",
    "X-PUBLISHED-TTL:PT30M",
  ].map(fold).join("\r\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return Response.json({ success: false, error: "Use GET." }, { status: 405, headers: cors });
  const token = Deno.env.get("JGC_CALENDAR_FEED_TOKEN") || "";
  if (!token || new URL(req.url).searchParams.get("token") !== token) {
    return Response.json({ success: false, error: "Invalid calendar feed token." }, { status: 401, headers: cors });
  }
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return Response.json({ success: false, error: "Missing Supabase env vars." }, { status: 500, headers: cors });

  const db = createClient(url, key);
  const start = localDate(addDays(new Date(), -60));
  const end = localDate(addDays(new Date(), 370));
  const [schedules, vacations] = await Promise.all([
    db.from("schedule_events").select("*").gte("event_date", start).lte("event_date", end).order("event_date").order("start_time"),
    db.from("vacation_requests").select("id,worker_name,worker_display_name,start_date,end_date,request_type,total_days,status,created_at,updated_at").eq("status", "approved").gte("end_date", start).lte("start_date", end).order("start_date"),
  ]);
  if (schedules.error) return Response.json({ success: false, error: schedules.error.message }, { status: 500, headers: cors });
  if (vacations.error) return Response.json({ success: false, error: vacations.error.message }, { status: 500, headers: cors });

  const ics = [header(), ...(schedules.data || []).map(scheduleEvent), ...(vacations.data || []).map(vacationEvent), "END:VCALENDAR"].join("\r\n") + "\r\n";
  return new Response(ics, {
    headers: {
      ...cors,
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="jgc-portal-calendar.ics"',
      "Cache-Control": "no-store",
    },
  });
});
