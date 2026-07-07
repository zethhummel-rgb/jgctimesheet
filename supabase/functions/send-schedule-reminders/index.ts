import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_EMAILS = ["zeth@johngordonconstruction.com", "jeff@johngordonconstruction.com"];
const GOOGLE_SCRIPT_URL = Deno.env.get("SCHEDULE_EMAIL_SCRIPT_URL") ||
  "https://script.google.com/macros/s/AKfycbzPILTnOSzQcCkA6y5vSLxCH6i05Y2-ZHZAk09Und0YKiXZOYMppV4fvW3G6EgqOIZi/exec";
const TZ = "America/Toronto";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TWO_HOUR_MS = 2 * 60 * 60 * 1000;
const REMINDER_WINDOW_MS = 60 * 60 * 1000;

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

function dateValue(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDisplayDate(value: string) {
  // Use noon so UTC/server timezone conversion cannot roll the display back to the previous day.
  return new Date(value + "T12:00:00").toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: TZ,
  });
}

function formatDisplayDateTime(value: Date) {
  return value.toLocaleString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
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

function torontoParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

function torontoDateTimeToUtc(dateText: string, timeText: string) {
  const [year, month, day] = dateText.split("-").map(Number);
  const [hour, minute = 0] = timeText.slice(0, 5).split(":").map(Number);

  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) {
    return null;
  }

  const targetUtcWallTime = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utcTime = targetUtcWallTime;

  for (let index = 0; index < 3; index += 1) {
    const actual = torontoParts(new Date(utcTime));
    const actualUtcWallTime = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const adjustment = targetUtcWallTime - actualUtcWallTime;

    if (adjustment === 0) {
      return new Date(utcTime);
    }

    utcTime += adjustment;
  }

  return new Date(utcTime);
}

function eventDateTime(event: ScheduleEvent) {
  return torontoDateTimeToUtc(event.event_date, event.start_time || "07:00");
}

function shouldSendTimedReminder(start: Date | null, now: Date, offsetMs: number, alreadySent: string | null) {
  if (!start || alreadySent) {
    return false;
  }

  const dueAt = start.getTime() - offsetMs;
  const nowTime = now.getTime();

  return nowTime >= dueAt &&
    nowTime < dueAt + REMINDER_WINDOW_MS &&
    nowTime < start.getTime();
}

function eventTitle(event: ScheduleEvent) {
  return event.title || event.job_name || event.location || "Scheduled Event";
}

function eventBody(event: ScheduleEvent, reminderLabel: string, reminderSentAt: Date) {
  return [
    `JGC Schedule Reminder - ${reminderLabel}`,
    "",
    `Event Date: ${formatDisplayDate(event.event_date)}`,
    `Event Time: ${[formatTime(event.start_time), event.end_time ? "to " + formatTime(event.end_time) : ""].filter(Boolean).join(" ") || "All day / no time set"}`,
    `Reminder Sent: ${formatDisplayDateTime(reminderSentAt)}`,
    `Item: ${eventTitle(event)}`,
    `Job: ${event.job_name ? `${event.job_number ? event.job_number + " - " : ""}${event.job_name}` : ""}`,
    `Location: ${event.location || ""}`,
    `Tagged: ${(event.employee_names || []).join(", ")}`,
    "",
    "Notes:",
    event.notes || "",
  ].join("\n");
}

async function sendReminder(event: ScheduleEvent, creatorEmail: string, reminderLabel: string, reminderSentAt: Date) {
  const recipients = uniqueEmails([
    ...ADMIN_EMAILS,
    creatorEmail,
    ...(event.employee_emails || []),
  ]);

  if (!recipients.length) {
    return;
  }

  const body = eventBody(event, reminderLabel, reminderSentAt);
  await fetch(GOOGLE_SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify({
      to: recipients.join(","),
      subject: `JGC Schedule Reminder - ${eventTitle(event)} - Event ${formatDisplayDate(event.event_date)}`,
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
  const today = dateValue(now);
  const queryEndDate = dateValue(new Date(now.getTime() + ONE_DAY_MS + REMINDER_WINDOW_MS));

  const { data: events, error } = await supabase
    .from("schedule_events")
    .select("*")
    .gte("event_date", today)
    .lte("event_date", queryEndDate);

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
    const start = eventDateTime(event);

    if (shouldSendTimedReminder(start, now, ONE_DAY_MS, event.one_day_reminder_sent_at)) {
      await sendReminder(event, creatorEmail, "In 24 Hours", now);
      await supabase
        .from("schedule_events")
        .update({ one_day_reminder_sent_at: now.toISOString() })
        .eq("id", event.id);
      oneDaySent += 1;
    }

    if (shouldSendTimedReminder(start, now, TWO_HOUR_MS, event.two_hour_reminder_sent_at)) {
      await sendReminder(event, creatorEmail, "In 2 Hours", now);
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
    today,
    queryEndDate,
    oneDaySent,
    twoHourSent,
  });
});
