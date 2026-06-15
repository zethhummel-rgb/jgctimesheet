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

    if (action === "pull_google_updates") {
      return jsonResponse_(pullGoogleCalendarUpdates_());
    }

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

    if (!googleEvent) {
      googleEvent = findExistingGoogleCalendarEvent_(calendar, title, allDayStart, allDayEnd, event.id);
    }

    if (googleEvent) {
      googleEvent.setTitle(title);
      googleEvent.setAllDayDates(allDayStart, allDayEnd);
      googleEvent.setDescription(options.description);
      googleEvent.setLocation(options.location);
      return googleEvent;
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

function findExistingGoogleCalendarEvent_(calendar, title, start, end, portalId) {
  var searchStart = new Date(start.getTime());
  var searchEnd = new Date(end.getTime());

  searchStart.setDate(searchStart.getDate() - 7);
  searchEnd.setDate(searchEnd.getDate() + 7);

  var candidates = calendar.getEvents(searchStart, searchEnd, { search: portalId || title });

  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    var description = candidate.getDescription() || "";

    if ((portalId && description.indexOf(portalId) !== -1) || candidate.getTitle() === title) {
      return candidate;
    }
  }

  return null;
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

function pullGoogleCalendarUpdates_() {
  var events = fetchSupabaseSyncedScheduleEvents_();
  var calendar = getTargetCalendar_();
  var updated = 0;
  var missing = 0;
  var errors = [];

  for (var i = 0; i < events.length; i++) {
    var portalEvent = events[i];

    try {
      var googleEvent = calendar.getEventById(portalEvent.google_event_id);

      if (!googleEvent) {
        missing++;
        patchSupabaseScheduleEvent_(portalEvent.id, {
          google_sync_status: "sync_failed",
          google_sync_error: "Google event was not found. It may have been deleted in Google Calendar."
        });
        continue;
      }

      patchSupabaseScheduleEvent_(portalEvent.id, buildPortalUpdateFromGoogleEvent_(googleEvent));
      updated++;
    } catch (err) {
      errors.push((portalEvent.id || "unknown") + ": " + (err && err.message ? err.message : String(err)));
    }
  }

  return {
    success: !errors.length,
    action: "pull_google_updates",
    checked: events.length,
    updated: updated,
    missing: missing,
    errors: errors
  };
}

function fetchSupabaseSyncedScheduleEvents_() {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = props.getProperty("SUPABASE_URL");
  var serviceRoleKey = props.getProperty("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Script Properties.");
  }

  var url = supabaseUrl.replace(/\/$/, "") + "/rest/v1/schedule_events?select=id,google_event_id&google_event_id=not.is.null";
  var response = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey
    },
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    throw new Error("Supabase schedule fetch failed: " + code + " " + response.getContentText());
  }

  return JSON.parse(response.getContentText() || "[]");
}

function buildPortalUpdateFromGoogleEvent_(googleEvent) {
  var start = googleEvent.getStartTime();
  var end = googleEvent.getEndTime();

  return {
    event_date: Utilities.formatDate(start, Session.getScriptTimeZone(), "yyyy-MM-dd"),
    start_time: Utilities.formatDate(start, Session.getScriptTimeZone(), "HH:mm:ss"),
    end_time: Utilities.formatDate(end, Session.getScriptTimeZone(), "HH:mm:ss"),
    title: stripJgcPrefix_(googleEvent.getTitle()),
    notes: extractEditableNotes_(googleEvent.getDescription() || ""),
    location: googleEvent.getLocation() || null,
    google_sync_status: "synced",
    google_synced_at: new Date().toISOString(),
    google_sync_error: null
  };
}

function stripJgcPrefix_(title) {
  return String(title || "").replace(/^\[JGC\]\s*/i, "").trim();
}

function extractEditableNotes_(description) {
  return String(description || "")
    .split("Created from JGC Portal.")[0]
    .replace(/^Job:.*$/gmi, "")
    .replace(/^Employees:.*$/gmi, "")
    .replace(/^Vehicle \/ Equipment:.*$/gmi, "")
    .replace(/^Location:.*$/gmi, "")
    .replace(/^Reason:.*$/gmi, "")
    .replace(/^Portal Event ID:.*$/gmi, "")
    .replace(/^Notes:\s*/gmi, "")
    .trim();
}

function patchSupabaseScheduleEvent_(eventId, fields) {
  var props = PropertiesService.getScriptProperties();
  var supabaseUrl = props.getProperty("SUPABASE_URL");
  var serviceRoleKey = props.getProperty("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Script Properties.");
  }

  var url = supabaseUrl.replace(/\/$/, "") + "/rest/v1/schedule_events?id=eq." + encodeURIComponent(eventId);
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
    throw new Error("Supabase schedule patch failed: " + code + " " + response.getContentText());
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

  if (table === "vacation_requests" || String(event.event_type || "").toLowerCase() === "vacation") {
    return "vacation_requests";
  }

  return "schedule_events";
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
