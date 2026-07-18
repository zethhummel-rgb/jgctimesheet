-- Remove unintended anonymous table access while preserving authenticated portal behavior.
-- Public subcontractor forms retain insert-only access, and active toolbox-talk metadata
-- remains readable so the public toolbox workflow can render its approved documents.

-- Employee-only timesheet data.
drop policy if exists "Public can delete worker timesheet entries" on public.timesheet_entries;
drop policy if exists "Public can add valid timesheet entries" on public.timesheet_entries;
drop policy if exists "Public can read timesheet entries" on public.timesheet_entries;
drop policy if exists "Public can update worker timesheet entries" on public.timesheet_entries;

create policy "Authenticated users can delete worker timesheet entries"
on public.timesheet_entries for delete to authenticated
using (
  length(trim(worker_name)) between 1 and 100
);

create policy "Authenticated users can add valid timesheet entries"
on public.timesheet_entries for insert to authenticated
with check (
  length(trim(worker_name)) between 1 and 100
  and length(trim(job_name)) between 1 and 150
  and length(trim(job_number)) <= 50
  and day_of_week = any (array[
    'Sunday'::text, 'Monday'::text, 'Tuesday'::text, 'Wednesday'::text,
    'Thursday'::text, 'Friday'::text, 'Saturday'::text
  ])
  and hours between 0 and 24
);

create policy "Authenticated users can read timesheet entries"
on public.timesheet_entries for select to authenticated
using (true);

create policy "Authenticated users can update worker timesheet entries"
on public.timesheet_entries for update to authenticated
using (
  length(trim(worker_name)) between 1 and 100
)
with check (
  length(trim(worker_name)) between 1 and 100
  and length(trim(job_name)) between 1 and 150
  and length(trim(job_number)) <= 50
  and day_of_week = any (array[
    'Sunday'::text, 'Monday'::text, 'Tuesday'::text, 'Wednesday'::text,
    'Thursday'::text, 'Friday'::text, 'Saturday'::text
  ])
  and hours between 0 and 24
);

revoke all on table public.timesheet_entries from anon;

drop policy if exists "Public can delete previous timesheet weeks" on public.previous_timesheet_weeks;
drop policy if exists "Public can add previous timesheet weeks" on public.previous_timesheet_weeks;
drop policy if exists "Public can read previous timesheet weeks" on public.previous_timesheet_weeks;

create policy "Authenticated users can delete previous timesheet weeks"
on public.previous_timesheet_weeks for delete to authenticated
using (
  length(trim(worker_name)) between 1 and 100
);

create policy "Authenticated users can add previous timesheet weeks"
on public.previous_timesheet_weeks for insert to authenticated
with check (
  length(trim(worker_name)) between 1 and 100
  and length(trim(week_label)) between 1 and 100
  and jsonb_typeof(entries) = 'array'
  and total_hours >= 0
  and length(note) <= 2000
);

create policy "Authenticated users can read previous timesheet weeks"
on public.previous_timesheet_weeks for select to authenticated
using (true);

revoke all on table public.previous_timesheet_weeks from anon;

-- Certificates are employee/admin records only.
drop policy if exists "Public can add certificates" on public.certificates;
drop policy if exists "Public can read certificates" on public.certificates;

create policy "Authenticated users can add certificates"
on public.certificates for insert to authenticated
with check (
  length(trim(worker_name)) between 1 and 100
  and length(trim(certificate_name)) between 1 and 150
  and length(trim(file_path)) between 1 and 500
  and length(trim(file_name)) between 1 and 255
  and length(trim(file_type)) between 1 and 120
  and length(notes) <= 2000
);

create policy "Authenticated users can read certificates"
on public.certificates for select to authenticated
using (true);

revoke all on table public.certificates from anon;

-- Inspections may be submitted from the subcontractor/QR workflow, but anonymous
-- clients cannot browse or change stored inspection history.
drop policy if exists "Anyone can add inspection records" on public.inspection_records;
drop policy if exists "Subcontractors can submit inspection_records" on public.inspection_records;
drop policy if exists "Anyone can read inspection records" on public.inspection_records;
drop policy if exists "Anyone can update inspection records" on public.inspection_records;

create policy "Authenticated users can add inspection records"
on public.inspection_records for insert to authenticated
with check (
  worker_name is not null and length(trim(worker_name)) > 0
  and inspection_type is not null and length(trim(inspection_type)) > 0
);

create policy "Authenticated users can read inspection records"
on public.inspection_records for select to authenticated
using (true);

create policy "Authenticated users can update inspection records"
on public.inspection_records for update to authenticated
using (true)
with check (
  worker_name is not null and length(trim(worker_name)) > 0
  and inspection_type is not null and length(trim(inspection_type)) > 0
);

