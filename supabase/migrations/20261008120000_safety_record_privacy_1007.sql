-- Release 1007: who can read and change safety records (Zeth, 2026-10-07).
-- * Injury and accident reports: admins, the injured worker, and whoever filed the report (plus the named
--   report maker on accident reports). Previously every approved account could read them.
-- * Incident reports, inspections, JSAs, toolbox talks and safety acknowledgements: still readable by every
--   approved account, but only the creator (or the attendee, for their own acknowledgement) or an admin can
--   change them. Previously any approved account could rewrite or remove anyone's records.
-- * The Job Board shows an attached injury or accident report only to the same people.
-- Limited-account policies ("Limited access can read own ...") are unchanged.

create or replace function pg_temp.jgc_patch(def text, pattern text, replacement text, expected int)
returns text language plpgsql as $f$
declare found int;
begin
  select count(*) into found from regexp_matches(def, pattern, 'g');
  if found <> expected then
    raise exception 'Expected % match(es) of %, found %', expected, pattern, found;
  end if;
  return regexp_replace(def, pattern, replacement, 'g');
end $f$;

-- Helpers ---------------------------------------------------------------------------------------------------

-- The signed-in person may read this injury or accident report.
create or replace function private.jgc_can_read_injury_report(p_source_type text, p_id uuid)
returns boolean language sql stable security definer set search_path to '' as $f$
  select case p_source_type
    when 'employee_injury_reports' then exists (
      select 1 from public.employee_injury_reports r where r.id = p_id and (
        (select public.is_admin()) or private.jgc_current_worker_matches(r.employee_worker)
        or private.jgc_current_worker_matches(r.created_by_worker)))
    when 'accident_reports' then exists (
      select 1 from public.accident_reports r where r.id = p_id and (
        (select public.is_admin()) or private.jgc_current_worker_matches(r.injured_worker)
        or private.jgc_current_worker_matches(r.report_maker_worker) or private.jgc_current_worker_matches(r.created_by_worker)))
    else true end
$f$;

-- The signed-in person filed this report (or is an admin) and the acknowledgement is for its injured worker.
create or replace function private.jgc_can_request_injury_acknowledgement(p_source_type text, p_id uuid, p_worker text)
returns boolean language sql stable security definer set search_path to '' as $f$
  select case p_source_type
    when 'employee_injury_reports' then exists (
      select 1 from public.employee_injury_reports r where r.id = p_id
        and lower(trim(coalesce(r.employee_worker, ''))) = lower(trim(coalesce(p_worker, '')))
        and ((select public.is_admin()) or private.jgc_current_worker_matches(r.created_by_worker)))
    when 'accident_reports' then exists (
      select 1 from public.accident_reports r where r.id = p_id
        and lower(trim(coalesce(r.injured_worker, ''))) = lower(trim(coalesce(p_worker, '')))
        and ((select public.is_admin()) or private.jgc_current_worker_matches(r.created_by_worker)
          or private.jgc_current_worker_matches(r.report_maker_worker)))
    else false end
$f$;

-- The signed-in person created this JSA (inspection record) or toolbox talk report.
create or replace function private.jgc_is_safety_record_creator(p_record_type text, p_record_id uuid)
returns boolean language sql stable security definer set search_path to '' as $f$
  select case lower(coalesce(p_record_type, ''))
    when 'jsa' then exists (select 1 from public.inspection_records r where r.id = p_record_id and private.jgc_current_worker_matches(r.worker_name))
    when 'toolbox_talk' then exists (select 1 from public.toolbox_talk_reports r where r.id = p_record_id and private.jgc_current_worker_matches(r.submitted_by_worker))
    else false end
$f$;

