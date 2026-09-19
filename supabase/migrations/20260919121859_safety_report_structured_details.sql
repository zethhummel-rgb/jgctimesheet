-- Add structured sections and drawn sign-offs without changing legacy fields or access policies.
alter table public.employee_injury_reports
  add column report_details jsonb not null default '{}'::jsonb,
  add constraint employee_injury_report_details_object check
    (jsonb_typeof(report_details) = 'object' and octet_length(report_details::text) <= 1048576);

alter table public.accident_reports
  add column report_details jsonb not null default '{}'::jsonb,
  add constraint accident_report_details_object check
    (jsonb_typeof(report_details) = 'object' and octet_length(report_details::text) <= 1048576);

comment on column public.employee_injury_reports.report_details is
  'Versioned employer, people, occurrence, investigation, corrective actions and drawn sign-offs. Existing report RLS applies.';
comment on column public.accident_reports.report_details is
  'Versioned manual-person metadata and drawn supervisor sign-off. Existing report RLS applies.';