create policy "Anonymous users can submit inspection records"
on public.inspection_records for insert to anon
with check (
  worker_name is not null and length(trim(worker_name)) > 0
  and inspection_type is not null and length(trim(inspection_type)) > 0
);

revoke all on table public.inspection_records from anon;
grant insert on table public.inspection_records to anon;

-- Accident and injury forms remain public insert-only workflows.
drop policy if exists "Subcontractors can submit accident_reports" on public.accident_reports;
drop policy if exists "accident_reports_insert" on public.accident_reports;
drop policy if exists "accident_reports_select" on public.accident_reports;

create policy "Authenticated users can add accident reports"
on public.accident_reports for insert to authenticated
with check (true);

create policy "Authenticated users can read accident reports"
on public.accident_reports for select to authenticated
using (true);

create policy "Anonymous users can submit accident reports"
on public.accident_reports for insert to anon
with check (true);

revoke all on table public.accident_reports from anon;
grant insert on table public.accident_reports to anon;

drop policy if exists "Subcontractors can submit accident_report_acknowledgements" on public.accident_report_acknowledgements;
drop policy if exists "accident_ack_insert" on public.accident_report_acknowledgements;
drop policy if exists "accident_ack_select" on public.accident_report_acknowledgements;
drop policy if exists "accident_ack_update" on public.accident_report_acknowledgements;

create policy "Authenticated users can add accident acknowledgements"
on public.accident_report_acknowledgements for insert to authenticated
with check (true);

create policy "Authenticated users can read accident acknowledgements"
on public.accident_report_acknowledgements for select to authenticated
using (true);

create policy "Authenticated users can update accident acknowledgements"
on public.accident_report_acknowledgements for update to authenticated
using (true) with check (true);

create policy "Anonymous users can submit accident acknowledgements"
on public.accident_report_acknowledgements for insert to anon
with check (true);

revoke all on table public.accident_report_acknowledgements from anon;
grant insert on table public.accident_report_acknowledgements to anon;

drop policy if exists "Subcontractors can submit employee_injury_reports" on public.employee_injury_reports;
drop policy if exists "employee_injury_insert" on public.employee_injury_reports;
drop policy if exists "employee_injury_select" on public.employee_injury_reports;

create policy "Authenticated users can add employee injury reports"
on public.employee_injury_reports for insert to authenticated
with check (true);

create policy "Authenticated users can read employee injury reports"
on public.employee_injury_reports for select to authenticated
using (true);

create policy "Anonymous users can submit employee injury reports"
on public.employee_injury_reports for insert to anon
with check (true);

revoke all on table public.employee_injury_reports from anon;
grant insert on table public.employee_injury_reports to anon;

drop policy if exists "Subcontractors can submit employee_injury_acknowledgements" on public.employee_injury_acknowledgements;
drop policy if exists "employee_injury_ack_insert" on public.employee_injury_acknowledgements;
drop policy if exists "employee_injury_ack_select" on public.employee_injury_acknowledgements;
drop policy if exists "employee_injury_ack_update" on public.employee_injury_acknowledgements;

create policy "Authenticated users can add employee injury acknowledgements"
on public.employee_injury_acknowledgements for insert to authenticated
with check (true);

create policy "Authenticated users can read employee injury acknowledgements"
on public.employee_injury_acknowledgements for select to authenticated
using (true);

create policy "Authenticated users can update employee injury acknowledgements"
on public.employee_injury_acknowledgements for update to authenticated
using (true) with check (true);

create policy "Anonymous users can submit employee injury acknowledgements"
on public.employee_injury_acknowledgements for insert to anon
with check (true);

revoke all on table public.employee_injury_acknowledgements from anon;
grant insert on table public.employee_injury_acknowledgements to anon;

-- Incident reports are inserted once with their uploaded-photo metadata. Anonymous
-- clients no longer receive read or update access to existing reports.
drop policy if exists "Incident reports insertable" on public.incident_reports;
drop policy if exists "Subcontractors can submit incident_reports" on public.incident_reports;
drop policy if exists "Incident reports readable" on public.incident_reports;
drop policy if exists "Incident reports updateable" on public.incident_reports;

create policy "Authenticated users can add incident reports"
on public.incident_reports for insert to authenticated
with check (true);

create policy "Authenticated users can read incident reports"
on public.incident_reports for select to authenticated
using (true);

create policy "Authenticated users can update incident reports"
on public.incident_reports for update to authenticated
using (true) with check (true);

create policy "Anonymous users can submit incident reports"
on public.incident_reports for insert to anon
with check (true);

revoke all on table public.incident_reports from anon;
grant insert on table public.incident_reports to anon;

-- Keep creator-side insert-only acknowledgement setup for public JSA/toolbox forms.
-- Actual QR reads and signatures continue through token-validating SECURITY DEFINER RPCs.
drop policy if exists "Anonymous users can create safety acknowledgements" on public.safety_acknowledgements;