-- This acknowledgement row is the signed-in person's own (matched account, email, name or key), the same
-- aliases the Portal uses to show it on their Home page.
create or replace function private.jgc_safety_ack_is_mine(p_matched_employee_id uuid, p_matched_employee_email text, p_attendee_name text, p_attendee_key text)
returns boolean language sql stable security definer set search_path to '' as $f$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.account_status in ('approved', 'limited') and (
      p.id = p_matched_employee_id
      or (coalesce(trim(p_matched_employee_email), '') <> '' and lower(trim(p_matched_employee_email)) = lower(trim(coalesce(p.email, ''))))
      or (coalesce(trim(p_attendee_name), '') <> '' and lower(trim(p_attendee_name)) in (lower(trim(coalesce(p.display_name, ''))), lower(trim(coalesce(p.worker_key, '')))))
      or (split_part(lower(trim(coalesce(p_attendee_key, ''))), '|', 1) <> ''
        and split_part(lower(trim(coalesce(p_attendee_key, ''))), '|', 1) in (lower(trim(coalesce(p.email, ''))), lower(trim(coalesce(p.worker_key, '')))))
    )
  )
$f$;

revoke all on function private.jgc_can_read_injury_report(text, uuid) from public, anon;
revoke all on function private.jgc_can_request_injury_acknowledgement(text, uuid, text) from public, anon;
revoke all on function private.jgc_is_safety_record_creator(text, uuid) from public, anon;
revoke all on function private.jgc_safety_ack_is_mine(uuid, text, text, text) from public, anon;
grant execute on function private.jgc_can_read_injury_report(text, uuid) to authenticated;
grant execute on function private.jgc_can_request_injury_acknowledgement(text, uuid, text) to authenticated;
grant execute on function private.jgc_is_safety_record_creator(text, uuid) to authenticated;
grant execute on function private.jgc_safety_ack_is_mine(uuid, text, text, text) to authenticated;

-- 1. Injury and accident reports ------------------------------------------------------------------------------
drop policy if exists "Authenticated users can read employee injury reports" on public.employee_injury_reports;
create policy "Admins, the injured employee and the filer read injury reports" on public.employee_injury_reports
for select to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin())
  or private.jgc_current_worker_matches(employee_worker) or private.jgc_current_worker_matches(created_by_worker)));

drop policy if exists "Authenticated users can read accident reports" on public.accident_reports;
create policy "Admins, the injured worker and the filer read accident reports" on public.accident_reports
for select to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin())
  or private.jgc_current_worker_matches(injured_worker) or private.jgc_current_worker_matches(report_maker_worker)
  or private.jgc_current_worker_matches(created_by_worker)));

-- Their acknowledgements belong to the injured worker; the filer creates one when saving the report.
drop policy if exists "Authenticated users can read employee injury acknowledgements" on public.employee_injury_acknowledgements;
drop policy if exists "Authenticated users can add employee injury acknowledgements" on public.employee_injury_acknowledgements;
drop policy if exists "Authenticated users can update employee injury acknowledgements" on public.employee_injury_acknowledgements;
create policy "Admins and the employee read injury acknowledgements" on public.employee_injury_acknowledgements
for select to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin()) or private.jgc_current_worker_matches(worker_name)));
create policy "The filer requests the injured employee's acknowledgement" on public.employee_injury_acknowledgements
for insert to authenticated
with check (private.jgc_has_full_portal_access()
  and private.jgc_can_request_injury_acknowledgement('employee_injury_reports', employee_injury_report_id, worker_name));
create policy "The employee acknowledges their injury report" on public.employee_injury_acknowledgements
for update to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin()) or private.jgc_current_worker_matches(worker_name)))
with check (private.jgc_has_full_portal_access() and ((select public.is_admin()) or private.jgc_current_worker_matches(worker_name)));

drop policy if exists "Authenticated users can read accident acknowledgements" on public.accident_report_acknowledgements;
drop policy if exists "Authenticated users can add accident acknowledgements" on public.accident_report_acknowledgements;
drop policy if exists "Authenticated users can update accident acknowledgements" on public.accident_report_acknowledgements;
create policy "Admins and the worker read accident acknowledgements" on public.accident_report_acknowledgements
for select to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin()) or private.jgc_current_worker_matches(worker_name)));
create policy "The filer requests the injured worker's acknowledgement" on public.accident_report_acknowledgements
for insert to authenticated
with check (private.jgc_has_full_portal_access()
  and private.jgc_can_request_injury_acknowledgement('accident_reports', accident_report_id, worker_name));
