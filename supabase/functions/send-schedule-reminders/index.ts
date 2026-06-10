import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_EMAILS = ["zeth@johngordonconstruction.com", "jeff@johngordonconstruction.com"];
const GOOGLE_SCRIPT_URL = Deno.env.get("SCHEDULE_EMAIL_SCRIPT_URL") ||
  "https://script.google.com/macros/s/AKfycbzPILTnOSzQcCkA6y5vSLxCH6i05Y2-ZHZAk09Und0YKiXZOYMppV4fvW3G6EgqOIZi/exec";

type ScheduleEvent = {
  id: string;
  event_type: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  title: string | null;
  job_name: string | null;
  job_number: string | null;
  location: string | null;
  notes: string | null;
  employee_names: string[] | null;
  employee_emails: string[] | null;
  created_by: string | null;
  created_by_name: string | null;
  one_day_reminder_sent_at: string | null;
  two_hour_reminder_sent_at: string | null;
};

type Profile = {
  id: string;
  email: string | null;
};

function uniqueEmails(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateValue(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDisplayDate(value: string) {
  return new Date(value + "T00:00:00").toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Toronto",
  });
}

function formatTime(value: string | null) {
  if (!value) {
    return "";
  }

  const [hourValue, minuteValue = "00"] = value.slice(0, 5).split(":");
  const hour = Number(hourValue);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minuteValue} ${suffix}`;
}

function eventDateTime(event: ScheduleEvent) {
  if (!event.start_time) {
    return null;
  }

  return new Date(`${event.event_date}T${event.start_time.slice(0, 5)}:00-04:00`);
}

function eventTitle(event: ScheduleEvent) {
  return event.title || event.job_name || event.location || "Scheduled Event";
}

function eventBody(event: ScheduleEvent, reminderLabel: string) {
  return [
    `JGC Schedule Reminder - ${reminderLabel}`,
    "",
    `Date: ${formatDisplayDate(event.event_date)}`,
    `Time: ${[formatTime(event.start_time), event.end_time ? "to " + formatTime(event.end_time) : ""].filter(Boolean).join(" ") || "All day / no time set"}`,
    `Item: ${eventTitle(event)}`,
    `Job: ${event.job_name ? `${event.job_number ? event.job_number + " - " : ""}${event.job_name}` : ""}`,
    `Location: ${event.location || ""}`,
    `Tagged: ${(event.employee_names || []).join(", ")}`,
    "",
    "Notes:",
    event.notes || "",
  ].join("\n");
}

async function sendReminder(event: ScheduleEvent, creatorEmail: string, reminderLabel: string) {
  const recipients = uniqueEmails([
    ...ADMIN_EMAILS,
    creatorEmail,
    ...(event.employee_emails || []),
  ]);

  if (!recipients.length) {
    return;
  }

  const body = eventBody(event, reminderLabel);
  await fetch(GOOGLE_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      to: recipients.join(","),
      subject: `JGC Schedule Reminder - ${eventTitle(event)} - ${event.event_date}`,
      body,
      text: body,
      pdfHtml: `<html><body><pre>${body.replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[char] || char))}</pre></body></html>`,
      pdfFileName: `jgc-schedule-reminder-${event.event_date}.pdf`,
      source: "schedule_reminder",
    }),
  });
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ success: false, error: "Missing Supabase function environment variables." }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const now = new Date();
  const tomorrow = dateValue(addDays(now, 1));
  const today = dateValue(now);
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const twoHourEndDate = dateValue(twoHoursFromNow);

  const { data: events, error } = await supabase
    .from("schedule_events")
    .select("*")
    .or(`event_date.eq.${tomorrow},event_date.gte.${today}`);

  if (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }

  const creatorIds = uniqueEmails((events || []).map((event: ScheduleEvent) => event.created_by || ""));
  const { data: profiles } = creatorIds.length
    ? await supabase.from("profiles").select("id,email").in("id", creatorIds)
    : { data: [] as Profile[] };
  const profileEmailById = new Map((profiles || []).map((profile: Profile) => [profile.id, profile.email || ""]));

  let oneDaySent = 0;
  let twoHourSent = 0;

  for (const event of (events || []) as ScheduleEvent[]) {
    const creatorEmail = event.created_by ? profileEmailById.get(event.created_by) || "" : "";

    if (event.event_date === tomorrow && !event.one_day_reminder_sent_at) {
      await sendReminder(event, creatorEmail, "Tomorrow");
      await supabase
        .from("schedule_events")
        .update({ one_day_reminder_sent_at: now.toISOString() })
        .eq("id", event.id);
      oneDaySent += 1;
    }

    const start = eventDateTime(event);
    if (
      start &&
      event.event_date >= today &&
      event.event_date <= twoHourEndDate &&
      start > now &&
      start <= twoHoursFromNow &&
      !event.two_hour_reminder_sent_at
    ) {
      await sendReminder(event, creatorEmail, "In 2 Hours");
      await supabase
        .from("schedule_events")
        .update({ two_hour_reminder_sent_at: now.toISOString() })
        .eq("id", event.id);
      twoHourSent += 1;
    }
  }

  return Response.json({
    success: true,
    checked: (events || []).length,
    oneDaySent,
    twoHourSent,
  });
});