create policy "Anonymous users can create pending safety acknowledgements"
on public.safety_acknowledgements for insert to anon
with check (
  record_type = any (array['jsa'::text, 'toolbox_talk'::text])
  and record_id is not null
  and attendee_name is not null and length(trim(attendee_name)) > 0
  and attendee_key is not null and length(trim(attendee_key)) > 0
  and qr_token is not null and length(trim(qr_token)) >= 16
  and acknowledgement_status = 'pending'
  and acknowledgement_method is null
  and acknowledged_at is null
);

revoke all on table public.safety_acknowledgements from anon;
grant insert on table public.safety_acknowledgements to anon;

-- Toolbox content: anonymous users may see active approved talks and submit a new
-- report/attendance row, but cannot browse attendance/history or mutate records.
drop policy if exists "Toolbox talks are insertable" on public.toolbox_talks;
drop policy if exists "Toolbox talks are readable" on public.toolbox_talks;
drop policy if exists "Toolbox talks are updateable" on public.toolbox_talks;

create policy "Authenticated users can add toolbox talks"
on public.toolbox_talks for insert to authenticated
with check (true);

create policy "Authenticated users can read toolbox talks"
on public.toolbox_talks for select to authenticated
using (true);

create policy "Authenticated users can update toolbox talks"
on public.toolbox_talks for update to authenticated
using (true) with check (true);

create policy "Anonymous users can read active toolbox talks"
on public.toolbox_talks for select to anon
using (is_active is true);

revoke all on table public.toolbox_talks from anon;
grant select on table public.toolbox_talks to anon;

drop policy if exists "Toolbox assignments are insertable" on public.toolbox_talk_assignments;
drop policy if exists "Toolbox assignments are readable" on public.toolbox_talk_assignments;
drop policy if exists "Toolbox assignments are updateable" on public.toolbox_talk_assignments;

create policy "Authenticated users can add toolbox assignments"
on public.toolbox_talk_assignments for insert to authenticated
with check (true);

create policy "Authenticated users can read toolbox assignments"
on public.toolbox_talk_assignments for select to authenticated
using (true);

create policy "Authenticated users can update toolbox assignments"
on public.toolbox_talk_assignments for update to authenticated
using (true) with check (true);

revoke all on table public.toolbox_talk_assignments from anon;

drop policy if exists "Subcontractors can submit toolbox_talk_reports" on public.toolbox_talk_reports;
drop policy if exists "Toolbox talk reports insertable" on public.toolbox_talk_reports;
drop policy if exists "Toolbox talk reports readable" on public.toolbox_talk_reports;
drop policy if exists "Toolbox talk reports updateable" on public.toolbox_talk_reports;

create policy "Authenticated users can add toolbox talk reports"
on public.toolbox_talk_reports for insert to authenticated
with check (true);

create policy "Authenticated users can read toolbox talk reports"
on public.toolbox_talk_reports for select to authenticated
using (true);

create policy "Authenticated users can update toolbox talk reports"
on public.toolbox_talk_reports for update to authenticated
using (true) with check (true);

create policy "Anonymous users can submit toolbox talk reports"
on public.toolbox_talk_reports for insert to anon
with check (true);

revoke all on table public.toolbox_talk_reports from anon;
grant insert on table public.toolbox_talk_reports to anon;

drop policy if exists "Toolbox attendance deleteable" on public.toolbox_talk_attendance;
drop policy if exists "Subcontractors can submit toolbox_talk_attendance" on public.toolbox_talk_attendance;
drop policy if exists "Toolbox attendance insertable" on public.toolbox_talk_attendance;
drop policy if exists "Toolbox attendance readable" on public.toolbox_talk_attendance;
drop policy if exists "Toolbox attendance updateable" on public.toolbox_talk_attendance;

create policy "Authenticated users can delete toolbox attendance"
on public.toolbox_talk_attendance for delete to authenticated
using (true);

create policy "Authenticated users can add toolbox attendance"
on public.toolbox_talk_attendance for insert to authenticated
with check (true);

create policy "Authenticated users can read toolbox attendance"
on public.toolbox_talk_attendance for select to authenticated
using (true);

create policy "Authenticated users can update toolbox attendance"
on public.toolbox_talk_attendance for update to authenticated
using (true) with check (true);

create policy "Anonymous users can submit toolbox attendance"
on public.toolbox_talk_attendance for insert to anon
with check (true);

revoke all on table public.toolbox_talk_attendance from anon;
grant insert on table public.toolbox_talk_attendance to anon;

-- The QR acknowledgement functions are intentionally executable by anon. They
-- validate record type, record id, and the per-record QR token before returning or writing.
grant execute on function public.get_public_safety_acknowledgement_record(text, uuid, text) to anon, authenticated;
grant execute on function public.submit_public_safety_acknowledgement(text, uuid, text, uuid, text, text, text, text, boolean) to anon, authenticated;
