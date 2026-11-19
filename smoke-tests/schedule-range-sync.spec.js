const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test, expect } = require("@playwright/test");
const ts = require("../estimating-app/node_modules/typescript");

function source(file) {
  return fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
}

test("subscribed calendars receive a single entry with the correct timed or all-day end", () => {
  const code = ts.transpileModule(source("supabase/functions/jgc-calendar-feed/index.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const feed = { exports: {}, require: () => ({}), Deno: { serve() {} } };
  vm.runInNewContext(code, feed);
  const event = { id: "crew-event", title: "Crew training", event_date: "2026-12-31", end_date: "2027-01-02" };
  const timed = feed.scheduleEvent({ ...event, start_time: "08:00", end_time: "16:00" });
  expect(timed.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  expect(timed).toContain("DTSTART;TZID=America/Toronto:20261231T080000");
  expect(timed).toContain("DTEND;TZID=America/Toronto:20270102T160000");
  expect(feed.scheduleEvent(event)).toContain("DTEND;VALUE=DATE:20270103");
  expect(feed.scheduleEvent({ ...event, end_date: null })).toContain("DTEND;VALUE=DATE:20270101");
  expect(feed.scheduleEvent({ ...event, end_date: null, start_time: "23:45" })).toContain("DTEND;TZID=America/Toronto:20270101T001500");
});

test("Google Calendar preserves both ends of a timed booking and inclusive all-day dates", () => {
  const calendar = { createEvent: (title, start, end) => ({ start, end, title }) };
  const script = { Date };
  vm.runInNewContext(source("google-calendar-apps-script.js"), script);
  script.getTargetCalendar_ = () => calendar;
  const dates = script.upsertGoogleCalendarEvent_({
    id: "sample", title: "Service visit", event_date: "2026-11-24", end_date: "2026-11-26", start_time: "15:00", end_time: "07:30"
  });
  expect([dates.start.getDate(), dates.start.getHours(), dates.end.getDate(), dates.end.getHours()]).toEqual([24, 15, 26, 7]);
  script.Session = { getScriptTimeZone: () => "America/Toronto" };
  script.Utilities = { formatDate(date, zone, format) {
    const options = format === "yyyy-MM-dd" ? { year: "numeric", month: "2-digit", day: "2-digit" } : { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, ...options }).format(date);
  } };
  const googleEvent = { getStartTime: () => new Date("2026-11-24T15:00:00-05:00"), getEndTime: () => new Date("2026-11-26T07:30:00-05:00"), isAllDayEvent: () => false, getTitle: () => dates.title, getDescription: () => "", getLocation: () => "" };
  expect(script.buildPortalUpdateFromGoogleEvent_(googleEvent)).toMatchObject({ event_date: "2026-11-24", end_date: "2026-11-26", start_time: "15:00:00", end_time: "07:30:00" });
  const beforeMidnight = { ...googleEvent, isAllDayEvent: () => true, getEndTime: () => new Date("2026-11-25T00:00:00-05:00") };
  expect(script.buildPortalUpdateFromGoogleEvent_(beforeMidnight).end_date).toBeNull();
});
