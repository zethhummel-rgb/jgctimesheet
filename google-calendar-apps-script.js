/*
  JGC Portal Google Calendar Sync

  Paste this into a Google Apps Script web app owned by the JGC Portal Google account.

  Script Properties required:
  - CALENDAR_ID: Google Calendar ID for the shared JGC calendar.
    Use "primary" only if you want the script account's primary calendar.
  - SUPABASE_URL: https://xnrljkkszoimegfivlya.supabase.co
  - SUPABASE_SERVICE_ROLE_KEY: your Supabase service role key.

  Deploy as Web App:
  - Execute as: Me
  - Who has access: Anyone
*/

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("Missing POST body.");
    }

    var payload = JSON.parse(e.postData.contents);
    var action = String(payload.action || "upsert").toLowerCase();
    var event = payload.event || {};

    if (!event.id) {
      throw new Error("Missing portal event ID.");
    }

    if (action === "delete") {
      deleteGoogleCalendarEvent_(event);
      updateSupabaseScheduleSync_(event, {
        google_event_id: null,
        google_sync_status: "not_synced",
        google_synced_at: null,
        google_sync_error: null
      });
      return jsonResponse_({ success: true, action: "delete" });
    }

    var googleEvent = upsertGoogleCalendarEvent_(event);
    updateSupabaseScheduleSync_(event, {
      google_event_id: googleEvent.getId(),
      google_sync_status: "synced",
      google_synced_at: new Date().toISOString(),
      google_sync_error: null
    });

    return jsonResponse_({
      success: true,
      action: event.google_event_id ? "update" : "create",
      google_event_id: googleEvent.getId()
    });
  } catch (err) {
    var message = err && err.message ? err.message : String(err);
    try {
      var failedPayload = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
      var failedEvent = failedPayload.event || {};

      if (failedEvent.id) {
        updateSupabaseScheduleSync_(failedEvent, {
          google_sync_status: "sync_failed",
          google_sync_error: message
        });
      }
    } catch (updateErr) {
      // Keep the original sync error as the response.
    }

    return jsonResponse_({ success: false, error: message });
  }
}

function upsertGoogleCalendarEvent_(event) {
  var calendar = getTargetCalendar_();
  var title = event.title || "[JGC] Schedule Event";
  var options = {
    description: event.description || "",
    location: event.location || ""
  };
  var googleEvent = event.google_event_id ? calendar.getEventById(event.google_event_id) : null;

  if (event.all_day) {
    var allDayStart = buildAllDayDate_(event.event_date);
    var allDayEnd = buildAllDayDate_(event.end_date || event.event_date);
    allDayEnd.setDate(allDayEnd.getDate() + 1);

    if (googleEvent) {
      googleEvent.deleteEvent();
    }

    return calendar.createAllDayEvent(title, allDayStart, allDayEnd, options);
  }

  var start = buildEventDate_(event.event_date, event.start_time || "07:00");
  var end = buildEventDate_(event.event_date, event.end_time || "07:30");

  if (end <= start) {
    end = new Date(start.getTime() + 30 * 60 * 1000);
  }

  if (googleEvent) {
    googleEvent.setTitle(title);
    googleEvent.setTime(start, end);
    googleEvent.setDescription(options.description);
    googleEvent.setLocation(options.location);
    return googleEvent;
  }

  return calendar.createEvent(title, start, end, options);
}

function deleteGoogleCalendarEvent_(event) {
  if (!event.google_event_id) {
    return;
  }

  var calendar = getTargetCalendar_();
  var googleEvent = calendar.getEventById(event.google_event_id);

  if (googleEvent) {
    googleEvent.deleteEvent();
  }
}

function getTargetCalendar_() {
  var calendarId = PropertiesService.getScriptProperties().getProperty("CALENDAR_ID") || "primary";
  var calendar = calendarId === "primary"
    ? CalendarApp.getDefaultCalendar()
    : CalendarApp.getCalendarById(calendarId);

  if (!calendar) {
    throw new Error("Google Calendar not found. Check CALENDAR_ID in Script Properties.");
  }

  return calendar;
}

function buildEventDate_(dateValue, timeValue) {
  var parts = String(dateValue || "").split("-");
  var timeParts = String(timeValue || "07:00").slice(0, 5).split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid event date.");
  }

  return new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2]),
    Number(timeParts[0] || 7),
    Number(timeParts[1] || 0),
    0,
    0
  );
}

function buildAllDayDate_(dateValue) {
  var parts = String(dateValue || "").split("-");

  if (parts.length !== 3) {
    throw new Error("Invalid all-day event date.");
  }

  return new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2]),
    0,
    0,
    0,
    0
  );
}

function getSupabaseSyncTable_(event) {
  var table = String(event.sync_table || "schedule_events");
  return table === "vacation_requests" ? "vacation_requests" : "schedule_events";
}

function updateSupabaseScheduleSync_(event, fields) {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = props.getProperty("SUPABASE_URL");
  var serviceRoleKey = props.getProperty("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Script Properties.");
  }

  var url = supabaseUrl.replace(/\/$/, "") + "/rest/v1/" + getSupabaseSyncTable_(event) + "?id=eq." + encodeURIComponent(event.id);
  var response = UrlFetchApp.fetch(url, {
    method: "patch",
    contentType: "application/json",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
      Prefer: "return=minimal"
    },
    payload: JSON.stringify(fields),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    throw new Error("Supabase sync update failed: " + code + " " + response.getContentText());
  }
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function testCalendarSync() {
  var fakeEvent = {
    id: "test-" + Date.now(),
    event_date: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"),
    start_time: "07:00",
    end_time: "07:30",
    title: "[JGC] Calendar Sync Test",
    description: "Created from JGC Portal testCalendarSync().",
    location: "JGC Portal"
  };
  var googleEvent = upsertGoogleCalendarEvent_(fakeEvent);
  Logger.log("Created Google event: " + googleEvent.getId());
}
