-- Add field-level validation to the intentionally public insert-only safety forms.
-- This migration changes anon policies only; authenticated policies are unchanged.

drop policy if exists "Anonymous users can submit accident reports" on public.accident_reports;
create policy "Anonymous users can submit accident reports"
on public.accident_reports for insert to anon
with check (
  id is not null
  and accident_date is not null
  and length(trim(site_location)) between 1 and 300
  and length(trim(injured_worker)) between 1 and 150
  and length(trim(injured_worker_display)) between 1 and 150
  and length(trim(report_maker_worker)) between 1 and 150
  and length(trim(report_maker_display)) between 1 and 150
  and length(trim(incident_description)) between 1 and 10000
  and jsonb_typeof(contributing_factors) = 'array'
  and coalesce(length(created_by_worker), 0) between 1 and 200
);

drop policy if exists "Anonymous users can submit accident acknowledgements" on public.accident_report_acknowledgements;
create policy "Anonymous users can submit accident acknowledgements"
on public.accident_report_acknowledgements for insert to anon
with check (
  accident_report_id is not null
  and length(trim(worker_name)) between 1 and 150
  and coalesce(length(worker_display_name), 0) <= 150
  and acknowledged_at is null
  and acknowledgement_name is null
);

drop policy if exists "Anonymous users can submit employee injury reports" on public.employee_injury_reports;
create policy "Anonymous users can submit employee injury reports"
on public.employee_injury_reports for insert to anon
with check (
  id is not null
  and length(trim(employee_worker)) between 1 and 150
  and length(trim(employee_display)) between 1 and 150
  and length(trim(employee_name)) between 1 and 150
  and length(trim(accident_location)) between 1 and 300
  and accident_date is not null
  and length(trim(accident_description)) between 1 and 10000
  and coalesce(length(created_by_worker), 0) between 1 and 200
);

drop policy if exists "Anonymous users can submit employee injury acknowledgements" on public.employee_injury_acknowledgements;
create policy "Anonymous users can submit employee injury acknowledgements"
on public.employee_injury_acknowledgements for insert to anon
with check (
  employee_injury_report_id is not null
  and length(trim(worker_name)) between 1 and 150
  and coalesce(length(worker_display_name), 0) <= 150
  and acknowledged_at is null
  and acknowledgement_name is null
);

drop policy if exists "Anonymous users can submit incident reports" on public.incident_reports;
create policy "Anonymous users can submit incident reports"
on public.incident_reports for insert to anon
with check (
  id is not null
  and length(trim(incident_type)) between 1 and 100
  and report_date is not null
  and coalesce(length(trim(project)), 0) between 1 and 300
  and coalesce(length(trim(location)), 0) between 1 and 300
  and coalesce(length(trim(reported_by_worker)), 0) between 1 and 200
  and length(trim(description)) between 1 and 10000
  and jsonb_typeof(photos) = 'array'
  and jsonb_array_length(photos) <= 20
);

drop policy if exists "Anonymous users can submit toolbox talk reports" on public.toolbox_talk_reports;
create policy "Anonymous users can submit toolbox talk reports"
on public.toolbox_talk_reports for insert to anon
with check (
  id is not null
  and talk_id is not null
  and length(trim(talk_title)) between 1 and 300
  and report_date is not null
  and coalesce(length(trim(project)), 0) between 1 and 300
  and coalesce(length(trim(presenter_name)), 0) between 1 and 200
  and coalesce(length(trim(submitted_by_worker)), 0) between 1 and 200
  and jsonb_typeof(crew) = 'array'
  and jsonb_array_length(crew) between 1 and 100
);

drop policy if exists "Anonymous users can submit toolbox attendance" on public.toolbox_talk_attendance;
create policy "Anonymous users can submit toolbox attendance"
on public.toolbox_talk_attendance for insert to anon
with check (
  report_id is not null
  and talk_id is not null
  and length(trim(worker_name)) between 1 and 150
  and coalesce(length(worker_display_name), 0) <= 150
  and acknowledged_at is null
  and acknowledgement_name is null
);