create policy "The worker acknowledges their accident report" on public.accident_report_acknowledgements
for update to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin()) or private.jgc_current_worker_matches(worker_name)))
with check (private.jgc_has_full_portal_access() and ((select public.is_admin()) or private.jgc_current_worker_matches(worker_name)));

-- 2. Records everyone reads but only the creator or an admin changes -----------------------------------------
drop policy if exists "Authenticated users can update incident reports" on public.incident_reports;
create policy "The reporter or an admin updates incident reports" on public.incident_reports
for update to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin()) or private.jgc_current_worker_matches(reported_by_worker)))
with check (private.jgc_has_full_portal_access() and ((select public.is_admin()) or private.jgc_current_worker_matches(reported_by_worker)));

drop policy if exists "Authenticated users can update inspection records" on public.inspection_records;
create policy "The creator or an admin updates inspection records" on public.inspection_records
for update to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin()) or private.jgc_current_worker_matches(worker_name)))
with check (worker_name is not null and length(trim(worker_name)) > 0 and inspection_type is not null and length(trim(inspection_type)) > 0
  and private.jgc_has_full_portal_access() and ((select public.is_admin()) or private.jgc_current_worker_matches(worker_name)));

drop policy if exists "Authenticated users can update toolbox talk reports" on public.toolbox_talk_reports;
create policy "The presenter or an admin updates toolbox talk reports" on public.toolbox_talk_reports
for update to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin()) or private.jgc_current_worker_matches(submitted_by_worker)))
with check (private.jgc_has_full_portal_access() and ((select public.is_admin()) or private.jgc_current_worker_matches(submitted_by_worker)));

-- Attendance: the presenter lists the crew; each worker marks their own row.
drop policy if exists "Authenticated users can add toolbox attendance" on public.toolbox_talk_attendance;
drop policy if exists "Authenticated users can update toolbox attendance" on public.toolbox_talk_attendance;
drop policy if exists "Authenticated users can delete toolbox attendance" on public.toolbox_talk_attendance;
create policy "The presenter or an admin adds toolbox attendance" on public.toolbox_talk_attendance
for insert to authenticated
with check (private.jgc_has_full_portal_access() and ((select public.is_admin())
  or private.jgc_is_safety_record_creator('toolbox_talk', report_id) or private.jgc_current_worker_matches(worker_name)));
create policy "The worker, presenter or an admin updates toolbox attendance" on public.toolbox_talk_attendance
for update to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin())
  or private.jgc_is_safety_record_creator('toolbox_talk', report_id) or private.jgc_current_worker_matches(worker_name)))
with check (private.jgc_has_full_portal_access() and ((select public.is_admin())
  or private.jgc_is_safety_record_creator('toolbox_talk', report_id) or private.jgc_current_worker_matches(worker_name)));
create policy "The presenter or an admin removes toolbox attendance" on public.toolbox_talk_attendance
for delete to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin()) or private.jgc_is_safety_record_creator('toolbox_talk', report_id)));

-- The toolbox talk library and assignments are managed from Admin.
drop policy if exists "Authenticated users can add toolbox talks" on public.toolbox_talks;
drop policy if exists "Authenticated users can update toolbox talks" on public.toolbox_talks;
create policy "Admins add toolbox talks" on public.toolbox_talks
for insert to authenticated with check ((select public.is_admin()) and private.jgc_has_full_portal_access());
create policy "Admins update toolbox talks" on public.toolbox_talks
for update to authenticated using ((select public.is_admin()) and private.jgc_has_full_portal_access())
with check ((select public.is_admin()) and private.jgc_has_full_portal_access());

drop policy if exists "Authenticated users can add toolbox assignments" on public.toolbox_talk_assignments;
drop policy if exists "Authenticated users can update toolbox assignments" on public.toolbox_talk_assignments;
create policy "Admins add toolbox assignments" on public.toolbox_talk_assignments
for insert to authenticated with check ((select public.is_admin()) and private.jgc_has_full_portal_access());
create policy "Admins update toolbox assignments" on public.toolbox_talk_assignments
for update to authenticated using ((select public.is_admin()) and private.jgc_has_full_portal_access())
with check ((select public.is_admin()) and private.jgc_has_full_portal_access());

