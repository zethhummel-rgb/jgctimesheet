/*
  JGC Portal Google Calendar Sync - release 1014 authorization

  Paste this into a Google Apps Script web app owned by the JGC Portal Google account.

  Script Properties required:
  - CALENDAR_ID: Google Calendar ID for the shared JGC calendar.
    Use "primary" only if you want the script account's primary calendar.
  - SUPABASE_URL: https://xnrljkkszoimegfivlya.supabase.co
  - SUPABASE_SERVICE_ROLE_KEY: your Supabase service role key.

  Update the existing Web App deployment to this version (keep its URL).
  Public requests must include a fresh one-use ticket issued by the signed-in Portal.
  Existing Script Properties and scheduled pull triggers remain in place.

  Deploy as Web App:
  - Execute as: Me
  - Who has access: Anyone
*/

function doGet() {
  return jsonResponse_({version: "1014-calendar-ticket", requires_ticket: true});
}

function claimCalendarTicket_(ticket) {
  var props = PropertiesService.getScriptProperties();
  var base = props.getProperty("SUPABASE_URL"), key = props.getProperty("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) throw new Error("Calendar service configuration unavailable.");
  var response = UrlFetchApp.fetch(base.replace(/\/$/, "") + "/rest/v1/rpc/claim_calendar_sync_ticket", {
    method: "post", contentType: "application/json", headers: {apikey: key, Authorization: "Bearer " + key},
    payload: JSON.stringify({p_ticket: ticket}), muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error("Calendar authorization unavailable.");
  var claimed = JSON.parse(response.getContentText());
  if (!claimed || ["upsert", "delete", "pull_google_updates"].indexOf(claimed.action) === -1) throw new Error("Invalid authorization response.");
  if (claimed.action !== "pull_google_updates" && (!claimed.event || ["schedule_events", "vacation_requests"].indexOf(claimed.event.sync_table) === -1 || !/^[0-9a-f-]{36}$/i.test(claimed.event.id))) throw new Error("Invalid Calendar source.");
  return claimed;
}

function doPost(e) {
  var claimed = null, lock = null;
  try {
    var body = e && e.postData && e.postData.contents;
    if (!body || body.length > 65536) throw new Error("Missing authorization.");
    var payload = JSON.parse(body);
    if (!payload || typeof payload.ticket !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.ticket)) throw new Error("Missing authorization.");
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw new Error("Calendar is busy.");
    claimed = claimCalendarTicket_(payload.ticket);
    if (claimed.action === "pull_google_updates") return jsonResponse_(pullGoogleCalendarUpdates_());
    var event = claimed.event;
    if (claimed.action === "delete") {
      deleteGoogleCalendarEvent_(event);
      updateSupabaseScheduleSync_(event, {google_event_id: null, google_sync_status: "not_synced", google_synced_at: null, google_sync_error: null});
      return jsonResponse_({success: true, action: "delete"});
    }
    var googleEvent = upsertGoogleCalendarEvent_(event);
    updateSupabaseScheduleSync_(event, {google_event_id: googleEvent.getId(), google_sync_status: "synced", google_synced_at: new Date().toISOString(), google_sync_error: null});
    return jsonResponse_({success: true, action: event.google_event_id ? "update" : "create"});
  } catch (err) {
    // A rejected/replayed public request never supplies a database patch target.
    if (claimed && claimed.event) {
      try { updateSupabaseScheduleSync_(claimed.event, {google_sync_status: "sync_failed", google_sync_error: "Calendar sync failed. Queue a fresh request from the Portal."}); } catch (_) {}
    }
    return jsonResponse_({success: false, error: "Calendar sync was rejected or failed. Retry from the Portal."});
  } finally {
    if (lock) lock.releaseLock();
  }
}

function scheduledPullGoogleUpdates() {
  pullGoogleCalendarUpdates_();
}

function fetchWithRetry_(url, options, operationName) {
  var transientCodes = { 408: true, 429: true, 500: true, 502: true, 503: true, 504: true };
  var delays = [500, 1500, 3500];
  var lastError = null;
  for (var attempt = 0; attempt <= delays.length; attempt++) {
    try {
      var response = UrlFetchApp.fetch(url, options);
      var code = response.getResponseCode();
      if (!transientCodes[code] || attempt === delays.length) {
        return response;
      }
      lastError = new Error(operationName + " received temporary HTTP " + code + ".");
    } catch (err) {
      lastError = err;
      if (attempt === delays.length) throw err;
    }
    Utilities.sleep(delays[attempt]);
  }
  throw lastError || new Error(operationName + " failed after retries.");
}

function upsertGoogleCalendarEvent_(event) {
  var calendar = getTargetCalendar_();
  var title = event.title || "[JGC] Schedule Event";
  var options = {
    description: event.description || "",
    location: event.location || ""
  };
  var googleEvent = event.google_event_id ? calendar.getEventById(event.google_event_id) : null;
  if (googleEvent && !calendarEventBelongsToPortal_(googleEvent, event.id)) throw new Error("Calendar source ownership does not match.");

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

function calendarEventBelongsToPortal_(googleEvent, portalId) {
  var marker = "Portal Event ID: " + portalId;
  return String(googleEvent.getDescription() || "").split(/\r?\n/).some(function(line) { return line.trim() === marker; });
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

    if (portalId && calendarEventBelongsToPortal_(candidate, portalId)) {
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
    if (!calendarEventBelongsToPortal_(googleEvent,event.id)) throw new Error("Calendar source ownership does not match.");
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

      if (!calendarEventBelongsToPortal_(googleEvent,portalEvent.id)) throw new Error("Calendar source ownership does not match.");
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
  var response = fetchWithRetry_(url, {
    method: "get",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey
    },
    muteHttpExceptions: true
  }, "Supabase schedule fetch");
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
  var response = fetchWithRetry_(url, {
    method: "patch",
    contentType: "application/json",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
      Prefer: "return=minimal"
    },
    payload: JSON.stringify(fields),
    muteHttpExceptions: true
  }, "Supabase schedule patch");
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
  var response = fetchWithRetry_(url, {
    method: "patch",
    contentType: "application/json",
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
      Prefer: "return=minimal"
    },
    payload: JSON.stringify(fields),
    muteHttpExceptions: true
  }, "Supabase sync update");
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
