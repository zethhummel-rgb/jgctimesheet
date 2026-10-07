const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

// Release 1007 (database only): injury and accident reports are readable by admins, the injured worker and the
// filer; other safety records stay readable by every employee but only their creator (or the attendee, for
// their own acknowledgement) or an admin can change them. Rehearsed and checked against production; these tests
// keep the migration and the pages that depend on it in step.
const portalRoot = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(portalRoot, file), "utf8");
const migration = read("supabase/migrations/20261008120000_safety_record_privacy_1007.sql");
const policy = (name) => {
  const start = migration.indexOf(`create policy "${name}"`);
  expect(start, name).toBeGreaterThan(-1);
  return migration.slice(start, migration.indexOf(";", start));
};

test("injury and accident reports are readable by admins, the injured worker and the filer only", () => {
  const injury = policy("Admins, the injured employee and the filer read injury reports");
  for (const part of ["for select", "public.is_admin()", "jgc_current_worker_matches(employee_worker)", "jgc_current_worker_matches(created_by_worker)"]) expect(injury).toContain(part);
  const accident = policy("Admins, the injured worker and the filer read accident reports");
  for (const part of ["for select", "public.is_admin()", "jgc_current_worker_matches(injured_worker)", "jgc_current_worker_matches(report_maker_worker)", "jgc_current_worker_matches(created_by_worker)"]) expect(accident).toContain(part);
  expect(migration).toContain('drop policy if exists "Authenticated users can read employee injury reports" on public.employee_injury_reports;');
  expect(migration).toContain('drop policy if exists "Authenticated users can read accident reports" on public.accident_reports;');
  // Limited accounts keep their own-report policies.
  expect(migration).not.toMatch(/drop policy if exists "Limited access/);
});

test("every open 'any employee can change it' rule on safety records is replaced", () => {
  const removed = [
    ["Authenticated users can update incident reports", "incident_reports"],
    ["Authenticated users can update inspection records", "inspection_records"],
    ["Authenticated users can update toolbox talk reports", "toolbox_talk_reports"],
    ["Authenticated users can add toolbox attendance", "toolbox_talk_attendance"],
    ["Authenticated users can update toolbox attendance", "toolbox_talk_attendance"],
    ["Authenticated users can delete toolbox attendance", "toolbox_talk_attendance"],
    ["Authenticated users can add toolbox talks", "toolbox_talks"],
    ["Authenticated users can update toolbox talks", "toolbox_talks"],
    ["Authenticated users can add toolbox assignments", "toolbox_talk_assignments"],
    ["Authenticated users can update toolbox assignments", "toolbox_talk_assignments"],
    ["Approved users can update vehicle inspections", "vehicle_inspection_records"],
    ["Authenticated users can create safety acknowledgements", "safety_acknowledgements"],
    ["Authenticated users can update safety acknowledgements", "safety_acknowledgements"],
    ["Authenticated users can delete safety acknowledgements", "safety_acknowledgements"],
    ["Authenticated users can update employee injury acknowledgements", "employee_injury_acknowledgements"],
    ["Authenticated users can update accident acknowledgements", "accident_report_acknowledgements"]
  ];
  for (const [name, table] of removed) expect(migration).toContain(`drop policy if exists "${name}" on public.${table};`);
  // No replacement grants a change to every approved account.
  expect(migration).not.toMatch(/\(true AND private\.jgc_has_full_portal_access\(\)\)/i);
  for (const name of ["The creator or an admin updates inspection records", "The presenter or an admin updates toolbox talk reports", "The reporter or an admin updates incident reports"]) {
    expect(policy(name)).toContain("public.is_admin()");
  }
  // Reading stays open to every approved employee: no read policy on these tables is dropped.
  for (const name of ["inspection records", "toolbox talk reports", "safety acknowledgements", "incident reports", "toolbox attendance"]) {
    expect(migration).not.toContain(`"Authenticated users can read ${name}"`);
  }
});

test("acknowledgements: the attendee signs their own, the record creator manages the crew list", () => {
  const ack = policy("The creator, attendee or an admin updates safety acknowledgements");
  for (const part of ["jgc_is_safety_record_creator(record_type, record_id)", "jgc_safety_ack_is_mine(matched_employee_id, matched_employee_email, attendee_name, attendee_key)", "jgc_jsa_legacy_mutation(record_type, record_id)"]) expect(ack).toContain(part);
  // The database recognises the same aliases the Home page uses to show someone their acknowledgement.
  const aliases = read("safety-acknowledgements.js").match(/function safetyAckRowAliases[\s\S]*?\n}/)[0];
  for (const field of ["attendee_key", "attendee_name", "matched_employee_email"]) expect(aliases).toContain(field);
  // Home only ever signs the current worker's own rows.
  const home = read("home.html");
  expect(home).toMatch(/from\("toolbox_talk_attendance"\)\s*\.update\([\s\S]*?\.eq\("worker_name", currentWorker\)/);
  expect(home).toMatch(/from\("accident_report_acknowledgements"\)\s*\.update\([\s\S]*?\.eq\("worker_name", currentWorker\)/);
  expect(home).toMatch(/from\("employee_injury_acknowledgements"\)\s*\.update\([\s\S]*?\.eq\("worker_name", currentWorker\)/);
});

test("report forms record the filer and request the injured worker's acknowledgement the database accepts", () => {
  const injury = read("employee-injury-report.js");
  expect(injury).toContain("created_by_worker: normalizeWorkerName(window.JGCJobBoardContext?.worker?.key || worker.key)");
  expect(injury).toContain('from("employee_injury_acknowledgements").insert({ employee_injury_report_id: record.id, worker_name: record.employee_worker');
  const accident = read("accident-report.js");
  expect(accident).toContain("created_by_worker:window.JGCJobBoardContext?.worker?.key||currentWorker");
  expect(accident).toContain('from("accident_report_acknowledgements").insert({accident_report_id:record.id,worker_name:injured.workerName');
  const request = migration.slice(migration.indexOf("function private.jgc_can_request_injury_acknowledgement"));
  expect(request).toContain("lower(trim(coalesce(r.employee_worker, ''))) = lower(trim(coalesce(p_worker, '')))");
  expect(request).toContain("private.jgc_current_worker_matches(r.created_by_worker)");
});

test("pages only offer Edit to the creator or an admin, matching the database", () => {
  const today = read("todays-inspections.html");
  const manage = today.match(/function currentWorkerCanManageInspection[\s\S]*?\n}/)[0];
  expect(manage).toContain("isAdminWorker(current.key, current.role, current.email)");
  expect(manage).toContain("record && record.worker_name");
  expect(today).toContain("${currentWorkerCanManageInspection(record) ? `<button class=\"edit-button\"");
  const toolbox = read("toolbox-talks.html");
  expect(toolbox).toMatch(/function canEditLoadedToolboxReport\(report\) \{\s*const ownsReport = normalizeWorkerName\(report && report\.submitted_by_worker\) === currentWorker;\s*return ownsReport \|\| isAdminWorker/);
});

test("the Job Board lists and opens an attached injury or accident report only for the same people", () => {
  expect(migration).toContain("from public.job_board_documents d where d.board_id=b.id and (manage or private.jgc_can_read_injury_report(d.source_type,d.source_id))");
  expect(migration).toContain("if not private.jgc_can_read_injury_report(d.source_type,d.source_id) then raise exception ''Document access unavailable''");
  // Board downloads and emails go through the same open function as the signed-in caller.
  const handler = read("supabase/functions/jgc-job-board-document/handler.ts");
  expect(handler).toContain("caller.rpc('resolve_job_board_download'");
  const helper = migration.slice(migration.indexOf("function private.jgc_can_read_injury_report"), migration.indexOf("$f$;", migration.indexOf("function private.jgc_can_read_injury_report")));
  expect(helper).toContain("else true end"); // every other board document is unchanged
});