-- Vehicle inspections are submitted through their functions; direct edits are the creator's or an admin's.
drop policy if exists "Approved users can update vehicle inspections" on public.vehicle_inspection_records;
create policy "The creator or an admin updates vehicle inspections" on public.vehicle_inspection_records
for update to authenticated
using (private.jgc_has_full_portal_access() and ((select public.is_admin()) or created_by = (select auth.uid())))
with check (private.jgc_has_full_portal_access() and ((select public.is_admin()) or created_by = (select auth.uid())));

-- Safety acknowledgements: the JSA or toolbox talk creator lists attendees and may record an acknowledgement on
-- their behalf; each attendee acknowledges their own row; admins can do either.
drop policy if exists "Authenticated users can create safety acknowledgements" on public.safety_acknowledgements;
drop policy if exists "Authenticated users can update safety acknowledgements" on public.safety_acknowledgements;
drop policy if exists "Authenticated users can delete safety acknowledgements" on public.safety_acknowledgements;
create policy "The creator, attendee or an admin creates safety acknowledgements" on public.safety_acknowledgements
for insert to authenticated
with check (record_type = any (array['jsa', 'toolbox_talk']) and attendee_name is not null and attendee_key is not null
  and private.jgc_has_full_portal_access() and private.jgc_jsa_legacy_mutation(record_type, record_id)
  and ((select public.is_admin()) or private.jgc_is_safety_record_creator(record_type, record_id)
    or private.jgc_safety_ack_is_mine(matched_employee_id, matched_employee_email, attendee_name, attendee_key)));
create policy "The creator, attendee or an admin updates safety acknowledgements" on public.safety_acknowledgements
for update to authenticated
using (record_type = any (array['jsa', 'toolbox_talk']) and attendee_key is not null
  and private.jgc_has_full_portal_access() and private.jgc_jsa_legacy_mutation(record_type, record_id)
  and ((select public.is_admin()) or private.jgc_is_safety_record_creator(record_type, record_id)
    or private.jgc_safety_ack_is_mine(matched_employee_id, matched_employee_email, attendee_name, attendee_key)))
with check (record_type = any (array['jsa', 'toolbox_talk']) and attendee_name is not null and attendee_key is not null
  and private.jgc_has_full_portal_access() and private.jgc_jsa_legacy_mutation(record_type, record_id)
  and ((select public.is_admin()) or private.jgc_is_safety_record_creator(record_type, record_id)
    or private.jgc_safety_ack_is_mine(matched_employee_id, matched_employee_email, attendee_name, attendee_key)));
create policy "The creator or an admin deletes safety acknowledgements" on public.safety_acknowledgements
for delete to authenticated
using (record_type = any (array['jsa', 'toolbox_talk']) and attendee_key is not null
  and private.jgc_has_full_portal_access() and private.jgc_jsa_legacy_mutation(record_type, record_id)
  and ((select public.is_admin()) or private.jgc_is_safety_record_creator(record_type, record_id)));

-- 3. Job Board: an attached injury or accident report is listed and opened only for the same people -----------
do $do$
declare def text;
begin
  def := pg_get_functiondef('private.jgc_job_board_model(uuid,uuid)'::regprocedure);
  def := pg_temp.jgc_patch(def, 'from public\.job_board_documents d where d\.board_id=b\.id',
    'from public.job_board_documents d where d.board_id=b.id and (manage or private.jgc_can_read_injury_report(d.source_type,d.source_id))', 1);
  execute def;

  def := pg_get_functiondef('private.jgc_job_board_read_document(text,uuid,uuid)'::regprocedure);
  def := pg_temp.jgc_patch(def, '  if manage then return d; end if;',
    E'  if manage then return d; end if;\n  if not private.jgc_can_read_injury_report(d.source_type,d.source_id) then raise exception ''Document access unavailable'' using errcode=''42501''; end if;', 1);
  execute def;
end $do$;
